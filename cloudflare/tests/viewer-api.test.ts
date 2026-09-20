import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {viewerApi} from '../src/viewer-api.ts';
import {publicApi} from '../src/api.ts';
// Real API SQL on SQLite. Worker authentication/Origin are covered in api.test.ts.
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../../data_model/schema.sql',import.meta.url),'utf8')+readFileSync(new URL('../schema-extra.sql',import.meta.url),'utf8'));
 const now=new Date().toISOString();
 for(const id of ['v','w','a','b','secret']){
  sql.prepare('INSERT INTO users(id,email,display_name,handle,created_at,terms_accepted_at) VALUES(?,?,?,?,?,?)').run(id,id+'@example.invalid',id,'person-'+id,now,now);
  sql.prepare('INSERT INTO categories(id,kind,name,user_id) VALUES(?,?,?,?)').run('cat-'+id,'activity','観光',id);
  sql.prepare('INSERT INTO user_settings VALUES(?,?,?)').run(id,'map_visible',id==='secret'?'false':'true');
 }
 const prepare=(q:string)=>{const s=sql.prepare(q);let values:any[]=[];return {bind(...args:any[]){values=args;return this;},async run(){return {meta:{changes:Number(s.run(...values).changes)}};},async first(){return s.get(...values)||null;},async all(){return {results:s.all(...values)};}};};
 const db={prepare,async batch(items:any[]){sql.exec('BEGIN');try{const result=[];for(const s of items)result.push(await s.all());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB:db,FILES:{}} as unknown as Env;
 const call=(path:string,body?:unknown,who='v')=>viewerApi(new Request('https://test.example/api/private/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env,{id:who,handle:'person-'+who} as any);
 const feed=async(who='v')=>await(await call('viewer-feed',undefined,who))!.json() as any;
 function entry(id:string,author='a',date='2026-09-20',extra:any={}){
  sql.prepare('INSERT INTO activities(id,occurred_at,timezone,timezone_basis,category_id,memo,observed_place_name,latitude,longitude,user_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run('act-'+id,date+'T00:00:00Z','Asia/Tokyo','recorded','cat-'+author,'PRIVATE','PRIVATE',35,134,author);
  sql.prepare('INSERT INTO public_entries(id,activity_id,date,memo,place_name,status,user_id,precision,publish_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,'act-'+id,date,'public '+id,'place '+id,extra.status||'published',author,extra.precision||'exact',extra.delay??null);
  sql.prepare('INSERT INTO public_entry_locations VALUES(?,?,?)').run(id,35,134);
 }
 return {sql,env,call,feed,entry,close:()=>sql.close()};
}
test('viewer feed applies mute/self and preserves public privacy rules',async()=>{
 const f=fixture();try{
  f.entry('one');f.entry('two','b','2026-09-19',{precision:'city'});f.entry('mine','v');f.entry('hidden','secret');f.entry('future','a','2026-09-20',{delay:'2999-01-01T00:00:00Z'});f.entry('draft','a','2026-09-20',{status:'draft'});
  const before=await f.feed();assert.deepEqual(new Set(before.entries.map((e:any)=>e.id)),new Set(['one','two']));assert.equal(before.entries.find((e:any)=>e.id==='two').latitude,null);assert.ok(!JSON.stringify(before).includes('PRIVATE'));
  await f.call('mutes',{handle:'person-a',muted:true});const after=await f.feed();assert.deepEqual(after.muted,['person-a']);assert.deepEqual(after.entries.map((e:any)=>e.id),['two']);
  const publicFeed=await(await publicApi(new Request('https://test.example/api/public/entries'),f.env)).json() as any;assert.ok(publicFeed.entries.some((e:any)=>e.id==='one'));assert.ok(!('publication_seq'in publicFeed.entries[0]));assert.ok((await f.feed('w')).entries.some((e:any)=>e.id==='one'));
  await f.call('mutes',{handle:'person-a',muted:false});assert.equal((await f.feed()).entries.length,2);
 }finally{f.close();}
});
test('same-day smaller IDs, backdating and date edits cannot hide new publications',async()=>{
 const f=fixture();try{
  f.entry('zz');const old=(await f.feed()).entries[0].publication_seq;await f.call('read-cursor',{entry_id:'zz'});f.entry('aa');f.entry('backdated','a','2020-01-01');let data=await f.feed();
  for(const id of ['aa','backdated']){const e=data.entries.find((e:any)=>e.id===id);assert.ok(e.publication_seq>old);assert.equal(e.unread,1);}
  f.sql.prepare('UPDATE public_entries SET date=? WHERE id=?').run('2030-01-01','zz');data=await f.feed();assert.equal(data.entries.find((e:any)=>e.id==='zz').publication_seq,old);assert.equal(data.entries.find((e:any)=>e.id==='zz').unread,0);
 }finally{f.close();}
});
test('scheduled/hidden publications get sequence only after they are eligible',async()=>{
 const f=fixture();try{
  f.entry('first');f.entry('scheduled','a','2020-01-01',{delay:'2999-01-01T00:00:00Z'});f.entry('private-mode','secret');await f.feed();await f.call('read-cursor',{entry_id:'first'});
  for(const id of ['scheduled','private-mode'])assert.equal((await f.call('read-cursor',{entry_id:id}))!.status,404);
  f.sql.prepare("UPDATE public_entries SET publish_at=NULL WHERE id='scheduled'").run();f.sql.prepare("UPDATE user_settings SET value='true' WHERE user_id='secret' AND key='map_visible'").run();
  const data=await f.feed();for(const id of ['scheduled','private-mode'])assert.equal(data.entries.find((e:any)=>e.id===id).unread,1);
 }finally{f.close();}
});
test('late old cursor update cannot undo a newer update; viewers are isolated',async()=>{
 const f=fixture();try{
  f.entry('a1');f.entry('a2');await f.feed();await f.call('read-cursor',{entry_id:'a2'});const before=f.sql.prepare("SELECT last_seen_seq FROM public_read_cursors WHERE viewer_user_id='v'").get()!.last_seen_seq;
  const response=await(await f.call('read-cursor',{entry_id:'a1'}))!.json() as any;assert.equal(response.last_seen_seq,before);assert.equal((await f.feed()).entries.filter((e:any)=>e.unread).length,0);assert.equal((await f.feed('w')).entries.filter((e:any)=>e.unread).length,2);
 }finally{f.close();}
});
test('deletion preserves cursor and AUTOINCREMENT does not reuse the last sequence',async()=>{
 const f=fixture();try{
  f.entry('a1');f.entry('a2');await f.feed();await f.call('read-cursor',{entry_id:'a2'});const cursor=f.sql.prepare('SELECT last_seen_seq FROM public_read_cursors').get()!.last_seen_seq;
  f.sql.prepare("DELETE FROM public_entries WHERE id='a2'").run();assert.equal(f.sql.prepare('SELECT last_seen_seq FROM public_read_cursors').get()!.last_seen_seq,cursor);assert.equal((await f.feed()).entries[0].unread,0);
  f.entry('a3');const e=(await f.feed()).entries.find((e:any)=>e.id==='a3');assert.ok(e.publication_seq>cursor);assert.equal(e.unread,1);
 }finally{f.close();}
});
test('read gate rejects muted/unpublished/self; stable DB IDs survive handle changes',async()=>{
 const f=fixture();try{
  f.entry('a1');f.entry('mine','v');await f.feed();await f.call('mutes',{handle:'person-a',muted:true});assert.equal((await f.call('read-cursor',{entry_id:'a1'}))!.status,404);
  f.sql.prepare("UPDATE users SET handle='renamed-a' WHERE id='a'").run();assert.deepEqual((await f.feed()).muted,['renamed-a']);await f.call('mutes',{handle:'renamed-a',muted:false});
  f.sql.prepare("UPDATE public_entries SET status='draft' WHERE id='a1'").run();for(const id of ['a1','mine'])assert.equal((await f.call('read-cursor',{entry_id:id}))!.status,404);
  const list=await(await f.call('mutes'))!.json() as any;assert.ok(!list.users.some((u:any)=>u.handle==='person-secret'));
 }finally{f.close();}
});
test('mute, cursor and stable-order queries use indexes',async()=>{
 const f=fixture();try{
  f.entry('one');await f.feed();await f.call('read-cursor',{entry_id:'one'});
  for(const q of ["SELECT * FROM user_mutes WHERE viewer_user_id='v' AND muted_user_id='a'","SELECT * FROM public_read_cursors WHERE viewer_user_id='v' AND author_user_id='a'","SELECT * FROM public_entry_sequence WHERE entry_id='one'","SELECT * FROM public_entry_sequence WHERE author_user_id='a' AND seq>0"]){const plans=f.sql.prepare('EXPLAIN QUERY PLAN '+q).all();assert.ok(plans.some((p:any)=>/USING .*INDEX/.test(p.detail)),JSON.stringify(plans));}
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.close();}
});
