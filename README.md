# ShellGeiAI

ShellGeiAI は、シェル芸の問題文を入力として受け取り、AI に候補コマンドを作らせ、安全な実行環境で検証しながら最終回答を組み立てる CLI です。

## 特徴

- シェル芸の問題文から候補コマンドを生成して検証できます
- `openai` / `mock` の engine を切り替えられます
- 既定では Docker runner で安全性を優先して実行します
- 危険コマンドやネットワーク系コマンドを実行前にブロックします
- 実行ログを `logs/` に残し、あとから `logs show` で確認できます
- planner / judge / selector を分離した構成で、今後の並列化や強化を進めやすくしています

## インストール

- Node.js 20 以上
- npm

```bash
npm install -g shellgeiai
```

`openai` engine を使う場合、`OPENAI_API_KEY` の設定は必須です。

現在のシェルだけで有効にする場合:

```bash
export OPENAI_API_KEY="your-api-key"
```

永続化する場合は、使っている shell の設定ファイルに追記してください。

`bash`:

```bash
echo 'export OPENAI_API_KEY="your-api-key"' >> ~/.bashrc
source ~/.bashrc
```

`zsh`:

```bash
echo 'export OPENAI_API_KEY="your-api-key"' >> ~/.zshrc
source ~/.zshrc
```

必要に応じて `OPENAI_MODEL`、`OPENAI_TIMEOUT_MS`、`OPENAI_MAX_RETRIES`、`OPENAI_BASE_URL` も指定できます。

## 使い方

問題文から回答候補を生成して検証する:

```bash
shellgeiai solve "標準入力の行順を逆順にして表示せよ"
```

保存済みログを確認する:

```bash
shellgeiai logs show <run-id>
```

よく使うオプション:

- `--engine <openai|mock>`: 候補生成に使う engine を選びます
- `--runner <docker|local>`: 実行環境を切り替えます。既定は `docker` です
- `--workdir <path>`: 実行対象の作業ディレクトリを指定します
- `--writable-workdir`: workdir への書き込みを許可します
- `--time-budget <ms>`: 実行時間の上限を指定します
- `--command-policy <path>`: カスタム command policy を読み込みます
- `--sandbox-policy <path>`: カスタム sandbox policy を読み込みます

## 安全性

- 既定 runner は `docker` で、隔離されたコンテナ内でコマンドを実行します
- 既定 sandbox policy は `networkAccess: "off"`、`filesystemScope: "workdir-only"` です
- `rm`、`sudo`、`dd`、`mount`、`curl`、`wget`、`ssh`、`python -c` などの危険なコマンドパターンを事前にブロックします
- `/etc` や `$HOME` などの敏感なパスへのリダイレクトもブロックします
- workdir への書き込みは既定で無効です。必要な場合だけ `--writable-workdir` を付けてください

policy の形式や拡張方法は [docs/README.md](docs/README.md) を参照してください。

開発者向けのセットアップやローカル実行方法は [docs/development.md](docs/development.md) を参照してください。
