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

確認済み:

- 旧 `src/core`, `src/worker`, `src/runner`, `src/safety`, `src/judge`, `src/engines`, `src/planner`, `src/logs`, `src/formatter`, `src/problem`, `src/util` は撤去済み
- 不要な補助サブコマンドは撤去済み
- 現在の主経路は `solve` と `logs`

## 現在のおすすめ作業

次にやるなら、`src/solve/session/solveSession.js` の初期化責務を読みやすく整理するのがよさそうです。

現状、以下の処理が `createSolveSession()` にまとまっています。

- problem parse
- workdir 解決
- logs directory 作成
- command policy / sandbox policy 読み込み
- runner limits 設定
- deadline / time budget 扱い
- writable workdir 設定
- execution plan 作成
- progress phase 通知

## 提案する次回テーマ

### Theme: solve session setup の見通し整理

目的:

- `src/solve/session/solveSession.js` の見通しを良くする
- 初期化、problem parsing、plan 作成の境界を読みやすくする
- ただし solve 固有の planner / selector / worker orchestration は隠さない

想定ファイル:

```text
src/solve/session/
  solveSession.js
```

整理するときの責務案:

```js
// createSolveSession は solve session object の組み立てに集中する
// workdir/logs/policies/limits の小さな helper は必要になった場合だけ切り出す
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

- selector
- workerTasks の実行
- candidate selection
- solve progress phase の詳細

## 進め方

1. `src/solve/session/solveSession.js` を読み、初期化処理のまとまりをリスト化する
2. helper を切る場合でも、planner / selector / worker orchestration に関わる値は `solveSession.js` 側に残す
3. `solve` の既存テストを先に守る
4. 必要最小限だけ整理する
5. full test を実行する

## 注意点

- 大きなディレクトリ移動をしない
- `solveSession.js` を無理に共通化しすぎない
- CLI の parse result shape と error message を不用意に変えない
- Docker runner / safety policy の挙動を変えない

## 次回セッションへの依頼文例

```text
docs/next-refactor-proposal.md を読んでください。
次は solve session setup の見通し整理を進めたいです。
まず src/solve/session/solveSession.js の初期化責務を確認し、設計案を出してください。
```
