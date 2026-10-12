# 理想アーキテクチャ

このドキュメントは、ShellGeiAI の理想像、責務境界、`solve` 実行フローを 1 か所にまとめます。

理想像は、単一候補を順番に試す CLI ではなく、複数 worker が Docker 内で候補探索と実行を進め、親オーケストレータが判定、選択、ログ集約を行う構成です。

## 現状の実装位置

現在の `src/` は strict TypeScript の31ファイルと7ディレクトリです。現在のファイル配置は [src-file-map.md](src-file-map.md) に記載しています。

```text
src/
  cli.ts / types.ts / shared.ts
  cli/         command 定義・dispatch
  solve/       session・plan・worker・停止・選択・Tool
  execution/   Runner・Judge・policy
  providers/   Engine・LLM・Planner・embedding
  knowledge/   dataset・SQLite・retrieval・man
  io/          logs・progress
  shell/       Bash AST
```

session と plan 正規化は `solve/solve.ts`、queue / 停止 / 集約は `solve/orchestrator.ts`、retry / attempt は `solve/worker.ts` に集約しています。この文書の Planner / Agent / Runner / Judge / Selector / Logs は責務境界であり、ディレクトリを増やす配置案ではありません。

## 目標

- CLI は薄く保ち、solve の進行は `src/solve/` に閉じ込める
- command 実行、安全性、判定は `src/execution/` に寄せる
- model provider や LLM planner 依存は `src/providers/` に閉じ込める
- 問題文、ログ、表示などの入出力は `src/io/` に寄せる
- worker 並列実行、判定、選択、ログを疎結合に保つ
- Docker 制限と command policy を緩めず、再現可能なログを残す

## 全体像

理想的な solve は次の流れで進みます。

```text
CLI
  -> Problem Parser
  -> Solve Session
  -> Planner
  -> Worker Orchestrator
  -> Runner
  -> Judge
  -> Selector
  -> Formatter
  -> Logger
```

親プロセスは監督者です。各 worker に問題文、入力、探索方針、試行上限、実行制限を渡し、worker の試行結果を集約します。

worker は短い局所探索を行います。候補 command を作り、Docker 内で実行し、失敗理由を見て数回だけ自己修正します。無制限の長考や外部アクセスは許可しません。

## レイヤの責務

### `src/cli/`

- CLI コマンドを定義する
- オプションを解析する
- ユーザー向けエラーを整える
- solve / logs などのアプリケーション処理へ委譲する

CLI は問題解釈、実行計画、判定、選択の詳細を持ちません。

### `src/solve/`

- solve session を初期化する
- planner 結果を worker task へ変換する
- worker を並列実行し、停止条件を管理する
- worker result を selector へ渡す

`src/solve/` はアプリケーションフローを持ちますが、Docker 実行の詳細や provider 実装には直接踏み込みません。

knowledge retrieval は Planner と Worker で責務を分けます。`planner` / `all` では session 初期化時に最大5件を prefetch し、Planner がその record を信頼済み命令ではなく任意の参考情報として読み、探索 variant、`toolBias`、`toolSuggestions` を作ります。record を各 Worker task や通常の command prompt へ無条件に注入することはありません。

`worker` / `all` では session が provider-neutral な `ToolRegistry` に read-only の `search_knowledge` を登録します。各 Worker attempt の Tool Loop は Tool call を最大1回だけ許可し、registry が引数検証と実行を担当した後、最大5 records の結果を Engine の continuation へ返します。retry は新しい attempt なので、改めて1回だけ呼び出せます。

```text
Planner prefetch (planner/all)
  -> untrusted bounded records
  -> Planner variants / toolBias / toolSuggestions
  -> Worker attempt
  -> Worker Tool Loop (worker/all, at most one call)
  -> ToolRegistry executes search_knowledge
  -> Engine continuation
  -> command
```

Engine adapter は provider 固有の Tool schema、Tool call、continuation を共通 turn 形式へ翻訳するだけです。Tool の選択、実行、回数制限は `src/solve/` の orchestration が所有します。現在 native Tool Calling に対応するのは API engine（互換 class 名 `OpenAIEngine`）で、OpenRouter / OpenAI / 互換 gateway の共通 LLM 設定を使います。`worker` / `all` を指定した非対応 Engine は Planner 実行前に fail fast します。`off` / `planner` は Tool Calling capability を要求しません。

