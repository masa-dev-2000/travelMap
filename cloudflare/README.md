# Cloudflare版 TravelMap

本番は `https://travelmap.life-log-b97.workers.dev`（Worker `travelmap`、D1 `travelmap`、非公開R2 `travelmap-files`）。
Google OIDCで認証し、7日間の認証付き暗号化Cookieでログイン状態を保持する。D1障害時も認証と地図画面は利用でき、
D1由来の記録・プロフィールだけを一時停止として表示する。私的APIは503 `data_unavailable` を返す。

地図は1画面構成。ナビは「プロフィール／記録／設定」で、期間・件数を上部、更新者のStories型人物列を地図上に表示する。
右上は自動位置記録のON/OFFだけを常設し、地図種類とミュートは設定画面にある。2026-09-21時点の本番Versionは
`d43a7e3b-cb07-408f-905e-d8f1cbbf8512`、配備元コードはPR #14のmerge commit `6f8c4b0`。

## Issues #9〜#13 の本番反映（2026-09-21）

- 配備元は main の merge commit `6f8c4b09ed8cf14da3b773ddf813a71d8582d8cf`。マージ直前 head `4bafc50` の CI run `35518255675` が core/browser とも成功し、マージ結果のツリーは検証済み head と同一。ローカルでも型検査・Nodeテスト83件・ビルド・0011..0015の移行統合・索引回帰・通常Chromium18件・実MapLibre7件＋ライフサイクル4件を再確認した。
- 本番D1 `travelmap`をSQLエクスポートでバックアップし、隔離SQLiteへ復元して件数一致・`integrity_check` ok・外部キー違反0を確認。保存先はGit管理外の`github-account-migration/data-backups/travelMap-production-2026-09-21-pre-0013-0015.sql`。
- 適用前に実構造を読み、`user_mutes`・`public_read_cursors`・`public_entry_sequence`が存在しないことを確認してから`0013`→`0014`→`0015`を`d1 execute --remote --file`で一度ずつ実行した。`d1_migrations`台帳は空のままで、これを根拠に再適用しない。0015は再実行不可（`ALTER TABLE ... RENAME`と`CREATE TABLE`を含む）。
- 適用後に列・索引・外部キーを確認。`public_read_cursors`は`last_seen_seq`形式、旧`public_read_cursors_legacy`はアーカイブとして保持。既存users 4件・activities 353件・transactions 267件・public_entries 353件・支出合計396,095円を維持。
- 本番Workerは上記Versionを100%配備。既存secret（`GOOGLE_CLIENT_SECRET`・`SESSION_ENCRYPTION_KEY`）は再作成していない。公開画面・公開API・新規JS資産は200、未認証の`/api/private/me`・`viewer-feed`・`mutes`・`read-cursor`は401。
- 本人の認証済みセッションで`/api/private/viewer-feed`と`/api/private/mutes`が200を返し、`publication_seq`（299〜351）と`unread`が機能することを確認。`public_entry_sequence`は初回観測で353件を採番した。
## 未読順の振り直し（0016、2026-09-21）

テスト用閲覧者アカウントでの本番検証で、未選択時の未読再生が時系列でないことを検出した。`ensurePublicOrder` の採番は `ORDER BY COALESCE(publish_at,''), rowid` で、既存の公開記録は全件 `publish_at` が NULL のため、0015の一括採番が取り込み順にフォールバックしていた。masaの300件で日付の逆転140か所（7日以上戻る106、最大249日）。

`0016-reseed-public-order.sql` を本番へ一度だけ適用し、既存353件を `date` → `occurred_at` → `id` 順へその場で振り直した。表定義と `AUTOINCREMENT` は無変更で、後から公開された記録は日付に割り込まず大きい番号を取る。旧採番を指していた既読カーソルは0へ戻した（未読を黙って隠さないため）。適用後: 逆転140→0、seq 1〜353連番、補助表の残留なし、外部キー違反0、既存データとミュートは維持。Workerコードは無変更のため再配備していない。

