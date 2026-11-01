# Development

`docs/development.md` は ShellGeiAI の開発者向け情報をまとめるページです。

## 開発環境セットアップ

前提:

- Node.js 22 以上
- npm
- Docker を使った通常実行を試す場合は Docker

セットアップと基本確認:

```bash
npm install
npm test
```

JavaScript 版のため、ビルドは不要です。互換用に次のコマンドは no-op です。

```bash
npm run build
```

ローカル開発では次のコマンドで CLI を直接起動できます。

```bash
npm run dev -- solve "CSVの3列目の合計を出してください"
```

CLI エントリポイントは `src/cli.js` です。CLI コマンド名は `shellgeiai` です。

### LLM の設定と契約テスト

既定の Planner / Worker は OpenRouter の Responses API（`https://openrouter.ai/api/v1`）、model `openai/gpt-6.1-sol` を使います。CLI の通常実行には `OPENROUTER_API_KEY` が必要です。OpenAI へ直接接続する場合は `LLM_BASE_URL=https://api.openai.com/v1` と `OPENAI_API_KEY` を設定し、model の既定値は `gpt-6.1-sol` になります。`--engine api` が既定、`openai` は接続先を固定しない互換 alias です。`mock` が固定するのは Worker だけで、オフラインの solve テストは Planner provider も注入します。

`src/providers/llm/config.js` が CLI / 明示 option、新環境変数、接続先に適用できる旧 OpenAI 設定、既定値の順で共通設定を解決します。新変数は `LLM_BASE_URL`、`SHELLGEIAI_LLM_API_KEY`、`SHELLGEIAI_LLM_MODEL`、`SHELLGEIAI_PLANNER_MODEL`、`SHELLGEIAI_LLM_TIMEOUT_MS`、`SHELLGEIAI_LLM_MAX_RETRIES` です。Planner model は未指定なら Worker model を継承します。`config.llm` は旧 `config.openai` より優先され、runtime の解決済み `llmConfig` が default Planner / Worker へ渡されます。その他の gateway は明示的な key と model を要求し、未知の URL に provider key を転送しません。URL は HTTPS または loopback HTTP に限定され、userinfo / query / fragment を拒否します。client は redirect を禁止し、送信 header を共通の認証・JSON header に限定します。

`client.js` の lazy SDK client は timeout（既定30000 ms、SDK timer 上限2147483647 ms）、HTTP retry（既定2、0～5の追加試行）と cancellation を担当します。Engine の非 JSON command 再生成は独立した同じ上限のループで、HTTP error を再試行しません。Planner は Zod schema を Structured Outputs に渡し、`responses.parse()` の結果を検証します。Responses API / Structured Outputs / Function Calling をサポートする互換 service が必要で、Chat Completions fallback はありません。SDK/provider error の request、response、header、cause を公開ログへ残しません。

`test/llmProviderContract.test.js` は実際にインストールされた OpenAI SDK に fake `fetchImpl` を注入し、3接続先への URL / key / model routing、Planner の構造化出力、plain command、reasoning を含む Tool turn の完全履歴再送を確認します。`store: false` と `previous_response_id` 不使用も検証します。`npm test` に含まれ、CI の Node.js 22 / 24 / 26 では専用 step でも実行します。外部APIと課金用 secret は使いません。

```bash
npx vitest run test/llmProviderContract.test.js
```

実 API の確認は任意で、課金対象です。Planner の Structured Outputs と Worker の Function Calling / 続行をそれぞれ確認してください。暗号化 reasoning が実応答に含まれない場合もあるため、保持の保証は fake fixture でも検証します。API key を test fixture や公開ログへコピーしないでください。

### Knowledge のテストと互換性

`npm test` は fake embedding API と実際の `better-sqlite3` / `sqlite-vec` を使い、ネットワーク接続や `OPENROUTER_API_KEY` なしで provider validation、cosine 検索、generation の公開・失敗回復、CLI、Planner / Worker runtime を確認します。native dependency は Node.js 22以上が必要です。CI は Node.js 22 / 24 / 26 で `npm ci` と全テストを実行し、tarball を global install して任意の cwd から help と bundled seed dataset の存在、および fake embedder による native database build / cosine search を確認します。

