# 理想の CLI 実行フロー

このドキュメントは、ShellGeiAI の理想的な `solve` 実行フローを整理したものです。
ここでいう理想像は、1 本の候補を順番に retry する CLI ではなく、複数の SubAgent を Docker 内で並列実行し、最初の正解または最良候補を高速に返す CLI です。

## 現状との差分

2026-06-11 時点の実装は、まだこの理想フローをフルには満たしていません。現状は単一 worker の逐次 solve ですが、次の骨格はすでに `src/` に入っています。

- CLI は薄く保ち、実体の依存解決を `core` 側へ寄せる
- 問題正規化は `src/problem/`
- セッション初期化は `src/core/solveSession.js`
- 実行本体は `src/core/orchestrator.js`
- 最小 planner / selector は `src/core/planner.js` と `src/core/selector.js`
- planner は worker ごとに strategy profile と exploration variant を持つ plan を返し始めており、worker 内ループは `src/core/workerTaskExecutor.js` に切り出し中
- safety と logs は `src/safety/` と `src/logs/` に分離済み

このドキュメントは完成済み機能一覧ではなく、そこへ到達するための設計ゴールとして読んでください。

## 目標

ユーザーがシェル芸の問題文を渡したとき、ShellGeiAI は次の価値を一連の流れとして提供します。

- 問題文をすばやく正規化する
- 複数の解答方針を同時に走らせる
- Docker 内で安全に候補実行する
- 各 SubAgent に軽微な自己修正を許可する
- 最初の正解または最良候補を選んで返す
- すべての試行ログをあとで再利用できる形で残す

## 理想のコマンド例

```bash
shellgeiai solve "CSVの3列目の合計を出してください"
shellgeiai solve "CSVの3列目の合計を出してください" --mode sprint
shellgeiai solve "CSVの3列目の合計を出してください" --parallelism 6
shellgeiai solve "CSVの3列目の合計を出してください" --worker-model gpt-5.4-nano
shellgeiai solve "CSVの3列目の合計を出してください" --selector best-score
```

## エンドツーエンドの流れ

### 1. CLI が入力を受け取る

- サブコマンドとオプションを解析する
- `<problem>` の問題文文字列を受け取る
- `mode`、`parallelism`、`worker-model`、`selector`、`time-budget` などの設定を確定する

CLI はこの時点で複雑な判断を持たず、設定をセッション設定へ変換して core に渡します。

### 2. 問題を正規化する

- 問題文文字列を共通フォーマットへ正規化する
- 期待出力、入力ファイル、補助条件を取り出す
- 将来的には frontmatter や YAML 形式にも対応する

この正規化結果は全 worker で共通利用するため、最初に一度だけ行います。

### 3. セッションを初期化する

- 実行 ID を採番する
- セッション用の作業領域を作る
- ログ出力先と artifacts 出力先を確定する
- Docker worker で共有する読み取り専用入力を準備する

ここでは worker ごとの一時領域を親が用意してもよいし、Docker 側の entrypoint で個別に初期化してもかまいません。

### 4. Planner が実行計画を作る

- 問題の性質を見て探索方針を決める
- planner の前段で軽量な tool suggestion seeder が問題文から候補道具群を集める
- planner はその候補と rubric digest を使って worker ごとの exploration variant を返す
- 並列度を決める
- 各 worker に与える strategy を決める
- strategy 名だけでなく、worker ごとの exploration variant を作る
- variant には command 文字列ではなく `summary`、`rationale`、`suggestedTools` を持つ tool suggestion を含められる
- strategy 名に加えて、worker の役割説明と retry 方針を決める
- worker ごとの最大試行回数と時間予算を決める
- worker は assigned variant を主軸として探索し、必要に応じてそこから広げる
- worker は `suggestedTools` を初手の道具選びのヒントとして受け取るが、実際のコマンド構築は自律的に行い、より良い道具があれば逸脱してよい

たとえば次のような plan を作れます。

- Worker A: `awk` 中心
- Worker B: `cut` / `paste` / `bc` 中心
- Worker C: `sort` / `uniq` / `sed` の整形寄り
- Worker D: より素朴なパイプ列を優先

### 5. Docker worker を並列起動する

- 親オーケストレータが plan に従って worker を起動する
- 各 worker に問題文、入力、strategy、モデル、予算を渡す
- worker は制限付き Docker コンテナ内で動く

