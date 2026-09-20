import {el,api} from './shared.js';
export function makeViewerSettings({state,reload,cancelReload=()=>{},notify,authenticated,slot}){
  let generation=0;
  async function render(){
    const run=++generation;slot.replaceChildren();
    if(!authenticated){slot.append(el('p',{className:'hint',textContent:'ミュート設定の保存にはログインが必要です'}));return;}
    slot.append(el('p',{textContent:'読み込み中…'}));
    try{
      const data=await api('mutes');if(run!==generation)return;
      if(!Array.isArray(data.users))throw new Error('ミュート設定を取得できません');slot.replaceChildren();
      for(const person of data.users){
        const label=el('label',{className:'mute-user'}),input=el('input',{type:'checkbox',checked:!!person.muted});input.dataset.handle=person.handle;
        input.setAttribute('aria-label',person.display_name+'をミュート');label.append(el('span',{textContent:person.display_name}),input);slot.append(label);
        input.onchange=async()=>{const wanted=input.checked,previous=state.state().muted.has(person.handle);input.disabled=true;cancelReload();state.setMuted(person.handle,wanted);
          try{await api('mutes',{handle:person.handle,muted:wanted});await reload();}
          catch(e){input.checked=previous;state.setMuted(person.handle,previous);notify(e.message);}
          finally{input.disabled=false;}
        };
      }
      if(!data.users.length)slot.append(el('p',{className:'hint',textContent:'公開中のユーザーはいません'}));
    }catch(e){if(run===generation)slot.textContent=e.message;}
  }
  return {render};
}
