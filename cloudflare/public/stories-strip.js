import {el,whoMarker} from './shared.js';
export function makeStoriesStrip(stage,{state,onSelect}) {
 const root=el('nav',{className:'stories-strip'});root.setAttribute('aria-label','更新したユーザー');stage.append(root);
 function render(users){const s=state.state();root.replaceChildren();for(const user of users.filter(u=>state.visible(u.handle,u.self))){const b=el('button',{type:'button',className:'story-person'+(user.has_unread?' unread':'')+(s.selectedUser===user.handle?' selected':'')});b.dataset.handle=user.handle;b.setAttribute('aria-label',user.display_name+(user.has_unread?' 未読あり':''));b.append(whoMarker({image:user.icon_url,icon:user.icon,avatar:user.avatar_url,name:user.display_name,caption:user.display_name}));b.onclick=()=>onSelect(s.selectedUser===user.handle?null:user.handle);root.append(b);}root.hidden=!root.children.length;}
 return {root,render};
}
