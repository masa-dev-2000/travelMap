import * as gl from '/vendor/maplibre-gl.mjs';
import {el} from './shared.js';

export const STYLES={liberty:'Liberty',bright:'Bright',fiord:'Fiord','3d':'3D'};
export function prepareStyle(style,mode){
  const result=structuredClone(style);
  if(mode!=='3d')for(const layer of result.layers){if(layer.type==='fill-extrusion'){layer.type='fill';layer.paint={'fill-color':'#e3ded6','fill-opacity':.8};}}
  return result;
}
export function makeOwnerMap(){
  document.body.classList.add('vector-map');
  const map=new gl.Map({container:'map',style:{version:8,sources:{},layers:[]},center:[134.5,35.5],zoom:6,attributionControl:false});window.__tmMap=map;// マーカー位置の数値検証用(コンソールから project と比較する)
  map.addControl(new gl.NavigationControl({visualizePitch:true}),'top-right');
  map.addControl(new gl.AttributionControl({compact:true}));
  const control=el('details',{className:'basemap-control'}),title=el('summary',{textContent:'地図の種類'}),options=el('div',{className:'basemap-options'});
  const status=el('p',{className:'basemap-status'});status.setAttribute('role','status');
  const retry=el('button',{type:'button',textContent:'再試行',hidden:true});
  const buttons=new Map();let mode='liberty',generation=0,controller,timer;
  try{const saved=localStorage.getItem('travelmap.basemap');if(Object.hasOwn(STYLES,saved))mode=saved;}catch{}
  for(const [key,label] of Object.entries(STYLES)){const button=el('button',{type:'button',textContent:label});button.setAttribute('aria-pressed','false');button.onclick=()=>switchStyle(key);options.append(button);buttons.set(key,button);}
  control.append(title,options,status,retry);document.querySelector('.map-stage').append(control);
  function failure(){status.textContent='地図を読み込めませんでした。再試行するか、別の種類を選んでください。';retry.hidden=false;control.open=true;}
  async function switchStyle(next){
    const run=++generation;controller?.abort();controller=new AbortController();const requestController=controller;clearTimeout(timer);
    mode=next;retry.hidden=true;status.textContent='読み込み中…';
    for(const [key,button] of buttons)button.setAttribute('aria-pressed',String(key===mode));
    const timeout=setTimeout(()=>requestController.abort(),15000);
    try{
      const response=await fetch('https://tiles.openfreemap.org/styles/'+(mode==='3d'?'liberty':mode),{signal:controller.signal});
      if(!response.ok)throw new Error('style');const style=prepareStyle(await response.json(),mode);if(run!==generation)return;
      map.stop();map.fire('basemapchanging');document.body.dataset.basemap=mode;map.setStyle(style,{diff:false});map.jumpTo({pitch:mode==='3d'?50:0,bearing:0});
      document.body.dataset.basemap=mode;title.textContent='地図 · '+STYLES[mode];control.open=false;
      try{localStorage.setItem('travelmap.basemap',mode);}catch{}
      timer=setTimeout(()=>{if(run===generation)failure();},20000);
      map.once('idle',()=>{if(run!==generation)return;clearTimeout(timer);status.textContent='';retry.hidden=true;});
    }catch(error){if(run===generation)failure();}finally{clearTimeout(timeout);}
  }
  map.on('error',()=>{failure();});
  retry.onclick=()=>switchStyle(mode);
  new ResizeObserver(()=>map.resize()).observe(document.querySelector('#map'));
  switchStyle(mode);
  return map;
}
export {gl};
