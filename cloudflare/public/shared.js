export function el(tag, props={}) { return Object.assign(document.createElement(tag),props); }
// 現在地マーカー: アップロード画像 → 絵文字 → アバター画像 → 名前の頭文字。ユーザー入力は textContent だけで入れる
export function whoMarker({image,icon,avatar,name,caption,color}){
  const node=el('div',{className:'who-marker'}),face=el('span',{className:'who-face'});if(color)node.style.setProperty('--c',color);
  const initial=()=>{face.replaceChildren();face.textContent=[...(name||'?')][0].toUpperCase();};
  const emoji=()=>{face.replaceChildren();face.textContent=icon;face.classList.add('emoji');};
  const picture=(src,next)=>{const img=el('img',{alt:'',referrerPolicy:'no-referrer'});img.onerror=next;img.src=src;face.replaceChildren(img);};
  const rest=()=>icon?emoji():avatar?picture(avatar,initial):initial();
  if(image)picture(image,rest);else rest();
  node.append(face);if(caption)node.append(el('span',{className:'who-caption',textContent:caption}));return node;
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
