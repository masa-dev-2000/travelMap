import {api,el} from '/shared.js';
import {createRecordSave} from '/record-save.js';
import {installInputFlow} from '/input-flow.js';
import {mountAutoLocation} from '/auto-location.js';
let flow=null,photoGeneration=0;
const $=selector=>document.querySelector(selector);
const form=$('#quick'),message=$('#message'),save=$('#save'),more=$('#more'),expense=$('#expense'),amount=$('#amount');
const MAX_EDGE=1600,MAX_BYTES=8*1024*1024,QUICK_COUNT=4;
const DEFAULT_ORDER=['食費','その他','移動','交通費','観光費'];
const NO_PAYMENT=new Set(['移動','起床','就寝']);
const calm=matchMedia('(prefers-reduced-motion: reduce)').matches;
let publishDefault=false,categories=[],selectedId=null,expenseNeeded=false,startedAt,position=null,watchId=null,photos=[],rating=null,moneyOpen=false;

function store(key,value){try{localStorage.setItem('record:'+key,typeof value==='string'?value:JSON.stringify(value));}catch{}}
function load(key,fallback=null){try{const value=localStorage.getItem('record:'+key);return value===null?fallback:JSON.parse(value);}catch{return fallback;}}
function notify(text){message.textContent=text;}
const nameOf=id=>categories.find(item=>item.id===id)?.name??'';

// カテゴリ：よく使う4つ＋残りはドロップダウン
function quickList(){
  const usage=load('usage',{});
  const rank=item=>{const index=DEFAULT_ORDER.indexOf(item.name);return (usage[item.id]??0)*100+(index<0?0:DEFAULT_ORDER.length-index);};
  return [...categories].sort((a,b)=>rank(b)-rank(a)).slice(0,QUICK_COUNT);
}
function renderCategories(){
  const quick=quickList(),node=$('#quick-cats');node.replaceChildren();
  for(const item of quick){
    const button=el('button',{type:'button',textContent:item.name});
    button.dataset.id=item.id;button.setAttribute('role','radio');
    button.onclick=()=>{choose(item.id);flow?.go('rating');};
    node.append(button);
  }
  const list=$('#sheet-list');list.replaceChildren();
  for(const item of categories)if(!quick.includes(item)){
    const button=el('button',{type:'button',textContent:item.name});
    button.dataset.id=item.id;button.setAttribute('role','radio');
    button.onclick=()=>{choose(item.id);closeSheet(true);};
    list.append(button);
  }
  paintCategory();
}
function paintCategory(){
  let inQuick=false;
  for(const button of $('#quick-cats').children){const on=button.dataset.id===selectedId;inQuick||=on;button.setAttribute('aria-checked',String(on));}
  for(const button of $('#sheet-list').children)button.setAttribute('aria-checked',String(button.dataset.id===selectedId));
  more.textContent=inQuick||!selectedId?'ほか':nameOf(selectedId);
  more.classList.toggle('on',!inQuick&&!!selectedId);
}
function choose(id){
  selectedId=id;store('last',id);paintCategory();
  const name=nameOf(id),match=[...expense.options].find(option=>option.textContent===name);
  if(match)expense.value=match.value;
  expenseNeeded=!match;
  moneyOpen=amount.value!==''||!NO_PAYMENT.has(name);
  paintMoney();notify('');
}
// ほか：画面内の選択パネル（どの端末でも同じ表示）
function openSheet(){$('#sheet').hidden=false;more.setAttribute('aria-expanded','true');($('#sheet-list [aria-checked=true]')||$('#sheet-list button'))?.focus();}
function closeSheet(selected=false){$('#sheet').hidden=true;more.setAttribute('aria-expanded','false');if(selected===true)flow?.go('rating');else{more.focus({preventScroll:true});flow?.viewport.reveal(more);}}
more.onclick=openSheet;
$('#sheet-close').onclick=()=>closeSheet();
$('#sheet').onclick=event=>{if(event.target===event.currentTarget)closeSheet();};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#sheet').hidden)closeSheet();});

// 金額：支払いのないカテゴリでは折りたたむ
function paintMoney(){
  $('#money').hidden=!moneyOpen;$('#nopay').hidden=moneyOpen;
  $('#expense-field').hidden=!expenseNeeded;
  save.textContent=amount.value?`¥${Number(amount.value).toLocaleString('ja-JP')} を記録`:'記録する';
}
$('#nopay').onclick=()=>{moneyOpen=true;paintMoney();amount.focus();};
amount.oninput=()=>{amount.value=amount.value.replace(/[^0-9]/g,'').replace(/^0+(?=\d)/,'');paintMoney();};

