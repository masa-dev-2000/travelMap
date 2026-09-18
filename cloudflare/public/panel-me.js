import {api,apiDelete,el,whoMarker,yen} from '/shared.js';
// ログイン中だけ読み込む: 自分の記録一覧・編集・公開設定、収支、旅と分類、記録フォーム、設定シート。私的データは /api/private/* からだけ取る
export async function startMe({shell,map,route,everyone,fitRecords,notify,me}){
const $=selector=>document.querySelector(selector);
let categories=[], trips=[], activityOffset=null, transactionOffset=null;
let activityGeneration=0,allRecords=[],publicFilter=null;
function formValues(form){return Object.fromEntries(new FormData(form));}
function localNow(now=new Date()){return new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function fillSelect(select,items,empty){select.replaceChildren();if(empty) select.append(new Option(empty,''));for(const item of items)select.append(new Option(item.name,item.id));}
function filter(){const query=new URLSearchParams();if($('#month').value)query.set('month',$('#month').value);if($('#trip-filter').value)query.set('trip',$('#trip-filter').value);return query;}
function txCategories(){fillSelect($('#transaction-form [name=category_id]'),categories.filter(c=>c.active && c.kind===($('#transaction-form [name=kind]').value==='income'?'income':'expense')));}
async function bootstrap(){
  const data=await api('bootstrap');categories=data.categories;trips=data.trips;$('#publish-default').checked=data.settings?.publish_default===true;
  $('#publish-precision').value=data.settings?.publish_precision??'exact';$('#publish-delay').value=String(data.settings?.publish_delay_hours??0);
  if(data.user){$('#me-name').textContent=data.user.display_name;$('#me-handle').textContent='@'+data.user.handle+' · '+data.user.email;if(data.user.avatar_url){$('#me-avatar').src=data.user.avatar_url;$('#me-avatar').hidden=false;}
    const pf=$('#profile-form');pf.elements.display_name.value=data.user.display_name;pf.elements.handle.value=data.user.handle;pf.elements.bio.value=data.user.bio||'';pf.elements.icon.value=data.user.icon||'';$('#icon-preview').hidden=$('#icon-remove').hidden=!data.user.icon_url;if(data.user.icon_url)$('#icon-preview').src=data.user.icon_url;route.setUser(data.user);everyone.setSelf(data.user.handle);paintFace(data.user);pf.elements.tip_url.value=data.user.tip_url||'';}
  paintTravel(data.settings?.map_visible===true,data.settings?.map_visible_until);
  const filterValue=$('#trip-filter').value;fillSelect($('#trip-filter'),trips,'すべて');$('#trip-filter').value=filterValue;
  for(const select of document.querySelectorAll('form select[name=trip_id]'))fillSelect(select,trips,'日常・未設定');
  fillSelect($('#activity-form [name=category_id]'),categories.filter(c=>c.active&&c.kind==='activity'));
  fillSelect($('#activity-form [name=expense_category]'),categories.filter(c=>c.active&&c.kind==='expense'));
  txCategories();
}
async function summary(){
  const result=await api('summary?'+filter()), node=$('#summary');node.replaceChildren();
  const net=result.expense_jpy-result.refund_jpy;
  for(const [label,value] of [['支出（返金差引）',net],['収入',result.income_jpy],['収支',result.income_jpy-net]]){const box=el('div',{className:'metric'});box.append(el('span',{textContent:label}),el('strong',{textContent:yen(value)}));node.append(box);}
  $('#conversion-note').textContent=`未換算 ${result.unconverted_count}件・概算 ${result.estimated_count}件。未換算分は合計に含まれていません。`;
}
async function activities(reset=true){
  const generation=++activityGeneration;
  route.clear();
  if(reset){$('#activities').replaceChildren();activityOffset=0;}
  let count=0,located=0;const routeRecords=[];
  shell.count.textContent='記録を読み込み中…';
  do {
  const params=new URLSearchParams({offset:String(activityOffset||0)});if($('#trip-filter').value)params.set('trip',$('#trip-filter').value);
  const data=await api('activities?'+params);
  if(generation!==activityGeneration)return;
  routeRecords.push(...data.activities);
  for(const item of data.activities){
    count++;
    const entry=el('details',{className:'card'}),preview=el('summary',{className:'record-preview'}),card=el('div',{className:'record-content'}), actions=el('div',{className:'card-actions'});
    preview.append(el('time',{textContent:(item.public_status==='published'?'':'🔒 ')+new Date(item.occurred_at).toLocaleString('ja-JP')}),el('strong',{textContent:item.observed_place_name||item.category_name}),el('p',{textContent:item.memo}));entry.append(preview,card);
    const badgeText=item.public_status==='published'?(item.publish_at&&item.publish_at>new Date().toISOString()?'公開予約':'公開中')+({city:'・場所名のみ',hidden:'・位置なし'}[item.public_precision]??''):'非公開';
    card.append(el('p',{className:'eyebrow',textContent:new Date(item.occurred_at).toLocaleString('ja-JP')}),el('h2',{textContent:item.observed_place_name || item.category_name}),el('p',{className:'memo',textContent:item.memo}),el('span',{className:'badge',textContent:badgeText}));
    if(item.spent_jpy!=null)card.append(el('p',{className:'spent',textContent:yen(item.spent_jpy)}));
    const share=el('button',{textContent:'公開する内容を選ぶ'});share.onclick=()=>openShare(item).catch(error=>notify(error.message));actions.append(share);
    if(item.public_status==='published'){const hide=el('button',{textContent:'公開を解除'});hide.onclick=async()=>{try{await api(`public-entries/${item.public_id}/unpublish`,{});await activities();notify('公開を解除しました');}catch(error){notify(error.message);}};actions.append(hide);}
    card.append(actions);
    card.append(editPanel(item));
    const detail=el('details'), title=el('summary',{textContent:'写真・領収書を添付'}), attachmentForm=el('form',{className:'form-grid'});
    const purpose=el('select',{name:'purpose'});purpose.append(new Option('旅の写真','photo'),new Option('領収書','receipt'));
    const file=el('input',{type:'file',accept:'image/png,image/jpeg,application/pdf',required:true});
    const purposeLabel=el('label',{textContent:'用途'}),fileLabel=el('label',{textContent:'ファイル'});purposeLabel.append(purpose);fileLabel.append(file);attachmentForm.append(purposeLabel,fileLabel,el('button',{textContent:'非公開で添付'}));
    attachmentForm.onsubmit=async event=>{event.preventDefault();const button=attachmentForm.querySelector('button');button.disabled=true;try{const selected=file.files[0];if(!selected||selected.size>8*1024*1024)throw new Error('8MB以内のファイルを選択してください');const response=await fetch('/api/private/attachments?'+new URLSearchParams({activity_id:item.id,purpose:purpose.value}),{method:'POST',headers:{'Content-Type':selected.type},body:selected});const result=await response.json();if(!response.ok)throw new Error(result.error);file.value='';notify('非公開で添付しました');}catch(error){notify(error.message);}finally{button.disabled=false;}};
    detail.append(title,attachmentForm);card.append(detail);$('#activities').append(entry);
    if(item.latitude!=null&&item.longitude!=null){located++;route.addPin(item,()=>{shell.open('me');entry.open=true;entry.scrollIntoView({block:'start'});});entry.addEventListener('toggle',()=>{if(entry.open)map.easeTo({center:[item.longitude,item.latitude]});});}
  }
  if(reset&&data.activities.length===0)$('#activities').append(el('p',{textContent:'まだ記録がありません。'}));
  activityOffset=data.next_offset;$('#more-activities').hidden=true;
  shell.count.textContent=`${count}件${activityOffset!==null?' 読み込み中…':` · 地図${located}件`}`;
  } while(activityOffset!==null);
  allRecords=routeRecords;drawOwn();
  if(reset)fitRecords();
}
// 記録の編集：日時・カテゴリ・場所名・メモ・評価・位置・金額。削除は2段階
function editPanel(item){
  const detail=el('details'),title=el('summary',{textContent:'編集・削除'}),form=el('form',{className:'form-grid'});
  const field=(label,node)=>{const wrap=el('label',{textContent:label});wrap.append(node);return wrap;};
  const when=el('input',{type:'datetime-local',value:localNow(new Date(item.occurred_at))});
  const cat=el('select');fillSelect(cat,categories.filter(c=>c.active&&c.kind==='activity'));cat.value=item.category_id;
  const place=el('input',{value:item.observed_place_name||'',maxLength:200});
  const memo=el('textarea',{value:item.memo,rows:3,maxLength:4000});memo.className='wide';
  const rating=el('select');rating.append(new Option('未評価',''));for(let v=1;v<=5;v++)rating.append(new Option(String(v),String(v)));rating.value=item.rating==null?'':String(item.rating);
  const lat=el('input',{type:'number',step:'any',value:item.latitude??''}),lng=el('input',{type:'number',step:'any',value:item.longitude??''});
  const center=el('button',{type:'button',textContent:'地図の中心に移動'});center.onclick=()=>{const c=map.getCenter();lat.value=c.lat.toFixed(6);lng.value=c.lng.toFixed(6);notify('地図の中心の位置を入れました。保存で確定します');};
  const amount=el('input',{type:'number',min:0,step:1,value:item.spent_jpy??''}),expense=el('select');fillSelect(expense,categories.filter(c=>c.active&&c.kind==='expense'));
  const match=[...expense.options].find(o=>o.textContent===item.category_name);if(match)expense.value=match.value;
  const save=el('button',{textContent:'保存する',className:'primary'});
  if(item.public_status==='published')form.append(el('p',{className:'hint wide',textContent:'公開中の記録です。場所名・メモ・位置の変更は公開ページにも反映されます。'}));
  form.append(field('日時',when),field('カテゴリ',cat),field('場所名',place),el('label',{className:'wide',textContent:'メモ'}),memo,field('評価',rating),field('緯度',lat),field('経度',lng),center,field('金額（円・空欄で支払いなし）',amount),field('支出の分類',expense),save);
  form.querySelector('label.wide').append(memo);
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;
    try{
      const body={occurred_at:new Date(when.value).toISOString(),category_id:cat.value,observed_place_name:place.value||null,memo:memo.value,rating:rating.value===''?null:Number(rating.value)};
      if((lat.value==='')!==(lng.value==='')){notify('緯度と経度は両方入れるか、両方空にしてください');save.disabled=false;return;}
      if(lat.value!==''){body.latitude=Number(lat.value);body.longitude=Number(lng.value);}else if(item.latitude!=null){body.latitude=null;body.longitude=null;}
      await api(`activities/${item.id}`,body);
      if(String(item.spent_jpy??'')!==amount.value)await api(`activities/${item.id}/amount`,{category_id:expense.value,amount_minor:amount.value===''?null:Number(amount.value)});
      await refresh();notify('記録を更新しました');
    }catch(error){notify(error.message);}finally{save.disabled=false;}
  };
  const remove=el('button',{type:'button',textContent:'この記録を削除'});
  remove.onclick=async()=>{if(remove.dataset.armed!=='1'){remove.dataset.armed='1';remove.textContent='もう一度押すと削除します（取り消せません）';setTimeout(()=>{remove.dataset.armed='';remove.textContent='この記録を削除';},5000);return;}
    remove.disabled=true;try{await apiDelete(`activities/${item.id}`);await refresh();notify('記録を削除しました');}catch(error){notify(error.message);remove.disabled=false;}};
  detail.append(title,form,remove);
  if(item.public_status==='published'){
    const options=el('form',{className:'form-grid'}),precision=el('select'),delay=el('select');
    for(const [v,l] of [['exact','そのまま（地図に点）'],['city','場所名だけ'],['hidden','場所も位置も出さない']])precision.append(new Option(l,v));precision.value=item.public_precision||'exact';
    delay.append(new Option('予約はそのまま',''));for(const [v,l] of [['0','今すぐ公開'],['24','1日後'],['72','3日後'],['168','1週間後'],['720','30日後']])delay.append(new Option(l,v));
    const apply=el('button',{textContent:'公開の設定を変更'});
    options.append(field('公開時の位置',precision),field('公開までの時間',delay),apply);
    options.onsubmit=async event=>{event.preventDefault();apply.disabled=true;try{const body={precision:precision.value};if(delay.value!=='')body.publish_delay_hours=Number(delay.value);await api(`public-entries/${item.public_id}/options`,body);await activities();notify('公開の設定を変更しました');}catch(error){notify(error.message);}finally{apply.disabled=false;}};
    detail.append(options);
  }
  return detail;
}
async function transactions(reset=true){
  if(reset){$('#transactions').replaceChildren();transactionOffset=0;}
  const params=filter();params.set('offset',String(transactionOffset||0));const data=await api('transactions?'+params);
  for(const item of data.transactions){const node=el('article');node.append(el('strong',{textContent:`${item.kind==='income'?'収入':item.kind==='refund'?'返金':'支出'} · ${item.category_name} · ${item.currency} ${(item.amount_minor/10**item.minor_unit).toFixed(item.minor_unit)}`}),el('p',{textContent:item.description}),el('small',{textContent:`${new Date(item.occurred_at).toLocaleString('ja-JP')} ／ 取引ID: ${item.id}`}));$('#transactions').append(node);}
  transactionOffset=data.next_offset;$('#more-transactions').hidden=transactionOffset===null;
  if(reset&&!data.transactions.length)$('#transactions').append(el('p',{textContent:'この期間の取引はありません。'}));
}
async function refresh(){await Promise.all([summary(),activities(),transactions()]);everyone.reload();}
function bindForm(selector,path,build,after){
  const form=$(selector);let lastBody='',key=crypto.randomUUID();
  form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button[type=submit],button:not([type])');button.disabled=true;
    try{const body=build(formValues(form)),serialized=JSON.stringify(body);if(serialized!==lastBody){lastBody=serialized;key=crypto.randomUUID();}await api(path,body,key);lastBody='';form.reset();for(const input of form.querySelectorAll('[type=datetime-local]'))input.value=localNow();if(after)await after();await refresh();notify('保存しました');}
    catch(error){notify(error.message);}finally{button.disabled=false;}
  });
}
bindForm('#activity-form','activities',value=>{
  const body={category_id:value.category_id,trip_id:value.trip_id||null,occurred_at:new Date(value.occurred_at).toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,memo:value.memo,observed_place_name:value.observed_place_name||null,latitude:value.latitude===''?null:Number(value.latitude),longitude:value.longitude===''?null:Number(value.longitude),rating:value.rating===''?null:Number(value.rating)};
  if(value.amount!=='')body.transaction={category_id:value.expense_category,amount_minor:Number(value.amount),currency:'JPY',minor_unit:0};return body;
});
bindForm('#transaction-form','transactions',value=>{
  const unit={JPY:0,USD:2,EUR:2,KRW:0,TWD:2}[value.currency], scaled=Number(value.amount)*10**unit;
  if(Math.abs(scaled-Math.round(scaled))>1e-6)throw new Error('通貨の小数桁数を確認してください');
  return {...value,occurred_at:new Date(value.occurred_at).toISOString(),trip_id:value.trip_id||null,refund_of:value.refund_of||null,minor_unit:unit,amount_minor:Math.round(scaled),amount_jpy:value.currency==='JPY'?null:value.amount_jpy===''?null:Number(value.amount_jpy),conversion_status:value.amount_jpy===''?'unconverted':value.conversion_status};
},txCategories);
bindForm('#trip-form','trips',value=>value,bootstrap);
// 期間でまとめて紐づける（日付は日本時間で判定）
$('#assign-form').onsubmit=async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
  try{const value=formValues(form);const result=await api(`trips/${value.trip_id}/assign`,{starts_on:value.starts_on,ends_on:value.ends_on});notify(`${result.assigned}件を旅に紐づけました`);await refresh();}
  catch(error){notify(error.message);}finally{button.disabled=false;}
};
bindForm('#category-form','categories',value=>value,bootstrap);
$('#transaction-form [name=kind]').onchange=txCategories;
$('#locate').onclick=()=>{if(!navigator.geolocation){notify('現在地を取得できないブラウザです');return;}navigator.geolocation.getCurrentPosition(position=>{$('#activity-form [name=latitude]').value=position.coords.latitude;$('#activity-form [name=longitude]').value=position.coords.longitude;notify('現在地を入力しました');},()=>notify('現在地を取得できません。位置情報の許可を確認してください。'));};
$('#publish-default').onchange=async event=>{const input=event.target;input.disabled=true;try{await api('settings',{publish_default:input.checked});notify(input.checked?'新しい記録は最初からみんなに見せます':'新しい記録は最初は自分だけに見えます');}catch(error){input.checked=!input.checked;notify(error.message);}finally{input.disabled=false;}};
// 旅モード: オンの間だけみんなの地図に出る。自動オフは日数で送り、サーバーが期限(map_visible_until)にする
const travelBadge=el('span',{className:'travel-badge',textContent:'旅モード中',hidden:true});shell.count.before(travelBadge);
function paintTravel(on,until){$('#map-visible').checked=on;$('#map-visible-label').textContent=on?'旅モード中':'旅モードオフ';travelBadge.hidden=!on;$('#map-visible-days').disabled=!on;if(!on||!until)$('#map-visible-days').value='0';
  $('#map-visible-until').textContent=on&&until?new Date(until).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})+' に自動でオフになります':'';}
