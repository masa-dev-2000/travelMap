import {el, whoMarker, yen} from './shared.js';
import {gl} from './owner-map.js';
// 自分用地図に、表示モード中の人の公開記録を控えめに重ねる。データは公開フィードだけ(非公開データは扱わない)
const HUES=[24,265,330,205,95,48,0,168];
const day=text=>new Date(text+'T00:00:00+09:00').toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'});
export function makeOwnerFriends(map,shell){
  let people=[],markers=[],styleReady=false,self=null,entries=[],on=true;
  try{on=localStorage.getItem('travelmap.friends')!=='off';}catch{}
  const toggle=el('button',{className:'friends-toggle',type:'button',textContent:'みんな'});document.querySelector('.map-stage').append(toggle);
  const note=el('span',{className:'friends-count'});shell.count.after(note);
  const popup=new gl.Popup({maxWidth:'280px',offset:24});
  const lines=()=>{
    const stamps=people.flatMap(p=>p.rows.map(r=>Date.parse(r.date))),first=Math.min(...stamps),span=Math.max(1,Math.max(...stamps)-first),features=[];
    for(const p of people)for(let i=1;i<p.rows.length;i++){const t=((Date.parse(p.rows[i-1].date)+Date.parse(p.rows[i].date))/2-first)/span;
      features.push({type:'Feature',geometry:{type:'LineString',coordinates:[[p.rows[i-1].longitude,p.rows[i-1].latitude],[p.rows[i].longitude,p.rows[i].latitude]]},properties:{color:`hsl(${p.hue} ${55+30*t}% ${62-24*t}%)`,opacity:+(.15+.8*t).toFixed(3)}});}
    return {type:'FeatureCollection',features};
  };
  function draw(){
    if(!styleReady)return;
    const data=on?lines():{type:'FeatureCollection',features:[]};
    if(map.getSource('friends-segments'))map.getSource('friends-segments').setData(data);else map.addSource('friends-segments',{type:'geojson',data});
    if(!map.getLayer('friends-line'))map.addLayer({id:'friends-line',type:'line',source:'friends-segments',paint:{'line-color':['get','color'],'line-width':1.5,'line-opacity':['get','opacity']},layout:{'line-cap':'round'}},map.getLayer('travel-line')?'travel-line':undefined);
  }
  function detail(p){
    const node=el('div',{className:'friend-detail'});node.append(el('strong',{textContent:p.name}));
    for(const r of p.rows.slice(-4).reverse()){const item=el('div',{className:'friend-entry'});item.append(el('time',{textContent:[r.date,r.category_name].filter(Boolean).join('・')}),el('b',{textContent:r.place_name||'旅のひとこま'}));
      if(r.spent_jpy!=null)item.append(el('span',{className:'spent',textContent:yen(r.spent_jpy)}));if(r.memo)item.append(el('p',{textContent:r.memo}));node.append(item);}
    const last=p.rows.at(-1);popup.setLngLat([last.longitude,last.latitude]).setDOMContent(node).addTo(map);
  }
  function show(){
    markers.forEach(m=>m.remove());markers=[];popup.remove();
    if(on)for(const p of people){const last=p.rows.at(-1),button=el('button',{type:'button',className:'who-button friend-marker',title:p.name});button.dataset.handle=p.author;
      button.append(whoMarker({image:last.author_icon_url,icon:last.author_icon,avatar:last.author_avatar,name:p.name,caption:p.name+' '+day(last.date),color:`hsl(${p.hue} 70% 35%)`}));button.onclick=event=>{event.stopPropagation();detail(p);};
      markers.push(new gl.Marker({element:button,anchor:'top',offset:[0,-19]}).setLngLat([last.longitude,last.latitude]).addTo(map));}
    toggle.setAttribute('aria-pressed',String(on));note.textContent=on&&people.length?` · みんな ${people.length}人`:'';draw();
  }
  function group(){
    const located=entries.filter(e=>e.author!==self&&e.latitude!=null&&e.longitude!=null),authors=[...new Set(located.map(e=>e.author))].sort();
    people=authors.map((author,i)=>{const rows=located.filter(e=>e.author===author).reverse().sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);return {author,name:rows.at(-1).author_name||author,hue:HUES[i%HUES.length],rows};});show();
  }
  toggle.onclick=()=>{on=!on;try{localStorage.setItem('travelmap.friends',on?'on':'off');}catch{}show();};
  map.on('basemapchanging',()=>{styleReady=false;});
  map.on('style.load',()=>{styleReady=true;draw();});
  async function load(){try{const response=await fetch('/api/public/entries');if(!response.ok)return;entries=(await response.json()).entries||[];group();}catch{}}
  show();load();
  return {setSelf:handle=>{self=handle;group();},points:()=>on?people.flatMap(p=>p.rows.map(r=>[r.longitude,r.latitude])):[]};
}
