# ShellGeiAI

ShellGeiAI（シェル芸愛）は、シェル芸の問題文を入力として受け取り、AIエンジンに候補コマンドを生成させ、安全な Docker 実行環境で検証しながら最終回答を組み立てる Node.js / JavaScript 向けのCLIツールです。

## 現状と理想像

このリポジトリには 3 つのレイヤがあります。

- 現状の実装: 単一 worker solve フローを保ちつつ、通常実行は `DockerRunner` を既定にした MVP
- `docs/` の理想像: 複数 SubAgent を Docker 内で並列実行し、planner / selector / judge / logs を分離する将来構成
- `plan/` の実行計画: 現状実装から理想像へ寄せるための段階的な修正計画

現在の `src/` はまだ完全な Docker 並列実行ではありませんが、`core/solveSession`、`core/orchestrator`、`core/planner`、`core/selector`、`problem/`、`safety/`、`logs/` の骨格を先に導入し、段階的に理想構成へ寄せています。

MVP では、まず次の流れを最小構成で実現します。

- 問題文を読み込む
- Engine が候補コマンドを生成する
- Safety checker が危険なコマンドを検査する
- Runner が Docker 内でコマンドを実行する
- Judge が結果を確認する
- 成功なら整形済みの回答を表示し、失敗なら再試行する

## 特徴

- `openai` / `mock` を差し替え可能な Engine 設計
- 単一 worker 前提でも将来の planner / selector へ移行しやすい `core` 構成
- 一時ディレクトリを `/workspace` として mount する Docker 実行
- `problem` / `safety` / `logs` を分離した拡張しやすい構造
- 危険なコマンドを事前にブロック
- `COMMAND / EXPLANATION / CHECK` に加えて `PASSING COMMANDS` で候補一覧を表示
- `logs/` への JSON 実行ログ保存
- `DockerRunner` を既定にした runtime と、必要時に切り替えられる `LocalRunner`
- 将来的な judge / corpus / minimizer / skills 追加を見据えた疎結合構成
- `workerTask[]` を返す planner contract と、`first-pass-wins` / `best-score-wins` の最小 selector
- judge score と selector metrics を結果・ログへ伝播

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

`openai` engine を使う場合は `OPENAI_API_KEY` を設定してください。必要に応じて `OPENAI_MODEL`、`OPENAI_TIMEOUT_MS`、`OPENAI_MAX_RETRIES`、`OPENAI_BASE_URL` も利用できます。

```bash
export OPENAI_API_KEY=your_api_key
export OPENAI_MODEL=gpt-5.4-mini
```

CLI を実行します。

```bash
npm start -- solve "CSVの3列目の合計を出してください"
```

開発時も同じソースを直接実行できます。

```bash
npm run dev -- solve "CSVの3列目の合計を出してください"
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
shellgeiai check <command>
shellgeiai replay --log <path>
shellgeiai logs show <run-id>
shellgeiai logs list
shellgeiai logs search <query>
shellgeiai logs prune --retain-days <days>
shellgeiai solve <problem> --engine openai
shellgeiai solve <problem> --engine mock
shellgeiai solve <problem> --runner docker
shellgeiai solve <problem> --runner local
shellgeiai solve <problem> --max-iter 5
shellgeiai solve <problem> --workdir ./tmp
shellgeiai solve <problem> --mode parallel --parallelism 3
shellgeiai solve <problem> --selector best-score-wins
shellgeiai solve <problem> --time-budget 1500
shellgeiai solve <problem> --command-policy ./policies/default-command-policy.json
shellgeiai solve <problem> --sandbox-policy ./policies/default-sandbox-policy.json
shellgeiai solve <problem> --progress plain
shellgeiai check "printf '123\n'" --expected-output 123
shellgeiai replay --log ./logs/solve-2026-06-12T12-00-00-000Z.json
shellgeiai logs show 2026-06-12T12-00-00-000Z
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

## コマンド例

例題を `mock` engine で解く:

```bash
npm run dev -- solve "CSVの3列目の合計を出してください" --engine mock
```

文字列で直接問題文を渡す:

```bash
shellgeiai solve "CSVの3列目の合計を出してください"
```

作業ディレクトリを固定する:

```bash
shellgeiai solve "CSVの3列目の合計を出してください" --engine mock --workdir ./tmp
```

Docker runner と並列 worker を使う:

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

保存済みログを run id やパスから見直す:

```bash
shellgeiai logs show 2026-06-12T12-00-00-000Z
shellgeiai logs show ./logs/solve-2026-06-12T12-00-00-000Z.json
```

保存済みログを一覧・検索・削除する:

```bash
shellgeiai logs list
shellgeiai logs search replay
shellgeiai logs prune --retain-days 30 --dry-run
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

