# Next Refactor Proposal

このメモは、別セッションで作業を再開するための引き継ぎです。

## 現在の状態

`src/` の大きな構成整理は完了しています。

現在のトップレベル構成:

```text
src/
  cli/
  execution/
  io/
  providers/
  shared/
  solve/
```

直近の主なコミット:

```text
b80b164 docs: refresh development path references
a43456d docs: remove stale core hierarchy references
6a3b694 docs: update src hierarchy references
2e9f324 refactor: move solve flow modules
ea5bc33 refactor: move solve session modules
0a1bce2 refactor: group io and shared modules
5ad71be refactor: group provider modules
e2c7a11 refactor: group execution infrastructure
f73aef3 refactor: clarify src execution boundaries
```

確認済み:

- working tree は clean
- 旧 `src/core`, `src/worker`, `src/runner`, `src/safety`, `src/judge`, `src/engines`, `src/planner`, `src/logs`, `src/formatter`, `src/problem`, `src/util` は撤去済み
- 通常 docs / 現行コード / tests に旧 `src/...` path 参照なし
- `rtk npm test` は通過済み

## 次回のおすすめ作業

次にやるなら、コード移動ではなく **solve/check/replay の共通初期化整理** が最も効果的です。

現状、以下の処理が `solve`, `check`, `replay` 周辺で重複気味です。

- workdir 解決
- logs directory 作成
- command policy / sandbox policy 読み込み
- runner limits 設定
- deadline / time budget 扱い
- writable workdir 設定
- session log に残す共通 metadata

## 提案する次回テーマ

### Theme: command session setup の共通化

目的:

- `src/solve/check.js` と `src/solve/replay.js` の見通しを良くする
- `src/solve/session/solveSession.js` と重複する初期化概念を整理する
- ただし solve 固有の planner / selector / worker orchestration は隠さない

想定ファイル:

```text
src/solve/session/
  commandSession.js      # 新規
  solveSession.js        # 必要なら軽く整理

src/solve/
  check.js
  replay.js
```

`commandSession.js` の責務案:

```js
export async function createCommandSession(options) {
  // workdir, logsDir, policies, runnerLimits, deadlineAtMs など
}
```

含めてよいもの:

- `startedAt`
- `sessionId`
- `workdir`
- `logsDir`
- `commandPolicy`
- `sandboxPolicy`
- `runnerLimits`
- `writableWorkdir`
- `timeBudgetMs`
- `deadlineAtMs`

含めないもの:

- planner
- selector
- workerTasks
- solve candidate selection
- solve progress phase の詳細

## 進め方

1. `src/solve/check.js` と `src/solve/replay.js` を読み、重複している初期化処理だけをリスト化する
2. `createCommandSession` の最小 API を決める
3. 先に `check` の既存テストを守る regression test を追加する
4. `check` だけを `createCommandSession` に寄せる
5. `replay` を同じ helper に寄せる
6. full test を実行する

## 注意点

- 今回の階層整理は完了しているので、次回は大きなディレクトリ移動をしない
- `solveSession.js` を無理に共通化しすぎない
- `check/replay` のログ形式を変えない
- CLI の parse result shape と error message を変えない
- Docker runner / safety policy の挙動を変えない

## 開始時の確認コマンド

```bash
rtk proxy git status --short --untracked-files=all
rtk find src -maxdepth 2 -type d
rtk npm test
```

期待:

```text
working tree clean
src top-level: cli / execution / io / providers / shared / solve
tests pass
```

## 次回セッションへの依頼文例

```text
docs/next-refactor-proposal.md を読んでください。
次は command session setup の共通化を進めたいです。
まず src/solve/check.js と src/solve/replay.js の重複を確認し、設計案を出してください。
```
