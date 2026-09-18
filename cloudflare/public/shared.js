export function el(tag, props={}) { return Object.assign(document.createElement(tag),props); }
export function makeMap() {
  const map=L.map('map').setView([35.5,134.5],6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
  return map;
}
export function pin(map, item, openRecord) {
  const node=el('div'); node.append(el('strong',{textContent:item.place_name || item.observed_place_name || '記録した場所'}),el('p',{textContent:item.memo}));
  if(openRecord){const button=el('button',{type:'button',textContent:'記録を開く'});button.onclick=()=>{map.closePopup();openRecord();};node.append(button);}
  return L.circleMarker([item.latitude,item.longitude],{radius:4,weight:1.5,color:'#216453',fillOpacity:.8}).addTo(map).bindPopup(node);
}
export const yen=value=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(value);
export async function api(path,body,key=crypto.randomUUID()) {
  const response=await fetch('/api/private/'+path,body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
  const result=await response.json();
  if (response.status===401&&result.login){location.href=result.login+'?next='+encodeURIComponent(location.pathname+location.search);throw new Error('ログインが必要です');}
  if (!response.ok) throw new Error(result.error || '保存できませんでした');
  return result;
}
export async function apiDelete(path) {
  const response=await fetch('/api/private/'+path,{method:'DELETE'});
  const result=await response.json();
  if (!response.ok) throw new Error(result.error || '削除できませんでした');
  return result;
}
