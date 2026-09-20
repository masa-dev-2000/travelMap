import {validLocation} from './record-display.js';
export const CAPTURE_INTERVAL_MS=300000,HEARTBEAT_MS=30000;
// Dependency injection makes time, permissions, pending network writes and tab races testable.
export function createLocationCapture({clientId,pageId,lease,getPosition,save,makeId=()=>crypto.randomUUID(),now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout,onState=()=>{},onSaved=()=>{}}){
  let enabled=false,visible=true,generation=0,captureId=null,segmentId=null,owner=null,nextAt=0,lastSavedAt=null;
  let timer=null,heartbeat=null,retry=null,sending=0,phase='off',message='オフ';
  const credentials=()=>({client_id:clientId,capture_id:captureId,page_id:pageId});
  const state=()=>({enabled,visible,phase,message,nextAt,lastSavedAt,sending,owner});
  const emit=(status,text)=>{phase=status;message=text;onState(state());};
  const valid=run=>enabled&&visible&&generation===run;
  function clear(){if(timer!==null)clearTimer(timer);if(heartbeat!==null)clearTimer(heartbeat);timer=heartbeat=null;if(retry){clearTimer(retry.timer);retry.resolve(false);retry=null;}}
  function release(creds){return lease({...creds,command:'stop'}).catch(()=>{});}
  function stop(reason='オフ'){
    const creds=captureId?credentials():null;enabled=false;generation++;clear();
    emit('off',sending?'停止済み・直前の送信を確認中':reason);
    if(creds)void release(creds);
  }
  function beat(run){
    if(!valid(run))return;
    heartbeat=setTimer(async()=>{
      if(!valid(run))return;
      try{const result=await lease({...credentials(),command:'renew'});if(!valid(run))return;if(result.owner!==owner){stop('利用者が変わったため停止しました');return;}beat(run);}
      catch(error){if(valid(run))stop(error.message||'記録権限を確認できないため停止しました');}
    },HEARTBEAT_MS);
  }
  function schedule(run){if(valid(run))timer=setTimer(()=>void sample(run),Math.max(0,nextAt-now()));}
  function wait(ms,run){return new Promise(resolve=>{if(!valid(run)){resolve(false);return;}retry={resolve,timer:setTimer(()=>{retry=null;resolve(valid(run));},ms)};});}
  async function sample(run){
    if(!valid(run))return;nextAt=now()+CAPTURE_INTERVAL_MS;emit('locating','位置を取得中…');
    try{
      const position=await getPosition();if(!valid(run))return;
      const {latitude,longitude,accuracy}=position.coords||{},time=position.timestamp;
      if(!validLocation(latitude,longitude)||!Number.isFinite(accuracy)||accuracy<0||!Number.isFinite(time)||time>now()+120000||time<now()-60000)throw new Error('新しい位置を取得できませんでした');
      const payload=Object.freeze({...credentials(),id:makeId(),segment_id:segmentId,captured_at:new Date(time).toISOString(),latitude,longitude,accuracy});
      for(let attempt=0;attempt<3&&valid(run);attempt++){
        let retryDelay=0;emit('saving',attempt?'同じ位置を再送中…':'位置を保存中…');sending++;
        try{
          const result=await save(payload);onSaved({...payload,id:result.id});lastSavedAt=payload.captured_at;
          if(valid(run))emit('recording',`記録中 · 最終 ${new Date(time).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}`);
          else if(!enabled)emit('off','停止済み（停止前の記録を保存しました）');
          break;
        }catch(error){
          if(!valid(run))break;
          if([400,401,403,409].includes(error.status)){stop(error.message);break;}
          if(attempt===2){segmentId=makeId();emit('error','保存できませんでした。次回の取得時に再試行します');break;}
          retryDelay=10000*(attempt+1);emit('retrying','保存できませんでした。再送を待っています');
        }finally{sending--;if(!enabled&&sending===0&&message==='停止済み・直前の送信を確認中')emit('off','停止済み・直前の保存結果は位置ログで確認してください');}
        if(retryDelay&&!await wait(retryDelay,run))break;
      }
    }catch(error){
      if(valid(run)){if(error.code===1)stop('位置情報の許可がないため停止しました');else{segmentId=makeId();emit('error','位置を取得できませんでした。5分後に再試行します');}}
    }finally{schedule(run);}
  }
  async function start(handoff=null){
    if(enabled&&visible)return;
    clear();enabled=true;visible=true;const run=++generation;
    captureId=handoff?.captureId||makeId();segmentId=makeId();nextAt=handoff?.nextAt||now();owner=handoff?.owner||null;lastSavedAt=handoff?.lastSavedAt||null;
    emit('starting','準備中…');
    try{
      const claiming=credentials();
      const response=await lease({...claiming,command:'start',previous_page_id:handoff?.pageId||pageId,previous_capture_id:handoff?.previousCaptureId||captureId});
      if(!valid(run)){if(!enabled||!visible||captureId!==claiming.capture_id)void release(claiming);return;}
      if(owner&&owner!==response.owner){stop('利用者が変わったため停止しました');return;}
      owner=response.owner;beat(run);
      if(nextAt<=now())await sample(run);else{emit('recording','記録中 · 次回の取得を待っています');schedule(run);}
    }catch(error){if(valid(run))stop(error.message||'自動位置記録を開始できませんでした');}
  }
  function setVisible(next){
    if(next===visible)return;
    if(!next){visible=false;generation++;clear();if(enabled){emit('paused','画面が非表示のため一時停止');void release(credentials());}return;}
    visible=true;if(enabled){const handoff={captureId:makeId(),previousCaptureId:captureId,pageId,owner,nextAt,lastSavedAt};enabled=false;void start(handoff);}
  }
  function handoff(){return enabled?{captureId,pageId,owner,nextAt,lastSavedAt,at:now()}:null;}
  return {start,stop,setVisible,state,handoff,dispose:()=>stop()};
}
