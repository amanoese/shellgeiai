# ShellGeiAI 現在ギャップの整理と実装優先計画

## このファイルの役割

このファイルは、理想像そのものを説明する設計書ではなく、そこへ到達するまでの未完了事項を整理するための運用計画です。
完了済みの履歴はここに溜めず、いま残っているギャップだけを優先順位つきで管理します。

- 理想フローの参照先: `docs/ideal-cli-flow.md`
- 理想アーキテクチャの参照先: `docs/ideal-architecture.md`
- このファイルで扱うもの: 直近で詰めるべき実装テーマ、依存関係、着手の順番、完了条件

## 現在地

2026-06-12 時点では、理想構成へ向かうための土台はおおむね揃っています。
いまは「新しい責務分離を保ったまま、実運用に耐える基盤へ育てる」段階として扱います。

- `core / problem / safety / logs` の責務分離は済んでいる
- `openai` engine、通常経路化した `DockerRunner`、planner / orchestrator / selector / judge / formatter の基本経路はある
- `solve`、`check`、`replay`、`logs show` の最小 CLI はある
- 回帰テストの土台はあり、次の主戦場は運用強化と実用機能の追加である

## 進め方の要約

いま優先すべきことは、理想 docs にある要素を広く増やすことより、実行基盤と観測性を先に固めることです。
特に `DockerRunner`、並列 orchestrator、judge / selector は依存が強いため、順番は分けつつも切り離しすぎずに進めます。

### タスク粒度の基準

このファイルでは、1 タスクを「半日から 1 日で進捗が見える単位」として扱います。
コード変更、テスト追加、CLI 露出、ログ項目追加をできるだけ分け、レビュー時に差分の意図が追いやすい粒度を保ちます。

### 優先ロードマップ

| 優先度 | テーマ | 今やる理由 | 主な依存 |
| --- | --- | --- | --- |
| 1 | Docker Runner の実運用化 | 安全な実行基盤を通常経路にしたい | なし |
| 2 | 並列 orchestrator の運用強化 | 複数 worker 運用の安定性と観測性が必要 | 1 と強く連動 |
| 3 | judge / selector の高度化 | 候補比較の再現性と説明可能性を上げたい | 1, 2 のログ品質 |
| 4 | `check` / `replay` / logs の運用機能 | 試行結果を調査・再利用できるようにしたい | 1, 2, 3 の成果活用 |
| 5 | SubAgent / worker pool への移行 | 理想構成へ寄せる本体作業に入りたい | 1 から 4 の基盤安定化 |

### 優先順の考え方

1. まず Docker 実行を通常運用の前提に近づける
2. 次に複数 worker を走らせたときの停止制御と観測性を整える
3. そのうえで候補比較の質を上げる
4. 蓄積したログを再利用する運用導線を整える
5. 最後に SubAgent 主体の理想構成へ本格移行する

## テーマ別の整理

### 1. Docker Runner の実運用化

**目的**

安全な実行基盤を `LocalRunner` 依存から `DockerRunner` 主体へ寄せ、`solve` / `check` / `replay` の通常経路として扱える状態にする。

**現状のギャップ**

- 最小の Docker 経路はあるが、停止・掃除・異常終了時の扱いが運用前提ではまだ弱い
- 実行制限や失敗理由の追跡が、運用中の調査に十分とは言い切れない
- Docker image の既定値と override 手順が、実装と運用の両面でまだ整理し切れていない

**直近に詰めること**

- 実行中 container の stop / cleanup / reap を安定化する
- worker 異常終了時の後始末とログ記録を明確にする
- default image を `theoldmoon0602/shellgeibot` 前提で整理し、override 方法と運用手順を揃える
- Docker 実機前提のテストを増やす

**完了条件**

- timeout や途中停止があっても container が取り残されない
- 適用した制限値と失敗理由をログから追える
- `solve` / `check` / `replay` で Docker 経路を通常運用として説明できる

**タスク分解**

- [x] `docker run` の引数生成と制限値適用をテストで固定する。対象: `src/runner/dockerRunner.js`, `test/dockerIntegration.test.js`
- [x] timeout / abort 時の child process 終了と `close` 待ちの流れを明示し、戻り値の `timedOut` / `aborted` を安定化する。対象: `src/runner/dockerRunner.js`, `test/runner.test.js`
- [x] 異常終了時に container cleanup 失敗や docker CLI エラーを識別できるよう、エラーメッセージとログ項目を整理する。対象: `src/runner/dockerRunner.js`, `src/logs/writer.js`, `test/checkReplay.test.js`
- [x] Docker image の既定値、override 方法、利用時の前提を CLI / README / plan で説明できるようにする。対象: `src/runner/dockerRunner.js`, `README.md`, `docs/README.md`
- [x] `solve` / `check` / `replay` の Docker 実機テストを不足ケース込みで増やす。対象: `test/dockerIntegration.test.js`, `test/checkReplay.test.js`, `test/solveFlow.test.js`

