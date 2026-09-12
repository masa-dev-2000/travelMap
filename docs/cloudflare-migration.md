# Cloudflare移行：実行状況と再開手順

## 現状（2026-09-12）

**移行未完了。準備用ブランチであり、本番公開・データ移行・認証移行は行っていません。**

- 元コード: `d6c52a8e84f8581b32c4d4a8d7a0a08ac77f327b`
- コードの退避: `backup/pre-cloudflare-20260912`（実データのバックアップではありません）
- 作業ブランチ: `migration/cloudflare-20260912`
- 認証チェック: https://github.com/masa-dev-2000/travelMap/actions/runs/34669185216
- 上記の実行では `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `FIREBASE_SERVICE_ACCOUNT` がすべて未設定。別名の全SecretsやCodespacesのSecretsを網羅した判定ではありません。
- Cloudflareアカウント内の現行公開先、Firebase実データ件数、実際に適用中のルールは未確認です。

## 追加したもの

- `scripts/firebase-backup.mjs`: Firestore `(default)` の全コレクションとサブコレクション、Authユーザー、既知のRealtime Databaseを読み取り専用で書き出す準備コード。
- 同じFirestore readTimeで一覧と内容を取得。REST形式を保持し、64ビット整数・ナノ秒日時・参照の変換による欠損を避けます。
- 取得失敗を空データとして扱わず、部分成功はmanifestに記録して異常終了。保存ファイルのSHA-256を照合します。
- `scripts/build-cloudflare.mjs`: `travelMap/`と`inputTravelLog/`から各4ファイルだけを`.cloudflare-dist/`へコピーします。旧版のルート画面、保守スクリプト、鍵、バックアップは配信対象にしません。
- `wrangler.jsonc`: Cloudflare Workers Static Assetsの**新規プレビュー用**構成。DBと認証は変更しません。
- テストと構成のdry-runを実行するCI。自動デプロイ・バックアップ取得・本番変更は実行しません。

## 再開に必要な認証

GitHub Actionsでの確認は、リポジトリの Settings → Secrets and variables → Actions に次の名前で登録します。

| 名前 | 内容 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 対象アカウントに限定したWorkersデプロイ用APIトークン |
| `CLOUDFLARE_ACCOUNT_ID` | 移行先アカウントID（Variableでも可） |
| `FIREBASE_SERVICE_ACCOUNT` | `sharetravelinfolikedq` 用サービスアカウントJSON。読み取り・バックアップ用権限から開始 |

コードやチャットに秘密の値を貼らないこと。Codespacesで使う場合はCodespaces用Secretsにも許可・登録が必要で、Actions用Secretsとは別です。ローカルではJSONファイルをGitの外に置き、`GOOGLE_APPLICATION_CREDENTIALS`にパスを設定する方式にも対応します。

## Codespacesで先に行うこと

作業ブランチを開き、Node.js 22以上で実行します。バックアッププログラムには追加パッケージの導入は不要です。

```bash
node --test tests/cloudflare-migration.test.mjs
node scripts/firebase-backup.mjs backup
```

保存先はデフォルトで `$HOME/travelmap-backups/日時/`。ディレクトリ0700、ファイル0600の**平文**です。Codespacesの削除に備え、取得後はCodespaces外の暗号化・アクセス制限された保管先へコピーします。公開GitHubや公開CI artifactには保存しません。

```bash
node scripts/firebase-backup.mjs verify "$HOME/travelmap-backups/実際の日時"
node scripts/build-cloudflare.mjs
npx --yes wrangler@4 deploy --dry-run --outdir .cloudflare-dry-run
```

`verify`はファイル破損の確認であって復元試験ではありません。`dry-run`は公開しません。

## 本番切替前に残る必須作業

1. 本番の最新記録と対象プロジェクトを照合。その他のFirestore DB・Authテナント・Storage画像等の有無も棚卸しする。
2. 最終バックアップ時はアプリへの書き込みを止める。Firestoreは同一時点でもAuth/RTDBは別時点のため、全サービスを一括スナップショットとして扱わない。
3. Authのパスワードハッシュ設定、適用中のセキュリティルール、インデックス等も別途保存する。リポジトリ内のルールだけを本番設定と断定しない。
4. 別環境で復元し、全ドキュメントのID・件数・金額合計・日時・位置・カテゴリ・予算を照合する。ゼロ件や権限拒否を成功扱いしない。
5. Cloudflare側の既存Worker一覧を確認。`travelmap-masa-dev-2000-preview`が未使用であることを確認してからプレビューを作る。既存アプリを上書きしない。
6. 第一段階で画面をCloudflareへ移す場合は、Firebase Authの承認済みドメインを正確な新ホスト名に限定して追加し、ログイン・入力・閲覧を実機確認する。追加しただけで完全移行とはしない。
7. 完全移行にはD1等のDB、読み書きAPI、認証・権限の置き換えが別途必要。今回の準備コードにD1バックエンドや認証置換は含まれない。
8. Cloudflare上で全機能が動き、復旧経路が確保された後に本番URLを切り替える。旧Firebaseの削除・解約は別判断とし、自動実行しない。

バックアップmanifestの`migrationReady`と`restoreTested`は常にfalseから始まります。チェックサム一致だけでtrueに変更してはいけません。

## 公式資料

- Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Wrangler設定: https://developers.cloudflare.com/workers/wrangler/configuration/
- Firestoreドキュメント一覧: https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/list
- コレクション一覧: https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/listCollectionIds
- Authユーザー書き出しAPI: https://cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/batchGet
- Firebase公式export/import: https://firebase.google.com/docs/firestore/manage-data/export-import
- Codespaces Secrets: https://docs.github.com/en/codespaces/managing-your-codespaces/managing-your-account-specific-secrets-for-github-codespaces
