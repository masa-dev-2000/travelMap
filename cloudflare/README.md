# Cloudflare公開準備

新しいTravelMap画面・Workers API・D1移行処理。既存Firebase画面は変更していない。
新アカウントの特定・リソース作成・Access設定・本番投入・公開は未実施。

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
