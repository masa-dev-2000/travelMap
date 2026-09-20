export function orderedRoute(records) {
  return records.filter(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)&&Math.abs(r.latitude)<=90&&Math.abs(r.longitude)<=180&&Number.isFinite(Date.parse(r.occurred_at)))
    .slice().sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at)||String(a.id).localeCompare(String(b.id),'en'));
}
