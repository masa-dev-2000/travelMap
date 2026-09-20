import {el,api as apiPrivate} from '/shared.js';
import {mapShell} from '/map-shell.js';
import {makeOwnerMap} from '/owner-map.js';
import {makeOwnerRoute} from '/owner-route.js';
import {makeEveryone} from '/panel-everyone.js';
import {makeReplay} from '/replay.js';
import {makeStory} from '/story.js';
import {mountAutoLocation,navigateWithCapture} from '/auto-location.js';
import {makeLocationMap} from '/location-map.js';
import {makeViewerState} from '/viewer-state.js';
import {makeStoriesStrip} from '/stories-strip.js';
import {makePlaybackController} from '/playback-controller.js';
// 1つの地図ページ。未ログインは公開データだけ、ログインすると自分の操作(じぶん・＋・設定)が増える
const $=selector=>document.querySelector(selector),message=$('#message');
let session={user:null};
try{const response=await fetch('/api/public/session',{cache:'no-store'});if(response.ok)session=await response.json();}catch{}
if(session.needs_signup)location.replace('/signup/');// 同意前のアカウント(通常はサーバが先に転送する)
const me=session.user;
for(const dialog of document.querySelectorAll('dialog'))document.body.append(dialog);
const peopleNode=el('div',{className:'people'}),timelineNode=el('div');
const groups=[];
if(me)groups.push(
  {id:'profile',label:'プロフィール',title:'プロフィール',icon:'◉',nodes:[el('div',{id:'footprints'}),$('#me-filters'),$('#activities').closest('section')]},
  {id:'add',label:'記録',title:'記録する',icon:'＋',nodes:[el('a',{className:'quick-record',href:'/admin/start/',textContent:'スマホ用の記録をはじめる →'}),$('#add-forms')],action:()=>{if(innerWidth<=700){void navigateWithCapture('/admin/start/');return true;}return false;}},
  {id:'settings',label:'設定',title:'設定',icon:'⚙',nodes:[$('#money-panel'),$('#trip-form').closest('details')],action:()=>{$('#settings-dialog').showModal();return true;}}
);
const shell=mapShell(groups);
if(!me&&!session.authenticated){const login=el('a',{className:'rail-login',href:'/auth/google?next=%2F'});login.title='Googleアカウントで登録できます';login.append(el('span',{className:'rail-icon',textContent:'→'}),el('span',{textContent:'はじめる'}),el('span',{textContent:'/ ログイン'}),el('span',{className:'rail-note',textContent:'Googleアカウントで登録できます'}));shell.fit.after(login);}
else if(!me&&session.authenticated){const status=el('div',{className:'rail-login'});status.setAttribute('aria-label','Googleログイン済み');status.append(el('span',{className:'rail-icon',textContent:'✓'}),el('span',{textContent:'ログイン済み'}));shell.fit.after(status);}
const dataWarning=el('aside',{className:'data-warning',hidden:true});dataWarning.setAttribute('role','status');dataWarning.setAttribute('aria-live','polite');
dataWarning.append(el('strong',{textContent:'記録データを取得できません'}),el('span',{textContent:session.authenticated?'ログイン済みです。地図は利用できます。':'地図は利用できます。記録は復旧後に表示されます。'}),el('a',{href:'/',textContent:'再読み込み'}));shell.stage.append(dataWarning);
const map=makeOwnerMap();
shell.drawer.addEventListener('viewchange',()=>map.resize());// 右ペインの開閉で地図の幅が変わる。続く fit が新しい幅で計算されるよう、その場で合わせる
const route=makeOwnerRoute(map,shell);
let noticeTimer,mine=null,locations=null,story=null;
function notify(value){clearTimeout(noticeTimer);message.textContent=value;noticeTimer=setTimeout(()=>{message.textContent='';},10000);}
const viewerState=makeViewerState();
const everyone=makeEveryone(map,shell,{peopleNode,timelineNode,showToggle:false,onFilter:filter=>{replay.finish();story?.finish();mine?.setFilter(filter);locations?.setFilter(filter);fitRecords();},onOpenPerson:handle=>mine?.visited?.(handle),onPlay:handle=>playPerson(handle)});
const JAPAN={center:[137.5,37.5],zoom:4.3};
function fitRecords(){const points=[...route.points(),...everyone.points()];if(points.length)route.fitPoints(points);else map.jumpTo(JAPAN);if(everyone.count()&&!route.count()&&!everyone.shownCount())notify('この期間の記録はありません。期間を広げると表示されます');}
shell.fit.onclick=()=>{shell.hide();fitRecords();};
const replay=makeReplay(map,shell,{tracks:()=>[route.track(),...everyone.tracks()],begin:()=>{story?.finish();shell.hide();route.setReplay(true);everyone.setReplay(true);fitRecords();},end:()=>{route.setReplay(false);everyone.setReplay(false);}});
let playback=null;
// 旅の再生(ログ付き)。再生中は、ほかの線とマーカーを隠す
story=makeStory(map,shell,{begin:()=>{replay.finish();route.setReplay(true);everyone.setReplay(true);},end:()=>{route.setReplay(false);everyone.setReplay(false);}});
// trip: undefined=選択肢を出す、''=すべての公開記録、名前=その旅(共有URL用)
function playPerson(handle,trip){
  const options=everyone.storyOptions(handle);if(!options.length){notify('この人はいま旅モード中ではないか、公開している記録がありません');return;}
  if(handle!==me?.handle)mine?.visited?.(handle);
  const chosen=trip===undefined?options:options.filter(option=>option.trip===trip);story.open('旅を再生',chosen.length?chosen:options.slice(-1));
}
window.__tm={everyone,route,shell,replay,story,viewerState};// 画面確認用(コンソールから状態を読む)
const mapStyleSettings=$('#map-style-settings');if(mapStyleSettings){const move=document.querySelector('.basemap-control');if(move){move.open=true;mapStyleSettings.append(move);}}
const stories=me?makeStoriesStrip(shell.stage,{state:viewerState,onSelect:handle=>{viewerState.select(handle);everyone.selectPerson?.(handle);stories.render(everyone.viewerUsers?.()||[]);}}):null;
async function refreshViewer(){if(!me)return;try{const data=await apiPrivate('viewer-feed');viewerState.setMuted(data.muted||[]);viewerState.setUnread(data.users||[]);stories.render((data.users||[]).map(u=>({...u,self:me.handle})));}catch{}}
await everyone.ready;
const dataAvailable=session.data_available!==false&&everyone.available();dataWarning.hidden=dataAvailable;replay.setAvailable(dataAvailable);
if(dataAvailable&&!everyone.count())notify('いま旅に出ている人はいません');void refreshViewer();
const shared=new URLSearchParams(location.search);
if(me){const {startMe}=await import('/panel-me.js');mine=await startMe({shell,map,route,everyone,fitRecords,notify,me,playTrip:(title,options)=>story.open(title,options)});void mountAutoLocation(shell.stage);locations=makeLocationMap(route,{handle:me.handle,filter:()=>everyone.filter(),notify});void locations.refresh();}
else if(!shared.get('play'))fitRecords();
if(me){playback=makePlaybackController({state:viewerState,story,notify,
  loadUser:async(handle)=>{const options=everyone.storyOptions(handle);if(!options.length)throw new Error('この期間に再生できる記録がありません');return options.at(-1);},
  loadUnread:async()=>{const data=await apiPrivate('viewer-feed'),users=data.users.filter(u=>u.has_unread);return users.flatMap(u=>everyone.storyOptions(u.handle).slice(-1));},
  markRead:step=>step?.id?apiPrivate('read-cursor',{entry_id:step.id}).then(refreshViewer):Promise.resolve()
});const playButton=document.querySelector('.replay-play');if(playButton)playButton.onclick=()=>playback.play();}
// 共有URL /?play=<handle>&trip=<旅名>: 公開データだけで、その再生を始める
if(shared.get('play'))playPerson(shared.get('play'),shared.get('trip')??'');

document.addEventListener('tm:auth-lost',()=>{replay.finish();story.finish();route.clear();route.setSamples([]);document.querySelector('#activities')?.replaceChildren();});
