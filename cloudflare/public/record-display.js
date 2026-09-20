// Shared, source-aware display contract. Ordering timestamps are never display timestamps.
export const validLocation = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const dayOf = value => new Date(value).toLocaleDateString('sv-SE', {timeZone:'Asia/Tokyo'});
export function ownerPoint(row, owner = 'me') {
  if (!validLocation(row.latitude, row.longitude) || !validTime(row.occurred_at)) return null;
  return {key:`private:${owner}:${row.id}`, kind:'record', source:'private', id:row.id,
    lng:row.longitude, lat:row.latitude, t:Date.parse(row.occurred_at), segment:'manual',
    displayAt:row.occurred_at, displayDate:dayOf(row.occurred_at),
    card:{title:row.observed_place_name || row.category_name || '記録した場所', memo:row.memo || '',
      category:row.category_name || '', rating:Number.isInteger(row.rating) && row.rating >= 1 && row.rating <= 5 ? row.rating : null,
      photos:[]}};
}
export function publicPoint(row) {
  if (!validLocation(row.latitude, row.longitude) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || '')) return null;
  const at = validTime(row.at) ? row.at : null;
  const t = Date.parse(at || row.date + 'T12:00:00+09:00');
  if (!Number.isFinite(t)) return null;
  return {key:`public:${row.author}:${row.id}`, kind:'record', source:'public', id:row.id,
    lng:row.longitude, lat:row.latitude, t, segment:'public', displayAt:at, displayDate:row.date,
    card:{title:row.place_name || row.category_name || '旅のひとこま', memo:row.memo || '',
      author:row.author_name || row.author || '', category:row.category_name || '', rating:null,
      photos:(row.photos || []).filter(p => /^\/api\/public\/photos\/[a-z0-9-]+$/.test(p.url || '')).map(p => ({url:p.url, caption:p.caption || ''}))}};
}
export function locationPoint(row) {
  if (!validLocation(row.latitude, row.longitude) || !validTime(row.captured_at)) return null;
  return {key:`location:${row.id}`, id:row.id, kind:'location', source:'location', lng:row.longitude, lat:row.latitude,
    t:Date.parse(row.captured_at), segment:`capture:${row.segment_id}`, displayAt:row.captured_at,
    displayDate:dayOf(row.captured_at), card:null, accuracy:row.accuracy};
}
export function displayWhen(point) {
  if (validTime(point.displayAt)) return new Date(point.displayAt).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo', year:'numeric', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'});
  return point.displayDate || ''; // No noon/midnight invented for the UI.
}
export const sortPoints = points => points.filter(Boolean).slice().sort((a,b) => a.t-b.t || a.key.localeCompare(b.key, 'en'));
export function combineOwnerPoints(records, samples) {
  const locations = samples.map(locationPoint).filter(Boolean), spans = new Map();
  for (const p of locations) { const s=spans.get(p.segment) || [p.t,p.t]; s[0]=Math.min(s[0],p.t); s[1]=Math.max(s[1],p.t); spans.set(p.segment,s); }
  const own=records.map(row => ownerPoint(row)).filter(Boolean).map(p => {
    const containing=[...spans].find(([,span]) => p.t>=span[0] && p.t<=span[1]);
    return containing ? {...p,segment:containing[0]} : p;
  });
  return sortPoints([...own,...locations]);
}
