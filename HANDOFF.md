# TravelMap 再開メモ（2026-09-09）

ユーザー要望：新しいCloudflareアカウントを追加してTravelMapを公開したい。
「続きをやってください」で公開前の実装を進めた。本番への対外変更は直前に明示承認が必要。

- `data_model/`：ローカルモデル・バックアップ変換・原本照合・復元検証。前回の13テスト成功。
- `cloudflare/`：Workers、本人用/公開画面、D1 SQL出力、R2添付、Access JWT検証を追加。
  手順と範囲は [cloudflare/README.md](cloudflare/README.md)。
- APIテスト7件、型チェック、dry-run、依存監査成功。PC/スマホ表示とブラウザでのローカル保存確認済み。
- 元バックアップからD1ローカルへ取り込み、原本486件・行動298件・支出229件・合計332,835円を照合。
  その後、UI検証用行動1件をローカルDBだけに追加。公開対象0件。
- 移行SQLは `../github-account-migration/data-backups/travelMap-d1-import-v1.sql`。
  本番にはこの確認済みSQLを使い、テスト記録がある `.wrangler` DBを出力しない。
- ローカル開発サーバーを `http://127.0.0.1:8792/admin/` で起動した。次回は生存を確認する。
- 新アカウントの作成状況を選択式で質問済み、回答なし。`wrangler auth list` にtravelmapプロファイルなし。
  アカウント未確定のため本番設定ファイルなし。Account IDを推測しない。
- 本番のリソース作成、Access設定、SQL投入、デプロイ、push/commitは未実施。Firebaseも変更なし。

次：新アカウントの状況・IDを確認し、専用プロファイルとD1/R2/Access設定を準備。
公開直前に対象・影響・復旧方法を示して承認を得る。既存Yuiサイトの認証・配備設定を流用しない。

## 04案の本体反映（2026-09-09）

- ユーザーが10案から04「細い操作レール」を選び、`go` で本体反映を承認。
- `cloudflare/public/map-shell.js`・`map-shell.css` を追加し、本人用・公開用を地図全面の構造に変更。PC左レール／スマホ下レール、開閉パネル内部だけスクロール。
- 本人用は行動APIの全ページを自動取得。ローカルで実記録298件＋以前のテスト1件＝299件、地図上298件を確認。今回はデータの追加・変更なし。
- 記録一覧は折りたたみ、開くと詳細・添付・公開操作。ピンから一覧詳細を開ける。収支の月は初期状態で全期間、月変更時に集計・取引を更新。
- 全期間支出332,835円を確認。型チェック・既存APIテスト7件・JS構文確認成功。PC/スマホ、縮小した入力画面、公開確認ダイアログの未選択状態とキャンセルを確認。
- 実機のタッチ・ソフトウェアキーボードは未検証。本番公開、クラウドデータ変更、commit/pushは未実施。ローカル本体は http://127.0.0.1:8792/admin/ 。

### 通ってきたルート

- 元の `travelMap/script.js` の `renderLogs` に合わせ、本人用地図の全地点を日時昇順・同時刻はID順で接続。`public/route.js` に分離。
- 白（古い）からオレンジ（新しい）の区間色、始点・最新のラベル、表示切替を追加。地点同士の直線接続であり、道路上の走行軌跡ではない。
- 実データ298地点／297区間、始点2025-04-07・最新2025-12-17を確認。切替後もピン298件を維持。並び順・同時刻・不正座標/日時除外・空/1件・入力不変を検証。
- 公開用APIや公開範囲は変更なし。実データの追加・変更なし。

### ルートの見せ方を整理（上記の色分けを置換）

- 合意済み計画を実装。本人用のみ背景を淡くし、全体を青緑2.5pxの単線で表示。旧グラデーション・太い縁取り・全体での常設ピンを廃止。
- ズーム11以上で「移動」以外の記録ピンを表示。区間選択中は出発・到着の2点に絞る。
- 区間は透明16px幅で選択し、オレンジ4pxで強調。共通パネルに両端の日時・場所・メモ、前後ボタンを表示。閉じる・他メニュー・全体で解除。
- 全ルートボタンと始点／最新ラベルからも区間を選択可能。0件・1件は区間操作なし。同位置間の記録も前後操作で確認できる。
- 実データ298地点・297区間、線クリック、前後移動、末尾で次ボタン無効、解除、拡大時ピン、PC/390px/360pxでスクロールなしを確認。並び順・不正座標等のチェック成功。
- API・DB・公開ページの表示方針は変更なし。地図スタイルは本人用クラスに限定。
- その後ユーザーから背景を淡くすると読みにくいとの指摘。背景地図のフィルター・透明度変更を撤去し、元の色・濃さに戻した。ルートの細線・区間選択は維持。

