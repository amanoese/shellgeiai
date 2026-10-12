# AGENTS.md

このファイルは、ShellGeiAI リポジトリで作業する人間およびAIエージェント向けの作業ガイドです。

## レビュー方針（Review guidelines）

- Codex を含む AI エージェントは、ユーザーが別の言語を明示的に指定しない限り、レビュー結果を日本語で返す。
- PR レビューの要約、指摘のタイトルと本文、インラインコメント、レビューへの返信はすべて日本語で記述する。
- コードの識別子、ファイル名、コマンド、API 名、エラーメッセージの原文は翻訳せず、その意味や修正理由を日本語で説明する。

## プロジェクトの目的

ShellGeiAI は、シェル芸の問題文を受け取り、複数の軽量 AI SubAgent による候補探索、Docker 内での安全な並列実行、判定、結果集約を通じて最終回答を返す CLI ツールです。

ただし現状の実装は、理想像へ向かう移行途中です。いまの `src/` は複数 worker の solve フローを保ちながら、31個の TypeScript ファイルで責務と型契約を整理した段階として理解してください。

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
- 将来的な OpenAI API / Bedrock / Docker / corpus 拡張を妨げない構造にする

## 現在の主要コンポーネント

`src/` は strict TypeScript の31ファイル、7ディレクトリ（`cli / solve / execution / providers / knowledge / io / shell`）です。`shared.ts` と `types.ts` は root に置きます。責務はファイル内でも分離し、責務ごとの小さなディレクトリへは分割しません。

- `src/cli.ts`: CLI 起動入口
- `src/cli/program.ts`: Commander の command / option 定義と引数解析
- `src/cli/commands.ts`: solve / logs の dispatch と結果整形
- `src/solve/solve.ts`: 問題文正規化、session 初期化、plan 正規化と solve の入口
- `src/solve/runtime.ts`: Engine / Runner / Judge / Planner の構築
- `src/solve/orchestrator.ts`: worker queue、並列実行、停止制御と結果集約
- `src/solve/worker.ts`: retry loop、attempt の生成・安全性検査・実行・判定
- `src/solve/tools.ts`: Tool registry、引数検証と bounded Tool loop
- `src/solve/selection.ts`: 候補選択と shellgei score
- `src/solve/events.ts`: progress callback と session phase
- `src/providers/`: API / CLI / mock Engine、LLM 設定・SDK client・履歴、Planner、embedding
- `src/execution/`: Docker / local Runner、policy、safety、Judge
- `src/knowledge/`: dataset / database / retrieval / man dataset
- `src/io/logs.ts`: session log の保存、catalog と表示
- `src/io/progress.ts`: progress event の bar / plain / JSONL 表示
- `src/shell/analyzer.ts`: Bash AST 解析と共有 WASM parser
- `src/shared.ts`: ファイル・子プロセス補助
- `src/types.ts`: レイヤ間の型契約（runtime export は空）

型と schema の所有、全ファイル一覧と読む順番は [docs/src-file-map.md](docs/src-file-map.md) を参照してください。NodeNext の source import は `.js` suffix、型専用 import / export は `import type` / `export type` を使います。実行対象は build 済みの `dist/cli.js` です。

将来の Planner / Agent / Runner / Judge / Selector / Logs は責務として区別します。現在のファイル配置と将来の責務図は別物です。

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
- 作業中の実行計画や移行順序は `docs/superpowers/` に一時生成されるが、生成された `.md` は追跡しない
- エージェント向けの運用ルールは `AGENTS.md`

追加で設計を整理するときは、次のファイルを起点にしてください。

- [docs/ideal-architecture.md](/home/amanoese/repos/shellgeiai/docs/ideal-architecture.md)

## 近い将来の優先項目

- Docker Runner の追加
- Planner / Selector の実運用化
- Judge の強化
- Safety policy の外部化
- `logs` と `artifacts` の扱いの明確化
- SubAgent 並列実行基盤の導入
- コーパス対応
