import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeViewerState,periodRange,playbackQueue} from '../public/viewer-state.js';
import {makePlaybackController} from '../public/playback-controller.js';
const row=(id:string,author:string,seq:number,date='2026-09-20',unread=true)=>({id,author,author_name:author,date,publication_seq:seq,unread,photos:[]});
function state(){const s=makeViewerState({self:'me',period:'all'});s.replaceFeed({self:'me',muted:['d'],entries:[row('a1','a',1,'2020-01-01',false),row('a2','a',4),row('b1','b',3),row('c1','c',2,'2026-09-20',false),row('d1','d',5),row('mine','me',6)]});return s;}
test('default queue includes only unread other people, oldest unread author first',()=>{
 const s=state(),q=playbackQueue(s.state());assert.deepEqual(q.map(g=>[g.user.handle,g.rows.map(e=>e.id)]),[['b',['b1']],['a',['a2']]]);
 s.setPeriod('custom','2026-09-21','2026-09-22');assert.equal(playbackQueue(s.state()).length,2,'default unread ignores map period');
});
test('selected person respects period, includes read entries, never falls back to all',()=>{
 const s=state();s.select('a');s.setPeriod('custom','2026-09-01','2026-09-30');assert.deepEqual(playbackQueue(s.state())[0].rows.map(e=>e.id),['a2']);
 s.setPeriod('all');assert.deepEqual(playbackQueue(s.state())[0].rows.map(e=>e.id),['a1','a2']);s.setPeriod('custom','2030-01-01','2030-02-01');assert.deepEqual(playbackQueue(s.state()),[]);
});
test('selection/read redraw preserves mute/self exclusion and read rings',()=>{
 const s=state();s.select('a');assert.deepEqual(s.state().users.map(u=>u.handle).sort(),['a','b','c']);assert.ok(s.state().users.find(u=>u.handle==='b').has_unread);
 s.markSeen('a',4);assert.ok(!s.state().users.find(u=>u.handle==='a').has_unread);assert.ok(s.state().users.find(u=>u.handle==='b').has_unread);
 s.setMuted('a',true);assert.equal(s.state().selectedUser,null);assert.ok(!s.state().users.some(u=>u.handle==='a'));s.setMuted('a',false);assert.ok(s.state().users.some(u=>u.handle==='a'));
});
test('snapshots do not grow on new records and a stale feed cannot roll back acknowledged reads',()=>{
 const s=state(),snapshot=playbackQueue(s.state());s.markSeen('a',4);s.replaceFeed({self:'me',muted:['d'],entries:[row('a2','a',4),row('new','a',7)]});
 assert.equal(s.state().entries.find(e=>e.id==='a2').unread,false);assert.equal(s.state().entries.find(e=>e.id==='new').unread,true);assert.ok(!JSON.stringify(snapshot).includes('new'));
 s.clear();assert.deepEqual(s.state().entries,[]);assert.equal(s.state().ready,false);
});
test('period boundaries are JST calendar dates',()=>{
 assert.deepEqual(periodRange('7','','','2026-09-20'),{preset:'7',from:'2026-09-14',to:'2026-09-20'});
 assert.throws(()=>periodRange('custom','2026-10-01','2026-09-01'));
});
function harness(s:any,refresh=async()=>true){
 const doc=new EventTarget();Object.assign(doc,{hidden:false});Object.defineProperty(globalThis,'document',{value:doc,configurable:true});const loads:any[]=[],reads:any[]=[],notices:any[]=[];
 const player={finish(){},load(data:any,options:any){loads.push({data,options});}};
 const c=makePlaybackController({state:s,player,refresh,loadGroup:async(g:any)=>({title:g.user.handle,steps:g.rows}),markRead:async(step:any)=>reads.push(step),notify:(n:any)=>notices.push(n),choose:async()=>null});return {c,loads,reads,notices,doc};
}
test('slow loading cannot start after selection/mute/period/auth invalidates it',async()=>{
 for(const change of [(s:any)=>s.select('a'),(s:any)=>s.setMuted('a',true),(s:any)=>s.setPeriod('30'),(s:any)=>s.clear()]){
  const s=state();let release:any;const h=harness(s,()=>new Promise<boolean>(r=>release=r));const pending=h.c.play();change(s);release(true);await pending;assert.equal(h.loads.length,0);h.c.destroy();
 }
});
test('both selected and unread players receive read callback; hidden document never reads',async()=>{
 const s=state();s.select('a');const h=harness(s);await h.c.play();assert.equal(h.loads.length,1);await h.loads[0].options.onSeen({publicEntryId:'a2'});assert.equal(h.reads.length,1);
 (h.doc as any).hidden=true;await h.loads[0].options.onSeen({publicEntryId:'a2'});assert.equal(h.reads.length,1);h.c.destroy();
});
test('queue advances one person at a time, then ends instead of replaying read history',async()=>{
 const h=harness(state());await h.c.play();assert.equal(h.loads[0].data.title,'b');h.loads[0].options.onComplete();assert.equal(h.loads[1].data.title,'a');h.loads[1].options.onComplete();assert.equal(h.c.state().total,0);assert.equal(h.notices.at(-1),'新しい記録はありません');h.c.destroy();
});
