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

### Knowledge retrieval modes

`--knowledge <mode>` で、ローカル knowledge dataset を使う段階を選べます。

- `off`: retrieval を行いません（既定値）
- `planner`: Planner が command 選択と worker variant 作成の参考に retrieval を使います
- `worker`: 各 Worker が `search_knowledge` Tool Calling で必要なときだけ検索します
- `all`: Planner retrieval と Worker Tool Calling の両方を使います
- `on`: `all` の互換 alias です。CLI で受け取った後は `all` に正規化されます

Planner へ渡す record は、信頼済みの命令ではなく任意の参考情報として扱います。関連する command を variant、`toolBias`、`toolSuggestions` の選択に利用できますが、より安全または適切な別案を選んでも構いません。

Worker への古い無条件の knowledge hint 注入は廃止しました。`worker` / `all` では、各 Worker attempt が `search_knowledge` を最大1回呼び出せ、1回の結果は最大5 records です。retry した次の attempt には新しい1回分の Tool call budget があります。

現在、native Tool Calling に対応する engine は `OpenAIEngine`（`--engine openai`）だけです。Tool Calling 非対応 engine でも `off` / `planner` は利用できますが、`worker` / `all` は Planner 実行前に説明的なエラーで停止します。

再現性のため、session log の Planner prompt / raw response metadata には bounded な Planner reference text が含まれる場合があります。一方、Worker Tool result の record 本文や完全な result value、provider call ID、continuation は保存せず、検証済み引数、成否、件数、record ID だけを attempt summary に残します。

```bash
shellgeiai solve "CSV の 3列目を合計" --parallelism 4 --knowledge off
shellgeiai solve "CSV の 3列目を合計" --parallelism 4 --knowledge planner
shellgeiai solve "CSV の 3列目を合計" --parallelism 4 --knowledge worker
shellgeiai solve "CSV の 3列目を合計" --parallelism 4 --knowledge all
shellgeiai solve "CSV の 3列目を合計" --parallelism 4 --knowledge on --knowledge-model sirasagi62/ruri-v3-30m-ONNX
```

seed dataset は `data/knowledge/shellgei-basic.jsonl` にあります。初回実行時の model download や dataset embedding を避けたい場合は、事前に knowledge cache / vectors を準備できます。

```bash
shellgeiai knowledge prepare
shellgeiai knowledge build
shellgeiai knowledge build --knowledge-model sirasagi62/ruri-v3-30m-ONNX
shellgeiai knowledge search "CSV の 3列目を合計" --top-k 5
shellgeiai knowledge man --profile shellgei
```

`prepare` は embedding model の warmup を行います。既定 model は Transformers.js / ONNX 対応の `sirasagi62/ruri-v3-30m-ONNX` です。`build` は warmup 後に dataset を embedding し、既定では `data/knowledge/shellgei-basic.vectors.jsonl` を作ります。vectors file は metadata 行と item 行の version 2 JSONL で、build 中に record ごとに一時ファイルへ追記し、完了後に公開されます。明示的に指定した旧 version 1 の `.vectors.json` も移行用に読み込めます。knowledge retrieval を有効にした `planner` / `worker` / `all` は、dataset の path・内容 fingerprint と model が一致する vectors file を優先して使い、存在しなければ実行時 embedding に fallback します。不一致、または fingerprint を持たない旧 cache を明示指定した場合は、再buildを促すエラーで停止します。

`solve` と `knowledge prepare/build` の embedding model は `--knowledge-model <model>` で指定できます。環境変数 `SHELLGEIAI_KNOWLEDGE_MODEL` でも既定値を上書きでき、CLI オプションが環境変数より優先されます。互換性のため `knowledge prepare/build --model <model>` も使えます。Transformers.js 対応の ONNX が無い model は失敗することがあります。

`knowledge search <query>` は同じ dataset / vectors / model 設定で検索結果を確認するためのコマンドです。`--top-k <number>` で表示件数を変更できます。

`knowledge man` は、ローカルにインストール済みの man ページから、決定的なルールだけで追加 dataset `data/knowledge/man.jsonl` を生成します。既定の `shellgei` profile はシェル芸で使う section 1 の 151 commands に絞ります。`--profile all` を指定すると man index 全体を対象にします。短い option と長い option の alias は同じ record にまとめ、`--help`、`--version`、`--debug`、`--usage` と、著者・著作権・関連項目などの section 全体を除外します。LLM による要約や言い換えは行いません。`npm run knowledge:man` は source checkout で使える同等の開発用ショートカットです。生成後は同じ model を指定して vectors を作成してください。

```bash
npm run knowledge:man
npm run knowledge:man -- --commands awk,sed --sections 1
npm run knowledge:man -- --profile all --sections all --limit 20
```

`--commands` は profile の command list を置き換えますが、record の抽出・除外ルールは選択中の profile のままです。section 全文の record と option alias ごとの record を含む従来の完全抽出が必要な場合は `--profile all` を指定してください。

生成した dataset の vectors は次のコマンドで作成できます。

```bash
shellgeiai knowledge man --profile shellgei
shellgeiai knowledge build --dataset data/knowledge/man.jsonl --vectors data/knowledge/man.vectors.jsonl
```

man の表示 locale は既定で `ja_JP.UTF-8` です。日本語 man が利用できない場合は、その環境で利用可能な man ページの言語に fallback します。必要なら `--locale <locale>` で明示できます。生成した `man.jsonl` と `man.vectors.jsonl` はローカル成果物であり、Git と npm package の対象外です。

## 安全性

- 既定 runner は `docker` で、隔離されたコンテナ内でコマンドを実行します
- 既定 sandbox policy は `networkAccess: "off"`、`filesystemScope: "workdir-only"` です
- `rm`、`sudo`、`dd`、`mount`、`curl`、`wget`、`ssh` などの危険なコマンドを AST ベースで事前にブロックします
- `/etc` や `$HOME` などの敏感なパスへのリダイレクトもブロックします
- 再帰的に background 実行する shell function は fork bomb 相当としてブロックします
- workdir への書き込みは既定で無効です。必要な場合だけ `--writable-workdir` を付けてください

policy の形式や拡張方法は [docs/development.md](docs/development.md) を参照してください。

開発者向けのセットアップやローカル実行方法は [docs/development.md](docs/development.md) を参照してください。
