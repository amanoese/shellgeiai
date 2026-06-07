# ShellGeiAI

ShellGeiAI（シェル芸愛）は、シェル芸の問題文を入力として受け取り、AIエンジンに候補コマンドを生成させ、安全なローカル実行環境で検証しながら最終回答を組み立てる Node.js / JavaScript 向けのCLIツールです。

MVP では、まず次の流れを最小構成で実現します。

- 問題文を読み込む
- Engine が候補コマンドを生成する
- Safety checker が危険なコマンドを検査する
- Runner がローカルでコマンドを実行する
- Judge が結果を確認する
- 成功なら整形済みの回答を表示し、失敗なら再試行する

## 特徴

- `mock` / `codex` / `cursor` を差し替え可能な Engine 設計
- 一時ディレクトリを使ったローカル実行
- 危険なコマンドを事前にブロック
- `COMMAND / OUTPUT / EXPLANATION / CHECK` 形式で結果表示
- `logs/` への JSON 実行ログ保存
- 将来的な judge / corpus / minimizer / skills 追加を見据えた疎結合構成

## インストール

前提:

- Node.js 20 以上
- npm

依存関係をインストールします。

```bash
npm install
```

JavaScript 版のため、ビルドは不要です。互換用に次のコマンドは no-op です。

```bash
npm run build
```

CLI を実行します。

```bash
npm start -- solve "CSVの3列目の合計を出してください" --engine mock
```

開発時も同じソースを直接実行できます。

```bash
npm run dev -- solve "CSVの3列目の合計を出してください" --engine mock
```

テストは次のコマンドで実行できます。

```bash
npm test
```

## 開発環境セットアップ

```bash
npm install
npm test
```

CLI エントリポイントは `src/cli.js` です。CLI コマンド名は `shellgeiai` です。

## 使い方

```bash
shellgeiai solve <problem>
shellgeiai solve <problem> --engine mock
shellgeiai solve <problem> --engine codex
shellgeiai solve <problem> --engine cursor
shellgeiai solve <problem> --max-iter 5
shellgeiai solve <problem> --workdir ./tmp
shellgeiai solve --help
```

`<problem>` には問題文そのものの文字列を渡します。

例:

```bash
shellgeiai solve "CSVの3列目の合計を出してください"
```

## 出力形式

最終出力は次の形式です。

```text
COMMAND:
awk -F, '{s+=$3} END{print s}' sample.csv

OUTPUT:
123

EXPLANATION:
CSVをカンマ区切りで読み込み、3列目を合計して最後に表示します。

CHECK:
status: passed
iterations: 1
engine: mock
```

## コマンド例

例題を `mock` engine で解く:

```bash
npm run dev -- solve "CSVの3列目の合計を出してください" --engine mock
```

文字列で直接問題文を渡す:

```bash
shellgeiai solve "CSVの3列目の合計を出してください" --engine mock
```

作業ディレクトリを固定する:

```bash
shellgeiai solve "CSVの3列目の合計を出してください" --engine mock --workdir ./tmp
```

## 安全性について

MVP では、安全性を優先して強めのブロックを入れています。少なくとも次のようなコマンドやパターンは拒否されます。

- `rm`
- `sudo`
- `su`
- `chmod`
- `chown`
- `dd`
- `mkfs`
- `mount`
- `umount`
- `curl`
- `wget`
- `nc`
- `ssh`
- `scp`
- `ftp`
- `python -c`
- `perl -e`
- `ruby -e`
- `node -e`
- fork bomb パターン
- `/etc`、`/usr`、`/bin`、`/sbin`、`/var`、`$HOME` への危険なリダイレクト書き込み

また、実行は原則として一時ディレクトリ内で行います。

## 現在の制限

- 安定して動作確認できているのは `mock` engine が中心です
- `codex` と `cursor` は外部CLIを呼ぶ薄いラッパーです
- Judge はまだ単純で、厳密比較や複数ケース判定は限定的です
- Safety checker は deny-list ベースで、完全なポリシーエンジンではありません
- Docker Runner は未実装です
- 自動テストは基礎的なユニットテストのみです

## 今後の予定

- 正規表現一致や順序不問比較への対応
- 複数サンプル入力への対応
- Docker ベース Runner の追加
- allowlist / policy file の導入
- 問題コーパスと minimizer の追加
- OpenAI API / Bedrock API Engine の追加
