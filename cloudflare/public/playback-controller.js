import {playbackQueue} from './viewer-state.js';
export function makePlaybackController({state,player,refresh,loadGroup,markRead,notify,choose}) {
  let generation=0,abort=null,queue=[],queueIndex=0,mode='unread',disposed=false,loading=false;
  function stop(){generation++;abort?.abort();abort=null;loading=false;queue=[];queueIndex=0;player.finish(false);}
  // A modal or hidden tab must also cancel a not-yet-started playback.
  function suspend(){if(loading)stop();else player.pause?.();}
  function eligible(snapshot){return !snapshot.selectedUser||snapshot.users.some(u=>u.handle===snapshot.selectedUser);}
  const unsubscribe=state.subscribe((s,reason)=>{
    if(['selection','period','mute','identity','error'].includes(reason)){stop();return;}
    // New entries may arrive, but a removed/revoked entry must not remain playing.
    if(reason==='feed'&&queue.length){const ids=new Set(s.entries.map(e=>e.id));if(queue.some(g=>g.public!==false&&g.rows?.some(e=>!ids.has(e.id))))stop();}
  });
  async function seen(step){
    if(disposed||document.hidden||!step.publicEntryId)return;
    try{await markRead(step);}catch(error){notify(error.message||'既読を保存できませんでした。次回も未読として表示されます');}
  }
  function startItem(run){
    if(disposed||run!==generation||!queue[queueIndex])return;
    const item=queue[queueIndex];
    player.load(item.data,{onSeen:seen,onStop:stop,onComplete:()=>{
      if(run!==generation)return;
      if(++queueIndex<queue.length){startItem(run);}else{player.finish(false);queue=[];notify(mode==='unread'?'新しい記録はありません':'再生が終わりました');}
    }});
  }
  async function play(){
    stop();const run=generation,selected=state.state().selectedUser;mode=selected?'selected':'unread';abort=new AbortController();loading=true;
    try{
      const ok=await refresh({signal:abort.signal});if(ok===false)return;
      if(disposed||run!==generation||state.state().selectedUser!==selected||!eligible(state.state()))return;
      const snapshot=state.state(),groups=playbackQueue(snapshot);
      if(!groups.length){notify(selected?'この期間に再生できる記録はありません':'新しい記録はありません');return;}
      const loaded=await Promise.all(groups.map(async group=>({...group,public:true,data:await loadGroup(group,abort.signal)})));
      if(run!==generation||disposed)return;queue=loaded;queueIndex=0;startItem(run);
    }catch(error){if(run===generation&&error.name!=='AbortError')notify(error.message||'再生できませんでした');}
    finally{if(run===generation){loading=false;abort=null;}}
  }
  // Own trips and shared URLs use the same player, without mixing private steps
  // into the public read queue. An options picker is an entry point, not a player.
  async function openOptions(title,options,{publicEntries=false}={}){
    stop();const run=generation;mode='selected';abort=new AbortController();loading=true;
    try{
      const option=options.length===1?options[0]:await choose(title,options);
      if(!option||run!==generation)return;
      const data=await option.load(abort.signal);if(run!==generation||disposed)return;
      if(!data?.steps?.length){notify('この期間に再生できる記録はありません');return;}
      queue=[{public:publicEntries,rows:data.steps.filter(s=>s.publicEntryId).map(s=>({id:s.publicEntryId})),data:structuredClone(data)}];queueIndex=0;startItem(run);
    }catch(error){if(run===generation&&error.name!=='AbortError')notify(error.message||'再生できませんでした');}
    finally{if(run===generation){loading=false;abort=null;}}
  }
  const authLost=()=>{stop();state.clear();};
  const visibility=()=>{if(document.hidden)suspend();};
  document.addEventListener('visibilitychange',visibility);document.addEventListener('tm:auth-lost',authLost);
  return {play,stop,suspend,openOptions,state:()=>({generation,mode,index:queueIndex,total:queue.length,author:queue[queueIndex]?.user?.handle||null}),destroy(){disposed=true;stop();unsubscribe();document.removeEventListener('tm:auth-lost',authLost);document.removeEventListener('visibilitychange',visibility);}};
}
