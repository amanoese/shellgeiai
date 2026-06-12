# ShellGeiAI

ShellGeiAI（シェル芸愛）は、シェル芸の問題文を入力として受け取り、AI エンジンに候補コマンドを生成させ、安全な実行環境で検証しながら最終回答を組み立てる Node.js 向け CLI ツールです。

## 特徴

- シェル芸の問題文から候補コマンドを生成して検証できる
- `openai` / `mock` の Engine を切り替えられる
- 既定では `DockerRunner` で安全性を優先して実行できる
- 危険なコマンドを事前にブロックできる
- 実行ログを `logs/` に JSON で保存し、あとから確認できる

## インストール

前提:

- Node.js 20 以上
- npm

将来的には npm からのインストールを想定しています。

```bash
npm install -g shellgeiai
```

現時点ではまだ npm package を publish していないため、このリポジトリを clone して依存関係をインストールしてください。

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

主なコマンド:

```bash
shellgeiai solve <problem>
shellgeiai check <command>
shellgeiai replay --log <path>
shellgeiai logs show <run-id>
shellgeiai logs list
shellgeiai logs search <query>
shellgeiai logs prune --retain-days <days>
shellgeiai solve --help
```

`<problem>` には問題文そのものの文字列を渡します。

例:

```bash
shellgeiai solve "CSVの3列目の合計を出してください"
```

## よく使う例

例題を `mock` engine で解く:

```bash
shellgeiai solve "CSVの3列目の合計を出してください" --engine mock
```

作業ディレクトリを固定する:

```bash
shellgeiai solve "CSVの3列目の合計を出してください" --engine mock --workdir ./tmp
```

並列 worker を使う:

```bash
shellgeiai solve "CSVの3列目の合計を出してください" --runner local --mode parallel --parallelism 3 --selector best-score-wins
```

Docker image を切り替えて実行する:

```bash
SHELLGEIAI_DOCKER_IMAGE=ubuntu:24.04 shellgeiai solve "CSVの3列目の合計を出してください" --runner docker
```

進捗を stderr に表示する:

```bash
shellgeiai solve "CSVの3列目の合計を出してください" --engine mock --progress plain
```

進捗バーを表示する:

```bash
shellgeiai solve "CSVの3列目の合計を出してください" --engine mock --progress bar
```

`bar` は TTY 上で一時表示され、TTY でない場合は `plain` に自動でフォールバックします。
worker ごとの行には内部状態と attempt 回数も表示されます。

進捗を JSON Lines で外部ツールへ渡す:

```bash
shellgeiai solve "CSVの3列目の合計を出してください" --progress jsonl 2>progress.jsonl
```

明示したコマンドを安全に再実行して judge だけ確認する:

```bash
shellgeiai check "printf '123\n'" --expected-output 123
```

保存済みログから選択済み candidate を replay する:

```bash
shellgeiai replay --log ./logs/solve-2026-06-12T12-00-00-000Z.json
```

保存済みログを一覧・検索・削除する:

```bash
shellgeiai logs list
shellgeiai logs search replay
shellgeiai logs prune --retain-days 30 --dry-run
```

## 出力形式

最終出力は次の形式です。

```text
COMMAND:
awk -F, '{s+=$3} END{print s}' sample.csv

EXPLANATION:
CSVをカンマ区切りで読み込み、3列目を合計して最後に表示します。

CHECK:
status: passed
iterations: 1
engine: mock
workers: 1
stop-reason: (none)
selector: first-pass-wins
selected-candidate: worker-1
selected-score: 100
score-breakdown: correctness=60, stdout=15, stderr=10, expected=15
selected-shellgei-score: 82
shellgei-breakdown: shortness=38, simplicity=24, speed=20
selector-metrics: total=192, shellgei=82, judge=100, stdout-consistency=10, output-consensus=0, duration-ms=3, iterations=1
selector-reason: Selected the first candidate that passed final checks.
runner: docker
sandbox-network: off
sandbox-filesystem: workspace-write
reason: Basic checks passed.

PASSING COMMANDS:
worker-1 | score: 82 | command: awk -F, '{s+=$3} END{print s}' sample.csv
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

また、実行は原則として一時ディレクトリ内で行います。

policy の差し替えや内部構成、ローカル開発コマンドについては [docs/development.md](/home/amanoese/repos/shellgeiai/docs/development.md) と [docs/README.md](/home/amanoese/repos/shellgeiai/docs/README.md) を参照してください。
