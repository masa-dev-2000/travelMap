# 冒険の書／travelMap 仕様書

> 新モデルのローカル参照実装・変換手順は [data_model/README.md](../data_model/README.md)。
> 以下は既存画面の仕様。新モデルへの本番切り替えは未実施。

## 1. プロジェクト概要
- 旅の行動・出費ログを記録し、地図上で可視化する個人向けWebアプリ。
- Firebase Hosting で 2 つの静的アプリを配信。
  - `travelMap/`: 公開ビューア。Leaflet で軌跡・最新位置・統計を表示。
  - `inputTravelLog/`: 認証ユーザー向け入力ツール。現在地と出費カテゴリ付きでログを登録。
- データストアは Firebase Firestore（`logs` コレクション）を中心に利用。旧 RTDB からの移行スクリプトも同梱。
- 直近の UI/機能変更の概要は `docs/implementation_history.md` に簡易メモとして追記している。

## 2. 技術構成
- ホスティング: Firebase Hosting（`firebase.json` で target を2つ定義）。
- データベース: Cloud Firestore（rules で read 公開・write 要認証）、旧RTDBも読み取りのみ使用。
- UI ライブラリ: Leaflet + leaflet-polylinedecorator。
- 言語/構成: 純粋な HTML/CSS/JS（ビルド工程なし）。
- ユーティリティ:
  - `travelMap/updateFirebase.js`: ブラウザでRTDBデータを一括更新。
  - `migration.js`: Node + firebase-admin で RTDB → Firestore への移行。
- CI/CD: GitHub Actions（`.github/workflows/deploy.yml`）で lint → Firebase Hosting デプロイを自動実行。

## 3. 機能詳細
### 3.1 ログ入力（`inputTravelLog/`）
- Firebase Auth（メール・パスワード）でログイン。
- `navigator.geolocation` で現在地を取得し、Nominatim API で周辺 POI を検索。
- 評価（★1〜5）、場所名、メモ、カテゴリ、金額を入力し Firestore `logs` に保存。
- 送信後はフォームリセット、最新ログ一覧をリアルタイム表示。
- 勇者ステータス編集フォームで Firestore `meta/playerStatus` を更新。
- カテゴリ予算カードから Firestore `meta/budgets` を編集し、ビューアの「予算」タブに反映。
- 勇者ステータス編集フォームで Firestore `meta/playerStatus` を更新し、ビューアの RPG ステータスへ反映。

### 3.2 ログビューア（`travelMap/`）
- Firestore `logs` を購読し Leaflet で描画。
- 機能:
  - 最新位置マーカー（カスタムアイコン）とポリライン（全履歴＋フィルタ期間）。
  - メニューウィンド（ステータス右）から各ウィンドを開閉:
    - 出費統計（タブ：集計閲覧／出費日足／カテゴリグラフ）: 期間プリセット＋カテゴリフィルタを共有し、メトリクスと Chart.js グラフを表示。
    - 予算: 当月をデフォルトに矢印で前後月へ移動し、`meta/budgets` の値と同月ログから算出した使用額・使用率をカテゴリ別に表示。
    - 表示設定: 期間プリセット（7/30/90/365日/全期間）とカテゴリフィルタで地図の表示を切替（統計タブとは独立に動作）。
    - 神のお告げ: 直近14日間のログからカテゴリ偏重や高評価スポットを抽出し、最大3件の指針メッセージを表示。
    - 王の出資: 月間出費を王室予算（120,000G）と比較し、差分および高額支出トップ3を表示。
  - 選択カテゴリ＆期間に一致するポイントを強調表示、Leaflet Tooltip も表示。
  - 最新ログの逆ジオコーディング（Nominatim）。
  - RPG風ステータス表示。`window.updatePlayerStatus` で外部から更新可能。

### 3.3 サポートスクリプト
- `updateFirebase.js`: RTDB 上の `tag` → `memo` 変換、および `amount_category` の初期化をバッチ処理。
- `migration.js`: serviceAccount を用意し CLI から実行。RTDB の `logs` を Firestore にコピー（`stars` 等も保持）。
- `meta/playerStatus`: ビューアと入力アプリ両方から購読するステータス共有用の Firestore ドキュメント。
- `meta/budgets`: カテゴリ予算を保持するドキュメント。ビューアの予算タブと入力アプリの予算編集フォームが双方向に利用。

## 4. データモデル（Firestore `logs`）
| フィールド            | 型                | 説明                                   |
|----------------------|-------------------|----------------------------------------|
| `timestamp`          | ISO文字列 or Timestamp | 行動日時。ビューア側で `toJsDate` で変換。|
| `lat`, `lng`         | number            | 緯度・経度。Leaflet マーカー & 経路描画に使用。 |
| `memo`               | string            | 行動メモ。旧 `tag` から移行。         |
| `amount`             | number/null       | 出費額（円）。統計に使用。            |
| `amount_category`    | string            | 8種（食費/交通費/.../その他）。       |
| `stars`              | number/null       | 評価（1〜5）。                         |
| `locationName`       | string/null       | POI 名称。                             |

## 5. UI/UX 仕様
- フォント: DotGothic16（DQ風）。
- ステータス + メニューは画面上部中央のフレーム内に 2×2 レイアウトで配置し、縦向き画面でも横並びを維持。
- メニュー項目クリックで浮遊ウィンド（表示設定 / 出費関係 / 神のお告げ / 王の出資）を前面に表示。各ウィンドはヘッダーをドラッグして移動でき、常にメニュー・ステータスより上の z-index に配置される。
- レスポンシブ: 768px未満で overlay は縦並び、ウィンドレイヤー位置を下げて幅を100%に近づける。
- Map レイヤー: ズームボタンを右下に固定し、凡例を左下に追加。

## 6. 外部サービス・API
- Firebase (Auth, Firestore, Hosting, Realtime Database)。
- OpenStreetMap Nominatim API（検索・逆ジオコーディング）。Rate Limit を考慮し、必要最小限のクエリを行う。
- Leaflet CDN・PolyLineDecorator CDN。
- Nominatim リクエストは 1.5 秒間隔で直列化。旅マップ側の逆ジオコーディング結果はメモリキャッシュして連続アクセスを抑制。

## 7. セキュリティ・認証
- Firestore ルール: `logs` 読み取りは公開、書き込みは認証必須。
- Realtime Database ルールも同様に `.read: true`, `.write: auth != null`。
- `serviceAccountKey.json` はローカル用途（`migration.js`）。公開リポジトリに含めず、Git管理対象外。

## 8. 依存関係
- npm: `firebase-admin`（移行スクリプト用）。
- Dev: `eslint`（`npm run lint` で主要 JS ファイルを静的解析）。
- CDN: Firebase v9 compat, Leaflet, PolylineDecorator, Chart.js。

## 9. 既知の制約
- `firebase deploy` には CLI 認証が必要。現在は認証切れのため `firebase login --reauth` が必要。
- `王の出資` ウィンドの月額目標（120,000G）はハードコード。入力アプリからの変更は未対応。
- Nominatim の利用規約に従い、連続アクセスや商用利用は制限される点に注意。

## 10. 今後の拡張候補
- メニューアクションのショートカットキー対応やドラッグ移動可能なウィンド化。
- `updatePlayerStatus` を呼び出す管理UIの実装。
- `王の出資` など新規機能用に Firestore スキーマ拡張。
