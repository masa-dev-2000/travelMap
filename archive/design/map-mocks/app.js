import {designs,references,initialRecords} from './data.js';

const $=selector=>document.querySelector(selector);
const app=$('#app'),panel=$('#panel'),body=$('#panel-body'),chrome=$('#chrome');
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const yen=value=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(value);
const icons={
 menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
 records:'<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"/>',
 money:'<path d="m6 3 6 8 6-8M6 12h12M6 16h12M12 11v10"/>',
 add:'<path d="M12 4v16M4 12h16"/>',
 search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
 map:'<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16"/>',
 trip:'<path d="M6 19h12M5 17l4-9 4 5 3-9 4 13z"/>',
 day:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 2v6M16 2v6M4 11h16"/>',
 close:'<path d="m6 6 12 12M18 6 6 18"/>',
 more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 place:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
 food:'<path d="M5 3v7M8 3v7M11 3v7M5 8h6M8 10v11M18 3v18M18 3c-4 3-4 8 0 8"/>',
 coffee:'<path d="M4 8h12v6a6 6 0 0 1-12 0zM16 8h2a3 3 0 0 1 0 6h-2M3 21h15M7 2v2M12 2v2"/>',
};
function icon(name){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.place}</svg>`;}
function button(action,label,iconName,cls=''){return `<button type="button" data-action="${action}" class="${cls}" aria-label="${esc(label)}" title="${esc(label)}">${icon(iconName)}<span>${esc(label)}</span></button>`;}
function iconButton(action,label,iconName,cls=''){return `<button type="button" data-action="${action}" class="${cls}" aria-label="${esc(label)}" title="${esc(label)}">${icon(iconName)}</button>`;}
const brand=()=>`<div class="map-brand"><span class="brand-icon">↗</span><div>TravelMap<small>山陰の旅</small></div></div>`;
const storedVariant=Number(new URL(location.href).searchParams.get('v'));
const state={variant:designs.some(d=>d.id===storedVariant)?storedVariant:1,audience:'owner',query:'',category:'すべて',day:'all',selected:'05',panel:null,menu:false,timeline:false,records:structuredClone(initialRecords)};
const map=L.map('map',{zoomControl:false,scrollWheelZoom:true,attributionControl:true}).setView([35.59,134.46],10);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map);
const markerLayer=L.layerGroup().addTo(map),markers=new Map();
let lastFocus=null,toastTimer,hasFitted=false;

function visibleRecords(){return state.records.filter(r=>(state.audience==='owner'||r.published)&&(state.day==='all'||r.date===state.day)&&(state.category==='すべて'||r.category===state.category)&&(!state.query||[r.title,r.memo,r.area].some(s=>s.toLowerCase().includes(state.query.toLowerCase()))));}
function availableRecords(){return state.records.filter(r=>state.audience==='owner'||r.published);}
function selectedRecord(){return visibleRecords().find(r=>r.id===state.selected)||visibleRecords()[0];}
function pinIcon(r){return L.divIcon({className:`map-pin ${r.id===state.selected?'selected':''}`,html:`<div class="pin-dot"><span>${esc(r.id.slice(0,2))}</span></div>`,iconSize:[32,38],iconAnchor:[16,34]});}
function renderMarkers(){
  markerLayer.clearLayers();markers.clear();
  for(const record of visibleRecords()){
    const marker=L.marker([record.lat,record.lng],{icon:pinIcon(record),keyboard:true,title:record.title,alt:record.title});
    marker.on('click',()=>{
      state.selected=record.id;updateSelectedMarkers();
      if(state.variant===9){
        const popup=document.createElement('div');popup.innerHTML=`<strong>${esc(record.title)}</strong><p class="subtle">${esc(record.date.slice(5))} · ${esc(record.category)}</p><button class="secondary">記録を開く →</button>`;
        popup.querySelector('button').onclick=()=>{map.closePopup();openDetail(record.id);};marker.bindPopup(popup,{autoPan:false}).openPopup();
      }else openDetail(record.id);
    });marker.addTo(markerLayer);markers.set(record.id,marker);
  }
  $('#count-label').textContent=`${visibleRecords().length}件の記録`;
  updateStepper();
}
function updateSelectedMarkers(){for(const record of visibleRecords())markers.get(record.id)?.setIcon(pinIcon(record));updateStepper();}
function fitMap(){const rows=visibleRecords();if(rows.length)map.fitBounds(rows.map(r=>[r.lat,r.lng]),{padding:[65,85],maxZoom:12});}
function actionItems(){return state.audience==='owner'?[['records','記録','records'],['money','収支','money'],['add','記録する','add'],['trip','旅程','trip']]:[['records','記録','records'],['trip','旅程','trip'],['all','地図全体','map']];}
function fullMenu(){return `<nav class="menu-list" aria-label="メニュー">${actionItems().filter(([a])=>a!=='all').map(([a,l,i])=>button(a,l,i)).join('')}<button type="button" data-action="all">${icon('map')}<span>記録全体を表示</span></button></nav>`;}
function compactMenu(){return `${iconButton('menu','メニュー','menu','menu-anchor')}<span class="mini-brand">TravelMap</span>`;}

function renderChrome(){
  app.dataset.design=String(state.variant);app.classList.toggle('public-mode',state.audience==='public');
  const actions=actionItems();let html='';
  switch(state.variant){
    case 1:html=`<button class="menu-anchor" data-action="menu" aria-label="メニュー">${icon('menu')}<span>メニュー</span></button><span class="mini-brand">TravelMap</span>`;break;
    case 2:html=`<div class="search-shell"><div class="search-bar">${iconButton('menu','メニュー','menu')}<input id="map-search" type="search" placeholder="この旅の記録を探す" aria-label="記録を検索" value="${esc(state.query)}">${iconButton('search','検索結果を表示','search')}</div><div class="chips" aria-label="分類で絞り込み">${['すべて','散歩','食事','休憩'].map(c=>`<button data-category="${c}" class="${state.category===c?'active':''}">${c}</button>`).join('')}</div></div><span class="search-mark">TravelMap</span>`;break;
    case 3:html=`<div class="island"><span class="island-mark">↗</span><div><small>YOUR JOURNEY</small><strong>山陰の旅</strong></div>${iconButton('menu','旅のメニュー','more')}</div>`;break;
    case 4:html=`<nav class="rail" aria-label="機能レール"><span>↗</span>${actions.map(([a,l,i])=>button(a,l,i,state.panel===a?'active':'')).join('')}${iconButton('all','地図全体','map')}</nav><div class="rail-label">TravelMap <span class="subtle">/ 山陰の旅</span></div>`;break;
    case 5:html=`<div class="drawer-caption">TravelMap / 山陰の旅</div><nav class="drawer-tabs" aria-label="引き出しメニュー">${actions.map(([a,l,i])=>button(a,l,i)).join('')}</nav>`;break;
    case 6:html=`<div class="dock-name">TravelMap <span class="subtle">山陰の旅</span></div><nav class="dock" aria-label="下部ドック">${actions.map(([a,l,i])=>button(a,l,i,state.panel===a?'active':'')).join('')}</nav>`;break;
    case 7:html=`${compactMenu()}<div class="timeline"><button class="timeline-caption" data-action="timeline" aria-expanded="${state.timeline}"><span>JOURNEY DAYS</span><strong>${state.day==='all'?'5/16 — 5/19':state.day.slice(5).replace('-','/')}</strong><span>${state.timeline?'⌄':'⌃'}</span></button>${state.timeline?`<div class="days"><button data-day="all" class="${state.day==='all'?'active':''}"><strong>すべて</strong><small>4 DAYS</small></button>${['16','17','18','19'].map(day=>`<button data-day="2026-05-${day}" class="${state.day===`2026-05-${day}`?'active':''}"><strong>5/${day}</strong><small>DAY ${Number(day)-15}</small></button>`).join('')}</div>`:''}</div>`;break;
    case 8:html=`<button class="journey-pill" data-action="trip">${icon('trip')}<span><small>4 DAYS / SAN'IN</small><strong>山陰の旅をたどる</strong></span><span>⌄</span></button>${iconButton('menu','メニュー','more','journey-menu')}<div class="journey-stepper"><button data-action="prev-record" aria-label="前の記録">←</button><span id="step-counter" class="step-counter"></span><button data-action="next-record" aria-label="次の記録">→</button></div>`;break;
    case 9:html=`<div class="pin-top">${brand()}${iconButton('menu','メニュー','more')}</div><div class="pin-instruction">ピンを選んで、その場所の記録を開く</div>`;break;
    case 10:html=`<div class="floating-brand">${brand()}</div>${state.menu?`<nav class="fan-menu" aria-label="片手メニュー">${actions.map(([a,l,i])=>button(a,l,i,'fan-item')).join('')}</nav>`:''}<button class="fan-trigger" data-action="menu" aria-label="${state.menu?'メニューを閉じる':'メニュー'}" aria-expanded="${state.menu}">${icon(state.menu?'close':'menu')}</button>`;break;
  }
  if(state.menu&&state.variant!==10)html+=fullMenu();
  chrome.innerHTML=html;
  for(const item of chrome.querySelectorAll('[data-action="menu"]'))item.setAttribute('aria-expanded',String(state.menu));
  chrome.querySelector('#map-search')?.addEventListener('input',event=>{
    state.query=event.target.value;renderMarkers();openPanel('records',{focus:false});
  });
  updateStepper();
}
function updateStepper(){const node=$('#step-counter');if(node){const rows=visibleRecords(),index=Math.max(0,rows.findIndex(r=>r.id===state.selected));node.textContent=rows.length?`${index+1} / ${rows.length} 訪問地点`:'記録なし';}}

