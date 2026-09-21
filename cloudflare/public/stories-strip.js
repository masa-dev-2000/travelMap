import {el,whoMarker} from './shared.js';
export function makeStoriesStrip(stage,{state}) {
  const root=el('nav',{className:'stories-strip'});root.setAttribute('aria-label','更新したユーザー');stage.append(root);
  function render(s=state.state()){
    const scroll=root.scrollLeft,focused=root.contains(document.activeElement)?document.activeElement?.dataset.handle:null;
    root.replaceChildren();
    for(const user of s.users){
      const selected=s.selectedUser===user.handle;
      const button=el('button',{type:'button',className:'story-person'+(user.has_unread?' unread':'')+(selected?' selected':'')});
      button.dataset.handle=user.handle;button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-label',user.display_name+(user.has_unread?' 未読あり':' 既読'));
      button.append(whoMarker({image:user.icon_url,avatar:user.avatar_url,name:user.display_name,caption:user.display_name}));
      button.onclick=()=>state.select(state.state().selectedUser===user.handle?null:user.handle);root.append(button);
    }
    root.hidden=!s.users.length;root.scrollLeft=scroll;
    if(focused)[...root.children].find(n=>n.dataset.handle===focused)?.focus({preventScroll:true});
  }
  const unsubscribe=state.subscribe(render);render();
  return {root,render,destroy(){unsubscribe();root.remove();}};
}