理想的には次の制限を worker ごとに適用します。

- wall clock timeout
- CPU quota
- memory limit
- process count limit
- output size limit
- network off

### 6. SubAgent が局所探索を行う

各 SubAgent はコンテナ内で短い自己完結ループを回します。

1. strategy に基づいて候補コマンドを作る
2. 軽量 safety check を行う
3. コマンドを実行する
4. stdout / stderr / exit code を見る
5. 自己判定する
6. 必要なら Typo や option を修正して再試行する

重要なのは、SubAgent に長時間の思考をさせることではなく、短い反復で実用的な候補を数多く試すことです。

### 7. worker 内で一次判定する

SubAgent は各試行について少なくとも次を見ます。

- exit code が 0 か
- stderr が致命的でないか
- stdout が空でないか
- 期待出力がある場合に一致しているか

この一次判定は worker 内の自己修正に使いますが、最終採用の唯一の根拠にはしません。

### 8. 親が途中結果を監視する

- worker の進行状況を監視する
- pass 候補が出たら selector policy に応じて早期停止する
- timeout や制限超過の worker を終了する
- ログ欠損や異常終了を記録する

`sprint` モードでは最初の pass を見つけた時点で他 worker を止める構成が有効です。
一方、比較評価では全 worker の完走を待つほうが向いています。

### 9. 親が最終判定と選択を行う

親は worker の自己申告をそのまま信じず、最終的には自分で再確認します。

- success 候補を集める
- 必要なら再判定する
- `first-pass-wins` または `best-score-wins` で採用候補を決める
- 不自然な結果や再現不能な結果を除外する

理想的には score に次の要素を使います。

- 正答性
- 実行時間
- コマンドの簡潔さ
- stdout の安定性
- 説明の分かりやすさ

### 10. 最終回答を整形する

理想の出力には、最低限次を含めます。

```text
COMMAND:
...

OUTPUT:
...

EXPLANATION:
...

CHECK:
status: passed
selector: first-pass-wins
workers: 6
worker-model: gpt-5.4-nano
```

将来的には次も出したいです。

- `STRATEGY`
- `ATTEMPTS`
- `FILES USED`
- `SANDBOX`
- `LOG PATH`

### 11. ログと成果物を保存する

- session 全体の JSON ログ
- worker ごとの試行履歴
- 各試行の stdout / stderr / exit code
- 適用した Docker 制限値
- 最終採用コマンド
- 不採用だった有望候補

理想的には、失敗した探索も corpus や replay に流用できる構造にしておきます。

## 理想の内部パイプライン

```text
CLI
  -> Problem Loader
  -> Session Builder
  -> Planner
  -> Agent Orchestrator
  -> Docker Runner
  -> Worker SubAgents
  -> Judge
  -> Selector
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

- 単に失敗と出すのではなく、どの方針がどう失敗したかを説明する
- Docker 制限に引っかかった場合は、その理由を明示する
- 最も惜しかった候補を示す
- どの worker が最も有望だったかを見せる
- 次に増やすべき並列度や試行回数のヒントを出せるようにする

## 実行モードの考え方

### Sprint

- 勉強会向け
- 高並列
- 早期停止あり
- 1 worker あたりの試行回数は少なめ

### Balanced

- 普段使い向け
- 並列度は中程度
- ある程度の比較を行う

### Eval

- corpus 評価向け
- 完走優先
- 全 worker 結果を保存する

## 移行段階

理想像へは次の順で寄せます。

1. 単一 worker の互換性を保ったまま、session / planner / orchestrator / selector / logs の境界を固める
2. `LocalRunner` と並行して `DockerRunner` の interface と制限値モデルを導入する
3. planner が複数 `workerTask` を返し、orchestrator が並列起動できるようにする
4. selector と judge を複数候補前提へ拡張する
5. `check` / `replay` などのサブコマンドを追加する

## 設計上の大事な原則

- 親は監督者であり、すべての試行を逐次実行する本体ではない
- 実行の第一防衛線は静的 deny-list ではなく Docker 制約である
- SubAgent には短い自己修正を許す
- ログは成功例だけでなく探索過程も残す
- 速さと再現性の両立を目指す
- 単一の賢い agent より、軽量 worker の並列探索を優先する