Worker のキャンセルは未完了の Tool 結果を待つ処理を即座に終了します。同じ query の embedding は session 所有で共有され、個別 Worker の停止後も他の Worker が利用でき、session のキャンセル・終了時に停止します。

実 API による確認は任意です。`OPENROUTER_API_KEY` を設定した環境で `knowledge prepare`、`knowledge build --db /tmp/shellgeiai-check.sqlite`、`knowledge search "CSV" --db /tmp/shellgeiai-check.sqlite` を実行します。これらは課金対象の remote embedding request を送るので CI に secret は設定しません。生成済み database / WAL / SHM は package と Git に含めません。

この移行では Node.js 最低版が20から22へ変わり、旧 Ruri / Transformers.js と JSON/JSONL vector cache は廃止されます。dataset は引き続き JSONL です。旧 cache は import せず `knowledge build` で SQLite database を再生成し、旧 CLI vector flag は1回の移行リリース中に専用エラーで案内します。利用者のローカル man dataset や旧 vector file は migration のために削除しません。

## 現状と理想像

このリポジトリには 3 つのドキュメントレイヤがあります。

- 現状の実装: LLM Planner の variant を複数 worker で探索し、通常実行は `DockerRunner` を既定にした MVP
- `docs/` の理想像: 複数 SubAgent を Docker 内で並列実行し、planner / selector / judge / logs を分離する将来構成
- `docs/superpowers/` の作業計画: Codex Superpowers の SKILLS が生成する一時的な設計・実装計画

生成された作業計画 `.md` は追跡しません。過去の実行計画は git history を参照してください。

現在の `src/` は `cli / solve / execution / providers / io / shared` の大きな責務境界へ整理済みです。solve の進行は `src/solve/`、実行・安全性・判定は `src/execution/`、LLM/CLI provider は `src/providers/`、入出力と表示は `src/io/` に寄せ、段階的に理想構成へ近づけています。

MVP では、まず次の流れを最小構成で実現します。

- 問題文を読み込む
- Engine が候補コマンドを生成する
- Safety checker が危険なコマンドを検査する
- Runner が Docker 内でコマンドを実行する
- Judge が結果を確認する
- 成功なら整形済みの回答を表示し、失敗なら再試行する

## 主要コンポーネント

- `src/cli.js`: CLI 入口
- `src/cli/`: CLI コマンドと引数解析
- `src/solve/solve.js`: solve の薄い入口
- `src/solve/session/solveSession.js`: セッション初期化
- `src/solve/orchestration/orchestrator.js`: worker 実行オーケストレーション
- `src/solve/planning/planner.js`: LLM planner 結果を execution plan へ正規化する薄い入口
- `src/solve/selection/selector.js`: 現行の最小 selector
- `src/solve/worker/`: worker retry loop と attempt 実行
- `src/providers/engines/`: Engine 実装群
- `src/providers/llm/`: 共通 LLM 設定、SDK client、stateless Responses 履歴
- `src/io/problem/`: 問題文正規化の入口
- `src/execution/runner/`: 実行基盤
- `src/execution/safety/`: command policy と sandbox policy
- `src/execution/judge/`: 判定器
- `src/io/logs/`: セッションログ出力
- `src/io/formatter/`: 結果表示
- `src/shared/`: ファイル・実行補助

将来的な理想構成では、次の責務分割を目指します。

- `src/solve/`: session / orchestration / planning / selection / worker
- `src/agents/`: SubAgent 実装群
- `src/execution/runner/`: Docker 実行基盤
- `src/execution/safety/`: command policy / sandbox policy
- `src/execution/judge/`: worker 一次判定と最終判定
- `src/io/logs/`: session / worker ログ

## 実装と運用の補足

