// Chooses WHO to play; story.js remains responsible for HOW one person's records play.
export function makePlaybackController({state,story,loadUser,loadUnread,markRead,notify}) {
 let run=0;
 async function play(){const id=++run,s=state.state();if(s.selectedUser){const option=await loadUser(s.selectedUser,s.period);if(id!==run)return;story.open(option.title,[option]);return;}const queue=await loadUnread();if(id!==run)return;if(!queue.length){notify('新しい記録はありません');return;}story.open('新しい記録',queue.map(item=>({...item,onSeen:markRead})),{sequential:true});}
 return {play,stop(){run++;story.finish();}};
}
