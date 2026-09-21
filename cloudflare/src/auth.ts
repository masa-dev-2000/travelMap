import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { sha256 } from './validation.ts';

export type User = {id: string; email: string; display_name: string; handle: string; avatar_url: string | null; icon_version?: number | null; bio: string; tip_url: string | null; status?: string | null; status_at?: string | null; terms_accepted_at?: string | null};
// Only the map page (exactly "/"), the sign-up page and same-origin paths under /admin may be used as a post-login destination.
export const safeNext = (value: string | null) => value && (value === '/' || value === '/signup/' || /^\/admin(\/[A-Za-z0-9_\-./?=&%]*)?$/.test(value)) ? value : '/';
export type AuthIdentity = {sub:string; email:string; name?:string; picture?:string};
export type AuthState = {authenticated:boolean; dataAvailable:boolean; identity:AuthIdentity|null; user:User|null; migrateCookie?:string};
type AuthEnv = Pick<Env, 'DB' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET' | 'SESSION_ENCRYPTION_KEY' | 'ACCESS_ISSUER' | 'ACCESS_AUD' | 'OWNER_EMAIL'>;

const SESSION_COOKIE = '__Host-tm_session', LEGACY_SESSION_COOKIE = 'tm_session', FLOW_COOKIE = 'tm_oauth';
const SESSION_DAYS = 7, FLOW_MINUTES = 10;
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
async function sessionKey(value?:string):Promise<CryptoKey> {
  if(!value)throw new Error('session_key_missing');
  let bytes:Uint8Array;
  try { const secret=value.trim(),normalized=secret.replace(/-/g,'+').replace(/_/g,'/'),padded=normalized.padEnd(Math.ceil(normalized.length/4)*4,'=');bytes=Uint8Array.from(atob(padded),c=>c.charCodeAt(0)); }
  catch { throw new Error('session_key_decode'); }
  if(bytes.length!==32)throw new Error('session_key_length');
  try { return await crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']); }
  catch { throw new Error('session_key_import'); }
}
export async function encryptIdentity(identity:AuthIdentity,secret:string,now=new Date()):Promise<string>{
  let iv:Uint8Array;
  try { iv=crypto.getRandomValues(new Uint8Array(12)); }
  catch { throw new Error('session_random_generation'); }
  const issued=Math.floor(now.getTime()/1000);
  let plain:Uint8Array;
  try { plain=new TextEncoder().encode(JSON.stringify({...identity,iss:'travelmap',aud:'travelmap-session',iat:issued,exp:issued+SESSION_DAYS*86400})); }
  catch { throw new Error('session_payload_encode'); }
  const key=await sessionKey(secret);
  let encrypted:ArrayBuffer;
  try { encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('travelmap-session-v1')},key,plain); }
  catch { throw new Error('session_encrypt_operation'); }
  try { return `v1.${base64url(iv)}.${base64url(encrypted)}`; }
  catch { throw new Error('session_output_encode'); }
}
export async function decryptIdentity(token:string,secret?:string):Promise<AuthIdentity|null>{
  try { const [version,ivText,dataText,...rest]=token.split('.');if(version!=='v1'||!ivText||!dataText||rest.length)return null;
    const decode=(value:string)=>{const normalized=value.replace(/-/g,'+').replace(/_/g,'/'),padded=normalized.padEnd(Math.ceil(normalized.length/4)*4,'=');return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));};
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(ivText),additionalData:new TextEncoder().encode('travelmap-session-v1')},await sessionKey(secret),decode(dataText));
    const payload=JSON.parse(new TextDecoder().decode(plain)) as Record<string,unknown>;
    if(payload.iss!=='travelmap'||payload.aud!=='travelmap-session'||typeof payload.exp!=='number'||payload.exp<=Date.now()/1000||typeof payload.sub!=='string'||typeof payload.email!=='string')return null;
    return {sub:payload.sub,email:payload.email,...(typeof payload.name==='string'?{name:payload.name}:{}),...(typeof payload.picture==='string'?{picture:payload.picture}:{})};
  } catch { return null; }
}
async function identityCookie(identity:AuthIdentity,env:AuthEnv,url:URL):Promise<string>{return setCookie(SESSION_COOKIE,await encryptIdentity(identity,env.SESSION_ENCRYPTION_KEY!),url,SESSION_DAYS*86400);}

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
  return await query(db, 'SELECT id,email,display_name,handle,avatar_url,icon_version,bio,tip_url,status,status_at,terms_accepted_at FROM users WHERE id=?', [id]).first<User>();
}

// Resolves the signed-in user from the session cookie, or from a legacy Access assertion for the owner.
export async function currentUser(request: Request, env: AuthEnv): Promise<User | null> {
  return (await authentication(request,env)).user;
}

