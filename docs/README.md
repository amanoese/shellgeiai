# Docs

`docs/` は ShellGeiAI の将来像と設計意図をまとめる場所です。

現在は次の文書を置いています。

- `development.md`: 開発環境セットアップと現状実装の案内
- `ideal-architecture.md`: 理想的な責務分離、アーキテクチャ、CLI 実行フロー
- `superpowers/`: Codex Superpowers の SKILLS が作業用の `specs/` と `plans/` を生成する場所。生成された `.md` は追跡しません。

`plan/` と `docs/archive/` は廃止しました。過去の計画は git history を参照してください。

現在の通常実行経路は `DockerRunner` が既定で、`solve` は Docker を前提に動作します。`logs list` / `logs search` / `logs prune` の運用導線は `README.md` を参照してください。
