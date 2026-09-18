import {el, whoMarker, yen, ago, statusLine} from './shared.js';
import {gl} from './owner-map.js';
// みんなの公開記録: 旅モード中の人の一覧・タイムライン(絞り込み)・地図の線とアイコン。データは公開フィードだけ(非公開データは扱わない)
const HUES=[24,265,330,205,95,48,0,168];
const day=text=>new Date(text+'T00:00:00+09:00').toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'});
export {ago};
// 表示する期間。既定は「この1週間」(今日を含む過去7日、JST)。選んだプリセットは端末に覚える
const PERIODS=[['7','1週間'],['30','1か月'],['90','3か月'],['all','全期間']],PERIOD_LABEL={7:'この1週間',30:'この1か月',90:'この3か月',all:'全期間',custom:'この期間'};
const jstToday=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
const daysBefore=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);
export function makeEveryone(map,shell,{peopleNode,timelineNode,showToggle,onFilter,onOpenPerson}){
  let people=[],everyone=[],markers=new Map(),styleReady=false,self=null,entries=[],shown=[],on=true,loaded=false,period='7',preset='7';
  try{const saved=localStorage.getItem('travelmap.period');if(PERIODS.some(([key])=>key===saved))period=preset=saved;}catch{}
  if(showToggle)try{on=localStorage.getItem('travelmap.friends')!=='off';}catch{}
  const toggle=el('button',{className:'friends-toggle',type:'button',textContent:'みんな',hidden:!showToggle});shell.stage.append(toggle);
  const note=el('span',{className:'friends-count'});shell.count.after(note);
  const periodSelect=el('select',{id:'period-filter'}),chip=el('select',{className:'period-chip'});chip.setAttribute('aria-label','表示する期間');note.after(chip);
  for(const node of [periodSelect,chip]){for(const [key,label] of PERIODS)node.append(new Option(node===chip?PERIOD_LABEL[key]:label,key));node.append(new Option(node===chip?'期間指定…':'日付を指定','custom'));}
  const popup=new gl.Popup({maxWidth:'280px',offset:24});
  // タイムラインの絞り込み
  const filters=el('div',{className:'filters'}),personSelect=el('select',{id:'person-filter'}),tripSelect=el('select',{id:'public-trip-filter'}),catSelect=el('select',{id:'cat-filter'}),fromInput=el('input',{type:'date'}),toInput=el('input',{type:'date'});
  const totals=el('p',{className:'totals'}),reset=el('button',{type:'button',className:'reset',textContent:'全期間に戻す'}),legend=el('div',{className:'legend'}),list=el('div',{className:'cards',id:'entries'}),more=el('button',{type:'button',textContent:'さらに表示',hidden:true});
  for(const [label,node] of [['期間',periodSelect],['人',personSelect],['旅',tripSelect],['カテゴリ',catSelect],['開始',fromInput],['終了',toInput]]){const wrap=el('label');wrap.append(el('span',{textContent:label}),node);filters.append(wrap);}
  filters.append(reset,totals,legend);timelineNode.append(filters,list,more);
  const hueOf=author=>HUES[Math.max(0,everyone.indexOf(author))%HUES.length];
  const lines=()=>{
    const stamps=people.flatMap(p=>p.rows.map(r=>Date.parse(r.date))),first=stamps.length?Math.min(...stamps):0,span=Math.max(1,Math.max(...stamps)-first),features=[];
    for(const p of people)for(let i=1;i<p.rows.length;i++){const t=((Date.parse(p.rows[i-1].date)+Date.parse(p.rows[i].date))/2-first)/span;
      features.push({type:'Feature',geometry:{type:'LineString',coordinates:[[p.rows[i-1].longitude,p.rows[i-1].latitude],[p.rows[i].longitude,p.rows[i].latitude]]},properties:{color:`hsl(${p.hue} ${55+30*t}% ${62-24*t}%)`,opacity:+(.15+.8*t).toFixed(3)}});}
    return {type:'FeatureCollection',features};
  };
  let override=null;// リプレイ中は外から線のデータを差し替える
  function draw(){
    if(!styleReady)return;
    const data=override||(on?lines():{type:'FeatureCollection',features:[]});
    if(map.getSource('friends-segments'))map.getSource('friends-segments').setData(data);else map.addSource('friends-segments',{type:'geojson',data});
    if(!map.getLayer('friends-line'))map.addLayer({id:'friends-line',type:'line',source:'friends-segments',paint:{'line-color':['get','color'],'line-width':self?1.5:2.5,'line-opacity':['get','opacity']},layout:{'line-cap':'round'}},map.getLayer('travel-line')?'travel-line':undefined);
  }
  function detail(p){
    const node=el('div',{className:'friend-detail'});node.append(el('strong',{textContent:p.name}));
    const status=statusLine(p.recent.at(-1).author_status,p.recent.at(-1).author_status_at);if(status)node.append(el('p',{className:'friend-status',textContent:status}));
    if(p.stale)node.append(el('p',{className:'hint',textContent:'この期間の記録はありません。最後の記録: '+ago(p.recent.at(-1))}));
    for(const r of p.recent.slice(-4).reverse()){const item=el('div',{className:'friend-entry'});item.append(el('time',{textContent:[r.date,r.category_name].filter(Boolean).join('・')}),el('b',{textContent:r.place_name||'旅のひとこま'}));
      if(r.spent_jpy!=null)item.append(el('span',{className:'spent',textContent:yen(r.spent_jpy)}));if(r.memo)item.append(el('p',{textContent:r.memo}));node.append(item);}
    const last=p.recent.at(-1);popup.setLngLat([last.longitude,last.latitude]).setDOMContent(node).addTo(map);
    if(p.author!==self)onOpenPerson?.(p.author);
  }
  function show(){
    markers.forEach(m=>m.remove());markers.clear();popup.remove();
    if(on)for(const p of people){const last=p.last,button=el('button',{type:'button',className:'who-button friend-marker'});button.dataset.handle=p.author;
      button.append(whoMarker({image:last.author_icon_url,icon:last.author_icon,avatar:last.author_avatar,name:p.name,caption:p.name+' '+day(last.date),status:statusLine(last.author_status,last.author_status_at)||[last.category_name,ago(last)].filter(Boolean).join(' · '),color:`hsl(${p.hue} 70% 35%)`}));button.onclick=event=>{event.stopPropagation();detail(p);};
      const pinEl=el('div',{className:p.stale?'who-pin stale':'who-pin'});pinEl.append(button);// 外側は素の要素(all:unset のボタンを直接渡すと位置がずれる)
      markers.set(p.author,new gl.Marker({element:pinEl,anchor:'center'}).setLngLat([last.longitude,last.latitude]).addTo(map));}
    toggle.setAttribute('aria-pressed',String(on));note.textContent=on&&people.length?` · みんな ${people.length}人`:'';draw();
  }
  const located=rows=>rows.filter(e=>e.latitude!=null&&e.longitude!=null).reverse().sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
  // 地図に描く人(自分以外。自分の線は自分用の経路が描く)。期間内に記録が無い人は線を出さず、最新地点のマーカーだけ薄く出す(旅・カテゴリで絞り込んでいる間は出さない)
  function group(){
    const authors=everyone.filter(author=>author!==self&&(!personSelect.value||personSelect.value===author)),ghosts=!tripSelect.value&&!catSelect.value;
    people=authors.map(author=>{const rows=located(shown.filter(e=>e.author===author)),all=rows.length||!ghosts?rows:located(entries.filter(e=>e.author===author));
      return all.length?{author,name:all.at(-1).author_name||author,hue:hueOf(author),rows,recent:all,last:all.at(-1),stale:!rows.length}:null;}).filter(Boolean);show();
  }
  function card(entry){
    const article=el('article',{className:'card',id:'entry-'+entry.id});
    article.append(el('p',{className:'eyebrow',textContent:[entry.date,entry.author_name,entry.category_name,entry.trip_name].filter(Boolean).join('・')}),el('h2',{textContent:entry.place_name||'旅のひとこま'}));
    if(entry.spent_jpy!=null)article.append(el('p',{className:'spent',textContent:yen(entry.spent_jpy)}));
    article.append(el('p',{className:'memo',textContent:entry.memo}));
    for(const photo of entry.photos)article.append(el('img',{src:photo.url,alt:photo.caption||'旅の写真',loading:'lazy'}));
    if(entry.latitude!=null){const go=el('button',{type:'button',className:'card-go',textContent:'地図で見る'});go.onclick=()=>{if(innerWidth<=700)shell.hide();map.flyTo({center:[entry.longitude,entry.latitude],zoom:Math.max(map.getZoom(),12)});};article.append(go);}
    return article;
  }
  let listed=0;
  function renderList(){const next=shown.slice(listed,listed+60);list.append(...next.map(card));listed+=next.length;more.hidden=listed>=shown.length;}
  more.onclick=renderList;
  const state=()=>({person:personSelect.value,trip:tripSelect.value,category:catSelect.value,from:fromInput.value,to:toInput.value,period,active:!!(personSelect.value||tripSelect.value||catSelect.value||fromInput.value||toInput.value)});
  const within=entry=>(!fromInput.value||entry.date>=fromInput.value)&&(!toInput.value||entry.date<=toInput.value);
  // 件数の表示: 「この1週間 n件 / 全 m件」。期間以外でも絞っていれば「この条件」
  const countText=(n,m)=>!state().active?`全 ${m}件`:`${personSelect.value||tripSelect.value||catSelect.value?'この条件':PERIOD_LABEL[period]} ${n}件 / 全 ${m}件`;
  function setPeriod(next,save=true){period=next;if(next!=='custom'){preset=next;const today=jstToday();fromInput.value=next==='all'?'':daysBefore(today,Number(next)-1);toInput.value=next==='all'?'':today;if(save)try{localStorage.setItem('travelmap.period',next);}catch{}}periodSelect.value=chip.value=next;}
  function apply(notify=true){
    shown=entries.filter(entry=>(!personSelect.value||entry.author===personSelect.value)&&(!tripSelect.value||entry.trip_name===tripSelect.value)&&(!catSelect.value||entry.category_name===catSelect.value)&&within(entry));
    const spent=shown.reduce((sum,entry)=>sum+(entry.spent_jpy??0),0),paid=shown.filter(entry=>entry.spent_jpy!=null).length;
    totals.textContent=(shown.length?`${shown.length}件 · `:'')+(paid?`この条件の支出 ${yen(spent)}（${paid}件）`:shown.length?'この条件に支出はありません':'この条件の記録はありません。'+(entries.length&&period!=='all'?'期間を広げると表示されます。':''));
    list.replaceChildren();listed=0;renderList();
    if(!self)shell.count.textContent='公開記録 '+countText(shown.length,entries.length);
    group();renderPeople();if(notify)onFilter?.(state());
  }
  function renderPeople(){
    peopleNode.replaceChildren();
    if(!loaded){peopleNode.append(el('p',{className:'hint',textContent:'読み込み中…'}));return;}
    if(!everyone.length){peopleNode.append(el('p',{className:'empty-note',textContent:'いま旅に出ている人はいません'}),el('p',{className:'hint',textContent:'旅モードをオンにした人が、ここと地図に表示されます。'}));return;}
    const rows=everyone.map(author=>{const mine=entries.filter(e=>e.author===author);return {author,latest:mine[0],all:mine,rows:located(mine)};}).sort((a,b)=>(b.latest.at||b.latest.date)<(a.latest.at||a.latest.date)?-1:1);
    for(const person of rows){
      const last=person.latest,button=el('button',{type:'button',className:'person-row'});button.dataset.handle=person.author;
      const face=whoMarker({image:last.author_icon_url,icon:last.author_icon,avatar:last.author_avatar,name:last.author_name,color:`hsl(${hueOf(person.author)} 70% 35%)`});
      const text=el('span',{className:'person-text'});const fresh=person.all.some(within),status=statusLine(last.author_status,last.author_status_at);button.classList.toggle('stale',!fresh);
      text.append(el('strong',{textContent:(last.author_name||person.author)+(person.author===self?'（あなた）':'')}));if(status)text.append(el('span',{className:'person-status',textContent:status}));
      text.append(el('span',{textContent:fresh?[last.place_name||'旅のひとこま',ago(last)].join(' · '):'最後の記録: '+[ago(last),last.place_name].filter(Boolean).join(' · ')}));
      button.append(face,text);
      button.onclick=()=>{
        const spot=person.rows.at(-1);
        if(personSelect.value&&personSelect.value!==person.author){personSelect.value='';apply();}
        if(!on&&person.author!==self){on=true;show();}
        if(innerWidth<=700)shell.hide();
        if(spot){map.flyTo({center:[spot.longitude,spot.latitude],zoom:Math.max(map.getZoom(),10)});detail({author:person.author,name:last.author_name||person.author,rows:person.rows,recent:person.rows,stale:!person.all.some(within)});}
        else{personSelect.value=person.author;apply();shell.open('timeline');}
      };
      peopleNode.append(button);
    }
  }
  function setup(){
    const trips=[...new Set(entries.filter(entry=>entry.trip_name).map(entry=>entry.trip_name))];
    everyone=[...new Set(entries.map(entry=>entry.author))].sort();
    personSelect.replaceChildren(new Option('みんな',''));legend.replaceChildren();
    for(const author of everyone){const name=entries.find(entry=>entry.author===author).author_name;personSelect.append(new Option(name,author));const chip=el('span',{className:'who',textContent:name});chip.style.setProperty('--c',`hsl(${hueOf(author)} 70% 40%)`);legend.append(chip);}
    tripSelect.replaceChildren(new Option('すべての記録',''));for(const name of trips)tripSelect.append(new Option(name,name));tripSelect.closest('label').hidden=!trips.length;
    catSelect.replaceChildren(new Option('すべて',''));for(const name of [...new Set(entries.map(entry=>entry.category_name).filter(Boolean))])catSelect.append(new Option(name,name));
    setPeriod(period,false);
  }
  tripSelect.onchange=()=>{if(tripSelect.value){const dated=entries.filter(entry=>entry.trip_name===tripSelect.value).map(entry=>entry.date).sort();setPeriod('custom');fromInput.value=dated[0]??'';toInput.value=dated.at(-1)??'';}else setPeriod(preset);apply();};
  catSelect.onchange=personSelect.onchange=()=>apply();fromInput.onchange=toInput.onchange=()=>{setPeriod('custom');apply();};
  periodSelect.onchange=chip.onchange=event=>{const next=event.target.value;setPeriod(next);if(next==='custom')shell.open('timeline');else apply();};
  reset.onclick=()=>{personSelect.value='';tripSelect.value='';catSelect.value='';setPeriod('all');apply();};
  toggle.onclick=()=>{on=!on;try{localStorage.setItem('travelmap.friends',on?'on':'off');}catch{}show();};
  map.on('basemapchanging',()=>{styleReady=false;});
  map.on('style.load',()=>{styleReady=true;draw();});
  const ready=(async()=>{try{const response=await fetch('/api/public/entries');if(!response.ok)throw new Error('記録を読み込めませんでした。');entries=(await response.json()).entries||[];}catch(error){totals.textContent=error.message;}loaded=true;setup();apply(false);renderPeople();})();
  renderPeople();show();
  return {ready,setSelf:handle=>{self=handle;if(loaded){group();renderPeople();}},reload:async()=>{try{const response=await fetch('/api/public/entries');if(response.ok){entries=(await response.json()).entries||[];const keep=state();setup();if(keep.period==='custom'){setPeriod('custom');fromInput.value=keep.from;toInput.value=keep.to;}personSelect.value=keep.person;if(personSelect.value!==keep.person)personSelect.value='';apply(false);renderPeople();}}catch{}},
    points:()=>on?people.flatMap(p=>(p.rows.length?p.rows:[p.last]).map(r=>[r.longitude,r.latitude])):[],count:()=>everyone.length,shownCount:()=>shown.length,countText,filter:state,
    tracks:()=>on?people.filter(p=>p.rows.length).map(p=>({id:p.author,color:`hsl(${p.hue} 70% 40%)`,points:p.rows.map(r=>({lng:r.longitude,lat:r.latitude,t:Date.parse(r.at||r.date+'T12:00:00+09:00')})),marker:markers.get(p.author)})):[],
    setReplay:value=>{override=value?{type:'FeatureCollection',features:[]}:null;popup.remove();if(value)draw();else show();},marker:author=>markers.get(author)};
}