function recordRows(journey=false){
  const rows=visibleRecords();
  if(!rows.length)return '<p class="empty">該当する記録がありません。</p><button class="secondary" data-action="clear-filter">絞り込みを解除</button>';
  return rows.map((r,index)=>`<button class="list-row ${journey?'journey-row':''}" data-record="${esc(r.id)}">${journey?`<span class="journey-num">${index+1}</span>`:`<span class="row-icon">${icon(r.category==='食事'?'food':r.category==='休憩'?'coffee':'place')}</span>`}<span class="row-text"><strong>${esc(r.title)}</strong><small>${r.date.slice(5).replace('-','/')} ${esc(r.time)} · ${esc(r.area)}</small></span><span class="arrow">›</span></button>`).join('');
}
function filterNote(){const terms=[state.day==='all'?'':state.day.slice(5),state.category==='すべて'?'':state.category,state.query].filter(Boolean);return terms.length?`<p class="subtle">絞り込み：${esc(terms.join(' / '))}</p><button data-action="clear-filter" class="secondary">解除</button>`:'';}
function moneyContent(){
  const rows=visibleRecords(),total=rows.reduce((sum,r)=>sum+r.amount,0);
  return `<p class="subtle">山陰の旅 · 表示中の${rows.length}件</p>${filterNote()}<div class="money-grid"><div class="money-card"><span>支出</span><strong>${yen(total)}</strong></div><div class="money-card"><span>収入</span><strong>¥0</strong></div><div class="money-card"><span>収支</span><strong>${yen(-total)}</strong></div></div><h2>内訳</h2>${['食事','休憩','散歩'].map(c=>{const sum=rows.filter(r=>r.category===c).reduce((n,r)=>n+r.amount,0);return `<p style="display:flex;justify-content:space-between"><span>${c}</span><strong>${yen(sum)}</strong></p>`;}).join('')}<div class="budget-track"><span style="width:${Math.min(100,total/20000*100)}%"></span></div><p class="subtle">サンプル予算 ¥20,000</p><h2>取引</h2>${rows.filter(r=>r.amount>0).map(r=>`<button class="list-row" data-record="${esc(r.id)}"><span class="row-text"><strong>${esc(r.title)}</strong><small>${r.date.slice(5)} ${esc(r.time)}</small></span><span>${yen(r.amount)}</span></button>`).join('')}`;
}
function detailContent(){
  const r=selectedRecord();if(!r)return '<p class="empty">表示できる記録がありません。</p>';
  return `<div class="detail-hero" aria-label="サンプルの風景イラスト"><span>旅のひとこま · SAMPLE</span></div><div class="detail-date"><span>${r.date.replaceAll('-','.')} · ${esc(r.time)}</span><span>${esc(r.category)}</span></div><h2 class="detail-title">${esc(r.title)}</h2><p class="detail-memo">${esc(r.memo)}</p>${state.audience==='owner'?`<p class="subtle">支出 ${yen(r.amount)} · ${r.published?'公開中':'非公開'}</p>`:''}<div class="detail-actions"><button class="secondary" data-action="prev-record">← 前</button><button class="secondary" data-action="next-record">次 →</button>${state.audience==='owner'?`<button class="secondary" data-action="share">公開設定</button><button class="secondary" data-action="add">${icon('add')}記録する</button>`:''}</div><button class="secondary" style="margin-top:14px" data-action="records">記録一覧へ</button>`;
}
function formContent(){
  const center=map.getCenter();
  return `<form id="demo-form" class="form-grid"><p class="subtle">この比較画面の中だけに保存されます。</p><label>記録のタイトル<input name="title" required maxlength="80" placeholder="例：海辺でひと休み"></label><div class="inline"><label>日付<input type="date" name="date" value="2026-05-19" required></label><label>時刻<input type="time" name="time" value="16:00" required></label></div><label>分類<select name="category"><option>散歩</option><option>食事</option><option>休憩</option></select></label><label>メモ<textarea name="memo" rows="3" maxlength="800" placeholder="その場所で見つけたこと"></textarea></label><label>支出（円・任意）<input name="amount" type="number" min="0" step="1" placeholder="空欄でも保存できます"></label><div class="inline"><label>緯度<input type="number" step="any" min="-90" max="90" name="lat" required value="${center.lat.toFixed(5)}"></label><label>経度<input type="number" step="any" min="-180" max="180" name="lng" required value="${center.lng.toFixed(5)}"></label></div><p class="subtle">地図の中心を初期位置にしています。</p><div class="form-footer"><p id="form-error" class="form-error" role="alert"></p><button class="primary" type="submit">記録を保存する</button></div></form>`;
}
function shareContent(){const r=selectedRecord();if(!r)return '<p>記録がありません。</p>';return `<p class="subtle">サンプル記録の公開設定</p><h2>${esc(r.title)}</h2><p class="detail-memo">${esc(r.memo)}</p><p>現在：${r.published?'公開中':'非公開'}</p><p class="subtle">実際のインターネットには公開されません。「公開用」の表示にだけ反映します。</p><button class="primary" data-action="toggle-public">${r.published?'非公開にする':'公開用に表示する'}</button>`;}
function openPanel(kind,{focus=true}={}){
  if(state.audience==='public'&&['money','add','share'].includes(kind))return;
  if(focus)lastFocus=document.activeElement;
  state.menu=false;state.panel=kind;panel.hidden=false;app.classList.add('panel-open');panel.dataset.kind=kind==='add'?'form':kind;
  const titles={records:['JOURNAL','旅の記録'],trip:['YOUR ITINERARY','旅をたどる'],money:['TRAVEL FINANCE','お金の記録'],add:['NEW MEMORY','記録する'],detail:['PLACE & MEMORY','この場所の記録'],share:['SHARING','公開設定']};
  const [kicker,title]=titles[kind];$('#panel-title').textContent=title;$('#panel-kicker').textContent=kicker;
  body.innerHTML=kind==='records'?`<p class="subtle">山陰の旅 · ${visibleRecords().length}件</p>${filterNote()}${recordRows()}`:kind==='trip'?`<p class="subtle">鳥取から城崎へ · 4日間の記録</p>${filterNote()}${recordRows(true)}`:kind==='money'?moneyContent():kind==='add'?formContent():kind==='share'?shareContent():detailContent();
  body.scrollTop=0;
  if(kind==='add')$('#demo-form').addEventListener('submit',saveDemo);
  // Search input stays in place while results update.
  if(!chrome.querySelector('#map-search')||focus)renderChrome();
  if(focus)$('#close-panel').focus({preventScroll:true});
}
function closePanel(){panel.hidden=true;state.panel=null;state.menu=false;app.classList.remove('panel-open');renderChrome();if(lastFocus?.isConnected)lastFocus.focus({preventScroll:true});}
function openDetail(recordId){state.selected=recordId;updateSelectedMarkers();openPanel('detail');}
function moveRecord(direction){const rows=visibleRecords();if(!rows.length)return;const index=rows.findIndex(r=>r.id===state.selected);const next=rows[(Math.max(0,index)+direction+rows.length)%rows.length];state.selected=next.id;map.panTo([next.lat,next.lng],{animate:false});updateSelectedMarkers();openPanel('detail');}
function notify(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>{$('#toast').hidden=true;},4000);}
function saveDemo(event){
  event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));
  const amount=values.amount===''?0:Number(values.amount),lat=Number(values.lat),lng=Number(values.lng);
  if(!values.title.trim()||!Number.isSafeInteger(amount)||amount<0||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180){$('#form-error').textContent='タイトル・金額・位置を確認してください。';return;}
  const nextId=String(state.records.length+1).padStart(2,'0');
  state.records.push({id:nextId,date:values.date,time:values.time,title:values.title.trim(),memo:values.memo,category:values.category,area:'追加した場所',amount,lat,lng,published:false});
  state.day='all';state.category='すべて';state.query='';state.selected=nextId;
  renderMarkers();openPanel('detail');notify('サンプルの記録を保存しました');
}