必要に応じて、外部 policy JSON を指定できます。サンプルは `policies/default-command-policy.json` と `policies/default-sandbox-policy.json` にあります。
配置規約と schema は [docs/policies.md](/home/amanoese/repos/shellgeiai/docs/policies.md) を参照してください。

## 主要オプション

- `--engine <openai|mock>`: 使用する engine を選びます
- `--runner <local|docker>`: 実行 runner を切り替えます
  既定値は `docker` です。Docker を使わずに試したい場合だけ `--runner local` を指定します。
- `--max-iter <number>`: 各 worker の最大試行回数です
- `--workdir <path>`: 作業ディレクトリを固定します
- `--mode <single|parallel>`: 単一 worker か並列 worker かを選びます
- `--parallelism <number>`: planner が生成する worker 数です
- `--selector <first-pass-wins|best-score-wins>`: 候補の選択戦略です
- `--time-budget <ms>`: セッション全体の制限時間です
- `--command-policy <path>`: command policy JSON を読み込みます
- `--sandbox-policy <path>`: sandbox policy JSON を読み込みます
- `--progress <off|plain|jsonl>`: 実行中 progress を stderr に出します
- `check <command>`: 明示したコマンドを safety / runner / judge で検証します
- `replay --log <path>`: 保存済みログの candidate または attempt を再実行します
- `logs show <run-id>`: 保存済みログを人が読みやすい形式で再表示します
- `logs list`: 保存済みログを新しい順で一覧表示します
- `logs search <query>`: 保存済みログを本文や replay metadata で検索します
- `logs prune --retain-days <days>`: 期限切れログを削除します。`--dry-run` で事前確認できます

## Docker runner の運用メモ

- runner の既定値は `docker` です。`solve` / `check` / `replay` は明示しなくても Docker 経路を使います
- 既定では `theoldmoon0602/shellgeibot` image で `/workspace` に作業ディレクトリを mount して実行します
- 既定 image を変えたい場合は `SHELLGEIAI_DOCKER_IMAGE=<image>` を指定します
- Docker CLI が見つからない場合は説明的なエラーで停止します
- Docker 実行結果のログには `runner.name=docker` に加えて `runner.image` が残ります
- timeout / abort 時は `docker rm -f` による cleanup を追加で試み、attempt の `runnerCleanup` に記録します
- Docker CLI エラーや container cleanup 失敗を検出した場合は、attempt の `runnerFailure` に失敗種別と要約メッセージを保存します

## 現在の制限

- 実行フローは `parallel` モードで複数 worker を並列実行できますが、依然として安全性と再現性を優先した単純な設計です
- Planner と Selector は最小実装ですが、`best-score-wins` で `shellgei score` を主信号にする経路は導入済みです
- `DockerRunner` は通常経路として `solve` / `check` / `replay` の既定になりましたが、filesystem scope ごとの mount 権限制御は今後の改善対象です
- `openai` engine は OpenAI Responses API 前提です
- モデル選定や prompt 最適化はまだ最小実装です
- Judge は最小の score を返しますが、厳密比較や複数ケース判定はまだ限定的です
- Safety checker は deny-list ベースで、完全なポリシーエンジンではありません
- 自動テストは基礎ユニットテスト、score 付き selector/formatter、単一 worker solve フローの回帰確認が中心です

## 今後の予定

- Planner の戦略分岐強化
- 複数候補 selector の強化
- 正規表現一致や順序不問比較への対応
- 複数サンプル入力への対応
- Docker ベース Runner の追加
- allowlist / policy file の導入
- 問題コーパスと minimizer の追加
- judge / selector の score モデル強化
