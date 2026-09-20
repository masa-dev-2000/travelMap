import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownerPoint,publicPoint,locationPoint,displayWhen,combineOwnerPoints} from '../public/record-display.js';
import {makeTimeline,trackAt,recordsPassed,clampSpeed} from '../public/replay-model.js';
import {scrollDelta} from '../public/input-viewport.js';
import {isConfirm} from '../public/input-flow.js';
import {createLocationCapture,CAPTURE_INTERVAL_MS} from '../public/location-capture.js';
const at='2026-09-20T00:00:00.000Z';
const record=(id:string,time=at)=>ownerPoint({id,occurred_at:time,latitude:35,longitude:134,observed_place_name:'場所',memo:'メモ',rating:4});
test('display contract never leaks private fields or invents a public time',()=>{
  const point=publicPoint({id:'one',author:'other',date:'2026-09-20',latitude:0,longitude:0,observed_place_name:'SECRET',rating:5,memo:'公開メモ',photos:[{url:'/api/private/attachments/one'},{url:'javascript:alert(1)'},{url:'/api/public/photos/abc'}]});
  assert.equal(point.displayAt,null);assert.equal(displayWhen(point),'2026-09-20');assert.equal(point.card.rating,null);assert.ok(!JSON.stringify(point).includes('SECRET'));assert.equal(point.card.photos.length,1);
  assert.equal(publicPoint({id:'one',date:'2026-09-20',latitude:null,longitude:0}),null);
  assert.equal(ownerPoint({id:'one',occurred_at:at,latitude:91,longitude:134}),null);
});
test('samples carry no card, and only in-session records join measured geometry',()=>{
  const samples=[{id:'a',segment_id:'x',captured_at:at,latitude:0,longitude:0,accuracy:10},{id:'b',segment_id:'x',captured_at:'2026-09-20T00:10:00Z',latitude:1,longitude:1,accuracy:10}];
  assert.equal(locationPoint(samples[0]).card,null);
  const points=combineOwnerPoints([{id:'middle',occurred_at:'2026-09-20T00:05:00Z',latitude:0.5,longitude:0.5}],samples);
  assert.equal(points[1].segment,'capture:x');assert.equal(points.filter(p=>p.card).length,1);
});
test('snapshot has reading time proportional to records, stable order and no mutation',()=>{
  const tracks=[{id:'me',color:'#000',points:[record('c','2026-09-20T00:02:00Z'),record('a'),record('b','2026-09-20T00:01:00Z')]}];
  const t=makeTimeline(tracks);assert.equal(t.duration,4000);assert.deepEqual(t.order.map(p=>p.id),['a','b','c']);
  tracks[0].points[0].card.memo='CHANGED';assert.equal(t.order[2].card.memo,'メモ');assert.equal(tracks[0].points[0].ms,undefined);
  assert.equal(recordsPassed(t.order,-1,4000).length,3);
  assert.equal(clampSpeed(0),0.25);assert.equal(clampSpeed(9),4);assert.equal(clampSpeed('bad'),1);
});
test('sample density does not increase card count or timeline reading duration',()=>{
  const start=record('first'),end=record('last','2026-09-20T00:10:00Z');
  const samples=Array.from({length:100},(_,i)=>({key:'s:'+i,id:String(i),kind:'location',card:null,t:Date.parse(at)+(i+1)*5000,lng:134,lat:35,segment:'manual'}));
  const t=makeTimeline([{id:'me',points:[start,...samples,end]}]);assert.equal(t.duration,2000);assert.equal(recordsPassed(t.order,-1,2000).length,2);
});
test('no interpolation across an unmeasured gap',()=>{
  const points=[{lng:0,lat:0,ms:0,segment:'a'},{lng:1,lat:1,ms:100,segment:'a'},{lng:10,lat:10,ms:200,segment:'b'},{lng:11,lat:11,ms:300,segment:'b'}];
  assert.deepEqual(trackAt(points,150).position,[1,1]);assert.equal(trackAt(points,250).chunks.length,2);
});
test('input confirmation ignores IME and recent composition; viewport moves only hidden fields',()=>{
  assert.equal(isConfirm({key:'Enter',isComposing:true}),false);assert.equal(isConfirm({key:'Enter',keyCode:229}),false);
  assert.equal(isConfirm({key:'Enter'},false,100,150),false);assert.equal(isConfirm({key:'Enter'},false,100,300),true);
  assert.equal(scrollDelta({top:20,bottom:60,height:40},0,100),0);assert.equal(scrollDelta({top:80,bottom:120,height:40},0,100),30);
  assert.equal(scrollDelta({top:0,bottom:40,height:40},10,100),-20);
});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function clock(){let now=Date.parse(at),id=0;const jobs=new Map<number,{at:number;fn:()=>any}>();return {now:()=>now,set:(fn:()=>any,ms:number)=>{jobs.set(++id,{at:now+ms,fn});return id;},clear:(i:number)=>jobs.delete(i),async advance(ms:number){const end=now+ms;let count=0;while(true){const pair=[...jobs].filter(([,job])=>job.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!pair)break;if(++count>10000)throw Error('timer loop');now=pair[1].at;jobs.delete(pair[0]);pair[1].fn();await flush();}now=end;await flush();}};}
function captureFixture(overrides:any={}){const time=clock(),saved:any[]=[],states:any[]=[];let id=0;const instance=createLocationCapture({clientId:'client',pageId:'page',makeId:()=>String(++id),now:time.now,setTimer:time.set,clearTimer:time.clear,lease:async()=>({owner:'a'}),getPosition:async()=>({coords:{latitude:35,longitude:134,accuracy:10},timestamp:time.now()}),save:async body=>({id:body.id}),onSaved:body=>saved.push(body),onState:s=>states.push(s),...overrides});return {time,saved,states,instance};}
test('capture saves immediately and every five minutes; hidden time is not backfilled',async()=>{
  const f=captureFixture();await f.instance.start();assert.equal(f.saved.length,1);
  await f.time.advance(CAPTURE_INTERVAL_MS);assert.equal(f.saved.length,2);
  f.instance.setVisible(false);await f.time.advance(3*CAPTURE_INTERVAL_MS);assert.equal(f.saved.length,2);
  f.instance.setVisible(true);await flush();assert.equal(f.saved.length,3);
  f.instance.stop();await f.time.advance(3*CAPTURE_INTERVAL_MS);assert.equal(f.saved.length,3);
});
test('OFF discards a late GPS callback without sending',async()=>{
  let resolve:any;const f=captureFixture({getPosition:()=>new Promise(r=>{resolve=r;})});
  const starting=f.instance.start();await flush();f.instance.stop();resolve({coords:{latitude:35,longitude:134,accuracy:10},timestamp:f.time.now()});await starting;
  assert.equal(f.saved.length,0);assert.equal(f.instance.state().enabled,false);
});
test('an in-flight save may finish after OFF but never starts a new capture',async()=>{
  let resolve:any,calls=0;const f=captureFixture({save:body=>{calls++;return new Promise(r=>{resolve=()=>r({id:body.id});});}});
  const starting=f.instance.start();await flush();f.instance.stop();assert.ok(f.instance.state().message.includes('確認中'));resolve();await starting;
  assert.equal(f.saved.length,1);await f.time.advance(CAPTURE_INTERVAL_MS*2);assert.equal(calls,1);
});
test('retry reuses one immutable sample; permission rejection stops instead of reporting success',async()=>{
  const attempts:any[]=[];const f=captureFixture({save:async body=>{attempts.push(body);if(attempts.length===1)throw Error('offline');return {id:body.id};}});
  const starting=f.instance.start();await flush();await f.time.advance(10000);await starting;assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1]);f.instance.stop();
  const denied=captureFixture({getPosition:async()=>{throw Object.assign(Error('denied'),{code:1});}});await denied.instance.start();assert.equal(denied.saved.length,0);assert.equal(denied.instance.state().enabled,false);
});
test('handoff keeps next deadline; user mismatch cannot resume; samples during replay do not alter snapshot',async()=>{
  const f=captureFixture();await f.instance.start();const handoff=f.instance.handoff();f.instance.setVisible(false);
  const next=captureFixture();await next.instance.start(handoff);assert.equal(next.saved.length,0);
  const different=captureFixture({lease:async()=>({owner:'b'})});await different.instance.start(handoff);assert.equal(different.instance.state().enabled,false);
  f.instance.stop();next.instance.stop();
});
