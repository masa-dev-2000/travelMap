import {locationRequest} from './auto-location.js';
// Location data remains on the private side, including when public travel mode is on.
export function makeLocationMap(route,{handle,filter,notify}){
  let generation=0,scope=filter();
  async function refresh(){
    const run=++generation;
    // Samples have no category/trip assignment. Do not silently mix them into a narrower view.
    if(document.querySelector('#trip-filter')?.value||scope.trip||scope.category||(scope.person&&scope.person!==handle)){route.setSamples([]);return;}
    route.setSamples([]);
    const params=new URLSearchParams({limit:'500',from:(scope.from||'1970-01-01')+'T00:00:00+09:00'});
    if(scope.to)params.set('to',scope.to+'T23:59:59.999+09:00');
    const samples=[];let cursor=null;
    try{
      do{if(cursor)params.set('cursor',cursor);const result=await locationRequest('location-samples?'+params);if(run!==generation)return;samples.push(...result.samples);cursor=result.next_cursor;}while(cursor&&samples.length<10000);
      if(run!==generation)return;route.setSamples(samples);if(cursor)notify('自動位置は直近10,000地点を表示しています。期間を絞ると全地点を確認できます');
    }catch(error){if(run!==generation)return;route.setSamples([]);if(error.code!=='location_not_ready')notify('自動位置を取得できませんでした。通常記録は利用できます');}
  }
  const changed=()=>void refresh(),authLost=()=>{generation++;route.setSamples([]);};
  document.addEventListener('change',event=>{if(event.target?.id==='trip-filter')void refresh();});
  document.addEventListener('tm:location-change',changed);document.addEventListener('tm:auth-lost',authLost);
  return {refresh,setFilter:next=>{scope=next;void refresh();},dispose:()=>{generation++;document.removeEventListener('tm:location-change',changed);document.removeEventListener('tm:auth-lost',authLost);route.setSamples([]);}};
}
