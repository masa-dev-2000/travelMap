import {api,apiDelete} from '/shared.js';
const $=selector=>document.querySelector(selector);
const button=$('#tap'),sub=$('#sub'),status=$('#status'),undo=$('#undo'),where=$('#where');
const WAIT_FOR_FIX_MS=4000,UNDO_MS=15000;
let categoryId=null,publish=false,position=null,lastId=null,undoTimer=null,busy=false,pendingKey=null;

function today(){return new Date().toLocaleDateString('sv-SE');}
function count(delta=0){
  let saved={};try{saved=JSON.parse(localStorage.getItem('tap:count')||'{}');}catch{}
  const value=Math.max(0,(saved.day===today()?saved.count:0)+delta);
  try{localStorage.setItem('tap:count',JSON.stringify({day:today(),count:value}));}catch{}
  $('#count').textContent=value;
}
function say(text){sub.textContent=text;}

// 位置は開いている間ずっと更新し、押した瞬間の最新値を使う
function locate(){
  if(!navigator.geolocation){where.lastElementChild.textContent='位置情報なし';return;}
  navigator.geolocation.watchPosition(result=>{
    position={latitude:result.coords.latitude,longitude:result.coords.longitude,accuracy:result.coords.accuracy,at:Date.now()};
    where.className='ok';where.lastElementChild.textContent=`位置 ±${Math.round(position.accuracy)}m`;
  },()=>{if(!position)where.lastElementChild.textContent='位置を取得できません';},{enableHighAccuracy:true,maximumAge:5000,timeout:20000});
}
// 5分以内の位置はそのまま使う。古ければ押した時に取り直し、最大4秒だけ待つ
const fresh=()=>position&&Date.now()-position.at<300000;
function waitForFix(){
  return new Promise(resolve=>{
    const timer=setTimeout(resolve,WAIT_FOR_FIX_MS);
    navigator.geolocation?.getCurrentPosition(result=>{position={latitude:result.coords.latitude,longitude:result.coords.longitude,accuracy:result.coords.accuracy,at:Date.now()};clearTimeout(timer);resolve();},()=>{clearTimeout(timer);resolve();},{enableHighAccuracy:true,maximumAge:60000,timeout:WAIT_FOR_FIX_MS});
  });
}

// 画面を消さない（対応端末のみ）
async function keepAwake(){try{if('wakeLock'in navigator)await navigator.wakeLock.request('screen');}catch{}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')keepAwake();});

button.onclick=async()=>{
  if(busy||!categoryId)return;
  busy=true;button.classList.add('busy');say('保存中…');
  const occurred=new Date();            // 時刻は押した瞬間
  if(!fresh())await waitForFix();       // 位置がまだなら最大4秒だけ待つ
  pendingKey??=crypto.randomUUID();
  const body={category_id:categoryId,trip_id:null,occurred_at:occurred.toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,memo:'',observed_place_name:null,
    latitude:fresh()?position.latitude:null,longitude:fresh()?position.longitude:null,rating:null,publish};
  try{
    const result=await api('activities',body,pendingKey);
    pendingKey=null;lastId=result.id;count(1);
    if(navigator.vibrate)navigator.vibrate([30,50,30]);
    button.classList.add('done');
    say(`${occurred.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})} を記録${body.latitude===null?'（位置なし）':''}`);
    undo.hidden=false;clearTimeout(undoTimer);undoTimer=setTimeout(()=>{undo.hidden=true;lastId=null;},UNDO_MS);
    setTimeout(()=>{button.classList.remove('done');say('押すと、今の場所と時刻をすぐ残します');},1600);
  }catch(error){
    // 同じ送信キーで再送するので、押し直しても二重にならない
    say('保存できませんでした。もう一度押してください');if(navigator.vibrate)navigator.vibrate(200);
  }finally{busy=false;button.classList.remove('busy');}
};
undo.onclick=async()=>{
  if(!lastId)return;const id=lastId;lastId=null;undo.hidden=true;
  try{await apiDelete(`activities/${id}`);count(-1);say('直前の記録を取り消しました');}catch(error){say(error.message);}
};

count();locate();keepAwake();
try{
  const data=await api('bootstrap');
  const activities=data.categories.filter(item=>item.active&&item.kind==='activity');
  categoryId=(activities.find(item=>item.name==='移動')??activities[0])?.id??null;
  publish=data.settings?.publish_default===true;
  const visible=$('#visible'),paint=()=>{$('#visible-label').textContent=visible.checked?'旅モード中':'旅モードオフ';};
  visible.checked=data.settings?.map_visible===true;paint();
  visible.onchange=async()=>{paint();try{await api('settings',{map_visible:visible.checked});}catch(error){visible.checked=!visible.checked;paint();say(error.message);}};
  const statusForm=$('#status-form');statusForm.elements.status.value=data.user?.status||'';
  statusForm.onsubmit=async event=>{event.preventDefault();const input=statusForm.elements.status;try{await api('settings',{status:input.value});input.blur();say(input.value.trim()?'ステータスを更新しました':'ステータスを消しました');}catch(error){say(error.message);}};
  if(!categoryId)say('カテゴリがありません。設定で追加してください');
}catch(error){say(error.message);}
