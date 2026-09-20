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
- `cloudflare/src/location-api.ts`: 本人専用の自動位置ログ・記録担当の権利・一回用画面引き継ぎ。認証/Origin境界はworker.ts。公開APIに混ぜない。
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
- `cloudflare/public/input-flow.js` / `input-viewport.js`: 入力完了判定とフォーム内スクロール。iPhone実機での合格は別途確認。
- `cloudflare/public/record-save.js`: 保存と写真変換のロック、本文/写真の固定、同じ保存キーとactivity IDでの再試行。
- `cloudflare/public/auto-location.js`: 地図/開始/入力画面の自動位置UIと共通navigateWithCapture。リンク・記録ボタンを同じ引き継ぎへ通す。
- `cloudflare/public/location-capture.js`: 前面表示中の5分スケジュール、OFF、復帰、転送世代、遅い応答の無効化。
- `cloudflare/public/location-map.js`: 本人用位置の取得/フィルター/地図反映。通常記録の件数には加算しない。
- `cloudflare/public/record-display.js`: 本人/公開/位置のみの表示契約。内部の補完時刻と表示時刻を分離。
- `cloudflare/public/map-record-card.js`: 通常ピン/再生が共有する1枚の地点カードと写真の中断処理。
- `cloudflare/public/replay-model.js`: 固定再生データ、時間配分、記録到達、中断区間。`story.js`は別のログ付き再生。
- `cloudflare/public/shared.js`: DOM生成、通知など画面間の小さな共通処理。

## データと配備

- `cloudflare/migrations/`: D1スキーマの履歴。番号順に適用し、既存migrationを書き換えない。
- D1 binding `DB`: ユーザー、記録、旅、分類、取引、公開設定、足あと等の構造化データ。
- R2 binding `FILES`: 非公開添付、公開写真、ユーザーアイコンのオブジェクト。
- `cloudflare/wrangler.production.jsonc`: **本番環境で生成・保持するGit管理外ファイル**。本番Worker、D1、R2、公開変数の構成。秘密値はWrangler secretに置き、リポジトリへ保存しない。現在のGit正本から実値を復元できるとは扱わない。
- `cloudflare/scripts/cloudflare.mjs`: 本番Wrangler実行補助。実行にはCloudflare認証プロファイルと上記Git管理外設定が必要。チャット/GitHub接続だけで本番設定が存在すると推定しない。
- `cloudflare/scripts/prepare-assets.mjs`: npm依存から配信用アセットを準備するpredev/prebuild処理。

### 自動位置のDBと索引（PR #8）

- `0011-location-samples.sql`: 位置ログと記録担当のテーブル。日時検索は`location_samples_user_time(user_id,captured_at,id)`、重複/削除は位置の主キー`(user_id,id)`。
- `0012-location-handoff.sql`: 記録担当の行に一回用引き継ぎのハッシュ/期限/移動先/消費結果を追加。既存の主キー`(user_id,client_id)`で1行へ絞るため、トークン単独索引は追加しない。
- 0012はALTER TABLEを含むため一度だけ適用。既存migrationを書き換えず、`schema-extra.sql`の新規初期化にも反映する。
- ソースにあることと本番適用は別。PR未マージ/未配備の間は本番作成済みと扱わない。

## 検証

`cloudflare/` で実行する。

- `npm test`: Worker/APIのNodeテスト。
- `npm run check`: TypeScript型検査。
- `npm run build`: アセット準備を含むWrangler dry-run。
- `cloudflare/tests/api.test.ts`: 認証、API、CSP、障害時挙動を含む主要な自動テスト。

### PR #8の回帰試験への索引

| 対象 | テスト |
|---|---|
| 保存競合/通信再送 | `cloudflare/tests/record-save.test.ts` |
| 位置/一回用引き継ぎ/索引/所有者 | `cloudflare/tests/location-api.test.ts` |
| 本物のWorkerとローカルD1経由の引き継ぎ | `cloudflare/tests/worker-handoff.test.ts` |
| 入力/再生モデル/OFFと転送競合 | `cloudflare/tests/ux-state.test.ts` |
| 既存DB更新と新規初期化 | `cloudflare/tests/check-location-migration.py` |
| 10万件の合成データで索引/ページング同値性 | `cloudflare/tests/check-location-indexes.py` |
| 独立したブラウザ操作試験 | `cloudflare/tests/browser-smoke.py`（API/GPS/描画を代替） |
| 実MapLibre/WebGLの限定試験 | `cloudflare/tests/browser-real-map.py`（空の地図スタイル/API/GPSは合成） |

CIは`.github/workflows/ui-location-checks.yml`。core/browserは独立したジョブ。合格判定は対象コミットの実行結果による。iPhone・実測GPS・実地図タイルの合格を意味しない。

## 現在の公開状態（2026-09-20）

- Issues #2〜#7 は PR #8 で main にマージ済み。merge commit: `b6ad5ac574545a79211018cf041680a9afbd1f04`。
- マージ直前 head `27c28a6817ff1b6a6f50cdc85a6a03d3f599bccf` の CI run `35509777387` は core/browser と実MapLibre/WebGL限定試験が成功。
- 本番D1へ0011/0012を順番に適用し、Worker Version `be322ae7-5354-41d3-82c9-91b672d513d1` を100%配備済み。公開APIと未認証の私的APIをスモーク確認済み。iPhone実機/実GPSは未確認。
- 本番D1は初期投入由来の既存スキーマを持つが、`d1_migrations`台帳は空。0011/0012はSQLファイルを直接実行した。Wranglerの`migrations apply`は既存の0001以降も未適用と表示するため、そのまま実行しない。
- Git管理下の `cloudflare/wrangler.jsonc` はローカル専用。実本番IDを含む `wrangler.production.jsonc` はGit管理外のため、本番作業前に実行環境で存在・対象アカウント/D1/R2を照合する。

## 正本

- Issue #2〜#7の実装・修正・配備条件: [docs/issues-2-7-implementation.md](docs/issues-2-7-implementation.md)（PR #8の作業内容。main/本番の状態とは区別）
- 運用・開始方法: `cloudflare/README.md`
- 設計判断: `docs/adr/`
- 旅行SNS化の合意済み要件と計画: `docs/sns-plan.md`
- 未完了と再開地点: rootの `HANDOFF.md`（Git管理外）
- 旧Firebase仕様・履歴: `docs/specification.md`、`docs/handover.md`、`docs/implementation_history.md`（履歴資料であり現行構成の正本ではない）
