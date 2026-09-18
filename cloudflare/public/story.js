import {el, whoMarker, yen} from './shared.js';
import {gl} from './owner-map.js';
// 旅の再生(ストーリー): 1人の旅を記録1件ずつ追う。地図はその地点へ動き、線がそこまで伸び、ログカード(日時・場所・カテゴリ・メモ・金額・写真・累計)が切り替わる。
// 渡された steps だけを使う(他人は公開フィード由来、自分の旅は私的データ由来)。位置の無い記録は地図を動かさずカードだけ出す
const SPEEDS=[['1.7','ゆっくり'],['1','ふつう'],['0.5','はやい']];
const still=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.visibilityState==='hidden';// 動きを減らす設定・裏のタブでは、地図は一気に移す
export function makeStory(map,shell,{begin,end}){
  const root=el('div',{className:'story'}),chooser=el('div',{className:'story-choose'}),player=el('div',{className:'story-player',hidden:true});
  const progress=el('p',{className:'story-progress'}),card=el('article',{className:'story-card'}),seek=el('input',{type:'range',min:0,max:0,step:1,value:0}),controls=el('div',{className:'story-controls'});
  const prev=el('button',{type:'button',textContent:'⏮ 前へ'}),play=el('button',{type:'button',className:'primary',textContent:'▶ 再生'}),next=el('button',{type:'button',textContent:'次へ ⏭'}),speed=el('select'),share=el('button',{type:'button',className:'story-share',textContent:'リンクをコピー',hidden:true});
  for(const [value,label] of SPEEDS)speed.append(new Option(label,value));speed.value='1';speed.setAttribute('aria-label','再生の速さ');seek.setAttribute('aria-label','記録の位置');progress.setAttribute('role','status');
  controls.append(prev,play,next,speed);player.append(progress,seek,controls,card,share);root.append(chooser,player);
  let steps=[],index=0,playing=false,timer=0,frame=0,active=false,marker=null,styleReady=true,line=[],color='#216453',shareUrl=null,generation=0;
  const located=step=>step.lng!=null&&step.lat!=null;
  function drawLine(coords){
    if(!styleReady)return;const data={type:'FeatureCollection',features:coords.length>1?[{type:'Feature',geometry:{type:'LineString',coordinates:coords},properties:{}}]:[]};
    if(map.getSource('story'))map.getSource('story').setData(data);else map.addSource('story',{type:'geojson',data});
    if(!map.getLayer('story-line'))map.addLayer({id:'story-line',type:'line',source:'story',paint:{'line-color':color,'line-width':4,'line-opacity':.95},layout:{'line-cap':'round','line-join':'round'}});else map.setPaintProperty('story-line','line-color',color);
  }
  function paintCard(){
    const step=steps[index],first=steps[0],day=Math.round((Date.parse(step.date+'T00:00:00Z')-Date.parse(first.date+'T00:00:00Z'))/86400000)+1,spent=steps.slice(0,index+1).reduce((sum,s)=>sum+(s.spent??0),0);
    const when=step.at?new Date(step.at).toLocaleString('ja-JP',{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Asia/Tokyo'}):new Date(step.date+'T00:00:00+09:00').toLocaleDateString('ja-JP',{year:'numeric',month:'numeric',day:'numeric'});
    progress.textContent=`${index+1} / ${steps.length}　${day}日目 · ここまでの支出 ${yen(spent)}`;seek.value=String(index);
    card.replaceChildren(el('p',{className:'eyebrow',textContent:[when,step.category].filter(Boolean).join('・')}),el('h2',{textContent:step.place||'旅のひとこま'}));
    if(step.spent!=null)card.append(el('p',{className:'spent',textContent:yen(step.spent)}));
    if(step.memo)card.append(el('p',{className:'memo',textContent:step.memo}));
    for(const photo of step.photos||[])card.append(el('img',{src:photo.url,alt:photo.caption||'旅の写真',loading:'lazy'}));
    if(!located(step))card.append(el('p',{className:'hint',textContent:'この記録の位置は公開されていません（地図は動きません）'}));
    prev.disabled=index===0;next.disabled=index===steps.length-1;
  }
  // index の記録へ進む。animate のときは線を前の地点から伸ばし、地図も一緒に動かす
  function go(target,animate=false){
    cancelAnimationFrame(frame);index=Math.max(0,Math.min(steps.length-1,target));paintCard();
    const step=steps[index],done=steps.slice(0,index+1).filter(located).map(s=>[s.lng,s.lat]);
    if(!located(step)||!done.length){line=done;drawLine(line);if(done.length)marker?.setLngLat(done.at(-1));return 0;}
    const to=done.at(-1),from=line.length&&done.length>1?done.at(-2):null,zoom=Math.max(map.getZoom(),7),phone=innerWidth<=700,padding={top:0,left:0,right:0,bottom:phone?Math.round(map.getContainer().clientHeight*.35):0};
    if(!animate||still()||!from){line=done;drawLine(line);marker?.setLngLat(to);map.jumpTo({center:to,zoom,padding});return 0;}
    const duration=900*Number(speed.value),start=performance.now(),run=generation;map.easeTo({center:to,zoom,padding,duration});
    const tick=now=>{if(run!==generation)return;const k=Math.min(1,(now-start)/duration),at=[from[0]+(to[0]-from[0])*k,from[1]+(to[1]-from[1])*k];line=[...done.slice(0,-1),at];drawLine(line);marker?.setLngLat(at);if(k<1)frame=requestAnimationFrame(tick);else line=done;};
    frame=requestAnimationFrame(tick);return duration;
  }
  // 「移動」だけの記録は短く、メモや写真のある記録は長めに止まる
  const dwell=step=>((step.photos?.length||step.memo)?2600:step.category==='移動'?700:1500)*Number(speed.value);
  function schedule(wait){clearTimeout(timer);timer=setTimeout(()=>{if(!playing)return;if(index>=steps.length-1){pause();play.textContent='▶ もう一度';return;}const moved=go(index+1,true);schedule(moved+dwell(steps[index]));},wait);}
  function start(){if(index>=steps.length-1)go(0);playing=true;play.textContent='⏸ 一時停止';schedule(dwell(steps[index]));}
  function pause(){playing=false;clearTimeout(timer);play.textContent='▶ 再生';}
  function manual(target){pause();go(target,false);}
  play.onclick=()=>playing?pause():start();prev.onclick=()=>manual(index-1);next.onclick=()=>manual(index+1);seek.oninput=()=>manual(Number(seek.value));
  speed.onchange=()=>{if(playing)schedule(dwell(steps[index]));};
  share.onclick=async()=>{try{await navigator.clipboard.writeText(shareUrl);share.textContent='コピーしました';}catch{share.textContent=shareUrl;}setTimeout(()=>{share.textContent='リンクをコピー';},2500);};
  document.addEventListener('keydown',event=>{
    if(!active||player.hidden||event.target.closest?.('input,select,textarea,dialog')||event.metaKey||event.ctrlKey||event.altKey)return;
    if(event.key==='ArrowLeft'){event.preventDefault();manual(index-1);}else if(event.key==='ArrowRight'){event.preventDefault();manual(index+1);}else if(event.key===' '){event.preventDefault();play.click();}
  });
  function finish(){
    if(!active)return;active=false;generation++;pause();cancelAnimationFrame(frame);marker?.remove();marker=null;line=[];steps=[];
    if(map.getSource('story'))map.getSource('story').setData({type:'FeatureCollection',features:[]});
    shell.stage.classList.remove('story-on');if(shareUrl&&new URL(location.href).searchParams.has('play'))history.replaceState(null,'','/');shareUrl=null;end();
  }
  shell.drawer.addEventListener('viewchange',event=>{if(event.detail!=='story')finish();});
  map.on('basemapchanging',()=>{styleReady=false;});
  map.on('style.load',()=>{styleReady=true;if(active)drawLine(line);});
  function enter(title){if(!active){active=true;begin();shell.stage.classList.add('story-on');}shell.story(root,title);}
  // options: [{label,note,load:async()=>({title,steps,face,color,shareUrl})}]。1つならすぐ再生、複数なら選ぶ
  async function run(option){
    const run=++generation;chooser.replaceChildren(el('p',{className:'hint',textContent:'読み込み中…'}));player.hidden=true;
    let data;try{data=await option.load();}catch(error){chooser.replaceChildren(el('p',{className:'hint',textContent:error.message}));return;}
    if(run!==generation||!active)return;
    if(!data.steps.length){chooser.replaceChildren(el('p',{className:'hint',textContent:'再生できる記録がありません'}));return;}
    steps=data.steps;color=data.color||'#216453';shareUrl=data.shareUrl||null;share.hidden=!shareUrl;if(shareUrl)history.replaceState(null,'',shareUrl);
    chooser.replaceChildren();player.hidden=false;seek.max=String(steps.length-1);line=[];shell.story(root,data.title);
    marker?.remove();const pin=el('div',{className:'who-pin story-pin'}),face=el('div',{className:'who-button'});face.append(whoMarker({...data.face,color}));pin.append(face);
    const firstSpot=steps.find(located);marker=firstSpot?new gl.Marker({element:pin,anchor:'center'}).setLngLat([firstSpot.lng,firstSpot.lat]).addTo(map):null;
    go(0);start();
  }
  function open(title,options){
    finishQuiet();enter(title);player.hidden=true;
    if(options.length===1){run(options[0]);return;}
    chooser.replaceChildren(el('p',{className:'hint',textContent:'どの旅を再生しますか？'}));
    for(const option of options){const button=el('button',{type:'button',className:'story-option'});button.append(el('strong',{textContent:option.label}),el('span',{textContent:option.note||''}));button.onclick=()=>run(option);chooser.append(button);}
  }
  function finishQuiet(){generation++;pause();cancelAnimationFrame(frame);marker?.remove();marker=null;line=[];steps=[];if(map.getSource('story'))map.getSource('story').setData({type:'FeatureCollection',features:[]});}
  return {open,finish,active:()=>active,state:()=>({active,playing,index,total:steps.length,step:steps[index]||null}),go:manual};
}
