export function el(tag, props={}) { return Object.assign(document.createElement(tag),props); }
// 現在地マーカー: アップロード画像 → 絵文字 → アバター画像 → 名前の頭文字。ユーザー入力は textContent だけで入れる
export function whoMarker({image,icon,avatar,name,caption,status,color}){
  const node=el('div',{className:'who-marker'}),face=el('span',{className:'who-face'});if(color)node.style.setProperty('--c',color);
  const initial=()=>{face.replaceChildren();face.textContent=[...(name||'?')][0].toUpperCase();};
  const emoji=()=>{face.replaceChildren();face.textContent=icon;face.classList.add('emoji');};
  const picture=(src,next)=>{const img=el('img',{alt:'',referrerPolicy:'no-referrer'});img.onerror=next;img.src=src;face.replaceChildren(img);};
  const rest=()=>icon?emoji():avatar?picture(avatar,initial):initial();
  if(image)picture(image,rest);else rest();
  node.append(face);if(caption)node.append(el('span',{className:'who-caption',textContent:caption}));if(status)node.append(el('span',{className:'who-status',textContent:status}));return node;
}
export const yen=value=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(value);
// サーバ側の不調(500台。D1の上限など)は、原因を問わず同じ案内にする。JSONでない応答でも落ちない
async function readResult(response){
  let result={};try{result=await response.json();}catch{}
  if(response.status>=500)result={error:'混み合っています。少し時間をおいてください'};
  return result;
}
export async function api(path,body,key=crypto.randomUUID()) {
  const response=await fetch('/api/private/'+path,body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
  const result=await readResult(response);
  if (response.status===403&&result.signup){location.href=result.signup;throw new Error(result.error);}
  if (response.status===401&&result.login){location.href=result.login+'?next='+encodeURIComponent(location.pathname+location.search);throw new Error('ログインが必要です');}
  if (!response.ok) { const error=new Error(result.error || '保存できませんでした');error.status=response.status;throw error; }
  return result;
}
export async function apiDelete(path) {
  const response=await fetch('/api/private/'+path,{method:'DELETE'});
  const result=await readResult(response);
  if (!response.ok) throw new Error(result.error || '削除できませんでした');
  return result;
}
// 「3時間前」。時刻が公開されていない記録(時間差公開など)は日付から日単位で出す
export function ago(entry,now=Date.now()){
  if(entry.at){const minutes=Math.max(0,Math.floor((now-Date.parse(entry.at))/60000));if(minutes<60)return minutes<2?'たった今':minutes+'分前';if(minutes<1440)return Math.floor(minutes/60)+'時間前';if(minutes<43200)return Math.floor(minutes/1440)+'日前';}
  const days=Math.floor((now-Date.parse(entry.date+'T00:00:00+09:00'))/86400000);
  return days<=0?'今日':days===1?'昨日':days<60?days+'日前':days<730?Math.floor(days/30)+'か月前':Math.floor(days/365)+'年前';
}
const jstDay=at=>new Date(at).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
// ステータスの1行。24時間より古ければ「（1日前）」を添える(自動では消さない)。無ければ null
export function statusLine(status,at,now=Date.now()){if(!status)return null;const old=at&&now-Date.parse(at)>86400000;return old?`${status}（${ago({at,date:jstDay(at)},now)}）`:status;}
