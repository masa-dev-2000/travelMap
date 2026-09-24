import {el,api} from '/shared.js';
import {mapShell} from '/map-shell.js';
import {makeOwnerMap} from '/owner-map.js';
import {makeOwnerRoute} from '/owner-route.js';
import {makeEveryone} from '/panel-everyone.js';
import {makeStory} from '/story.js';
import {mountAutoLocation,navigateWithCapture} from '/auto-location.js';
import {makeLocationMap} from '/location-map.js';
import {makeViewerState} from '/viewer-state.js';
import {makeStoriesStrip} from '/stories-strip.js';
import {makePlaybackController} from '/playback-controller.js';
import {makeViewerSettings} from '/viewer-settings.js';
const $=selector=>document.querySelector(selector),message=$('#message');
let session={user:null};
try{const response=await fetch('/api/public/session',{cache:'no-store'});if(response.ok)session=await response.json();}catch{}
if(session.needs_signup)location.replace('/signup/');
const me=session.user,settings=$('#settings-dialog');
for(const dialog of document.querySelectorAll('dialog'))document.body.append(dialog);
// Move actual profile DOM, not just its navigation label. Preserve all owned-data
// forms under Profile; settings actions never leave them in an unreachable drawer.
const profile=$('#settings-panel'),form=$('#profile-form');
const account=el('section',{className:'sheet-section'});account.append($('#logout'),profile.querySelector('a[href="/terms"]').closest('p'));settings.append(account);
const edit=el('details',{className:'profile-edit'});edit.append(el('summary',{textContent:'プロフィールを編集'}),form);profile.append(edit);
const profileBio=el('p',{id:'profile-bio'});edit.before(profileBio);
const login=()=>el('a',{className:'quick-record',href:'/auth/google?next=%2F',textContent:'ログインして利用する'});
// 画面ごとに行き先を分ける。プロフィールは人物情報だけを持ち、台帳は別の行き先にする。
// ここで参照を取っておく: mapShell は body の残りを捨てるので、掴んでいない節点は消える。
const timelineNodes=me?[$('#me-filters'),$('#activities').closest('section')]:[];
const moneyNodes=me?[$('#money-panel')]:[];
const tripNodes=me?[$('#trip-panel')]:[];
if(me)settings.append($('#category-form').closest('details'));
const destinations=el('nav',{className:'sheet-links'});
const groups=[
  {id:'profile',label:'プロフィール',title:'プロフィール',icon:'◉',nodes:me?[profile,el('div',{id:'footprints'}),destinations]:[login()]},
  {id:'add',label:'記録',title:'記録する',icon:'＋',nodes:me?[el('a',{className:'quick-record',href:'/admin/start/',textContent:'記録をはじめる'}),$('#add-forms')]:[login()],action:()=>{if(me&&innerWidth<=700){void navigateWithCapture('/admin/start/');return true;}return false;}},
  {id:'settings',label:'設定',title:'設定',icon:'⚙',nodes:[],action:()=>{playback.suspend();settings.showModal();void viewerSettings.render();return true;}}
];
if(!me){
  profile.remove();
  for(const section of settings.querySelectorAll('section'))if(!section.querySelector('#map-style-settings,#mute-settings'))section.hidden=true;
  account.hidden=false;account.replaceChildren(login());
}
const shell=mapShell(groups),map=makeOwnerMap({settingsSlot:$('#map-style-settings')}),route=makeOwnerRoute(map,shell);
shell.drawer.addEventListener('viewchange',()=>map.resize());
if(me){
  // 記録一覧の入口は地図の件数表示だけにする。プロフィールからは入れない。
  shell.place('timeline',timelineNodes,'記録の一覧');
  shell.count.disabled=false;
  shell.count.onclick=()=>{shell.active()==='timeline'?shell.hide():shell.open('timeline');};
  // おかねと旅はプロフィールから入る。戻り先は閉じても残る。
  for(const [id,nodes,heading] of [['money',moneyNodes,'おかね'],['trips',tripNodes,'旅']]){
    // 独立した画面になったので、折りたたみのまま置かない。開いて渡す。
    for(const node of nodes)if(node.tagName==='DETAILS'){node.open=true;const s=node.querySelector(':scope>summary');if(s)s.hidden=true;}
    shell.place(id,nodes,heading,{back:()=>shell.open('profile'),sticky:true});
    const link=el('button',{type:'button',className:'sheet-link',textContent:heading+' ›'});
    link.onclick=()=>shell.open(id);destinations.append(link);
  }
}
let preset='7';try{const saved=localStorage.getItem('travelmap.period');if(['7','30','90','all'].includes(saved))preset=saved;}catch{}
const viewerState=makeViewerState({self:me?.handle,period:preset});
let mine=null,locations=null,noticeTimer,authEpoch=0;
function notify(value){clearTimeout(noticeTimer);message.textContent=value;noticeTimer=setTimeout(()=>{message.textContent='';},10000);}
// 再生を続ける画面は許可制。地図を見ながら読む画面だけが続き、台帳や設定では止まる。
const KEEPS_PLAYING=new Set(['playback-options','record','route','story','timeline']);
// 次の人物へ移る時も load() から begin() を通る。読んでいる画面まで閉じない。
const READING=new Set(['timeline','record','route']);
const player=makeStory(map,shell,{keeps:KEEPS_PLAYING,begin:()=>{if(!READING.has(shell.active()))shell.hide();route.setReplay(true);everyone.setReplay(true);},end:()=>{route.setReplay(false);everyone.setReplay(false);}});
async function markRead(step){
  if(document.hidden||step.author===me?.handle||!step.publicEntryId||viewerState.state().muted.has(step.author))return;
  const epoch=authEpoch;
  if(!me){viewerState.markSeen(step.author,step.publication_seq);return;}
  const result=await api('read-cursor',{entry_id:step.publicEntryId});
  if(epoch===authEpoch)viewerState.markSeen(result.author,Number(result.last_seen_seq));
}
const everyone=makeEveryone(map,shell,{state:viewerState,authenticated:!!me,notify,
  onFilter:filter=>{mine?.setFilter(filter);locations?.setFilter(filter);queueMicrotask(()=>{if(!player.active())fitRecords();});},
  onOpenPerson:handle=>{if(handle!==me?.handle)mine?.visited?.(handle);},
  onPlay:()=>void playback.play(),onRead:markRead});
