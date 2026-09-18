// Prints the owner migration SQL with placeholders filled in. Pipe it to `wrangler d1 execute`.
// usage: node scripts/migrate-owner.mjs --email you@example.com --name "表示名" --handle you [--id uuid] > /tmp/owner.sql
import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{email:{type:'string'},name:{type:'string'},handle:{type:'string'},id:{type:'string'}}});
if(!/^[^\s@']+@[^\s@']+\.[^\s@']+$/.test(values.email||'')||!values.name||!/^[a-z0-9][a-z0-9-]{1,23}$/.test(values.handle||''))throw new Error('--email, --name and --handle (a-z0-9-) are required.');
const id=values.id??crypto.randomUUID();
if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('--id must be a UUID.');
const sql=await readFile(new URL('../migrations/0001-users.sql',import.meta.url),'utf8');
const escape=value=>value.replace(/'/g,"''");
process.stdout.write(sql.replaceAll('__OWNER_ID__',id).replaceAll('__OWNER_EMAIL__',escape(values.email.toLowerCase())).replaceAll('__OWNER_NAME__',escape(values.name)).replaceAll('__OWNER_HANDLE__',values.handle));
