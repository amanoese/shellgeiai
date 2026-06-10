# ShellGeiAI docs/ と現状実装の乖離を埋める修正計画

## Status

この計画は一部完了しています。2026-06-11 時点では、責務分離の土台作り、docs 整理、policy loader の最小実装、将来オプションを見越した CLI schema 整理、Docker runner の最小骨格、複数 worker を前提にした planner / selector / orchestrator の最小実装、`first-pass-wins` の早期停止、全体 `timeBudgetMs` による反復停止、実行中 worker の停止制御、runner の `AbortSignal` 対応、formatter / logs の基礎拡張、`workerTask[]` / selector / runtime 切替契約のテスト固定、`OpenAI API` 直接呼び出しの標準 engine 追加、`openai` 設定の最小整理までは実施済みです。一方で、Docker 実機前提の運用、高度な judge / selector / score モデル、進捗可視化の本格化、`check` / `replay` などは未実施です。

## Completed

### 1. docs と README の前提合わせ

- `README.md` に「現状の単一 worker 実装」と「docs の理想像」の境界を追記済み
- `docs/ideal-architecture.md` と `docs/ideal-cli-flow.md` に、現状との差分と移行段階を追記済み
- `AGENTS.md` の主要コンポーネント説明と優先項目を、現在のコード構成に合わせて更新済み

### 2. `core/solve.js` の責務分離

- `src/core/solve.js` を薄い入口に整理済み
- `src/core/solveSession.js` を追加し、problem parse・workdir・logsDir・plan 初期化を分離済み
- `src/core/orchestrator.js` を追加し、worker ごとの attempt ループと candidate 集約を分離済み
- `src/core/selector.js` を追加し、`first-pass-wins` と最小の `best-score-wins` を実装済み
- `attempts` と `finalCheck` は worker / candidate を包める形へ拡張済み
- `timeBudgetMs` から session deadline を計算し、orchestrator / runner で共有できる形へ更新済み

### 3. `problem` / `safety` / `logs` の分離

- `parseProblemInput` を `src/problem/parseProblem.js` へ移設済み
- safety を `src/safety/checker.js`、`src/safety/commandPolicy.js`、`src/safety/sandboxPolicy.js` に分離済み
- `src/safety/policyLoader.js` を追加し、`command policy` / `sandbox policy` を外部 JSON から読み込める最小 loader を実装済み
- 互換のため `src/runner/safety.js` は re-export の薄い層として維持済み
- JSON ログ出力を `src/logs/writer.js` に分離済み
- session ログには `problem`、`attempts`、`candidates`、`selectedCandidateId`、`stopReason`、`startedAt`、`finishedAt`、`workdir`、`planner`、`runner limits` を含める形に更新済み

### 4. CLI 契約と runtime の薄型化

- `src/cli.js` で engine / runner / judge を直接 new せず、`src/core/runtime.js` 経由で解決する形へ変更済み
- `SolveProblemOptions` には `mode`、`parallelism`、`selector`、`timeBudgetMs`、`runnerLimits`、`commandPolicy`、`sandboxPolicy` を保持できる余地を追加済み
- `src/cliOptions.js` は hidden option を含む内部 schema を整理し、`mode`、`parallelism`、`selector`、`time-budget`、`command-policy`、`sandbox-policy` を runtime wiring 用に受け取れる状態へ更新済み
- hidden option の validation は現実装に合わせて絞り込み、`mode` は `single` / `parallel`、`selector` は `first-pass-wins` / `best-score-wins` のみを受ける形へ固定済み
- 公開 help に出す CLI オプションはまだ現状維持

### 5. Runner / planner / selector の骨格追加

- `src/runner/Runner.js` に limits / sandbox policy / duration を表現できる型を追加済み
- `src/runner/localRunner.js` を新しい options / result shape に対応済み
- `src/runner/limits.js` を追加済み
- `src/core/planner.js` を追加し、固定の `workerTask[]` を返す最小 contract を定義済み
- `src/core/selector.js` で `first-pass-wins` / `best-score-wins` の最小選択ロジックを追加済み
- `src/core/orchestrator.js` で `first-pass-wins` の早期停止と全体 `timeBudgetMs` による反復停止を追加済み
- `src/core/orchestrator.js` で worker queue を使った最小 worker pool 制御と、実行中 worker への停止伝播を追加済み
- `src/runner/localRunner.js` と `src/runner/dockerRunner.js` を `AbortSignal` に対応させ、実行中 command を中断できるよう更新済み
- hidden CLI で受ける `selector` / `mode` は、現実装が理解できる値へ validation を固定済み
- `SolveResult` に実行時 `plan` を含め、worker 配置 contract をログ以外からも確認できるように更新済み

### 6. judge と結果モデルの最小更新

