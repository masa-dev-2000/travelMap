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
  const drawer=el('aside',{className:'map-drawer',hidden:true});
  drawer.setAttribute('aria-label','操作パネル');
  const bar=el('div',{className:'drawer-heading'}),title=el('h1'),close=el('button',{textContent:'×',type:'button'});
  close.setAttribute('aria-label','パネルを閉じる');bar.append(title,close);
  const contents=el('div',{className:'drawer-body'});drawer.append(bar,contents);
  let active=null;
  const buttons=new Map(),panels=new Map();
  function hide(){drawer.hidden=true;buttons.get(active)?.setAttribute('aria-expanded','false');buttons.get(active)?.classList.remove('active');buttons.get(active)?.focus({preventScroll:true});active=null;drawer.dispatchEvent(new CustomEvent('viewchange',{detail:null}));}
  function open(id){
    if(!panels.has(id))return;
    for(const [key,node] of panels)node.hidden=key!==id;
    for(const [key,button] of buttons){button.classList.toggle('active',key===id);button.setAttribute('aria-expanded',String(key===id));}
    active=id;title.textContent=id==='route'?'移動の記録':groups.find(g=>g.id===id).title||groups.find(g=>g.id===id).label;drawer.hidden=false;drawer.dispatchEvent(new CustomEvent('viewchange',{detail:id}));close.focus({preventScroll:true});
  }
  for(const group of groups){
    const button=el('button',{type:'button'});button.append(el('span',{className:'rail-icon',textContent:group.icon}),el('span',{className:group.small?'rail-small':'',textContent:group.label}));
    button.setAttribute('aria-label',group.title||group.label);button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','view-'+group.id);
    const view=el('div',{id:'view-'+group.id,hidden:true});for(const node of group.nodes)if(node)view.append(node);
    button.onclick=()=>{if(group.action?.())return;active===group.id?hide():open(group.id);};rail.append(button);contents.append(view);buttons.set(group.id,button);panels.set(group.id,view);
  }
  const fit=el('button',{id:'fit-map',type:'button'});fit.setAttribute('aria-label','記録全体を表示');fit.append(el('span',{className:'rail-icon',textContent:'⌖'}),el('span',{textContent:'全体'}));rail.append(fit);
  stage.append(mapNode,heading,rail,drawer,message);
  for(const node of [...document.body.children])if(node.tagName!=='SCRIPT'&&node.tagName!=='DIALOG')node.remove();
  document.body.append(stage);close.onclick=hide;
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]'))hide();});
  const resize=()=>{document.body.style.height=Math.floor(window.visualViewport?.height||innerHeight)+'px';document.body.classList.toggle('keyboard-compact',innerWidth<=600&&!!document.activeElement?.closest('form')&&(window.visualViewport?.height||innerHeight)<500);};
  window.visualViewport?.addEventListener('resize',resize);document.addEventListener('focusin',resize);document.addEventListener('focusout',resize);resize();
  function detail(node){if(!panels.has('route')){const view=el('div',{hidden:true});contents.append(view);panels.set('route',view);}panels.get('route').replaceChildren(node);open('route');contents.scrollTop=0;}
  return {open,hide,count,fit,drawer,detail,rail,heading,stage,button:id=>buttons.get(id)};
}
