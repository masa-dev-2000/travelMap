// Called only after worker.ts authenticates the user and checks terms/Origin.
// Never join these tables into a public feed, activity, or financial summary.
const LEASE_MS=90000,HANDOFF_MS=15000,MAX_BYTES=4096;
const DESTINATIONS=new Set(['/','/index.html','/admin/start/','/admin/record/']);
const destination=(value:unknown):string=>typeof value==='string'&&DESTINATIONS.has(value)?value:fail('移動先が不正です');
async function tokenHash(value:unknown):Promise<string>{
  if(typeof value!=='string'||! /^[0-9a-f]{64}$/.test(value))return fail('引き継ぎ情報が不正です');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
class LocationInputError extends Error {}
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const fail=(message:string):never=>{throw new LocationInputError(message);};
const uuid=(value:unknown,name:string):string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value:fail(`${name}が不正です`);
const stamp=(value:unknown):string=>{
  if(typeof value!=='string'||value.length>40||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))return fail('日時を確認してください');
  return new Date(value).toISOString();
};
const number=(value:unknown,min:number,max:number,name:string):number=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:fail(`${name}が不正です`);
async function bodyOf(request:Request):Promise<Record<string,unknown>>{
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return fail('JSON形式で送信してください');
  const reader=request.body?.getReader();if(!reader)return fail('入力がありません');
  const parts:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();return fail('入力が大きすぎます');}parts.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  let data:unknown;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{return fail('JSONを確認してください');}
  if(!data||typeof data!=='object'||Array.isArray(data))return fail('入力を確認してください');return data as Record<string,unknown>;
}
type Sample={id:string;client_id:string;capture_id:string;segment_id:string;captured_at:string;latitude:number;longitude:number;accuracy:number};
function sampleOf(body:Record<string,unknown>,now:number):Sample{
  const captured=stamp(body.captured_at),time=Date.parse(captured);
  if(time>now+120000||time<now-900000)return fail('取得時刻が古すぎるか、端末の時計がずれています');
  return {id:uuid(body.id,'位置ID'),client_id:uuid(body.client_id,'端末ID'),capture_id:uuid(body.capture_id,'記録ID'),segment_id:uuid(body.segment_id,'区間ID'),captured_at:captured,
    latitude:number(body.latitude,-90,90,'緯度'),longitude:number(body.longitude,-180,180,'経度'),accuracy:number(body.accuracy,0,10000000,'位置精度')};
}
const sameSample=(a:Sample,b:Sample)=>Object.keys(a).every(key=>a[key as keyof Sample]===b[key as keyof Sample]);
export async function locationApi(request:Request,db:D1Database,uid:string):Promise<Response|null>{
  const url=new URL(request.url),path=url.pathname,remove=path.match(/^\/api\/private\/location-samples\/([0-9a-f-]+)$/i);
  if(path!=='/api/private/location-capture'&&path!=='/api/private/location-samples'&&!remove)return null;
  if(!uid)return reply({error:'ログインが必要です'},401);
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('Origin')!==url.origin)return reply({error:'操作元を確認できません'},403);
  try{
    const now=Date.now();
    if(path==='/api/private/location-capture'&&request.method==='POST'){
      const body=await bodyOf(request),client=uuid(body.client_id,'端末ID'),capture=uuid(body.capture_id,'記録ID'),page=uuid(body.page_id,'ページID');
      if(body.command==='stop'){
        await db.prepare('DELETE FROM location_capture_leases WHERE user_id=? AND client_id=? AND capture_id=? AND page_id=?').bind(uid,client,capture,page).run();
        return reply({stopped:true});
      }
      // A token is generated in the initiating tab; the server authorizes/registers only its hash.
      // Repeating the identical prepare is safe, but cannot replace another pending token.
      if(body.command==='prepare'){
        const hash=await tokenHash(body.token),dest=destination(body.destination);
        const next=number(body.next_at,now-900000,now+300000,'次回取得日時');
        const row=await db.prepare(`UPDATE location_capture_leases SET
          handoff_expires_at=CASE WHEN handoff_hash=? AND handoff_claimed_at IS NULL THEN handoff_expires_at ELSE ? END,
          handoff_next_at=CASE WHEN handoff_hash=? AND handoff_claimed_at IS NULL THEN handoff_next_at ELSE ? END,
          handoff_hash=?,handoff_destination=?,handoff_claimed_at=NULL
          WHERE user_id=? AND client_id=? AND capture_id=? AND page_id=? AND expires_at>?
            AND (handoff_hash IS NULL OR handoff_claimed_at IS NOT NULL OR handoff_expires_at<=? OR (handoff_hash=? AND handoff_destination=?))
          RETURNING user_id owner,handoff_expires_at expires_at,handoff_next_at next_at`)
          .bind(hash,now+HANDOFF_MS,hash,next,hash,dest,uid,client,capture,page,now,now,hash,dest).first<{owner:string;expires_at:number;next_at:number}>();
        return row?reply(row):reply({error:'引き継ぎを準備できません。自動記録は停止します',code:'handoff_conflict'},409);
      }
      if(body.command==='claim'){
        const hash=await tokenHash(body.token),dest=destination(body.destination);
        // Consumption and replacement are a single atomic UPDATE, not a SELECT then UPDATE.
        // A retry from the SAME new capture/page reads the receipt without renewing the lease.
        const row=await db.prepare(`UPDATE location_capture_leases SET capture_id=?,page_id=?,
          expires_at=CASE WHEN handoff_claimed_at IS NULL THEN ? ELSE expires_at END,
          handoff_claimed_at=COALESCE(handoff_claimed_at,?)
          WHERE user_id=? AND client_id=? AND handoff_hash=? AND handoff_destination=? AND expires_at>?
            AND ((handoff_claimed_at IS NULL AND handoff_expires_at>?) OR (handoff_claimed_at IS NOT NULL AND capture_id=? AND page_id=?))
          RETURNING user_id owner,expires_at,handoff_next_at next_at`)
          .bind(capture,page,now+LEASE_MS,now,uid,client,hash,dest,now,now,capture,page).first<{owner:string;expires_at:number;next_at:number}>();
        return row?reply(row):reply({error:'引き継ぎが無効・期限切れです。スイッチで再開してください',code:'handoff_conflict'},409);
      }
      let result;
      if(body.command==='start'){
        const previousCapture=body.previous_capture_id==null?capture:uuid(body.previous_capture_id,'前の記録ID');
        // Cross-page takeover is only allowed by claim. Same-page visibility resume can rotate IDs.
        result=await db.prepare(`INSERT INTO location_capture_leases(user_id,client_id,capture_id,page_id,expires_at) VALUES(?,?,?,?,?)
          ON CONFLICT(user_id,client_id) DO UPDATE SET capture_id=excluded.capture_id,page_id=excluded.page_id,expires_at=excluded.expires_at,
            handoff_hash=NULL,handoff_destination=NULL,handoff_expires_at=NULL,handoff_claimed_at=NULL,handoff_next_at=NULL
          WHERE location_capture_leases.expires_at<=? OR
            (location_capture_leases.page_id=? AND (location_capture_leases.capture_id=? OR location_capture_leases.capture_id=?)
              AND (location_capture_leases.handoff_hash IS NULL OR location_capture_leases.handoff_claimed_at IS NOT NULL OR location_capture_leases.handoff_expires_at<=?))`)
          .bind(uid,client,capture,page,now+LEASE_MS,now,page,previousCapture,capture,now).run();
      }else if(body.command==='renew'){
        result=await db.prepare(`UPDATE location_capture_leases SET expires_at=? WHERE user_id=? AND client_id=? AND capture_id=? AND page_id=? AND expires_at>?
          AND (handoff_hash IS NULL OR handoff_claimed_at IS NOT NULL OR handoff_expires_at<=?)`).bind(now+LEASE_MS,uid,client,capture,page,now,now).run();
      }else return fail('記録操作が不正です');
      if(!result.meta.changes)return reply({error:'別のタブで記録中、または記録の有効期限が切れました',code:'capture_conflict'},409);
      return reply({owner:uid,expires_at:now+LEASE_MS});
    }
    if(path==='/api/private/location-samples'&&request.method==='POST'){
      const body=await bodyOf(request),sample=sampleOf(body,now),page=uuid(body.page_id,'ページID');
      const previous=await db.prepare('SELECT id,client_id,capture_id,segment_id,captured_at,latitude,longitude,accuracy FROM location_samples WHERE user_id=? AND id=?').bind(uid,sample.id).first<Sample>();
      if(previous)return sameSample(sample,previous)?reply({id:sample.id,saved:true,duplicate:true}):reply({error:'位置IDが別の入力で使用済みです'},409);
      const inserted=await db.prepare(`INSERT OR IGNORE INTO location_samples(user_id,id,client_id,capture_id,segment_id,captured_at,received_at,latitude,longitude,accuracy)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM location_capture_leases WHERE user_id=? AND client_id=? AND capture_id=? AND page_id=? AND expires_at>? AND (handoff_hash IS NULL OR handoff_claimed_at IS NOT NULL))`)
        .bind(uid,sample.id,sample.client_id,sample.capture_id,sample.segment_id,sample.captured_at,new Date(now).toISOString(),sample.latitude,sample.longitude,sample.accuracy,
          uid,sample.client_id,sample.capture_id,page,now).run();
      if(!inserted.meta.changes){
        const concurrent=await db.prepare('SELECT id,client_id,capture_id,segment_id,captured_at,latitude,longitude,accuracy FROM location_samples WHERE user_id=? AND id=?').bind(uid,sample.id).first<Sample>();
        if(concurrent&&sameSample(sample,concurrent))return reply({id:sample.id,saved:true,duplicate:true});
        return reply({error:'記録権限が失効しました。自動位置記録を入れ直してください',code:'capture_conflict'},409);
      }
      return reply({id:sample.id,saved:true,duplicate:false},201);
    }
    if(path==='/api/private/location-samples'&&request.method==='GET'){
      const from=url.searchParams.has('from')?stamp(url.searchParams.get('from')):new Date(now-7*86400000).toISOString();
      const to=url.searchParams.has('to')?stamp(url.searchParams.get('to')):new Date(now+120000).toISOString();
      if(from>to)return fail('開始日時が終了日時より後です');
      const limit=Number(url.searchParams.get('limit')??500);if(!Number.isInteger(limit)||limit<1||limit>500)return fail('取得件数が不正です');
      const params:(string|number)[]=[uid,from,to];let after='';
      const cursor=url.searchParams.get('cursor');
      if(cursor){
        if(cursor.length>200)return fail('続きの位置が不正です');
        let parsed:unknown;try{parsed=JSON.parse(atob(cursor));}catch{return fail('続きの位置が不正です');}
        if(!Array.isArray(parsed)||parsed.length!==2)return fail('続きの位置が不正です');
        const date=stamp(parsed[0]),key=uuid(parsed[1],'続きのID');
        if(date<from)return reply({samples:[],next_cursor:null});
        params[2]=date<to?date:to;after=' AND (captured_at<? OR (captured_at=? AND id<?))';params.push(date,date,key);
      }
      params.push(limit);
      const rows=await db.prepare('SELECT id,segment_id,captured_at,received_at,latitude,longitude,accuracy FROM location_samples WHERE user_id=? AND captured_at>=? AND captured_at<=?'+after+' ORDER BY captured_at DESC,id DESC LIMIT ?').bind(...params).all<{id:string;captured_at:string}>();
      const last=rows.results.at(-1),next=rows.results.length===limit&&last?btoa(JSON.stringify([last.captured_at,last.id])):null;
      return reply({samples:rows.results,next_cursor:next});
    }
    if(remove&&request.method==='DELETE'){
      const key=uuid(remove[1],'位置ID');const result=await db.prepare('DELETE FROM location_samples WHERE user_id=? AND id=?').bind(uid,key).run();
      return result.meta.changes?reply({deleted:true}):reply({error:'位置記録が見つかりません'},404);
    }
    return reply({error:'Method not allowed'},405);
  }catch(error){
    if(error instanceof LocationInputError)return reply({error:error.message},400);
    if(error instanceof Error&&/no such table.*location_|no such column.*handoff_/i.test(error.message))return reply({error:'自動位置記録はまだ利用できません',code:'location_not_ready'},503);
    throw error;
  }
}
