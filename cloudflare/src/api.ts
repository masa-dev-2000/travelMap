import { coordinates, date, dateTime, InputError, integer, optionalText, readBytes, readInput, scope, sha256, text, type Input } from './validation.ts';
import { cleanPng } from './png.ts';

export const json = (value: unknown, status = 200) => Response.json(value, {status, headers: {'Cache-Control':'no-store'}});
const query = (db: D1Database, sql: string, values: (string | number | null)[] = []) => db.prepare(sql).bind(...values);
const id = () => crypto.randomUUID();

import type { User } from './auth.ts';
async function category(db: D1Database, uid: string, value: unknown, kind: string): Promise<string> {
  const cid = text(value, '分類');
  if (!await query(db, 'SELECT id FROM categories WHERE id=? AND kind=? AND active=1 AND user_id=?', [cid, kind, uid]).first()) throw new InputError('有効な分類を選択してください');
  return cid;
}
async function trip(db: D1Database, uid: string, value: unknown): Promise<string | null> {
  const tid = optionalText(value, '旅');
  if (tid && !await query(db, 'SELECT id FROM trips WHERE id=? AND user_id=?', [tid, uid]).first()) throw new InputError('旅が見つかりません');
  return tid;
}
async function ownActivity(db: D1Database, uid: string, value: unknown): Promise<string> {
  const aid = text(value, '行動');
  if (!await query(db, 'SELECT id FROM activities WHERE id=? AND user_id=?', [aid, uid]).first()) throw new InputError('行動が見つかりません');
  return aid;
}
async function transaction(db: D1Database, uid: string, data: Input, activityId: string | null, tripId: string | null): Promise<D1PreparedStatement> {
  const kind = text(data.kind ?? 'expense', '種別');
  if (!['expense','income','refund'].includes(kind)) throw new InputError('取引の種別が不正です');
  const cid = await category(db, uid, data.category_id, kind === 'income' ? 'income' : 'expense');
  const currency = text(data.currency ?? 'JPY', '通貨');
  if (!/^[A-Z]{3}$/.test(currency)) throw new InputError('通貨は大文字3文字です');
  const unit = integer(data.minor_unit ?? 0, '通貨の小数桁数', 4);
  const amount = integer(data.amount_minor, '金額');
  const jpy = currency === 'JPY' ? amount : data.amount_jpy == null ? null : integer(data.amount_jpy, '円換算額');
  const status = currency === 'JPY' ? 'final' : text(data.conversion_status ?? (jpy === null ? 'unconverted' : 'estimated'), '換算状態');
  if (!['final','estimated','unconverted'].includes(status) || (status === 'unconverted') !== (jpy === null)) throw new InputError('換算状態と金額が一致しません');
  if (currency === 'JPY' && (unit !== 0 || (data.amount_jpy != null && data.amount_jpy !== amount))) throw new InputError('円は整数円で入力してください');
  const refund = optionalText(data.refund_of, '返金元');
  if ((kind === 'refund') !== (refund !== null)) throw new InputError('返金元を確認してください');
  if (refund && !await query(db, 'SELECT id FROM transactions WHERE id=? AND user_id=?', [refund, uid]).first()) throw new InputError('返金元を確認してください');
  return query(db, 'INSERT INTO transactions(id,trip_id,activity_id,occurred_at,kind,category_id,category_kind,currency,minor_unit,amount_minor,amount_jpy,conversion_status,description,refund_of,user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [id(), tripId, activityId, dateTime(data.occurred_at), kind, cid, kind === 'income' ? 'income' : 'expense', currency, unit, amount, jpy, status, text(data.description ?? '', '説明', 4000, false), refund, uid]);
}

async function saveOnce(request: Request, db: D1Database, uid: string, body: Input,
                        build: () => Promise<{statements: D1PreparedStatement[]; result: unknown}>): Promise<Response> {
  const key = uid + ':' + text(request.headers.get('Idempotency-Key'), '保存用ID', 100);
  const hash = await sha256(new TextEncoder().encode(uid + request.method + new URL(request.url).pathname + JSON.stringify(body)));
  const previous = await query(db, 'SELECT payload_hash,response_json FROM request_receipts WHERE id=?', [key]).first<{payload_hash:string; response_json:string}>();
  if (previous) {
    if (previous.payload_hash !== hash) return json({error:'保存用IDが別の入力で使用済みです'}, 409);
    return json(JSON.parse(previous.response_json));
  }
  const {statements, result} = await build();
  try {
    await db.batch([...statements, query(db, 'INSERT INTO request_receipts VALUES(?,?,?)', [key, hash, JSON.stringify(result)])]);
  } catch (error) {
    const concurrent = await query(db, 'SELECT payload_hash,response_json FROM request_receipts WHERE id=?', [key]).first<{payload_hash:string;response_json:string}>();
    if (concurrent?.payload_hash === hash) return json(JSON.parse(concurrent.response_json));
    throw error;
  }
  return json(result, 201);
}

// Travel mode: map_visible is on and the optional auto-off time (map_visible_until) has not passed. Binds one ISO timestamp.
const travelling = (owner: string) => `(EXISTS (SELECT 1 FROM user_settings s WHERE s.user_id=${owner} AND s.key='map_visible' AND s.value='true') AND NOT EXISTS (SELECT 1 FROM user_settings s WHERE s.user_id=${owner} AND s.key='map_visible_until' AND s.value<>'' AND s.value<=?))`;

export async function publicApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET') return json({error:'Method not allowed'},405);
  if (url.pathname === '/api/public/entries') {
    // precision decides what leaves the server: 'city' drops coordinates, 'hidden' drops place and coordinates. Delayed entries stay invisible until publish_at.
    const handle = url.searchParams.get('u'), now = new Date().toISOString();
    // 'at' (exact time, for "3 hours ago") is only exposed for entries published without a delay whose public date was not edited.
    const entries = await query(env.DB, `SELECT p.id,p.date,CASE WHEN p.publish_at IS NULL AND date(a.occurred_at,'+9 hours')=p.date THEN a.occurred_at END at,CASE p.precision WHEN 'hidden' THEN NULL ELSE p.place_name END place_name,p.memo,
      CASE p.precision WHEN 'exact' THEN l.latitude END latitude,CASE p.precision WHEN 'exact' THEN l.longitude END longitude,
      tr.name trip_name,c.name category_name,u.handle author,u.display_name author_name,u.icon author_icon,u.avatar_url author_avatar,CASE WHEN u.icon_version IS NULL THEN NULL ELSE '/api/public/icons/'||u.handle||'?v='||u.icon_version END author_icon_url,u.status author_status,u.status_at author_status_at,
      (SELECT SUM(CASE t.kind WHEN 'expense' THEN t.amount_jpy WHEN 'refund' THEN -t.amount_jpy END) FROM transactions t WHERE t.activity_id=p.activity_id) spent_jpy
      FROM public_entries p LEFT JOIN public_entry_locations l ON l.entry_id=p.id JOIN activities a ON a.id=p.activity_id JOIN users u ON u.id=p.user_id
      JOIN categories c ON c.id=a.category_id LEFT JOIN trips tr ON tr.id=a.trip_id
      WHERE p.status='published' AND (p.publish_at IS NULL OR p.publish_at<=?) AND ${travelling('p.user_id')}${handle ? ' AND u.handle=?' : ''} ORDER BY p.date DESC,a.occurred_at DESC,p.id`,
      handle ? [now, now, text(handle,'ユーザー',40)] : [now, now]).all();
    const photos = await query(env.DB, `SELECT f.id,f.entry_id,f.caption FROM public_photo_objects f JOIN public_entries p ON p.id=f.entry_id WHERE p.status='published' AND (p.publish_at IS NULL OR p.publish_at<=?) AND ${travelling('p.user_id')}`,[now,now]).all();
    return json({entries:entries.results.map(e => ({...e, photos:photos.results.filter(p => p.entry_id === e.id).map(p => ({id:p.id,caption:p.caption,url:`/api/public/photos/${p.id}`}))}))});
  }
  const profile = url.pathname.match(/^\/api\/public\/users\/([a-z0-9-]+)$/);
  if (profile) {
    const row = await query(env.DB, `SELECT u.handle,u.display_name,u.avatar_url,u.bio,u.tip_url,CASE WHEN ${travelling('u.id')} THEN u.status END author_status,CASE WHEN ${travelling('u.id')} THEN u.status_at END author_status_at,
      (SELECT COUNT(*) FROM public_entries p WHERE p.user_id=u.id AND p.status='published' AND (p.publish_at IS NULL OR p.publish_at<=?)) entries,
      ${travelling('u.id')} visible,
      (SELECT MIN(p.date) FROM public_entries p WHERE p.user_id=u.id AND p.status='published') first_date,
      (SELECT MAX(p.date) FROM public_entries p WHERE p.user_id=u.id AND p.status='published') last_date
      FROM users u WHERE u.handle=?`, [new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), text(profile[1],'ユーザー',40)]).first();
    if (!row) return json({error:'Not found'},404);
    // Trips for the story replay: only what the public feed already shows (published, past publish_at, travel mode on). Names only, never trip ids.
    const now = new Date().toISOString();
    const trips = row.visible ? await query(env.DB, `SELECT tr.name,MIN(p.date) first_date,MAX(p.date) last_date,COUNT(*) entries FROM public_entries p JOIN activities a ON a.id=p.activity_id JOIN trips tr ON tr.id=a.trip_id JOIN users u ON u.id=p.user_id
      WHERE u.handle=? AND p.status='published' AND (p.publish_at IS NULL OR p.publish_at<=?) GROUP BY tr.id ORDER BY first_date DESC`, [profile[1], now]).all() : {results:[]};
    return json({...row,trips:trips.results});
  }
  const icon = url.pathname.match(/^\/api\/public\/icons\/([a-z0-9-]+)$/);
  if (icon) {
    const owner = await query(env.DB,'SELECT id FROM users WHERE handle=? AND icon_version IS NOT NULL',[icon[1]]).first<{id:string}>();
    const object = owner ? await env.FILES.get(`icons/${owner.id}.png`) : null;
    return object ? new Response(object.body, {headers:{'Content-Type':'image/png','Cache-Control':url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache'}}) : json({error:'Not found'},404);
  }
  const photo = url.pathname.match(/^\/api\/public\/photos\/([a-z0-9-]+)$/);
  if (photo) {
    const record = await query(env.DB,`SELECT f.object_key FROM public_photo_objects f JOIN public_entries p ON p.id=f.entry_id WHERE f.id=? AND p.status='published' AND (p.publish_at IS NULL OR p.publish_at<=?) AND ${travelling('p.user_id')}`,[photo[1],new Date().toISOString(),new Date().toISOString()]).first<{object_key:string}>();
    if (!record) return json({error:'Not found'},404);
    const object = await env.FILES.get(record.object_key);
    return object ? new Response(object.body, {headers:{'Content-Type':'image/png','Cache-Control':'no-store'}}) : json({error:'Not found'},404);
  }
  return json({error:'Not found'},404);
}

const DEFAULT_CATEGORIES: [string,string][] = [['activity','食費'],['activity','移動'],['activity','交通費'],['activity','観光費'],['activity','買い物'],['activity','宿泊費'],['activity','飲み'],['activity','温泉'],['activity','その他'],
  ['expense','食費'],['expense','交通費'],['expense','観光費'],['expense','買い物'],['expense','宿泊費'],['expense','飲み'],['expense','温泉'],['expense','その他'],['income','収入']];

// A brand-new account gets a starter set of categories so the record screen works immediately.
async function ensureCategories(db: D1Database, uid: string): Promise<void> {
  if (await query(db,'SELECT id FROM categories WHERE user_id=? LIMIT 1',[uid]).first()) return;
  await db.batch(DEFAULT_CATEGORIES.map(([kind,name],index) => query(db,'INSERT INTO categories(id,kind,name,sort_order,user_id) VALUES(?,?,?,?,?)',[id(),kind,name,index,uid])));
}

export async function privateApi(request: Request, env: Env, user: User): Promise<Response> {
  const url = new URL(request.url), path = url.pathname, db = env.DB, uid = user.id;
  if (request.method === 'GET') {
    if (path === '/api/private/me') return json({user});
    if (path === '/api/private/bootstrap') {
      await ensureCategories(db,uid);
      const [categories, trips, settings] = await Promise.all([
        query(db,'SELECT id,kind,name,color,active FROM categories WHERE user_id=? ORDER BY sort_order,id',[uid]).all(),
        query(db,`SELECT t.*,(SELECT COUNT(*) FROM activities a WHERE a.trip_id=t.id) entries,(SELECT MIN(a.occurred_at) FROM activities a WHERE a.trip_id=t.id) first_at,(SELECT MAX(a.occurred_at) FROM activities a WHERE a.trip_id=t.id) last_at,
          (SELECT SUM(CASE x.kind WHEN 'expense' THEN x.amount_jpy WHEN 'refund' THEN -x.amount_jpy END) FROM transactions x WHERE x.trip_id=t.id) spent_jpy FROM trips t WHERE t.user_id=? ORDER BY COALESCE(first_at,t.starts_on) DESC,t.id`,[uid]).all(),
        query(db,'SELECT key,value FROM user_settings WHERE user_id=?',[uid]).all<{key:string;value:string}>(),
      ]);
      const setting = (key:string) => settings.results.find(row => row.key === key)?.value;
      return json({user:{...user,icon_url:user.icon_version == null ? null : `/api/public/icons/${user.handle}?v=${user.icon_version}`},categories:categories.results,trips:trips.results,settings:{publish_default:setting('publish_default') === 'true',publish_precision:setting('publish_precision') ?? 'exact',publish_delay_hours:Number(setting('publish_delay_hours') ?? 0),map_visible:setting('map_visible') === 'true' && !(setting('map_visible_until') && setting('map_visible_until')! <= new Date().toISOString()),map_visible_until:setting('map_visible_until') || null}});
    }
    if (path === '/api/private/activities') {
      const offset = integer(Number(url.searchParams.get('offset') ?? 0),'ページ');
      const clauses = ['a.user_id=?'], values: (number|string)[] = [uid];
      if (url.searchParams.get('trip')) { clauses.push('a.trip_id=?'); values.push(text(url.searchParams.get('trip'),'旅')); }
      const where = ' WHERE '+clauses.join(' AND ');
      const rows = await query(db, "SELECT a.*,c.name category_name,p.status public_status,p.id public_id,p.precision public_precision,p.publish_at,(SELECT SUM(CASE t.kind WHEN 'expense' THEN t.amount_jpy WHEN 'refund' THEN -t.amount_jpy END) FROM transactions t WHERE t.activity_id=a.id) spent_jpy FROM activities a JOIN categories c ON c.id=a.category_id LEFT JOIN public_entries p ON p.activity_id=a.id"+where+' ORDER BY a.occurred_at DESC,a.id DESC LIMIT 100 OFFSET ?', [...values,offset]).all();
      return json({activities:rows.results,next_offset:rows.results.length === 100 ? offset+100 : null});
    }
    if (path === '/api/private/transactions') {
      const filter = scope(url,uid), offset = integer(Number(url.searchParams.get('offset') ?? 0),'ページ');
      const rows = await query(db,'SELECT t.*,c.name category_name FROM transactions t JOIN categories c ON c.id=t.category_id'+filter.where+' ORDER BY t.occurred_at DESC,t.id DESC LIMIT 100 OFFSET ?', [...filter.values,offset]).all();
      return json({transactions:rows.results,next_offset:rows.results.length === 100 ? offset+100 : null});
    }
    if (path === '/api/private/summary') {
      const filter = scope(url,uid);
      const result = await query(db, `SELECT COALESCE(SUM(CASE WHEN kind='expense' THEN amount_jpy ELSE 0 END),0) expense_jpy,
        COALESCE(SUM(CASE WHEN kind='income' THEN amount_jpy ELSE 0 END),0) income_jpy,
        COALESCE(SUM(CASE WHEN kind='refund' THEN amount_jpy ELSE 0 END),0) refund_jpy,
        COUNT(CASE WHEN amount_jpy IS NULL THEN 1 END) unconverted_count,
        COUNT(CASE WHEN conversion_status='estimated' THEN 1 END) estimated_count FROM transactions t${filter.where}`,filter.values).first();
      return json(result);
    }
    if (path === '/api/private/review-count') {
      if (!env.OWNER_EMAIL || user.email.toLowerCase() !== env.OWNER_EMAIL.toLowerCase()) return json({count:0});
      return json(await query(db,"SELECT COUNT(*) count FROM source_records WHERE status='needs_review'").first());
    }
    if (path === '/api/private/footprints') {
      // Who looked at my records lately: one line per person (latest visit), 14 days, 10 people. No counts.
      const since=new Date(Date.now()-14*86400000).toISOString();
      const [rows, seen] = await Promise.all([
        query(db,`SELECT u.handle,u.display_name,u.icon,u.avatar_url,CASE WHEN u.icon_version IS NULL THEN NULL ELSE '/api/public/icons/'||u.handle||'?v='||u.icon_version END icon_url,MAX(f.created_at) at
          FROM footprints f JOIN users u ON u.id=f.viewer_id WHERE f.owner_id=? AND f.created_at>=? GROUP BY f.viewer_id ORDER BY at DESC LIMIT 10`,[uid,since]).all<{at:string}>(),
        query(db,"SELECT value FROM user_settings WHERE user_id=? AND key='footprints_seen_at'",[uid]).first<{value:string}>(),
      ]);
      return json({visitors:rows.results,unread:rows.results.some(row => row.at > (seen?.value ?? ''))});
    }
    const attachment = path.match(/^\/api\/private\/attachments\/([a-z0-9-]+)$/);
    if (attachment) {
      const record = await query(db,'SELECT storage_location,media_type FROM attachments WHERE id=? AND user_id=?',[attachment[1],uid]).first<{storage_location:string;media_type:string}>();
      if (!record?.storage_location.startsWith('private/')) return json({error:'Not found'},404);
      const object = await env.FILES.get(record.storage_location);
      return object ? new Response(object.body, {headers:{'Content-Type':record.media_type,'Content-Disposition':'attachment','Cache-Control':'no-store'}}) : json({error:'Not found'},404);
    }
    if (path === '/api/private/attachments') {
      const aid = await ownActivity(db,uid,url.searchParams.get('activity_id'));
      const rows = await query(db,'SELECT f.id,f.purpose,f.media_type,f.caption FROM attachments f JOIN activity_attachments a ON a.attachment_id=f.id WHERE a.activity_id=?',[aid]).all();
      return json({attachments:rows.results});
    }
  }
  if (request.method === 'POST' && path === '/api/private/attachments') return upload(request,env,uid);
  if (path === '/api/private/icon' && request.method === 'POST') {
    if (request.headers.get('Content-Type') !== 'image/png') throw new InputError('アイコンはPNG画像です');
    const png=cleanPng(await readBytes(request,512*1024)), previous=user.icon_version ?? 0, version=Math.max(previous+1,Math.floor(Date.now()/1000));
    await env.FILES.put(`icons/${uid}.png`,png,{httpMetadata:{contentType:'image/png'}});
    await query(db,'UPDATE users SET icon_version=? WHERE id=?',[version,uid]).run();
    return json({icon_url:`/api/public/icons/${user.handle}?v=${version}`},201);
  }
  if (path === '/api/private/icon' && request.method === 'DELETE') {
    await query(db,'UPDATE users SET icon_version=NULL WHERE id=?',[uid]).run();
    await env.FILES.delete(`icons/${uid}.png`);
    return json({deleted:true});
  }
  if (request.method === 'POST') {
    const body = await readInput(request);
    if (path === '/api/private/activities') return saveOnce(request,db,uid,body,async () => {
      const aid=id(), cid=await category(db,uid,body.category_id,'activity'), tid=await trip(db,uid,body.trip_id);
      const [lat,lng]=coordinates(body), occurred=dateTime(body.occurred_at);
      const zone=text(body.timezone ?? 'Asia/Tokyo','タイムゾーン');
      try { new Intl.DateTimeFormat('ja-JP',{timeZone:zone}); } catch { throw new InputError('タイムゾーンが不正です'); }
      const rating=body.rating == null ? null : integer(body.rating,'評価',5);
      if (rating === 0) throw new InputError('評価は1〜5です');
      const statements = [query(db,'INSERT INTO activities(id,trip_id,occurred_at,timezone,timezone_basis,category_id,memo,observed_place_name,latitude,longitude,rating,user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        [aid,tid,occurred,zone,'recorded',cid,text(body.memo ?? '','メモ',4000,false),optionalText(body.observed_place_name,'場所名'),lat,lng,rating,uid])];
      if (body.transaction != null) {
        if (typeof body.transaction !== 'object' || Array.isArray(body.transaction)) throw new InputError('支出の形式が不正です');
        statements.push(await transaction(db,uid,{...body.transaction as Input,occurred_at:occurred},aid,tid));
      }
      if (body.publish != null && typeof body.publish !== 'boolean') throw new InputError('公開設定が不正です');
      let publicId: string|null=null;
      if (body.publish === true) {
        // Same snapshot fields as the manual publish form: date (JST), place name, memo, coordinates. Granularity and delay come from the request or the user's defaults.
        const options=await publishOptions(db,uid,body);
        publicId=id();
        statements.push(query(db,"INSERT INTO public_entries(id,activity_id,date,place_name,memo,status,user_id,precision,publish_at) VALUES(?,?,date(?,'+9 hours'),?,?,'published',?,?,?)",
          [publicId,aid,occurred,optionalText(body.observed_place_name,'場所名'),text(body.memo ?? '','メモ',4000,false),uid,options.precision,options.publishAt]));
        if (lat !== null && lng !== null) statements.push(query(db,'INSERT INTO public_entry_locations VALUES(?,?,?)',[publicId,lat,lng]));
      }
      return {statements,result:{id:aid,public_id:publicId}};
    });
    if (path === '/api/private/transactions') return saveOnce(request,db,uid,body,async () => {
      const aid=body.activity_id ? await ownActivity(db,uid,body.activity_id) : null; let tid=await trip(db,uid,body.trip_id);
      if (aid) {
        const activity=await query(db,'SELECT trip_id FROM activities WHERE id=? AND user_id=?',[aid,uid]).first<{trip_id:string|null}>();
        if (!activity || (tid && tid !== activity.trip_id)) throw new InputError('行動と旅の組合せが不正です');
        tid=activity.trip_id;
      }
      return {statements:[await transaction(db,uid,body,aid,tid)],result:{saved:true}};
    });
    if (path === '/api/private/trips') return saveOnce(request,db,uid,body,async () => {
      const tid=id(), start=body.starts_on ? date(body.starts_on) : null, end=body.ends_on ? date(body.ends_on) : null;
      return {statements:[query(db,'INSERT INTO trips(id,name,starts_on,ends_on,description,user_id) VALUES(?,?,?,?,?,?)',[tid,text(body.name,'旅の名前'),start,end,text(body.description ?? '','説明',4000,false),uid])],result:{id:tid}};
    });
    if (path === '/api/private/categories') return saveOnce(request,db,uid,body,async () => {
      const cid=id(),kind=text(body.kind,'種別');
      if (!['activity','expense','income'].includes(kind)) throw new InputError('分類の種別が不正です');
      return {statements:[query(db,'INSERT INTO categories(id,kind,name,user_id) VALUES(?,?,?,?)',[cid,kind,text(body.name,'分類名'),uid])],result:{id:cid}};
    });
    // Group a run of records into a trip: everything between two of the user's own records (both ends included), by occurred_at.
    if (path === '/api/private/trips/assign-range') {
      const ends=await query(db,'SELECT id,occurred_at FROM activities WHERE user_id=? AND id IN (?,?)',[uid,text(body.from_activity_id,'始まりの記録',80),text(body.to_activity_id,'終わりの記録',80)]).all<{id:string;occurred_at:string}>();
      if (ends.results.length !== (body.from_activity_id === body.to_activity_id ? 1 : 2)) throw new InputError('記録が見つかりません');
      const stamps=ends.results.map(r => r.occurred_at).sort(), lo=stamps[0], hi=stamps[stamps.length-1];
      const jst=(at:string) => new Date(Date.parse(at)+9*3600000).toISOString().slice(0,10);
      const statements: D1PreparedStatement[]=[];
      let tid: string;
      if (body.trip_id !== undefined && body.trip_id !== null) {
        const found=await trip(db,uid,body.trip_id);
        if (!found) throw new InputError('旅が見つかりません');
        tid=found;
        statements.push(query(db,'UPDATE trips SET starts_on=CASE WHEN starts_on IS NULL OR starts_on>? THEN ? ELSE starts_on END,ends_on=CASE WHEN ends_on IS NULL OR ends_on<? THEN ? ELSE ends_on END WHERE id=? AND user_id=?',[jst(lo),jst(lo),jst(hi),jst(hi),tid,uid]));
      } else {
        tid=id();
        statements.push(query(db,'INSERT INTO trips(id,name,starts_on,ends_on,description,user_id) VALUES(?,?,?,?,?,?)',[tid,text(body.name,'旅の名前'),jst(lo),jst(hi),'',uid]));
      }
      const counted=await query(db,'SELECT COUNT(*) n,SUM(CASE WHEN trip_id IS NOT NULL AND trip_id<>? THEN 1 ELSE 0 END) moved FROM activities WHERE user_id=? AND occurred_at BETWEEN ? AND ?',[tid,uid,lo,hi]).first<{n:number;moved:number|null}>();
      // Linked transactions follow their activity (trigger activity_trip_update). Standalone ones in the same time span move here; refunds and refunded rows are left alone.
      statements.push(query(db,'UPDATE activities SET trip_id=? WHERE user_id=? AND occurred_at BETWEEN ? AND ?',[tid,uid,lo,hi]),
        query(db,"UPDATE transactions SET trip_id=? WHERE user_id=? AND activity_id IS NULL AND kind<>'refund' AND id NOT IN (SELECT refund_of FROM transactions WHERE refund_of IS NOT NULL) AND occurred_at BETWEEN ? AND ?",[tid,uid,lo,hi]));
      await db.batch(statements);
      return json({trip_id:tid,assigned:counted?.n ?? 0,moved:counted?.moved ?? 0});
    }
    const release = path.match(/^\/api\/private\/trips\/([a-z0-9-]+)\/release$/);
    if (release) {
      const tid=await trip(db,uid,release[1]);
      if (!tid) throw new InputError('旅が見つかりません');
      if (body.delete !== undefined && typeof body.delete !== 'boolean') throw new InputError('削除の指定が不正です');
      const counted=await query(db,'SELECT COUNT(*) n FROM activities WHERE trip_id=? AND user_id=?',[tid,uid]).first<{n:number}>();
      const statements=[query(db,'UPDATE activities SET trip_id=NULL WHERE trip_id=? AND user_id=?',[tid,uid]),query(db,'UPDATE transactions SET trip_id=NULL WHERE trip_id=? AND user_id=? AND activity_id IS NULL',[tid,uid])];
      if (body.delete === true) statements.push(query(db,'DELETE FROM trips WHERE id=? AND user_id=?',[tid,uid]));
      try { await db.batch(statements); } catch { throw new InputError('この旅は解除できません（返金や予算が紐づいています）'); }
      return json({released:counted?.n ?? 0,deleted:body.delete === true});
    }
    const rename = path.match(/^\/api\/private\/trips\/([a-z0-9-]+)$/);
    if (rename) {
      const tid=await trip(db,uid,rename[1]);
      if (!tid) throw new InputError('旅が見つかりません');
      const writes: D1PreparedStatement[]=[];
      if (body.name !== undefined) writes.push(query(db,'UPDATE trips SET name=? WHERE id=? AND user_id=?',[text(body.name,'旅の名前'),tid,uid]));
      if (body.description !== undefined) writes.push(query(db,'UPDATE trips SET description=? WHERE id=? AND user_id=?',[text(body.description,'説明',4000,false),tid,uid]));
      if (!writes.length) throw new InputError('変更がありません');
      await db.batch(writes);
      return json({saved:true});
    }
    const assign = path.match(/^\/api\/private\/trips\/([a-z0-9-]+)\/assign$/);
    if (assign) {
      const tid=await trip(db,uid,assign[1]);
      if (!tid) throw new InputError('旅が見つかりません');
      const from=date(body.starts_on), to=date(body.ends_on);
      if (from > to) throw new InputError('開始日が終了日より後です');
      // 日付は日本時間で判定する
      await query(db,"UPDATE activities SET trip_id=? WHERE user_id=? AND date(occurred_at,'+9 hours') BETWEEN ? AND ?",[tid,uid,from,to]).run();
      const counted=await query(db,'SELECT COUNT(*) n FROM activities WHERE trip_id=?',[tid]).first<{n:number}>();
      return json({assigned:counted?.n ?? 0});
    }
    if (path === '/api/private/footprints') {
      const target=await query(db,`SELECT u.id FROM users u WHERE u.handle=? AND ${travelling('u.id')}`,[text(body.handle,'ユーザー',40),new Date().toISOString()]).first<{id:string}>();
      if (!target) throw new InputError('いま旅モード中の人ではありません');
      if (target.id === uid) return json({recorded:false});
      const now=new Date();
      const result=await query(db,"INSERT OR IGNORE INTO footprints(id,viewer_id,owner_id,day,created_at) VALUES(?,?,?,?,?)",[id(),uid,target.id,new Date(now.getTime()+9*3600000).toISOString().slice(0,10),now.toISOString()]).run();
      return json({recorded:result.meta.changes > 0});
    }
    if (path === '/api/private/footprints/seen') {
      await query(db,"INSERT INTO user_settings(user_id,key,value) VALUES(?,'footprints_seen_at',?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value",[uid,new Date().toISOString()]).run();
      return json({saved:true});
    }
    if (path === '/api/private/settings') {
      const writes: D1PreparedStatement[]=[];
      const put=(key:string,value:string)=>writes.push(query(db,'INSERT INTO user_settings(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value',[uid,key,value]));
      if (body.publish_default !== undefined) { if (typeof body.publish_default !== 'boolean') throw new InputError('公開の初期値が不正です'); put('publish_default',String(body.publish_default)); }
      if (body.map_visible !== undefined) { if (typeof body.map_visible !== 'boolean') throw new InputError('旅モードが不正です'); put('map_visible',String(body.map_visible)); if (body.map_visible_days === undefined) put('map_visible_until',''); }
      // Auto-off: 0 = until switched off by hand, otherwise travel mode ends that many days from now.
      if (body.map_visible_days !== undefined) { const days=integer(body.map_visible_days,'自動オフまでの日数',365); put('map_visible_until',days ? new Date(Date.now()+days*86400000).toISOString() : ''); }
      if (body.publish_precision !== undefined) { const value=text(body.publish_precision,'公開の粒度',10); if (!['exact','city','hidden'].includes(value)) throw new InputError('公開の粒度が不正です'); put('publish_precision',value); }
      if (body.publish_delay_hours !== undefined) put('publish_delay_hours',String(integer(body.publish_delay_hours,'公開までの時間',24*365)));
      if (body.display_name !== undefined) writes.push(query(db,'UPDATE users SET display_name=? WHERE id=?',[text(body.display_name,'表示名',100),uid]));
      if (body.status !== undefined) {
        // Status line: one line, up to 40 characters. Empty clears it. Rendered with textContent only, so markup characters are allowed.
        if (body.status !== null && typeof body.status !== 'string') throw new InputError('ステータスを確認してください');
        const status=(body.status ?? '').trim();
        if ([...status].length>40 || /[\r\n]/.test(status)) throw new InputError('ステータスは改行なしの40文字以内です');
        writes.push(query(db,'UPDATE users SET status=?,status_at=? WHERE id=?',[status || null,status ? new Date().toISOString() : null,uid]));
      }
      if (body.bio !== undefined) writes.push(query(db,'UPDATE users SET bio=? WHERE id=?',[text(body.bio,'ひとこと',300,false),uid]));
      if (body.icon !== undefined) {
        if (body.icon !== null && typeof body.icon !== 'string') throw new InputError('アイコンが不正です');
        const icon=(body.icon ?? '').trim();
        if ([...icon].length>8 || [...new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(icon)].length>2 || /[<>&"']/.test(icon)) throw new InputError('アイコンは絵文字1〜2文字です');
        writes.push(query(db,'UPDATE users SET icon=? WHERE id=?',[icon || null,uid]));
      }
      if (body.tip_url !== undefined) {
        const tip=optionalText(body.tip_url,'投げ銭リンク',500);
        if (tip && !/^https:\/\/[^\s]+$/.test(tip)) throw new InputError('投げ銭リンクは https:// で始まるURLです');
        writes.push(query(db,'UPDATE users SET tip_url=? WHERE id=?',[tip,uid]));
      }
      if (body.handle !== undefined) {
        const handle=text(body.handle,'ハンドル',24);
        if (!/^[a-z0-9][a-z0-9-]{1,23}$/.test(handle)) throw new InputError('ハンドルは英小文字・数字・ハイフンで2〜24文字です');
        if (await query(db,'SELECT id FROM users WHERE handle=? AND id<>?',[handle,uid]).first()) throw new InputError('そのハンドルは使われています');
        writes.push(query(db,'UPDATE users SET handle=? WHERE id=?',[handle,uid]));
      }
      if (!writes.length) throw new InputError('変更がありません');
      await db.batch(writes);
      return json({saved:true});
    }
    // 記録の編集（本人のものだけ）。公開中なら本文・場所・位置を公開側にも反映する
    const edit = path.match(/^\/api\/private\/activities\/([a-z0-9-]+)$/);
    if (edit) {
      const aid=await ownActivity(db,uid,edit[1]);
      const sets: string[]=[], values: (string|number|null)[]=[];
      if (body.occurred_at !== undefined) { sets.push('occurred_at=?'); values.push(dateTime(body.occurred_at)); }
      if (body.category_id !== undefined) { sets.push('category_id=?'); values.push(await category(db,uid,body.category_id,'activity')); }
      if (body.memo !== undefined) { sets.push('memo=?'); values.push(text(body.memo,'メモ',4000,false)); }
      if (body.observed_place_name !== undefined) { sets.push('observed_place_name=?'); values.push(optionalText(body.observed_place_name,'場所名')); }
      if (body.rating !== undefined) { const rating=body.rating === null ? null : integer(body.rating,'評価',5); if (rating === 0) throw new InputError('評価は1〜5です'); sets.push('rating=?'); values.push(rating); }
      if (body.trip_id !== undefined) { sets.push('trip_id=?'); values.push(await trip(db,uid,body.trip_id)); }
      const moved = body.latitude !== undefined || body.longitude !== undefined, [lat,lng] = moved ? coordinates(body) : [null,null];
      if (moved) { sets.push('latitude=?','longitude=?'); values.push(lat,lng); }
      if (!sets.length) throw new InputError('変更がありません');
      const statements=[query(db,`UPDATE activities SET ${sets.join(',')} WHERE id=? AND user_id=?`,[...values,aid,uid])];
      if (body.occurred_at !== undefined) statements.push(query(db,'UPDATE transactions SET occurred_at=? WHERE activity_id=? AND user_id=?',[dateTime(body.occurred_at),aid,uid]));
      if (body.memo !== undefined) statements.push(query(db,'UPDATE public_entries SET memo=? WHERE activity_id=? AND user_id=?',[text(body.memo,'メモ',4000,false),aid,uid]));
      if (body.observed_place_name !== undefined) statements.push(query(db,'UPDATE public_entries SET place_name=? WHERE activity_id=? AND user_id=?',[optionalText(body.observed_place_name,'場所名'),aid,uid]));
      if (moved) {
        statements.push(query(db,'DELETE FROM public_entry_locations WHERE entry_id IN (SELECT id FROM public_entries WHERE activity_id=? AND user_id=?)',[aid,uid]));
        if (lat !== null && lng !== null) statements.push(query(db,'INSERT INTO public_entry_locations SELECT id,?,? FROM public_entries WHERE activity_id=? AND user_id=?',[lat,lng,aid,uid]));
      }
      await db.batch(statements);
      return json({saved:true});
    }
    // 金額の付け替え：この記録の支出を置き換える（空なら支払いなし）
    const amountEdit = path.match(/^\/api\/private\/activities\/([a-z0-9-]+)\/amount$/);
    if (amountEdit) {
      const aid=await ownActivity(db,uid,amountEdit[1]);
      const statements=[query(db,"DELETE FROM transactions WHERE activity_id=? AND user_id=? AND kind='expense'",[aid,uid])];
      if (body.amount_minor != null) {
        const row=await query(db,'SELECT occurred_at,trip_id FROM activities WHERE id=?',[aid]).first<{occurred_at:string;trip_id:string|null}>();
        statements.push(await transaction(db,uid,{category_id:body.category_id,amount_minor:body.amount_minor,currency:'JPY',minor_unit:0,occurred_at:row!.occurred_at},aid,row!.trip_id));
      }
      await db.batch(statements);
      return json({saved:true});
    }
    const publishEdit = path.match(/^\/api\/private\/public-entries\/([a-z0-9-]+)\/options$/);
    if (publishEdit) {
      const options=await publishOptions(db,uid,body,true);
      const result=body.publish_delay_hours === undefined
        ? await query(db,'UPDATE public_entries SET precision=? WHERE id=? AND user_id=?',[options.precision,publishEdit[1],uid]).run()
        : await query(db,'UPDATE public_entries SET precision=?,publish_at=? WHERE id=? AND user_id=?',[options.precision,options.publishAt,publishEdit[1],uid]).run();
      if (!result.meta.changes) throw new InputError('公開記録が見つかりません');
      return json({saved:true});
    }
    if (path === '/api/private/public-entries') return publishSnapshot(request,env,body,uid);
    const unpublish = path.match(/^\/api\/private\/public-entries\/([a-z0-9-]+)\/unpublish$/);
    if (unpublish) { const result=await query(db,"UPDATE public_entries SET status='draft' WHERE id=? AND user_id=?",[unpublish[1],uid]).run(); if (!result.meta.changes) throw new InputError('公開記録が見つかりません'); return json({saved:true}); }
  }
  if (request.method === 'DELETE') {
    const target = path.match(/^\/api\/private\/activities\/([a-z0-9-]+)$/);
    if (target) {
      const aid=await ownActivity(db,uid,target[1]);
      const files=await query(db,'SELECT f.id,f.storage_location FROM attachments f JOIN activity_attachments a ON a.attachment_id=f.id WHERE a.activity_id=?',[aid]).all<{id:string;storage_location:string}>();
      const published=await query(db,'SELECT object_key FROM public_photo_objects WHERE entry_id IN (SELECT id FROM public_entries WHERE activity_id=?)',[aid]).all<{object_key:string}>();
      await db.batch([
        query(db,'DELETE FROM source_targets WHERE activity_id=? OR transaction_id IN (SELECT id FROM transactions WHERE activity_id=?)',[aid,aid]),
        query(db,'UPDATE food_reviews SET activity_id=NULL WHERE activity_id=?',[aid]),
        query(db,'UPDATE food_reviews SET transaction_id=NULL WHERE transaction_id IN (SELECT id FROM transactions WHERE activity_id=?)',[aid]),
        query(db,'DELETE FROM transaction_attachments WHERE transaction_id IN (SELECT id FROM transactions WHERE activity_id=?)',[aid]),
        query(db,'DELETE FROM public_entries WHERE activity_id=? AND user_id=?',[aid,uid]),
        query(db,'DELETE FROM transactions WHERE activity_id=? AND user_id=?',[aid,uid]),
        query(db,'DELETE FROM activity_attachments WHERE activity_id=?',[aid]),
        ...files.results.map(file => query(db,'DELETE FROM attachments WHERE id=? AND user_id=?',[file.id,uid])),
        query(db,'DELETE FROM activities WHERE id=? AND user_id=?',[aid,uid]),
      ]);
      for (const key of [...files.results.map(f => f.storage_location),...published.results.map(p => p.object_key)]) await env.FILES.delete(key);
      return json({deleted:true});
    }
  }
  return json({error:'Not found'},404);
}

// Publication granularity and delay: explicit values in the request win, otherwise the user's saved defaults.
async function publishOptions(db: D1Database, uid: string, body: Input, explicitOnly = false): Promise<{precision:string; publishAt:string|null}> {
  const saved = explicitOnly ? [] : (await query(db,'SELECT key,value FROM user_settings WHERE user_id=?',[uid]).all<{key:string;value:string}>()).results;
  const setting = (key:string) => saved.find(row => row.key === key)?.value;
  const precision = body.precision === undefined ? (setting('publish_precision') ?? 'exact') : text(body.precision,'公開の粒度',10);
  if (!['exact','city','hidden'].includes(precision)) throw new InputError('公開の粒度が不正です');
  const delay = body.publish_delay_hours === undefined ? Number(setting('publish_delay_hours') ?? 0) : integer(body.publish_delay_hours,'公開までの時間',24*365);
  return {precision, publishAt: delay > 0 ? new Date(Date.now()+delay*3600000).toISOString() : null};
}

async function upload(request: Request, env: Env, uid: string): Promise<Response> {
  const url=new URL(request.url), aid=await ownActivity(env.DB,uid,url.searchParams.get('activity_id'));
  const purpose=text(url.searchParams.get('purpose'),'用途');
  if (!['photo','receipt'].includes(purpose)) throw new InputError('用途を選んでください');
  const media=request.headers.get('Content-Type') ?? '';
  if (!['image/png','image/jpeg','application/pdf'].includes(media)) throw new InputError('PNG・JPEG・PDFが利用できます');
  if (purpose === 'photo' && media === 'application/pdf') throw new InputError('写真を選択してください');
  const bytes=await readBytes(request,8*1024*1024), fileId=id(), key=`private/${fileId}`;
  await env.FILES.put(key,bytes,{httpMetadata:{contentType:media}});
  try {
    await env.DB.batch([
      query(env.DB,'INSERT INTO attachments(id,storage_location,purpose,media_type,byte_size,sha256,caption,user_id) VALUES(?,?,?,?,?,?,?,?)',[fileId,key,purpose,media,bytes.length,await sha256(bytes),text(url.searchParams.get('caption') ?? '','説明',200,false),uid]),
      query(env.DB,'INSERT INTO activity_attachments VALUES(?,?)',[aid,fileId]),
    ]);
  } catch (error) { await env.FILES.delete(key); throw error; }
  return json({id:fileId},201);
}

async function publishSnapshot(request: Request, env: Env, body: Input, uid: string): Promise<Response> {
  const aid=await ownActivity(env.DB,uid,body.activity_id), pid=id(), selectedDate=date(body.date);
  const options=await publishOptions(env.DB,uid,body);
  if (body.confirmed !== true) throw new InputError('公開する内容を確認してください');
  const memo=text(body.memo ?? '','公開文',4000,false), place=optionalText(body.place_name,'公開場所名'), [lat,lng]=coordinates(body);
  const photoIds=body.photo_ids ?? [];
  if (!Array.isArray(photoIds) || photoIds.length>8 || new Set(photoIds).size !== photoIds.length) throw new InputError('写真は8枚以内です');
  // Copies go to R2 first, then one atomic D1 batch makes the snapshot visible.
  const uploaded: string[]=[];
  try {
    const result=await saveOnce(request,env.DB,uid,body,async () => {
      const statements=[query(env.DB,'DELETE FROM public_entries WHERE activity_id=? AND user_id=?',[aid,uid]),
        query(env.DB,"INSERT INTO public_entries(id,activity_id,date,place_name,memo,status,user_id,precision,publish_at) VALUES(?,?,?,?,?,'published',?,?,?)",[pid,aid,selectedDate,place,memo,uid,options.precision,options.publishAt])];
      if (lat !== null && lng !== null) statements.push(query(env.DB,'INSERT INTO public_entry_locations VALUES(?,?,?)',[pid,lat,lng]));
      for (const photoId of photoIds) {
        const photo=await query(env.DB,"SELECT f.storage_location,f.sha256,f.byte_size FROM attachments f JOIN activity_attachments a ON a.attachment_id=f.id WHERE f.id=? AND a.activity_id=? AND f.user_id=? AND f.purpose='photo' AND f.media_type='image/png'",[text(photoId,'写真'),aid,uid]).first<{storage_location:string;sha256:string;byte_size:number}>();
        if (!photo || !photo.storage_location.startsWith('private/')) throw new InputError('公開できるPNG写真が見つかりません');
        const object=await env.FILES.get(photo.storage_location);
        if (!object || object.size>8*1024*1024) throw new InputError('写真が見つからないか大きすぎます');
        const original=new Uint8Array(await object.arrayBuffer());
        if (original.length !== photo.byte_size || await sha256(original) !== photo.sha256) throw new InputError('写真の内容が変更されています');
        const png=cleanPng(original), fid=id(), key=`published/${pid}/${fid}`;
        await env.FILES.put(key,png,{httpMetadata:{contentType:'image/png'}}); uploaded.push(key);
        statements.push(query(env.DB,'INSERT INTO public_photo_objects(id,entry_id,object_key,sha256) VALUES(?,?,?,?)',[fid,pid,key,await sha256(png)]));
      }
      return {statements,result:{id:pid}};
    });
    // A concurrent idempotent replay can lose the insert race; delete only this attempt's unreferenced copies.
    for (const key of uploaded) if (!await query(env.DB,'SELECT id FROM public_photo_objects WHERE object_key=?',[key]).first()) await env.FILES.delete(key);
    return result;
  } catch (error) {
    for (const key of uploaded) if (!await query(env.DB,'SELECT id FROM public_photo_objects WHERE object_key=?',[key]).first()) await env.FILES.delete(key);
    throw error;
  }
}
