import {el} from './shared.js';
export function orderedRoute(records) {
  return records.filter(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)&&Math.abs(r.latitude)<=90&&Math.abs(r.longitude)<=180&&Number.isFinite(Date.parse(r.occurred_at)))
    .slice().sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at)||String(a.id).localeCompare(String(b.id),'en'));
}
export function makeRoute(map,shell) {
  document.body.classList.add('quiet-route');
  map.createPane('travel-route').style.zIndex='350';
  const layer=L.layerGroup().addTo(map),selected=L.layerGroup().addTo(map);
  const badge=el('button',{className:'route-overview',type:'button',textContent:'全ルート',hidden:true});
  badge.title='区間を選んで移動の記録を見る';document.querySelector('.map-stage').append(badge);
  let rows=[],pins=[],index=null;
  const points=()=>rows.map(r=>[r.latitude,r.longitude]);
  function updatePins(){for(const {marker,item} of pins){if(index===null&&map.getZoom()>=11&&item.category_name!=='移動')marker.addTo(map);else map.removeLayer(marker);}}
  function addPin(marker,item){pins.push({marker,item});if(index!==null||map.getZoom()<11||item.category_name==='移動')map.removeLayer(marker);}
  map.on('zoomend',updatePins);
  function deselect(){selected.clearLayers();index=null;badge.textContent='全ルート';updatePins();}
  shell.drawer.addEventListener('viewchange',event=>{if(event.detail!=='route')deselect();});
  function clear(){layer.clearLayers();deselect();for(const {marker} of pins)map.removeLayer(marker);pins=[];rows=[];badge.hidden=true;}
  const date=r=>new Date(r.occurred_at).toLocaleString('ja-JP');
  function select(next,move=false){
    if(next<0||next>=rows.length-1)return;
    deselect();index=next;updatePins();const a=rows[index],b=rows[index+1];
    const coords=[[a.latitude,a.longitude],[b.latitude,b.longitude]];
    L.polyline(coords,{pane:'travel-route',className:'route-selected',color:'#d96c32',weight:4,opacity:1,interactive:false}).addTo(selected);
    for(const [r,label] of [[a,'出発'],[b,'到着']])L.circleMarker([r.latitude,r.longitude],{radius:6,color:'#fff',weight:2,fillColor:'#d96c32',fillOpacity:1}).bindTooltip(label).addTo(selected);
    const content=el('div',{className:'route-detail'});
    const nav=el('div',{className:'route-navigation'}),prev=el('button',{type:'button',textContent:'← 前の区間',disabled:index===0}),after=el('button',{type:'button',textContent:'次の区間 →',disabled:index===rows.length-2});
    prev.onclick=()=>select(index-1,true);after.onclick=()=>select(index+1,true);nav.append(prev,after);
    content.append(el('p',{className:'hint',textContent:'区間 '+(index+1)+' / '+(rows.length-1)}),nav);
    for(const [r,label] of [[a,'出発の記録'],[b,'到着の記録']]){
      const section=el('section',{className:'route-stop'});
      section.append(el('p',{className:'eyebrow',textContent:label}),el('time',{textContent:date(r)}),el('h2',{textContent:r.observed_place_name||r.category_name||'記録した場所'}),el('p',{className:'memo',textContent:r.memo}));content.append(section);
    }
    content.append(el('p',{className:'hint',textContent:'記録地点を日時順につないでいます。'}));
    shell.detail(content);badge.textContent='区間 '+(index+1)+' / '+(rows.length-1);
    if(move){
      const phone=map.getSize().x<=600;
      map.fitBounds(coords,{paddingTopLeft:phone?[28,70]:[Math.min(520,map.getSize().x*.55),85],paddingBottomRight:phone?[28,Math.min(map.getSize().y*.76,650)]:[35,45],maxZoom:13,animate:false});
    }
  }
  badge.onclick=()=>select(index??0,true);
  map.on('resize',()=>{if(index!==null)select(index,true);});
  function render(records){
    layer.clearLayers();deselect();rows=orderedRoute(records);badge.hidden=rows.length<2;
    if(!rows.length)return;
    const coords=points();
    if(rows.length>1){
      L.polyline(coords,{pane:'travel-route',className:'route-line',color:'#356f68',weight:2.5,opacity:.8,interactive:false}).addTo(layer);
      for(let i=1;i<rows.length;i++){
        L.polyline([coords[i-1],coords[i]],{pane:'travel-route',className:'route-hit',color:'#356f68',weight:16,opacity:0,bubblingMouseEvents:false}).on('click',()=>select(i-1,true)).addTo(layer);
      }
    }
    for(const [r,label,kind] of [[rows[0],'始点','start'],[rows.at(-1),'最新','latest']]){
      if(rows.length===1&&kind==='start')continue;
      const icon=L.divIcon({className:'route-endpoint quiet-endpoint route-'+kind,html:'<span>'+label+'</span>',iconSize:[32,22],iconAnchor:kind==='start'?[36,11]:[-4,11]});
      const marker=L.marker([r.latitude,r.longitude],{icon,title:label+' '+date(r)}).addTo(layer);
      if(rows.length>1)marker.on('click',()=>select(kind==='start'?0:rows.length-2,true));
      else marker.bindPopup(el('p',{textContent:date(r)}));
    }
    updatePins();
  }
  return {clear,render,points,addPin};
}
