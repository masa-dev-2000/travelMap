import {sortPoints} from './record-display.js';
export const RECORD_INTERVAL_MS = 2000;
export const MIN_SPEED = 0.25, MAX_SPEED = 4;
export const clampSpeed = value => Math.max(MIN_SPEED,Math.min(MAX_SPEED,Number.isFinite(Number(value)) ? Number(value) : 1));
// A fixed snapshot: map refreshes and new location samples cannot mutate this timeline.
export function makeTimeline(tracks) {
  const items=tracks.map(track => ({...track, points:sortPoints(track.points.map(p => ({...p,card:p.card ? {...p.card,photos:(p.card.photos || []).map(photo=>({...photo}))} : null})))})).filter(t=>t.points.length);
  const order=items.flatMap(t=>t.points).sort((a,b)=>a.t-b.t || a.key.localeCompare(b.key,'en'));
  const anchors=order.map((p,i)=>p.kind==='record'?i:-1).filter(i=>i>=0);
  let duration;
  if (anchors.length) {
    let elapsed=0,from=0;
    for (const index of anchors) {
      const cost=index===0 ? 0 : RECORD_INTERVAL_MS;
      for (let i=from;i<=index;i++) order[i].ms=elapsed+cost*(i-from)/Math.max(1,index-from);
      elapsed+=cost;from=index;
    }
    const last=order.length-1;
    if (last>from) { for(let i=from+1;i<=last;i++) order[i].ms=elapsed+RECORD_INTERVAL_MS*(i-from)/(last-from);elapsed+=RECORD_INTERVAL_MS; }
    duration=Math.max(RECORD_INTERVAL_MS,elapsed);
  } else {
    duration=Math.min(15000,Math.max(2000,(order.length-1)*500));
    order.forEach((p,i)=>{p.ms=duration*i/Math.max(1,order.length-1);});
  }
  return {items,order,duration};
}
// Do not interpolate across recording gaps. Return independent line chunks.
export function trackAt(points, elapsed) {
  const chunks=[];let chunk=[],position=null;
  for(let i=0;i<points.length;i++) {
    const p=points[i];
    if(p.ms>elapsed) {
      const prev=points[i-1];
      if(prev && prev.segment===p.segment && p.ms>prev.ms) {
        const k=Math.max(0,Math.min(1,(elapsed-prev.ms)/(p.ms-prev.ms)));
        position=[prev.lng+(p.lng-prev.lng)*k,prev.lat+(p.lat-prev.lat)*k];chunk.push(position);
      }
      break;
    }
    if(i && points[i-1].segment!==p.segment) { if(chunk.length>1) chunks.push(chunk);chunk=[]; }
    position=[p.lng,p.lat];chunk.push(position);
  }
  if(chunk.length>1) chunks.push(chunk);
  return {chunks,position};
}
export function recordsPassed(order, previous, elapsed) {return order.filter(p=>p.kind==='record' && p.ms>previous && p.ms<=elapsed);}
