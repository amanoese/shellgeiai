# 理想アーキテクチャ

このドキュメントは、ShellGeiAI を今後育てていくうえでの理想的な構成を整理したものです。
ここでいう理想像は、単一の候補を順番に試す CLI ではなく、複数の軽量 SubAgent が Docker 内で並列に候補探索と実行を行い、親オーケストレータが結果を集約する形を前提にしています。

## 現状の実装位置

2026-06-11 時点の `src/` は、理想構成の一部だけを先取りした移行段階です。大きな位置づけは次のとおりです。

- 実際の solve はまだ単一 worker の逐次実行
- `src/core/solveSession.js` と `src/core/orchestrator.js` が現行フローの中心
- `src/core/planner.js` と `src/core/selector.js` は最小実装
- `src/runner/localRunner.js` が唯一の実行基盤
- `src/problem/`、`src/safety/`、`src/logs/` は将来拡張に備えて分離済み

つまり、ディレクトリ構成の一部は理想像へ近づいていますが、Docker 並列実行と複数 SubAgent の本体はまだこれからです。

## 目標

- シェル芸勉強会のような短時間勝負で、できるだけ速く有望な答えに到達する
- 複数候補を並列に実行し、最初の正解または最良候補を採用できる
- 実行は Docker に閉じ込め、安全性と再現性を保つ
- 親と SubAgent の責務を分離し、並列度やモデルを差し替えやすくする
- 失敗事例も含めてログを資産として残す

## 設計の前提

- ShellGeiAI は引き続き CLI ツールとして提供する
- 実行の主戦場はローカル一時ディレクトリではなく、制限付き Docker コンテナ群とする
- SubAgent は候補生成だけでなく、実行と軽微な修正まで担当してよい
- ただし無制限な実行権限は与えず、Docker 制限とツール境界の内側でのみ動かす
- 重い単一モデルより、軽量モデルを複数並列に使うことを優先する
- モデルやプロバイダは固定せず、軽量 OpenAI API モデルや他 backend に差し替え可能にする

## 旧方針からの見直し

従来の MVP 的な考え方では、`Engine -> Safety -> Runner -> Judge` を親プロセスが 1 試行ずつ順番に回す構成を自然な出発点としていました。
しかし、シェル芸用途では次の制約があります。

- 正解探索は広く浅く試したほうが速いことが多い
- Typo や option の微修正は人手より自動反復のほうが速い
- 逐次 retry は安全だが、時間効率が悪い

そのため理想像では、`Engine は実行しない` という厳格な原則を緩め、SubAgent 内部に `候補生成 -> 実行 -> 簡易判定 -> 修正` の短いループを持たせます。
一方で、親プロセスは安全性を完全に放棄するのではなく、Docker 制約、実行予算、ログ、最終採用判定を担う監督者として残します。

## 全体像

```text
CLI
  -> Problem Loader
  -> Session Planner
  -> Agent Orchestrator
  -> Docker Worker Pool
       -> SubAgent A
       -> SubAgent B
       -> SubAgent C
       -> ...
  -> Result Selector
  -> Formatter
  -> Logger
```

各 SubAgent は Docker 内で独立に動き、問題文、入力、方針、試行上限を受け取り、自分のコンテナ内で候補探索を進めます。
親は各 SubAgent の結果を集約し、正解判定、速度、再現性、説明可能性を見ながら最終結果を選びます。

## 理想ディレクトリ構成

```text
shellgeiai/
  README.md
  AGENTS.md
  package.json
  docs/
    README.md
    ideal-cli-flow.md
    ideal-architecture.md
    policies.md
    problem-format.md
  plan/
    README.md
    current-gap-remediation-plan.md
  src/
    cli/
      index.js
      commands/
        solve.js
        check.js
        replay.js
    core/
      solveSession.js
      orchestrator.js
      planner.js
      selector.js
      types.js
    problem/
      loader.js
      markdownParser.js
      normalizer.js
    agents/
      Agent.js
      strategyAgent.js
      openaiSubAgent.js
      mockSubAgent.js
      promptBuilder.js
    worker/
      workerTask.js
      workerResult.js
      workerPool.js
    runner/
      Runner.js
      dockerRunner.js
      limits.js
      containerImage.js
    safety/
      checker.js
      commandPolicy.js
      sandboxPolicy.js
      policyLoader.js
    judge/
      Judge.js
      basicJudge.js
      exactJudge.js
      regexJudge.js
      propertyJudge.js
      scoreJudge.js
    selector/
      firstPassSelector.js
      bestScoreSelector.js
    formatter/
      resultFormatter.js
      logFormatter.js
    logs/
      writer.js
      reader.js
    corpus/
      store.js
      importer.js
    util/
      exec.js
      fs.js
      text.js
      time.js
  docker/
    worker-image/
      Dockerfile
  policies/
    default-command-policy.json
    default-sandbox-policy.json
  logs/
  artifacts/
  tests/
```

現状の近似構成は次のとおりです。

