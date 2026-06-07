# 理想の CLI 実行フロー

このドキュメントは、ShellGeiAI の理想的な `solve` 実行フローを整理したものです。MVP の現在地ではなく、今後拡張していくときの目標像を明確にするための設計メモとして扱います。

## 目標

ユーザーがシェル芸の問題文を渡すと、ShellGeiAI は次の価値を一連の流れとして提供します。

- 問題文を正しく理解する
- 解答候補コマンドを複数回にわたって改善する
- 危険な操作をブロックする
- ローカルの安全な作業環境で検証する
- 出力の正しさをできるだけ自動判定する
- 最後に人が読んで再利用しやすい形で回答を返す

## 理想のコマンド例

```bash
shellgeiai solve "CSVの3列目の合計を出してください"
shellgeiai solve "CSVの3列目の合計を出してください" --engine codex
shellgeiai solve "CSVの3列目の合計を出してください" --engine openai --max-iter 5 --workdir ./tmp
shellgeiai solve "CSVの3列目の合計を出してください" --engine bedrock --judge exact --save-artifacts
```

## エンドツーエンドの流れ

### 1. CLI が入力を受け取る

- サブコマンドとオプションを解析する
- `<problem>` の問題文文字列を受け取る
- `engine`、`judge`、`runner`、`max-iter`、`workdir` などの設定を確定する

### 2. 問題を正規化する

- 問題文文字列を共通フォーマットへ正規化する
- 将来的には frontmatter や YAML 形式も扱えるようにする
- 問題本文、期待出力、入力ファイル一覧を共通フォーマットへ変換する

### 3. 作業環境を初期化する

- 実行専用の一時ディレクトリを作成する
- 将来的に必要なら入力ファイルの受け渡し方法をここで扱う
- 将来的には `artifacts/`, `inputs/`, `outputs/`, `attempts/` を分けて保持する
- 実行IDを採番して、ログと成果物を追跡できるようにする

### 4. Solve セッションを開始する

- 問題文
- 入力ファイル情報
- 過去の試行履歴
- judge からの失敗理由
- safety policy の要約

これらをまとめて Engine に渡し、単発生成ではなく「反復可能な推論セッション」として扱う。

### 5. Engine が候補コマンドを生成する

理想的には Engine の返却値は単なる `command` だけでなく、次も含む。

- `command`
- `explanation`
- `assumptions`
- `confidence`
- `expected_output_guess`

将来的には 1 回で 1 コマンドではなく、複数候補を返し、その中から selector が実行順を決められる構成が望ましい。

### 6. Safety checker が実行前検査を行う

- 危険コマンドをブロックする
- 危険なリダイレクトをブロックする
- ネットワーク利用をブロックする
- インラインスクリプト実行を制限する
- allowlist / denylist / policy file を統合する

理想的には結果を単なる `safe / unsafe` ではなく、次のような構造で返す。

- `decision`: allow / block / review
- `reason`
- `matched_rules`
- `suggested_fix`

### 7. Runner がサンドボックスで実行する

- 作業ディレクトリ内で `/bin/bash` などを使って実行する
- timeout を設定する
- CPU 時間や出力サイズも将来的には制限する
- `stdout`、`stderr`、`exitCode`、`timedOut` を収集する
- 将来的には `LocalRunner` と `DockerRunner` を差し替え可能にする

### 8. Judge が結果を判定する

理想的には複数レイヤで判定する。

- 基本判定: `exitCode`、`stderr`、`stdout`
- 期待値判定: 完全一致、正規表現一致、正規化比較
- 複数入力ケース判定
- property test
- 問題固有 judge

判定結果には、次の試行に役立つフィードバックを含める。

- 何が失敗だったか
- 何が惜しかったか
- 次の試行で直すべき点

### 9. 失敗時は再試行する

- 失敗理由を履歴に追加する
- stdout / stderr / exitCode を Engine に返す
- 同じ失敗を繰り返さないためのヒントを与える
- `max-iter` まで改善ループを回す

理想的には minimizer や repairer を挟み、候補を機械的に整形・縮小できるようにする。

### 10. 最終回答を整形する

理想の出力には、最低限次を含める。

```text
COMMAND:
...

OUTPUT:
...

EXPLANATION:
...

CHECK:
status: passed
iterations: 2
engine: codex
judge: exact
```

将来的には次も出したい。

- `ASSUMPTIONS`
- `FILES USED`
- `SAFETY`
- `LOG PATH`

### 11. ログと成果物を保存する

- 実行ごとの JSON ログ
- 各 attempt の標準出力と標準エラー
- 最終採用コマンド
- judge 判定詳細
- 問題の正規化結果

理想的には、あとから失敗事例をコーパス化できる構造にしておく。

## 理想の内部パイプライン

```text
CLI
  -> Problem Loader
  -> Workspace Manager
  -> Solver Orchestrator
  -> Engine
  -> Safety Checker
  -> Runner
  -> Judge
  -> Formatter
  -> Logger
```

## 将来的に追加したいサブコマンド

- `shellgeiai solve`
- `shellgeiai check`
- `shellgeiai replay`
- `shellgeiai logs show <run-id>`
- `shellgeiai corpus add`
- `shellgeiai policy test`

## 理想の失敗時 UX

- 単に失敗と出すのではなく、何が起きたかを説明する
- 危険コマンドをブロックした場合は、その理由を明示する
- どの試行が最も惜しかったかを示す
- 必要なら次に試すべき候補を表示する

## 設計上の大事な原則

- 実行責務は Engine に持たせない
- Safety は Runner の前に必ず通す
- 問題解釈、実行、判定、整形を疎結合に保つ
- ログはデバッグ用途だけでなく学習資産として残す
- MVP ではシンプルに、拡張は差し替えで表現する
