import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {locationApi} from '../src/location-api.ts';
const U=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
  const sql=new DatabaseSync(':memory:');sql.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES('a'),('b');");
  for(const name of ['0011-location-samples.sql','0012-location-handoff.sql'])sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const prepare=(query:string)=>{const statement=sql.prepare(query);let values:any[]=[];return {bind(...args:any[]){values=args;return this;},async run(){const r=statement.run(...values);return {meta:{changes:Number(r.changes)}};},async first(){return statement.get(...values)??null;},async all(){return {results:statement.all(...values)};}};};
  const db={prepare} as unknown as D1Database;
  const call=async(path:string,body:any=undefined,user='a',method=body===undefined?'GET':'POST',origin='https://test.example')=>{
    const request=new Request('https://test.example/api/private/'+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return (await locationApi(request,db,user))!;
  };
  const cred={client_id:U(1),capture_id:U(2),page_id:U(3)};
  const sample=(extra:any={})=>({...cred,id:U(10),segment_id:U(4),captured_at:new Date().toISOString(),latitude:0,longitude:0,accuracy:12.5,...extra});
  return {sql,call,cred,sample,close:()=>sql.close()};
}
test('private samples do not become activities; fresh values, zero coordinates, retries and conflicts',async()=>{
  const f=fixture();try{
    assert.equal((await f.call('location-capture',{...f.cred,command:'start'})).status,200);
    const body=f.sample({user_id:'b'});assert.equal((await f.call('location-samples',body)).status,201);
    assert.equal((await f.call('location-samples',body)).status,200);
    assert.equal((await f.call('location-samples',{...body,accuracy:99})).status,409);
    const data=await(await f.call('location-samples')).json();assert.equal(data.samples.length,1);assert.equal(data.samples[0].latitude,0);assert.equal(data.samples[0].accuracy,12.5);assert.ok(!('capture_id'in data.samples[0]));
    assert.equal((await(await f.call('location-samples',undefined,'b')).json()).samples.length,0);
    assert.equal((await f.call('location-samples/'+body.id,undefined,'b','DELETE')).status,404);
    assert.equal((await f.call('location-samples/'+body.id,undefined,'a','DELETE')).status,200);
  }finally{f.close();}
});
test('same-browser lease exclusion, atomic handoff and stale page cannot stop new page',async()=>{
  const f=fixture();try{
    await f.call('location-capture',{...f.cred,command:'start'});
    assert.equal((await f.call('location-capture',{...f.cred,capture_id:U(20),page_id:U(21),command:'start'})).status,409);
    const next={...f.cred,capture_id:U(29),page_id:U(30)};
    assert.equal((await f.call('location-capture',{...next,previous_page_id:f.cred.page_id,command:'start'})).status,409);
    await f.call('location-capture',{...f.cred,command:'prepare',token:'a'.repeat(64),destination:'/admin/record/',next_at:Date.now()+300000});
    assert.equal((await f.call('location-capture',{...next,command:'claim',token:'a'.repeat(64),destination:'/admin/record/'})).status,200);
    assert.equal((await f.call('location-samples',f.sample())).status,409);
    await f.call('location-capture',{...f.cred,command:'stop'});
    assert.equal((await f.call('location-capture',{...next,command:'renew'})).status,200);
    assert.equal((await f.call('location-samples',f.sample({page_id:next.page_id,capture_id:next.capture_id}))).status,201);
    await f.call('location-capture',{...next,command:'stop'});
    assert.equal((await f.call('location-samples',f.sample({page_id:next.page_id,capture_id:next.capture_id,id:U(11)}))).status,409);
  }finally{f.close();}
});
test('expired lease rejects new sample; another user may use same browser without crossing data',async()=>{
  const f=fixture();try{
    await f.call('location-capture',{...f.cred,command:'start'});
    f.sql.prepare('UPDATE location_capture_leases SET expires_at=0').run();
    assert.equal((await f.call('location-samples',f.sample())).status,409);
    const started=await(await f.call('location-capture',{...f.cred,command:'start'},'b')).json();assert.equal(started.owner,'b');
    assert.equal((await f.call('location-samples',f.sample(),'b')).status,201);
    assert.equal((await(await f.call('location-samples')).json()).samples.length,0);
  }finally{f.close();}
});
test('rejects invalid positions, timestamps and cross-origin writes',async()=>{
  const f=fixture();try{
    await f.call('location-capture',{...f.cred,command:'start'});
    for(const invalid of [{latitude:91},{longitude:-181},{accuracy:-1},{latitude:'35'},{accuracy:null},{captured_at:new Date(Date.now()-3600000).toISOString()},{captured_at:new Date(Date.now()+600000).toISOString()},{id:'../../x'}])assert.equal((await f.call('location-samples',f.sample(invalid))).status,400);
    assert.equal((await f.call('location-samples',f.sample(),'a','POST','https://evil.example')).status,403);
    assert.equal((await f.call('location-samples',undefined,'')).status,401);
    assert.equal((await f.call('location-samples',undefined,'a','PUT')).status,405);
  }finally{f.close();}
});
test('stable keyset pagination and bounds return no duplicates',async()=>{
  const f=fixture();try{
    await f.call('location-capture',{...f.cred,command:'start'});const at=new Date().toISOString();
    for(let n=10;n<15;n++)await f.call('location-samples',f.sample({id:U(n),captured_at:at}));
    const ids:string[]=[];let cursor=null;
    do{const data=await(await f.call('location-samples?limit=2'+(cursor?'&cursor='+encodeURIComponent(cursor):''))).json();ids.push(...data.samples.map((s:any)=>s.id));cursor=data.next_cursor;}while(cursor);
    assert.equal(ids.length,5);assert.equal(new Set(ids).size,5);
    assert.equal((await f.call('location-samples?limit=501')).status,400);
    assert.equal((await f.call('location-samples?cursor=bad')).status,400);
  }finally{f.close();}
});
test('new migration is idempotent, restrictive foreign keys and indexes are present',()=>{
  const f=fixture();try{
    f.sql.exec(readFileSync(new URL('../migrations/0011-location-samples.sql',import.meta.url),'utf8'));
    assert.ok(f.sql.prepare("SELECT name FROM sqlite_master WHERE name='location_samples_user_time'").get());
    assert.throws(()=>f.sql.prepare('INSERT INTO location_capture_leases(user_id,client_id,capture_id,page_id,expires_at) VALUES(?,?,?,?,?)').run('missing',U(1),U(2),U(3),0));
  }finally{f.close();}
});
test('late stop from hidden generation cannot revoke a resumed recording',async()=>{
  const f=fixture();try{
    await f.call('location-capture',{...f.cred,command:'start'});
    const resumed={...f.cred,capture_id:U(99)};
    assert.equal((await f.call('location-capture',{...resumed,command:'start',previous_capture_id:f.cred.capture_id,previous_page_id:f.cred.page_id})).status,200);
    await f.call('location-capture',{...f.cred,command:'stop'});
    assert.equal((await f.call('location-samples',f.sample({capture_id:resumed.capture_id}))).status,201);
  }finally{f.close();}
});