// Authentication is independent from D1. D1 only resolves the Google subject to application data.
export async function authentication(request:Request,env:AuthEnv):Promise<AuthState>{
  const jar=cookies(request), encrypted=jar[SESSION_COOKIE];
  if(encrypted){
    const identity=await decryptIdentity(encrypted,env.SESSION_ENCRYPTION_KEY);
    if(identity){try{return {authenticated:true,dataAvailable:true,identity,user:await query(env.DB,'SELECT id,email,display_name,handle,avatar_url,icon_version,bio,tip_url,status,status_at,terms_accepted_at FROM users WHERE google_sub=?',[identity.sub]).first<User>()};}
      catch{return {authenticated:true,dataAvailable:false,identity,user:null};}}
  }
  const raw = jar[LEGACY_SESSION_COOKIE];
  if (raw && /^[a-f0-9]{64}$/.test(raw)) {
    try { const row=await query(env.DB,'SELECT u.id,u.google_sub,u.email,u.display_name,u.handle,u.avatar_url,u.icon_version,u.bio,u.tip_url,u.status,u.status_at,u.terms_accepted_at,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=?',[await sha256(new TextEncoder().encode(raw))]).first<User&{google_sub:string|null;expires_at:string}>();
      if(row&&row.expires_at>new Date().toISOString()){
        if(row.google_sub){const identity={sub:row.google_sub,email:row.email,name:row.display_name,picture:row.avatar_url??undefined};return {authenticated:true,dataAvailable:true,identity,user:row,migrateCookie:await identityCookie(identity,env,new URL(request.url))};}
        return {authenticated:true,dataAvailable:true,identity:null,user:row};
      }
    } catch { return {authenticated:false,dataAvailable:false,identity:null,user:null}; }
  }
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (assertion && await verifyAccessToken(assertion, env)) {
    try { const user=await query(env.DB, 'SELECT id,email,display_name,handle,avatar_url,icon_version,bio,tip_url,status,status_at,terms_accepted_at FROM users WHERE lower(email)=lower(?)', [env.OWNER_EMAIL]).first<User>();return {authenticated:!!user,dataAvailable:true,identity:null,user}; }
    catch{return {authenticated:true,dataAvailable:false,identity:null,user:null};}
  }
  return {authenticated:false,dataAvailable:true,identity:null,user:null};
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

// Guidance pages for login problems. Plain HTML without scripts, so they render even inside in-app browsers; all dynamic text is escaped.
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const PAGE_STYLE = `:root{font-family:"Hiragino Sans","Noto Sans JP",system-ui,sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:#16362d;color:#f3efe6}main{width:100%;max-width:420px}h1{margin:0 0 12px;font-size:24px}p{margin:0 0 12px;line-height:1.7;font-size:15px}.muted{color:#a9c2b8;font-size:13px}a.btn{display:block;margin-top:12px;padding:15px;border-radius:16px;text-align:center;text-decoration:none;font-weight:700;font-size:16px}a.main{background:#e0a24a;color:#1d2a24}a.sub{border:1px solid #ffffff55;color:#f3efe6}input{width:100%;height:46px;padding:0 12px;border:1px solid #ffffff44;border-radius:12px;background:#ffffff14;color:#f3efe6;font-size:15px}`;
function page(status: number, title: string, body: string, headers: Record<string, string> = {}): Response {
  return new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} | TravelMap</title><style>${PAGE_STYLE}</style></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`,
    {status, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers}});
}
const IN_APP_BROWSER = /Line\/|Instagram|FBAN|FBAV|FB_IAB|Twitter|MicroMessenger|; wv\)/;
const IN_APP_NOTE = '<p class="muted">LINEやInstagramなどのアプリ内ブラウザでは、Googleがログインを受け付けないことがあります。Safari / Chrome で開いてください。</p>';
export function loginErrorPage(status: number, detail: string, request: Request, headers: Record<string, string> = {}): Response {
  return page(status, 'ログインできませんでした', `<p>${escapeHtml(detail)}</p><p>時間をおいてもう一度お試しください。</p>${IN_APP_BROWSER.test(request.headers.get('User-Agent') ?? '') ? IN_APP_NOTE : ''}<a class="btn main" href="/auth/google">もう一度ログインする</a><a class="btn sub" href="/">地図に戻る</a>`, headers);
}
export function dataUnavailablePage(request:Request,next='/',cookiesToSet:string[]=[]):Response{
  const safe=safeNext(next),response=page(503,'ログインは完了しました',`<p>Googleでの本人確認は完了しています。</p><p>現在、記録データを一時的に利用できません。復旧後に続きから再開できます。</p><a class="btn main" href="/auth/continue?next=${encodeURIComponent(safe)}">もう一度確認する</a><a class="btn sub" href="/">地図を見る</a>`);
  for(const cookie of cookiesToSet)response.headers.append('Set-Cookie',cookie);return response;
}

export async function startGoogleLogin(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  if (!env.GOOGLE_CLIENT_ID) return loginErrorPage(503, 'ログインが設定されていません。', request);
  // Google refuses OAuth inside embedded web views (disallowed_useragent). Explain first instead of sending people into that error.
  if (IN_APP_BROWSER.test(request.headers.get('User-Agent') ?? '') && url.searchParams.get('continue') !== '1') {
    const next = safeNext(url.searchParams.get('next'));
    return page(200, 'ブラウザで開いてください', `<p>アプリ内ブラウザではログインできない場合があります。Safari / Chrome で開いてください。</p><p class="muted">下のURLを長押しでコピーして、Safari / Chrome に貼り付けてください。</p><input readonly aria-label="このサイトのURL" value="${escapeHtml(url.origin + '/')}"><a class="btn sub" href="/auth/google?next=${encodeURIComponent(next)}&amp;continue=1">このまま続ける</a><a class="btn sub" href="/">地図に戻る</a>`);
  }
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
  const observed = async <T>(stage:string, action:()=>Promise<T>):Promise<T> => {
    try { return await action(); }
    catch(error) {
      const errorCode=error instanceof Error&&/^session_(?:key_(?:missing|decode|length|import)|random_generation|payload_encode|encrypt_operation|output_encode)$/.test(error.message)?error.message:'unclassified';
      console.error(JSON.stringify({event:'login_callback_failed',stage,error_name:error instanceof Error?error.name:'unknown',error_code:errorCode}));
      throw error;
    }
  };
  const flow = cookies(request)[FLOW_COOKIE]?.split('.') ?? [];
  const clearFlow = setCookie(FLOW_COOKIE, '', url, 0);
  const fail = (message: string) => loginErrorPage(400, message, request, {'Set-Cookie': clearFlow});
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return fail('ログインが設定されていません。');
  const clientId=env.GOOGLE_CLIENT_ID,clientSecret=env.GOOGLE_CLIENT_SECRET;
  if (url.searchParams.get('error')) return fail('Googleでのログインが完了しませんでした。');
  if (!code || !state || flow.length < 3 || flow[0] !== state) return fail('ログインの手続きが途中で切れました。');
  const [, nonce='', verifier='', next] = flow;
  const tokenResponse = await observed('token_fetch',()=>fetchToken('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({code, client_id: clientId, client_secret: clientSecret, redirect_uri: `${url.origin}/auth/callback`, grant_type: 'authorization_code', code_verifier: verifier}),
  }));
  if (!tokenResponse.ok) return fail('Googleでの確認に失敗しました。');
  const tokens = await observed('token_json',()=>tokenResponse.json()) as {id_token?: string};
  const claims = tokens.id_token ? await observed('id_token_verify',()=>verifyGoogleIdToken(tokens.id_token!, clientId, nonce, key)) : null;
  if (!claims) return fail('Googleアカウントを確認できませんでした。');
  const identity:AuthIdentity={sub:claims.sub,email:claims.email,name:claims.name,picture:claims.picture};
  const sessionCookie=await observed('session_encrypt',()=>identityCookie(identity,env,url));
  const headers = new Headers();
  headers.append('Set-Cookie', clearFlow);
  headers.append('Set-Cookie', sessionCookie);
  const destination=safeNext(decodeURIComponent(next ?? ''));
  try { const user=await upsertGoogleUser(env.DB,claims);headers.set('Location',user.terms_accepted_at?destination:'/signup/');return new Response(null,{status:302,headers}); }
  catch(error){
    console.error(JSON.stringify({event:'login_data_unavailable',request_id:crypto.randomUUID()}));
    // Authentication and the map shell do not depend on D1. Keep the signed-in cookie and let the map show data as temporarily unavailable.
    headers.set('Location','/');
    return new Response(null,{status:302,headers});
  }
}

export async function continueGoogleLogin(request:Request,env:AuthEnv):Promise<Response>{
  const url=new URL(request.url),next=safeNext(url.searchParams.get('next')),state=await authentication(request,env);
  if(!state.authenticated||!state.identity)return new Response(null,{status:302,headers:{Location:`/auth/google?next=${encodeURIComponent(next)}`}});
  if(!state.dataAvailable)return dataUnavailablePage(request,next);
  let user=state.user;
  if(!user){try{user=await upsertGoogleUser(env.DB,state.identity);}catch{return dataUnavailablePage(request,next);}}
  return new Response(null,{status:302,headers:{Location:user.terms_accepted_at?next:'/signup/'}});
}

export async function logout(request: Request, _env: AuthEnv): Promise<Response> {
  const url = new URL(request.url),headers=new Headers({Location:'/'});
  headers.append('Set-Cookie',setCookie(SESSION_COOKIE,'',url,0));headers.append('Set-Cookie',setCookie(LEGACY_SESSION_COOKIE,'',url,0));
  return new Response(null,{status:302,headers});
}

export function sessionCookieForTest(token: string): string { return `${LEGACY_SESSION_COOKIE}=${token}`; }
export function encryptedSessionCookieForTest(token:string):string{return `${SESSION_COOKIE}=${token}`;}
export { createSession };
