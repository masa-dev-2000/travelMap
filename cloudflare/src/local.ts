// This entry point is local-only. Production config always selects worker.ts.
import { handle } from './worker.ts';
export default {
  fetch(request: Request,env: Env) {
    const host=new URL(request.url).hostname;
    if (!['localhost','127.0.0.1','[::1]'].includes(host)) return new Response('Local development only',{status:403,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    return handle(request,env,true);
  },
} satisfies ExportedHandler<Env>;
