import {mkdir,copyFile,cp} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
await mkdir(new URL('public/vendor/',root),{recursive:true});
for(const file of ['leaflet.js','leaflet.css']) await copyFile(new URL('node_modules/leaflet/dist/'+file,root),new URL('public/vendor/'+file,root));
await copyFile(new URL('node_modules/leaflet/LICENSE',root),new URL('public/vendor/leaflet.LICENSE',root));
await cp(new URL('node_modules/leaflet/dist/images/',root),new URL('public/vendor/images/',root),{recursive:true});
for(const file of ['maplibre-gl.mjs','maplibre-gl-shared.mjs','maplibre-gl-worker.mjs','maplibre-gl.css'])await copyFile(new URL('node_modules/maplibre-gl/dist/'+file,root),new URL('public/vendor/'+file,root));
await copyFile(new URL('node_modules/maplibre-gl/LICENSE.txt',root),new URL('public/vendor/maplibre-gl.LICENSE',root));
