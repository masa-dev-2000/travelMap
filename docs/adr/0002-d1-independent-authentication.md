# 0002: Google OIDCの認証状態をD1から分離する

- Status: Accepted
- Date: 2026-09-18

## Context

Googleログイン完了後のセッション確認がD1のセッション表に依存すると、D1の読み取り上限や一時障害がログイン失敗として現れる。本人確認が成功しているのに地図自体へ入れない状態は、障害範囲を不必要に広げる。

## Decision

Google OIDCはAuthorization Code Flow、PKCE、state、nonceを使う。確認済みGoogle identityは、`__Host-tm_session` という7日間のAES-GCM暗号化Cookieに保持する。

Cookieの復号と本人確認はD1に依存させない。D1はGoogle subjectからアプリ内ユーザーとデータを解決するために使う。D1が利用できない場合も認証済み状態を維持し、復旧後に同じCookieから処理を続行する。

暗号鍵とGoogle client secretはWrangler secretとして管理し、リポジトリやログへ出さない。

## Consequences

- D1障害中もGoogleで本人確認済みかどうかを判定できる。
- 本番Cookieは `Secure`、`HttpOnly`、`SameSite=Lax`、`Path=/` とし、`__Host-` prefixの制約に従う。
- アプリ内ユーザー未解決時は記録APIを利用できないため、認証成功とデータ利用可否を別の状態としてUIへ返す。
- 旧D1セッションCookieとCloudflare Accessの所有者向け経路は移行互換であり、新しい認証設計の中心にはしない。
