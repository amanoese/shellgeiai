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

- Node.js 22 以上（SQLite の native module を利用します）
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
- `--docker-device-readonly <path>` / `--device-ro <path>`: ホストデバイスを Docker 内の同じパスへ読み取り専用で共有します
- `--time-budget <ms>`: 実行時間の上限を指定します
- `--command-policy <path>`: カスタム command policy を読み込みます
- `--sandbox-policy <path>`: カスタム sandbox policy を読み込みます

Docker runner に複数のデバイスを読み取り専用で共有する場合は、正式名と短い alias を繰り返し、または混在して指定できます。

```bash
shellgeiai solve "loop device の内容を調査" \
  --device-ro /dev/loop40 \
  --docker-device-readonly /dev/loop41
```

各デバイスは Docker の `--device <path>:<path>:r` として、ホストと同じコンテナ内パスへ共有されます。この機能は `--runner docker` 専用で、任意の Docker オプションを渡す機能ではありません。

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
shellgeiai solve "CSV の 3列目を合計" --parallelism 4 --knowledge on --knowledge-model qwen/qwen3-embedding-8b
```

Knowledge embedding は OpenRouter API を使います。回答生成用の `OPENAI_API_KEY` とは別に `OPENROUTER_API_KEY` を設定し、retrieval を使う前に SQLite database を作成してください。`--knowledge off` では embedding API を呼びません。

```bash
export OPENROUTER_API_KEY="your-openrouter-api-key"
shellgeiai knowledge prepare
shellgeiai knowledge build
shellgeiai knowledge build --knowledge-model qwen/qwen3-embedding-8b --batch-size 16
shellgeiai knowledge search "CSV の 3列目を合計" --top-k 5
```

`prepare` は native SQLite 接続と embedding API を1回の remote request で確認します。model download、ローカル model の warmup、dataset の build は行いません。既定 model は `qwen/qwen3-embedding-8b` で、4096 次元の float32 vector を `sqlite-vec` に保存し、cosine distance による完全検索を行います。検索結果の score は `1 - distance` です。

`solve` と `knowledge prepare/build/search` の model は `--knowledge-model <model>`、または環境変数 `SHELLGEIAI_KNOWLEDGE_MODEL` で指定でき、CLI が優先されます。`knowledge prepare/build/search --model <model>` は互換 alias で、同時指定時は `--model` が優先されます。API timeout は `SHELLGEIAI_EMBEDDING_TIMEOUT_MS`（既定 30000 ms）、retry 回数は `SHELLGEIAI_EMBEDDING_MAX_RETRIES`（既定 2、0～5）で変更できます。

seed dataset は npm package 内の `data/knowledge/shellgei-basic.jsonl` です。省略時は package 所在地から解決するため、任意の作業ディレクトリから利用できます。明示した `--dataset` / `--knowledge-dataset` の相対パスは現在のディレクトリ基準です。database は `knowledge build/search --db <path>` または `solve --knowledge-db <path>`、次に `SHELLGEIAI_KNOWLEDGE_DB`、最後にユーザー cache directory 内の `shellgeiai/knowledge/<identity hash>.sqlite` の順で決まります。cache directory は `XDG_CACHE_HOME`、Windows の `LOCALAPPDATA`、または `~/.cache` を利用し、identity hash は dataset 絶対パス、provider、model、embedding input profile に基づきます。

```bash
shellgeiai knowledge build --db ./knowledge.sqlite
shellgeiai knowledge search "CSV の 3列目を合計" --db ./knowledge.sqlite --top-k 5
shellgeiai solve "CSV の 3列目を合計" --knowledge planner --knowledge-db ./knowledge.sqlite
```

`build` は dataset の内容 fingerprint が active generation と一致すれば API を呼ばず再利用します。`--force` で同じ内容を再embeddingできます。`--batch-size` は1～64件（既定16件）で、各 batch の document text は合計128 KiB以下に分割します。1 record が128 KiBを超える dataset は build 前に拒否します。build 完了時に新しい generation を公開するため、途中失敗しても以前の completed generation は残ります。dataset を変更した場合は stale generation を検索に使えず、再build が必要です。別の model、provider、input profile、dataset path と紐づいた明示 database は上書きできません。別の `--db` を指定してください。旧 generation の自動削除は行いません。容量を整理したい場合は新しい database path に build してください。

`knowledge search <query>` は ready database と一致する dataset / model を必要とし、`--top-k <number>` で表示件数を変更できます。Planner / Worker も同じ ready database を使います。database がない場合、実行時に document をembeddingする fallback はありません。query embedding は solve session 内で Planner と Worker の間で共有し、同じ query の同時検索は1回の API request にまとめます。

既存 generation の破損から再生成する場合は `knowledge build --force --db <path>` を使います。schema や embedding identity が互換でない database には別の `--db` で build し、search / solve の database 設定も新しいパスへ変更してください。利用者の既存 database は削除しません。

remote API への送信内容に注意してください。`build` は各 record の `text` を、`search` は入力 query を OpenRouter に送信します。Planner の検索 query には問題文や `expectedOutput` などの正規化済み問題情報が含まれ、Worker では model が選んだ検索 query が送信されます。query embedding は検索時にも API 利用料金の対象になります。

旧 Ruri / Transformers.js と JSON/JSONL vector cache は廃止しました。旧 vector file の import はできないため、元の JSONL dataset から `knowledge build` で再生成してください。`--vectors` / `--knowledge-vectors` は1回の移行リリース中、専用エラーで `--db` / `--knowledge-db` への変更を案内します。ローカルに残る旧 `man.vectors.jsonl` などを自動で変更・削除することはありません。

`knowledge man` は、ローカルにインストール済みの man ページから、決定的なルールだけで追加 dataset `data/knowledge/man.jsonl` を生成します。既定の `shellgei` profile はシェル芸で使う section 1 の 151 commands に絞ります。`--profile all` を指定すると man index 全体を対象にします。短い option と長い option の alias は同じ record にまとめ、`--help`、`--version`、`--debug`、`--usage` と、著者・著作権・関連項目などの section 全体を除外します。LLM による要約や言い換えは行いません。`npm run knowledge:man` は source checkout で使える同等の開発用ショートカットです。生成後は同じ model を指定して database を作成してください。

```bash
npm run knowledge:man
npm run knowledge:man -- --commands awk,sed --sections 1
npm run knowledge:man -- --profile all --sections all --limit 20
```

`--commands` は profile の command list を置き換えますが、record の抽出・除外ルールは選択中の profile のままです。section 全文の record と option alias ごとの record を含む従来の完全抽出が必要な場合は `--profile all` を指定してください。

生成した dataset の database は次のコマンドで作成できます。

```bash
shellgeiai knowledge man --profile shellgei
shellgeiai knowledge build --dataset data/knowledge/man.jsonl --db ./man.sqlite
shellgeiai solve "CSV の 3列目を合計" --knowledge planner --knowledge-dataset data/knowledge/man.jsonl --knowledge-db ./man.sqlite
```

man の表示 locale は既定で `ja_JP.UTF-8` です。日本語 man が利用できない場合は、その環境で利用可能な man ページの言語に fallback します。必要なら `--locale <locale>` で明示できます。生成した `man.jsonl`、database と WAL/SHM、および残存する旧 `man.vectors.jsonl` はローカル成果物であり、Git と npm package の対象外です。

## 安全性

- 既定 runner は `docker` で、隔離されたコンテナ内でコマンドを実行します
- 既定 sandbox policy は `networkAccess: "off"`、`filesystemScope: "workdir-only"` です
- `rm`、`sudo`、`dd`、`mount`、`curl`、`wget`、`ssh` などの危険なコマンドを AST ベースで事前にブロックします
- `/etc` や `$HOME` などの敏感なパスへのリダイレクトもブロックします
- 再帰的に background 実行する shell function は fork bomb 相当としてブロックします
- workdir への書き込みは既定で無効です。必要な場合だけ `--writable-workdir` を付けてください
- `--docker-device-readonly` / `--device-ro` はデバイスの変更を防ぎますが、内容の読み出しは防ぎません。AI が生成したコマンドや保存ログから内容が露出しても問題ないデバイスだけを指定してください

policy の形式や拡張方法は [docs/development.md](docs/development.md) を参照してください。

開発者向けのセットアップやローカル実行方法は [docs/development.md](docs/development.md) を参照してください。
