# AGENTS.md

このファイルは、ShellGeiAI リポジトリで作業する人間およびAIエージェント向けの作業ガイドです。

## プロジェクトの目的

ShellGeiAI は、シェル芸の問題文を受け取り、AI による候補コマンド生成、ローカル実行、判定、再試行を通じて最終回答を返す CLI ツールです。

このリポジトリでは、次の性質を特に重視します。

- MVP を素早く保つこと
- 安全性を壊さないこと
- Engine / Runner / Judge を疎結合に保つこと
- ログと再現性を大切にすること

## 基本方針

- まずはシンプルに実装する
- 危険コマンドは必ずブロックする
- 実行は原則として一時ディレクトリで行う
- Engine にコマンド実行責務を持たせない
- 問題解釈、実行、判定、整形を分離する
- 将来的な OpenAI API / Bedrock / Docker / corpus 拡張を妨げない構造にする

## 現在の主要コンポーネント

- `src/cli.js`: CLI 入口
- `src/core/solve.js`: solve オーケストレーション
- `src/engines/`: Engine 実装群
- `src/runner/`: 実行と safety
- `src/judge/`: 判定器
- `src/formatter/`: 結果表示
- `src/util/`: ファイル・実行補助

## 作業時のルール

- 小さく変更する
- 変更理由があるときは README や docs も合わせて更新する
- 新しい実行フローを足すときは、まずインターフェースの責務を確認する
- 既存の safety を緩める変更は慎重に扱う
- 単に動くことより、危険なコマンドを実行しないことを優先する

## コーディング方針

- Node.js ベースの CLI として理解しやすい構造を優先する
- 型やデータ構造は明示的に扱う
- エラーメッセージは利用者が理解しやすい文にする
- 外部CLIが未インストールでもクラッシュではなく説明的な失敗にする
- ログはあとから再現・解析しやすい形で残す

## ドキュメント方針

- 利用者向けの説明は `README.md`
- 将来像や設計意図は `docs/`
- エージェント向けの運用ルールは `AGENTS.md`

追加で設計を整理するときは、次のファイルを起点にしてください。

- [docs/ideal-cli-flow.md](/home/amanoese/repos/shellgeiai/docs/ideal-cli-flow.md)
- [docs/ideal-architecture.md](/home/amanoese/repos/shellgeiai/docs/ideal-architecture.md)

## 近い将来の優先項目

- JavaScript ベース構成への整理
- Judge の強化
- Safety policy の外部化
- `logs` と `artifacts` の扱いの明確化
- Docker Runner の追加
- コーパス対応