async function saveTravel(body,done){try{await api('settings',body);const data=await api('bootstrap');paintTravel(data.settings.map_visible,data.settings.map_visible_until);if(body.map_visible_days)$('#map-visible-days').value=String(body.map_visible_days);await everyone.reload();notify(done(data.settings));}catch(error){notify(error.message);const data=await api('bootstrap').catch(()=>null);if(data)paintTravel(data.settings.map_visible,data.settings.map_visible_until);}}
$('#map-visible').onchange=event=>saveTravel(event.target.checked?{map_visible:true,map_visible_days:Number($('#map-visible-days').value)}:{map_visible:false},s=>s.map_visible?'旅モードをオンにしました。みんなの地図に表示されます':'旅モードをオフにしました。みんなの地図から隠れます');
$('#map-visible-days').onchange=event=>saveTravel({map_visible_days:Number(event.target.value)},s=>s.map_visible_until?'自動でオフにする日時を保存しました':'手動でオフにするまで旅モードを続けます');
$('#publish-precision').onchange=async event=>{try{await api('settings',{publish_precision:event.target.value});notify('位置の出し方を保存しました');}catch(error){notify(error.message);}};
$('#publish-delay').onchange=async event=>{try{await api('settings',{publish_delay_hours:Number(event.target.value)});notify('見せるまでの時間を保存しました');}catch(error){notify(error.message);}};
async function iconRequest(method,body){const response=await fetch('/api/private/icon',{method,headers:body?{'Content-Type':'image/png'}:{},body}),result=await response.json();if(!response.ok)throw new Error(result.error||'保存できませんでした');}
// 正方形に中央クロップして256pxのPNGにする（canvas経由なのでEXIFは残らない）
$('#icon-file').onchange=async event=>{const input=event.currentTarget,file=input.files[0];if(!file)return;try{const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}),side=Math.min(bitmap.width,bitmap.height),canvas=el('canvas',{width:256,height:256});canvas.getContext('2d').drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,256,256);bitmap.close();const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob||blob.size>512*1024)throw new Error('画像が大きすぎます');await iconRequest('POST',blob);await bootstrap();notify('アイコン画像を保存しました');}catch(error){notify(`アイコンを保存できません：${error.message}`);}finally{input.value='';}};
$('#icon-remove').onclick=async()=>{try{await iconRequest('DELETE');await bootstrap();notify('アイコン画像を外しました');}catch(error){notify(error.message);}};
$('#profile-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{const v=formValues(form);await api('settings',{display_name:v.display_name,handle:v.handle,bio:v.bio,icon:v.icon||'',tip_url:v.tip_url||null});await bootstrap();notify('プロフィールを保存しました');}catch(error){notify(error.message);}finally{button.disabled=false;}};
$('#logout').onclick=async()=>{try{const r=await fetch('/auth/logout',{method:'POST'});if(!r.ok&&r.status!==302)throw new Error('ログアウトできませんでした');location.href='/';}catch(error){notify(error.message);}};
$('#refresh').onclick=()=>refresh().catch(error=>notify(error.message));
$('#trip-filter').onchange=()=>refresh().catch(error=>notify(error.message));
$('#month').onchange=()=>Promise.all([summary(),transactions()]).catch(error=>notify(error.message));
$('#more-activities').onclick=()=>activities(false).catch(error=>notify(error.message));
$('#more-transactions').onclick=()=>transactions(false).catch(error=>notify(error.message));
async function openShare(item){
  const form=$('#share-form');form.reset();form.elements.activity_id.value=item.id;form.elements.date.value=new Date(item.occurred_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});$('#share-error').textContent='';
  const {attachments}=await api('attachments?'+new URLSearchParams({activity_id:item.id}));const box=$('#share-photos');box.replaceChildren(el('legend',{textContent:'公開するPNG写真'}));
  for(const photo of attachments.filter(p=>p.purpose==='photo'&&p.media_type==='image/png')){const label=el('label',{className:'check'});label.append(el('input',{type:'checkbox',name:'photo_ids',value:photo.id}),el('span',{textContent:photo.caption||'旅の写真'}));const link=el('a',{textContent:'写真を確認',href:`/api/private/attachments/${photo.id}`,target:'_blank',rel:'noopener'});label.append(link);box.append(label);}
  $('#share-dialog').showModal();
}
let shareSerialized='',shareKey=crypto.randomUUID();
$('#share-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('.primary');button.disabled=true;
  try{const value=formValues(form),body={activity_id:value.activity_id,date:value.date,place_name:value.place_name||null,memo:value.memo,latitude:value.latitude===''?null:Number(value.latitude),longitude:value.longitude===''?null:Number(value.longitude),confirmed:form.elements.confirmed.checked,photo_ids:new FormData(form).getAll('photo_ids')};const serialized=JSON.stringify(body);if(serialized!==shareSerialized){shareSerialized=serialized;shareKey=crypto.randomUUID();}await api('public-entries',body,shareKey);shareSerialized='';$('#share-dialog').close();await activities();notify('選んだ内容を公開しました');}catch(error){$('#share-error').textContent=error.message;}finally{button.disabled=false;}};
