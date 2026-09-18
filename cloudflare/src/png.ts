import { InputError } from './validation.ts';
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let j=0;j<8;j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function cleanPng(data: Uint8Array): Uint8Array {
  const magic = [137,80,78,71,13,10,26,10];
  if (!magic.every((b,i) => data[i] === b)) throw new InputError('公開写真はPNGを選択してください');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const chunks = [data.slice(0,8)], kinds: string[] = [];
  let pos = 8;
  while (pos < data.length) {
    if (pos + 12 > data.length) throw new InputError('PNGが壊れています');
    const length = view.getUint32(pos), end = pos + length + 12;
    if (end > data.length) throw new InputError('PNGが壊れています');
    const kind = String.fromCharCode(...data.slice(pos+4, pos+8));
    if (crc32(data.subarray(pos+4, end-4)) !== view.getUint32(end-4)) throw new InputError('PNGの検査に失敗しました');
    if (['acTL','fcTL','fdAT'].includes(kind)) throw new InputError('静止画像を選択してください');
    if (!kinds.length && (kind !== 'IHDR' || length !== 13)) throw new InputError('PNGのヘッダーが不正です');
    if (kind === 'IHDR' && (view.getUint32(pos+8) > 8192 || view.getUint32(pos+12) > 8192)) throw new InputError('画像は8192ピクセル以内にしてください');
    if (['IHDR','PLTE','IDAT','IEND','tRNS'].includes(kind)) chunks.push(data.slice(pos,end));
    else if ((data[pos+4] & 32) === 0) throw new InputError('未対応のPNGです');
    kinds.push(kind); pos=end;
    if (kind === 'IEND') { if (length || pos !== data.length) throw new InputError('PNGの終端が不正です'); break; }
  }
  if (kinds.filter(k => k === 'IHDR').length !== 1 || !kinds.includes('IDAT') || kinds.at(-1) !== 'IEND') throw new InputError('PNGが不完全です');
  const output = new Uint8Array(chunks.reduce((n,c) => n+c.length,0)); let offset = 0;
  for (const chunk of chunks) { output.set(chunk,offset); offset += chunk.length; }
  return output;
}
