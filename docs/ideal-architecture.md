# 理想アーキテクチャ

このドキュメントは、ShellGeiAI の理想像、責務境界、`solve` 実行フローを 1 か所にまとめます。

理想像は、単一候補を順番に試す CLI ではなく、複数 worker が Docker 内で候補探索と実行を進め、親オーケストレータが判定、選択、ログ集約を行う構成です。

## 現状の実装位置

2026-06-28 時点の `src/` は、理想構成へ移行する途中段階です。ただし、主要な責務境界はすでに次の 6 つへ整理済みです。

```text
src/
  cli/
  solve/
  execution/
  providers/
  io/
  shared/
```

主な現行ファイルは次のとおりです。

- `src/cli.js`: CLI エントリポイント
- `src/cli/`: コマンド定義、オプション定義、引数解析
- `src/solve/solve.js`: solve の薄い入口
- `src/solve/session/solveSession.js`: problem parse、policy 読み込み、runner 構築、実行計画作成
- `src/solve/orchestration/orchestrator.js`: worker 実行のオーケストレーション
- `src/solve/worker/`: worker retry loop と attempt 実行
- `src/solve/planning/planner.js`: planner provider の結果を worker task へ正規化
- `src/solve/selection/selector.js`: 候補選択
- `src/solve/scoring/shellgeiScorer.js`: shellgei score
- `src/execution/runner/`: `DockerRunner` / `LocalRunner` と実行制限
- `src/execution/safety/`: command policy / sandbox policy
- `src/execution/judge/`: attempt 判定
- `src/providers/engines/`: CLI / OpenAI / mock engine
- `src/providers/planner/`: LLM planner
- `src/io/problem/`: 問題文の正規化
- `src/io/logs/`: session log の保存と検索用 catalog
- `src/io/formatter/`: 結果、ログ、進捗表示
- `src/shared/`: 小さな共通補助

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

### `src/execution/`

- command を制限付き環境で実行する
- command policy と sandbox policy を読み込み、検査する
- stdout / stderr / exit code / timeout / resource limit を記録する
- attempt の成否を判定する

通常実行の主役は `DockerRunner` です。`LocalRunner` は補助用途として扱います。

### `src/providers/`

- CLI engine、OpenAI engine、mock engine などを実装する
- LLM planner の prompt、schema、正規化を扱う
- model provider 固有の都合を solve flow から隔離する

provider の失敗は、利用者が原因と次の対応を理解できる形で返します。

### `src/io/`

- 問題文を共通フォーマットへ正規化する
- 結果、進捗、ログ表示を整える
- session log と catalog を保存、検索、削除できる形にする

ログはあとから再現、解析、比較できる構造を優先します。

### `src/shared/`

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
2. `src/io/problem/` が問題文、期待出力、入力ファイル、補助条件を正規化する
3. `src/solve/session/solveSession.js` が run id、作業ディレクトリ、policy、runner limits、deadline、planner 入力を準備する
4. planner が探索方針を作り、worker ごとの task へ正規化する
5. `src/solve/orchestration/orchestrator.js` が worker task を並列に進める
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

成功候補だけでなく、失敗した探索も後から分析できる形にします。

## 今後の移行方針

現状の 6 境界は維持しながら、次を段階的に強化します。

1. `src/solve/session/solveSession.js` の初期化責務をさらに読みやすく分ける
2. planner が返す worker task の戦略品質を高める
3. judge と selector を複数候補前提で強化する
4. Docker runner の制限値、workdir、artifact 扱いを明確にする
5. logs / corpus の解析導線を増やす

大きな抽象を先に作るより、現行 solve flow の安全性、ログ、再現性を保ちながら小さく移行します。