function act(action){
  if(action==='menu'){state.menu=!state.menu;if(state.menu){panel.hidden=true;state.panel=null;app.classList.remove('panel-open');}renderChrome();return;}
  if(['records','trip','money','add','share'].includes(action)){if(state.panel===action)closePanel();else openPanel(action);return;}
  if(action==='all'){fitMap();state.menu=false;renderChrome();return;}
  if(action==='search'){state.query=chrome.querySelector('#map-search')?.value||'';renderMarkers();openPanel('records',{focus:false});return;}
  if(action==='timeline'){state.timeline=!state.timeline;renderChrome();return;}
  if(action==='prev-record'||action==='next-record'){moveRecord(action==='next-record'?1:-1);return;}
  if(action==='clear-filter'){state.query='';state.category='すべて';state.day='all';renderMarkers();renderChrome();openPanel('records');return;}
  if(action==='toggle-public'){const r=selectedRecord();if(r){r.published=!r.published;openPanel('share');notify(r.published?'公開用のサンプルに反映しました':'サンプルを非公開にしました');}return;}
}
app.addEventListener('click',event=>{
  const action=event.target.closest('[data-action]');if(action){act(action.dataset.action);return;}
  const row=event.target.closest('[data-record]');if(row){const record=state.records.find(r=>r.id===row.dataset.record);map.panTo([record.lat,record.lng],{animate:false});openDetail(record.id);return;}
  const category=event.target.closest('[data-category]');if(category){state.category=category.dataset.category;renderMarkers();renderChrome();openPanel('records');return;}
  const day=event.target.closest('[data-day]');if(day){state.day=day.dataset.day;renderMarkers();renderChrome();if(state.panel)openPanel(state.panel);return;}
});
$('#close-panel').onclick=closePanel;
$('#fit-map').onclick=fitMap;$('#zoom-in').onclick=()=>map.zoomIn();$('#zoom-out').onclick=()=>map.zoomOut();
map.on('click',()=>{if(state.menu){state.menu=false;renderChrome();}});

