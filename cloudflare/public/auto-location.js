import './issue-style.js';
import {el} from './shared.js';
import {createLocationCapture} from './location-capture.js';
const HANDOFF='travelmap.location.handoff',CLIENT='travelmap.location.client';
const paths=new Set(['/','/index.html','/admin/start/','/admin/record/']);
let navigationHandler=null;
export function navigateWithCapture(href){
  const url=new URL(href,location.href);
  if(url.origin!==location.origin||!paths.has(url.pathname))throw new Error('移動先が不正です');
  if(navigationHandler)return navigationHandler(url);
  location.assign(url.href);return Promise.resolve();
}
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export async function locationRequest(path,body,method=body===undefined?'GET':'POST',keepalive=false){
  const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),15000);
  try{
    const response=await fetch('/api/private/'+path,{method,cache:'no-store',signal:abort.signal,keepalive,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    let result={};try{result=await response.json();}catch{}
    if(!response.ok){const error=new Error(result.error||'位置記録を利用できません');error.status=response.status;error.code=result.code;
      if([401,403].includes(response.status))document.dispatchEvent(new Event('tm:auth-lost'));throw error;}
    return result;
  }finally{clearTimeout(timeout);}
}
export async function mountAutoLocation(slot){
  if(!slot)return null;
  let session;try{const response=await fetch('/api/public/session',{cache:'no-store'});if(!response.ok)return null;session=await response.json();}catch{return null;}
  if(!session.user||session.needs_signup)return null;
  let clientId;try{clientId=localStorage.getItem(CLIENT);if(!/^[0-9a-f-]{36}$/i.test(clientId||'')){clientId=crypto.randomUUID();localStorage.setItem(CLIENT,clientId);}}catch{clientId=null;}
  const root=el('div',{className:'auto-location'}),toggle=el('button',{type:'button',textContent:'自動位置記録 OFF'}),log=el('button',{type:'button',textContent:'位置ログ'}),status=el('span',{className:'auto-location-state',textContent:'前面表示中・5分ごと・本人のみ'});
  toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked','false');status.setAttribute('role','status');root.append(toggle,log,status);slot.append(root);
  if(!clientId){toggle.disabled=true;status.textContent='端末の保存領域を利用できないため自動記録は停止しています';}
  const pageId=crypto.randomUUID();let wake=null,channel=null;
  try{channel=new BroadcastChannel('travelmap.locations');}catch{}
  const notify=()=>{document.dispatchEvent(new Event('tm:location-change'));channel?.postMessage({type:'changed'});};
  const control=createLocationCapture({clientId,pageId,
    lease:body=>locationRequest('location-capture',body,'POST',body.command==='stop'),
    getPosition:()=>new Promise((resolve,reject)=>{if(!navigator.geolocation){reject(new Error('位置情報に対応していません'));return;}navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,maximumAge:0,timeout:20000});}),
    save:body=>locationRequest('location-samples',body),onSaved:notify,
    onState:state=>{toggle.setAttribute('aria-checked',String(state.enabled));toggle.textContent='自動位置記録 '+(state.enabled?'ON':'OFF');status.textContent=state.message;status.dataset.error=String(state.phase==='error');if(!state.enabled){void wake?.release();wake=null;}}
  });
  toggle.onclick=()=>{if(control.state().enabled){control.stop();try{sessionStorage.removeItem(HANDOFF);}catch{}}else{void control.start();if(navigator.wakeLock)navigator.wakeLock.request('screen').then(lock=>{if(control.state().enabled)wake=lock;else void lock.release();}).catch(()=>{});}};
  if(channel)channel.onmessage=event=>{if(event.data?.type==='changed')document.dispatchEvent(new Event('tm:location-change'));};
  // Same-tab navigation is explicit. Referrer stays suppressed by the Worker.
  let navigating=false;
  navigationHandler=async url=>{
    if(navigating)return;navigating=true;
    try{
      if(control.state().enabled){
        const transfer=await control.prepareHandoff(url.pathname,randomToken());
        if(transfer&&control.state().enabled){
          try{sessionStorage.setItem(HANDOFF,JSON.stringify({...transfer,handle:session.user.handle}));}
          catch{control.stop('引き継ぎを保存できないため停止しました');}
        }else{control.stop('画面移動のため停止しました。スイッチで再開してください');try{sessionStorage.removeItem(HANDOFF);}catch{}}
      }
    }finally{location.assign(url.href);}
  };
  let transfer=null;try{transfer=JSON.parse(sessionStorage.getItem(HANDOFF)||'null');sessionStorage.removeItem(HANDOFF);}catch{}
  const navigation=performance.getEntriesByType('navigation')[0];
  if(clientId&&transfer&&transfer.handle===session.user.handle&&transfer.destination===location.pathname&&navigation?.type==='navigate'&&!window.opener){
    // The server checks token expiry/owner/destination and atomically consumes it.
    void control.start(transfer);
  }
  document.addEventListener('click',event=>{
    if(!event.isTrusted||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const link=event.target.closest?.('a[href]');if(!link||link.hasAttribute('download')||(link.target&&link.target!=='_self'))return;
    const url=new URL(link.href,location.href);
    if(control.state().enabled&&url.origin===location.origin&&paths.has(url.pathname)&&url.pathname!==location.pathname){event.preventDefault();void navigateWithCapture(url.href);}
  });
  document.addEventListener('visibilitychange',()=>control.setVisible(!document.hidden));
  window.addEventListener('pagehide',()=>control.setVisible(false));
  window.addEventListener('pageshow',event=>{if(event.persisted){navigating=false;control.stop('オフ・再開するにはスイッチを押してください');try{sessionStorage.removeItem(HANDOFF);}catch{}}});
  document.addEventListener('tm:auth-lost',()=>{control.stop('ログイン状態が変わったため停止しました');toggle.disabled=true;log.disabled=true;for(const dialog of document.querySelectorAll('.auto-location-dialog'))dialog.close();try{sessionStorage.removeItem(HANDOFF);}catch{}});
  document.addEventListener('click',event=>{if(event.target.closest?.('#logout'))document.dispatchEvent(new Event('tm:auth-lost'));},{capture:true});
  document.addEventListener('submit',event=>{if(event.target.action&&new URL(event.target.action).pathname==='/auth/logout'){control.stop();try{sessionStorage.removeItem(HANDOFF);}catch{}}},{capture:true});
  log.onclick=()=>openLocationLog(notify);
  return {root,control};
}
function openLocationLog(notify){
  const dialog=el('dialog',{className:'auto-location-dialog'}),heading=el('h2',{textContent:'自動位置ログ（本人のみ）'}),close=el('button',{type:'button',textContent:'閉じる'});
  const info=el('p',{textContent:'前面で開いている間の位置だけを保存します。通常の記録・支出・公開件数には入りません。表示中の位置は個別に削除できます。'});
  const from=el('input',{type:'date',value:new Date(Date.now()-6*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'})}),to=el('input',{type:'date',value:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'})});
  from.setAttribute('aria-label','位置ログの開始日');to.setAttribute('aria-label','位置ログの終了日');
  const rows=el('div'),more=el('button',{type:'button',textContent:'さらに表示',hidden:true}),message=el('p');message.setAttribute('role','status');
  let cursor=null,generation=0;
  close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{generation++;dialog.remove();});
  dialog.append(heading,info,from,to,message,rows,more,close);document.body.append(dialog);dialog.showModal();
  async function load(reset=false){const run=++generation;if(reset){rows.replaceChildren();cursor=null;}more.disabled=true;message.textContent='読み込み中…';
    try{const params=new URLSearchParams({from:from.value+'T00:00:00+09:00',to:to.value+'T23:59:59.999+09:00',limit:'50'});if(cursor)params.set('cursor',cursor);
      const result=await locationRequest('location-samples?'+params);if(run!==generation||!dialog.open)return;
      for(const sample of result.samples){const row=el('div',{className:'log-row'}),text=el('span',{textContent:`${new Date(sample.captured_at).toLocaleString('ja-JP')} · ±${Math.round(sample.accuracy)}m\n${sample.latitude.toFixed(5)}, ${sample.longitude.toFixed(5)}`}),remove=el('button',{type:'button',textContent:'削除'});
        remove.onclick=async()=>{if(remove.dataset.armed!=='1'){remove.dataset.armed='1';remove.textContent='削除を確定';return;}remove.disabled=true;try{await locationRequest('location-samples/'+sample.id,undefined,'DELETE');row.remove();notify();}catch(error){message.textContent=error.message;remove.disabled=false;}};row.append(text,remove);rows.append(row);}
      cursor=result.next_cursor;more.hidden=!cursor;message.textContent=rows.children.length?'':'この期間の自動位置記録はありません';
    }catch(error){if(run===generation)message.textContent=error.message;}finally{if(run===generation)more.disabled=false;}
  }
  from.onchange=to.onchange=()=>void load(true);more.onclick=()=>void load();void load(true);
}
