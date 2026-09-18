import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { sha256 } from './validation.ts';

export type User = {id: string; email: string; display_name: string; handle: string; avatar_url: string | null; icon: string | null; icon_version?: number | null; bio: string; tip_url: string | null};
// Only the map page (exactly "/") and same-origin paths under /admin may be used as a post-login destination.
export const safeNext = (value: string | null) => value && (value === '/' || /^\/admin(\/[A-Za-z0-9_\-./?=&%]*)?$/.test(value)) ? value : '/';
type AuthEnv = Pick<Env, 'DB' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'ACCESS_ISSUER' | 'ACCESS_AUD' | 'OWNER_EMAIL'>;

const SESSION_COOKIE = 'tm_session', FLOW_COOKIE = 'tm_oauth';
const SESSION_DAYS = 30, FLOW_MINUTES = 10;
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

const query = (db: D1Database, sql: string, values: (string | number | null)[] = []) => db.prepare(sql).bind(...values);
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
const base64url = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const cookies = (request: Request) => Object.fromEntries((request.headers.get('Cookie') ?? '').split(';').map(part => part.trim().split('=')).filter(([name]) => name).map(([name, ...rest]) => [name, rest.join('=')]));
const secure = (url: URL) => url.protocol === 'https:';
function setCookie(name: string, value: string, url: URL, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure(url) ? '; Secure' : ''}`;
}

// Legacy Cloudflare Access assertion, kept for the transition; it maps to the owner account only.
export async function verifyAccessToken(token: string, env: Pick<Env, 'ACCESS_ISSUER' | 'ACCESS_AUD' | 'OWNER_EMAIL'>,
                                        key?: JWTVerifyGetKey): Promise<boolean> {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER) || !env.ACCESS_AUD || !env.OWNER_EMAIL) return false;
  try {
    const { payload } = await jwtVerify(token, key ?? createRemoteJWKSet(new URL(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`)), {
      issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'],
    });
    return typeof payload.email === 'string' && payload.email.toLowerCase() === env.OWNER_EMAIL.toLowerCase();
  } catch { return false; }
}

export async function userById(db: D1Database, id: string): Promise<User | null> {
  return await query(db, 'SELECT id,email,display_name,handle,avatar_url,icon,icon_version,bio,tip_url FROM users WHERE id=?', [id]).first<User>();
}

// Resolves the signed-in user from the session cookie, or from a legacy Access assertion for the owner.
export async function currentUser(request: Request, env: AuthEnv): Promise<User | null> {
  const raw = cookies(request)[SESSION_COOKIE];
  if (raw && /^[a-f0-9]{64}$/.test(raw)) {
    const session = await query(env.DB, 'SELECT user_id,expires_at FROM sessions WHERE id_hash=?', [await sha256(new TextEncoder().encode(raw))]).first<{user_id: string; expires_at: string}>();
    if (session && session.expires_at > new Date().toISOString()) return userById(env.DB, session.user_id);
  }
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (assertion && await verifyAccessToken(assertion, env)) {
    return await query(env.DB, 'SELECT id,email,display_name,handle,avatar_url,icon,icon_version,bio,tip_url FROM users WHERE lower(email)=lower(?)', [env.OWNER_EMAIL]).first<User>();
  }
  return null;
}

async function createSession(db: D1Database, userId: string): Promise<string> {
  const token = randomToken(), now = new Date(), expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
  await db.batch([
    query(db, 'DELETE FROM sessions WHERE expires_at<? OR user_id=? AND id_hash NOT IN (SELECT id_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 9)', [now.toISOString(), userId, userId]),
    query(db, 'INSERT INTO sessions(id_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)', [await sha256(new TextEncoder().encode(token)), userId, now.toISOString(), expires.toISOString()]),
  ]);
  return token;
}

// Handles are public (they appear in the feed), so they never derive from the email address.
async function newHandle(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = `traveler-${randomToken().slice(0, 6)}`;
    if (!await query(db, 'SELECT id FROM users WHERE handle=?', [candidate]).first()) return candidate;
  }
  return `traveler-${randomToken().slice(0, 12)}`;
}

