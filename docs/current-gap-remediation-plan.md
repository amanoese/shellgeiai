# ShellGeiAI docs/ と現状実装の乖離を埋める修正計画

## Status

2026-06-11 時点で、この計画は「土台作り」の段階を概ね完了しています。`src/` はすでに単純な単一ファイル solve から分離され、`solveSession -> planner -> orchestrator -> selector -> logs` の流れで責務を分けた最小構成へ移行済みです。加えて、`OpenAI API` を直接呼ぶ標準 engine、`DockerRunner` の最小骨格、複数 worker 前提の planner / orchestrator / selector、judge / selector / formatter における最小 score モデル、`stopReason` や candidate 情報を含む結果・ログモデルも導入されています。

一方で、まだ未完了なのは「実運用を支える層」です。具体的には、Docker 実機を前提にした統合テストと image 運用、進捗監視の外部表示、judge / selector の score 高度化、policy schema の説明、`check` / `replay` のような運用系 CLI は未実施です。つまり現在地は「理想構成へ寄せる基盤実装は入ったが、監督機能と運用機能の本実装はまだこれから」という整理が正確です。

## Current Snapshot

### 完了済みの大きな流れ

- docs / README / AGENTS の前提合わせ
- `core` の責務分離と薄い solve 入口への再編
- `problem` / `safety` / `logs` の分離
- hidden option を含む将来拡張向け CLI schema 整理
- `LocalRunner` / `DockerRunner` を差し替えられる runtime 構成
- 複数 worker を前提にした planner / orchestrator / selector の最小実装
- `first-pass-wins` の早期停止、全体 `timeBudgetMs`、実行中 worker 停止伝播
- `OpenAI API` 直接呼び出しの標準 engine 追加
- judge / selector / formatter での最小 score モデル導入
- README と formatter の score 表示整備、およびその回帰テスト追加

### まだ残っている大きな流れ

- Docker 実機前提の統合テストと container 運用
- policy schema / 運用ルールの文書化
- 進捗監視の外部表示
- judge / selector の比較ロジック高度化
- `check` / `replay` を見据えた CLI 再編

## Completed

### 1. docs と README の前提合わせ

- `README.md` に「現状の実装」と `docs/` の理想像の境界を追記済み
- `docs/ideal-architecture.md` と `docs/ideal-cli-flow.md` に、現状との差分と移行段階を追記済み
- `AGENTS.md` の主要コンポーネント説明と優先項目を現在のコード構成に合わせて更新済み
- README の出力例を、`selector`、`selected-score`、`score-breakdown`、`selector-metrics` を含む現在の formatter 出力へ更新済み

### 2. `core/solve.js` の責務分離

- `src/core/solve.js` を薄い入口に整理済み
- `src/core/solveSession.js` を追加し、problem parse・workdir・logsDir・plan 初期化を分離済み
- `src/core/orchestrator.js` を追加し、worker ごとの attempt ループと candidate 集約を分離済み
- `src/core/selector.js` を追加し、`first-pass-wins` と最小の `best-score-wins` を実装済み
- `attempts` と `finalCheck` を worker / candidate を包める形へ拡張済み
- `timeBudgetMs` から session deadline を計算し、orchestrator / runner で共有できる形へ更新済み

### 3. `problem` / `safety` / `logs` の分離

- `parseProblemInput` を `src/problem/parseProblem.js` へ移設済み
- safety を `src/safety/checker.js`、`src/safety/commandPolicy.js`、`src/safety/sandboxPolicy.js` に分離済み
- `src/safety/policyLoader.js` を追加し、`command policy` / `sandbox policy` を外部 JSON から読み込める最小 loader を実装済み
- 互換のため `src/runner/safety.js` は re-export の薄い層として維持済み
- JSON ログ出力を `src/logs/writer.js` に分離済み
- session ログに `problem`、`attempts`、`candidates`、`selectedCandidateId`、`stopReason`、`startedAt`、`finishedAt`、`workdir`、`planner`、`runner limits` を含める形へ更新済み

### 4. CLI 契約と runtime の薄型化

- `src/cli.js` で engine / runner / judge を直接 `new` せず、`src/core/runtime.js` 経由で解決する形へ変更済み
- `SolveProblemOptions` に `mode`、`parallelism`、`selector`、`timeBudgetMs`、`runnerLimits`、`commandPolicy`、`sandboxPolicy` を保持できる余地を追加済み
- `src/cliOptions.js` は hidden option を含む内部 schema を整理し、`mode`、`parallelism`、`selector`、`time-budget`、`command-policy`、`sandbox-policy` を runtime wiring 用に受け取れる状態へ更新済み
- hidden option の validation は現実装に合わせて絞り込み、`mode` は `single` / `parallel`、`selector` は `first-pass-wins` / `best-score-wins` のみを受ける形へ固定済み
- 公開 help に出す CLI オプションはまだ現状維持

