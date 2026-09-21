import {el,ago,whoMarker} from './shared.js';
import {gl} from './owner-map.js';
import {publicPoint} from './record-display.js';
import {mapRecordCard} from './map-record-card.js';
import {withinPeriod} from './viewer-state.js';
export {ago};
const COLORS=['#a95013','#6934b5','#ba376f','#287495','#698326','#7b6318'];
const LABELS={7:'1週間',30:'1か月',90:'3か月',all:'全期間',custom:'期間指定'};
const located=e=>Number.isFinite(e.latitude)&&Number.isFinite(e.longitude);
export const publicStep=e=>({id:e.id,publicEntryId:e.id,publication_seq:e.publication_seq,author:e.author,source:'public',date:e.date,at:e.at,place:e.place_name,category:e.category_name,memo:e.memo,spent:e.spent_jpy,photos:e.photos||[],lng:e.longitude,lat:e.latitude});
export function makeEveryone(map,shell,{state,authenticated=false,onFilter=()=>{},onOpenPerson=()=>{},onPlay=()=>{},onRead=()=>{},notify=()=>{}}){
  let failed=false,loaded=false,loading=0,request=null,replaying=false,styleReady=false,markers=[],groups=[];
  const cards=mapRecordCard(map,shell),anonymousOrder=new Map();let nextAnonSeq=0;
  const chip=el('select',{className:'period-chip'});chip.setAttribute('aria-label','表示する期間');
  for(const [value,label] of Object.entries(LABELS))chip.append(new Option(label,value));shell.heading.append(chip);
  const selection=el('button',{className:'selected-person',type:'button',hidden:true});selection.onclick=()=>state.select(null);shell.heading.append(selection);
  const color=handle=>COLORS[[...handle].reduce((a,c)=>a+c.charCodeAt(0),0)%COLORS.length];
  function filter(){const s=state.state();return {person:s.selectedUser||'',period:s.period.preset,from:s.period.from,to:s.period.to,active:!!(s.selectedUser||s.period.from||s.period.to),trip:'',category:''};}
  function visibleGroups(s=state.state()){
    return s.users.filter(u=>!s.selectedUser||u.handle===s.selectedUser).map(user=>{
      const all=s.entries.filter(e=>e.author===user.handle),rows=all.filter(e=>withinPeriod(e,s.period)).sort((a,b)=>a.date.localeCompare(b.date)||(a.at||'').localeCompare(b.at||'')||a.publication_seq-b.publication_seq);
      const points=rows.filter(located),last=points.at(-1)||(!s.selectedUser?all.filter(located).sort((a,b)=>a.date.localeCompare(b.date)).at(-1):null);
      return {user,rows,points,last};
    });
  }
  function draw(){
    if(!styleReady)return;const features=[];
    if(!replaying)for(const g of groups)for(let i=1;i<g.points.length;i++)features.push({type:'Feature',geometry:{type:'LineString',coordinates:[[g.points[i-1].longitude,g.points[i-1].latitude],[g.points[i].longitude,g.points[i].latitude]]},properties:{color:color(g.user.handle)}});
    const data={type:'FeatureCollection',features};
    if(map.getSource('friends-segments'))map.getSource('friends-segments').setData(data);else map.addSource('friends-segments',{type:'geojson',data});
    if(!map.getLayer('friends-line'))map.addLayer({id:'friends-line',type:'line',source:'friends-segments',paint:{'line-color':['get','color'],'line-width':2,'line-opacity':.7},layout:{'line-cap':'round','line-join':'round'}});
  }
  function detail(entry){
    const article=el('article',{className:'record-detail'});
    article.append(el('time',{textContent:entry.at?new Date(entry.at).toLocaleString('ja-JP'):entry.date}),el('h2',{textContent:entry.place_name||'旅のひとこま'}),el('p',{className:'memo',textContent:entry.memo||''}));
    for(const photo of entry.photos||[]){if(/^\/api\/public\/photos\/[a-z0-9-]+$/.test(photo.url||''))article.append(el('img',{src:photo.url,alt:photo.caption||'旅の写真',loading:'lazy'}));}
    shell.view('record',article,'記録の詳細');
    if(!document.hidden)void Promise.resolve(onRead(publicStep(entry))).catch(e=>notify(e.message));
  }
  function showEntry(entry){
    const point=publicPoint(entry);if(!point){detail(entry);return;}
    cards.show(point,{openDetail:()=>detail(entry),extra:{label:'この人の記録を再生',action:()=>{state.select(entry.author);onPlay(entry.author);}},onPresented:()=>{
      setTimeout(()=>{if(cards.visible(point.key))void Promise.resolve(onRead(publicStep(entry))).catch(e=>notify(e.message));},400);
    }});onOpenPerson(entry.author);
  }
  function render(s,reason){
    chip.value=s.period.preset;
    const user=s.users.find(u=>u.handle===s.selectedUser);
    selection.hidden=!user;selection.textContent=user?user.display_name+' ×':'';selection.setAttribute('aria-label','人物の選択を解除');
    const count=s.entries.filter(e=>(!s.selectedUser||e.author===s.selectedUser)&&withinPeriod(e,s.period)).length;
    shell.count.textContent=failed?'取得できません':`${count}件`;
    if(reason==='read')return;
    if(['selection','period','mute','identity','error'].includes(reason))cards.hide();
    groups=visibleGroups(s);markers.forEach(m=>m.remove());markers=[];
    if(!replaying)for(const g of groups){if(!g.last)continue;const button=el('button',{type:'button',className:'who-button friend-marker'});button.dataset.handle=g.user.handle;button.setAttribute('aria-label',g.user.display_name+'の記録');
      button.append(whoMarker({image:g.user.icon_url,avatar:g.user.avatar_url,name:g.user.display_name,caption:g.user.display_name,color:color(g.user.handle)}));
      button.onclick=event=>{event.stopPropagation();state.select(g.user.handle);showEntry(g.last);};
      const node=el('div',{className:'who-pin'});node.append(button);markers.push(new gl.Marker({element:node}).setLngLat([g.last.longitude,g.last.latitude]).addTo(map));
    }
    draw();if(['selection','period','mute','identity','feed'].includes(reason))onFilter(filter());
  }
  const subscription=state.subscribe(render);
  chip.onchange=()=>{
    if(chip.value!=='custom'){state.setPeriod(chip.value);try{localStorage.setItem('travelmap.period',chip.value);}catch{}return;}
    const s=state.state(),form=el('form',{className:'form-grid'}),from=el('input',{type:'date',value:s.period.from,required:true}),to=el('input',{type:'date',value:s.period.to,required:true}),save=el('button',{textContent:'この期間を表示'});
    from.setAttribute('aria-label','期間の開始日');to.setAttribute('aria-label','期間の終了日');form.append(from,to,save);
    form.onsubmit=event=>{event.preventDefault();try{state.setPeriod('custom',from.value,to.value);shell.hide();}catch(e){notify(e.message);}};
    chip.value=s.period.preset;shell.view('period',form,'表示する期間');
  };
  function cancelReload(){loading++;request?.abort();request=null;}
  async function reload({signal}={}){
    const run=++loading;request?.abort();request=new AbortController();const controller=request,cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)controller.abort();
    try{
      const response=await fetch(authenticated?'/api/private/viewer-feed':'/api/public/entries',{signal:controller.signal,cache:'no-store'});
      const data=await response.json();if(authenticated&&[401,403].includes(response.status))document.dispatchEvent(new Event('tm:auth-lost'));if(!response.ok)throw new Error(data.error||'人物情報を取得できません');if(run!==loading||signal?.aborted)return false;
      if(!authenticated){
        if(!Array.isArray(data.entries))throw new Error('公開記録の応答を確認できません');
        for(const e of data.entries.slice().reverse())if(!anonymousOrder.has(e.id))anonymousOrder.set(e.id,++nextAnonSeq);
        data.entries=data.entries.map(e=>({...e,publication_seq:anonymousOrder.get(e.id),unread:true}));data.muted=[];data.self=null;
      }
      failed=false;loaded=true;state.replaceFeed(data);return true;
    }catch(e){if(run===loading&&e.name!=='AbortError'){failed=true;state.fail(e.message);notify(e.message);}return false;}
    finally{signal?.removeEventListener('abort',cancel);}
  }
  function storyOptions(handle){
    const s=state.state();if(!state.visible(handle))return [];const rows=s.entries.filter(e=>e.author===handle).sort((a,b)=>a.date.localeCompare(b.date)||(a.at||'').localeCompare(b.at||'')||a.publication_seq-b.publication_seq),user=s.users.find(u=>u.handle===handle);if(!rows.length||!user)return [];
    const option=(label,source,trip)=>({label,trip,load:async()=>groupData({user,rows:source})});
    const result=[...new Set(rows.map(e=>e.trip_name).filter(Boolean))].map(trip=>option(trip,rows.filter(e=>e.trip_name===trip),trip));
    result.push(option('すべての公開記録',rows,''));return result;
  }
  function groupData({user,rows}){
    return {title:user.display_name+'の記録',author:user.handle,source:'public',steps:rows.map(publicStep),face:{image:user.icon_url,avatar:user.avatar_url,name:user.display_name},color:color(user.handle)};
  }
  map.on('basemapchanging',()=>{styleReady=false;});map.on('style.load',()=>{styleReady=true;draw();});
  render(state.state(),'init');const ready=reload();
  return {ready,reload,cancelReload,groupData,storyOptions,detail,showEntry,available:()=>!failed,count:()=>state.state().users.length,shownCount:()=>groups.reduce((n,g)=>n+g.rows.length,0),filter,
    countText:(n,m)=>`${n}件 / 全${m}件`,setSelf:handle=>state.setSelf(handle),selectPerson:handle=>state.select(handle),
    points:()=>groups.flatMap(g=>(g.points.length?g.points:g.last?[g.last]:[]).map(e=>[e.longitude,e.latitude])),
    setReplay:value=>{replaying=value;if(value){markers.forEach(m=>m.remove());markers=[];}else render(state.state(),'replay-end');draw();},destroy(){request?.abort();subscription();markers.forEach(m=>m.remove());}};
}
