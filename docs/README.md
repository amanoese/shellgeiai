# Docs

`docs/` は ShellGeiAI の将来像と設計意図をまとめる場所です。

現在は次の文書を置いています。

- `development.md`: 開発環境セットアップと現状実装の案内
- `ideal-cli-flow.md`: 理想的な CLI 実行フロー
- `ideal-architecture.md`: 理想的な責務分離とアーキテクチャ
- `policies.md`: command policy / sandbox policy の配置規約と JSON schema

実装との差分を埋めるための実行計画や運用計画のアーカイブは `plan/` に分離しています。

現在の通常実行経路は `DockerRunner` が既定で、`solve` は Docker を前提に動作します。`logs list` / `logs search` / `logs prune` の運用導線は `README.md` を参照してください。
