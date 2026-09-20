// The operation, not the disabled button, owns saving and photo-conversion locks.
// An uncertain POST is retried with the same frozen body/key; attachments reuse its ID.
export function createRecordSave({create,upload,publish,makeId=()=>crypto.randomUUID(),onState=()=>{}}){
  let saving=false,processing=0,pending=null;
  const state=()=>({saving,processing,pending:!!pending,activityId:pending?.id??null,canSave:!saving&&processing===0});
  const emit=()=>onState(state());
  function beginPhotos(){
    if(saving||pending||processing)return null;
    processing++;emit();let finished=false;
    return ()=>{if(!finished){finished=true;processing--;emit();}};
  }
  async function run(snapshot){
    if(!state().canSave)return null;
    // Deep-copy JSON fields; Blob references are immutable. Never read live inputs on retry.
    if(!pending)pending={body:JSON.parse(JSON.stringify(snapshot.body)),photos:[...snapshot.photos],date:snapshot.date,key:makeId(),publishKey:makeId(),id:null,uploaded:new Map()};
    const op=pending;saving=true;emit();
    try{
      if(!op.id){
        try{op.id=(await create(op.body,op.key)).id;}
        catch(error){
          // These validation failures occur before a successful activity commit. Let the user edit.
          if([400,403,413,422].includes(error.status))pending=null;
          throw error;
        }
      }
      let failed=0;
      for(let index=0;index<op.photos.length;index++){
        if(op.uploaded.has(index))continue;
        try{const result=await upload(op.id,op.photos[index],index,op.photos.length);op.uploaded.set(index,result.id);}
        catch{failed++;}
      }
      if(failed)throw new Error(`記録本体は保存済みです。写真${failed}枚を再試行してください（新しい記録は作りません）`);
      if(op.body.publish&&op.photos.length)await publish(op,op.publishKey);
      pending=null;return {id:op.id,body:op.body};
    }finally{saving=false;emit();}
  }
  return {state,beginPhotos,run};
}
