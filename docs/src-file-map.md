# 現在の source map

`src/` は31個の strict TypeScript ファイル、7ディレクトリです。root の3ファイルと以下の配置が実装の一覧です。責務をファイル内でも分離し、session / worker / policy ごとの深いディレクトリを増やしません。

```text
src/
  cli.ts                       CLI 起動
  types.ts                     レイヤ間契約（runtime export は空）
  shared.ts                    fs / 子プロセス / default parallelism
  cli/
    program.ts                 Commander command / option / argument
    commands.ts                solve / logs dispatch、結果整形
  solve/
    solve.ts                   問題正規化、session、plan 正規化、solve 入口
    runtime.ts                 Engine / Runner / Judge / Planner 構築
    orchestrator.ts            queue、並列実行、停止制御、集約
    worker.ts                  retry、attempt、安全性検査、実行、判定
    tools.ts                   Tool registry、引数検証、bounded Tool loop
    selection.ts               selector、shellgei scoring
    events.ts                  phase、progress callback
  execution/
    localRunner.ts             host command 実行
    dockerRunner.ts            Docker isolation、limits、cleanup
    safety.ts                  default policy、JSON policy validation、AST 検査
    judge.ts                   stdout / exit code / expected output 判定
  providers/
    engines.ts                 mock / Codex CLI / Cursor CLI Engine
    apiEngine.ts               Responses command / Tool Calling adapter
    llm.ts                     LLM config、SDK client、Responses history
    planner.ts                 Planner prompt / Zod schema / provider
    embedder.ts                OpenRouter embedding / validation / retry
  knowledge/
    config.ts                  mode、model、paths、embedding input profile
    dataset.ts                 JSONL normalization / fingerprint / byte cap
    store.ts                   SQLite schema / native store / generation / search
    runtime.ts                 lifecycle / shared query cache / hints / search Tool
    commands.ts                prepare / build / search
    man.ts                     installed man から決定的な dataset 抽出
    manProfile.ts              command list と profile
  io/
    logs.ts                    session log / catalog / log 表示
    progress.ts                bar / plain / JSONL progress
  shell/
    analyzer.ts                Bash AST と共有 tree-sitter WASM parser
```

## 最初に読む5ファイル

1. `src/cli/program.ts`: CLI が受け取る入力と option
2. `src/cli/commands.ts`: command から domain 処理への引き渡しと表示
3. `src/solve/solve.ts`: 問題文、session 初期化、Planner と最終結果
4. `src/solve/orchestrator.ts`: worker 並列実行、停止と候補集約
5. `src/solve/worker.ts`: 1 worker の retry と1 attempt の実行

型で処理を追う場合は `src/types.ts`、API 通信は `src/providers/llm.ts`、隔離は `src/execution/dockerRunner.ts` を追加で読みます。`src/cli.ts` は起動のみです。

## 型と schema の所有

`src/types.ts` は Engine / Runner / Judge、session / plan / attempt / candidate、progress、Tool、knowledge、公開ログで共有する契約を持ちます。型専用 import / export で接続し、NodeNext の相対 import は source でも `.js` suffix にします。`dist/types.js` の runtime export は空です。

Planner の Zod schema は `src/providers/planner.ts`、search Tool の Zod schema は `src/knowledge/runtime.ts`、policy の schema / default は `src/execution/safety.ts`、SQLite schema は `src/knowledge/store.ts` が所有します。Planner の variant / result 型と search Tool の入力型は schema から導出し、schema と別に同じ形を手書きしません。`ToolRegistration<Input, Output>` は schema の出力、executor 引数と戻り値、summary の入力を結び付けます。search Tool の records 型は `formatKnowledgeRecords` の戻り値から導出します。公開 `ToolRegistry.execute` の結果形式を保ち、Worker 内で型付き summary を完成させます。注入された旧 registry の結果は互換境界で読み取り、provider には `ok` と `value` または `error` だけを渡します。

`WorkerAttemptOutcome` は `passed / retry / stopped`、`ToolExecutionResult` は `ok: true / false` を判別子にした union です。成功時は必要な値を必須にし、停止時は `attempt: null` か保存可能な sparse attempt を明示します。Tool Calling capability を持つ Engine は `generateTurn` を必須にします。これらの内部 outcome の `kind` / `attempt: null` は保存ログに追加せず、attempt 本体のみを既存 schema へ渡します。

`ReadySolveSession` は plan を必須にし、`WorkerGeneration` で command（knowledge off / planner）と tools（worker / all）を区別します。初期化時に生成方式と Tool Calling capability を検証し、tools 側には Engine と registry の両方を必須にします。Worker は選択済みの方式で分岐します。`generateWorkerCommand` は従来の注入形式を受ける互換入口として検証を残します。

Runner の戻り値は `src/solve/worker.ts` 内の `NormalizedRunResult` へ一度だけ正規化し、未指定の `aborted` を false、`failure` / `cleanup` を null に揃えます。実行後の attempt は共通フィールドから構築します。`durationMs` の未指定値や、安全性検査で実行しなかった sparse attempt は従来どおり扱います。

`ExecutionStopState` は `running / grace / deadline-observed / stopped` を区別し、`ExecutionControl` が停止理由と最初の合格候補を管理します。`stopRequested / stopReason / passingCandidateId` は読み取り専用です。期限超過の同期観測と timer による Worker 停止を分け、5秒の grace と期限による停止理由の優先を維持します。内部 state の `kind` はログへ追加しません。

外部入力は `unknown` で受け、利用する境界で検証します。内部の型契約で不整合を防いでも、JavaScript からの注入、CLI / LLM / Policy 入力、数値と安全性の実行時検証は必要です。search adapter も実際の呼び出し時に method を確認し、receiver を保ちます。LLM 設定、knowledge snapshot、Worker Tool summary は明示 allowlist のみ保存します。Planner prompt / raw metadata は再現性のため保持する既存契約です。Worker の reasoning / continuation / provider call ID / Tool record 本文はログへ出しません。

SQLite と Bash parser の公開 helper は必要な操作だけを構造型で表現します。native library の内部型は実装内に保ち、配布 `.d.ts` が開発用 SQLite 型や WASM ambient 型を要求しないようにします。

## Source と配布 runtime

`npm run build` が同じ相対配置で `dist/` に `.js` / `.d.ts` / `.js.map` を生成します。test の runtime import と subprocess は `dist/`、型契約の検査は `src/**/*.ts` を対象にします。旧 deep import の移行先と watch 手順は [development.md](development.md) に記載しています。

理想的な責務分離と将来像は [ideal-architecture.md](ideal-architecture.md) を参照してください。将来の責務図は現在のファイル配置を置き換えるディレクトリ案ではありません。
