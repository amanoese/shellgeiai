# AGENTS.md

このファイルは、ShellGeiAI リポジトリで作業する人間およびAIエージェント向けの作業ガイドです。

## プロジェクトの目的

ShellGeiAI は、シェル芸の問題文を受け取り、複数の軽量 AI SubAgent による候補探索、Docker 内での安全な並列実行、判定、結果集約を通じて最終回答を返す CLI ツールです。

ただし現状の実装は、理想像へ向かう移行途中です。いまの `src/` は複数 worker の solve フローを保ちながら、`cli / solve / execution / providers / io / shared` の責務分離を先に進めている段階として理解してください。

このリポジトリでは、次の性質を特に重視します。

- MVP を素早く保つこと
- 安全性を壊さないこと
- Planner / Agent / Runner / Judge / Selector を疎結合に保つこと
- ログと再現性を大切にすること
- 勉強会用途での回答速度を重視すること

## 基本方針

- まずはシンプルに実装する
- 危険コマンドは必ずブロックする
- 実行は最終的に制限付き Docker を主軸にする
- 親プロセスは監督者としてふるまい、worker の並列実行と集約を担う
- SubAgent には短い自己修正ループを許可する
- 問題解釈、計画、実行、判定、選択、整形を分離する
- 将来的な OpenAI API / Bedrock / Docker / corpus / replay 拡張を妨げない構造にする

## 現在の主要コンポーネント

- `src/cli.js`: CLI 入口
- `src/cli/`: CLI コマンドと引数解析
- `src/solve/solve.js`: solve の薄い入口
- `src/solve/session/solveSession.js`: セッション初期化
- `src/solve/orchestration/orchestrator.js`: 現行の worker 実行オーケストレーション
- `src/solve/planning/planner.js`: LLM planner 結果の plan 正規化
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

- `src/solve/`: session / orchestrator / planner / selector / worker
- `src/providers/`: Engine / planner provider 実装群
- `src/execution/runner/`: Docker 実行基盤
- `src/execution/safety/`: command policy / sandbox policy
- `src/execution/judge/`: worker 一次判定と最終判定
- `src/io/logs/`: session / worker ログ

## 作業時のルール

- 小さく変更する
- 変更理由があるときは README や docs も合わせて更新する
- 新しい実行フローを足すときは、まずインターフェースの責務を確認する
- 既存の safety や Docker 制限を緩める変更は慎重に扱う
- 単に動くことより、危険なコマンドを実行しないことを優先する
- 並列実行を入れるときは、速度だけでなくログ再現性も守る

## コーディング方針

- Node.js ベースの CLI として理解しやすい構造を優先する
- 型やデータ構造は明示的に扱う
- エラーメッセージは利用者が理解しやすい文にする
- 外部CLIが未インストールでもクラッシュではなく説明的な失敗にする
- ログはあとから再現・解析しやすい形で残す
- worker ごとの実行結果と制限値が追跡できる構造を優先する
- model provider 依存は agent 層へ閉じ込める

## ドキュメント方針

- 利用者向けの説明は `README.md`
- 将来像や設計意図は `docs/`
- 実行計画や移行順序は `plan/`
- エージェント向けの運用ルールは `AGENTS.md`

追加で設計を整理するときは、次のファイルを起点にしてください。

- [docs/ideal-cli-flow.md](/home/amanoese/repos/shellgeiai/docs/ideal-cli-flow.md)
- [docs/ideal-architecture.md](/home/amanoese/repos/shellgeiai/docs/ideal-architecture.md)
- [plan/archive/2026-06-12-current-gap-remediation-plan.md](/home/amanoese/repos/shellgeiai/plan/archive/2026-06-12-current-gap-remediation-plan.md)

## 近い将来の優先項目

- Docker Runner の追加
- Planner / Selector の実運用化
- Judge の強化
- Safety policy の外部化
- `logs` と `artifacts` の扱いの明確化
- SubAgent 並列実行基盤の導入
- コーパス対応
