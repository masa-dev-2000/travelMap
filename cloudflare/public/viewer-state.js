// One identity (public handle) and one state for map, Stories, mute and playback.
export const todayJst=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
export function periodRange(preset='7',from='',to='',today=todayJst()) {
  if(preset==='all')return {preset,from:'',to:''};
  if(preset==='custom'){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw new Error('開始日と終了日を確認してください');
    return {preset,from,to};
  }
  if(!['7','30','90'].includes(preset))preset='7';
  return {preset,from:new Date(Date.parse(today+'T00:00:00Z')-(Number(preset)-1)*86400000).toISOString().slice(0,10),to:today};
}
export const withinPeriod=(entry,period)=>(!period.from||entry.date>=period.from)&&(!period.to||entry.date<=period.to);
export function makeViewerState(initial={}) {
  let self=initial.self||null,selectedUser=null,period=periodRange(initial.period||'7'),muted=new Set(),entries=[],users=[],ready=false,error='';
  const listeners=new Set(),highWater=new Map();
  const visible=handle=>handle!==self&&!muted.has(handle);
  function rebuild(){
    const groups=new Map();
    for(const e of entries){if(!visible(e.author))continue;const seq=Number(e.publication_seq)||0;
      const u=groups.get(e.author)||{handle:e.author,display_name:e.author_name||e.author,icon:e.author_icon,avatar_url:e.author_avatar,icon_url:e.author_icon_url,has_unread:false,first_unread:null,latest_seq:0};
      u.latest_seq=Math.max(u.latest_seq,seq);if(e.unread){u.has_unread=true;u.first_unread=u.first_unread===null?seq:Math.min(u.first_unread,seq);}groups.set(e.author,u);
    }
    users=[...groups.values()].sort((a,b)=>b.latest_seq-a.latest_seq||a.handle.localeCompare(b.handle));
    if(selectedUser&&!users.some(u=>u.handle===selectedUser))selectedUser=null;
  }
  const state=()=>({self,selectedUser,period:{...period},muted:new Set(muted),users:users.map(u=>({...u})),entries:entries.filter(e=>visible(e.author)).map(e=>({...e})),ready,error});
  const emit=reason=>{const s=state();for(const fn of listeners)fn(s,reason);};
  return {state,visible,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    replaceFeed(data){
      if(!data||!Array.isArray(data.entries)||!Array.isArray(data.muted))throw new Error('人物情報の応答を確認できません');
      const previous=[...muted].sort().join('\0');self=data.self??self;muted=new Set(data.muted);
      entries=data.entries.filter(e=>typeof e.id==='string'&&typeof e.author==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(e.date)).map(e=>({...e,unread:!!e.unread&&Number(e.publication_seq)>(highWater.get(e.author)||0)}));
      ready=true;error='';rebuild();emit(previous===[...muted].sort().join('\0')?'feed':'mute');
    },
    setSelf(handle){if(self===handle)return;self=handle;rebuild();emit('identity');},
    select(handle){const next=handle&&users.some(u=>u.handle===handle)&&visible(handle)?handle:null;if(next===selectedUser)return;selectedUser=next;emit('selection');},
    setPeriod(preset,from='',to=''){period=periodRange(preset,from,to);emit('period');},
    setMuted(handle,value){if(handle===self)return;if(value)muted.add(handle);else muted.delete(handle);rebuild();emit('mute');},
    markSeen(handle,seq){if(!Number.isSafeInteger(seq)||seq<=0||seq<=(highWater.get(handle)||0))return;highWater.set(handle,seq);entries=entries.map(e=>e.author===handle&&Number(e.publication_seq)<=seq?{...e,unread:false}:e);rebuild();emit('read');},
    fail(message){error=message;emit('error');},
    clear(){entries=[];users=[];highWater.clear();muted.clear();selectedUser=null;ready=false;error='';emit('identity');}
  };
}
// Default playback is all unread, NOT the map's date filter. A selected person uses
// the chosen period, including already-read entries. Snapshots never grow mid-play.
export function playbackQueue(snapshot) {
  const allowed=e=>e.author!==snapshot.self&&!snapshot.muted.has(e.author);
  const source=snapshot.entries.filter(allowed),selected=snapshot.selectedUser;
  const users=selected?snapshot.users.filter(u=>u.handle===selected):snapshot.users.filter(u=>u.has_unread).sort((a,b)=>a.first_unread-b.first_unread||a.handle.localeCompare(b.handle));
  return structuredClone(users.map(user=>{
    const rows=source.filter(e=>e.author===user.handle&&(selected?withinPeriod(e,snapshot.period):!!e.unread));
    rows.sort(selected?((a,b)=>a.date.localeCompare(b.date)||(a.at||'').localeCompare(b.at||'')||a.publication_seq-b.publication_seq):((a,b)=>a.publication_seq-b.publication_seq));
    return {user,rows};
  }).filter(group=>group.rows.length));
}
