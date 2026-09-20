import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRecordSave} from '../public/record-save.js';
const draft=()=>({body:{memo:'unchanged',publish:false,transaction:{amount_minor:0}},photos:[],date:'2026-09-20'});
const deferred=()=>{let resolve:any;return {promise:new Promise(r=>{resolve=r;}),resolve:(x:any)=>resolve(x)};};
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
test('save lock rejects photo conversion and double submit throughout delayed attachment upload',async()=>{
  const wait=deferred();let created=0;
  const saver=createRecordSave({create:async()=>({id:'activity-'+(++created)}),upload:async()=>wait.promise,publish:async()=>{}});
  const input=draft();input.photos.push({blob:'photo'} as never);const saving=saver.run(input);await flush();
  assert.equal(saver.beginPhotos(),null);assert.equal(await saver.run(input),null);assert.equal(saver.state().saving,true);
  wait.resolve({id:'attachment'});await saving;assert.equal(created,1);assert.equal(saver.state().canSave,true);
});
test('photo finally releases only its own counter; submit cannot run during conversion',async()=>{
  let created=0;const saver=createRecordSave({create:async()=>({id:String(++created)}),upload:async()=>{},publish:async()=>{}});
  const done=saver.beginPhotos();assert.ok(done);assert.equal(await saver.run(draft()),null);done();done();
  assert.equal(saver.state().processing,0);await saver.run(draft());assert.equal(created,1);
});
test('unknown create result retries the exact body and idempotency key despite live input edits',async()=>{
  const posts:any[]=[];const saver=createRecordSave({create:async(body,key)=>{posts.push({body:JSON.stringify(body),key});if(posts.length===1)throw Error('response lost');return {id:'same'};},upload:async()=>{},publish:async()=>{}});
  const input=draft();await assert.rejects(saver.run(input));input.body.memo='edited';
  assert.equal(saver.state().pending,true);assert.equal(saver.beginPhotos(),null);await saver.run(input);
  assert.deepEqual(posts[0],posts[1]);assert.equal(JSON.parse(posts[1].body).transaction.amount_minor,0);
});
test('partial photo failure retries only failed attachments, never creates another activity',async()=>{
  let created=0,failed=true;const uploads:number[]=[],published:any[]=[];
  const saver=createRecordSave({create:async()=>({id:String(++created)}),upload:async(id,photo,index)=>{uploads.push(index);if(index===0&&failed){failed=false;throw Error('offline');}return {id:'photo-'+index};},publish:async(op,key)=>{published.push(key);}});
  const input=draft();input.photos=[{blob:'a'},{blob:'b'}] as never;input.body.publish=true;
  await assert.rejects(saver.run(input),/記録本体は保存済み/);assert.equal(saver.state().activityId,'1');
  await saver.run(draft());assert.equal(created,1);assert.deepEqual(uploads,[0,1,0]);assert.equal(published.length,1);
});
test('definitive input rejection unlocks editable draft instead of forcing invalid replay',async()=>{
  const saver=createRecordSave({create:async()=>{throw Object.assign(Error('invalid'),{status:400});},upload:async()=>{},publish:async()=>{}});
  await assert.rejects(saver.run(draft()));assert.equal(saver.state().pending,false);assert.ok(saver.beginPhotos());
});
