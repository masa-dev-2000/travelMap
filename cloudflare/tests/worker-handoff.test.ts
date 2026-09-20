import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {handle} from '../src/worker.ts';
import {createSession,sessionCookieForTest} from '../src/auth.ts';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-09-09',d1Databases:['DB'],r2Buckets:['FILES']}));
let env,u2Cookie;
before(async()=>{
  const statements=JSON.parse(execFileSync('python',['-c',`
import json,sqlite3
from pathlib import Path
out=[]
for path in [Path('../data_model/schema.sql'),Path('schema-extra.sql')]:
 s=''
 for line in path.read_text(encoding='utf-8').splitlines(True):
  s+=line
  if sqlite3.complete_statement(s):
   if 'PRAGMA foreign_keys' not in s: out.append(s)
   s=''
print(json.dumps(out))
`],{encoding:'utf8'}));
  const DB=await mf.getD1Database('DB');for(const sql of statements)await DB.prepare(sql).run();
  const now=new Date().toISOString();
  for(const uid of ['local-owner','u2'])await DB.prepare('INSERT INTO users(id,email,display_name,handle,created_at,terms_accepted_at,onboarded_at) VALUES(?,?,?,?,?,?,?)').bind(uid,uid+'@example.invalid',uid,uid,now,now,now).run();
  env={DB,FILES:await mf.getR2Bucket('FILES'),ASSETS:{fetch:async()=>new Response('static')},ACCESS_ISSUER:'',ACCESS_AUD:'',OWNER_EMAIL:'',GOOGLE_CLIENT_ID:'client-id',GOOGLE_CLIENT_SECRET:'client-secret',SESSION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64url')};
  u2Cookie=sessionCookieForTest(await createSession(DB,'u2'));
});
after(()=>mf.dispose());
const request=(path,body,key=crypto.randomUUID(),origin='https://travel.test')=>new Request('https://travel.test'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','Origin':origin,'Idempotency-Key':key},body:JSON.stringify(body)});
const owner=(path,body,key,origin)=>handle(request(path,body,key,origin),env,true);
const asUser2=(path,body)=>handle(new Request('https://travel.test'+path,{method:'POST',headers:{Cookie:u2Cookie,Origin:'https://travel.test','Content-Type':'application/json'},body:JSON.stringify(body)}),env);
test('handoff passes through real Worker, Miniflare D1, Origin and authenticated-owner boundaries',async()=>{
  const client=crypto.randomUUID(),capture=crypto.randomUUID(),page=crypto.randomUUID(),token='c'.repeat(64);
  const cred={client_id:client,capture_id:capture,page_id:page};
  const handoff={...cred,command:'prepare',token,destination:'/admin/record/',next_at:Date.now()+300000};
  assert.equal((await owner('/api/private/location-capture',{...cred,command:'start'})).status,200);
  assert.equal((await owner('/api/private/location-capture',handoff,undefined,'https://evil.test')).status,403);
  assert.equal((await owner('/api/private/location-capture',handoff)).status,200);
  const claim={...cred,command:'claim',token,destination:'/admin/record/',capture_id:crypto.randomUUID(),page_id:crypto.randomUUID()};
  assert.equal((await asUser2('/api/private/location-capture',claim)).status,409);
  const first=await(await owner('/api/private/location-capture',claim)).json();
  const again=await(await owner('/api/private/location-capture',claim)).json();assert.deepEqual(again,first);
  assert.equal((await owner('/api/private/location-capture',{...claim,page_id:crypto.randomUUID()})).status,409);
  await owner('/api/private/location-capture',{...cred,command:'stop'});
  const sample={...claim,id:crypto.randomUUID(),segment_id:crypto.randomUUID(),captured_at:new Date().toISOString(),latitude:0,longitude:0,accuracy:1};
  assert.equal((await owner('/api/private/location-samples',sample)).status,201);
  assert.equal((await handle(request('/api/public/entries'),env)).headers.get('Referrer-Policy'),'no-referrer');
  const feed=await(await handle(request('/api/public/entries'),env)).text();assert.ok(!feed.includes(sample.id));
  await owner('/api/private/location-capture',{...claim,command:'stop'});
});
