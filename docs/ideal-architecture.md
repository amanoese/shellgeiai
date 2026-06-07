# 理想の構成

このドキュメントは、ShellGeiAI を今後育てていくための理想的なディレクトリ構成と責務分割をまとめたものです。

## 目標

- CLI の入口を薄く保つ
- オーケストレーションと各機能部品を分離する
- Engine / Runner / Judge / Safety / Corpus を差し替え可能にする
- ログ、成果物、ポリシー、問題コーパスを整理して管理する

## 理想ディレクトリ構成

```text
shellgeiai/
  README.md
  AGENTS.md
  package.json
  docs/
    ideal-cli-flow.md
    ideal-architecture.md
    policies.md
    problem-format.md
  src/
    cli/
      index.js
      commands/
        solve.js
        check.js
        replay.js
    core/
      solver.js
      session.js
      types.js
    problem/
      loader.js
      markdownParser.js
      normalizer.js
    engines/
      Engine.js
      mockEngine.js
      codexCliEngine.js
      cursorCliEngine.js
      openaiApiEngine.js
      bedrockEngine.js
    runner/
      Runner.js
      localRunner.js
      dockerRunner.js
      limits.js
    safety/
      checker.js
      rules.js
      policyLoader.js
    judge/
      Judge.js
      simpleJudge.js
      exactJudge.js
      regexJudge.js
      propertyJudge.js
    formatter/
      resultFormatter.js
      logFormatter.js
    logs/
      writer.js
      reader.js
    corpus/
      store.js
      importer.js
    minimizer/
      minimizer.js
    util/
      exec.js
      fs.js
      text.js
  examples/
    problems/
    inputs/
  policies/
    default-policy.json
  logs/
  artifacts/
  tests/
```

## レイヤごとの責務

### CLI

- 引数解析
- ユーザー向けエラーメッセージ
- 実行結果の標準出力への表示

CLI は orchestration の詳細を持たず、`core/solver.js` に委譲するのが理想です。

### Core

- solve セッション全体の制御
- retry の制御
- 各部品の接続
- 実行結果の最終判断

ここがアプリケーションの中心で、ビジネスフローだけを持つ層です。

### Problem

- 問題ファイルの読み込み
- Markdown や将来の YAML 形式の解釈
- `Problem` / `Input` / `Expected` の正規化

この層を独立させることで、問題コーパスとの連携がしやすくなります。

### Engines

- LLM または外部CLIに候補コマンドを問い合わせる
- 解答候補の生成に専念する
- コマンド実行はしない

Engine は「提案者」であり、「実行者」ではない、という分離を守るのが重要です。

### Safety

- 実行前にコマンドを静的検査する
- policy file を読む
- 理由つきでブロックする

Safety は Runner より前に必ず通す必要があります。

### Runner

- ローカルまたは Docker 上でコマンドを実行する
- timeout、リソース制限、環境変数制限を扱う
- 実行結果を構造化して返す

### Judge

- 出力の正しさを判定する
- 失敗理由を次試行向けに返す
- 将来的に問題固有 judge を差し込めるようにする

### Formatter

- 最終回答を表示形式に変換する
- ログやデバッグ表示を整える

### Logs

- JSON ログの保存
- 過去実行の再読込
- 将来的な replay 機能への橋渡し

## 推奨する主要インターフェース

### Engine

```js
export class Engine {
  async generateCommand(context) {
    throw new Error("Not implemented");
  }
}
```

### Runner

```js
export class Runner {
  async run(command, options) {
    throw new Error("Not implemented");
  }
}
```

### Judge

```js
export class Judge {
  async judge(input) {
    throw new Error("Not implemented");
  }
}
```

## セッション単位で持ちたい情報

- `runId`
- `problem`
- `normalizedProblem`
- `engine`
- `judge`
- `runner`
- `attempts`
- `artifactsPath`
- `startedAt`
- `finishedAt`

## 今の実装からの拡張ポイント

- `runner/safety.js` は将来的に `safety/` ディレクトリへ分離できる
- `core/solve.js` は将来的に session 管理と retry 制御で分割できる
- `simpleJudge` は exact / regex / property 系へ広げやすい
- `mockEngine` は corpus ベースのルールエンジンとして発展させやすい

## 設計原則

- まずは単純な責務分割を守る
- モジュール同士はデータ構造でつなぐ
- 失敗理由は文字列ではなく、将来的には構造化データに寄せる
- 外部CLI依存は Engine 層に閉じ込める
- 後方互換よりも、安全で明快な責務分割を優先する