const dataWarning=el('aside',{className:'data-warning',hidden:true});dataWarning.setAttribute('role','status');dataWarning.textContent='人物情報を取得できません。地図は利用できます。';shell.stage.append(dataWarning);
viewerState.subscribe(s=>{dataWarning.hidden=!s.error;player.setAvailable(s.ready&&!s.error);});
const stories=makeStoriesStrip(shell.stage,{state:viewerState});
function fitRecords(){const points=[...route.points(),...everyone.points()];if(points.length)route.fitPoints(points);else map.jumpTo({center:[137.5,37.5],zoom:4.3});}
shell.fit.onclick=()=>{shell.hide();fitRecords();};
function choose(title,options){return new Promise(resolve=>{
  if(!options.length){resolve(null);return;}
  const list=el('div',{className:'playback-choices'});let done=false;
  const finish=value=>{if(done)return;done=true;shell.drawer.removeEventListener('viewchange',closed);resolve(value);};
  const closed=event=>{if(event.detail!=='playback-options')finish(null);};
  for(const option of options){const button=el('button',{type:'button',textContent:option.label});button.onclick=()=>{finish(option);shell.hide();};list.append(button);}
  shell.view('playback-options',list,title);shell.drawer.addEventListener('viewchange',closed);
});}
const playback=makePlaybackController({state:viewerState,player,refresh:options=>everyone.reload(options),loadGroup:group=>everyone.groupData(group),markRead,notify,choose});
player.onPlay(()=>void playback.play());
shell.drawer.addEventListener('viewchange',event=>{if(event.detail&&!KEEPS_PLAYING.has(event.detail))playback.suspend();});
const viewerSettings=makeViewerSettings({state:viewerState,reload:()=>everyone.reload(),cancelReload:everyone.cancelReload,notify,authenticated:!!me,slot:$('#mute-settings')});
$('#close-settings').onclick=()=>settings.close();settings.addEventListener('click',event=>{if(event.target===settings)settings.close();});
window.__tm={viewerState,everyone,route,shell,player,playback,stories};
await everyone.ready;player.setAvailable(everyone.available());
if(me){
  const {startMe}=await import('/panel-me.js');
  mine=await startMe({shell,map,route,everyone,fitRecords,notify,me,playTrip:(title,options)=>void playback.openOptions(title,options)});
  void mountAutoLocation(shell.stage,{compact:true,onError:notify});
  locations=makeLocationMap(route,{handle:me.handle,filter:()=>everyone.filter(),notify});void locations.refresh();
  mine.setFilter(everyone.filter());
}else fitRecords();
const shared=new URLSearchParams(location.search);
if(shared.get('play')){
  const handle=shared.get('play'),trip=shared.get('trip')??'',options=everyone.storyOptions(handle).filter(o=>o.trip===trip);
  if(handle===me?.handle){
    const option={label:'自分の公開記録',load:async signal=>{
      const response=await fetch('/api/public/entries?'+new URLSearchParams({u:handle}),{signal,cache:'no-store'});
      if(!response.ok)throw new Error('公開記録を取得できません');
      const data=await response.json();if(!Array.isArray(data.entries))throw new Error('公開記録の応答を確認できません');
      const rows=data.entries.filter(e=>e.author===handle&&(!trip||e.trip_name===trip));
      rows.sort((a,b)=>a.date.localeCompare(b.date)||(a.at||'').localeCompare(b.at||'')||a.id.localeCompare(b.id));
      const result=everyone.groupData({user:{handle,display_name:me.display_name,icon:me.icon,icon_url:me.icon_url,avatar_url:me.avatar_url},rows});
      // This is public self playback, never the viewer's private activities.
      result.steps=result.steps.map(step=>({...step,publicEntryId:null}));return result;
    }};
    void playback.openOptions('自分の公開記録',[option]);
  }else if(options.length)void playback.openOptions('旅を再生',options,{publicEntries:true});else notify('この人の公開記録はないか、ミュート中です');
}
// A return to the visible tab refreshes metadata, but never auto-resumes playback.
// Re-reading the whole feed on every return is the largest share of D1 reads in normal
// use, so a feed this recent is accepted as-is. Saves, mute and play still re-read.
const TAB_RETURN_MAX_AGE_MS=60000;
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void everyone.reload({maxAge:TAB_RETURN_MAX_AGE_MS});});
document.addEventListener('tm:auth-lost',()=>{authEpoch++;playback.stop();viewerState.clear();route.clear();route.setSamples([]);$('#activities')?.replaceChildren();});