- `SimpleJudge` は単一試行の基本判定としてそのまま維持済み
- `JudgeInput` はすでに `expectedOutput` を受けられる形を保持
- `SolveResult` に `candidates`、`selector`、`runner`、`plan` を追加済み
- `SolveResult` に `stopReason` を追加し、停止理由を結果・ログ・formatter へ伝播できるよう更新済み
- formatter に `selector`、`selector reason`、`workers`、`sandbox`、`stopReason`、複数 candidate の簡易一覧表示を追加済み

### 7. テスト追加

- 既存の `cliOptions` / `safety` / `simpleJudge` テストは維持済み
- `test/solveFlow.test.js` で単一 worker solve フローの回帰を追加済み
- `test/solveFlow.test.js` で `first-pass-wins` の早期停止と全体 `timeBudgetMs` の回帰を追加済み
- `test/problemParser.test.js` で plain text parser の互換性を確認済み
- `test/selector.test.js` で selector の最小挙動を確認済み
- `test/safety.test.js` で external policy loader の回帰を追加済み
- `test/runner.test.js` で `LocalRunner` の共通 result shape と byte limit、および Docker 引数組み立てを確認済み
- `test/runner.test.js` で `AbortSignal` による実行中 command の中断を回帰確認済み
- `test/cliOptions.test.js` で hidden future-facing options の parse / validation を固定済み
- `test/runtimePlanner.test.js` で `runtime` の local/docker 切替と `workerTask[]` contract を固定済み
- `test/solveFlow.test.js` で `SolveResult.plan` の shape も回帰確認済み
- `test/solveFlow.test.js` で `first-pass-wins` 時の実行中 worker 中断と `stopReason` の回帰を追加済み
- `npm test` が通る状態まで確認済み

## Remaining Work

### A. engine 実装の OpenAI API 一本化

- Status: 一部完了
- `src/engines/openaiEngine.js` を追加し、prompt 構築・JSON 応答解釈・timeout / retry / model / base URL 設定の最小責務をこの層へ閉じ込めた
- `src/core/runtime.js` は `openai` を標準 engine として解決し、`src/cliOptions.js` の `--engine` 契約も `openai` / `mock` へ整理した
- `OPENAI_API_KEY` 未設定時の説明的エラーと、`OPENAI_MODEL` / `OPENAI_TIMEOUT_MS` / `OPENAI_MAX_RETRIES` / `OPENAI_BASE_URL` の最小設定経路も追加した
- ただし worker ごとの model override、prompt の高度化、旧 `codex` / `cursor` 実装ファイルの完全撤去は未実施

### B. `openai` ライブラリ導入と設定整理

- Status: 一部完了
- `package.json` で `openai` 依存を持つ前提に切り替え、engine 側は API client を遅延生成する形へ整理した
- API key は環境変数を基本とし、未設定時は利用者がすぐ直せるエラーメッセージを返す
- request timeout、retry、base URL 差し替えの最小 config 境界を engine に集約した
- API client は差し替え可能にし、実ネットワークに依存しない engine 単体テストを追加した
- README は `OPENAI_API_KEY` と利用モデル前提のセットアップへ更新した
- ただし provider 抽象化の一般化や追加 CLI option 化は未実施

### C. CLI の公開契約整理

- `src/cliOptions.js` の内部 schema と validation 整理は完了したが、hidden option の公開判断は未実施
- `mode`、`parallelism`、`selector`、`time-budget`、`command-policy`、`sandbox-policy` を正式な CLI 契約として help / README に出すかは未決定
- 現時点の hidden option は内部 wiring 用であり、公開サポート範囲はまだ約束していない
- `check` / `replay` を追加できる CLI ファイル配置への再編は未実施

### D. policy loader の運用強化

- 外部 JSON loader の最小実装に加え、`policies/default-command-policy.json` と `policies/default-sandbox-policy.json` のサンプル追加までは完了
- command policy / sandbox policy の schema を docs や README から参照できる形にはしていない
- policy loader の invalid regex は説明的に失敗するよう改善済み
- 複数ファイル運用や preset 切り替えは未対応

### E. Docker Runner 本体

- `Runner` interface と limits 型に加え、`src/runner/dockerRunner.js` の最小実装、runtime 差し替え、hidden CLI wiring までは完了
- network off、stdout/stderr 制限、CPU / memory / process 制限の基本適用は Docker CLI 引数へ反映済み
- `AbortSignal` を受けて実行中 container command を停止できる契約までは反映済み
- ただし container image 管理、Docker 実機前提の停止確認を含む統合テスト、後始末まで含めた運用は未実施

### F. 真の並列 planner / orchestrator