### 2. 並列 orchestrator の運用強化

**目的**

現状の最小並列骨格を、複数 worker を安定運用できる orchestration に育てる。

**現状のギャップ**

- 並列度を上げたときの progress 表示と停止理由の見え方がまだ弱い
- worker pool の配り方と停止伝播が、Docker 実行を前提にすると詰め切れていない
- 一部 worker が失敗したときの session 全体の観測性が足りない

**直近に詰めること**

- progress event の集約表示を整える
- worker pool のスケジューリングを改善する
- Docker 実行時の停止伝播をより確実にする
- 失敗 worker を含む session 全体の観測性を上げる

**完了条件**

- 並列度を上げても進行状況と停止理由が追いやすい
- `first-pass-wins` と完走待ちの両方で挙動が読みやすい
- Docker 側の終了処理と親側の進行管理が食い違いにくい

**タスク分解**

- [x] worker 状態を `planning / running / judging / stopped` のように揃えて progress event に反映する。対象: `src/core/orchestrator.js`, `src/core/progress.js`, `test/progressReporter.test.js`
- [x] `session-started` / `worker-started` / `attempt-finished` / `session-finished` の集約表示を見直し、失敗 worker 数や停止理由を出せるようにする。対象: `src/formatter/progressReporter.js`, `test/progressReporter.test.js`
- [x] queue 消費と並列度計算を整理し、worker pool のスケジューリング方針をコード上で読みやすくする。対象: `src/core/orchestrator.js`, `test/solveFlow.test.js`
- [x] `first-pass-wins` で停止指示を出したときに、他 worker へ abort が確実に伝播することをテストで固定する。対象: `src/core/orchestrator.js`, `test/solveFlow.test.js`, `test/dockerIntegration.test.js`
- [x] session 全体の stop reason と worker ごとの終了理由をログへ残す形を揃える。対象: `src/core/orchestrator.js`, `src/logs/writer.js`, `test/logWriter.test.js`

### 3. judge / selector の高度化

**目的**

最小 score モデルから、再現性と比較根拠を持った選択へ進める。

**現状のギャップ**

- score の重み付けがまだ実験的で、なぜその候補が勝ったかを説明しづらい
- stdout の安定性や再現性を比較ロジックに十分入れ込めていない
- worker 側の一次判定と親側の最終判定の役割分担が、今後の拡張を見据えると薄い

**直近に詰めること**

- score 重み付けの整理
- stdout 安定性の評価強化
- 候補間比較の説明可能性向上
- 必要に応じた親側の再判定強化

**完了条件**

- なぜその候補を選んだかを結果とログから説明できる
- `best-score-wins` が単なる tie-break ではなく実用比較として機能する
- worker の自己申告だけに依存しない最終判定が成立する

**タスク分解**

- [x] 既存 score の内訳を棚卸しし、`judgeScore / stdoutConsistency / outputConsensus / duration` の優先順をコメントとテストで固定する。対象: `src/core/selector.js`, `test/selector.test.js`
- [x] attempt ごとの stdout 変動を final candidate 判定にどう効かせるかを整理し、安定性評価のケースを追加する。対象: `src/core/selector.js`, `test/selector.test.js`
- [x] selector reason を人が読める比較説明へ寄せ、どの要素で勝ったかが分かる文面にする。対象: `src/core/selector.js`, `src/formatter/formatResult.js`, `test/formatResult.test.js`
- [x] 親側の再判定が必要な条件を定義し、`finalCheck` で worker 自己申告を上書きできる余地を整理する。対象: `src/core/solve.js`, `src/judge/Judge.js`, `src/judge/simpleJudge.js`
- [x] selector のログ出力に score breakdown と比較メトリクスを残す。対象: `src/logs/writer.js`, `test/logWriter.test.js`, `test/selector.test.js`

### 4. `check` / `replay` / logs 周辺の運用機能

**目的**

試行ログを調査・再利用できる運用経路を整え、改善サイクルを回しやすくする。

**現状のギャップ**

- `replay` のメタデータ活用がまだ限定的で、比較や再調査の入口が弱い
- ログ一覧、検索、保持期間管理などの運用コマンドが不足している
- corpus 連携や policy 検証の入口がまだ曖昧である

**直近に詰めること**

- replay メタデータの活用を広げる
- ログ一覧 / 検索 / 保持期間 pruning の CLI を公開する
- `policy test` のような運用補助コマンドを検討する
- corpus 連携の入口を整理する

**完了条件**

- 保存ログから再実行・比較・調査がしやすい
- 実験結果を corpus や将来の改善へつなげられる
- 運用者が失敗例を資産として扱いやすい

**タスク分解**

