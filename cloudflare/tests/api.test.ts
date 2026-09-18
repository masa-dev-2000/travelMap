import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {handle} from '../src/worker.ts';
import {verifyAccessToken,verifyGoogleIdToken,createSession,sessionCookieForTest,finishGoogleLogin,upsertGoogleUser} from '../src/auth.ts';
import local from '../src/local.ts';
import {cleanPng} from '../src/png.ts';
import {deflateSync} from 'node:zlib';

const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-09-09',d1Databases:['DB'],r2Buckets:['FILES']}));
let env;
before(async()=>{
  const statements=JSON.parse(execFileSync('python',['-c',`
import json,sqlite3
from pathlib import Path
result=[]
for p in [Path('../data_model/schema.sql'),Path('schema-extra.sql')]:
 s=''
 for line in p.read_text(encoding='utf-8').splitlines(True):
  s+=line
  if sqlite3.complete_statement(s):
   if 'PRAGMA foreign_keys' not in s: result.append(s)
   s=''
print(json.dumps(result))
`],{encoding:'utf8'}));
  const DB=await mf.getD1Database('DB');
  for(const sql of statements)await DB.prepare(sql).run();
  const now=new Date().toISOString();
  await DB.batch([['local-owner','local@localhost','local'],['u2','second@example.com','second']].map(([id,email,handle])=>DB.prepare('INSERT INTO users(id,google_sub,email,display_name,handle,avatar_url,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,null,email,handle,handle,null,now)));
  await DB.batch(['action:activity','cost:expense','salary:income'].map(pair=>{const [id,kind]=pair.split(':');return DB.prepare('INSERT INTO categories(id,kind,name,user_id) VALUES(?,?,?,?)').bind(id,kind,id,'local-owner');}));
  await DB.prepare("INSERT INTO categories(id,kind,name,user_id) VALUES('u2-action','activity','u2','u2')").run();
  env={DB,FILES:await mf.getR2Bucket('FILES'),ASSETS:{fetch:async()=>new Response('static')},ACCESS_ISSUER:'',ACCESS_AUD:'',OWNER_EMAIL:'',GOOGLE_CLIENT_ID:'client-id',GOOGLE_CLIENT_SECRET:'client-secret'};
});
after(async()=>{await mf.dispose();});
const request=(path,body,key=crypto.randomUUID(),origin='https://travel.test')=>new Request('https://travel.test'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','Origin':origin,'Idempotency-Key':key},body:JSON.stringify(body)});
const owner=(path,body,key,origin)=>handle(request(path,body,key,origin),env,true);
// A second, session-authenticated user for isolation tests.
let u2Cookie='';
const asUser2=async(path,body,method)=>{
  if(!u2Cookie)u2Cookie=sessionCookieForTest(await createSession(env.DB,'u2'));
  const init=body===undefined?{method:method??'GET',headers:{Cookie:u2Cookie,Origin:'https://travel.test'}}:{method:method??'POST',headers:{'Content-Type':'application/json','Origin':'https://travel.test','Idempotency-Key':crypto.randomUUID(),Cookie:u2Cookie},body:JSON.stringify(body)};
  return handle(new Request('https://travel.test'+path,init),env);
};
const activity=(extra={})=>({category_id:'action',occurred_at:'2025-11-30T15:00:00Z',memo:'PRIVATE MEMO',latitude:35,longitude:134,...extra});

test('vector map network access is limited to owner document and local map worker',async()=>{
  for(const path of ['/admin/','/vendor/maplibre-gl-worker.mjs']){
    const policy=(await owner(path)).headers.get('Content-Security-Policy');
    assert.ok(policy.includes("connect-src 'self' https://tiles.openfreemap.org;"));
    assert.ok(policy.includes("script-src 'self';"));
    assert.ok(policy.includes("worker-src 'self';"));
    assert.ok(!policy.includes('unsafe-eval'));
  }
  for(const path of ['/','/api/public/entries','/api/private/bootstrap']){
    assert.ok(!(await owner(path)).headers.get('Content-Security-Policy').includes('openfreemap.org'));
  }
});

test('production denies missing/forged JWT; local entry refuses non-loopback host',async()=>{
  assert.equal((await handle(request('/api/private/bootstrap'),env)).status,401);
  const redirect=await handle(new Request('https://travel.test/admin/',{headers:{'Cf-Access-Jwt-Assertion':'forged'}}),env);
  assert.equal(redirect.status,302);assert.equal(redirect.headers.get('Location'),'/auth/google');
  assert.equal((await handle(new Request('https://travel.test/api/private/bootstrap',{headers:{Cookie:'tm_session='+'f'.repeat(64)}}),env)).status,401);
  assert.equal((await local.fetch(request('/admin/'),env)).status,403);
  assert.equal((await handle(request('/api/public/entries'),env)).status,200);
});
test('Access verifies signature, issuer, audience, expiry and exact owner',async()=>{
  const keys=await generateKeyPair('RS256'),jwk=await exportJWK(keys.publicKey);jwk.kid='test';
  const key=createLocalJWKSet({keys:[jwk]}),settings={ACCESS_ISSUER:'https://test.cloudflareaccess.com',ACCESS_AUD:'app',OWNER_EMAIL:'owner@example.com'};
  const sign=(email='owner@example.com',aud='app',expiry='5m')=>new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('owner').setIssuer(settings.ACCESS_ISSUER).setAudience(aud).setIssuedAt().setExpirationTime(expiry).sign(keys.privateKey);
  assert.equal(await verifyAccessToken(await sign(),settings,key),true);
  assert.equal(await verifyAccessToken(await sign('other@example.com'),settings,key),false);
  assert.equal(await verifyAccessToken(await sign('owner@example.com','other'),settings,key),false);
  assert.equal(await verifyAccessToken(await sign('owner@example.com','app','-1s'),settings,key),false);
  assert.equal(await verifyAccessToken('forged',settings,key),false);
});
test('cross-origin writes rejected before mutation',async()=>{
  assert.equal((await owner('/api/private/activities',activity(),undefined,'https://evil.test')).status,403);
});
test('activity and expense atomic; replay does not duplicate; null differs from zero',async()=>{
  const body=activity({transaction:{category_id:'cost',amount_minor:0}}),key=crypto.randomUUID();
  const first=await owner('/api/private/activities',body,key);assert.equal(first.status,201);const a=await first.json();
  assert.deepEqual(await (await owner('/api/private/activities',body,key)).json(),a);
  assert.equal((await owner('/api/private/activities',activity({memo:'changed'}),key)).status,409);
  assert.equal((await owner('/api/private/activities',activity({transaction:{category_id:'cost',amount_minor:-1}}))).status,400);
  const empty=await owner('/api/private/activities',activity());assert.equal(empty.status,201);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM activities').first()).n,2);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM transactions WHERE amount_minor=0').first()).n,1);
});
test('JPY month boundary, unconverted currency, income and refunds aggregate separately',async()=>{
  const tx={category_id:'cost',occurred_at:'2025-11-30T15:00:00Z',amount_minor:100};
  assert.equal((await owner('/api/private/transactions',tx)).status,201);
  const original=await env.DB.prepare('SELECT id FROM transactions WHERE amount_minor=100').first();
  assert.equal((await owner('/api/private/transactions',{...tx,kind:'refund',refund_of:original.id,amount_minor:20})).status,201);
  assert.equal((await owner('/api/private/transactions',{...tx,kind:'refund',refund_of:original.id,amount_minor:81})).status,409);
  assert.equal((await owner('/api/private/transactions',{...tx,currency:'USD',minor_unit:2,amount_minor:1299})).status,201);
  assert.equal((await owner('/api/private/transactions',{...tx,occurred_at:'2025-11-30T14:59:59Z',amount_minor:5})).status,201);
  const result=await(await owner('/api/private/summary?month=2025-12')).json();
  assert.equal(result.expense_jpy,100);assert.equal(result.refund_jpy,20);assert.equal(result.unconverted_count,1);
  assert.equal((await(await owner('/api/private/summary?month=2025-11')).json()).expense_jpy,5);
});
test('published projection uses selected snapshot; unpublishing removes it',async()=>{
  const original=await env.DB.prepare('SELECT id FROM activities LIMIT 1').first();
  const body={activity_id:original.id,date:'2025-12-01',memo:'SELECTED TEXT',confirmed:true};
  const saved=await owner('/api/private/public-entries',body);assert.equal(saved.status,201);const {id}=await saved.json();
  await env.DB.prepare("UPDATE activities SET memo='NEW PRIVATE' WHERE id=?").bind(original.id).run();
  const feed=await (await handle(request('/api/public/entries'),env)).json();
  assert.equal(feed.entries[0].memo,'SELECTED TEXT');assert.equal(feed.entries[0].latitude,null);
  for(const secret of ['PRIVATE','amount','activity_id','trip_id','storage_location'])assert.ok(!JSON.stringify(feed).includes(secret));
  assert.equal((await owner(`/api/private/public-entries/${id}/unpublish`,{})).status,200);
  assert.deepEqual((await (await handle(request('/api/public/entries'),env)).json()).entries,[]);
});
function chunk(kind,body){const data=Buffer.concat([Buffer.from(kind),body]);let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(body.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([head,data,tail]);}
test('PNG metadata stripped and receipts cannot enter public feed',async()=>{
  const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',Buffer.from('GPS\0PRIVATE')),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0]))),chunk('IEND',Buffer.alloc(0))]);
  assert.ok(!Buffer.from(cleanPng(png)).includes('PRIVATE'));assert.throws(()=>cleanPng(png.subarray(0,png.length-1)));
  const a=await env.DB.prepare('SELECT id FROM activities LIMIT 1').first();
  async function upload(purpose){const response=await handle(new Request(`https://travel.test/api/private/attachments?activity_id=${a.id}&purpose=${purpose}`,{method:'POST',headers:{'Origin':'https://travel.test','Content-Type':'image/png'},body:png}),env,true);assert.equal(response.status,201);return (await response.json()).id;}
  const receipt=await upload('receipt'),photo=await upload('photo');
  const shared={activity_id:a.id,date:'2025-12-01',memo:'safe',confirmed:true,photo_ids:[receipt]};
  assert.equal((await owner('/api/private/public-entries',shared)).status,400);
  assert.equal((await owner('/api/private/public-entries',{...shared,photo_ids:[photo]})).status,201);
  const feed=await(await handle(request('/api/public/entries'),env)).json();
  const image=await handle(request(feed.entries[0].photos[0].url),env);
  assert.equal(image.headers.get('Content-Type'),'image/png');assert.ok(!Buffer.from(await image.arrayBuffer()).includes('PRIVATE'));
});

test('publish default setting persists and publish-on-create exposes only snapshot fields',async()=>{
  assert.equal((await(await owner('/api/private/bootstrap')).json()).settings.publish_default,false);
  assert.equal((await owner('/api/private/settings',{publish_default:'yes'})).status,400);
  assert.equal((await owner('/api/private/settings',{publish_default:true})).status,200);
  assert.equal((await(await owner('/api/private/bootstrap')).json()).settings.publish_default,true);
  const created=await(await owner('/api/private/activities',activity({memo:'AUTO PUBLIC',observed_place_name:'港',occurred_at:'2025-11-30T16:00:00Z',publish:true,transaction:{category_id:'cost',amount_minor:700,currency:'JPY',minor_unit:0}}))).json();
  assert.ok(created.public_id);
  const feed=await(await handle(request('/api/public/entries'),env)).json();
  const entry=feed.entries.find(item=>item.id===created.public_id);
  assert.deepEqual([entry.date,entry.place_name,entry.memo,entry.latitude,entry.longitude],['2025-12-01','港','AUTO PUBLIC',35,134]);
  assert.equal(entry.spent_jpy,700);
  const hidden=await(await owner('/api/private/activities',activity({memo:'STAYS PRIVATE',publish:false}))).json();
  assert.equal(hidden.public_id,null);
  assert.ok(!JSON.stringify(await(await handle(request('/api/public/entries'),env)).json()).includes('STAYS PRIVATE'));
  assert.equal((await owner('/api/private/activities',activity({publish:'true'}))).status,400);
  await owner('/api/private/settings',{publish_default:false});
});

test('date range assignment groups records into a trip and the public feed exposes the trip',async()=>{
  const trip=await(await owner('/api/private/trips',{name:'春の旅',starts_on:'2025-04-01',ends_on:'2025-04-30'})).json();
  const inside=await(await owner('/api/private/activities',activity({memo:'IN TRIP',occurred_at:'2025-04-10T01:00:00Z',publish:true}))).json();
  const outside=await(await owner('/api/private/activities',activity({memo:'OUT OF TRIP',occurred_at:'2025-05-10T01:00:00Z',publish:true}))).json();
  assert.equal((await(await owner(`/api/private/trips/${trip.id}/assign`,{starts_on:'2025-04-01',ends_on:'2025-04-30'})).json()).assigned,1);
  assert.equal((await owner(`/api/private/trips/${trip.id}/assign`,{starts_on:'2025-04-30',ends_on:'2025-04-01'})).status,400);
  assert.equal((await owner('/api/private/trips/missing-trip/assign',{starts_on:'2025-04-01',ends_on:'2025-04-30'})).status,400);
  const feed=await(await handle(request('/api/public/entries'),env)).json();
  const find=id=>feed.entries.find(entry=>entry.id===id);
  assert.equal(find(inside.public_id).trip_name,'春の旅');
  assert.ok(!JSON.stringify(feed).includes(trip.id));
  assert.equal(find(outside.public_id).trip_name,null);
});

test('Google id_token is verified for issuer, audience, nonce and verified email; callback issues a session',async()=>{
  const keys=await generateKeyPair('RS256'),jwk=await exportJWK(keys.publicKey);jwk.kid='g';const key=createLocalJWKSet({keys:[jwk]});
  const sign=(claims,aud='client-id',issuer='https://accounts.google.com')=>new SignJWT({email:'new@example.com',email_verified:true,nonce:'n1',name:'New Person',...claims}).setProtectedHeader({alg:'RS256',kid:'g'}).setSubject('sub-1').setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
  assert.equal((await verifyGoogleIdToken(await sign({}),'client-id','n1',key)).sub,'sub-1');
  assert.equal(await verifyGoogleIdToken(await sign({}),'client-id','other-nonce',key),null);
  assert.equal(await verifyGoogleIdToken(await sign({},'other-app'),'client-id','n1',key),null);
  assert.equal(await verifyGoogleIdToken(await sign({},'client-id','https://evil.example'),'client-id','n1',key),null);
  assert.equal(await verifyGoogleIdToken(await sign({email_verified:false}),'client-id','n1',key),null);
  const idToken=await sign({});
  const fakeFetch=async()=>Response.json({id_token:idToken});
  const callback=new Request('https://travel.test/auth/callback?code=abc&state=s1',{headers:{Cookie:'tm_oauth=s1.n1.verifier'}});
  const response=await finishGoogleLogin(callback,env,fakeFetch,key);
  assert.equal(response.status,302);assert.equal(response.headers.get('Location'),'/admin/');
  const cookie=response.headers.get('Set-Cookie');assert.ok(/tm_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure/.test(cookie));
  const token=cookie.match(/tm_session=([a-f0-9]{64})/)[1];
  const me=await(await handle(new Request('https://travel.test/api/private/me',{headers:{Cookie:'tm_session='+token}}),env)).json();
  assert.equal(me.user.email,'new@example.com');assert.match(me.user.handle,/^traveler-[a-f0-9]{6}$/);
  assert.equal((await finishGoogleLogin(new Request('https://travel.test/auth/callback?code=abc&state=WRONG',{headers:{Cookie:'tm_oauth=s1.n1.verifier'}}),env,fakeFetch,key)).status,400);
  // owner row pre-created by migration (email only) is claimed by the matching Google account
  await env.DB.prepare("INSERT INTO users(id,google_sub,email,display_name,handle,avatar_url,created_at) VALUES('pre','','pre@example.com','pre','pre',NULL,'2026-01-01T00:00:00Z')").run().catch(()=>{});
  await env.DB.prepare("UPDATE users SET google_sub=NULL WHERE id='pre'").run();
  const claimed=await upsertGoogleUser(env.DB,{sub:'sub-pre',email:'PRE@example.com',name:'Pre'});
  assert.equal(claimed.id,'pre');
});

test('users cannot read, edit, publish or delete records of other users',async()=>{
  const mine=await(await owner('/api/private/activities',activity({memo:'OWNER ONLY'}))).json();
  const theirs=await(await asUser2('/api/private/activities',{category_id:'u2-action',occurred_at:'2025-11-30T15:00:00Z',memo:'USER2 ONLY',latitude:35,longitude:134})).json();
  assert.ok(theirs.id);
  const list=await(await asUser2('/api/private/activities')).json();
  assert.ok(list.activities.every(item=>item.memo!=='OWNER ONLY'));
  assert.ok(!JSON.stringify(await(await owner('/api/private/activities')).json()).includes('USER2 ONLY'));
  assert.equal((await asUser2('/api/private/activities',{category_id:'action',occurred_at:'2025-11-30T15:00:00Z'})).status,400);
  assert.equal((await asUser2(`/api/private/activities/${mine.id}`,{memo:'hacked'})).status,400);
  assert.equal((await asUser2(`/api/private/activities/${mine.id}`,undefined,'DELETE')).status,400);
  assert.equal((await asUser2('/api/private/public-entries',{activity_id:mine.id,date:'2025-12-01',memo:'leak',confirmed:true})).status,400);
  assert.equal((await asUser2('/api/private/attachments?activity_id='+mine.id)).status,400);
  assert.equal((await env.DB.prepare("SELECT memo FROM activities WHERE id=?").bind(mine.id).first()).memo,'OWNER ONLY');
  const summary=await(await asUser2('/api/private/summary')).json();assert.equal(summary.expense_jpy,0);
});

test('editing updates the record and its public snapshot; deleting removes everything',async()=>{
  const created=await(await owner('/api/private/activities',activity({memo:'BEFORE',observed_place_name:'旧',publish:true,transaction:{category_id:'cost',amount_minor:300}}))).json();
  assert.equal((await owner(`/api/private/activities/${created.id}`,{memo:'AFTER',observed_place_name:'新',latitude:36,longitude:135,rating:4,occurred_at:'2025-12-02T01:00:00Z'})).status,200);
  const row=await env.DB.prepare('SELECT memo,observed_place_name,latitude,rating,occurred_at FROM activities WHERE id=?').bind(created.id).first();
  assert.deepEqual([row.memo,row.observed_place_name,row.latitude,row.rating,row.occurred_at],['AFTER','新',36,4,'2025-12-02T01:00:00.000Z']);
  assert.equal((await env.DB.prepare('SELECT occurred_at FROM transactions WHERE activity_id=?').bind(created.id).first()).occurred_at,'2025-12-02T01:00:00.000Z');
  const feed=await(await handle(request('/api/public/entries'),env)).json();const entry=feed.entries.find(e=>e.id===created.public_id);
  assert.deepEqual([entry.memo,entry.place_name,entry.latitude,entry.longitude,entry.spent_jpy],['AFTER','新',36,135,300]);
  assert.equal((await owner(`/api/private/activities/${created.id}/amount`,{category_id:'cost',amount_minor:900})).status,200);
  assert.equal((await handle(request('/api/public/entries'),env)).ok,true);
  assert.equal((await(await handle(request('/api/public/entries'),env)).json()).entries.find(e=>e.id===created.public_id).spent_jpy,900);
  assert.equal((await owner(`/api/private/activities/${created.id}/amount`,{amount_minor:null})).status,200);
  assert.equal((await(await handle(request('/api/public/entries'),env)).json()).entries.find(e=>e.id===created.public_id).spent_jpy,null);
  assert.equal((await owner(`/api/private/activities/${created.id}`,{})).status,400);
  const deleted=await handle(new Request('https://travel.test/api/private/activities/'+created.id,{method:'DELETE',headers:{Origin:'https://travel.test'}}),env,true);
  assert.equal(deleted.status,200);
  assert.equal(await env.DB.prepare('SELECT id FROM activities WHERE id=?').bind(created.id).first(),null);
  assert.equal(await env.DB.prepare('SELECT id FROM public_entries WHERE activity_id=?').bind(created.id).first(),null);
  assert.ok(!(await(await handle(request('/api/public/entries'),env)).json()).entries.some(e=>e.id===created.public_id));
});

test('publication precision hides coordinates or place, and delayed entries stay hidden until publish_at',async()=>{
  const city=await(await owner('/api/private/activities',activity({memo:'CITY',observed_place_name:'鳥取市',publish:true,precision:'city'}))).json();
  const hidden=await(await owner('/api/private/activities',activity({memo:'HIDDEN',observed_place_name:'自宅',publish:true,precision:'hidden'}))).json();
  const later=await(await owner('/api/private/activities',activity({memo:'LATER',publish:true,publish_delay_hours:48}))).json();
  const feed=await(await handle(request('/api/public/entries'),env)).json();const find=id=>feed.entries.find(e=>e.id===id);
  assert.deepEqual([find(city.public_id).place_name,find(city.public_id).latitude,find(city.public_id).longitude,find(city.public_id).precision],['鳥取市',null,null,undefined]);
  assert.deepEqual([find(hidden.public_id).place_name,find(hidden.public_id).latitude],[null,null]);
  assert.equal(find(later.public_id),undefined);
  assert.ok(!JSON.stringify(feed).includes('自宅'));
  await env.DB.prepare("UPDATE public_entries SET publish_at='2020-01-01T00:00:00Z' WHERE id=?").bind(later.public_id).run();
  assert.ok((await(await handle(request('/api/public/entries'),env)).json()).entries.some(e=>e.id===later.public_id));
  assert.equal((await owner('/api/private/settings',{publish_precision:'city',publish_delay_hours:1})).status,200);
  const defaulted=await(await owner('/api/private/activities',activity({memo:'DEFAULTED',publish:true}))).json();
  const stored=await env.DB.prepare('SELECT precision,publish_at FROM public_entries WHERE id=?').bind(defaulted.public_id).first();
  assert.equal(stored.precision,'city');assert.ok(stored.publish_at>new Date().toISOString());
  assert.equal((await owner(`/api/private/public-entries/${defaulted.public_id}/options`,{precision:'exact',publish_delay_hours:0})).status,200);
  assert.equal((await env.DB.prepare('SELECT publish_at FROM public_entries WHERE id=?').bind(defaulted.public_id).first()).publish_at,null);
  await owner('/api/private/settings',{publish_precision:'exact',publish_delay_hours:0});
  assert.equal((await owner('/api/private/settings',{publish_precision:'street'})).status,400);
});

test('logout requires same-origin POST and clears the session; deleting a migrated record detaches source rows',async()=>{
  const token=await createSession(env.DB,'u2');
  assert.equal((await handle(new Request('https://travel.test/auth/logout',{method:'POST',headers:{Cookie:sessionCookieForTest(token),Origin:'https://evil.test'}}),env)).status,403);
  assert.equal((await handle(new Request('https://travel.test/api/private/me',{headers:{Cookie:sessionCookieForTest(token)}}),env)).status,200);
  const out=await handle(new Request('https://travel.test/auth/logout',{method:'POST',headers:{Cookie:sessionCookieForTest(token),Origin:'https://travel.test'}}),env);
  assert.equal(out.status,302);
  assert.equal((await handle(new Request('https://travel.test/api/private/me',{headers:{Cookie:sessionCookieForTest(token)}}),env)).status,401);
  const legacy=await(await owner('/api/private/activities',activity({memo:'LEGACY',transaction:{category_id:'cost',amount_minor:10}}))).json();
  await env.DB.prepare("INSERT INTO import_batches VALUES('b1','{}','p','2026-01-01T00:00:00Z')").run().catch(()=>{});
  await env.DB.prepare("INSERT INTO source_records(id,batch_id,source_database,source_path,source_id,raw_json,sha256,status) VALUES('s1','b1','firestore','x','x','{}','0','converted')").run();
  await env.DB.prepare("INSERT INTO source_targets(source_id,activity_id) VALUES('s1',?)").bind(legacy.id).run();
  const deleted=await handle(new Request('https://travel.test/api/private/activities/'+legacy.id,{method:'DELETE',headers:{Origin:'https://travel.test'}}),env,true);
  assert.equal(deleted.status,200);
  assert.equal(await env.DB.prepare('SELECT id FROM activities WHERE id=?').bind(legacy.id).first(),null);
});

test('login next only accepts /admin paths; profile settings validate handle and tip link; public profile exposes no email',async()=>{
  const {safeNext}=await import('../src/auth.ts');
  assert.equal(safeNext('/admin/record/'),'/admin/record/');assert.equal(safeNext('https://evil.test/'),'/admin/');assert.equal(safeNext('//evil.test'),'/admin/');assert.equal(safeNext('/api/private/me'),'/admin/');
  assert.equal((await owner('/api/private/settings',{handle:'Bad Handle'})).status,400);
  assert.equal((await owner('/api/private/settings',{handle:'second'})).status,400);
  assert.equal((await owner('/api/private/settings',{tip_url:'http://insecure.example'})).status,400);
  assert.equal((await owner('/api/private/settings',{display_name:'まさ',handle:'masa-test',bio:'旅人',tip_url:'https://tip.example/masa'})).status,200);
  const profile=await(await handle(request('/api/public/users/masa-test'),env)).json();
  assert.deepEqual([profile.display_name,profile.handle,profile.bio,profile.tip_url],['まさ','masa-test','旅人','https://tip.example/masa']);
  assert.ok(!JSON.stringify(profile).includes('local@localhost'));
  assert.equal((await handle(request('/api/public/users/nobody'),env)).status,404);
  const mine=await(await handle(request('/api/public/entries?u=masa-test'),env)).json();
  assert.ok(mine.entries.every(e=>e.author==='masa-test'));
  await owner('/api/private/settings',{handle:'local'});
});
