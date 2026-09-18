import {el} from '/shared.js';
import {mapShell} from '/map-shell.js';
import {makeOwnerMap} from '/owner-map.js';
import {makeOwnerRoute} from '/owner-route.js';
import {makeEveryone} from '/panel-everyone.js';
import {makeReplay} from '/replay.js';
import {makeStory} from '/story.js';
// 1つの地図ページ。未ログインは公開データだけ、ログインすると自分の操作(じぶん・＋・設定)が増える
const $=selector=>document.querySelector(selector),message=$('#message');
let session={user:null};
try{const response=await fetch('/api/public/session',{cache:'no-store'});if(response.ok)session=await response.json();}catch{}
const me=session.user;
for(const dialog of document.querySelectorAll('dialog'))document.body.append(dialog);
const peopleNode=el('div',{className:'people'}),timelineNode=el('div');
const groups=[
  {id:'everyone',label:'みんな',title:'いま旅に出ている人',icon:'☺',nodes:[peopleNode]},
  {id:'timeline',label:'タイムライン',icon:'▤',small:true,nodes:[timelineNode]},
];
if(me)groups.push(
  {id:'me',label:'じぶん',title:'じぶんの記録',icon:'◉',nodes:[el('div',{id:'footprints'}),$('#money-panel'),$('#trip-form').closest('details'),$('#me-filters'),$('#activities').closest('section')]},
  {id:'add',label:'記録',title:'記録する',icon:'＋',nodes:[el('a',{className:'quick-record',href:'/admin/start/',textContent:'スマホ用の記録をはじめる →'}),$('#add-forms')],action:()=>{if(innerWidth<=700){location.href='/admin/start/';return true;}return false;}},
);
const shell=mapShell(groups);
if(!me){const login=el('a',{className:'rail-login',href:'/auth/google?next=%2F'});login.append(el('span',{className:'rail-icon',textContent:'→'}),el('span',{textContent:'ログイン'}));shell.fit.after(login);}
const map=makeOwnerMap();
shell.drawer.addEventListener('viewchange',()=>map.resize());// 右ペインの開閉で地図の幅が変わる。続く fit が新しい幅で計算されるよう、その場で合わせる
const route=makeOwnerRoute(map,shell);
let noticeTimer,mine=null;
function notify(value){clearTimeout(noticeTimer);message.textContent=value;noticeTimer=setTimeout(()=>{message.textContent='';},10000);}
const everyone=makeEveryone(map,shell,{peopleNode,timelineNode,showToggle:!!me,onFilter:filter=>{replay.finish();mine?.setFilter(filter);fitRecords();},onOpenPerson:handle=>mine?.visited?.(handle),onPlay:handle=>playPerson(handle)});
const JAPAN={center:[137.5,37.5],zoom:4.3};
function fitRecords(){const points=[...route.points(),...everyone.points()];if(points.length)route.fitPoints(points);else map.jumpTo(JAPAN);if(everyone.count()&&!route.count()&&!everyone.shownCount())notify('この期間の記録はありません。期間を広げると表示されます');}
shell.fit.onclick=()=>{shell.hide();fitRecords();};
const replay=makeReplay(map,shell,{tracks:()=>[route.track(),...everyone.tracks()],begin:()=>{route.setReplay(true);everyone.setReplay(true);fitRecords();},end:()=>{route.setReplay(false);everyone.setReplay(false);}});
// 旅の再生(ログ付き)。再生中は、ほかの線とマーカーを隠す
const story=makeStory(map,shell,{begin:()=>{replay.finish();route.setReplay(true);everyone.setReplay(true);},end:()=>{route.setReplay(false);everyone.setReplay(false);}});
// trip: undefined=選択肢を出す、''=すべての公開記録、名前=その旅(共有URL用)
function playPerson(handle,trip){
  const options=everyone.storyOptions(handle);if(!options.length){notify('この人はいま旅モード中ではないか、公開している記録がありません');return;}
  if(handle!==me?.handle)mine?.visited?.(handle);
  const chosen=trip===undefined?options:options.filter(option=>option.trip===trip);story.open('旅を再生',chosen.length?chosen:options.slice(-1));
}
window.__tm={everyone,route,shell,replay,story};// 画面確認用(コンソールから状態を読む)
await everyone.ready;
if(!everyone.count())notify('いま旅に出ている人はいません');
const shared=new URLSearchParams(location.search);
if(me){const {startMe}=await import('/panel-me.js');mine=await startMe({shell,map,route,everyone,fitRecords,notify,me,playTrip:(title,options)=>story.open(title,options)});}
else if(!shared.get('play'))fitRecords();
// 共有URL /?play=<handle>&trip=<旅名>: 公開データだけで、その再生を始める
if(shared.get('play'))playPerson(shared.get('play'),shared.get('trip')??'');