- [x] replay log から `candidateId` / `attemptId` / source metadata を確実に引き回せるようにし、再実行対象の選択理由を明示する。対象: `src/core/replay.js`, `test/checkReplay.test.js`
- [x] ログ一覧と検索の出力項目を整理し、mode・pass/fail・problem・command で調べやすくする。対象: `src/core/logCatalog.js`, `src/core/logsShow.js`, `test/logCatalog.test.js`, `test/logsShow.test.js`
- [x] 保持期間 pruning を CLI から使えるようにし、dry-run を含めた運用テストを追加する。対象: `src/core/logCatalog.js`, `src/cli/index.js`, `src/cli/commands/logsPrune.js`, `test/logCatalog.test.js`
- [x] `policy test` 相当の補助導線を既存 `check` に寄せ、運用時に使い方が追えるようにする。対象候補: `src/cli/index.js`, `src/cli/commands/check.js`, `src/safety/checker.js`, `README.md`, `test/cliOptions.test.js`
- [x] corpus 連携で再利用したい最小メタデータを決め、現在の log schema に不足があれば追加する。対象: `src/logs/writer.js`, `src/core/replay.js`, `src/core/logCatalog.js`, `docs/ideal-cli-flow.md`

### 5. SubAgent / worker pool への移行

**目的**

理想 docs にある「複数の軽量 SubAgent が Docker 内で局所探索する」構成へ、本体として近づける。

**現状のギャップ**

- worker ごとの strategy 差分がまだ弱く、局所探索の役割分担が薄い
- SubAgent の短い retry ループ設計が具体化し切れていない
- worker pool、agent、provider 依存の責務境界がまだ移行途中である

**直近に詰めること**

- worker ごとの strategy をより明示的にする
- SubAgent の局所 retry ループ設計を固める
- worker pool と agent 実装の責務境界を定義する
- model provider 依存を agent 層へ閉じ込める

**完了条件**

- 親 orchestrator と worker 内探索の責務が明確である
- strategy 差分を持つ複数 worker を自然に追加できる
- provider 差し替えが `core` の実装詳細に漏れにくい

**タスク分解**

- [x] planner が worker ごとに異なる strategy を明示的に配れるよう、`workerTasks` の設計を見直す。対象: `src/core/planner.js`, `src/core/types.js`, `test/runtimePlanner.test.js`
- [x] engine prompt に strategy と過去試行の扱いを明確に渡し、局所 retry ループの前提を固める。対象: `src/engines/openaiEngine.js`, `test/openaiEngine.test.js`
- [x] SubAgent 化の前段として、worker 内ループの責務を `generate -> run -> judge -> retry` の単位で切り出せる形に寄せる。対象: `src/core/orchestrator.js`, `src/core/workerTaskExecutor.js`, `src/core/solve.js`
- [x] provider 依存設定を `engine` 側へ寄せ、`core` がモデル名や API 都合を直接知らなくても済む境界を作る。対象: `src/engines/openaiEngine.js`, `src/engines/Engine.js`, `src/core/runtime.js`
- [x] 将来の `src/agents/` / `workerPool` 追加に備えて、移行時に残す責務と置き換える責務を docs に明記する。対象: `docs/ideal-architecture.md`, `docs/ideal-cli-flow.md`, `plan/archive/2026-06-12-current-gap-remediation-plan.md`

## 依存関係の見取り図

- 1 と 2 は相互依存が強い
- 3 は 1 と 2 の観測性が上がるほど進めやすい
- 4 は 1 から 3 で整ったログと判定情報を運用に開く段階である
- 5 は 1 から 4 の基盤が安定してから本格化する

言い換えると、いま先に解くべき問題は「どう探索するか」より「どう安全に走らせ、どう観測し、どう比較するか」です。

## 進行中に守る判断原則

- 安全性を速度より優先する
- Docker 制限を緩める変更は慎重に扱う
- 親は監督者、worker は局所探索担当という責務分離を維持する
- ログと再現性を壊さない
- model provider 依存を `core` に漏らしすぎない
- 小さく進め、各段階でテストを先に固定する

## この計画書の更新ルール

- 完了済みの詳細な履歴はここに残しすぎない
- 優先順位が変わったら、まずロードマップ表と依存関係を更新する
- 各テーマには「目的」「現状のギャップ」「直近に詰めること」「完了条件」を揃える
- 理想像の説明が増えすぎたら `docs/` 側へ移す

## 関連ドキュメント

- [docs/ideal-cli-flow.md](/home/amanoese/repos/shellgeiai/docs/ideal-cli-flow.md)
- [docs/ideal-architecture.md](/home/amanoese/repos/shellgeiai/docs/ideal-architecture.md)
- [docs/policies.md](/home/amanoese/repos/shellgeiai/docs/policies.md)
- [plan/README.md](/home/amanoese/repos/shellgeiai/plan/README.md)
- [AGENTS.md](/home/amanoese/repos/shellgeiai/AGENTS.md)
