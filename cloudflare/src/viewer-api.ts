import {json,loadPublicEntries,travelling} from './api.ts';
import {InputError,readInput,text} from './validation.ts';
import type {User} from './auth.ts';
const query=(db:D1Database,sql:string,values:(string|number|null)[]=[])=>db.prepare(sql).bind(...values);
const paths=new Set(['/api/private/viewer-feed','/api/private/mutes','/api/private/read-cursor']);

// Assign only eligible publications. Scheduled/hidden entries cannot sit behind a read
// cursor before they become visible. Concurrent inserts are serialized by SQLite.
export async function ensurePublicOrder(db:D1Database,now:string):Promise<void> {
  await query(db,`INSERT OR IGNORE INTO public_entry_sequence(entry_id,author_user_id)
    SELECT p.id,p.user_id FROM public_entries p
    WHERE p.status='published' AND (p.publish_at IS NULL OR p.publish_at<=?) AND ${travelling('p.user_id')}
      AND NOT EXISTS (SELECT 1 FROM public_entry_sequence s WHERE s.entry_id=p.id)
    ORDER BY COALESCE(p.publish_at,''),p.rowid`,[now,now]).run();
}
export async function viewerApi(request:Request,env:Env,user:User):Promise<Response|null> {
  const url=new URL(request.url),path=url.pathname,db=env.DB,uid=user.id;
  if(!paths.has(path))return null;
  try {
    const now=new Date().toISOString();
    if(request.method==='GET'&&path==='/api/private/viewer-feed'){
      await ensurePublicOrder(db,now);
      const [entries,mutes]=await Promise.all([
        loadPublicEntries(env,null,now,uid),
        query(db,'SELECT u.handle FROM user_mutes m JOIN users u ON u.id=m.muted_user_id WHERE m.viewer_user_id=?',[uid]).all<{handle:string}>()
      ]);
      const people=new Map<string,{handle:string;display_name:string;icon:unknown;avatar_url:unknown;icon_url:unknown;has_unread:boolean;first_unread:number|null;latest_seq:number}>();
      for(const e of entries){
        const seq=Number(e.publication_seq),u=people.get(e.author)||{handle:e.author,display_name:e.author_name||e.author,icon:e.author_icon,avatar_url:e.author_avatar,icon_url:e.author_icon_url,has_unread:false,first_unread:null,latest_seq:0};
        u.latest_seq=Math.max(u.latest_seq,seq);
        if(e.unread){u.has_unread=true;u.first_unread=u.first_unread===null?seq:Math.min(u.first_unread,seq);}
        people.set(e.author,u);
      }
      const users=[...people.values()].sort((a,b)=>b.latest_seq-a.latest_seq||a.handle.localeCompare(b.handle));
      return json({version:1,self:user.handle,users,entries,muted:mutes.results.map(r=>r.handle)});
    }
    if(request.method==='GET'&&path==='/api/private/mutes'){
      // Do not turn settings into a directory of non-public registrations.
      const rows=await query(db,`SELECT u.handle,u.display_name,u.icon,u.avatar_url,
        CASE WHEN m.muted_user_id IS NULL THEN 0 ELSE 1 END muted
        FROM users u LEFT JOIN user_mutes m ON m.muted_user_id=u.id AND m.viewer_user_id=?
        WHERE u.id<>? AND u.terms_accepted_at IS NOT NULL AND (m.muted_user_id IS NOT NULL OR
          (EXISTS(SELECT 1 FROM public_entries p WHERE p.user_id=u.id AND p.status='published' AND (p.publish_at IS NULL OR p.publish_at<=?)) AND ${travelling('u.id')}))
        ORDER BY u.display_name,u.handle`,[uid,uid,now,now]).all();
      return json({users:rows.results});
    }
    if(request.method==='POST'&&path==='/api/private/mutes'){
      const body=await readInput(request),handle=text(body.handle,'ユーザー',40);
      if(typeof body.muted!=='boolean')throw new InputError('ミュート設定を確認してください');
      const target=await query(db,`SELECT u.id FROM users u WHERE u.handle=? AND u.id<>? AND u.terms_accepted_at IS NOT NULL
        AND (EXISTS(SELECT 1 FROM user_mutes m WHERE m.viewer_user_id=? AND m.muted_user_id=u.id) OR
        (EXISTS(SELECT 1 FROM public_entries p WHERE p.user_id=u.id AND p.status='published' AND (p.publish_at IS NULL OR p.publish_at<=?)) AND ${travelling('u.id')}))`,[handle,uid,uid,now,now]).first<{id:string}>();
      if(!target)return json({error:'ユーザーが見つかりません'},404);
      if(body.muted)await query(db,'INSERT OR IGNORE INTO user_mutes VALUES(?,?,?)',[uid,target.id,now]).run();
      else await query(db,'DELETE FROM user_mutes WHERE viewer_user_id=? AND muted_user_id=?',[uid,target.id]).run();
      return json({handle,muted:body.muted});
    }
    if(request.method==='POST'&&path==='/api/private/read-cursor'){
      const body=await readInput(request),entryId=text(body.entry_id,'記録',100);
      const gate=`p.id=? AND p.status='published' AND p.user_id<>? AND (p.publish_at IS NULL OR p.publish_at<=?) AND ${travelling('p.user_id')}
        AND NOT EXISTS(SELECT 1 FROM user_mutes m WHERE m.viewer_user_id=? AND m.muted_user_id=p.user_id)`;
      // Eligibility and monotonicity are in the write, not a racy SELECT/JS check.
      const results=await db.batch<{handle:string;last_seen_seq:number}>([
        query(db,`INSERT INTO public_read_cursors(viewer_user_id,author_user_id,last_seen_seq,last_seen_entry_id,updated_at)
          SELECT ?,p.user_id,s.seq,p.id,? FROM public_entries p JOIN public_entry_sequence s ON s.entry_id=p.id
          WHERE ${gate}
          ON CONFLICT(viewer_user_id,author_user_id) DO UPDATE SET last_seen_seq=excluded.last_seen_seq,
            last_seen_entry_id=excluded.last_seen_entry_id,updated_at=excluded.updated_at
          WHERE excluded.last_seen_seq>public_read_cursors.last_seen_seq`,[uid,now,entryId,uid,now,now,uid]),
        query(db,`SELECT u.handle,r.last_seen_seq FROM public_entries p JOIN users u ON u.id=p.user_id
          JOIN public_read_cursors r ON r.author_user_id=p.user_id AND r.viewer_user_id=?
          WHERE ${gate}`,[uid,entryId,uid,now,now,uid])
      ]);
      const row=results[1].results[0];
      return row?json({saved:true,author:row.handle,last_seen_seq:row.last_seen_seq}):json({error:'閲覧できる記録が見つかりません'},404);
    }
    return json({error:'Method not allowed'},405);
  }catch(error){
    if(error instanceof InputError)throw error;
    if(error instanceof Error&&/no such (table|column)/i.test(error.message))return json({error:'人物情報を一時的に利用できません',code:'viewer_unavailable'},503);
    throw error;
  }
}
