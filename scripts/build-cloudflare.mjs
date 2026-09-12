import { copyFile, mkdir, readFile, rm, writeFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Never publish the repository root: it contains maintenance scripts and may contain credentials.
export const ASSETS = ['index.html', 'script.js', 'style.css', 'generated-icon.png'];
export async function build(root = resolve(fileURLToPath(new URL('..', import.meta.url)))) {
  const destination = join(root, '.cloudflare-dist');
  for (const app of ['travelMap', 'inputTravelLog']) {
    if ((await lstat(join(root, app))).isSymbolicLink()) throw new Error('Symlinked application directory rejected.');
    for (const file of ASSETS) {
      const stat = await lstat(join(root, app, file));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Only regular allowlisted assets can be published.');
      if (/\.(html|js|css)$/.test(file)) {
        const source = await readFile(join(root, app, file), 'utf8');
        if (/-----BEGIN (?:RSA )?PRIVATE KEY-----|"type"\s*:\s*"service_account"/.test(source))
          throw new Error('Private credential detected in an asset.');
      }
    }
  }
  await rm(destination, { recursive: true, force: true });
  for (const app of ['travelMap', 'inputTravelLog']) {
    await mkdir(join(destination, app), { recursive: true });
    for (const file of ASSETS) await copyFile(join(root, app, file), join(destination, app, file));
  }
  await writeFile(join(destination, 'index.html'), '<!doctype html><html lang="ja"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/travelMap/"><title>travelMap</title><a href="/travelMap/">旅行マップ</a></html>\n');
  await writeFile(join(destination, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Cache-Control: no-cache\n');
  console.log('Built .cloudflare-dist (8 allowlisted application assets). No deployment was performed.');
  return destination;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  build().catch(err => { console.error(err.message); process.exitCode = 1; });
}
