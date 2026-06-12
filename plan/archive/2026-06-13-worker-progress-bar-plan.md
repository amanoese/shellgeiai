# Worker Progress Bar Plan

## Summary

- `--progress bar` を新設し、既存の `off` / `plain` / `jsonl` は互換維持する
- 進捗表示は `stderr` 上の一時描画に限定し、完了時に消せる UI にする
- v1 は worker 完了率ベースの集約バー 1 本 + worker 状態の短い補足表示を採用する

## Recommended Library

- 第一候補は `log-update`
- 理由:
  - 一時的な CLI 表示を再描画しやすい
  - 完了後に表示を消す要件に合う
  - `stderr` への描画を扱いやすい
  - `Ink` ほど重くなく、`ora` より今回の要件に合う
- 不採用方針:
  - `Ink`: 依存と実装重量が大きい
  - `ora`: spinner 向きで、集約バーと複数 worker の状態表示にはやや弱い
  - `cli-progress`: 数値進捗バーには強いが、今回の event 駆動 UI には少し硬い

## Implementation Plan

### 1. CLI option を拡張する

- `src/cliOptions.js` の `supportedProgressModes` に `bar` を追加する
- バリデーションエラーメッセージを `off, plain, jsonl, or bar` に更新する
- `src/core/types.js` の progress 型定義にも `bar` を追加する

### 2. progress reporter を mode 別 renderer に拡張する

- `src/formatter/progressReporter.js` を拡張し、`plain` / `jsonl` / `bar` を切り替える
- `bar` モードは内部に session snapshot を持ち、既存 progress event を集約して表示状態を作る
- snapshot で持つ主な情報:
  - 総 worker 数
  - 完了 worker 数
  - worker ごとの state
  - worker ごとの current iteration
  - passed / failed / stopped 件数
  - stop reason
  - selected candidate

### 3. bar 表示の見た目を定義する

- 上段に全 worker の集約バー 1 本を表示する
- 下段に active worker 中心の短い状態行を表示する
- 表示内容の例:
  - `Workers [####----] 2/4 done | running:1 planning:1 passed:1 failed:0`
  - `worker-2 running attempt 2`
  - `worker-4 planning`
- v1 では ETA は出さない
- v1 の進捗率は `completedWorkers / totalWorkers` のみを使う

### 4. TTY / non-TTY の扱いを決める

- `bar` は TTY 前提にする
- `process.stderr.isTTY !== true` の場合は自動で `plain` にフォールバックする
- `jsonl` は現状どおり機械連携用に維持する
- `plain` も現状どおり行単位出力を維持する

### 5. cleanup を solve command 側で保証する

- `src/cli/commands/solve.js` で reporter を `try/finally` 管理に変える
- 正常終了・失敗終了・例外のどれでも bar の一時表示を消す
- 最終結果の `stdout` 出力と進捗表示が混ざらないようにする

### 6. event 契約は v1 では維持する

- `src/core/orchestrator.js` と `src/core/progress.js` の既存 event 契約は原則変えない
- `session-started` / `worker-state` / `attempt-started` / `attempt-finished` / `worker-finished` / `session-finished` から描画状態を導出する
- v1 では新しい progress event を追加しない

## Testing

- `test/cliOptions.test.js`
  - `--progress bar` を受理すること
  - 不正値エラーが更新されること
- `test/progressReporter.test.js`
  - `bar` モードで再描画文字列を組み立てられること
  - 完了時に clear / cleanup が呼ばれること
  - non-TTY で `plain` へフォールバックすること
  - 既存の `plain` / `jsonl` の挙動を壊さないこと
- `test/solveFlow.test.js`
  - 既存 progress event で bar renderer が最後まで追従できること
  - `first-pass-wins` の早期停止でも表示が消えること
  - 例外時や失敗時にも中途半端な表示が残らないこと

## Assumptions

- 完了後に消える進捗表示は `solve` コマンドだけを対象にする
- v1 は「見やすい進捗把握」を優先し、worker 内部の詳細ステップまではバー化しない
- 将来必要なら、attempt 数や経過時間を使った詳細メトリクス表示を別段階で追加する
