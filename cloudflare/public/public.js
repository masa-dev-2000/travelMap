import {el, makeMap, pin, whoMarker, yen} from './shared.js';
import {mapShell} from './map-shell.js';
const status=document.querySelector('#message'), list=document.querySelector('#entries');
const filters=el('div',{className:'filters'});
const personSelect=el('select',{id:'person-filter'}),tripSelect=el('select',{id:'trip-filter'}),catSelect=el('select',{id:'cat-filter'}),fromInput=el('input',{type:'date'}),toInput=el('input',{type:'date'});
const totals=el('p',{className:'totals'});
const reset=el('button',{type:'button',className:'reset',textContent:'全期間に戻す'});
const legend=el('div',{className:'legend'});
for(const [label,node] of [['人',personSelect],['旅',tripSelect],['カテゴリ',catSelect],['開始',fromInput],['終了',toInput]]){const wrap=el('label');wrap.append(el('span',{textContent:label}),node);filters.append(wrap);}
filters.append(reset,totals,legend);
const shell=mapShell([{id:'records',label:'記録',icon:'▤',nodes:[filters,list]}]);
const map=makeMap();window.__tmMap=map;// マーカー位置の数値検証用(コンソールから project と比較する)
new ResizeObserver(()=>map.invalidateSize({pan:false})).observe(document.querySelector('#map'));
const PIN_ZOOM=11;
const layers=L.layerGroup().addTo(map),pins=L.layerGroup().addTo(map);
let shown=[];
function fit(){const points=shown.filter(e=>e.latitude!=null).map(e=>[e.latitude,e.longitude]);if(points.length)map.fitBounds(points,{padding:[60,90],maxZoom:13});}
shell.fit.onclick=fit;
// 人ごとに色相を割り当て、古い記録ほど淡く・新しいほど濃くする
const HUES=[24,168,265,330,205,95,48,0];let authors=[];
const hueOf=author=>HUES[Math.max(0,authors.indexOf(author))%HUES.length];
const shade=(value,author)=>{const t=Math.min(1,Math.max(0,value));return `hsl(${hueOf(author)} ${55+30*t}% ${78-38*t}%)`;};
const stamp=entry=>Date.parse(entry.date);
const day=text=>new Date(text+'T00:00:00+09:00').toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'});
function draw(){
  layers.clearLayers();pins.clearLayers();
  // 人ごとに別々の軌跡を描く。色の濃さは表示中の全期間に対する新しさ
  const all=shown.filter(entry=>entry.latitude!=null&&entry.longitude!=null);
  const stamps=all.map(stamp),first=Math.min(...stamps),span=Math.max(1,Math.max(...stamps)-first);
  const ratio=entry=>(stamp(entry)-first)/span;
  for(const author of authors){
    const located=all.filter(entry=>entry.author===author).slice().reverse();
    if(!located.length)continue;
    const points=located.map(entry=>[entry.latitude,entry.longitude]);
    if(points.length>1){
      L.polyline(points,{color:'#2a2a2a',weight:5,opacity:.06,interactive:false}).addTo(layers);
      for(let index=1;index<points.length;index++){const t=(ratio(located[index-1])+ratio(located[index]))/2;
        L.polyline([points[index-1],points[index]],{color:shade(t,author),weight:2+2*t,opacity:.15+.8*t,lineCap:'round',interactive:false}).addTo(layers);}
    }
    const last=located.at(-1);
    L.marker(points.at(-1),{icon:L.divIcon({className:'who-anchor',html:whoMarker({image:last.author_icon_url,icon:last.author_icon,avatar:last.author_avatar,name:last.author_name,caption:last.author_name+' '+day(last.date),color:`hsl(${hueOf(author)} 70% 35%)`}),iconSize:null}),interactive:false,keyboard:false,zIndexOffset:1000}).addTo(layers);
    for(const entry of located){
      const marker=pin(map,entry,()=>{shell.open('records');document.getElementById('entry-'+entry.id)?.scrollIntoView({block:'start'});});
      marker.setStyle({radius:5,weight:1,color:'#fff',fillColor:shade(ratio(entry),author),fillOpacity:.35+.65*ratio(entry),opacity:.35+.65*ratio(entry)});
      map.removeLayer(marker);pins.addLayer(marker);
    }
  }
  togglePins();
}
// 広域では線だけ。拡大したときだけ点を出してタップできるようにする
function togglePins(){if(map.getZoom()>=PIN_ZOOM){pins.addTo(map);pins.eachLayer(layer=>layer.bringToFront());}else map.removeLayer(pins);}
map.on('zoomend',togglePins);
function card(entry){
  const article=el('article',{className:'card',id:'entry-'+entry.id});
  article.append(el('p',{className:'eyebrow',textContent:[entry.date,entry.author_name,entry.category_name,entry.trip_name].filter(Boolean).join('・')}),
    el('h2',{textContent:entry.place_name || '旅のひとこま'}));
  if(entry.spent_jpy!=null)article.append(el('p',{className:'spent',textContent:yen(entry.spent_jpy)}));
  article.append(el('p',{className:'memo',textContent:entry.memo}));
  for(const photo of entry.photos)article.append(el('img',{src:photo.url,alt:photo.caption || '旅の写真',loading:'lazy'}));
  return article;
}
try {
  const response=await fetch('/api/public/entries');
  if (!response.ok) throw new Error('記録を読み込めませんでした。');
  const {entries}=await response.json();
  const dates=entries.map(entry=>entry.date).sort();
  const trips=[...new Set(entries.filter(entry=>entry.trip_name).map(entry=>entry.trip_name))];
  authors=[...new Set(entries.map(entry=>entry.author))];
  personSelect.append(new Option('みんな',''));
  for(const author of authors){const name=entries.find(entry=>entry.author===author).author_name;personSelect.append(new Option(name,author));
    const chip=el('span',{className:'who',textContent:name});chip.style.setProperty('--c',`hsl(${hueOf(author)} 70% 40%)`);legend.append(chip);}
  if(authors.length<2)personSelect.closest('label').hidden=true;
  tripSelect.append(new Option('すべての記録',''));
  for(const name of trips)tripSelect.append(new Option(name,name));
  if(!trips.length)tripSelect.closest('label').hidden=true;
  catSelect.append(new Option('すべて',''));
  for(const name of [...new Set(entries.map(entry=>entry.category_name).filter(Boolean))])catSelect.append(new Option(name,name));
  const range=()=>{fromInput.value=dates[0]??'';toInput.value=dates.at(-1)??'';};
  fromInput.min=toInput.min=dates[0]??'';fromInput.max=toInput.max=dates.at(-1)??'';
  range();
  function apply(){
    shown=entries.filter(entry=>(!personSelect.value||entry.author===personSelect.value)&&(!tripSelect.value||entry.trip_name===tripSelect.value)&&(!catSelect.value||entry.category_name===catSelect.value)
      &&(!fromInput.value||entry.date>=fromInput.value)&&(!toInput.value||entry.date<=toInput.value));
    const spent=shown.reduce((sum,entry)=>sum+(entry.spent_jpy??0),0),paid=shown.filter(entry=>entry.spent_jpy!=null).length;
    totals.textContent=paid?`この条件の支出 ${yen(spent)}（${paid}件）`:'この条件に支出はありません';
    list.replaceChildren(...shown.map(card));
    shell.count.textContent=`公開記録 ${shown.length}件`;
    status.textContent=shown.length?`${authors.length}人・${shown.length}件の旅の記録`:'この条件の記録はありません。';
    draw();fit();
  }
  tripSelect.onchange=()=>{
    const dated=entries.filter(entry=>!tripSelect.value||entry.trip_name===tripSelect.value).map(entry=>entry.date).sort();
    fromInput.value=dated[0]??'';toInput.value=dated.at(-1)??'';apply();
  };
  fromInput.onchange=toInput.onchange=catSelect.onchange=personSelect.onchange=apply;
  reset.onclick=()=>{personSelect.value='';tripSelect.value='';catSelect.value='';range();apply();};
  if(!entries.length){status.textContent='いま旅を表示している人はいません。';shell.count.textContent='公開記録 0件';}
  else apply();
} catch(error) { status.textContent=error.message; }
