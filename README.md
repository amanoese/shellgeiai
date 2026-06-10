# ShellGeiAI

ShellGeiAI（シェル芸愛）は、シェル芸の問題文を入力として受け取り、AIエンジンに候補コマンドを生成させ、安全なローカル実行環境で検証しながら最終回答を組み立てる Node.js / JavaScript 向けのCLIツールです。

## 現状と理想像

このリポジトリには 2 つのレイヤがあります。

- 現状の実装: 単一 worker を `LocalRunner` で順番に試す MVP
- `docs/` の理想像: 複数 SubAgent を Docker 内で並列実行し、planner / selector / judge / logs を分離する将来構成

現在の `src/` はまだ完全な Docker 並列実行ではありませんが、`core/solveSession`、`core/orchestrator`、`core/planner`、`core/selector`、`problem/`、`safety/`、`logs/` の骨格を先に導入し、段階的に理想構成へ寄せています。

MVP では、まず次の流れを最小構成で実現します。

- 問題文を読み込む
- Engine が候補コマンドを生成する
- Safety checker が危険なコマンドを検査する
- Runner がローカルでコマンドを実行する
- Judge が結果を確認する
- 成功なら整形済みの回答を表示し、失敗なら再試行する

## 特徴

- `openai` / `mock` を差し替え可能な Engine 設計
- 単一 worker 前提でも将来の planner / selector へ移行しやすい `core` 構成
- 一時ディレクトリを使ったローカル実行
- `problem` / `safety` / `logs` を分離した拡張しやすい構造
- 危険なコマンドを事前にブロック
- `COMMAND / OUTPUT / EXPLANATION / CHECK` 形式で結果表示
- `logs/` への JSON 実行ログ保存
- `DockerRunner` の最小実装と `LocalRunner` の差し替え可能な runtime
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
shellgeiai solve <problem> --engine openai
shellgeiai solve <problem> --engine mock
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
workers: 1
stop-reason: (none)
selector: first-pass-wins
selected-candidate: worker-1
selected-score: 100
score-breakdown: correctness=60, stdout=15, stderr=10, expected=15
selector-metrics: total=110, judge=100, stdout-consistency=10, output-consensus=0, duration-ms=3, iterations=1
selector-reason: Selected the first candidate that passed final checks.
runner: local
sandbox-network: off
sandbox-filesystem: workspace-write
reason: Basic checks passed.
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

## 現在の制限

- 実行フローはまだ単一 worker の逐次処理です
- Planner と Selector は現時点では単純な既定実装ですが、内部 contract は複数 worker 前提に整理済みです
- `DockerRunner` は最小実装段階で、CLI の公開契約にはまだ出していません
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
