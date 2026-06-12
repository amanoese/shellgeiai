# ShellGeiAI

ShellGeiAI（シェル芸愛）は、シェル芸の問題文を入力として受け取り、AI エンジンに候補コマンドを生成させ、安全な実行環境で検証しながら最終回答を組み立てる Node.js 向け CLI ツールです。

## 特徴

- シェル芸の問題文から候補コマンドを生成して検証できる
- `openai` / `mock` の Engine を切り替えられる
- 既定では `DockerRunner` で安全性を優先して実行できる
- 危険なコマンドを事前にブロックできる
- 実行ログを `logs/` に JSON で保存し、あとから確認できる
- planner は worker ごとに探索バリエーション (`variant`) を配り、同じ問題でも探索観点を分散できる
- `judge` と `shellgei score` を分けた two-layer quality loop で最終候補を選べる

## インストール

前提:
- Node.js 20 以上
- npm

将来的には npm からのインストールを想定しています。

```bash
npm install -g shellgeiai
```

現時点ではまだ npm package publish していないため、このリポジトリを clone して依存関係をインストールしてください。

```bash
npm install
```

`openai` engine を使う場合は `OPENAI_API_KEY` を設定してください。必要に応じて `OPENAI_MODEL`、`OPENAI_TIMEOUT_MS`、`OPENAI_MAX_RETRIES`、`OPENAI_BASE_URL` も利用できます。

```bash
export OPENAI_API_KEY=your_api_key
export OPENAI_MODEL=gpt-5.4-mini
```

## 使い方

CLI を実行します。

```bash
shellgeiai solve "CSVの3列目の合計を出してください"
```

品質モードを切り替えたい場合は `--shellgei-score-mode` を指定できます。

```bash
shellgeiai solve "CSVの3列目の合計を出してください" --selector best-score-wins --shellgei-score-mode practical
```

品質ループの役割分担:
- `judge`: 正確性・実行可能性・失格条件の gate
- `shellgei score`: 簡潔性、シェルらしさ、発想、可読性、堅牢性、鑑賞性の品質評価
- `selector`: `best-score-wins` のときに quality layer を優先利用

主なコマンド:

```bash
shellgeiai solve "CSVの3列目の合計を出してください"
```

## 安全性について

安全性を優先して、少なくとも次のようなコマンドやパターンは拒否されます。

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

また、実行は原則として一時ディレクトリ内で行います。policy の差し替えや内部構成、ローカル開発コマンドについては [docs/development.md](/home/amanoese/repos/shellgeiai/docs/development.md) と [docs/README.md](/home/amanoese/repos/shellgeiai/docs/README.md) を参照してください。
