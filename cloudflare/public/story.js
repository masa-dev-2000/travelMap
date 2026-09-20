import {el,whoMarker} from './shared.js';
import {gl} from './owner-map.js';
import {mapRecordCard} from './map-record-card.js';
import {validLocation} from './record-display.js';
const SPEEDS=[.5,1,1.5,2,4];
// One-person renderer. Queue, unread filters and authors belong to PlaybackController.
export function makeStory(map,shell,{begin=()=>{},end=()=>{}}={}){
  const cards=mapRecordCard(map,shell),box=el('div',{className:'replay-control'});
  const play=el('button',{type:'button',className:'replay-play',textContent:'▶ 再生'});
  const position=el('div',{className:'replay-seek',hidden:true});
  const seek=el('input',{type:'range',min:0,max:0,step:1,value:0,className:'replay-progress'});seek.setAttribute('aria-label','再生位置');
  const label=el('span',{className:'replay-date'});position.append(seek,label);
  const speed=el('button',{type:'button',className:'replay-speed',textContent:'1.0×',hidden:true});
  const restart=el('button',{type:'button',className:'replay-restart',textContent:'↶',hidden:true});restart.setAttribute('aria-label','最初から');
  const stop=el('button',{type:'button',className:'replay-stop',textContent:'×',hidden:true});stop.setAttribute('aria-label','再生を終了');
  box.append(play,position,speed,restart,stop);shell.stage.append(box);
  let steps=[],index=0,playing=false,active=false,timer=0,seenTimer=0,generation=0,marker=null,styleReady=true,multiplier=1,data=null,callbacks={};
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  function updateSpeed(){speed.textContent=multiplier.toFixed(1)+'×';speed.setAttribute('aria-label',`再生速度 ${multiplier}倍。タップで変更`);}
  updateSpeed();
  const coords=()=>steps.slice(0,index+1).filter(s=>validLocation(s.lat,s.lng)).map(s=>[s.lng,s.lat]);
  function draw(){
    if(!styleReady||(map.isStyleLoaded&&!map.isStyleLoaded()))return;const line=active?coords():[],collection={type:'FeatureCollection',features:line.length>1?[{type:'Feature',geometry:{type:'LineString',coordinates:line},properties:{}}]:[]};
    if(map.getSource('story'))map.getSource('story').setData(collection);else map.addSource('story',{type:'geojson',data:collection});
    if(!map.getLayer('story-line'))map.addLayer({id:'story-line',type:'line',source:'story',paint:{'line-color':data?.color||'#216453','line-width':4,'line-opacity':.95},layout:{'line-cap':'round','line-join':'round'}});
    else map.setPaintProperty('story-line','line-color',data?.color||'#216453');
  }
  function point(step){return {key:`story:${data.author||data.title}:${step.id||index}`,id:step.id,kind:'record',source:step.source||data.source||'public',lat:step.lat,lng:step.lng,displayAt:step.at||null,displayDate:step.date,
    card:{title:step.place||step.category||'旅のひとこま',memo:step.memo||'',author:data.face?.name||data.title,category:step.category||'',rating:step.rating??null,photos:step.photos||[]}};}
  function paint(){
    if(!active||!steps[index]||document.hidden)return;
    clearTimeout(seenTimer);const run=generation,step=steps[index],item=point(step);
    seek.value=String(index);seek.disabled=steps.length<2;
    label.textContent=`${data.face?.name||data.title||''} · ${index+1}/${steps.length}`;label.title=label.textContent;
    seek.setAttribute('aria-valuetext',`${index+1}件目 / ${steps.length}件`);
    if(validLocation(step.lat,step.lng)){
      if(!marker){const node=el('div',{className:'who-pin story-pin'}),face=el('div',{className:'who-button'});face.append(whoMarker({...data.face,color:data.color||'#216453'}));node.append(face);marker=new gl.Marker({element:node}).setLngLat([step.lng,step.lat]).addTo(map);}
      else marker.setLngLat([step.lng,step.lat]);
      map[reduced()?'jumpTo':'easeTo']({center:[step.lng,step.lat],zoom:Math.max(7,map.getZoom()),duration:Math.round(300/multiplier),padding:0});
    }else{marker?.remove();marker=null;}
    draw();cards.show(item,{openDetail:()=>{pause();const content=el('article',{className:'record-detail'});content.append(el('h2',{textContent:item.card.title}),el('p',{textContent:step.memo||''}));shell.detail(content);},onPresented:()=>{
      // Only an actually presented card can advance read state. Hiding the tab,
      // opening a dialog, scrubbing past it, or closing it invalidates this timer.
      seenTimer=setTimeout(()=>{if(run===generation&&active&&cards.visible(item.key))void Promise.resolve(callbacks.onSeen?.(step)).catch(()=>{});},400);
    }});
  }
  function setPlay(){play.textContent=active?(playing?'⏸':'▶'):'▶ 再生';play.setAttribute('aria-label',active?(playing?'一時停止':'再生を再開'):'再生');}
  function schedule(){
    clearTimeout(timer);if(!playing||document.hidden)return;const run=generation;
    timer=setTimeout(()=>{if(run!==generation||!playing||document.hidden)return;
      if(index>=steps.length-1){pause();callbacks.onComplete?.();return;}
      index++;paint();schedule();
    },Math.max(700,((steps[index]?.photos?.length||steps[index]?.memo)?2600:1500)/multiplier));
  }
  function pause(){playing=false;clearTimeout(timer);map.stop();setPlay();}
  function resume(){if(!active||document.hidden)return;playing=true;setPlay();paint();schedule();}
  function finish(notify=true){
    const was=active,oldCallbacks=callbacks;generation++;clearTimeout(timer);clearTimeout(seenTimer);playing=false;active=false;callbacks={};
    cards.hide();marker?.remove();marker=null;steps=[];index=0;data=null;map.stop();draw();
    position.hidden=speed.hidden=restart.hidden=stop.hidden=true;box.classList.remove('active');shell.stage.classList.remove('replay-on');setPlay();
    if(was)end();if(was&&notify)oldCallbacks.onStop?.();
  }
  function load(next,options={}){
    finish(false);if(!next?.steps?.length)return false;
    data=structuredClone(next);steps=data.steps;callbacks=options;begin();active=true;index=0;generation++;
    shell.stage.classList.add('replay-on');box.classList.add('active');position.hidden=speed.hidden=restart.hidden=stop.hidden=false;
    seek.max=String(steps.length-1);
    // A locationless step must never borrow an earlier or a future step's pin.
    // Reduced-motion users advance records explicitly, without automatic camera jumps.
    restart.textContent=reduced()?'›':'↶';restart.setAttribute('aria-label',reduced()?'次の記録':'最初から');
    playing=!reduced()&&!document.hidden;setPlay();paint();schedule();return true;
  }
  play.onclick=()=>active?(playing?pause():resume()):box.dispatchEvent(new Event('playrequest'));
  speed.onclick=()=>{multiplier=SPEEDS[(SPEEDS.indexOf(multiplier)+1)%SPEEDS.length];updateSpeed();if(playing)schedule();};
  const go=n=>{if(!active)return;pause();generation++;clearTimeout(seenTimer);index=Math.max(0,Math.min(steps.length-1,Math.round(Number(n)||0)));paint();};
  seek.oninput=()=>go(seek.value);restart.onclick=()=>go(reduced()?index+1:0);stop.onclick=()=>finish();
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(seenTimer);pause();}else if(active)paint();});
  window.addEventListener('pagehide',()=>finish());document.addEventListener('tm:auth-lost',()=>finish());
  shell.drawer.addEventListener('viewchange',event=>{if(event.detail&&active)finish();});
  map.on('basemapchanging',()=>{styleReady=false;clearTimeout(seenTimer);pause();cards.hide();});
  map.on('style.load',()=>{styleReady=true;draw();if(active)paint();});
  return {load,finish,pause,resume,go,seek:progress=>go(progress*(steps.length-1)),active:()=>active,
    setAvailable:yes=>{play.disabled=!yes&&!active;},onPlay:fn=>box.addEventListener('playrequest',fn),
    state:()=>({active,playing,index,total:steps.length,progress:steps.length>1?index/(steps.length-1):0,speed:multiplier,step:steps[index]||null,author:data?.author||null})};
}
