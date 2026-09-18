export class InputError extends Error {}
export type Input = Record<string, unknown>;
export function text(value: unknown, name: string, max = 200, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new InputError(`${name}を確認してください`);
  return value;
}
export function optionalText(value: unknown, name: string, max = 200): string | null {
  return value === undefined || value === null || value === '' ? null : text(value, name, max);
}
export function integer(value: unknown, name: string, max = 1_000_000_000_000): number {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0 || value > max) throw new InputError(`${name}は範囲内の整数で指定してください`);
  return value;
}
export function dateTime(value: unknown): string {
  const input = text(value, '日時', 40);
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(input) || !Number.isFinite(Date.parse(input))) throw new InputError('時差を含む日時が必要です');
  return new Date(input).toISOString();
}
export function date(value: unknown): string {
  const input = text(value, '日付', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || !Number.isFinite(Date.parse(input)) || new Date(input).toISOString().slice(0, 10) !== input) throw new InputError('日付を確認してください');
  return input;
}
export function coordinates(data: Input): [number | null, number | null] {
  const lat = data.latitude ?? null, lng = data.longitude ?? null;
  if (lat === null && lng === null) return [null, null];
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new InputError('緯度・経度を確認してください');
  return [lat, lng];
}
export function scope(url: URL, userId: string): {where: string; values: (string | number)[]} {
  const clauses: string[] = ['t.user_id=?'], values: (string | number)[] = [userId];
  const month = url.searchParams.get('month'), trip = url.searchParams.get('trip');
  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new InputError('月はYYYY-MM形式です');
    clauses.push("strftime('%Y-%m',t.occurred_at,'+9 hours')=?"); values.push(month);
  }
  if (trip) { clauses.push('t.trip_id=?'); values.push(text(trip, '旅ID')); }
  return {where: ' WHERE '+clauses.join(' AND '), values};
}
export async function readBytes(request: Request, limit: number): Promise<Uint8Array> {
  if (!request.body) throw new InputError('入力が空です');
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new InputError('データが大きすぎます'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function readInput(request: Request): Promise<Input> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new InputError('JSON形式が必要です');
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(await readBytes(request, 64 * 1024)));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Input;
  } catch (error) { if (error instanceof InputError) throw error; throw new InputError('入力形式を確認してください'); }
}
export async function sha256(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(data));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
