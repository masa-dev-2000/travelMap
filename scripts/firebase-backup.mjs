import { createHash, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROJECT = 'sharetravelinfolikedq';
const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const FIRESTORE = 'https://firestore.googleapis.com/v1/';
const RTDB = `https://${PROJECT}-default-rtdb.firebaseio.com`;
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
export const checksum = text => createHash('sha256').update(text).digest('hex');

// Only read endpoints are used. Error bodies and credentials are never logged.
export async function requestJson(url, token, body, fetcher = fetch) {
  const res = await fetcher(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error(`Backup read failed (HTTP ${res.status}); no source data was changed.`);
  return res.json();
}

async function accessToken() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT ||
    (process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8') : null);
  if (!raw) throw new Error('Set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS. Do not paste credentials into chat.');
  let sa;
  try { sa = JSON.parse(raw); } catch { throw new Error('Invalid service-account JSON.'); }
  if (sa.project_id !== PROJECT || !sa.client_email || !sa.private_key)
    throw new Error(`A service account for ${PROJECT} is required.`);
  const now = Math.floor(Date.now() / 1000);
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token', iat: now - 30, exp: now + 3500
  })}`;
  const assertion = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url')}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`Firebase authentication failed (HTTP ${res.status}).`);
  const value = await res.json();
  if (!value.access_token) throw new Error('Firebase did not return an access token.');
  return value.access_token;
}

// Native REST Values preserve int64 strings, nanosecond timestamps and references.
// The same readTime is used for collections and documents, including missing parents.
export async function exportFirestore(read, readTime) {
  const documents = [];
  const seen = new Set();
  async function walk(parent) {
    let collectionPage;
    const collectionTokens = new Set();
    do {
      const result = await read(`${FIRESTORE}${encodePath(parent)}:listCollectionIds`, {
        pageSize: 1000, readTime, ...(collectionPage ? { pageToken: collectionPage } : {})
      });
      for (const collectionId of result.collectionIds || []) {
        let page;
        const tokens = new Set();
        do {
          const url = new URL(`${FIRESTORE}${encodePath(parent)}/${encodeURIComponent(collectionId)}`);
          url.search = new URLSearchParams({ pageSize: '1000', showMissing: 'true', readTime, ...(page ? { pageToken: page } : {}) });
          const batch = await read(url.toString());
          for (const doc of batch.documents || []) {
            if (!doc.name?.startsWith(`${ROOT}/`) || seen.has(doc.name))
              throw new Error('Unexpected or duplicate Firestore document; backup aborted.');
            seen.add(doc.name);
            if (doc.createTime || doc.updateTime) documents.push(doc);
            await walk(doc.name);
          }
          page = batch.nextPageToken;
          if (page && tokens.has(page)) throw new Error('Repeated Firestore page token.');
          if (page) tokens.add(page);
        } while (page);
      }
      collectionPage = result.nextPageToken;
      if (collectionPage && collectionTokens.has(collectionPage)) throw new Error('Repeated collection page token.');
      if (collectionPage) collectionTokens.add(collectionPage);
    } while (collectionPage);
  }
  await walk(ROOT);
  return documents.sort((a, b) => a.name.localeCompare(b.name));
}

export async function exportUsers(read) {
  const users = [], seen = new Set();
  let page;
  do {
    const url = new URL(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchGet`);
    url.search = new URLSearchParams({ maxResults: '1000', ...(page ? { nextPageToken: page } : {}) });
    const result = await read(url.toString());
    users.push(...(result.users || []));
    page = result.nextPageToken;
    if (page && seen.has(page)) throw new Error('Repeated Auth page token.');
    if (page) seen.add(page);
  } while (page);
  return users;
}

export async function backup(destination) {
  process.umask(0o077);
  const token = await accessToken();
  const dir = resolve(destination || join(homedir(), 'travelmap-backups', new Date().toISOString().replace(/[:.]/g, '-')));
  await mkdir(dir, { recursive: false, mode: 0o700 });
  const read = (url, body) => requestJson(url, token, body);
  const startedAt = new Date().toISOString();
  const readTime = new Date(Date.now() - 5000).toISOString();
  const manifest = { format: 1, project: PROJECT, database: '(default)', startedAt, readTime,
    sourceChanged: false, files: {}, errors: [], snapshotFilesVerified: false,
    migrationReady: false, restoreTested: false,
    limitations: [
      'Firestore uses one readTime; Auth and RTDB are captured separately. Stop application writes before the final backup.',
      'Auth hash parameters, live security rules, indexes, storage objects, other databases and tenant users need separate inventory/export.',
      'This is an application data export, not a complete Firebase project export. Do not delete Firebase.',
      'Files are private-permission plaintext. Copy to protected storage outside Codespaces; never commit or upload as public CI artifacts.'
    ] };
  for (const [name, operation] of Object.entries({
    'firestore.json': () => exportFirestore(read, readTime),
    'auth-users.json': () => exportUsers(read),
    'rtdb.json': () => read(`${RTDB}/.json`)
  })) {
    try {
      const data = await operation();
      const text = JSON.stringify(data, null, 2) + '\n';
      await writeFile(join(dir, name), text, { mode: 0o600, flag: 'wx' });
      const stored = await readFile(join(dir, name), 'utf8');
      if (checksum(stored) !== checksum(text)) throw new Error('Backup checksum mismatch.');
      manifest.files[name] = { sha256: checksum(text), bytes: Buffer.byteLength(text), count: Array.isArray(data) ? data.length : null };
    } catch (err) {
      manifest.errors.push({ file: name, message: err.message });
    }
  }
  manifest.snapshotFilesVerified = manifest.errors.length === 0;
  manifest.finishedAt = new Date().toISOString();
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`Backup directory: ${dir}`);
  console.log(`Captured components: ${Object.keys(manifest.files).length}/3. Migration ready: false; full inventory and restore test remain.`);
  if (manifest.errors.length) throw new Error('Backup is partial. See private manifest.json; do not migrate or delete the source.');
  return manifest;
}

export async function verify(dir) {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  if (manifest.project !== PROJECT || manifest.format !== 1 || !manifest.snapshotFilesVerified || manifest.errors?.length)
    throw new Error('Backup manifest is incomplete or belongs to another project.');
  const names = ['firestore.json', 'auth-users.json', 'rtdb.json'];
  if (Object.keys(manifest.files || {}).sort().join() !== names.sort().join()) throw new Error('Unexpected backup component list.');
  for (const name of names) {
    const bytes = await readFile(join(dir, name));
    if (checksum(bytes) !== manifest.files[name].sha256 || bytes.length !== manifest.files[name].bytes)
      throw new Error(`Checksum mismatch: ${name}`);
    JSON.parse(bytes.toString('utf8'));
  }
  console.log('Backup file checksums verified. This does not constitute a restore test or migration completion.');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, directory] = process.argv.slice(2);
  try {
    if (command === 'backup') {
      if (!directory) await mkdir(join(homedir(), 'travelmap-backups'), { recursive: true, mode: 0o700 });
      await backup(directory);
    } else if (command === 'verify' && directory) await verify(resolve(directory));
    else throw new Error('Usage: node scripts/firebase-backup.mjs backup [new-directory] | verify <directory>');
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
