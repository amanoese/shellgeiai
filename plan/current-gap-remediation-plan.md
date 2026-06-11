# ShellGeiAI 今後の実装計画

## このファイルの目的

このファイルは、完了履歴の保管場所ではなく、これから実装する機能の優先順位と判断材料を整理するための作業計画です。
理想像そのものは `docs/ideal-cli-flow.md` と `docs/ideal-architecture.md` を参照し、このファイルには現在の未完了事項だけを残します。

## 現在地

2026-06-12 時点で、理想構成へ寄せるための土台は概ね整っています。
現在は次の前提で考えます。

- `core / problem / safety / logs` の責務分離は済んでいる
- `openai` engine、`LocalRunner`、最小の `DockerRunner`、planner / orchestrator / selector / judge / formatter の基本経路はある
- `solve`、`check`、`replay`、`logs show` の最小 CLI はある
- 回帰テストの土台はあり、今後は運用強化と実用機能の追加が主対象になる

## 直近の優先項目

### 1. Docker Runner の実運用化

目的:
安全な実行基盤を `LocalRunner` 依存から `DockerRunner` 主体へ寄せる。

必要な作業:

- 実行中 container の stop / cleanup / reap を安定化する
- worker 異常終了時の後始末とログ記録を明確にする
- default の Docker image は `theoldmoon0602/shellgeibot` を使う前提で、override 方法と運用手順を整理する
- Docker 実機前提の運用テストを増やす

完了条件:

- 途中停止や timeout があっても container が取り残されない
- 実行制限と失敗理由がログから追える
- `solve` / `check` / `replay` で Docker 経路を通常運用として扱える

### 2. 並列 orchestrator の運用強化

目的:
現状の最小並列骨格を、複数 worker を安定運用できる形へ進める。

必要な作業:

- progress event の集約表示を整える
- worker pool のスケジューリングを改善する
- Docker 実行時の停止伝播をより確実にする
- 失敗 worker を含む session 全体の観測性を上げる

完了条件:

- 並列度を上げても進行状況と停止理由が分かる
- `first-pass-wins` と完走待ちの両方で挙動が読みやすい

### 3. judge / selector の高度化

目的:
最小 score モデルから、再現性と比較根拠を持った選択へ進める。

必要な作業:

- score 重み付けの整理
- stdout 安定性の評価強化
- 候補間比較の説明可能性向上
- 必要に応じた親側の再判定強化

完了条件:

- なぜその候補を選んだかを結果とログから説明できる
- `best-score-wins` が単なる tie-break ではなく実用比較として機能する

### 4. `check` / `replay` / logs 周辺の運用機能

目的:
試行ログを調査・再利用できる運用経路を整える。

必要な作業:

- replay メタデータの活用
- ログ一覧 / 検索 / 保持期間 pruning の CLI 公開
- `policy test` のような運用補助コマンド検討
- corpus 連携の入口整理

完了条件:

- 保存ログから再実行・比較・調査がしやすい
- 実験結果を corpus や将来の改善へつなげられる

### 5. SubAgent / worker pool への移行

目的:
理想 docs にある「複数の軽量 SubAgent が Docker 内で局所探索する」形へ近づける。

必要な作業:

- worker ごとの strategy をより明示的にする
- SubAgent の局所 retry ループ設計を固める
- worker pool と agent 実装の責務境界を定義する
- model provider 依存を agent 層へ閉じ込める

完了条件:

- 親 orchestrator と worker 内探索の責務が明確
- strategy 差分を持つ複数 worker を自然に追加できる

## 依存関係と進め方

優先順:

1. Docker Runner の実運用化
2. 並列 orchestrator の運用強化
3. judge / selector の高度化
4. `check` / `replay` / logs 周辺の運用機能
5. SubAgent / worker pool への移行

補足:

- 1 と 2 は相互依存が強いので、runner と orchestrator は並行して詰める
- 3 は 1 と 2 のログ・観測性が上がるほどやりやすい
- 4 は 1 から 3 の成果を活かす運用面の整理
- 5 は基盤が安定してから本格着手する

## 今後の設計判断で守ること

- 安全性を速度より優先する
- Docker 制限を緩める変更は慎重に扱う
- 親は監督者、worker は局所探索担当という責務分離を維持する
- ログと再現性を壊さない
- model provider 依存を `core` に漏らしすぎない
- 小さく進め、各段階でテストを先に固定する

## 関連ドキュメント

- [docs/ideal-cli-flow.md](/home/amanoese/repos/shellgeiai/docs/ideal-cli-flow.md)
- [docs/ideal-architecture.md](/home/amanoese/repos/shellgeiai/docs/ideal-architecture.md)
- [docs/policies.md](/home/amanoese/repos/shellgeiai/docs/policies.md)
- [AGENTS.md](/home/amanoese/repos/shellgeiai/AGENTS.md)
