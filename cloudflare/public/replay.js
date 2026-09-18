import {el} from './shared.js';
// 旅のリプレイ: いま地図に出ている軌跡(絞り込み後のみんな+自分)を記録の順に伸ばす。全体で約15秒。動きを減らす設定では即時に全表示
const DURATION=15000;
export function makeReplay(map,shell,{tracks,begin,end}){
  const box=el('div',{className:'replay-control'}),play=el('button',{type:'button',className:'replay-play',textContent:'▶ 再生'}),restart=el('button',{type:'button',textContent:'⏮ 最初から',hidden:true}),stop=el('button',{type:'button',textContent:'✕ 終了',hidden:true}),label=el('span',{className:'replay-date',hidden:true});
  label.setAttribute('role','status');box.append(play,restart,stop,label);shell.stage.append(box);
  let active=false,playing=false,progress=0,last=0,frame=0,items=[],order=[],styleReady=true;
  const empty={type:'FeatureCollection',features:[]};
  function prepare(){
    items=tracks().filter(t=>t.points.length);order=items.flatMap(t=>t.points).sort((a,b)=>a.t-b.t);
    const steps=Math.max(1,order.length-1);order.forEach((p,i)=>{p.u=i/steps;});// 時刻ではなく順番で進める(期間が人によって大きく違っても全員の動きが見える)
    return order.length>1;
  }
  function paint(){
    const features=[];let current=order[0];
    for(const p of order){if(p.u<=progress)current=p;else break;}
    for(const track of items){
      const done=track.points.filter(p=>p.u<=progress),next=track.points[done.length],coords=done.map(p=>[p.lng,p.lat]);
      if(done.length&&next){const from=done.at(-1),k=(progress-from.u)/Math.max(1e-9,next.u-from.u);coords.push([from.lng+(next.lng-from.lng)*k,from.lat+(next.lat-from.lat)*k]);}
      if(coords.length>1)features.push({type:'Feature',geometry:{type:'LineString',coordinates:coords},properties:{color:track.color}});
      const node=track.marker?.getElement();if(node){node.style.visibility=coords.length?'':'hidden';if(coords.length)track.marker.setLngLat(coords.at(-1));}
    }
    label.textContent=new Date(current.t).toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Tokyo'});
    if(!styleReady)return;
    const data={type:'FeatureCollection',features};
    if(map.getSource('replay'))map.getSource('replay').setData(data);else map.addSource('replay',{type:'geojson',data});
    if(!map.getLayer('replay-line'))map.addLayer({id:'replay-line',type:'line',source:'replay',paint:{'line-color':['get','color'],'line-width':3.5,'line-opacity':.95},layout:{'line-cap':'round','line-join':'round'}});
  }
  function tick(now){
    if(!playing)return;progress=Math.min(1,progress+(now-last)/DURATION);last=now;paint();
    if(progress>=1){playing=false;play.textContent='▶ もう一度';return;}
    frame=requestAnimationFrame(tick);
  }
  function start(){
    if(!active){if(!prepare()){label.hidden=false;label.textContent='再生できる軌跡がありません';setTimeout(()=>{if(!active)label.hidden=true;},3000);return;}active=true;begin();items=tracks().filter(t=>t.points.length).map((t,i)=>({...items[i],marker:t.marker}));restart.hidden=stop.hidden=label.hidden=false;box.classList.add('active');shell.hide();}
    if(progress>=1)progress=0;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){progress=1;paint();play.textContent='▶ もう一度';return;}
    playing=true;last=performance.now();play.textContent='⏸ 一時停止';frame=requestAnimationFrame(tick);
  }
  function pause(){playing=false;cancelAnimationFrame(frame);play.textContent='▶ 続きから';}
  function finish(){
    if(!active)return;playing=false;cancelAnimationFrame(frame);active=false;progress=0;
    for(const track of items){const node=track.marker?.getElement();if(node)node.style.visibility='';}
    if(map.getSource('replay'))map.getSource('replay').setData(empty);
    play.textContent='▶ 再生';restart.hidden=stop.hidden=label.hidden=true;box.classList.remove('active');items=[];end();
  }
  play.onclick=()=>playing?pause():start();
  restart.onclick=()=>{progress=0;if(playing)paint();else start();};
  stop.onclick=finish;
  map.on('basemapchanging',()=>{styleReady=false;});
  map.on('style.load',()=>{styleReady=true;if(active)paint();});
  return {finish,setAvailable:value=>{if(!value)finish();box.hidden=!value;},active:()=>active,state:()=>({active,playing,progress}),seek:value=>{if(active){progress=value;paint();}}};
}
