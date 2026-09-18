import {el, makeMap, pin, yen} from './shared.js';
import {mapShell} from './map-shell.js';
const status=document.querySelector('#message'), list=document.querySelector('#entries');
const filters=el('div',{className:'filters'});
const tripSelect=el('select',{id:'trip-filter'}),catSelect=el('select',{id:'cat-filter'}),fromInput=el('input',{type:'date'}),toInput=el('input',{type:'date'});
const totals=el('p',{className:'totals'});
const reset=el('button',{type:'button',className:'reset',textContent:'全期間に戻す'});
for(const [label,node] of [['旅',tripSelect],['カテゴリ',catSelect],['開始',fromInput],['終了',toInput]]){const wrap=el('label');wrap.append(el('span',{textContent:label}),node);filters.append(wrap);}
filters.append(reset,totals);
const shell=mapShell([{id:'records',label:'記録',icon:'▤',nodes:[filters,list]}]);
const map=makeMap();
new ResizeObserver(()=>map.invalidateSize({pan:false})).observe(document.querySelector('#map'));
const PIN_ZOOM=11;
const layers=L.layerGroup().addTo(map),pins=L.layerGroup().addTo(map);
let shown=[];
function fit(){const points=shown.filter(e=>e.latitude!=null).map(e=>[e.latitude,e.longitude]);if(points.length)map.fitBounds(points,{padding:[60,90],maxZoom:13});}
shell.fit.onclick=fit;
// 古い記録ほど淡く、新しいほど濃いオレンジ（旧TravelMapと同じ考え方）
const shade=value=>{const t=Math.min(1,Math.max(0,value));return `rgb(${Math.round(255-25*t)},${Math.round(224-143*t)},${Math.round(178-178*t)})`;};
const stamp=entry=>Date.parse(entry.date);
const day=text=>new Date(text+'T00:00:00+09:00').toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'});
function draw(){
  layers.clearLayers();pins.clearLayers();
  const located=shown.filter(entry=>entry.latitude!=null&&entry.longitude!=null).slice().reverse();
  const first=located.length?stamp(located[0]):0,span=Math.max(1,(located.at(-1)?stamp(located.at(-1)):0)-first);
  const ratio=index=>(stamp(located[index])-first)/span;
  const points=located.map(entry=>[entry.latitude,entry.longitude]);
  if(points.length>1){
    L.polyline(points,{color:'#3a2a1a',weight:5,opacity:.18,interactive:false}).addTo(layers);
    for(let index=1;index<points.length;index++)
      L.polyline([points[index-1],points[index]],{color:shade((ratio(index-1)+ratio(index))/2),weight:3,opacity:.95,lineCap:'round',interactive:false}).addTo(layers);
  }
  if(points.length){
    const ends=points.length>1?[[points[0],`始点 ${day(located[0].date)}`],[points.at(-1),`終点 ${day(located.at(-1).date)}`]]:[[points[0],day(located[0].date)]];
    for(const [point,label] of ends)
      L.marker(point,{icon:L.divIcon({className:'route-label',html:`<span>${label}</span>`,iconSize:null}),interactive:false,keyboard:false}).addTo(layers);
  }
  located.forEach((entry,index)=>{
    const marker=pin(map,entry,()=>{shell.open('records');document.getElementById('entry-'+entry.id)?.scrollIntoView({block:'start'});});
    marker.setStyle({radius:5,weight:1,color:'#fff',fillColor:shade(ratio(index)),fillOpacity:1});
    map.removeLayer(marker);pins.addLayer(marker);
  });
  togglePins();
}
// 広域では線だけ。拡大したときだけ点を出してタップできるようにする
function togglePins(){if(map.getZoom()>=PIN_ZOOM){pins.addTo(map);pins.eachLayer(layer=>layer.bringToFront());}else map.removeLayer(pins);}
map.on('zoomend',togglePins);
function card(entry){
  const article=el('article',{className:'card',id:'entry-'+entry.id});
  article.append(el('p',{className:'eyebrow',textContent:[entry.date,entry.category_name,entry.trip_name].filter(Boolean).join('・')}),
    el('h2',{textContent:entry.place_name || '旅のひとこま'}));
  if(entry.spent_jpy!=null)article.append(el('p',{className:'spent',textContent:yen(entry.spent_jpy)}));
  article.append(el('p',{className:'memo',textContent:entry.memo}));
  for(const photo of entry.photos)article.append(el('img',{src:photo.url,alt:photo.caption || '旅の写真',loading:'lazy'}));
  return article;
}
try {
  const authorMatch=location.pathname.match(/^\/u\/([a-z0-9-]+)/);const author=authorMatch?.[1]??null;
  if(author){
    try{const p=await(await fetch('/api/public/users/'+author)).json();if(p.handle){
      const head=el('div',{className:'author'});if(p.avatar_url)head.append(el('img',{src:p.avatar_url,alt:''}));
      const info=el('div');info.append(el('strong',{textContent:p.display_name}),el('span',{textContent:` @${p.handle} · 公開 ${p.entries}件${p.first_date?` · ${p.first_date}〜${p.last_date}`:''}`}));
      if(p.bio)info.append(el('p',{textContent:p.bio}));
      if(p.tip_url)info.append(el('a',{href:p.tip_url,target:'_blank',rel:'noopener',textContent:'投げ銭で応援する ↗',className:'tip'}));
      head.append(info);filters.before(head);document.title=`${p.display_name}の旅 | TravelMap`;}}catch{}
  }
  const response=await fetch('/api/public/entries'+(author?'?u='+encodeURIComponent(author):''));
  if (!response.ok) throw new Error('記録を読み込めませんでした。');
  const {entries}=await response.json();
  const dates=entries.map(entry=>entry.date).sort();
  const trips=[...new Set(entries.filter(entry=>entry.trip_name).map(entry=>entry.trip_name))];
  tripSelect.append(new Option('すべての記録',''));
  for(const name of trips)tripSelect.append(new Option(name,name));
  if(!trips.length)tripSelect.closest('label').hidden=true;
  catSelect.append(new Option('すべて',''));
  for(const name of [...new Set(entries.map(entry=>entry.category_name).filter(Boolean))])catSelect.append(new Option(name,name));
  const range=()=>{fromInput.value=dates[0]??'';toInput.value=dates.at(-1)??'';};
  fromInput.min=toInput.min=dates[0]??'';fromInput.max=toInput.max=dates.at(-1)??'';
  range();
  function apply(){
    shown=entries.filter(entry=>(!tripSelect.value||entry.trip_name===tripSelect.value)&&(!catSelect.value||entry.category_name===catSelect.value)
      &&(!fromInput.value||entry.date>=fromInput.value)&&(!toInput.value||entry.date<=toInput.value));
    const spent=shown.reduce((sum,entry)=>sum+(entry.spent_jpy??0),0),paid=shown.filter(entry=>entry.spent_jpy!=null).length;
    totals.textContent=paid?`この条件の支出 ${yen(spent)}（${paid}件）`:'この条件に支出はありません';
    list.replaceChildren(...shown.map(card));
    shell.count.textContent=`公開記録 ${shown.length}件`;
    status.textContent=shown.length?`${shown.length}件の旅の記録`:'この条件の記録はありません。';
    draw();fit();
  }
  tripSelect.onchange=()=>{
    const dated=entries.filter(entry=>!tripSelect.value||entry.trip_name===tripSelect.value).map(entry=>entry.date).sort();
    fromInput.value=dated[0]??'';toInput.value=dated.at(-1)??'';apply();
  };
  fromInput.onchange=toInput.onchange=catSelect.onchange=apply;
  reset.onclick=()=>{tripSelect.value='';catSelect.value='';range();apply();};
  if(!entries.length){status.textContent='公開された記録はまだありません。';shell.count.textContent='公開記録 0件';}
  else apply();
} catch(error) { status.textContent=error.message; }
