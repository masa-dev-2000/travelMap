# Architecture Decision Records

TravelMapの実装済みで横断的な設計判断を記録する。要件と予定は `../sns-plan.md`、コードの責任範囲は `../../CODEMAP.md` を正本とする。

- [0001: Cloudflare Workers・D1・R2を現行基盤とする](0001-cloudflare-runtime-and-storage.md)
- [0002: Google OIDCの認証状態をD1から分離する](0002-d1-independent-authentication.md)
- [0003: 公開地図を共通入口にして機能単位で縮退する](0003-single-map-and-degraded-mode.md)
