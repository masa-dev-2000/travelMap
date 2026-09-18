import {el} from '/shared.js';
import {mapShell} from '/map-shell.js';
import {makeOwnerMap} from '/owner-map.js';
import {makeOwnerRoute} from '/owner-route.js';
import {makeEveryone} from '/panel-everyone.js';
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
const route=makeOwnerRoute(map,shell);
let noticeTimer,mine=null;
function notify(value){clearTimeout(noticeTimer);message.textContent=value;noticeTimer=setTimeout(()=>{message.textContent='';},10000);}
const everyone=makeEveryone(map,shell,{peopleNode,timelineNode,showToggle:!!me,onFilter:filter=>{mine?.setFilter(filter);fitRecords();},onOpenPerson:handle=>mine?.visited?.(handle)});
const JAPAN={center:[137.5,37.5],zoom:4.3};
function fitRecords(){const points=[...route.points(),...everyone.points()];if(points.length)route.fitPoints(points);else map.jumpTo(JAPAN);}
shell.fit.onclick=()=>{shell.hide();fitRecords();};
window.__tm={everyone,route,shell};// 画面確認用(コンソールから状態を読む)
await everyone.ready;
if(!everyone.count())notify('いま旅に出ている人はいません');
if(me){const {startMe}=await import('/panel-me.js');mine=await startMe({shell,map,route,everyone,fitRecords,notify,me});}
else fitRecords();
