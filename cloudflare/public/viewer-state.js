export function makeViewerState(initial={}) {
 let selectedUser=null,period=initial.period||'7',muted=new Set(initial.muted||[]),unread=new Map(),listeners=new Set();
 const state=()=>({selectedUser,period,muted:new Set(muted),unread:new Map(unread)}),emit=()=>listeners.forEach(fn=>fn(state()));
 return {state,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},select(handle){selectedUser=handle&&!muted.has(handle)?handle:null;emit();},period(value){period=value;emit();},setMuted(handles){muted=new Set(handles);if(selectedUser&&muted.has(selectedUser))selectedUser=null;emit();},setUnread(rows){unread=new Map(rows.map(r=>[r.handle,!!r.has_unread]));emit();},visible(handle,self){return handle!==self&&!muted.has(handle);}};
}
