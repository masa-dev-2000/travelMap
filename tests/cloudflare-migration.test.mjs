import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportFirestore, exportUsers, requestJson, checksum, verify, PROJECT } from '../scripts/firebase-backup.mjs';
import { ASSETS, build } from '../scripts/build-cloudflare.mjs';
const root = `projects/${PROJECT}/databases/(default)/documents`;
const time = '2026-09-12T00:00:00.000Z';

test('Firestore export includes paginated documents and subcollections beneath missing parents', async () => {
  const calls = [];
  const read = async (raw, body) => {
    const url = new URL(raw);
    calls.push({ url, body });
    if (url.pathname.endsWith('/documents:listCollectionIds'))
      return body.pageToken ? { collectionIds: ['parents'] } : { collectionIds: ['logs'], nextPageToken: 'collections2' };
    if (url.pathname.endsWith('/parents/missing:listCollectionIds')) return { collectionIds: ['nested'] };
    if (url.pathname.endsWith(':listCollectionIds')) return {};
    if (url.pathname.endsWith('/logs')) return url.searchParams.get('pageToken') ? {
      documents: [{ name: `${root}/logs/b`, createTime: time, fields: { timestamp: { timestampValue: '2026-09-12T00:00:00.123456789Z' } } }]
    } : { documents: [{ name: `${root}/logs/a`, createTime: time, fields: { huge: { integerValue: '9223372036854775807' } } }], nextPageToken: 'docs2' };
    if (url.pathname.endsWith('/parents')) return { documents: [{ name: `${root}/parents/missing` }] };
    if (url.pathname.endsWith('/parents/missing/nested')) return { documents: [{ name: `${root}/parents/missing/nested/a`, createTime: time, fields: {} }] };
    throw new Error('Unexpected endpoint');
  };
  const result = await exportFirestore(read, time);
  assert.equal(result.length, 3);
  assert.equal(result[0].fields.huge.integerValue, '9223372036854775807');
  assert.equal(result[1].fields.timestamp.timestampValue, '2026-09-12T00:00:00.123456789Z');
  assert.ok(!result.some(doc => doc.name === `${root}/parents/missing`));
  assert.ok(calls.every(({url, body}) => (body?.readTime || url.searchParams.get('readTime')) === time));
});

test('Auth export follows every page', async () => {
  const result = await exportUsers(async raw => new URL(raw).searchParams.get('nextPageToken') ?
    { users: [{ localId: 'second' }] } : { users: [{ localId: 'first' }], nextPageToken: 'page2' });
  assert.equal(result.length, 2);
});

test('Repeated pagination tokens are rejected', async () => {
  await assert.rejects(exportUsers(async () => ({ nextPageToken: 'same' })), /Repeated/);
});

test('Authorization failure is not mistaken for empty data or logged verbatim', async () => {
  await assert.rejects(requestJson('https://example.test', 'secret', undefined, async () => ({ ok: false, status: 403 })), /HTTP 403/);
});

test('Verification detects a modified backup and does not imply migration completion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'travelmap-backup-test-'));
  try {
    const manifest = { format: 1, project: PROJECT, snapshotFilesVerified: true, errors: [], files: {}, migrationReady: false };
    for (const file of ['firestore.json', 'auth-users.json', 'rtdb.json']) {
      const content = '[]\n';
      await writeFile(join(dir, file), content);
      manifest.files[file] = { sha256: checksum(content), bytes: Buffer.byteLength(content) };
    }
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    assert.equal((await verify(dir)).migrationReady, false);
    await writeFile(join(dir, 'firestore.json'), '[1]\n');
    await assert.rejects(verify(dir), /Checksum mismatch/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'travelmap-build-test-'));
  for (const app of ['travelMap', 'inputTravelLog']) {
    await mkdir(join(dir, app));
    for (const file of ASSETS) await writeFile(join(dir, app, file), `fixture ${app} ${file}`);
  }
  return dir;
}

test('Build includes only the two real apps and excludes credentials/maintenance scripts', async () => {
  const dir = await fixture();
  try {
    await writeFile(join(dir, 'serviceAccountKey.json'), '{"secret":"do not deploy"}');
    await writeFile(join(dir, 'travelMap/updateFirebase.js'), 'dangerous maintenance script');
    const out = await build(dir);
    assert.deepEqual((await readdir(join(out, 'travelMap'))).sort(), [...ASSETS].sort());
    assert.match(await readFile(join(out, 'index.html'), 'utf8'), /\/travelMap\//);
    assert.ok(!(await readdir(out)).includes('serviceAccountKey.json'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Build rejects private credentials embedded in an allowed asset', async () => {
  const dir = await fixture();
  try {
    await writeFile(join(dir, 'inputTravelLog/script.js'), '-----BEGIN PRIVATE KEY-----');
    await assert.rejects(build(dir), /Private credential/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Build rejects symlinked assets', async () => {
  const dir = await fixture();
  try {
    await rm(join(dir, 'travelMap/script.js'));
    await symlink(join(dir, 'inputTravelLog/script.js'), join(dir, 'travelMap/script.js'));
    await assert.rejects(build(dir), /regular allowlisted/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