function setDesign(value){
  state.variant=value;$('#variant').value=String(value);state.menu=false;map.closePopup();
  // Only navigation geometry changes. The map instance, center, zoom, filters and selection survive.
  const previousKind=state.panel;renderChrome();if(previousKind)openPanel(previousKind,{focus:false});
  const url=new URL(location.href);url.searchParams.set('v',String(value));history.replaceState(null,'',url);
  requestAnimationFrame(()=>map.invalidateSize({pan:false}));
}
for(const design of designs)$('#variant').append(new Option(`${String(design.id).padStart(2,'0')}  ${design.name}`,String(design.id)));
$('#variant').onchange=event=>setDesign(Number(event.target.value));
$('#previous').onclick=()=>setDesign((state.variant+8)%10+1);$('#next').onclick=()=>setDesign(state.variant%10+1);
$('#audience').onchange=event=>{
  state.audience=event.target.value;closePanel();renderMarkers();renderChrome();
  if(!visibleRecords().some(r=>r.id===state.selected))state.selected=visibleRecords()[0]?.id||null;
  updateSelectedMarkers();
};

let resizeFrame;
function resize(){
  cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{
    const frame=$('#frame'),phone=frame.clientWidth<=600;
    app.classList.toggle('phone',phone);
    const editing=!!document.activeElement?.closest('#demo-form');
    app.classList.toggle('keyboard-open',phone&&editing&&app.clientHeight<460);
    map.invalidateSize({pan:false});
    if(!hasFitted){fitMap();hasFitted=true;}
  });
}
$('#device').onchange=event=>{$('#frame').className='preview-frame '+(event.target.value==='auto'?'':event.target.value);resize();};
new ResizeObserver(resize).observe($('#frame'));
if(window.visualViewport)window.visualViewport.addEventListener('resize',()=>{document.body.style.height=Math.floor(window.visualViewport.height)+'px';resize();});
app.addEventListener('focusin',resize);app.addEventListener('focusout',resize);

