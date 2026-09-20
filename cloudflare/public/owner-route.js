import {el, whoMarker, ago, statusLine} from './shared.js';
import {gl} from './owner-map.js';
import {orderedRoute} from './route.js';
import {ownerPoint,locationPoint,combineOwnerPoints,sortPoints} from './record-display.js';
import {mapRecordCard} from './map-record-card.js';
const collection=features=>({type:'FeatureCollection',features});
const point=r=>[r.longitude,r.latitude];
const feature=(geometry,properties={})=>({type:'Feature',geometry,properties});
const shortDay=r=>new Date(r.occurred_at).toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'});
// マーカーの2行目: ステータス、無ければ「最後の記録のカテゴリ · 3時間前」
const under=(user,r)=>statusLine(user?.status,user?.status_at)||[r.category_name,ago({at:r.occurred_at,date:new Date(r.occurred_at).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'})})].filter(Boolean).join(' · ');
export function makeOwnerRoute(map,shell){
  let rows=[],index=null,callbacks=new Map(),endpoints=[],styleReady=false,user=null,replaying=false,ghost=null,range=[];
  const badge=el('button',{className:'route-overview',type:'button',textContent:'全ルート',hidden:true});document.querySelector('.map-stage').append(badge);
  const cards=mapRecordCard(map,shell);let samples=[];
  function sampleLines(){const groups=new Map();for(const p of sortPoints(samples.map(locationPoint))){if(!groups.has(p.segment))groups.set(p.segment,[]);groups.get(p.segment).push([p.lng,p.lat]);}return collection([...groups.values()].filter(coords=>coords.length>1).map(coords=>feature({type:'LineString',coordinates:coords})));}
  function sources(){
    // 鮮度: 時刻と順番の平均。古い区間ほど透明で細く、新しい区間ほど不透明で太い
    const first=Date.parse(rows[0]?.occurred_at),span=Math.max(1,Date.parse(rows.at(-1)?.occurred_at)-first),steps=Math.max(1,rows.length-2);
    const segments=rows.slice(1).map((r,i)=>{const t=Math.min(1,Math.max(0,((Date.parse(r.occurred_at)-first)/span+i/steps)/2))||0;return feature({type:'LineString',coordinates:[point(rows[i]),point(r)]},{index:i,opacity:+(.15+.8*t).toFixed(3),width:+(1.5+2*t).toFixed(2)});});
    const records=rows.filter(r=>r.category_name!=='移動').map(r=>feature({type:'Point',coordinates:point(r)},{id:r.id}));
    if(replaying)return {segments:collection([]),records:collection([]),selected:collection([]),ends:collection([]),samples:collection([])};// リプレイ中は元の線を隠す
    const selected=index!==null?[segments[index]]:range.length>1?[feature({type:'LineString',coordinates:range})]:[];
    const ends=index!==null?[rows[index],rows[index+1]].map(r=>feature({type:'Point',coordinates:point(r)})):range.length?[range[0],range.at(-1)].map(c=>feature({type:'Point',coordinates:c})):[];
    return {segments:collection(segments),records:collection(records),selected:collection(selected),ends:collection(ends),samples:sampleLines()};
  }
  function draw(){
    if(!styleReady)return;
    for(const [id,data] of Object.entries(sources())){const key='travel-'+id;if(map.getSource(key))map.getSource(key).setData(data);else map.addSource(key,{type:'geojson',data});}
    const dark=document.body.dataset.basemap==='fiord',color=dark?'#8ed5c3':'#356f68';
    const layers=[
      {id:'travel-sample-line',type:'line',source:'travel-samples',paint:{'line-color':color,'line-width':2.5,'line-opacity':.7},layout:{'line-cap':'round','line-join':'round'}},
      {id:'travel-line',type:'line',source:'travel-segments',paint:{'line-color':color,'line-width':['get','width'],'line-opacity':['get','opacity']},layout:{'line-cap':'round'}},
      {id:'travel-hit',type:'line',source:'travel-segments',paint:{'line-width':16,'line-opacity':0}},
      {id:'travel-dots',type:'circle',source:'travel-records',minzoom:11,paint:{'circle-radius':4,'circle-color':color,'circle-stroke-color':'#fff','circle-stroke-width':1}},
      {id:'travel-selected',type:'line',source:'travel-selected',paint:{'line-color':'#ef893d','line-width':4}},
      {id:'travel-ends',type:'circle',source:'travel-ends',paint:{'circle-radius':6,'circle-color':'#ef893d','circle-stroke-width':2,'circle-stroke-color':'#fff'}}
    ];
    for(const layer of layers)if(!map.getLayer(layer.id))map.addLayer(layer);
    map.setLayoutProperty('travel-dots','visibility',index===null?'visible':'none');
  }
  map.on('basemapchanging',()=>{styleReady=false;});
  map.on('style.load',()=>{styleReady=true;draw();});
  function deselect(){index=null;badge.textContent='全ルート';draw();}
  shell.drawer.addEventListener('viewchange',event=>{if(event.detail!=='route')deselect();});
  function clear(){rows=[];ghost=null;callbacks.clear();index=null;badge.hidden=true;cards.hide();endpoints.forEach(m=>m.remove());endpoints=[];draw();}
  function fit(coords,panel=false){
    if(!coords.length)return;const bounds=new gl.LngLatBounds();coords.forEach(c=>bounds.extend(c));
    const phone=innerWidth<=700,height=map.getContainer().clientHeight;
    // 区間パネルが開いている間: スマホは下からのシート(画面の8割)を避ける。PC は右ペインの分だけ地図が狭くなっているので余白は通常どおり
    const padding=panel&&phone?{top:60,left:24,right:24,bottom:Math.max(0,Math.min(height*.8,height-150))}:{top:80,bottom:panel?40:105,left:phone?30:100,right:40};
    map.fitBounds(bounds,{padding,maxZoom:13,duration:0,retainPadding:false});
  }
  function select(next,move=true){
    if(next<0||next>=rows.length-1)return;index=next;cards.hide();draw();
    const content=el('div',{className:'route-detail'}),nav=el('div',{className:'route-navigation'});
    const previous=el('button',{type:'button',textContent:'← 前の区間',disabled:index===0}),after=el('button',{type:'button',textContent:'次の区間 →',disabled:index===rows.length-2});
    previous.onclick=()=>select(index-1);after.onclick=()=>select(index+1);nav.append(previous,after);
    content.append(el('p',{className:'hint',textContent:'区間 '+(index+1)+' / '+(rows.length-1)}),nav);
    for(const [r,label] of [[rows[index],'出発の記録'],[rows[index+1],'到着の記録']]){
      const section=el('section',{className:'route-stop'});section.append(el('p',{className:'eyebrow',textContent:label}),el('time',{textContent:new Date(r.occurred_at).toLocaleString('ja-JP')}),el('h2',{textContent:r.observed_place_name||r.category_name||'記録した場所'}),el('p',{className:'memo',textContent:r.memo}));
      const button=el('button',{type:'button',textContent:'記録の詳細を開く'});button.onclick=()=>callbacks.get(r.id)?.();section.append(button);content.append(section);
    }
    content.append(el('p',{className:'hint',textContent:'記録地点を日時順につないでいます。'}));shell.detail(content);badge.textContent='区間 '+(index+1)+' / '+(rows.length-1);
    if(move)fit([point(rows[index]),point(rows[index+1])],true);
  }
  badge.onclick=()=>select(index??0);
  let windowSize=innerWidth+'x'+innerHeight;
  map.on('resize',()=>{const next=innerWidth+'x'+innerHeight;if(next===windowSize)return;windowSize=next;// 右ペインの開閉による地図の伸縮では視点を変えない(ウィンドウの大きさが変わった時だけ合わせ直す)
    if(index!==null)fit([point(rows[index]),point(rows[index+1])],true);else fit(rows.map(point));});
  map.on('click',event=>{
    if(!map.getLayer('travel-hit'))return;
    const hits=map.queryRenderedFeatures(event.point,{layers:['travel-dots','travel-hit']});
    const record=hits.find(f=>f.layer.id==='travel-dots');
    if(record){const r=rows.find(r=>r.id===record.properties.id);if(r&&!replaying)showRecord(r);}
    else if(hits.length)select(Number(hits[0].properties.index));
  });
  map.on('mousemove',event=>{if(map.getLayer('travel-hit'))map.getCanvas().style.cursor=map.queryRenderedFeatures(event.point,{layers:['travel-dots','travel-hit']}).length?'pointer':'';});
  function showRecord(r,note=''){const item=ownerPoint(r);if(!item)return;shell.hide();cards.show(item,{openDetail:callbacks.get(r.id),note});}
  function markers(){
    endpoints.forEach(m=>m.remove());endpoints=[];
    if(rows.length)for(const [r,label,idx] of [[rows[0],'始点',0],[rows.at(-1),'最新',rows.length-2]]){
      if(rows.length===1&&label==='始点')continue;
      const latest=label==='最新',button=el('button',{type:'button',className:latest?'who-button':'vector-endpoint',textContent:latest?'':label});
      if(latest)button.append(whoMarker({image:user?.icon_url,icon:user?.icon,avatar:user?.avatar_url,name:user?.display_name||'最新',caption:'最新 '+shortDay(r),status:under(user,r),color:'#356f68'}));
      button.setAttribute('aria-label',label+' '+new Date(r.occurred_at).toLocaleString('ja-JP'));button.onclick=event=>{event.stopPropagation();if(!replaying)showRecord(r);};
      // 最新マーカーは素の外側要素(.who-pin)を MapLibre に渡す。ボタンの all:unset が .maplibregl-marker の position:absolute を消して位置がずれるため
      const pinEl=latest?el('div',{className:'who-pin'}):button;if(latest)pinEl.append(button);
      endpoints.push(new gl.Marker({element:pinEl,anchor:latest?'center':'right'}).setLngLat(point(r)).addTo(map));
    }
    // 期間内に記録が無いとき: 線は出さず、最後の地点に薄いマーカーだけ置く
    if(!rows.length&&ghost&&!replaying){
      const r=ghost,button=el('button',{type:'button',className:'who-button'}),pinEl=el('div',{className:'who-pin stale'});
      button.append(whoMarker({image:user?.icon_url,icon:user?.icon,avatar:user?.avatar_url,name:user?.display_name||'最新',caption:'最後 '+shortDay(r),status:under(user,r),color:'#356f68'}));
      button.setAttribute('aria-label','最後の記録 '+new Date(r.occurred_at).toLocaleString('ja-JP'));
      button.onclick=event=>{event.stopPropagation();if(!replaying)showRecord(r,'この期間の記録はありません。最後の記録を表示しています');};
      pinEl.append(button);endpoints.push(new gl.Marker({element:pinEl,anchor:'center'}).setLngLat(point(r)).addTo(map));
    }
  }
  function render(records,fallback=[]){rows=orderedRoute(records);ghost=rows.length?null:orderedRoute(fallback).at(-1)??null;index=null;badge.hidden=rows.length<2;markers();draw();}
  return {setReplay:value=>{replaying=value;if(value){index=null;badge.textContent='全ルート';cards.hide();}else markers();badge.hidden=value||rows.length<2;draw();},track:()=>({id:'me',color:document.body.dataset.basemap==='fiord'?'#8ed5c3':'#21604f',points:combineOwnerPoints(rows,samples).map(p=>({...p,openDetail:p.kind==='record'?callbacks.get(p.id):undefined})),marker:rows.length?endpoints.at(-1):undefined}),
    // 旅をまとめる範囲の強調。表示中の期間とは無関係に、渡された記録をつないで見せる
    highlight:records=>{range=orderedRoute(records).map(point);index=null;draw();if(range.length)fit(range,true);},
    setSamples:next=>{samples=next;draw();},setUser:next=>{user=next;if(!replaying)markers();},clear,render,addPin:(item,open)=>callbacks.set(item.id,open),fitAll:()=>fit(rows.map(point)),fitPoints:coords=>fit(coords),points:()=>[...(rows.length?rows.map(point):ghost?[point(ghost)]:[]),...samples.map(locationPoint).filter(Boolean).map(p=>[p.lng,p.lat])],count:()=>rows.length};
}