### 5. Runner / planner / selector の骨格追加

- `src/runner/Runner.js` に limits / sandbox policy / duration を表現できる型を追加済み
- `src/runner/localRunner.js` を新しい options / result shape に対応済み
- `src/runner/limits.js` を追加済み
- `src/runner/dockerRunner.js` の最小実装を追加済み
- `src/core/planner.js` を追加し、固定の `workerTask[]` を返す最小 contract を定義済み
- `src/core/orchestrator.js` に `first-pass-wins` の早期停止、全体 `timeBudgetMs` による停止、queue ベースの最小 worker pool、実行中 worker への停止伝播を追加済み
- `src/runner/localRunner.js` と `src/runner/dockerRunner.js` を `AbortSignal` に対応させ、実行中 command を中断できるよう更新済み
- `SolveResult` に実行時 `plan` を含め、worker 配置 contract をログ以外からも確認できるよう更新済み

### 6. judge・selector・result model の最小更新

- `SimpleJudge` は単一試行の基本判定として維持しつつ、最小の `score` を返す形へ更新済み
- `JudgeInput` は `expectedOutput` を受けられる形を維持
- `JudgeDecision` は `passed` / `reason` に加えて `score` と `breakdown` を返せる形へ更新済み
- orchestrator は attempt / candidate / finalCheck に judge score を伝播できるよう更新済み
- `SolveResult` に `candidates`、`selector`、`runner`、`plan`、`stopReason` を追加済み
- selector は judge score に加えて `stdout` 安定性と候補間の出力一致度を補助指標として扱えるよう更新済み
- `best-score-wins` は judge score を最優先に、実行時間・反復回数・コマンド長・説明長を tie-break に使う最小ロジックまで実装済み

### 7. formatter とログ表示の拡張

- formatter に `selector`、`selector reason`、`workers`、`sandbox`、`stopReason`、candidate 一覧表示を追加済み
- formatter は `selected-score`、`score-breakdown`、`selector-metrics`、candidate ごとの score を表示できるよう更新済み
- session ログには candidate / score / selector / stopReason を含める形を固定済み

### 8. engine 実装の OpenAI API 化

- `src/engines/openaiEngine.js` を追加し、prompt 構築・JSON 応答解釈・timeout / retry / model / base URL 設定の最小責務をこの層へ集約済み
- `src/core/runtime.js` は `openai` を標準 engine として解決し、`src/cliOptions.js` の `--engine` 契約も `openai` / `mock` へ整理済み
- `OPENAI_API_KEY` 未設定時の説明的エラーと、`OPENAI_MODEL` / `OPENAI_TIMEOUT_MS` / `OPENAI_MAX_RETRIES` / `OPENAI_BASE_URL` の最小設定経路を追加済み
- `package.json` は `openai` 依存を持つ前提へ更新済み
- API client は差し替え可能にし、実ネットワークに依存しない engine 単体テストを追加済み

### 9. テスト追加と固定化

- `test/problemParser.test.js` で plain text parser の互換性を確認済み
- `test/safety.test.js` で external policy loader と invalid regex の回帰を追加済み
- `test/runner.test.js` で `LocalRunner` の共通 result shape、byte limit、Docker 引数組み立て、`AbortSignal` 中断を確認済み
- `test/runtimePlanner.test.js` で `runtime` の local/docker 切替と `workerTask[]` contract を固定済み
- `test/selector.test.js` で selector の最小挙動、`best-score-wins` の選択理由、stdout 安定性、候補間出力一致度を回帰確認済み
- `test/simpleJudge.test.js` と `test/solveFlow.test.js` で judge score / selector score の伝播を回帰確認済み
- `test/solveFlow.test.js` で単一 worker solve フロー、`first-pass-wins`、`timeBudgetMs`、実行中 worker 中断、`stopReason`、`SolveResult.plan`、selector metrics を回帰確認済み
- `test/openaiEngine.test.js` で JSON 応答解釈と API key 未設定時エラーを回帰確認済み
- `test/formatResult.test.js` を追加し、score 表示と candidate 一覧表示を回帰確認済み
- `npm test` が通る状態まで確認済み

## Remaining Work

### A. CLI の公開契約整理

- Status: 一部完了
- 内部 schema と validation の整理は完了
- `mode`、`parallelism`、`selector`、`time-budget`、`command-policy`、`sandbox-policy` を正式な CLI 契約として help / README に出すかは未決定
- `check` / `replay` を追加できる CLI ファイル配置への再編は未実施

### B. policy loader の運用強化

- Status: 一部完了
- `policies/default-command-policy.json` と `policies/default-sandbox-policy.json` のサンプル追加までは完了
- command policy / sandbox policy の schema を docs や README から参照できる形にはしていない
- 複数 preset 運用や schema バリデーションの強化は未対応

