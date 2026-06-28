# Development

`docs/development.md` は ShellGeiAI の開発者向け情報をまとめるページです。

## 開発環境セットアップ

前提:

- Node.js 20 以上
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

## 現状と理想像

このリポジトリには 3 つのレイヤがあります。

- 現状の実装: 単一 worker solve フローを保ちつつ、通常実行は `DockerRunner` を既定にした MVP
- `docs/` の理想像: 複数 SubAgent を Docker 内で並列実行し、planner / selector / judge / logs を分離する将来構成
- `plan/` の実行計画: 現状実装から理想像へ寄せるための段階的な修正計画

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
- policy JSON の詳細は [docs/policies.md](/home/amanoese/repos/shellgeiai/docs/policies.md) を参照してください

## 関連ドキュメント

- [README.md](/home/amanoese/repos/shellgeiai/README.md): 利用者向けの導入と使い方
- [docs/README.md](/home/amanoese/repos/shellgeiai/docs/README.md): `docs/` 全体の案内
- [docs/ideal-cli-flow.md](/home/amanoese/repos/shellgeiai/docs/ideal-cli-flow.md): 理想的な CLI 実行フロー
- [docs/ideal-architecture.md](/home/amanoese/repos/shellgeiai/docs/ideal-architecture.md): 理想的な責務分離とアーキテクチャ
- [docs/policies.md](/home/amanoese/repos/shellgeiai/docs/policies.md): command policy / sandbox policy の配置規約と schema
- [plan/README.md](/home/amanoese/repos/shellgeiai/plan/README.md): 実装計画の整理場所
- [plan/archive/2026-06-12-current-gap-remediation-plan.md](/home/amanoese/repos/shellgeiai/plan/archive/2026-06-12-current-gap-remediation-plan.md): 現状実装から理想像へ寄せる修正計画のアーカイブ