```text
src/
  cli.js
  cliOptions.js
  core/
    solve.js
    solveSession.js
    orchestrator.js
    planner.js
    selector.js
    runtime.js
    types.js
  problem/
    parseProblem.js
  runner/
    Runner.js
    localRunner.js
    limits.js
  safety/
    checker.js
    commandPolicy.js
    sandboxPolicy.js
  judge/
    Judge.js
    simpleJudge.js
  logs/
    writer.js
  engines/
  formatter/
  util/
```

## 主要レイヤの責務

### CLI

- 引数解析
- ユーザー向けエラーメッセージ
- 実行結果の標準出力表示

CLI は薄く保ち、並列制御や Docker 制御の詳細は `core/` に委譲します。

### Problem

- 問題文の読み込み
- 問題文、期待出力、入力ファイル、補助メタ情報の正規化
- 将来的な corpus 連携形式への変換

並列化しても、全 SubAgent に共通で渡す問題データはここで一度だけ正規化します。

### Planner

- 問題に応じた探索方針の生成
- 並列度の決定
- 使用する agent strategy の割り当て
- 1 worker あたりの実行予算の配分

例:

- Agent A: まず素直な `awk` を試す
- Agent B: `cut | paste | bc` のような分解寄り方針を試す
- Agent C: 入出力形式に強い正規化寄り方針を試す

### Agent Orchestrator

- worker の起動と停止
- 各 worker へのタスク配布
- 進行状況の監視
- 成功時の早期停止ポリシー適用
- 実行全体のタイムボックス管理

この層は「誰を何本走らせるか」を決めるが、「コンテナ内でどう修正するか」は持ちません。

### SubAgent

- 問題文と方針から候補コマンドを作る
- Docker 内で候補を実行する
- 実行結果を見て Typo や option を短く修正する
- 局所的な自己判定を行う
- 最終候補と試行ログを返す

SubAgent は単なる提案者ではなく、小さな自己完結型 solver として扱います。
ただし役割はあくまで短い局所探索であり、無制限の長考や外部アクセスは許可しません。

### Runner

- Docker コンテナの起動
- CPU、メモリ、timeout、プロセス数、出力サイズ制限の適用
- ネットワーク無効化
- 作業ディレクトリと入出力ファイルのマウント
- コンテナ標準出力、標準エラー、終了コードの収集

理想構成では `LocalRunner` は補助用途で、主役は `DockerRunner` です。

### Safety

- コマンドの軽量静的検査
- Docker sandbox policy の妥当性確認
- 許可しない実行モードの拒否
- 結果採用前の最終 sanity check

Docker で閉じ込めるため、Safety の中心は deny-list 単独ではなく、`command policy + sandbox policy` の二段構えに寄ります。

### Judge

- 各 worker 内の一次判定
- 親側の最終判定
- 完全一致、正規化一致、正規表現一致、property 判定
- 結果のスコアリング

SubAgent 自身が「たぶん通った」と判断しても、最終採用前に親側で再判定できる構造を保ちます。

### Selector

- 最初に pass した結果を即採用する
- または複数の成功候補から最良のものを選ぶ
- score、実行時間、stdout の安定性、説明の簡潔さで比較する

勉強会では `first-pass-wins` が有効ですが、オフライン評価では `best-score-wins` が使えるようにしておくと便利です。

### Logs

- session 全体ログ
- worker ごとの試行ログ
- コンテナ制限値
- 採用されなかった候補も含む結果保存
- replay 用メタデータ保存

並列実行では、成功した 1 本だけでなく「他に何が走っていたか」が重要な分析資産になります。

## 段階的移行ポリシー

- まずは責務境界を固め、単一 worker でも将来の複数 worker を受けられる result shape を使う
- `Runner` は先に limits と sandbox policy を表現できる interface に広げる
- Docker 実装は、CLI 契約とログ構造が安定してから追加する
- docs では理想像を維持しつつ、README と AGENTS では現在地を必ず明示する

## 推奨する主要インターフェース

### Planner

```js
export class Planner {
  async buildPlan(context) {
    throw new Error("Not implemented");
  }
}
```

```js
// 返却イメージ
{
  parallelism: 6,
  selector: "first-pass-wins",
  workerTasks: [
    {
      strategy: "awk-direct",
      maxLocalIterations: 3,
      model: "gpt-5.4-nano"
    }
  ]
}
```

### SubAgent

```js
export class Agent {
  async solveTask(task) {
    throw new Error("Not implemented");
  }
}
```

```js
// 返却イメージ
{
  status: "passed",
  finalCommand: "awk -F, '{s+=$3} END{print s}' sample.csv",
  attempts: [
    {
      command: "awk -F, '{sum+=$3} END{print s}' sample.csv",
      exitCode: 2,
      judge: { passed: false, reason: "variable typo" }
    },
    {
      command: "awk -F, '{s+=$3} END{print s}' sample.csv",
      exitCode: 0,
      judge: { passed: true, reason: "exact match" }
    }
  ],
  summary: "awk 方針で typo 修正後に通過"
}
```

### Runner