## 本番で確認した再生・ミュート（2026-09-21）

テスト用閲覧者アカウント `traveler-f8ddc6`（Google連携あり、旅モード・公開ともオフ）で実施。書き込みはこのアカウントの行だけで、masaの既読カーソル・ミュートは0行のまま。

- 未選択＝非ミュートの未読だけを `publication_seq` 順に1人ずつ。masa 300/300完了後にみさき 1/16へ自動遷移
- 既読になった人物は既定再生から外れる。選択中は既読も含めて期間内を再生し、空期間でも全期間へ戻らない
- 速度はタップで 1.0→1.5→2.0→4.0→0.5→1.0。スライダーは再生位置（18/300→225/300でカードも追従）。記録カードは閉じても再生継続
- ミュートは設定内で切替え、Stories列・地図マーカー・記録・再生キューから同時に除外
- 設定を開くと位置を保持したまま停止し、閉じても自動再開しない。読み込み直後でも再生を開始できる
- 振り直し後のカードは `2025/4/7 11:36 → 4/8 12:18 → 4/8 12:52 → 4/8 14:18` と時刻まで昇順

- 未確認: 位置なし記録のピン挙動（本番に該当記録が0件）、非表示タブからの復帰（自動操作でタブを実際に非表示にできず）、iPhone実機、実GPS。
- Workerの復旧は旧Version `be322ae7-5354-41d3-82c9-91b672d513d1`へ戻す。DBは追加テーブルを削除せず、新しい書き込みを確認してからバックアップとの整合を取る。

## Issues #2〜#7 の本番反映（2026-09-20）

- 本番D1 `travelmap`をSQLエクスポートでバックアップし、復元可能なことを確認。保存先はGit管理外の`github-account-migration/data-backups/travelMap-production-2026-09-20-pre-0011-0012.sql`。
- 既存テーブルはあるが`d1_migrations`台帳は空。Wranglerの`migrations apply`は使用せず、`0011-location-samples.sql`、`0012-location-handoff.sql`を順番に`d1 execute --remote --file`で直接一度ずつ実行した。今後も台帳の一覧だけを根拠に再適用しない。
- `location_samples_user_time(user_id,captured_at,id)`、引き継ぎ用5列、外部キー違反なしを本番D1で確認。既存users 4件、activities 353件を維持。
- 本番Workerは上記Versionを100%配備。公開画面・公開API・追加JS資産は200、未認証`/api/private/me`は401。本人ログイン、iPhone実機、実GPS、画面ロック/復帰、キーボード、カメラ撮影/復帰は未確認。
- Workerの復旧は旧Version `f9c82219-6386-4866-ad1d-665ce51959c1`へ戻す。DBは追加テーブル/列を削除せず、新しい書き込みを確認してからバックアップとの整合を取る。

## 正本への入口

- [CODEMAP](../CODEMAP.md): 現行コードの入口と責任境界
- [ADR](../docs/adr/README.md): 実装済みの主要な設計判断
- [旅行SNS化 開発計画](../docs/sns-plan.md): 合意済み要件と計画
- `HANDOFF.md`: 未完了と再開地点（リポジトリroot、Git管理外）

以下のPhase記録は初回移行時の手順・履歴として残す。

## Phase 1：ローカルで確認する

このフォルダで `npm ci` → `npm run dev`。画面は `http://127.0.0.1:8787/admin/`。
`wrangler.jsonc` はローカル専用。公開用エントリーポイントは `src/worker.ts`、
ローカル用は `src/local.ts`。後者はlocalhost以外へのアクセスを拒否する。

| 実装済み | 動作 |
|---|---|
| 行動 | 一覧・地図・追加・現在地入力・評価・任意の円支出を同時保存 |
| 家計 | 支出・収入・返金・外貨入力、月/旅の集計、取引一覧 |
| 旅・分類 | 追加・選択。既存分類IDを維持 |
| 添付 | 行動へのPNG/JPEG/PDFの非公開添付、8MiB上限 |
| 公開 | 日付・文章・場所名・任意の座標・PNG写真を明示選択、公開解除 |
| 認証 | 本人用画面/APIでAccess JWTの署名・期限・発行元・宛先・本人メールを検証 |

