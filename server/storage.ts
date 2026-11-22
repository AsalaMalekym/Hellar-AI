import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { id, HttpError } from './security.js';
import type { Store } from './db.js';
export interface FileStorage {
  put(data: Buffer, extension: 'png' | 'webp'): Promise<string>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
export class LocalStorage implements FileStorage {
  constructor(private root: string) {}
  private file(key: string) {
    if (!/^[a-f0-9-]{36}\.(png|webp)$/.test(key)) throw new HttpError(404, 'Файл не найден.');
    return path.join(this.root, key);
  }
  async put(data: Buffer, ext: 'png' | 'webp') {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const key = id() + '.' + ext;
    await writeFile(this.file(key), data, { flag: 'wx', mode: 0o600 });
    return key;
  }
  async read(key: string) {
    try {
      return await readFile(this.file(key));
    } catch {
      throw new HttpError(404, 'Файл не найден.');
    }
  }
  async delete(key: string) {
    try {
      await unlink(this.file(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}
export function enqueueDelete(db: Store, key: string | null) {
  if (key) db.run('INSERT OR IGNORE INTO file_gc(key,created_at) VALUES(?,?)', key, Date.now());
}
export async function collectFiles(db: Store, storage: FileStorage) {
  for (const row of db.all('SELECT key FROM file_gc LIMIT 100')) {
    try {
      await storage.delete(row.key);
      db.run('DELETE FROM file_gc WHERE key=?', row.key);
    } catch {
      /* retained for next collection */
    }
  }
}
export async function safeImage(data: Buffer, avatar = false) {
  try {
    if (data.length > (avatar ? 2 : 24) * 1024 * 1024) throw Error('size');
    const input = sharp(data, {
      limitInputPixels: avatar ? 20000000 : 36000000,
      animated: false,
      failOn: 'warning',
    });
    const meta = await input.metadata();
    if (!['png', 'jpeg', 'webp'].includes(meta.format || '') || (meta.pages || 1) > 1)
      throw Error('format');
    const pipeline = input.rotate();
    return avatar
      ? await pipeline.resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toBuffer()
      : await pipeline.png().toBuffer();
  } catch {
    throw new HttpError(400, 'Нужен корректный PNG, JPEG или WebP допустимого размера.');
  }
}