// 評価：同じ星をもう一度で解除
for(let value=1;value<=5;value++){
  const button=el('button',{type:'button',textContent:'★'});
  button.setAttribute('role','radio');button.setAttribute('aria-label',`評価 ${value}`);
  button.onclick=()=>{rating=rating===value?null:value;paintStars();flow?.go('photo');};
  $('#rating').append(button);
}
function paintStars(){[...$('#rating').children].forEach((button,index)=>{button.classList.toggle('on',rating!==null&&index<rating);button.setAttribute('aria-checked',String(index+1===rating));});}

// 位置：開いている間は精度の良い値へ更新。タップで取り直し
function locate(){
  const where=$('#where'),label=where.querySelector('span');
  const show=(text,state)=>{label.textContent=text;where.className='where'+(state?' '+state:'');};
  if(!navigator.geolocation){show('位置情報なし','ng');return;}
  if(watchId!==null)navigator.geolocation.clearWatch(watchId);
  position=null;show('位置を取得中…');
  watchId=navigator.geolocation.watchPosition(result=>{
    if(position&&result.coords.accuracy>position.accuracy)return;
    position={latitude:result.coords.latitude,longitude:result.coords.longitude,accuracy:result.coords.accuracy};
    show(`位置 ±${Math.round(position.accuracy)}m`,'ok');
  },()=>{if(!position)show('位置なし・タップで再試行','ng');},{enableHighAccuracy:true,maximumAge:30000,timeout:20000});
}
$('#where').onclick=locate;

// 時刻：自動。タップで変更
function toLocalInput(date){return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function paintTime(){$('#when').textContent=startedAt.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});$('#when-input').value=toLocalInput(startedAt);}
$('#when-input').onchange=event=>{if(event.target.value){startedAt=new Date(event.target.value);paintTime();}};

// 写真：端末で縮小しPNG化（撮影情報を除去）
async function toImage(file){
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
  const scale=Math.min(1,MAX_EDGE/Math.max(bitmap.width,bitmap.height));
  const canvas=el('canvas',{width:Math.round(bitmap.width*scale),height:Math.round(bitmap.height*scale)});
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  for(const [type,quality] of [['image/png'],['image/jpeg',0.85]]){
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,type,quality));
    if(blob&&blob.size<=MAX_BYTES)return blob;
  }
  throw new Error('写真が大きすぎます');
}
$('#photo').onchange=async event=>{
  const files=[...event.target.files];event.target.value='';
  if(!files.length)return;
  const finish=saver.beginPhotos();if(!finish)return;
  const ticket=flow.photoTicket(),run=photoGeneration;let added=0;
  try{
    for(const file of files){
      try{
        const blob=await toImage(file);if(run!==photoGeneration)continue;
        const url=URL.createObjectURL(blob),photo={blob,url};photos.push(photo);added++;
        const figure=el('figure'),remove=el('button',{type:'button',textContent:'×'});remove.setAttribute('aria-label','写真を外す');
        remove.onclick=()=>{if(saver.state().saving||saver.state().pending)return;photos=photos.filter(item=>item!==photo);URL.revokeObjectURL(url);figure.remove();};
        figure.append(el('img',{src:url,alt:'追加した写真'}),remove);$('#previews').append(figure);
      }catch(error){if(run===photoGeneration)notify(`写真を読み込めません：${error.message}`);}
    }
  }finally{finish();}
  if(added&&run===photoGeneration)flow.photoDone(ticket);
};

function paintPublish(){$('#publish-label').textContent=$('#publish').checked?'公開する':'非公開';}
$('#publish').onchange=paintPublish;
function reset(){
  photoGeneration++;flow?.reset();
  $('#publish').checked=publishDefault;paintPublish();
  startedAt=new Date();paintTime();
  for(const photo of photos)URL.revokeObjectURL(photo.url);
  photos=[];$('#previews').replaceChildren();
  rating=null;paintStars();
  amount.value='';$('#memo').value='';$('#place').value='';
  notify('');
  if(selectedId)choose(selectedId);else paintMoney();
  locate();
}