備考：予算・食事レビュー等のモデルデータは維持するが、この初期画面からの編集は未対応。
既存記録の編集・削除、要確認解消、添付と取引の関連編集も追加工程。
地図は読み込んだ行動を表示し、100件ごとに追加読込する。月フィルタは収支・取引に適用する。
フォームの日時は端末のタイムゾーン、月集計は日本時間。

## Phase 2：アカウントと認証を分ける

1. Cloudflare管理画面から新アカウントを作成し、名前とAccount IDを確認する。
2. `npx wrangler auth create travelmap` で、そのアカウントだけを選択して認証する。
3. `npx wrangler auth activate travelmap <このcloudflareフォルダの絶対パス>` で紐づける。
4. `npx wrangler whoami --profile travelmap` で対象が一致することを確認する。

備考：共通の `CLOUDFLARE_API_TOKEN` 等は専用プロファイルより優先される。
他案件の資格情報を変更せず、環境変数の混入がない子プロセス/ターミナルを使う。
アカウント名・ID・認証は未確定のため、本番設定ファイルはまだ作成していない。

## Phase 3：クラウド側の作成と設定

対象・影響・復旧方法を提示して承認後、新アカウント内に次を作成する。

- D1データベース `travelmap`。
- 非公開R2バケット（例：`travelmap-files`）。`r2.dev` と公開ドメインは有効化しない。
- Worker名 `travelmap`。公開URLはアカウント側のworkers.devサブドメイン確定後に決まる。
- Zero Trust / AccessのSelf-hosted application。本人用の `/admin`、`/admin/*`、`/api/private/*` を保護し、
  Allow条件は本人メールのみ。`/`・`/api/public/*` は公開用。

Accessが入口を保護したうえでWorkerもJWTを検証する。URLや設定漏れによる直接アクセスでも、
有効な本人JWTがなければ非公開データを返さない。公開の認証バイパス条件は追加しない。
初回のAccess設定にWorkerの作成が必要な場合、認証情報未設定で全privateリクエストが拒否される
本番エントリーポイントを先に配備し、設定完了後に本人のアクセスを検証する。

取得したID等を次のコマンドへ渡す（プレースホルダーは実値に置換）。

```text
node scripts/configure-production.mjs --account-id ACCOUNT_ID --database-id DATABASE_ID --bucket BUCKET_NAME --issuer https://TEAM.cloudflareaccess.com --aud ACCESS_AUD --owner-email OWNER_EMAIL
```

生成する `wrangler.production.jsonc` はGit対象外。Account IDを固定し、
`src/worker.ts` を使い、プレビューURLは無効にする。
以降の本番コマンドは `node scripts/cloudflare.mjs ...` を使う。

備考：設定作成自体は公開しない。R2やZero Trustの利用開始で請求先・プランの入力が必要な場合は本人が確認する。

## Phase 4：新規D1へ投入する

元DBは `../github-account-migration/data-backups/travelMap-model-v1.sqlite`（リポジトリ基準）。
`export_d1.py` は来歴と変換内容を照合し、既存モデルからSQLを生成する。

```text
python export_d1.py --database ../../github-account-migration/data-backups/travelMap-model-v1.sqlite --backup ../../github-account-migration/data-backups/travelMap-2026-09-08T06-00-30-628Z --output ../../github-account-migration/data-backups/travelMap-d1-import-v1.sql
```

出力は新規ファイルを指定。既存SQLがあれば勝手に上書きしない。
投入対象が空であることと対象アカウントを確認後に実行する。

```text
node scripts/cloudflare.mjs whoami
node scripts/cloudflare.mjs d1 execute travelmap --remote --file ../../github-account-migration/data-backups/travelMap-d1-import-v1.sql
```

