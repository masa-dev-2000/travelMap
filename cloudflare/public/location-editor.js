import {el} from '/shared.js';
import {gl} from '/owner-map.js';

// 編集中の1件だけ地図上でつまんで動かせるようにする。地図を見ているだけの地点は掴めない。
// 数値入力は残す。細かい調整と、地図を操作できない場合のため。

const MIN_GRAB_BAND=260;// これ以下しか地図が見えないとピンを掴めない
export const FOCUS_ZOOM=14;

// 地点へ寄せる。今より引いた表示にはしない。
export function focusPoint(map,lngLat,padding={}){
  map.easeTo({center:lngLat,zoom:Math.max(map.getZoom(),FOCUS_ZOOM),padding,duration:400});
}

// 編集パネルは地図に重なる。そのまま中心へ寄せるとピンがパネルの下に入る。
// PCは横に開くので左を、スマホは全幅のシートが下から出るので下を空ける。
function coveredBy(panel,map){
  if(!panel||panel.inert)return null;
  const p=panel.getBoundingClientRect(),c=map.getContainer().getBoundingClientRect();
  if(!p.width||!p.height)return null;
  if(p.width>=c.width*0.9)return {edge:'bottom',size:Math.max(0,c.bottom-p.top),free:Math.max(0,p.top-c.top)};
  return {edge:'left',size:Math.max(0,p.right-c.left),free:Math.max(0,c.right-p.right)};
}

// 確定はドラッグしている手元に置く。パネルの中だと、パネルを閉じた画面で押せない。
function makeBar({onConfirm,onCancel}){
  const bar=el('div',{className:'edit-bar'});
  const label=el('span',{className:'edit-bar-label',textContent:'位置を調整中'});
  const confirm=el('button',{type:'button',className:'primary',textContent:'この位置で確定'});
  const cancel=el('button',{type:'button',textContent:'やめる'});
  confirm.onclick=onConfirm;cancel.onclick=onCancel;
  bar.append(label,confirm,cancel);
  return {bar,say:text=>{label.textContent=text;}};
}

export function makeLocationEditor({map,notify,panel,collapse,stage}){
  let active=null;
  function stop(){
    if(!active)return;
    active.marker.remove();
    active.bar.remove();
    stage?.classList.remove('editing-location');
    active.onStop?.();
    active=null;
  }
  // 掴める地点は常にひとつ。別の記録を編集し始めたら前のつまみは消える。
  function start({lat,lng,origin,onStop,onConfirm,onCancel}){
    stop();
    const from=origin??(lat.value!==''&&lng.value!==''
      ? {lng:Number(lng.value),lat:Number(lat.value)}
      : map.getCenter());
    const marker=new gl.Marker({element:el('div',{className:'edit-pin'}),draggable:true})
      .setLngLat([from.lng,from.lat]).addTo(map);
    const {bar,say}=makeBar({
      onConfirm:()=>{const saving=onConfirm?.();stop();return saving;},
      onCancel:()=>{onCancel?.();stop();},
    });
    marker.on('drag',()=>{
      const p=marker.getLngLat();
      lat.value=p.lat.toFixed(6);lng.value=p.lng.toFixed(6);
      say(`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`);
    });
    // 確定バーは再生バーと同じ場所に出る。同時には使わないので、編集中は再生側を隠す。
    stage?.classList.add('editing-location');
    (stage??document.body).append(bar);
    active={marker,bar,onStop};
    const covered=coveredBy(panel,map);
    // 残る地図が狭すぎる画面ではパネルを閉じる。ピンと確定バーは地図に残る。
    const cramped=covered&&covered.free<MIN_GRAB_BAND;
    if(cramped)collapse?.();
    const padding=cramped||!covered?{}:{[covered.edge]:covered.size};
    focusPoint(map,[from.lng,from.lat],padding);
    notify?.('ピンをドラッグして位置を決め、「この位置で確定」を押してください');
    return marker;
  }
  return {start,stop,editing:()=>!!active};
}