- planner は `parallelism` に応じて複数 `workerTask` を返せるようになった
- orchestrator も worker ごとの `attempts` / `candidate` を集約できる形までは対応済み
- `first-pass-wins` の早期停止と、全体 `timeBudgetMs` による反復停止までは実装済み
- 実行中 worker へ停止を伝播する最小制御と、queue ベースの最小 worker pool までは実装済み
- ただし進捗監視の外部表示、より高度なスケジューリング、Docker 実機を前提にした stop/reap 運用は未実装

### G. selector の本格化

- `first-pass-wins` に加え、最小の `best-score-wins` までは追加済み
- ただし score モデルは暫定で、複数成功候補の高度な比較や選択理由の詳細化は未実装

### H. judge の強化

- `SimpleJudge` は単純な exit code / stderr / stdout / expected output 判定のみ
- worker 内一次判定と親側最終判定の分離は、構造上の入口だけで本格実装は未着手
- 比較戦略の切り替えや score 判定は未実装

### I. formatter と result model の将来拡張

- `selector`、`workers`、`strategy`、`sandbox` の基本表示までは追加済み
- 複数 candidate の簡易一覧表示も追加済み
- ただし詳細な score 内訳や selector 判断根拠の完全表示は未整備

### J. docs に対応する実機能

- docs にある Docker worker pool、SubAgent 局所探索、`check` / `replay`、corpus / replay 活用は未実装
- 現時点の docs は理想像として維持しつつ、README / AGENTS で現在地を明示する運用のまま

## Recommended Next Steps

次のエージェントには、次の順で進めることを推奨します。

1. selector / judge / formatter の score モデルと表示を複数候補前提で強化する
2. policy file の配置規約と schema 説明を docs にまとめる
3. Docker 実機を使った統合テストと image 運用方針を整備する
4. orchestrator の進捗監視を外部表示できる形へ拡張する
5. `check` / `replay` を見据えた CLI 配置へ再編する

## Summary

`docs/` と `AGENTS.md` は「複数 SubAgent を Docker 内で並列実行し、親が planner / selector / judge / logs を分離して監督する構成」を前提にしています。現状実装も、`src/core/solve.js` を薄い入口にしつつ `solveSession -> planner -> orchestrator -> selector -> logs` へ責務分離し、複数 worker candidate、最小 selector、早期停止、全体タイムボックス、Docker runner の骨格までは取り込まれています。

残る差分は、主に Docker 実運用、高度な judge / selector / score モデル、進捗可視化、`check` / `replay` といった運用・高度化領域です。provider 層については、外部 CLI 依存の薄いラッパーから一歩進み、`OpenAI API` と `openai` ライブラリを前提にした標準 engine までは導入できています。一方で prompt の本格化、worker ごとの model override、provider 抽象化の一般化までは未着手です。つまり現在は「単一ループ MVP」からは脱し、理想構成へ寄せる骨格実装と最小 provider 実装までは進んでいるが、監督機能・判定機能・運用機能の本実装がまだ残っている段階と捉えるのが正確です。

## Key Changes

### 1. まず docs と README の前提をそろえる

- Status: 完了
- `README.md` に「現状」と「docs の理想像」の境界を明示し、現行 CLI が単一 worker・`LocalRunner` 前提であることをはっきり書く
- `docs/ideal-architecture.md` と `docs/ideal-cli-flow.md` に、理想像へ至る移行段階を追記する
- `AGENTS.md` の「現在の主要コンポーネント」と「近い将来の優先項目」を、今の実装に即した言い回しへそろえる
- 目的は docs の修正ではなく、以後の実装が「理想 docs を読みつつ現状構成も見失わない」状態を作ること

### 2. `core/solve.js` の責務を分割できる形へ再編する

- Status: 完了
- `src/core/solve.js` から `problem parse`、session 初期化、attempt ループ、finalize/logging を分離する
- 新しい `core` の最小単位として、`solveSession`、`orchestrator`、`selector` 相当の入口を先に作る
- 単一 worker 互換を維持しつつ、複数 worker を扱える interface と candidate 集約へ更新する
- `Engine` は引き続き「候補生成のみ」を担わせ、実行責務は `runner` 側に残す
- `finalCheck` と `attempts` の構造を、将来の worker 単位結果を包める形へ広げる

### 3. `problem` / `safety` / `logs` を `runner` と `core` から分離する

- Status: 一部完了
- `parseProblemInput` を `util/fs.js` から独立した `problem` 層へ移し、将来の frontmatter / YAML / expected output 拡張の入口にする
- `src/runner/safety.js` を独立した `src/safety/` へ移し、command policy と sandbox policy を別概念として分ける
- deny-list 判定は維持しつつ、`policy file` を読み込める最小 loader までは実装済み
- ただし policy schema の公開、サンプル整備、複雑な運用フローは未実施
- `logs/` への JSON 出力は `src/logs/` に分離し、session ログと attempt ログの責務を明確にする
- `logPath` は単なる文字列返却ではなく、session metadata の一部として扱う

