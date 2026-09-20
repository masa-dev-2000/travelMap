# Issues #2–#7 — 実装・修正記録と公開条件

## 状態と目次

初期実装: `2256782143bda1d56a8819c15a645c2c112afd22`。PR #8 はレビュー修正後、2026-09-20に `main` へマージ済み（merge commit `b6ad5ac574545a79211018cf041680a9afbd1f04`）。同日、本番D1の0011/0012とWorkerの配備を完了。iPhone実機・実GPSは未確認。

[要望対応](#要望対応) / [レビュー修正](#レビュー修正) / [検証](#検証) / [dbと索引](#dbと索引) / [配備条件](#配備条件)

## 要望対応

| Issue | 実装 | 主なファイル |
|---|---|---|
| #2 | タイトル→カテゴリ→評価→写真→メモ。IME確定と改行を維持、明示的な完了/スキップ | admin/record、input-flow |
| #3 | フォームをスクロールの責任者とし、無条件のwindow先頭移動を撤去 | input-viewport、flow.css |
| #4 | ON直後＋前面表示中5分間隔、本人専用位置ログ、停止/復帰/画面移動 | auto-location、location-capture、location-api、location-map |
| #5 | 記録開始画面のステータス欄/更新処理だけ削除。他画面の共通データは維持 | admin/start |
| #6 | 1枚の共通地点カード。公開/本人データを分離、写真は用途を確認 | record-display、map-record-card、owner-route、panel-everyone |
| #7 | 通常replayに速度/位置スライダーと地点カード、固定スナップショット | replay、replay-model |

タイトルは既存observed_place_nameを使うA案（「タイトル（場所名）」）の仮採用。別title列・必須化・既存記録の架空タイトル追加はしていない。再生速度0.25〜4倍・通常記録間2秒は調整可能な試験値。自動位置は公開設定と独立した本人専用。これらは確定合意と混同しない。

## レビュー修正

### 保存・写真

`record-save.js`が保存と写真変換を独立管理し、処理の入口でも同時実行を拒否する。保存開始時の本文/金額/公開設定/写真一覧を固定し、通信結果不明時には同じ本文・保存キーを再送する。activity ID取得後の写真/公開再試行で新しいactivityを作らない。

保存中・再送待ちは入力と写真追加/削除をロックするが、自動位置のOFF操作は対象外。写真変換のfinallyは自分のカウンターだけを解放する。部分失敗は入力・写真・成功済み添付IDを残す。添付アップロード自体の応答が失われた場合の重複オブジェクトまで、ここで完全保証したとは扱わない。

### no-referrerを維持した画面引き継ぎ

地図の「記録」ボタンと対応ページ間の通常リンクは`navigateWithCapture`を使う。前ページURLの有無に依存しない。新規タブ/外部遷移/ダウンロード/復元では自動再開しない。復元時はナビゲーション中フラグも初期化する。

引き継ぎは`記録中→prepare→移動→claim→記録中`。移動元で256bitの乱数を生成し、認証済みサーバーが現行leaseを確認してハッシュだけ登録する。生トークンは同一タブのsessionStorageで渡し、URLに載せない。期限はサーバー時刻で15秒。所有者/client/移動先/期限を検証し、消費と新capture/pageへの交代は1回のUPDATEで行う。

同一新capture/pageによるclaim再送は応答を再取得できるが、別pageの再利用は拒否する。失敗時に通常startへフォールバックしない。転送のpagehideは明示OFFと分離し、明示OFFは未消費トークンを失効させる。旧ページの遅いstopは新capture/pageに作用しない。次回予定を引き継ぎ、単なる画面移動で初回地点を重複生成しない。

0012未適用なら当該機能を503で停止側へ倒す。no-referrer、Origin、認証、規約同意、本人条件は弱めていない。GPSのmaximumAge:0と測位timestampの検証は維持し、CIを通すための本番鮮度緩和はしていない。

### 再生とSQL

進捗スライダーは指定値を読み取ってからpauseを呼び、描画による値の上書きを避ける。速度倍率・通常replayとstoryの区別・再生開始時のデータ固定は維持する。

位置ログの次ページでは期間上限をmin(指定終了日時,カーソル日時)へ絞る。同時刻のID条件は残し、元のfrom/toを先に検証する。カーソルがfrom未満なら空を返す。新しい索引を増やすのではなく既存索引の走査範囲を狭める。

## 検証

修正前CIの失敗は[レビュー](https://github.com/masa-dev-2000/travelMap/pull/8#pullrequestreview-5260025927)と[原因追及](https://github.com/masa-dev-2000/travelMap/pull/8#issuecomment-5748713795)に記録済み。診断workflowのsuccessを製品テストの成功に読み替えない。

最終head `27c28a6817ff1b6a6f50cdc85a6a03d3f599bccf` のCI run `35509777387` は core/browser と実MapLibre/WebGL限定試験まで成功した。これはiPhone実機・実GPS・本番D1・本番Workerの合格を意味しない。

- `npm run check && npm test && npm run build`: 既存Workerと追加状態/API試験。ビルドはローカル用のdry-runで本番配備ではない。
- `worker-handoff.test.ts`: 実際のWorker/認証/Origin/Miniflare D1を通す一回用引き継ぎ。
- `check-location-migration.py`: 旧DB→0011→0012と新規累積schemaの一致、既存ユーザー/位置の保持、外部キー。
- `check-location-indexes.py`: 10万件の合成データ、期間/深いカーソル/同時刻/全ページ同値性、EXPLAIN。D1課金rows_readや本番性能の計測とは異なる。
- `browser-smoke.py`: 入力、写真競合、再送、リンク/ボタン引き継ぎ、履歴復元、GPS失敗、カード/再生を独立実行。実DOM、制御したAPI/GPS、模擬地図。no-referrerヘッダーを再現し、失敗時の状態/画面/traceを保存する。
- `browser-real-map.py`: 実MapLibre/WebGLに対するカード/再生の限定試験。スタイルは空、API/GPSは合成。実地図タイル・iPhone・実GPSの合格を代用しない。

CIのcore/browserは独立ジョブで、一方の失敗で他方の試験を飛ばさない。ブラウザ試験もfail-fastにしない。ネイティブGPSの診断比較は診断ブランチの履歴として分離する。

## DBと索引

| 検索 | 索引 |
|---|---|
| 本人の日時順位置一覧 | location_samples_user_time(user_id,captured_at,id) |
| 重複照合/1地点削除 | location_samplesの主キー(user_id,id) |
| lease更新/prepare/claim | location_capture_leasesの主キー(user_id,client_id) |

0011は位置/leaseテーブルと位置の日時索引を追加。0012はleaseにhandoff_hash/destination/expires_at/claimed_at/next_atを追加。1行へ絞って照合するためトークン単独索引は不要。schema-extra.sqlにも同じ定義を反映した。コード索引は[CODEMAP](../CODEMAP.md)からたどれる。本番では2026-09-20に両SQLファイルを順番に直接実行し、列・索引・外部キーを確認した。

## 配備条件

最終headのCIは合格し、mainへのマージは完了した。公開前にはiPhoneの日本語/数字キーボード・カーソル・写真キャンセル/復帰・ロック復帰・アカウント切替を確認する。iPhone実機と実GPSは未確認。

配備時は対象D1、既適用migration、バックアップ/復旧方法を別途確認し、未適用の0011→0012→コードの順。本番D1は初期投入由来の既存スキーマを持つ一方、`d1_migrations`台帳は空でWranglerが0001以降も未適用と表示した。このため`migrations apply`は使用せず、0011/0012のSQLファイルを直接一度ずつ実行した。台帳は空のままなので、今後も一覧だけを根拠に再適用しない。

戻す場合は旧コードまたは機能停止へ戻し、位置データや追加列を削除しない。実装済み/CI合格/実機合格/本番反映は別の状態として管理する。


## 2026-09-20 正本更新

- 実装: mainへ反映済み。
- CI: 最終headで合格済み。
- 本番: **反映済み**。D1 0011/0012の直接実行、DB構造と索引の確認、Worker Version `be322ae7-5354-41d3-82c9-91b672d513d1` の100%配備、公開API/未認証私的APIのスモーク確認を実施。
- Git管理下の `cloudflare/wrangler.jsonc` はローカル専用。本番用 `wrangler.production.jsonc` は運用上Git管理外であり、リポジトリには実Account ID/D1 IDを保存しない。
- 本番作業を再開する際は、Cloudflare認証済み環境で本番設定の存在と Worker=`travelmap` / D1=`travelmap` / R2=`travelmap-files` を照合し、バックアップ後に未適用migration→コードの順で反映する。
