import {el} from './shared.js';

// groups: {id,label,icon,nodes,action?,small?}. action() が true を返したらドロワーを開かない(別ページへの移動など)
export function mapShell(groups) {
  const css=el('link',{rel:'stylesheet',href:'/map-shell.css'});document.head.append(css);
  document.body.classList.add('map-app');
  const mapNode=document.querySelector('#map'),message=document.querySelector('#message');
  const stage=el('main',{className:'map-stage'}),rail=el('nav',{className:'map-rail'});
  rail.setAttribute('aria-label','地図のメニュー');
  const heading=el('div',{className:'map-heading',textContent:'TravelMap'});
  const count=el('span',{id:'map-count',textContent:'読み込み中…'});heading.append(count);
  const drawer=el('aside',{className:'map-drawer',inert:true}),backdrop=el('div',{className:'pane-backdrop'}),grip=el('div',{className:'pane-grip'});// PC は右ペイン、スマホは下からのシート(見た目は CSS)。閉じている間は inert
  drawer.setAttribute('aria-label','操作パネル');
  const bar=el('div',{className:'drawer-heading'}),title=el('h1'),close=el('button',{textContent:'×',type:'button'});
  close.setAttribute('aria-label','パネルを閉じる');bar.append(title,close);
  const contents=el('div',{className:'drawer-body'});drawer.append(grip,bar,contents);
  let active=null;
  const buttons=new Map(),panels=new Map();
  function hide(){drawer.inert=true;stage.classList.remove('pane-open');buttons.get(active)?.setAttribute('aria-expanded','false');buttons.get(active)?.classList.remove('active');buttons.get(active)?.focus({preventScroll:true});active=null;drawer.dispatchEvent(new CustomEvent('viewchange',{detail:null}));}
  function open(id){
    if(!panels.has(id))return;
    for(const [key,node] of panels)node.hidden=key!==id;
    for(const [key,button] of buttons){button.classList.toggle('active',key===id);button.setAttribute('aria-expanded',String(key===id));}
    active=id;title.textContent=id==='route'?'移動の記録':groups.find(g=>g.id===id).title||groups.find(g=>g.id===id).label;drawer.inert=false;drawer.style.transform='';stage.classList.add('pane-open');drawer.dispatchEvent(new CustomEvent('viewchange',{detail:id}));close.focus({preventScroll:true});
  }
  for(const group of groups){
    const button=el('button',{type:'button'});button.append(el('span',{className:'rail-icon',textContent:group.icon}),el('span',{className:group.small?'rail-small':'',textContent:group.label}));
    button.setAttribute('aria-label',group.title||group.label);button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','view-'+group.id);
    const view=el('div',{id:'view-'+group.id,hidden:true});for(const node of group.nodes)if(node)view.append(node);
    button.onclick=()=>{if(group.action?.())return;active===group.id?hide():open(group.id);};rail.append(button);contents.append(view);buttons.set(group.id,button);panels.set(group.id,view);
  }
  const fit=el('button',{id:'fit-map',type:'button'});fit.setAttribute('aria-label','記録全体を表示');fit.append(el('span',{className:'rail-icon',textContent:'⌖'}),el('span',{textContent:'全体'}));rail.append(fit);
  stage.append(mapNode,heading,rail,backdrop,drawer,message);
  for(const node of [...document.body.children])if(node.tagName!=='SCRIPT'&&node.tagName!=='DIALOG')node.remove();
  document.body.append(stage);close.onclick=hide;backdrop.onclick=hide;
  // スマホ: つまみ・見出しを下へ引くと閉じる(80px以上)。本文のスクロールとは干渉させない
  let dragY=null;
  for(const node of [grip,bar]){
    node.addEventListener('touchstart',event=>{if(innerWidth<=700&&!event.target.closest('button'))dragY=event.touches[0].clientY;},{passive:true});
    node.addEventListener('touchmove',event=>{if(dragY===null)return;const dy=Math.max(0,event.touches[0].clientY-dragY);drawer.style.transition='none';drawer.style.transform=`translateY(${dy}px)`;},{passive:true});
    const end=event=>{if(dragY===null)return;const dy=(event.changedTouches[0]?.clientY??dragY)-dragY;dragY=null;drawer.style.transition='';drawer.style.transform='';if(dy>80)hide();};
    node.addEventListener('touchend',end);node.addEventListener('touchcancel',end);
  }
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]'))hide();});
  const resize=()=>{document.body.style.height=Math.floor(window.visualViewport?.height||innerHeight)+'px';document.body.classList.toggle('keyboard-compact',innerWidth<=700&&!!document.activeElement?.closest('form')&&(window.visualViewport?.height||innerHeight)<500);};
  window.visualViewport?.addEventListener('resize',resize);document.addEventListener('focusin',resize);document.addEventListener('focusout',resize);resize();
  function detail(node){if(!panels.has('route')){const view=el('div',{hidden:true});contents.append(view);panels.set('route',view);}panels.get('route').replaceChildren(node);open('route');contents.scrollTop=0;}
  return {open,hide,count,fit,drawer,detail,rail,heading,stage,button:id=>buttons.get(id)};
}