$('#reference-button').onclick=()=>{
  const design=designs[state.variant-1],ref=references[design.ref];
  $('#reference-title').textContent=`${String(design.id).padStart(2,'0')} ${design.name} / ${ref.name}`;
  $('#reference-description').textContent=design.description+' '+ref.note;
  $('#reference-image').src='references/'+ref.image;$('#reference-image').alt=ref.name+'の実画面';
  $('#reference-caption').textContent=`${ref.name} · 2026-09-09取得 · ローカルでのUI検討用`;
  $('#reference-link').href=ref.url;$('#reference-link').textContent=ref.name+'を開く ↗';$('#reference-dialog').showModal();
};
$('#close-reference').onclick=()=>$('#reference-dialog').close();
$('#overview-button').onclick=()=>{
  $('#overview').innerHTML=designs.map(d=>`<button class="overview-card ${d.id===state.variant?'selected':''}" data-design-choice="${d.id}"><span class="number">${String(d.id).padStart(2,'0')} / ${d.en}</span><div class="mini-layout ${d.shape}"></div><strong>${d.name}</strong><small>${d.lead}</small></button>`).join('');$('#overview-dialog').showModal();
};
$('#overview').onclick=event=>{const button=event.target.closest('[data-design-choice]');if(button){setDesign(Number(button.dataset.designChoice));$('#overview-dialog').close();}};
$('#close-overview').onclick=()=>$('#overview-dialog').close();
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]')){if(state.panel)closePanel();else if(state.menu){state.menu=false;renderChrome();}}});
renderChrome();renderMarkers();setDesign(state.variant);resize();