- `DockerRunner` が通常実行の既定です
- `LocalRunner` は必要時の切り替え用で、Docker ほど強い隔離は提供しません
- LLM planner が返した variant から `workerTask[]` を作る planner contract と、`first-pass-wins` / `best-score-wins` の最小 selector を持ちます
- judge score と selector metrics は結果とログへ伝播されます
- LLM log は `provider / baseURL / model / plannerModel / timeoutMs / maxRetries` の allowlist のみを保存し、key、reasoning、continuation、Worker Tool result 本文を保存しません
- 回答生成の URL / model 設定と Knowledge embedding は独立しています。Embedding は従来どおり OpenRouter Qwen3 8B と SQLite / sqlite-vec を使い、回答が OpenAI でも `OPENROUTER_API_KEY` が必要です

### Policy JSON

`command policy` と `sandbox policy` は、`solve` 実行時に次の option で差し替えられます。

```bash
shellgeiai solve "..." --command-policy ./policies/default-command-policy.json
shellgeiai solve "..." --sandbox-policy ./policies/default-sandbox-policy.json
```

既定サンプルは `policies/default-command-policy.json` と `policies/default-sandbox-policy.json` です。指定パスは `process.cwd()` 基準で解決されます。指定しない場合、command policy は `src/execution/safety/commandPolicy.js` の既定 deny-list、sandbox policy は `src/execution/safety/sandboxPolicy.js` の既定値を使います。

Command policy は、Bash AST から抽出した command name、redirection target、再帰的 background shell function をもとに拒否条件を定義します。

```json
{
  "blockedCommands": [
    {
      "name": "rm",
      "reason": "Blocked dangerous command: rm"
    },
    {
      "name": "curl",
      "reason": "Blocked network command: curl"
    }
  ],
  "blockedRedirectionTargets": [
    {
      "prefix": "/etc",
      "reason": "Blocked redirection to sensitive path"
    },
    {
      "prefix": "$HOME",
      "reason": "Blocked redirection to sensitive path"
    }
  ],
  "blockRecursiveBackgroundFunctions": true
}
```

- `blockedCommands[].name`: AST 上の command name と完全一致した場合に拒否します。
- `blockedCommands[].reason`: ブロック理由として利用者へ返します。
- `blockedRedirectionTargets[].prefix`: `>` または `>>` の出力先がこの prefix 配下の場合に拒否します。
- `blockedRedirectionTargets[].reason`: ブロック理由として利用者へ返します。実際の出力先 path は checker が末尾に付けます。
- `blockRecursiveBackgroundFunctions`: `f(){ f|f& }; f` や `:(){ :|:& };:` のような再帰的 background shell function を拒否します。
- `--command-policy` で外部ファイルを指定した場合、既定 policy へ merge せず、そのファイル内容だけを使います。

Sandbox policy は、runner に渡す sandbox 方針を定義します。

```json
{
  "networkAccess": "off",
  "filesystemScope": "workdir-only"
}
```

- `networkAccess`: `off` または `on`。`DockerRunner` では `off` が `--network none` に反映されます。
- `filesystemScope`: ログ、結果、runner 設定に渡す sandbox 範囲ラベルです。

Policy JSON は、読めない JSON、schema にないキー、空の必須文字列がある場合に load 時点で失敗します。`command policy` は AST ベースの静的チェックであり、完全な policy engine ではありません。primary workdir mount の writable / read-only は `--workdir` と `--writable-workdir` が制御します。

## 関連ドキュメント

- [README.md](/home/amanoese/repos/shellgeiai/README.md): 利用者向けの導入と使い方
- [docs/README.md](/home/amanoese/repos/shellgeiai/docs/README.md): `docs/` 全体の案内
- [docs/ideal-architecture.md](/home/amanoese/repos/shellgeiai/docs/ideal-architecture.md): 理想的な責務分離、アーキテクチャ、CLI 実行フロー
- [docs/superpowers/plans/](/home/amanoese/repos/shellgeiai/docs/superpowers/plans): Codex Superpowers が生成する作業用実装計画の置き場