### 地図4種類の切り替え（最新・2026-09-09）

- 本人用地図をMapLibre GL JS 6.8.0へ移行。右上でLiberty・Bright・Fiord・3Dを切り替え、選択後はメニューを閉じる。初期値Liberty、最後の種類をlocalStorageに保存。
- 切り替え時の中心・ズーム・区間選択を維持。3DはLibertyの建物押し出しと傾斜50度。2Dでは傾き・回転解除。地形3Dは対象外。
- owner-map.js / owner-route.js を追加。298地点・297区間の全ルートと区間選択を維持、Fiordでは線色を明るく変更。拡大時に移動以外の記録点を表示。画面サイズ変更時はルートを再配置。
- CSPのOpenFreeMap接続許可は本人用ページ・MapLibre workerのみ。ローカル配信資産の準備スクリプトを更新。公開ページはLeafletのまま。
- 4種類、立体建物、区間保持、再読み込み後の種類保存、PC/390px幅のスクロールなしをブラウザ確認。型チェック・API/CSPテスト8件成功、依存監査0件。実機タッチ・通信障害復帰は未検証。
- データ変更、本番公開、commit/pushなし。ローカル299件（実記録298＋以前の位置なし検証1件）。確認画像はリポ外 data-backups/travelMap-ui-04/basemaps/。


## 複数ユーザー化・Googleログイン（2026-09-18）

- 本番は版 150bd626。`src/auth.ts` を Google OIDC（PKCE, nonce, セッションcookie `tm_session` 30日）に置き換え。Access JWT は所有者メール一致時のみ移行期間の代替として残る。
- D1 本番に migrations/0002（users/sessions/user_settings と各表の user_id、public_entries.precision/publish_at）と 0003（所有者 @masa に298件を紐づけ）を適用済み。孤立行0を確認。
- 私的APIは全て user_id で絞る。編集 `PATCH-like POST /api/private/activities/:id`、金額 `/amount`、削除 `DELETE`、公開設定 `/public-entries/:id/options`、`/api/private/settings`（publish_default / publish_precision / publish_delay_hours / display_name）。
- 公開フィードは precision（exact/city/hidden）と publish_at で丸め、author(handle)・category_name・spent_jpy を返す。`?u=handle` で作者絞り込み。
- 5観点×3反証のレビュー（137エージェント）で36件を確認し、高・中の実害があるものは修正済み。残課題: 401後の戻り先(next)、公開時の trip/category/金額のスナップショット化、request_receipts のユーザー分離は uid 接頭辞で対応済み。
- 未実施: Google ログインの本番動作確認（所有者が実施）→ 確認後に Cloudflare Access アプリ travelmap-owner を削除し、ACCESS_* vars とフォールバックを撤去する。
- Google OAuth: 同意画面は「テスト」状態。他人に公開する前に「本番」へ切替（機密スコープ無しのため審査不要）。シークレットは wrangler secret `GOOGLE_CLIENT_SECRET`。

## 1つの地図に統合・リプレイ・足あと（2026-09-18）

- `/` が唯一の地図ページ（MapLibre）。未ログインは公開データのみ、ログインで「じぶん」「＋」と右上アイコンの設定シートが増える。`/admin/` は `/` へ302、`/admin/start/` `/admin/record/` は従来どおり。Leaflet 版 public.js は撤去。
- 構成: `public/app.js`（入口・`GET /api/public/session` で判定）、`panel-everyone.js`（みんな一覧・タイムライン絞り込み・線とアイコン）、`panel-me.js`（ログイン時だけ動的 import。私的データは /api/private/* のみ）、`replay.js`、`map-shell.js`（action 付きレール）。
- 設定は 旅モード（map_visible + 自動オフ `map_visible_until`、`map_visible_days` で指定）/ 見せ方 / プロフィール。公開側の判定は `travelling()`（api.ts）に集約。
- 公開フィードに `at`（時間差公開なし・公開日未編集のときだけ正確な時刻）を追加し「3時間前」表示に使用。
- リプレイは時刻でなく記録順で約15秒に正規化。足あとは `footprints` 表（migrations/0007 本番適用済み）、1日1回・自分不可・数字なし、既読は user_settings.footprints_seen_at。
- 本番版 a67acceb。テスト22件。未確認: 自動操作タブが hidden のため地図キャンバス上の線・リプレイ描画の目視、スマホ実機、未ログイン画面のブラウザ目視（curl とローカルDOMのみ）。ローカルD1は旧スキーマのままで dev では API が500になる。