```js
export class Runner {
  async runWorkerTask(task, options) {
    throw new Error("Not implemented");
  }
}
```

### Judge

```js
export class Judge {
  async judgeAttempt(input) {
    throw new Error("Not implemented");
  }

  async judgeFinal(candidateSet) {
    throw new Error("Not implemented");
  }
}
```

### Selector

```js
export class Selector {
  async select(results, context) {
    throw new Error("Not implemented");
  }
}
```

## セッション単位で持ちたい情報

- `runId`
- `problem`
- `normalizedProblem`
- `plan`
- `parallelism`
- `workerTasks`
- `workerResults`
- `selector`
- `judge`
- `sandboxPolicy`
- `artifactsPath`
- `startedAt`
- `finishedAt`

## Worker 単位で持ちたい情報

- `workerId`
- `strategy`
- `model`
- `containerId`
- `containerImage`
- `limits`
- `attempts`
- `passed`
- `score`
- `startedAt`
- `finishedAt`

## 並列実行モデル

理想的な 1 session は、単一ループではなく次のように進みます。

1. 問題を正規化する
2. Planner が複数方針を作る
3. 親が Docker worker を並列起動する
4. 各 SubAgent がコンテナ内で短い自己修正ループを回す
5. 成功候補が出たら selector policy に応じて早期終了または継続する
6. 親が最終判定をして整形結果を返す

このモデルでは retry は session 全体の再試行ではなく、まず worker 内の局所修正として吸収されます。
親が全 worker を再計画するのは、初回プランが弱かった場合の二段目として扱うのが自然です。

## Docker を前提にした安全性

理想構成では、安全性は次の 4 層で守ります。

### 1. 実行環境の隔離

- 専用コンテナ
- 読み書き可能領域の限定
- ネットワーク無効化
- 非 root 実行

### 2. リソース制限

- wall clock timeout
- CPU quota
- memory limit
- process count limit
- output size limit
- file size limit

### 3. 軽量コマンド検査

- 明らかに不要な破壊的コマンドを弾く
- fork bomb 的パターンを弾く
- コンテナ外への影響を狙う指定を弾く

### 4. 親側の採用制御

- 成功したと主張された結果を再判定する
- 不自然な出力や空出力を除外する
- ログが欠けている worker 結果は採用しない

重要なのは、SubAgent に実行を任せる代わりに、Docker 制約と採用制御を強くすることです。

## モデル戦略

このアーキテクチャでは、1 本の高性能モデルに長く考えさせるより、軽量モデルを多数並列するほうが向いています。

- Planner 用には安定した軽量モデルまたはルールベースを使う
- Worker 用には低コスト・低レイテンシのモデルを使う
- 1 worker の推論回数は小さく制限する
- 「広く試す」を優先し、「深く考える」は必要時だけ行う

たとえば worker 用モデルは `gpt-5.4-nano` のような軽量モデルを想定し、1 worker あたり 2-4 回程度の短い自己修正に留めると、速度とコストのバランスを取りやすいです。
モデル名は設定ファイルや CLI option で差し替え可能にし、設計上は特定モデルに固定しないようにします。

## 代表的な実行ポリシー

### Sprint モード

- 目的: 勉強会で最速回答を狙う
- 並列度: 高め
- selector: `first-pass-wins`
- worker 試行回数: 少なめ

### Balanced モード

- 目的: 速度と安定性の両立
- 並列度: 中程度
- selector: `best-score-wins`
- worker 試行回数: 中程度

### Eval モード

- 目的: corpus 評価や設計比較
- 並列度: 固定
- selector: `best-score-wins`
- 全 worker の完走を待つ

## 理想の責務境界

将来的には、次の境界を明確に保つのが重要です。

- CLI は UI であって、並列制御の本体ではない
- Planner は方針を決めるが、実行しない
- SubAgent は局所探索を行うが、コンテナ外へ出ない
- Runner は Docker 実行の事実を管理する
- Judge は pass/fail と score を決める
- Selector は複数結果から採用を決める
- Logger は全経緯を残す

## 現実装からの移行方針

一気に全面実装するより、次の順で移行するのが現実的です。

1. `solve` の結果型を単一 attempt 前提から複数 worker 前提へ広げる
2. `DockerRunner` を先に実装し、制限値を構造化する
3. `Planner` と `Selector` を導入する
4. 既存 `Engine` を `SubAgent` 互換の adapter で包む
5. worker 内自己修正ループを導入する
6. OpenAI API ベースの軽量 worker agent を追加する

この順なら、MVP を壊さずに徐々に並列構成へ移れます。

## 設計原則

- まずは速さよりも安全な Docker 制限を先に作る
- 並列度は設定可能にし、デフォルトは保守的にする
- 失敗ログを必ず残し、あとで replay できるようにする
- worker は短命で再現可能に保つ
- model provider 依存を `agents/` に閉じ込める
- 静的 safety だけに頼らず、sandbox 制約を第一防衛線にする
- 単一正解だけでなく、惜しい候補も比較可能な形で残す
