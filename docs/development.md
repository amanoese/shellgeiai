# Development

`docs/development.md` は ShellGeiAI の開発者向け情報をまとめるページです。

## 開発環境セットアップ

前提:

- Node.js 20 以上
- npm
- Docker を使った通常実行を試す場合は Docker

セットアップと基本確認:

```bash
npm install
npm test
```

JavaScript 版のため、ビルドは不要です。互換用に次のコマンドは no-op です。

```bash
npm run build
```

ローカル開発では次のコマンドで CLI を直接起動できます。

```bash
npm run dev -- solve "CSVの3列目の合計を出してください"
```

CLI エントリポイントは `src/cli.js` です。CLI コマンド名は `shellgeiai` です。

## 現状と理想像

このリポジトリには 3 つのドキュメントレイヤがあります。

- 現状の実装: 単一 worker solve フローを保ちつつ、通常実行は `DockerRunner` を既定にした MVP
- `docs/` の理想像: 複数 SubAgent を Docker 内で並列実行し、planner / selector / judge / logs を分離する将来構成
- `docs/superpowers/` の作業計画: Codex Superpowers の SKILLS が生成する一時的な設計・実装計画

生成された作業計画 `.md` は追跡しません。過去の実行計画は git history を参照してください。

現在の `src/` は `cli / solve / execution / providers / io / shared` の大きな責務境界へ整理済みです。solve の進行は `src/solve/`、実行・安全性・判定は `src/execution/`、LLM/CLI provider は `src/providers/`、入出力と表示は `src/io/` に寄せ、段階的に理想構成へ近づけています。

MVP では、まず次の流れを最小構成で実現します。

- 問題文を読み込む
- Engine が候補コマンドを生成する
- Safety checker が危険なコマンドを検査する
- Runner が Docker 内でコマンドを実行する
- Judge が結果を確認する
- 成功なら整形済みの回答を表示し、失敗なら再試行する

## 主要コンポーネント

- `src/cli.js`: CLI 入口
- `src/cli/`: CLI コマンドと引数解析
- `src/solve/solve.js`: solve の薄い入口
- `src/solve/session/solveSession.js`: セッション初期化
- `src/solve/orchestration/orchestrator.js`: worker 実行オーケストレーション
- `src/solve/planning/planner.js`: LLM planner 結果を execution plan へ正規化する薄い入口
- `src/solve/selection/selector.js`: 現行の最小 selector
- `src/solve/worker/`: worker retry loop と attempt 実行
- `src/providers/engines/`: Engine 実装群
- `src/io/problem/`: 問題文正規化の入口
- `src/execution/runner/`: 実行基盤
- `src/execution/safety/`: command policy と sandbox policy
- `src/execution/judge/`: 判定器
- `src/io/logs/`: セッションログ出力
- `src/io/formatter/`: 結果表示
- `src/shared/`: ファイル・実行補助

将来的な理想構成では、次の責務分割を目指します。

- `src/solve/`: session / orchestration / planning / selection / worker
- `src/agents/`: SubAgent 実装群
- `src/execution/runner/`: Docker 実行基盤
- `src/execution/safety/`: command policy / sandbox policy
- `src/execution/judge/`: worker 一次判定と最終判定
- `src/io/logs/`: session / worker ログ

## 実装と運用の補足

- `DockerRunner` が通常実行の既定です
- `LocalRunner` は必要時の切り替え用で、Docker ほど強い隔離は提供しません
- LLM planner が返した variant から `workerTask[]` を作る planner contract と、`first-pass-wins` / `best-score-wins` の最小 selector を持ちます
- judge score と selector metrics は結果とログへ伝播されます

### Policy JSON

`command policy` と `sandbox policy` は、`solve` 実行時に次の option で差し替えられます。

```bash
shellgeiai solve "..." --command-policy ./policies/default-command-policy.json
shellgeiai solve "..." --sandbox-policy ./policies/default-sandbox-policy.json
```

既定サンプルは `policies/default-command-policy.json` と `policies/default-sandbox-policy.json` です。指定パスは `process.cwd()` 基準で解決されます。指定しない場合、command policy は `src/execution/safety/commandPolicy.js` の既定 deny-list、sandbox policy は `src/execution/safety/sandboxPolicy.js` の既定値を使います。

Command policy は、Bash AST から抽出した command name、redirection target、再帰的 background shell function をもとに拒否条件を定義します。

```json
{
  "blockedCommands": [
    {
      "name": "rm",
      "reason": "Blocked dangerous command: rm"
    },
    {
      "name": "curl",
      "reason": "Blocked network command: curl"
    }
  ],
  "blockedRedirectionTargets": [
    {
      "prefix": "/etc",
      "reason": "Blocked redirection to sensitive path"
    },
    {
      "prefix": "$HOME",
      "reason": "Blocked redirection to sensitive path"
    }
  ],
  "blockRecursiveBackgroundFunctions": true
}
```

- `blockedCommands[].name`: AST 上の command name と完全一致した場合に拒否します。
- `blockedCommands[].reason`: ブロック理由として利用者へ返します。
- `blockedRedirectionTargets[].prefix`: `>` または `>>` の出力先がこの prefix 配下の場合に拒否します。
- `blockedRedirectionTargets[].reason`: ブロック理由として利用者へ返します。実際の出力先 path は checker が末尾に付けます。
- `blockRecursiveBackgroundFunctions`: `f(){ f|f& }; f` や `:(){ :|:& };:` のような再帰的 background shell function を拒否します。
- `--command-policy` で外部ファイルを指定した場合、既定 policy へ merge せず、そのファイル内容だけを使います。

Sandbox policy は、runner に渡す sandbox 方針を定義します。

```json
{
  "networkAccess": "off",
  "filesystemScope": "workdir-only"
}
```

- `networkAccess`: `off` または `on`。`DockerRunner` では `off` が `--network none` に反映されます。
- `filesystemScope`: ログ、結果、runner 設定に渡す sandbox 範囲ラベルです。

Policy JSON は、読めない JSON、schema にないキー、空の必須文字列がある場合に load 時点で失敗します。`command policy` は AST ベースの静的チェックであり、完全な policy engine ではありません。primary workdir mount の writable / read-only は `--workdir` と `--writable-workdir` が制御します。

## 関連ドキュメント

- [README.md](/home/amanoese/repos/shellgeiai/README.md): 利用者向けの導入と使い方
- [docs/README.md](/home/amanoese/repos/shellgeiai/docs/README.md): `docs/` 全体の案内
- [docs/ideal-architecture.md](/home/amanoese/repos/shellgeiai/docs/ideal-architecture.md): 理想的な責務分離、アーキテクチャ、CLI 実行フロー
- [docs/superpowers/plans/](/home/amanoese/repos/shellgeiai/docs/superpowers/plans): Codex Superpowers が生成する作業用実装計画の置き場
