import { authentication, continueGoogleLogin, dataUnavailablePage, finishGoogleLogin, loginErrorPage, logout, startGoogleLogin, type AuthState, type User } from './auth.ts';
import { json, privateApi, publicApi } from './api.ts';
import { InputError } from './validation.ts';

const LOCAL_USER: User = {id: 'local-owner', email: 'local@localhost', display_name: 'ローカル', handle: 'local', avatar_url: null, icon: null, bio: '', tip_url: null};

// Local development has no Google login; the local entry point vouches for a fixed account.
async function localUser(env: Env): Promise<User> {
  const now=new Date().toISOString();
  await env.DB.prepare('INSERT OR IGNORE INTO users(id,google_sub,email,display_name,handle,avatar_url,created_at,terms_accepted_at,onboarded_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(LOCAL_USER.id, null, LOCAL_USER.email, LOCAL_USER.display_name, LOCAL_USER.handle, null, now, now, now).run();
  const row=await env.DB.prepare('SELECT id,email,display_name,handle,avatar_url,icon,icon_version,bio,tip_url,status,status_at,terms_accepted_at FROM users WHERE id=?').bind(LOCAL_USER.id).first<User>() ?? LOCAL_USER;
  return {...row,terms_accepted_at:row.terms_accepted_at ?? now};// the fixed local account always counts as signed up
}

export async function handle(request: Request, env: Env, localOwner = false): Promise<Response> {
  const url=new URL(request.url);
  try {
    if (url.pathname === '/api/public/session' && request.method === 'GET') {
      // Login state for the single map page. Only public profile fields; private data stays behind /api/private/*.
      const state:AuthState=localOwner?{authenticated:true,dataAvailable:true,identity:null,user:await localUser(env)}:await authentication(request,env),who=state.user;
      const response=secure(json({authenticated:state.authenticated,data_available:state.dataAvailable,needs_signup:!!who&&!who.terms_accepted_at,user:who?{handle:who.handle,display_name:who.display_name,icon:who.icon,avatar_url:who.avatar_url,icon_url:who.icon_version==null?null:`/api/public/icons/${who.handle}?v=${who.icon_version}`,author_status:who.status??null,author_status_at:who.status_at??null}:null}));
      if(state.migrateCookie)response.headers.append('Set-Cookie',state.migrateCookie);return response;
    }
    if (url.pathname.startsWith('/api/public/')) {
      // The shared feed is identical for every viewer and costs the most D1 reads; reuse it for a short time at the edge.
      const cacheable=request.method === 'GET' && url.pathname === '/api/public/entries' && typeof caches !== 'undefined';
      const key=cacheable ? new Request(url.origin+url.pathname+'?'+[...url.searchParams].filter(([name])=>name==='u').map(([name,value])=>name+'='+encodeURIComponent(value)).join('&')) : null;
      if (key) { const hit=await caches.default.match(key); if (hit) return hit; }
      const response=secure(await publicApi(request,env));
      if (key && response.status === 200) { const copy=new Response(response.clone().body,response); copy.headers.set('Cache-Control','public, max-age=30'); await caches.default.put(key,copy); }
      return response;
    }
    // The old owner page moved to the single map page at /.
    if (['/admin','/admin/','/admin/index.html'].includes(url.pathname)) return secure(new Response(null,{status:302,headers:{Location:'/'}}));
    if (['/auth/google','/auth/callback','/auth/continue'].includes(url.pathname) && request.method === 'GET') {
      // Login problems (including database errors) end on a guidance page, never on raw JSON.
      try { return secure(await (url.pathname === '/auth/google' ? startGoogleLogin(request,env) : url.pathname==='/auth/callback'?finishGoogleLogin(request,env):continueGoogleLogin(request,env))); }
      catch { console.error(JSON.stringify({event:'login_failed',request_id:crypto.randomUUID()})); return secure(loginErrorPage(500,'いま混み合っているか、一時的に処理できませんでした。',request)); }
    }
    if (url.pathname === '/auth/logout' && request.method === 'POST') {
      if (request.headers.get('Origin') !== url.origin) return secure(json({error:'操作元を確認できません'},403));
      return secure(await logout(request,env));
    }
    const privatePath=url.pathname.startsWith('/api/private/') || url.pathname === '/admin' || url.pathname.startsWith('/admin/');
    const signupPage=['/signup','/signup/','/signup/index.html'].includes(url.pathname), mapPage=['/','/index.html'].includes(url.pathname);
    let user: User | null = null;
    if (privatePath || signupPage || mapPage) {
      const state:AuthState=localOwner?{authenticated:true,dataAvailable:true,identity:null,user:await localUser(env)}:await authentication(request,env);user=state.user;
      if(state.authenticated&&!state.dataAvailable){
        if(url.pathname.startsWith('/api/private/'))return secure(json({error:'記録データを一時的に利用できません',code:'data_unavailable'},503));
        if(!mapPage)return secure(dataUnavailablePage(request,url.pathname+url.search));
      }
      if(state.authenticated&&state.dataAvailable&&!user)return secure(new Response(null,{status:302,headers:{Location:`/auth/continue?next=${encodeURIComponent(mapPage?'/':url.pathname+url.search)}`}}));
      if (!user && !state.authenticated && !mapPage) {
        if (url.pathname.startsWith('/api/private/')) return secure(json({error:'ログインが必要です',login:'/auth/google'},401));
        return secure(new Response(null,{status:302,headers:{Location:signupPage ? '/auth/google?next=%2Fsignup%2F' : '/auth/google'}}));
      }
    }
    // Until the terms are accepted the account can only see the sign-up page. Decided here, before any static file is served.
    const pending=!!user && !user.terms_accepted_at;
    if (signupPage && !pending && !(localOwner && url.searchParams.get('preview') === '1')) return secure(new Response(null,{status:302,headers:{Location:'/'}}));
    if (pending && (mapPage || url.pathname.startsWith('/admin/'))) return secure(new Response(null,{status:302,headers:{Location:'/signup/'}}));
    if (url.pathname.startsWith('/api/private/')) {
      if (!['GET','HEAD'].includes(request.method) && request.headers.get('Origin') !== url.origin) return secure(json({error:'操作元を確認できません'},403));
      const open=request.method === 'GET' ? ['/api/private/me','/api/private/bootstrap'] : request.method === 'POST' ? ['/api/private/signup','/api/private/signup/cancel'] : [];
      if (pending && !open.includes(url.pathname)) return secure(json({error:'利用規約への同意が必要です',signup:'/signup/'},403));
      return secure(await privateApi(request,env,user!));
    }
    if (!['GET','HEAD'].includes(request.method)) return secure(json({error:'Method not allowed'},405));
    const asset=await env.ASSETS.fetch(new Request(url,request));
    const response=secure(asset, privatePath || ['/','/index.html','/vendor/maplibre-gl-worker.mjs'].includes(url.pathname));
    // App files change on every deploy; make browsers revalidate so phones never mix old and new code.
    if (!url.pathname.startsWith('/vendor/')) response.headers.set('Cache-Control','no-cache');
    return response;
  } catch (error) {
    if (error instanceof InputError) return secure(json({error:error.message},400));
    if (error instanceof Error && /constraint|refund |valuation|FOREIGN KEY|allocations|budget/i.test(error.message)) return secure(json({error:'データの組合せを保存できません。分類・旅・返金元・金額を確認してください'},409));
    console.error(JSON.stringify({event:'request_failed',request_id:crypto.randomUUID()}));
    return secure(json({error:'処理できませんでした。時間をおいて再試行してください'},500));
  }
}
function secure(response: Response, ownerMap = false): Response {
  const result=new Response(response.body,response);
  result.headers.set('X-Content-Type-Options','nosniff');
  result.headers.set('Referrer-Policy','no-referrer');
  result.headers.set('X-Frame-Options','DENY');
  result.headers.set('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://lh3.googleusercontent.com; manifest-src 'self'; connect-src 'self'${ownerMap ? ' https://tiles.openfreemap.org' : ''}; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com`);
  return result;
}
export default {fetch(request: Request,env: Env) { return handle(request,env); }} satisfies ExportedHandler<Env>;