const transfer=async(f:any)=>{
  await f.call('location-capture',{...f.cred,command:'start'});
  const token='b'.repeat(64),next_at=Date.now()+300000,destination='/admin/record/';
  const prepared=await f.call('location-capture',{...f.cred,command:'prepare',token,next_at,destination});assert.equal(prepared.status,200);
  return {...f.cred,capture_id:U(40),page_id:U(41),command:'claim',token,destination};
};
test('one-time handoff: exact retry succeeds, another page, owner, client and destination fail',async()=>{
  const f=fixture();try{
    const claim=await transfer(f);
    assert.equal((await f.call('location-capture',{...claim,destination:'/'})).status,409);
    assert.equal((await f.call('location-capture',claim,'b')).status,409);
    assert.equal((await f.call('location-capture',{...claim,client_id:U(77)})).status,409);
    assert.equal((await f.call('location-samples',f.sample())).status,409); // source may no longer start a new write
    const one=await(await f.call('location-capture',claim)).json();
    f.sql.prepare('UPDATE location_capture_leases SET handoff_expires_at=0').run();
    const twice=await(await f.call('location-capture',claim)).json();assert.deepEqual(twice,one); // lost response after expiry
    assert.equal((await f.call('location-capture',{...claim,page_id:U(42)})).status,409);
    await f.call('location-capture',{...f.cred,command:'stop'});
    assert.equal((await f.call('location-samples',f.sample({capture_id:claim.capture_id,page_id:claim.page_id}))).status,201);
    assert.ok(!JSON.stringify(f.sql.prepare('SELECT * FROM location_capture_leases').get()).includes(claim.token));
  }finally{f.close();}
});
test('handoff expiry, stop-before-claim, and prepare-after-stop never reenable capture',async()=>{
  for(const variant of ['expire','stop','late-prepare']){
    const f=fixture();try{
      const claim=await transfer(f);
      if(variant==='expire')f.sql.prepare('UPDATE location_capture_leases SET handoff_expires_at=0').run();
      else await f.call('location-capture',{...f.cred,command:'stop'});
      if(variant==='late-prepare')assert.equal((await f.call('location-capture',{...f.cred,command:'prepare',token:claim.token,destination:claim.destination,next_at:Date.now()})).status,409);
      assert.equal((await f.call('location-capture',claim)).status,409);
    }finally{f.close();}
  }
});
test('location cursor uses narrower range without losing same-time IDs or crossing users',async()=>{
  const f=fixture();try{
    const from='2026-01-01T00:00:00.000Z',to='2026-01-02T00:00:00.000Z';
    const insert=f.sql.prepare('INSERT INTO location_samples VALUES(?,?,?,?,?,?,?,?,?,?)');
    for(let n=0;n<120;n++)for(const user of ['a','b'])insert.run(user,U(100+n),U(1),U(2),U(4),new Date(Date.parse(from)+Math.floor(n/3)*1000).toISOString(),from,0,0,1);
    for(const limit of [1,7,50]){
      let cursor=null,ids:string[]=[];
      do{const q=new URLSearchParams({from,to,limit:String(limit)});if(cursor)q.set('cursor',cursor);
        const data=await(await f.call('location-samples?'+q)).json();ids.push(...data.samples.map((p:any)=>p.id));cursor=data.next_cursor;
      }while(cursor);
      assert.equal(ids.length,120);assert.equal(new Set(ids).size,120);
      const expected=f.sql.prepare('SELECT id FROM location_samples WHERE user_id=? ORDER BY captured_at DESC,id DESC').all('a').map(p=>p.id);assert.deepEqual(ids,expected);
    }
    const cursor=btoa(JSON.stringify(['2025-01-01T00:00:00.000Z',U(10)]));
    assert.deepEqual(await(await f.call('location-samples?'+new URLSearchParams({from,to,cursor}))).json(),{samples:[],next_cursor:null});
    const plan=f.sql.prepare('EXPLAIN QUERY PLAN SELECT * FROM location_samples WHERE user_id=? AND captured_at>=? AND captured_at<=? ORDER BY captured_at DESC,id DESC LIMIT ?').all('a',from,to,50);
    assert.ok(JSON.stringify(plan).includes('location_samples_user_time'));
  }finally{f.close();}
});
test('missing handoff migration fails this feature closed, existing rows unchanged',async()=>{
  const f=fixture();try{
    f.sql.exec('ALTER TABLE location_capture_leases DROP COLUMN handoff_hash');
    const response=await f.call('location-capture',{...f.cred,command:'start'});
    assert.equal(response.status,503);assert.equal((await response.json()).code,'location_not_ready');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM users').get()?.n,2);
  }finally{f.close();}
});
