import { PNG } from 'pngjs';
import { HttpError, id } from '../server/security.js';
import type { Store } from './db.js';
export interface FileStorage {
  put(data: Buffer, extension: 'png' | 'webp'): Promise<string>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
export class R2Storage implements FileStorage {
  constructor(private bucket: R2Bucket) {}
  private check(key: string) {
    if (!/^[a-f0-9-]{36}\.(png|webp)$/.test(key)) throw new HttpError(404, 'Файл не найден.');
    return key;
  }
  async put(data: Buffer, ext: 'png' | 'webp') {
    const key = id() + '.' + ext;
    await this.bucket.put(key, data, { httpMetadata: { contentType: 'image/' + ext } });
    return key;
  }
  async read(key: string) {
    const result = await this.bucket.get(this.check(key));
    if (!result) throw new HttpError(404, 'Файл не найден.');
    return Buffer.from(await result.arrayBuffer());
  }
  async delete(key: string) { await this.bucket.delete(this.check(key)); }
}
// Generated images are explicitly requested as PNG. Decode and re-encode to remove metadata.
export function pngMetadata(data: Buffer) {
  if (data.length < 33 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new HttpError(400, 'Некорректный PNG.');
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  if (!width || !height || width * height > 4200000) throw new HttpError(400, 'Изображение слишком большое.');
  return { width, height };
}
export async function safeImage(data: Buffer, avatar = false) {
  if (avatar) throw new HttpError(503, 'Загрузка аватаров в этой версии Cloudflare пока недоступна.');
  if (data.length > 24 * 1024 * 1024) throw new HttpError(400, 'Файл слишком большой.');
  pngMetadata(data);
  try { return PNG.sync.write(PNG.sync.read(data, { checkCRC: true })); }
  catch { throw new HttpError(400, 'Некорректный PNG.'); }
}
export function enqueueDelete(db: Store, key: string | null) {
  if (key) db.run('INSERT OR IGNORE INTO file_gc(key,created_at) VALUES(?,?)', key, Date.now());
}
export async function collectFiles(db: Store, storage: FileStorage) {
  for (const row of db.all('SELECT key FROM file_gc LIMIT 100')) {
    try { await storage.delete(row.key); db.run('DELETE FROM file_gc WHERE key=?', row.key); }
    catch { /* Retry on next collection. */ }
  }
}
