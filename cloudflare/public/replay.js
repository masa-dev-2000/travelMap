import {el} from './shared.js';
import {gl} from './owner-map.js';
import {makeTimeline,trackAt,recordsPassed,clampSpeed} from './replay-model.js';
import {displayWhen} from './record-display.js';
import {mapRecordCard} from './map-record-card.js';
export function makeReplay(map,shell,{tracks,begin,end}){
  const box=el('div',{className:'replay-control'}),play=el('button',{type:'button',className:'replay-play',textContent:'▶ 再生'});
  const restart=el('button',{type:'button',textContent:'⏮ 最初から',hidden:true}),stop=el('button',{type:'button',textContent:'✕ 終了',hidden:true}),label=el('span',{className:'replay-date',hidden:true});
  const speedRow=el('label',{className:'replay-speed',hidden:true}),speed=el('input',{type:'range',min:'0.25',max:'4',step:'0.25',value:'1'}),value=el('output',{textContent:'1.00×'});
  speed.setAttribute('aria-label','再生速度');speedRow.append(el('span',{textContent:'再生速度'}),el('span',{textContent:'遅い'}),speed,el('span',{textContent:'速い'}),value);
  const seek=el('input',{className:'replay-progress',type:'range',min:'0',max:'1',step:'0.001',value:'0',hidden:true}),next=el('button',{type:'button',textContent:'次の記録',hidden:true});seek.setAttribute('aria-label','再生位置');
  label.setAttribute('role','status');box.append(speedRow,seek,play,restart,stop,next,label);shell.stage.append(box);
  const cards=mapRecordCard(map,shell),empty={type:'FeatureCollection',features:[]};
  let active=false,playing=false,elapsed=0,last=0,frame=0,timeline=null,styleReady=true,shown=null,ownedMarkers=[];
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  function draw(){
    const features=[];
    for(const track of timeline.items){
      const {chunks,position}=trackAt(track.points,elapsed);
      for(const coordinates of chunks)features.push({type:'Feature',geometry:{type:'LineString',coordinates},properties:{color:track.color}});
      const node=track.marker?.getElement();if(node){node.style.visibility=position?'':'hidden';if(position)track.marker.setLngLat(position);}
    }
    seek.value=String(elapsed/timeline.duration);
    if(styleReady){const data={type:'FeatureCollection',features};if(map.getSource('replay'))map.getSource('replay').setData(data);else map.addSource('replay',{type:'geojson',data});
      if(!map.getLayer('replay-line'))map.addLayer({id:'replay-line',type:'line',source:'replay',paint:{'line-color':['get','color'],'line-width':3.5,'line-opacity':.95},layout:{'line-cap':'round','line-join':'round'}});}
  }
  function showRecord(point){
    if(!point || shown===point.key)return;shown=point.key;label.textContent=displayWhen(point);cards.show(point,{openDetail:point.openDetail});
  }
  function advance(now){
    const old=elapsed;elapsed=Math.min(timeline.duration,elapsed+Math.max(0,now-last)*clampSpeed(speed.value));last=now;
    const crossed=recordsPassed(timeline.order,old,elapsed);if(crossed.length)showRecord(crossed.at(-1));draw();
  }
  function tick(now){if(!playing)return;advance(now);if(elapsed>=timeline.duration){playing=false;play.textContent='▶ もう一度';return;}frame=requestAnimationFrame(tick);}
  function seekTo(progress){
    if(!active)return;elapsed=Math.max(0,Math.min(1,Number(progress)||0))*timeline.duration;last=performance.now();
    const record=timeline.order.filter(p=>p.kind==='record'&&p.ms<=elapsed).at(-1);cards.hide();shown=null;if(record)showRecord(record);else label.textContent='移動経路';draw();
  }
  function pause(){if(playing){advance(performance.now());playing=false;}cancelAnimationFrame(frame);play.textContent='▶ 続きから';}
  function start(){
    if(!active){
      // End the other mode before collecting markers or hiding its drawer.
      begin();shell.hide();timeline=makeTimeline(tracks());
      if(!timeline.order.length){end();label.hidden=false;label.textContent='再生できる軌跡がありません';return;}
      active=true;elapsed=0;shown=null;shell.stage.classList.add('replay-on');box.classList.add('active');
      for(const track of timeline.items)if(!track.marker){const dot=el('div',{className:'replay-position'});track.marker=new gl.Marker({element:dot}).setLngLat([track.points[0].lng,track.points[0].lat]).addTo(map);ownedMarkers.push(track.marker);}
      restart.hidden=stop.hidden=label.hidden=speedRow.hidden=seek.hidden=false;seekTo(0);
    }
    if(elapsed>=timeline.duration)seekTo(0);
    if(reduced() || timeline.order.length===1){next.hidden=timeline.order.length<=1;playing=false;play.textContent='▶ 再生';return;}
    playing=true;next.hidden=true;last=performance.now();play.textContent='⏸ 一時停止';cancelAnimationFrame(frame);frame=requestAnimationFrame(tick);
  }
  function finish(){
    if(!active)return;playing=false;cancelAnimationFrame(frame);active=false;elapsed=0;shown=null;cards.hide();
    for(const track of timeline.items){const node=track.marker?.getElement();if(node)node.style.visibility='';}
    for(const marker of ownedMarkers)marker.remove();ownedMarkers=[];
    if(map.getSource('replay'))map.getSource('replay').setData(empty);
    play.textContent='▶ 再生';restart.hidden=stop.hidden=label.hidden=speedRow.hidden=seek.hidden=next.hidden=true;
    box.classList.remove('active');shell.stage.classList.remove('replay-on');timeline=null;end();
  }
  play.onclick=()=>playing?pause():start();restart.onclick=()=>{if(active)seekTo(0);else start();};stop.onclick=finish;
  let currentSpeed=1;
  speed.oninput=()=>{
    const requested=clampSpeed(speed.value);
    // Finish the old-rate interval before installing the new multiplier.
    speed.value=String(currentSpeed);if(playing)advance(performance.now());currentSpeed=requested;speed.value=String(requested);value.value=requested.toFixed(2)+'×';speed.setAttribute('aria-valuetext',requested.toFixed(2)+'倍');
  };
  seek.oninput=()=>{const requested=Number(seek.value);pause();seekTo(requested);};next.onclick=()=>{const point=timeline?.order.find(p=>p.kind==='record'&&p.ms>elapsed);seekTo(point?point.ms/timeline.duration:1);};
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)pause();});
  window.addEventListener('pagehide',finish);document.addEventListener('tm:auth-lost',finish);
  map.on('basemapchanging',()=>{styleReady=false;});map.on('style.load',()=>{styleReady=true;if(active)draw();});
  return {finish,setAvailable:yes=>{if(!yes)finish();box.hidden=!yes;},active:()=>active,state:()=>({active,playing,progress:timeline?elapsed/timeline.duration:0,speed:currentSpeed}),seek:seekTo};
}