### C. Docker Runner 本体の実運用化

- Status: 一部完了
- `dockerRunner` の最小実装、runtime 差し替え、hidden CLI wiring までは完了
- network off、stdout/stderr 制限、CPU / memory / process 制限の基本適用は Docker CLI 引数へ反映済み
- `AbortSignal` を受けて実行中 container command を停止できる契約までは反映済み
- ただし container image 管理、実機 Docker を使った統合テスト、停止後の cleanup / reap 運用は未実施

### D. 真の並列 planner / orchestrator

- Status: 一部完了
- planner は `parallelism` に応じて複数 `workerTask` を返せる
- orchestrator も worker ごとの `attempts` / `candidate` を集約できる
- `first-pass-wins` の早期停止、全体 `timeBudgetMs`、実行中 worker 停止伝播までは実装済み
- ただし進捗監視の外部表示、より高度なスケジューリング、Docker 実機前提の stop / reap 運用は未実装

### E. selector の本格化

- Status: 一部完了
- `best-score-wins` は judge score、stdout 安定性、候補間一致度、実行時間、反復回数、コマンド長、説明長を使う最小ロジックまで実装済み
- selector reason に採用候補の score 要約を含める形まで更新済み
- ただし score 重み付けは暫定で、再現性評価の外部化や比較根拠の強化は未実装

### F. judge の強化

- Status: 一部完了
- `SimpleJudge` は exit code / stderr / stdout / expected output 判定に加え、最小の score を返す形まで更新済み
- worker 内一次判定と親側最終判定の分離は、構造上の入口だけで本格実装は未着手
- 比較戦略の切り替え、複数ケース比較、親側再判定専用 judge は未実装

### G. formatter / result model の将来拡張

- Status: 一部完了
- score 表示と candidate 一覧の基本表示までは整備済み
- ただし worker ごとの詳細 score 内訳、再判定根拠、stdout 安定性の詳細表示は未整備

### H. docs に対応する実機能

- Status: 未着手
- docs にある Docker worker pool、SubAgent 局所探索、`check` / `replay`、corpus / replay 活用は未実装
- 現時点の docs は理想像として維持しつつ、README / AGENTS で現在地を明示する運用のまま

## Recommended Next Steps

次のエージェントには、次の順で進めることを推奨します。

1. policy file の配置規約と schema 説明を docs にまとめる
2. Docker 実機を使った統合テストと image 運用方針を整備する
3. orchestrator の進捗監視を外部表示できる形へ拡張する
4. judge / selector の score モデルを stdout 安定性や再現性まで含めて高度化する
5. `check` / `replay` を見据えた CLI 配置へ再編する

## Test Plan

### 実施済み

- 既存テストの回帰確認
- 単一 worker solve フローの統合テスト追加
- `first-pass-wins` の早期停止と全体 `timeBudgetMs` の統合テスト追加
- `first-pass-wins` 時の実行中 worker 中断と `stopReason` の統合テスト追加
- plain text problem parser の単体テスト追加
- session ログ shape の確認
- selector の最小単体テスト追加
- score を含む selector reason と result 伝播の回帰確認
- stdout 安定性と候補間出力一致度を使う selector tie-break の回帰確認
- `LocalRunner` の result shape / stdout limit テスト追加
- `LocalRunner` の `AbortSignal` 中断テスト追加
- Docker 引数組み立ての単体テスト追加
- policy loader の invalid regex テスト追加
- hidden future-facing CLI option の validation テスト追加
- `runtime` の local/docker 切替と `workerTask[]` contract の単体テスト追加
- `OpenAIEngine` の JSON 応答解釈と API key 未設定時エラーの単体テスト追加
- formatter の score / metrics / candidate 一覧表示の回帰テスト追加

### 未実施

- policy loader の schema 異常系テスト
- 将来の expected output 拡張を含む parser / safety テスト
- `OpenAIEngine` の prompt 戦略差分や retry 挙動の詳細テスト
- score モデルの重み付けや再現性評価の外部化を含む judge / selector の追加テスト
- Docker 実機前提の統合テスト

## Assumptions

- 直近の目的は「理想 docs に追いつくための土台作り」であり、この計画には Docker 実装完了や真の並列実行完成までは含めない
- `mock` engine はテストや最小動作確認のため当面維持してよい
- `OpenAI API` engine は標準経路として採用し、旧 `codex` / `cursor` engine は互換維持よりも段階的廃止を優先する
- `dist/` は現状の互換物として扱い、主な修正対象は `src/` とドキュメントに置く
- テストディレクトリ名は現状の `test/` を前提とし、理想 docs にある `tests/` への改名は後回しでよい