// 保存後の演出
function todayCount(){
  const day=new Date().toLocaleDateString('sv-SE'),saved=load('count',{});
  const count=(saved.day===day?saved.count:0)+1;store('count',{day,count});return count;
}
function confetti(canvas){
  const ratio=devicePixelRatio||1,width=canvas.width=innerWidth*ratio,height=canvas.height=innerHeight*ratio,context=canvas.getContext('2d');
  const colors=['#ffd54a','#ff8a65','#7fe0b5','#ffffff','#8ec5ff'];
  const pieces=Array.from({length:90},()=>({x:width/2,y:height*0.42,vx:(Math.random()-0.5)*16*ratio,vy:(-Math.random()*14-6)*ratio,size:(Math.random()*6+4)*ratio,spin:Math.random()*6,color:colors[Math.floor(Math.random()*colors.length)]}));
  const start=performance.now();
  function frame(now){
    const t=now-start;context.clearRect(0,0,width,height);
    for(const p of pieces){p.vy+=0.45*ratio;p.x+=p.vx;p.y+=p.vy;p.vx*=0.99;context.save();context.translate(p.x,p.y);context.rotate(p.spin*t/300);context.fillStyle=p.color;context.globalAlpha=Math.max(0,1-t/1400);context.fillRect(-p.size/2,-p.size/4,p.size,p.size/2);context.restore();}
    if(t<1400)requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
async function celebrate(text){
  const done=$('#done');
  $('#streak').textContent=text;done.hidden=false;
  if(navigator.vibrate)navigator.vibrate([20,40,60]);
  if(!calm)confetti($('#confetti'));
  await new Promise(resolve=>{done.onclick=resolve;setTimeout(resolve,calm?900:1500);});
  done.hidden=true;
}

// Keep the automatic-location OFF control outside this lock.
function paintSaveState(state){
  const locked=state.saving||state.pending;
  for(const node of form.querySelectorAll('.top input,.top button,.card input,.card textarea,.card select,.card button,.bottom input'))node.disabled=locked;
  $('#photo').disabled=$('#photo-open').disabled=locked||state.processing>0;
  save.disabled=!state.canSave;
  if(state.saving)save.textContent='保存中…';
  else if(state.pending)save.textContent=state.activityId?'写真・公開を再試行':'同じ内容で再試行';
  else paintMoney();
}
const saver=createRecordSave({
  create:(body,key)=>api('activities',body,key),
  upload:async(id,photo,index,total)=>{
    save.textContent=`写真を送信中… ${index+1}/${total}`;
    const response=await fetch('/api/private/attachments?'+new URLSearchParams({activity_id:id,purpose:'photo'}),{method:'POST',headers:{'Content-Type':photo.blob.type},body:photo.blob});
    if(!response.ok)throw new Error('写真を送信できません');return response.json();
  },
  publish:(op,key)=>api('public-entries',{activity_id:op.id,date:op.date,place_name:op.body.observed_place_name,memo:op.body.memo,latitude:op.body.latitude,longitude:op.body.longitude,confirmed:true,photo_ids:op.photos.map((_,i)=>op.uploaded.get(i))},key),
  onState:paintSaveState,
});
form.onsubmit=async event=>{
  event.preventDefault();
  if(!saver.state().canSave)return;
  if(!selectedId){notify('カテゴリを選んでください');return;}
  document.activeElement?.blur();notify('');
  const body={category_id:selectedId,trip_id:null,occurred_at:startedAt.toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
    memo:$('#memo').value,observed_place_name:$('#place').value||null,latitude:position?.latitude??null,longitude:position?.longitude??null,rating,publish:$('#publish').checked};
  if(amount.value!=='')body.transaction={category_id:expense.value,amount_minor:Number(amount.value),currency:'JPY',minor_unit:0};
  try{
    const result=await saver.run({body,photos,date:startedAt.toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'})});if(!result)return;
    const usage=load('usage',{});usage[result.body.category_id]=(usage[result.body.category_id]??0)+1;store('usage',usage);
    const summary=`${nameOf(result.body.category_id)}${result.body.publish?' · 公開':''} · 今日 ${todayCount()} 件目`;
    reset();renderCategories();await celebrate(summary);
  }catch(error){notify(`${error.message}（入力・写真は残っています）`);}
};


paintStars();
flow=installInputFlow(form);
void mountAutoLocation($('#auto-location-slot'));
try{
  const data=await api('bootstrap');
  publishDefault=data.settings?.publish_default===true;
  categories=data.categories.filter(c=>c.active&&c.kind==='activity');
  for(const item of data.categories.filter(c=>c.active&&c.kind==='expense'))expense.append(new Option(item.name,item.id));
  renderCategories();
  const last=load('last');
  if(last&&categories.some(item=>item.id===last))selectedId=last;
}catch(error){notify(error.message);}
reset();
