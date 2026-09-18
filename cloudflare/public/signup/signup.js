import {api,el} from '/shared.js';
// 初回登録の3ステップ(同意→プロフィール→見せ方)。保存は最後の1回だけ。ユーザー入力は textContent / value だけで扱う
const $=selector=>document.querySelector(selector),message=$('#message');
// 見た目の確認用。ローカルホストのときだけ有効で、保存もアカウントの削除も呼ばない
const preview=['localhost','127.0.0.1'].includes(location.hostname)&&new URLSearchParams(location.search).get('preview')==='1';
let user={display_name:'',handle:'',avatar_url:null,icon:null},iconBlob=null,iconPreview=null,busy=false;
const say=text=>{message.textContent=text;};
function show(step){for(const n of [1,2,3])$('#step-'+n).hidden=n!==step;[...$('#dots').children].forEach((dot,index)=>dot.classList.toggle('on',index===step-1));say('');scrollTo(0,0);}
// アイコンの見本: 選んだ画像 → 絵文字 → Googleの写真 → 名前の頭文字
function paintFace(){
  const face=$('#face'),emoji=$('#emoji').value.trim(),initial=()=>{face.replaceChildren();face.textContent=[...($('#display-name').value.trim()||'?')][0].toUpperCase();};
  const picture=src=>{const img=el('img',{alt:'',referrerPolicy:'no-referrer'});img.onerror=initial;img.src=src;face.replaceChildren(img);};
  if(iconPreview)picture(iconPreview);else if(emoji){face.replaceChildren();face.textContent=emoji;}else if(user.avatar_url)picture(user.avatar_url);else initial();
}
$('#accept').onchange=event=>{$('#agree').disabled=!event.currentTarget.checked;};
$('#agree').onclick=()=>show(2);
for(const back of document.querySelectorAll('.back'))back.onclick=()=>show(Number(back.dataset.to));
$('#decline').onclick=async()=>{
  if(busy)return;if(preview){location.href='/';return;}
  if(!confirm('同意しない場合、いま作ったアカウントを削除して地図に戻ります。よろしいですか？'))return;
  busy=true;try{await api('signup/cancel',{});location.href='/';}catch(error){say(error.message);}finally{busy=false;}
};
// 正方形に中央クロップして256pxのPNGにする（canvas経由なのでEXIFは残らない）。送るのは登録の保存が済んでから
$('#icon-file').onchange=async event=>{const input=event.currentTarget,file=input.files[0];if(!file)return;try{const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}),side=Math.min(bitmap.width,bitmap.height),canvas=el('canvas',{width:256,height:256});canvas.getContext('2d').drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,256,256);bitmap.close();const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob||blob.size>512*1024)throw new Error('画像が大きすぎます');iconBlob=blob;if(iconPreview)URL.revokeObjectURL(iconPreview);iconPreview=URL.createObjectURL(blob);paintFace();say('');}catch(error){say(`この画像は使えません：${error.message}`);}finally{input.value='';}};
$('#emoji').oninput=paintFace;$('#display-name').oninput=paintFace;
$('#to-3').onclick=()=>{
  if(!$('#display-name').value.trim()){say('表示名を入れてください');return;}
  if(!/^[a-z0-9][a-z0-9-]{1,23}$/.test($('#handle').value.trim())){say('ハンドルは英小文字・数字・ハイフンで2〜24文字です');return;}
  show(3);
};
$('#finish').onclick=async()=>{
  if(busy)return;if(preview){say('確認用の表示です（保存しません）');return;}
  busy=true;$('#finish').disabled=true;say('保存中…');
  const body={accept:true,display_name:$('#display-name').value.trim(),handle:$('#handle').value.trim(),map_visible:$('#map-visible').checked,publish_default:$('#publish-default').checked,publish_precision:$('#publish-precision').value};
  if($('#emoji').value.trim())body.icon=$('#emoji').value.trim();
  try{
    await api('signup',body);
    // 画像は同意の保存後にだけ受け付けられる。失敗しても登録は済んでいるので先へ進む(設定からやり直せる)
    if(iconBlob)try{await fetch('/api/private/icon',{method:'POST',headers:{'Content-Type':'image/png'},body:iconBlob});}catch{}
    location.href='/';
  }catch(error){
    $('#finish').disabled=false;busy=false;
    if(/ハンドル|表示名|アイコン/.test(error.message))show(2);
    say(error.message);
  }
};
try{
  const data=await api('bootstrap');user=data.user;
  $('#display-name').value=user.display_name||'';$('#handle').value=user.handle||'';$('#emoji').value=user.icon||'';
}catch(error){say(error.message);}
paintFace();