// Upsert by Google subject. The pre-created owner row (email only) is claimed on the owner's first login.
export async function upsertGoogleUser(db: D1Database, claims: {sub: string; email: string; name?: string; picture?: string}): Promise<User> {
  const existing = await query(db, 'SELECT id FROM users WHERE google_sub=? OR (google_sub IS NULL AND lower(email)=lower(?))', [claims.sub, claims.email]).first<{id: string}>();
  const name = (claims.name ?? '旅人').slice(0, 100), picture = claims.picture?.startsWith('https://') ? claims.picture.slice(0, 500) : null;
  if (existing) {
    await query(db, 'UPDATE users SET google_sub=?,avatar_url=COALESCE(?,avatar_url) WHERE id=?', [claims.sub, picture, existing.id]).run();
    return (await userById(db, existing.id))!;
  }
  const id = crypto.randomUUID();
  await query(db, 'INSERT INTO users(id,google_sub,email,display_name,handle,avatar_url,created_at) VALUES(?,?,?,?,?,?,?)',
    [id, claims.sub, claims.email.toLowerCase(), name, await newHandle(db), picture, new Date().toISOString()]).run();
  return (await userById(db, id))!;
}

export async function verifyGoogleIdToken(token: string, clientId: string, nonce: string, key: JWTVerifyGetKey = googleKeys): Promise<{sub: string; email: string; name?: string; picture?: string} | null> {
  try {
    const { payload } = await jwtVerify(token, key, { issuer: GOOGLE_ISSUERS, audience: clientId, requiredClaims: ['exp', 'iat', 'sub', 'email', 'nonce'] });
    if (payload.nonce !== nonce || payload.email_verified !== true || typeof payload.email !== 'string' || typeof payload.sub !== 'string') return null;
    return { sub: payload.sub, email: payload.email, name: typeof payload.name === 'string' ? payload.name : undefined, picture: typeof payload.picture === 'string' ? payload.picture : undefined };
  } catch { return null; }
}

export async function startGoogleLogin(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  if (!env.GOOGLE_CLIENT_ID) return Response.json({error: 'ログインが設定されていません'}, {status: 503});
  const state = randomToken(), nonce = randomToken(), verifier = randomToken();
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${url.origin}/auth/callback`, response_type: 'code', scope: 'openid email profile',
    state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  });
  return new Response(null, {status: 302, headers: {
    Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    'Set-Cookie': setCookie(FLOW_COOKIE, `${state}.${nonce}.${verifier}.${encodeURIComponent(safeNext(url.searchParams.get('next')))}`, url, FLOW_MINUTES * 60),
  }});
}

export async function finishGoogleLogin(request: Request, env: AuthEnv, fetchToken: typeof fetch = fetch, key?: JWTVerifyGetKey): Promise<Response> {
  const url = new URL(request.url), code = url.searchParams.get('code'), state = url.searchParams.get('state');
  const flow = cookies(request)[FLOW_COOKIE]?.split('.') ?? [];
  const clearFlow = setCookie(FLOW_COOKIE, '', url, 0);
  const fail = (message: string) => new Response(message, {status: 400, headers: {'Set-Cookie': clearFlow, 'Content-Type': 'text/plain; charset=utf-8'}});
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return fail('ログインが設定されていません');
  if (!code || !state || flow.length < 3 || flow[0] !== state) return fail('ログインをやり直してください');
  const [, nonce, verifier, next] = flow;
  const tokenResponse = await fetchToken('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${url.origin}/auth/callback`, grant_type: 'authorization_code', code_verifier: verifier}),
  });
  if (!tokenResponse.ok) return fail('Googleでの確認に失敗しました');
  const tokens = await tokenResponse.json() as {id_token?: string};
  const claims = tokens.id_token ? await verifyGoogleIdToken(tokens.id_token, env.GOOGLE_CLIENT_ID, nonce, key) : null;
  if (!claims) return fail('Googleアカウントを確認できませんでした');
  const user = await upsertGoogleUser(env.DB, claims);
  const session = await createSession(env.DB, user.id);
  const headers = new Headers({Location: safeNext(decodeURIComponent(next ?? ''))});
  headers.append('Set-Cookie', clearFlow);
  headers.append('Set-Cookie', setCookie(SESSION_COOKIE, session, url, SESSION_DAYS * 86400));
  return new Response(null, {status: 302, headers});
}

export async function logout(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url), raw = cookies(request)[SESSION_COOKIE];
  if (raw && /^[a-f0-9]{64}$/.test(raw)) await query(env.DB, 'DELETE FROM sessions WHERE id_hash=?', [await sha256(new TextEncoder().encode(raw))]).run();
  return new Response(null, {status: 302, headers: {Location: '/', 'Set-Cookie': setCookie(SESSION_COOKIE, '', url, 0)}});
}

export function sessionCookieForTest(token: string): string { return `${SESSION_COOKIE}=${token}`; }
export { createSession };
