# Policies

`command policy` と `sandbox policy` は、ShellGeiAI の safety 設定を外部 JSON で差し替えるための最小契約です。

現時点では CLI の公開 help には出していませんが、内部的には `solve` 実行時に次の hidden option で読み込めます。

```bash
shellgeiai solve "..." --command-policy ./policies/default-command-policy.json
shellgeiai solve "..." --sandbox-policy ./policies/default-sandbox-policy.json
```

## 配置規約

- リポジトリ同梱の既定サンプルは `policies/` に置きます
- 現在のサンプルは `policies/default-command-policy.json` と `policies/default-sandbox-policy.json` です
- 指定パスは `process.cwd()` 基準で解決されます
- policy を指定しない場合、command policy は `src/safety/commandPolicy.js` の既定 deny-list、sandbox policy は `src/safety/sandboxPolicy.js` の既定値を使います
- チーム運用用の preset を増やす場合も、まずは `policies/` 配下にまとめる前提です

## Command Policy Schema

command policy は「どのコマンド文字列を静的に拒否するか」を定義します。

```json
{
  "extendDefault": true,
  "blockedPatterns": [
    {
      "pattern": "(^|[^\\\\w])(awk)(\\\\s|$)",
      "flags": "i",
      "reason": "Blocked command: awk"
    }
  ]
}
```

フィールドは次のとおりです。

- `extendDefault`: optional boolean
- `blockedPatterns`: optional array
- `blockedPatterns[].pattern`: required string。`new RegExp(pattern, flags)` で解釈できる必要があります
- `blockedPatterns[].flags`: optional string。JavaScript の `RegExp` flags をそのまま渡します
- `blockedPatterns[].reason`: required string。ブロック理由としてそのまま利用者へ返します

挙動は次のとおりです。

- `extendDefault` を省略するか `true` にすると、既定 deny-list に追加で `blockedPatterns` を足します
- `extendDefault` を `false` にすると、既定 deny-list を使わず、指定した `blockedPatterns` のみを使います
- 不正な正規表現は load 時点でエラーになります
- 未知のキーは受け付けません

## Sandbox Policy Schema

sandbox policy は「runner に渡す sandbox 方針」を定義します。

```json
{
  "networkAccess": "off",
  "filesystemScope": "workdir-only"
}
```

フィールドは次のとおりです。

- `networkAccess`: optional enum。`off` または `on`
- `filesystemScope`: optional string。ログ・結果・runner 設定に渡す sandbox 範囲ラベル

挙動は次のとおりです。

- 省略時の既定値は `networkAccess: "off"` と `filesystemScope: "workdir-only"` です
- 読み込み時は既定値に overlay されます
- 未知のキーは受け付けません

## 現時点の実装上の注意

- `command policy` は静的な文字列チェックです。完全な policy engine ではありません
- `sandbox policy.networkAccess` は `DockerRunner` の `--network none` 制御に反映されます
- `sandbox policy.filesystemScope` は現時点では主に設定・ログ・表示のための値で、`DockerRunner` が値ごとに mount 権限を切り替えるところまでは未実装です
- `LocalRunner` は Docker のような強い隔離を提供しないため、本命の防衛線は将来的に Docker 側へ寄せる前提です

## エラー方針

次のような policy は load 時点で失敗させます。

- JSON として読めない
- schema にないキーを含む
- 必須文字列が空
- `blockedPatterns[].pattern` が不正な正規表現

この方針により、曖昧な設定のまま実行が進むことを避けます。
