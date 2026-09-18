# 0001: Cloudflare Workers・D1・R2を現行基盤とする

- Status: Accepted
- Date: 2026-09-18

## Context

旧版はFirebase Hosting、Firestore、Realtime Databaseで構成されていた。現行版では、複数ユーザー、公開範囲、添付ファイル、Googleログインを一つの配備単位で扱う必要がある。

## Decision

現行のWebアプリとAPIをCloudflare Workersで配信する。構造化データはD1、添付画像・ファイルは非公開R2に保存する。静的画面はWorkers Assetsから配信し、`cloudflare/src/worker.ts` を本番入口とする。

旧Firebaseコードは `archive/` に履歴として残すが、現行の配備・仕様判断には使わない。

## Consequences

- 認証、API、静的画面へ同一オリジンからアクセスできる。
- D1 migrationがスキーマ履歴の正本になる。適用済みmigrationは書き換えず、新しい番号で変更する。
- R2オブジェクトへのアクセス制御はWorker APIが担う。
- 本番構成は `cloudflare/wrangler.production.jsonc`、開発・検証手順は `cloudflare/README.md` を参照する。
