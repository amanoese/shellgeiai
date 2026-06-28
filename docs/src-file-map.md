# src File Map

このドキュメントは、現行 `src/` 配下のファイルが何を担当しているかを短く整理したものです。
詳細な将来像は `docs/ideal-architecture.md` と `docs/ideal-cli-flow.md` を参照してください。

## 全体構成

- `src/cli*`: CLI の入口、引数解析、サブコマンド実行。
- `src/solve/`: solve のアプリケーション本体。session、planner、orchestrator、worker、selector を持つ。
- `src/execution/`: コマンド実行、runner、judge、safety policy。
- `src/providers/`: OpenAI や外部 CLI など、AI / planner provider 依存。
- `src/io/`: 問題文入力、ログ、表示整形。
- `src/shared/`: 汎用的な fs / exec 補助。

## 主要フロー

### solve

`src/cli.js` -> `src/cli/index.js` -> `src/cli/commands/solve.js` -> `src/solve/solve.js`

`solve.js` は `createSolveSession()` で session を初期化し、`runSolveOrchestrator()` で worker を動かし、`selectSolveOutcome()` と `writeSolveSessionLog()` で最終結果をまとめます。

### logs

`src/cli/commands/logs*.js` が `src/io/logs/catalog.js` と `src/io/formatter/logs.js` を使い、保存済みログの一覧、検索、表示、削除を行います。

### command execution

runner は `LocalRunner` または `DockerRunner` です。実行前に `execution/safety` の command policy を通し、実行後に `SimpleJudge` が結果を判定します。

## ファイル別役割

### Root

- `src/cli.js`: npm bin から呼ばれる CLI entry point。`runCli()` に `process.argv` を渡す。
- `src/cliOptions.js`: 旧 import 互換用。`src/cli/parseCliOptions.js` を re-export する。

### CLI

- `src/cli/index.js`: parse 済み command を各 command handler に dispatch する。
- `src/cli/parseCliOptions.js`: top-level command を判定し、help text と parser dispatch を持つ。

### CLI Commands

- `src/cli/commands/solve.js`: solve 用 runtime を作り、`solveProblem()` を実行して結果を表示する。
- `src/cli/commands/logsShow.js`: 指定ログを読み、詳細表示する。
- `src/cli/commands/logsList.js`: logs directory のログ一覧を表示する。
- `src/cli/commands/logsSearch.js`: 保存済みログを条件検索して表示する。
- `src/cli/commands/logsPrune.js`: 保存済みログを削除する。

### CLI Options

- `src/cli/options/solveOptions.js`: `solve` の問題文と実行オプションを parse する。
- `src/cli/options/logsOptions.js`: `logs show/list/search/prune` を parse する。
- `src/cli/options/shared.js`: option parser 共通の flag 判定、数値 parse、値取得 helper。

### Solve Entry

- `src/solve/solve.js`: solve の薄い入口。session 作成、orchestration、selection、log 書き込みをつなぐ。
- `src/solve/runtime.js`: CLI option から engine / runner / judge / planner provider を組み立てる。

### Solve Session

- `src/solve/session/solveSession.js`: solve session を初期化する。problem、workdir、policies、runner limits、plan をまとめる。
- `src/solve/session/progress.js`: session phase の progress callback を呼び出す。
- `src/solve/session/sessionPhases.js`: progress phase 名を定義する。
- `src/solve/session/types.js`: solve session / attempt / candidate などの JSDoc 型定義。

### Solve Planning

- `src/solve/planning/planner.js`: planner provider の結果を現行の execution plan / worker task 形式へ正規化する。

### Solve Orchestration

- `src/solve/orchestration/orchestrator.js`: worker task を並列実行し、attempt / candidate / summary を集約する。
- `src/solve/orchestration/executionControl.js`: deadline、abort、早期停止など orchestration の停止制御を扱う。
- `src/solve/orchestration/executionSummary.js`: worker 実行結果から summary を作る。

### Solve Worker

- `src/solve/worker/taskQueue.js`: worker task を並列実行用 queue として管理する。
- `src/solve/worker/taskExecutor.js`: worker task の実行単位を起動する。
- `src/solve/worker/executeWorkerTask.js`: worker ごとの retry loop を制御する。
- `src/solve/worker/attemptRunner.js`: 1 attempt の command 生成、safety check、runner 実行、judge 判定を行う。
- `src/solve/worker/attemptFactory.js`: attempt / candidate object を組み立てる。
- `src/solve/worker/stopReason.js`: worker の停止理由や deadline 到達を判定する。

### Solve Selection / Scoring

- `src/solve/selection/selector.js`: 複数 candidate から最終候補を選ぶ。
- `src/solve/scoring/shellgeiScorer.js`: shell 芸らしさや実用性の score を candidate に付与する。

### Execution Runner

- `src/execution/runner/Runner.js`: runner interface の JSDoc 型定義。
- `src/execution/runner/localRunner.js`: host 上で command を実行する runner。
- `src/execution/runner/dockerRunner.js`: Docker container 内で command を実行する runner。
- `src/execution/runner/limits.js`: runner limits の default 値を作る。

### Execution Safety

- `src/execution/safety/checker.js`: command が command policy に照らして安全か判定する。
- `src/execution/safety/commandPolicy.js`: default command policy を定義する。
- `src/execution/safety/sandboxPolicy.js`: default sandbox policy を定義する。
- `src/execution/safety/policyLoader.js`: policy JSON を読み込み、schema validation して default と統合する。

### Execution Judge

- `src/execution/judge/Judge.js`: judge interface の JSDoc 型定義。
- `src/execution/judge/simpleJudge.js`: stdout / stderr / exitCode / expectedOutput を使う最小 judge。

### Providers

- `src/providers/engines/Engine.js`: engine interface の JSDoc 型定義。
- `src/providers/engines/openaiEngine.js`: OpenAI API を使って command を生成する engine。
- `src/providers/engines/codexCliEngine.js`: Codex CLI を外部 process として呼ぶ engine。
- `src/providers/engines/cursorCliEngine.js`: Cursor CLI を外部 process として呼ぶ engine。
- `src/providers/engines/mockEngine.js`: テストや dry run 用の固定 command engine。
- `src/providers/planner/llmPlanner.js`: LLM planner provider の入口。planner prompt を投げて plan を得る。
- `src/providers/planner/plannerPrompt.js`: planner に渡す prompt を組み立てる。
- `src/providers/planner/plannerSchema.js`: planner response の schema と validation。

### IO

- `src/io/problem/parseProblem.js`: CLI から受け取った問題文を problem object に正規化する。
- `src/io/logs/writer.js`: solve session log を JSON として保存する。
- `src/io/logs/catalog.js`: logs directory の読み取り、検索、削除、参照解決を行う。
- `src/io/formatter/formatResult.js`: solve の最終結果を CLI 表示用に整形する。
- `src/io/formatter/logs.js`: log 表示や log 一覧を CLI 表示用に整形する。
- `src/io/formatter/progressReporter.js`: progress event を bar / jsonl などの表示へ変換する。

### Shared

- `src/shared/exec.js`: child process 実行の薄い helper。
- `src/shared/fs.js`: directory 作成、workdir 解決、JSON 読み書きなどの fs helper。