### 4. CLI 契約を将来の planner / selector / Docker 導入に備えて整理する

- Status: 一部完了
- `src/cli.js` で engine / runner / judge を直接 new する形をやめ、`core` にセッション設定を渡す薄い CLI に寄せる
- `src/cliOptions.js` は現行オプションを維持しつつ、将来追加予定の `mode`、`parallelism`、`selector`、`time-budget`、policy path 群を hidden option と内部 schema で受けられる形へ整理済み
- すぐ実装しないオプションは公開しないが、内部型と parse / validation は拡張前提に更新済み
- サブコマンドは当面 `solve` のままでよいが、`check` / `replay` を追加できる構造に CLI ファイル配置を寄せる

### 5. Docker Runner と並列 SubAgent 導入の前提を作る

- Status: 完了
- `LocalRunner` を残しつつ、`Runner` interface を Docker 制限値、stdout/stderr 制限、network off などを表現できる形に広げる
- `runner` 配下に `dockerRunner` の最小実装を追加し、`runtime` から `local` / `docker` を差し替え可能にする
- planner は最初は固定 plan を返すだけでよく、`workerTask[]` を返す contract を先に固める
- selector は `first-pass-wins` と最小の `best-score-wins` までは導入済み
- orchestrator には `first-pass-wins` の早期停止と全体 `timeBudgetMs` による反復停止、および実行中 worker への停止伝播を導入済み
- hidden CLI / runtime / テストまで含めて「導入の前提」は整ったため、この項目は完了とする
- ただし Docker 本体や実行中 worker 制御を含む並列 worker 実装の完成はこれから

### 6. judge と結果モデルを worker 時代に耐える形へ更新する

- Status: 一部完了
- `SimpleJudge` を「単一試行の基本判定」と位置づけ、最終採用判定は別責務に分ける
- `JudgeInput` / `JudgeDecision` は expected output や比較戦略を受けられる形へ整理する
- `SolveResult` は単一 command 表示だけでなく、選ばれた候補・候補一覧・selector 理由を表現できる形にする
- formatter は現行の `COMMAND / OUTPUT / EXPLANATION / CHECK` を維持しつつ、`selector`、`workers`、`sandbox`、`stopReason`、candidate 一覧を追加できる出力モデルへ更新済み

### 7. model provider を OpenAI API ベースへ寄せる

- Status: 一部完了
- `src/engines/openaiEngine.js` を追加し、ShellGeiAI 自身が `OpenAI API` を直接呼ぶ標準 engine を導入済み
- `src/core/runtime.js` は `openai` を標準解決し、`src/cliOptions.js` / `README.md` / エラーメッセージ / テストも `OpenAI API` 前提へ更新済み
- `mock` engine はテスト用と最小動作確認用として維持している
- ただし prompt の高度化、worker ごとの model override、provider 抽象化の一般化、旧 `codex` / `cursor` 実装ファイルの完全撤去は未実施

## Test Plan

### 実施済み

- 既存テストの回帰確認
- 単一 worker solve フローの統合テスト追加
- `first-pass-wins` の早期停止と全体 `timeBudgetMs` の統合テスト追加
- `first-pass-wins` 時の実行中 worker 中断と `stopReason` の統合テスト追加
- plain text problem parser の単体テスト追加
- session ログ shape の確認
- selector の最小単体テスト追加
- `LocalRunner` の result shape / stdout limit テスト追加
- `LocalRunner` の `AbortSignal` 中断テスト追加
- Docker 引数組み立ての単体テスト追加
- policy loader の invalid regex テスト追加
- hidden future-facing CLI option の validation テスト追加
- `runtime` の local/docker 切替と `workerTask[]` contract の単体テスト追加
- `OpenAIEngine` の JSON 応答解釈と API key 未設定時エラーの単体テスト追加

### 未実施

- 複数候補 selector の詳細テスト
- policy loader の schema 異常系テスト
- 将来の expected output 拡張を含む parser / safety テスト
- `OpenAIEngine` の prompt 戦略差分や retry 挙動の詳細テスト

## Assumptions

- 直近の目的は「理想 docs に追いつくための土台作り」であり、今回の計画には Docker 実装完了や真の並列実行完成までは含めない
- 既存の `mock` engine はテストや最小動作確認のため当面維持してよい
- `OpenAI API` engine は標準経路として採用し、旧 `codex` / `cursor` engine は互換維持よりも段階的廃止を優先する
- `dist/` は現状の互換物として扱い、主な修正対象は `src/` とドキュメントに置く
- テストディレクトリ名は現状の `test/` を前提とし、理想 docs にある `tests/` への改名は後回しでよい
- 実装順は `docs/README 整理 -> core 分割 -> problem/safety/logs 分離 -> CLI/型整理 -> runner/planner/selector の骨格追加 -> judge/selector/運用機能の本格化` を推奨する
