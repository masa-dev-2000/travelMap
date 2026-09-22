import {el} from '/shared.js';
import {gl} from '/owner-map.js';

// 編集中の1件だけ地図上でつまんで動かせるようにする。地図を見ているだけの地点は掴めない。
// 数値入力は残す。細かい調整と、地図を操作できない場合のため。

const MIN_GRAB_BAND=260;// これ以下しか地図が見えないとピンを掴めない

// 編集パネルは地図に重なる。そのまま中心へ寄せるとピンがパネルの下に入る。
// PCは横に開くので左を、スマホは全幅のシートが下から出るので下を空ける。
function coveredBy(panel,map){
  if(!panel||panel.inert)return null;
  const p=panel.getBoundingClientRect(),c=map.getContainer().getBoundingClientRect();
  if(!p.width||!p.height)return null;
  if(p.width>=c.width*0.9)return {edge:'bottom',size:Math.max(0,c.bottom-p.top),free:Math.max(0,p.top-c.top)};
  return {edge:'left',size:Math.max(0,p.right-c.left),free:Math.max(0,c.right-p.right)};
}

export function makeLocationEditor({map,notify,panel,collapse}){
  let active=null;
  function stop(){
    if(!active)return;
    active.marker.remove();
    active.onStop?.();
    active=null;
  }
  // 掴める地点は常にひとつ。別の記録を編集し始めたら前のつまみは消える。
  function start({lat,lng,origin,onStop}){
    stop();
    const from=origin??(lat.value!==''&&lng.value!==''
      ? {lng:Number(lng.value),lat:Number(lat.value)}
      : map.getCenter());
    const marker=new gl.Marker({element:el('div',{className:'edit-pin'}),draggable:true})
      .setLngLat([from.lng,from.lat]).addTo(map);
    marker.on('drag',()=>{
      const p=marker.getLngLat();
      lat.value=p.lat.toFixed(6);lng.value=p.lng.toFixed(6);
    });
    active={marker,onStop};
    const covered=coveredBy(panel,map);
    // 残る地図が狭すぎる画面ではパネルを閉じる。閉じてもピンは残り、開き直して保存する。
    const cramped=covered&&covered.free<MIN_GRAB_BAND;
    if(cramped)collapse?.();
    const padding=cramped||!covered?{}:{[covered.edge]:covered.size};
    map.easeTo({center:[from.lng,from.lat],zoom:Math.max(map.getZoom(),14),padding,duration:400});
    notify?.(cramped
      ? 'ピンをドラッグして位置を決め、記録を開き直して保存してください'
      : '地図のピンをドラッグして位置を決めます。保存で確定します');
    return marker;
  }
  return {start,stop,editing:()=>!!active};
}