`src/providers/embedder.ts` が OpenRouter の remote embedding API を扱い、`src/knowledge/` が dataset fingerprint、embedding input profile、SQLite generation と検索を管理します。この経路は回答生成の `LLM_BASE_URL` / model とは独立し、回答が OpenAI 直接接続でも embedding 用の `OPENROUTER_API_KEY` が必要です。既定 model は `qwen/qwen3-embedding-8b`、4096次元 float32 と sqlite-vec の cosine 検索を利用します。`knowledge prepare` は native 接続と1回の API request を確認し、`knowledge build` は batch embedding を staged generation に保存、完了時だけ active generation を切り替えます。失敗時は以前の completed generation を維持し、利用者の旧 man dataset / vector file を自動変更・削除しません。

solve / search は dataset 内容・絶対パス・provider・model・input profile が一致する ready database を要求し、実行時 document embedding fallback はありません。Planner と Worker は session に1つの runtime と query cache を共有し、検索時の query だけを remote API に送ります。`off` は native database と embedding provider を初期化しません。`--knowledge-model` / `SHELLGEIAI_KNOWLEDGE_MODEL` で model、`--knowledge-db`（solve）/ `--db`（knowledge）/ `SHELLGEIAI_KNOWLEDGE_DB` で database を指定できます。省略 dataset は package 所在地、cache path は user cache 内の identity hash から解決します。旧 Ruri と JSON/JSONL vector cache は読み込みません。

### `src/execution/`

- command を制限付き環境で実行する
- command policy と sandbox policy を読み込み、検査する
- stdout / stderr / exit code / timeout / resource limit を記録する
- attempt の成否を判定する

通常実行の主役は `DockerRunner` です。`LocalRunner` は補助用途として扱います。

### `src/providers/`

- API engine、CLI engine、mock engine などを実装する
- LLM planner の prompt、schema、正規化を扱う
- model provider 固有の都合を solve flow から隔離する

Tool Calling 対応 adapter は provider API と共通の `CommandTurn` / `ToolCallsTurn` の相互変換だけを行います。Tool の実行、validation policy、呼び出し budget は provider 層に置きません。

現行 runtime は `resolveLlmConfig()` で接続先、明示 key、Worker / Planner model、timeout、retry を一度解決し、API engine と configured LLM Planner に渡します。既定は OpenRouter `https://openrouter.ai/api/v1` と `openai/gpt-6.1-sol`、OpenAI の URL を明示すると key は `OPENAI_API_KEY`、既定 model は `gpt-6.1-sol` になります。custom URL は明示 key と model が必要で、未知の host への provider key fallback はありません。CLI の `api` と `openai` は同じ engine で、接続先を選ぶのは URL です。`mock` は Worker だけを置き換え、Planner は provider を注入しない限り API を使います。

Planner は Zod schema に基づく Structured Outputs を `responses.parse()` で受け取ります。SDK が HTTP retry、timeout と abort を担当し、通常 command の非 JSON 再生成は Engine が別ループで扱います。各 retry は設定回数だけ初回に追加され、Engine は HTTP error を再試行しません。Responses API / Structured Outputs / Function Calling を備えた互換 service を対象とし、Chat Completions fallback は持ちません。

Worker の Tool continuation は `store: false` で request input、返された output 全体、`function_call_output` を順に再送します。`previous_response_id` に依存せず、reasoning / encrypted reasoning もメモリ内の履歴に保持します。履歴は worker turn ごとに独立し、公開ログには渡しません。既定の2 model ID は `reasoning.encrypted_content` を要求し、他の明示 model にその option を付けません。

provider の失敗は、利用者が原因と次の対応を理解できる形で返します。

### `src/io/`

- 正規化済み問題文と結果を利用者へ表示する
- 結果、進捗、ログ表示を整える
- session log と catalog を保存、検索、削除できる形にする

ログはあとから再現、解析、比較できる構造を優先します。

### `src/shared.ts`