$('#close-share').onclick=()=>$('#share-dialog').close();
$('#month').value='';
for(const input of document.querySelectorAll('[type=datetime-local]'))input.value=localNow();
// タイムラインの絞り込みを自分の線にも反映する(ほかの人を選んだら自分の線は隠す)
function drawOwn(){
  const f=publicFilter,tripName=id=>trips.find(t=>t.id===id)?.name,jst=r=>new Date(r.occurred_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
  route.render(!f||!f.active?allRecords:f.person&&f.person!==me.handle?[]:allRecords.filter(r=>(!f.trip||tripName(r.trip_id)===f.trip)&&(!f.category||r.category_name===f.category)&&(!f.from||jst(r)>=f.from)&&(!f.to||jst(r)<=f.to)));
}
// 右上の自分のアイコン → 設定シート
const face=el('button',{type:'button',className:'me-button'});face.setAttribute('aria-label','設定を開く');shell.stage.append(face);
function paintFace(user){face.replaceChildren(whoMarker({image:user.icon_url,icon:user.icon,avatar:user.avatar_url,name:user.display_name,color:'#356f68'}));}
paintFace(me);face.onclick=()=>$('#settings-dialog').showModal();$('#close-settings').onclick=()=>$('#settings-dialog').close();
$('#settings-dialog').addEventListener('click',event=>{if(event.target===event.currentTarget)event.currentTarget.close();});
// 足あと: 最近見てくれた人(数字は出さない)。未読があればレールの「じぶん」に点を付け、パネルを開いたら既読にする
const ago=at=>{const minutes=Math.max(0,Math.floor((Date.now()-Date.parse(at))/60000));return minutes<2?'たった今':minutes<60?minutes+'分前':minutes<1440?Math.floor(minutes/60)+'時間前':Math.floor(minutes/1440)+'日前';};
async function footprints(){
  try{const data=await api('footprints'),box=$('#footprints');box.replaceChildren();shell.button('me').classList.toggle('rail-dot',data.unread);
    if(!data.visitors.length)return;box.append(el('h2',{textContent:'最近見てくれた人'}));const row=el('div',{className:'visitors'});
    for(const v of data.visitors){const item=el('div',{className:'visitor'});item.append(whoMarker({image:v.icon_url,icon:v.icon,avatar:v.avatar_url,name:v.display_name,color:'#356f68'}),el('strong',{textContent:v.display_name}),el('span',{textContent:ago(v.at)}));row.append(item);}
    box.append(row);}catch{}
}
shell.drawer.addEventListener('viewchange',async event=>{if(event.detail==='me'&&shell.button('me').classList.contains('rail-dot')){try{await api('footprints/seen',{});shell.button('me').classList.remove('rail-dot');}catch{}}});
const visitedToday=new Set();
function visited(handle){if(visitedToday.has(handle))return;visitedToday.add(handle);api('footprints',{handle}).catch(()=>visitedToday.delete(handle));}
try{await bootstrap();await refresh();}catch(error){notify(error.message);}
footprints();
return {visited,setFilter:f=>{publicFilter=f;drawOwn();},refresh};
}
