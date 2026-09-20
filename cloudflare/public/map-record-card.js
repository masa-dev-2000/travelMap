import './issue-style.js';
import {el} from './shared.js';
import {gl} from './owner-map.js';
import {displayWhen} from './record-display.js';
const instances=new WeakMap();
export function mapRecordCard(map,shell) {
  if(instances.has(map))return instances.get(map);
  const popup=new gl.Popup({maxWidth:'310px',offset:26,closeOnClick:false,focusAfterOpen:false,className:'tm-record-popup'});
  let generation=0,controller=null,urls=[],current=null,adjustments=0;
  function release(){generation++;controller?.abort();controller=null;for(const url of urls)URL.revokeObjectURL(url);urls=[];current=null;}
  function hide(){release();popup.remove();}
  popup.on('close',release);
  const safeFrame=run=>requestAnimationFrame(()=>{
    if(run!==generation || !popup.isOpen() || adjustments>=2)return;
    const rect=popup.getElement().getBoundingClientRect(),mapRect=map.getContainer().getBoundingClientRect();
    const heading=shell.heading.getBoundingClientRect(),phone=innerWidth<=700;
    const controls=[...shell.stage.querySelectorAll('.map-rail,.replay-control.active')].filter(n=>n.getClientRects().length);
    const top=Math.max(mapRect.top+12,heading.bottom+8);
    const bottom=phone?Math.min(mapRect.bottom-12,...controls.map(n=>n.getBoundingClientRect().top-10)):mapRect.bottom-12;
    const left=mapRect.left+(phone?12:80),right=mapRect.right-12;
    // Only nudge at opening/image-load, never fight a user's ongoing pan.
    const dx=rect.left<left?rect.left-left:rect.right>right?rect.right-right:0;
    const dy=rect.height>bottom-top?0:rect.top<top?rect.top-top:rect.bottom>bottom?rect.bottom-bottom:0;
    if(Math.abs(dx)>1 || Math.abs(dy)>1){adjustments++;map.panBy([dx,dy],{duration:0});}
  });
  async function fillPrivatePhotos(point,node,run,signal){
    try{
      const response=await fetch('/api/private/attachments?'+new URLSearchParams({activity_id:point.id}),{signal,cache:'no-store'});
      if(!response.ok)return;
      const data=await response.json();
      const photo=(data.attachments||[]).find(p=>p.purpose==='photo' && ['image/png','image/jpeg'].includes(p.media_type) && /^[a-z0-9-]+$/.test(p.id));
      if(!photo || run!==generation)return;
      const file=await fetch('/api/private/attachments/'+photo.id,{signal,cache:'no-store'});
      if(!file.ok || run!==generation)return;
      const blob=await file.blob();if(run!==generation)return;
      const url=URL.createObjectURL(blob);urls.push(url);addPhoto(node,url,photo.caption,run);
    }catch{/* Text stays useful even when a photo is unavailable. */}
  }
  function addPhoto(node,url,caption,run){
    if(run!==generation)return;
    const image=el('img',{className:'tm-card-photo',src:url,alt:caption||'記録の写真',decoding:'async'});
    image.onload=()=>safeFrame(run);image.onerror=()=>image.remove();node.prepend(image);
  }
  function show(point,{openDetail=null,extra=null,note=''}={}){
    hide();if(!point?.card || point.kind!=='record')return;
    const run=generation;current=point.key;adjustments=0;controller=new AbortController();
    const node=el('article',{className:'tm-record-card'});node.setAttribute('aria-label','地点の記録');
    node.append(el('time',{textContent:displayWhen(point)}),el('h2',{textContent:point.card.title}));
    const meta=[point.card.author,point.card.category].filter(Boolean).join(' · ');if(meta)node.append(el('p',{className:'tm-card-meta',textContent:meta}));
    if(point.card.memo)node.append(el('p',{className:'tm-card-memo',textContent:point.card.memo}));
    if(point.card.rating!=null)node.append(el('p',{className:'tm-card-rating',textContent:`評価 ${point.card.rating} / 5`}));
    if(note)node.append(el('p',{className:'hint',textContent:note}));
    if(openDetail){const detail=el('button',{type:'button',textContent:'詳細を見る'});detail.onclick=()=>{hide();openDetail();};node.append(detail);}
    if(extra){const button=el('button',{type:'button',textContent:extra.label});button.onclick=()=>{hide();extra.action();};node.append(button);}
    popup.setLngLat([point.lng,point.lat]).setDOMContent(node).addTo(map);
    if(point.source==='public') {const p=point.card.photos?.[0];if(p)addPhoto(node,p.url,p.caption,run);}
    else if(point.source==='private')void fillPrivatePhotos(point,node,run,controller.signal);
    safeFrame(run);
  }
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && popup.isOpen()){event.preventDefault();event.stopImmediatePropagation();hide();}},{capture:true});
  window.addEventListener('pagehide',hide);document.addEventListener('tm:auth-lost',hide);
  map.on('basemapchanging',hide);
  const api={show,hide,current:()=>current};instances.set(map,api);return api;
}