- ファイル操作やプロセス実行など、小さな共通補助だけを置く
- 特定ドメインの判断を入れない

`shared` が大きくなった場合は、より具体的なレイヤへ戻します。

## CLI 実行フロー

`shellgeiai solve` は、利用者がすぐ使える command と結果を返すことを優先します。

```bash
shellgeiai solve "CSVの3列目の合計を出してください"
shellgeiai solve "CSVの3列目の合計を出してください" --mode sprint
shellgeiai solve "CSVの3列目の合計を出してください" --parallelism 6
shellgeiai solve "CSVの3列目の合計を出してください" --selector best-score
```

実行時の流れは次のとおりです。

1. `src/cli/` がサブコマンドとオプションを解析する
2. `src/solve/solve.ts` が問題文、期待出力、入力ファイル、補助条件を正規化する
3. `src/solve/solve.ts` が run id、作業ディレクトリ、policy、runner limits、deadline、planner 入力を準備する
4. planner が探索方針を作り、worker ごとの task へ正規化する
5. `src/solve/orchestrator.ts` が worker task を並列に進める
6. worker が候補 command を生成し、runner で実行し、judge result をもとに数回だけ自己修正する
7. selector が成功候補、score、失敗理由、実行時間を見て最終候補を選ぶ
8. formatter が結果を表示し、logs が session log と catalog を保存する

## 出力と失敗時 UX

成功時は、利用者がすぐ使える command と結果を優先して表示します。

```text
COMMAND: ...
OUTPUT: ...
EXPLANATION: ...
CHECK: passed
```

必要に応じて、採用 strategy、worker 数、selector、attempt 数、sandbox、log path も表示できるようにします。

失敗時は単に失敗と出さず、どの worker strategy が失敗したか、Docker 制限や timeout や policy 拒否のどれに該当したか、最も惜しかった候補は何かを説明します。並列度、試行回数、入力指定など、利用者が次に変えられる項目も示します。

## 実行モード

`sprint`

- 勉強会向け
- 高並列
- 早期停止を重視
- 1 worker あたりの試行回数は少なめ

`balanced`

- 普段使い向け
- 並列度と比較精度のバランスを取る
- 成功候補が複数ある場合は selector で比較する

`eval`

- corpus 評価向け
- 完走とログ保存を重視
- すべての worker 結果を比較可能な形で残す

## 安全性

安全性は 3 層で守ります。

1. command policy で危険コマンドを軽量に検査する
2. sandbox policy と runner limits で実行環境を制限する
3. worker result を judge / selector で検査し、採用前に妥当性を確認する

Docker で閉じ込める前提でも、command policy は必要です。危険な intent を早めに拒否し、失敗理由を説明できるようにします。

## ログと再現性

session log には次を残します。

- 問題文と正規化結果
- planner が作った worker task
- worker ごとの attempts
- 各 attempt の command、stdout、stderr、exit code、判定結果
- runner limits と sandbox policy
- selector が採用した候補と理由
- LLM の `provider`、`baseURL`、`model`、`plannerModel`、`timeoutMs`、`maxRetries`（明示的 allowlist）

Tool Calling は attempt ごとに Tool 名、検証済み引数、成否、件数、record ID だけを bounded summary として残します。API key、reasoning / encrypted reasoning、Worker Tool result 内の record 本文、完全な Tool result、provider の response ID、continuation はログへ保存しません。

Planner prompt と raw response metadata は再現性のため既存 schema のまま保存し、bounded な Planner reference text を含む場合があります。この Planner metadata と、本文を保存しない Worker Tool summary の privacy contract は区別します。

成功候補だけでなく、失敗した探索も後から分析できる形にします。

## 今後の移行方針

現状のファイル単位の責務境界は維持しながら、次を段階的に強化します。

1. `src/solve/solve.ts` の初期化責務をさらに読みやすく分ける
2. planner が返す worker task の戦略品質を高める
3. judge と selector を複数候補前提で強化する
4. Docker runner の制限値、workdir、artifact 扱いを明確にする
5. logs / corpus の解析導線を増やす

大きな抽象を先に作るより、現行 solve flow の安全性、ログ、再現性を保ちながら小さく移行します。
