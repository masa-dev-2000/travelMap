# TravelMap CODEMAP

現行のCloudflare版について、入口と責任境界を示す。全ファイル一覧ではない。旧Firebase版は `archive/` に保存され、現行実装ではない。

## 実行時の入口

- `cloudflare/src/worker.ts`: 本番Workerの入口。公開API、Google認証、私的API、静的アセットへのルーティングとセキュリティヘッダーを担当する。
- `cloudflare/src/local.ts`: ローカル開発用の入口。localhost以外を拒否し、本番Workerへ処理を渡す。
- `cloudflare/public/index.html` / `app.js`: 共通の地図画面。公開セッションを確認し、公開機能を常時、自分用機能をログイン時だけ読み込む。
- `cloudflare/public/admin/start/`: 記録開始画面。
- `cloudflare/public/admin/record/`: 記録編集・保存画面。
- `cloudflare/public/signup/`: 初回ログイン後の規約同意とプロフィール設定。

## Worker側の責任

- `cloudflare/src/auth.ts`: Google OIDC（PKCE・state・nonce）、暗号化セッションCookie、ユーザー解決、ログアウト、認証エラー画面。本人確認はD1から分離し、D1はアプリ内ユーザー解決にだけ使う。
- `cloudflare/src/api.ts`: 公開・私的API、D1クエリ、R2添付、公開スナップショット、設定、サインアップを担当する。私的データは認証済み `user.id` で絞る。
- `cloudflare/src/validation.ts`: API入力の検証と正規化。
- `cloudflare/src/png.ts`: アイコン画像のPNG処理。
- `cloudflare/src/env.d.ts`: Worker bindingsと環境変数の型定義。

## ブラウザ側の責任

- `cloudflare/public/map-shell.js` / `map-shell.css`: PC・SP共通の地図シェル、ナビゲーション、パネル配置。
- `cloudflare/public/panel-everyone.js`: 公開記録、人物、期間フィルター、取得失敗時の縮退表示。
- `cloudflare/public/panel-me.js`: ログイン中だけ読み込む私的記録、旅、分類、収支、公開設定、プロフィール。
- `cloudflare/public/owner-map.js` / `owner-route.js`: MapLibre上の本人用地点・経路・区間選択。
- `cloudflare/public/route.js`: 公開記録の経路データ構築。
- `cloudflare/public/replay.js`: 記録順に正規化した旅のリプレイ。
- `cloudflare/public/shared.js`: DOM生成、通知など画面間の小さな共通処理。

## データと配備

- `cloudflare/migrations/`: D1スキーマの履歴。番号順に適用し、既存migrationを書き換えない。
- D1 binding `DB`: ユーザー、記録、旅、分類、取引、公開設定、足あと等の構造化データ。
- R2 binding `FILES`: 非公開添付、公開写真、ユーザーアイコンのオブジェクト。
- `cloudflare/wrangler.production.jsonc`: 本番Worker、D1、R2、公開変数の構成。秘密値はWrangler secretに置き、ファイルへ保存しない。
- `cloudflare/scripts/cloudflare.mjs`: プロジェクト固有のWrangler実行補助。
- `cloudflare/scripts/prepare-assets.mjs`: npm依存から配信用アセットを準備するpredev/prebuild処理。

## 検証

`cloudflare/` で実行する。

- `npm test`: Worker/APIのNodeテスト。
- `npm run check`: TypeScript型検査。
- `npm run build`: アセット準備を含むWrangler dry-run。
- `cloudflare/tests/api.test.ts`: 認証、API、CSP、障害時挙動を含む主要な自動テスト。

## 正本

- 運用・開始方法: `cloudflare/README.md`
- 設計判断: `docs/adr/`
- 旅行SNS化の合意済み要件と計画: `docs/sns-plan.md`
- 未完了と再開地点: rootの `HANDOFF.md`（Git管理外）
- 旧Firebase仕様・履歴: `docs/specification.md`、`docs/handover.md`、`docs/implementation_history.md`（履歴資料であり現行構成の正本ではない）
