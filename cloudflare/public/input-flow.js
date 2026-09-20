import {installInputViewport} from './input-viewport.js';
export function isConfirm(event, composing=false, lastComposition=-Infinity, now=performance.now()) {
  return event.key==='Enter' && !event.isComposing && !composing && event.keyCode!==229 && now-lastComposition>80;
}
export function installInputFlow(form) {
  const viewport=installInputViewport(form),find=id=>form.querySelector('#'+id);
  let composing=false,lastComposition=-Infinity,intent=0,revision=0;
  const destinations={title:()=>find('place'),category:()=>form.querySelector('#quick-cats [aria-checked=true]')||form.querySelector('#quick-cats button')||find('more'),rating:()=>form.querySelector('#rating button'),photo:()=>find('photo-open'),memo:()=>find('memo'),save:()=>find('save')};
  function go(name) {const node=destinations[name]?.();if(node){node.focus({preventScroll:true});viewport.reveal(node);}}
  form.addEventListener('compositionstart',()=>{composing=true;});
  form.addEventListener('compositionend',()=>{composing=false;lastComposition=performance.now();});
  form.addEventListener('pointerdown',()=>{intent++;});form.addEventListener('input',event=>{if(event.target.id!=='photo')intent++;});form.addEventListener('focusin',event=>{if(!['photo','photo-open'].includes(event.target.id))intent++;});form.addEventListener('keydown',event=>{if(event.key==='Tab')intent++;});
  find('place').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();if(isConfirm(event,composing,lastComposition))go('category');}});
  find('title-next').onclick=()=>go('category');find('rating-skip').onclick=()=>go('photo');find('photo-skip').onclick=()=>go('memo');find('memo-done').onclick=()=>go('save');
  find('photo-open').onclick=()=>find('photo').click();
  // Enter on non-textarea fields must not submit the whole form accidentally.
  form.addEventListener('keydown',event=>{if(event.key==='Enter' && event.target.tagName==='INPUT' && event.target.type!=='file')event.preventDefault();});
  return {go,viewport,photoTicket:()=>({intent,revision}),photoValid:ticket=>ticket.revision===revision,
    photoDone:ticket=>{if(ticket.revision===revision && ticket.intent===intent)go('memo');},reset:()=>{revision++;},dispose:()=>viewport.dispose()};
}
