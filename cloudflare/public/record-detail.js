import {el,whoMarker,yen,ago} from '/shared.js';

// 記録1件の画面。自分のものと他人のもので中身は変わるが、入れ物は同じにする。
// 別実装にすると、地図のピンから来たときと一覧から来たときで見え方が割れる。

const PUBLIC_PHOTO=/^\/api\/public\/photos\/[a-z0-9-]+$/;

function when(entry){
  if(entry.at)return new Date(entry.at).toLocaleString('ja-JP');
  return entry.date||'';
}

function facts(pairs){
  const box=el('div',{className:'detail-facts'});
  for(const [label,value] of pairs){
    if(value===null||value===undefined||value==='')continue;
    const cell=el('div',{className:'detail-fact'});
    cell.append(el('span',{className:'label',textContent:label}),el('span',{className:'value',textContent:String(value)}));
    box.append(cell);
  }
  return box.children.length?box:null;
}

function photos(list){
  const shown=(list||[]).filter(p=>PUBLIC_PHOTO.test(p.url||''));
  if(!shown.length)return null;
  const box=el('div',{className:'detail-photos'});
  for(const photo of shown)box.append(el('img',{src:photo.url,alt:photo.caption||'旅の写真',loading:'lazy'}));
  return box;
}

// 他人の記録。公開された分だけを読む。作者から人物へ辿れる。
export function otherRecordDetail(entry,{onAuthor,onPlay}={}){
  const article=el('article',{className:'record-detail'});
  const author=el('button',{type:'button',className:'detail-author'});
  author.append(whoMarker({image:entry.author_icon_url,avatar:entry.author_avatar,name:entry.author_name||entry.author}),
    el('span',{className:'detail-author-name',textContent:entry.author_name||entry.author}));
  if(entry.author_status)author.append(el('span',{className:'detail-author-status',textContent:entry.author_status}));
  if(onAuthor)author.onclick=()=>onAuthor(entry.author);else author.disabled=true;
  article.append(author);

  if(entry.category_name)article.append(el('p',{className:'eyebrow',textContent:entry.category_name}));
  article.append(el('h2',{textContent:entry.place_name||'旅のひとこま'}));
  const stamp=el('time',{textContent:when(entry)});
  if(entry.date)stamp.append(el('span',{className:'detail-ago',textContent:' · '+ago(entry)}));
  article.append(stamp);

  const gallery=photos(entry.photos);if(gallery)article.append(gallery);
  if(entry.memo)article.append(el('p',{className:'memo',textContent:entry.memo}));
  const table=facts([['旅の名前',entry.trip_name],['金額',entry.spent_jpy==null?null:yen(entry.spent_jpy)]]);
  if(table)article.append(table);

  if(onPlay){
    const play=el('button',{type:'button',className:'primary detail-play',textContent:'この人の記録を再生'});
    play.onclick=()=>onPlay(entry.author);
    article.append(play);
  }
  return article;
}

// 自分の記録。公開状態や添付まで見えて、そこから編集へ入る。
// 中身の組み立ては呼び出し側から渡す。ここが編集フォームの作り方まで知ると、
// 一覧と詳細の両方から同じ巨大な関数を呼ぶことになる。
export function ownRecordDetail(item,{badge,onEdit,extras=[]}={}){
  const article=el('article',{className:'record-detail own'});
  if(item.category_name)article.append(el('p',{className:'eyebrow',textContent:item.category_name}));
  article.append(el('h2',{textContent:item.observed_place_name||item.category_name||'記録'}));
  article.append(el('time',{textContent:new Date(item.occurred_at).toLocaleString('ja-JP')}));
  if(badge)article.append(el('span',{className:'badge',textContent:badge}));
  if(item.memo)article.append(el('p',{className:'memo',textContent:item.memo}));
  const table=facts([
    ['旅の名前',item.trip_name],
    ['評価',item.rating==null?null:'★'.repeat(item.rating)],
    ['金額',item.spent_jpy==null?null:yen(item.spent_jpy)],
    ['緯度・経度',item.latitude==null?null:`${item.latitude}, ${item.longitude}`],
  ]);
  if(table)article.append(table);
  if(onEdit){
    const edit=el('button',{type:'button',className:'primary detail-edit',textContent:'編集する'});
    edit.onclick=onEdit;article.append(edit);
  }
  for(const node of extras)if(node)article.append(node);
  return article;
}
