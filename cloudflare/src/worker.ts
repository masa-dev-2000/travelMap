import { currentUser, finishGoogleLogin, logout, startGoogleLogin, type User } from './auth.ts';
import { json, privateApi, publicApi } from './api.ts';
import { InputError } from './validation.ts';

const LOCAL_USER: User = {id: 'local-owner', email: 'local@localhost', display_name: 'ローカル', handle: 'local', avatar_url: null, bio: '', tip_url: null};

// Local development has no Google login; the local entry point vouches for a fixed account.
async function localUser(env: Env): Promise<User> {
  await env.DB.prepare('INSERT OR IGNORE INTO users(id,google_sub,email,display_name,handle,avatar_url,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind(LOCAL_USER.id, null, LOCAL_USER.email, LOCAL_USER.display_name, LOCAL_USER.handle, null, new Date().toISOString()).run();
  return LOCAL_USER;
}

export async function handle(request: Request, env: Env, localOwner = false): Promise<Response> {
  const url=new URL(request.url);
  try {
    if (url.pathname.startsWith('/api/public/')) return secure(await publicApi(request,env));
    if (url.pathname === '/auth/google' && request.method === 'GET') return secure(await startGoogleLogin(request,env));
    if (url.pathname === '/auth/callback' && request.method === 'GET') return secure(await finishGoogleLogin(request,env));
    if (url.pathname === '/auth/logout' && request.method === 'POST') {
      if (request.headers.get('Origin') !== url.origin) return secure(json({error:'操作元を確認できません'},403));
      return secure(await logout(request,env));
    }
    const privatePath=url.pathname.startsWith('/api/private/') || url.pathname === '/admin' || url.pathname.startsWith('/admin/');
    let user: User | null = null;
    if (privatePath) {
      user = localOwner ? await localUser(env) : await currentUser(request,env);
      if (!user) {
        if (url.pathname.startsWith('/api/private/')) return secure(json({error:'ログインが必要です',login:'/auth/google'},401));
        return secure(new Response(null,{status:302,headers:{Location:'/auth/google'}}));
      }
    }
    if (url.pathname.startsWith('/api/private/')) {
      if (!['GET','HEAD'].includes(request.method) && request.headers.get('Origin') !== url.origin) return secure(json({error:'操作元を確認できません'},403));
      return secure(await privateApi(request,env,user!));
    }
    if (!['GET','HEAD'].includes(request.method)) return secure(json({error:'Method not allowed'},405));
    // /u/<handle> is the public page filtered to one author; served from the same document.
    if (/^\/u\/[a-z0-9-]+\/?$/.test(url.pathname)) { const rewritten=new URL(url); rewritten.pathname='/'; return secure(await env.ASSETS.fetch(new Request(rewritten,request))); }
    const asset=await env.ASSETS.fetch(new Request(url,request));
    const response=secure(asset, privatePath || url.pathname === '/vendor/maplibre-gl-worker.mjs');
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