備考：元モデルの17テーブルに、公開座標・R2公開画像参照・二重保存防止の3テーブルを追加。
原本照合で行動298・支出229・原本486件と金額を検証する。
古いローカルの添付がある場合、ファイルのR2移行なしでSQLだけ投入することは拒否する。
現在のバックアップには添付がない。検証中の `.wrangler` DBは本番投入元に使わない。

## Phase 5：公開前の検証と公開

Googleログイン後のセッションは、D1ではなく7日間の認証付き暗号化Cookieで維持する。
本番デプロイ前に32バイトのランダム鍵をbase64url形式で生成し、値を表示・保存せず
`node scripts/cloudflare.mjs secret put SESSION_ENCRYPTION_KEY` で登録する。
このsecretが無い状態では新しいログインを拒否する。鍵の交換は全利用者の強制ログアウトになる。
D1障害時はGoogle認証状態を維持し、私的データAPIだけ503 `data_unavailable` とする。

```text
npm run check
npm test
npm run build
node scripts/cloudflare.mjs deploy --dry-run
```

`npm run build` はローカル用バンドルの検証。本番用もdry-runし、本人ログイン・匿名アクセス拒否・
公開内容・写真・件数・取引合計を確認する。公開直前に対象アカウント、URL、配信ファイルと
復旧方法を示して承認を得た後、`node scripts/cloudflare.mjs deploy`。

配信ディレクトリは `public/` のみ。DB・SQL・原本・ローカル資格情報を配信しない。
公開画像はR2の独立したコピー。EXIF等を除去した静止PNGだけを公開し、領収書は拒否する。
公開解除後は画像APIも拒否するが、閲覧者が保存したコピーは取り消せない。
再公開で古いR2コピーが未参照になることがある。非公開のまま残し、削除は別途行う。

復旧：既存Firebaseは維持する。初回公開に問題があれば新Workerの公開を止める。
稼働後はWorkerのロールバックとDBの復元を別々に扱い、新しい入力を失わない復旧手順を取る。
切り替え前には元Firebaseの最終バックアップと以後の書き込み差分を確認する。

## 確認済み（2026-09-09）

- D1ローカルへSQL取り込み成功。原本486件・変換行動298件・合計332,835円が一致。
- Workers APIテスト7件成功（認証、CSRF、二重保存、原子的保存、月境界、返金、公開画像等）。
- 型チェック、ローカルdry-run、依存パッケージ監査成功。
- PC/スマホ幅で地図・集計・入力画面を確認。ブラウザから検証用行動1件を保存し、再表示を確認。
  `.wrangler` のローカルDBにはこの検証用記録が追加されている。本番投入用SQL・元モデルDBは変更していない。
- 本番アカウント・Access実環境・本番デプロイは未検証。

参考：[Access JWT検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)、
[D1移行](https://developers.cloudflare.com/d1/best-practices/import-export-data/)、
[Wrangler認証プロファイル](https://developers.cloudflare.com/workers/wrangler/profiles/)。

## 本人用の地図切り替え（2026-09-09）

右上の「地図」からLiberty（初期値）・Bright・Fiord・3Dを選べます。MapLibre GL JS 6.8.0とOpenFreeMapを利用し、選択をブラウザに保存します。3DはLibertyの建物を立体表示（ズーム14以上）し、地形の立体表示は含みません。2Dへ戻すと傾き・回転を解除します。地図の中心・ズーム・区間選択は種類の切り替えで維持します。

本人用ページだけMapLibreへ移行し、公開ページはLeafletを継続。地図の色を薄くするフィルターはありません。外部通信の許可は本人用ページとMapLibre workerのOpenFreeMap接続に限定しています。依存資産は `node scripts/prepare-assets.mjs` で用意します。

4種類の描画、3D建物、区間保持、選択の再読み込み、PC・390px幅の表示を確認。型チェックとAPI/CSPテスト8件成功。本番公開・実機タッチ・通信障害からの復帰は未検証です。
