# npm Publish Plan

ShellGeiAI を npm package として公開するための実行計画です。現在のリポジトリ実装状況を反映し、GitHub Actions 上の CI と OIDC trusted publishing を前提に、完了済み項目と残作業を整理しています。

## Goal

- GitHub Actions 上で `npm test` と最低限の CLI 起動確認が通る状態を維持する
- `npm publish` を GitHub Actions の release workflow からのみ実行する
- npm token を保存せず、npm trusted publishing と GitHub OIDC で公開する
- 公開後に README と配布物の内容が実際の package と一致する状態にする

## Current Status

次の項目は実装済みです。

- `.github/workflows/ci.yml` を追加し、push / pull_request で `npm ci` と `npm test` を実行する
- CI で Node.js 20 / 22 の matrix test を回す
- `test/dockerRunner.unit.test.js` の既知失敗を解消し、CLI help 系の回帰テストを追加する
- `node src/cli.js --help` と `node src/cli.js solve --help` を CI と release workflow で確認する
- `npm pack --dry-run` と tarball からの install 検証を CI に含める
- `package.json` に `repository`、`homepage`、`bugs`、`author`、`engines`、`publishConfig`、`files` を追加する
- `README.md` と `LICENSE` を package に含める
- `LICENSE` を Apache-2.0 に揃える
- release 運用手順を `docs/npm-publish-checklist.md` に追加する

## Current Gaps

現時点で残っているのは、主に実運用と外部設定です。

- npm 側で `shellgeiai` package と trusted publisher の設定をまだ行っていない
- GitHub Release を起点にした実 publish はまだ実施していない
- publish 後の `npm view shellgeiai version` 確認と、別環境での最終導入確認は未実施
- 実作業で使った検証生成物や未コミット変更の整理がまだ残っている

## Phase 1. CI と package 構成を維持する

- [x] `.github/workflows/ci.yml` を追加し、push と pull_request で `npm ci` と `npm test` を実行する
- [x] CI で検証する Node.js 対応バージョンを決め、matrix test にする
- [x] `test/dockerRunner.unit.test.js` の既知失敗を解消する
- [x] `node src/cli.js --help` など、最低限保証したい CLI 起動確認を workflow に含める
- [x] `npm pack --dry-run` と tarball install で配布形態に近い検証を行う

## Phase 2. npm package metadata と配布対象を固定する

- [x] `repository`、`homepage`、`bugs`、`author`、`engines` を追加する
- [x] `publishConfig` を追加し、registry と access 方針を固定する
- [x] `keywords` を npm 検索で見つけやすい内容に見直す
- [x] `files` フィールドで配布対象を絞る
- [x] `test/`, `plan/`, `logs/`, `AGENTS.md`, 作業用 docs を package に含めないようにする
- [x] `README.md` と `LICENSE` が package に含まれることを `npm pack --dry-run` で確認する
- [x] `LICENSE` と `package.json` の `license` を Apache-2.0 に揃える

## Phase 3. README と利用者導線を公開後の状態に合わせる

README の方針は、利用者向け最小情報だけを残し、開発者向け情報は `docs/development.md` に寄せる形で確定しています。

- [x] 「まだ publish していない」という記述を削除する
- [x] README を利用者向け最小構成に絞る
- [x] install 手順を `npm install -g shellgeiai` 中心に整理する
- [x] 開発者向け情報を README から外し、`docs/development.md` 側に寄せる
- [ ] 必要なら公開後に README の文言を実 package 名や導入結果に合わせて微調整する

## Phase 4. Release workflow と publish 手順を固定する

- [x] `.github/workflows/release.yml` を追加する
- [x] release workflow で `npm ci`、`npm test`、CLI help、`npm pack --dry-run` を実行する
- [x] release tag と `package.json` version の整合チェックを入れる
- [x] `npm publish --provenance` を workflow から実行する
- [x] release 作成から publish 完了までの運用手順を `docs/npm-publish-checklist.md` に残す

## Phase 5. 外部設定と初回公開を実施する

- [ ] npm 側で `shellgeiai` package を作成する
- [ ] npm trusted publisher に GitHub repository `amanoese/shellgeiai` を登録する
- [ ] GitHub Release を作成し、release workflow で初回 publish を流す
- [ ] workflow 成功後に `npm view shellgeiai version` で公開版を確認する

## Phase 6. 公開後検証と運用を固定する

- [ ] 別環境で `npm install -g shellgeiai` を試し、導入手順を検証する
- [ ] 必要なら `npx shellgeiai --help` も公開後に確認する
- [ ] README の install 手順と実際の配布物が一致することを確認する
- [ ] 問題発生時の `npm deprecate`、release 差し止め、次版での修正方針を運用に乗せる

## Immediate Next Actions

直近でやるべき作業は次の通りです。

1. 未コミット変更を整理し、検証用 tarball など不要物を除いて commit する
2. npm の trusted publisher 設定を完了する
3. version を更新して GitHub Release を publish する
4. 公開後に `npm view` と別環境 install で最終確認する
