import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
  scrypt as scryptCallback,
} from 'node:crypto';
import type { Store } from './db.js';
import { derivePasswordKey } from './password-kdf.js';
let hashing = 0;
const scrypt = async (
  password: string,
  salt: string,
  length: number,
  options: import('node:crypto').ScryptOptions,
) => {
  if (hashing >= 2)
    throw new HttpError(
      429,
      'Сервис авторизации занят. Повтори через несколько секунд.',
      'AUTH_BUSY',
    );
  hashing++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scryptCallback(password, salt, length, options, (err, key) =>
        err ? reject(err) : resolve(key),
      ),
    );
  } finally {
    hashing--;
  }
};
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString('base64url');
export const digest = (v: string) => createHash('sha256').update(v).digest('hex');
export const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
async function pbkdf2(password: string, salt: string) {
  if (hashing >= 2) throw new HttpError(429, 'Сервис авторизации занят. Повтори через несколько секунд.', 'AUTH_BUSY');
  hashing++;
  try { return await derivePasswordKey(password, salt); }
  finally { hashing--; }
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `pbkdf2$600000$${salt}$${(await pbkdf2(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string) {
  try {
    if (hash.startsWith('pbkdf2$')) {
      const [algorithm, iterations, salt, key] = hash.split('$');
      if (iterations !== '600000' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{64}$/.test(key)) return false;
      return equal((await pbkdf2(password, salt)).toString('hex'), key);
    }
    const [algorithm, n, r, p, salt, key] = hash.split('$');
    if (algorithm !== 'scrypt' || n !== '131072' || r !== '8' || p !== '1' || !salt || !key)
      return false;
    const result = (await scrypt(password, salt, 64, {
      N: 131072,
      r: 8,
      p: 1,
      maxmem: 256 * 1024 * 1024,
    })) as Buffer;
    return equal(result.toString('hex'), key);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return false;
  }
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = '',
  ) {
    super(message);
  }
}
export function rate(db: Store, key: string, max: number, windowMs: number) {
  const now = Date.now();
  db.run('DELETE FROM rate_limits WHERE expires_at<?', now);
  const r = db.get(
    'INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',
    digest(key),
    now + windowMs,
  );
  if (r.count > max)
    throw new HttpError(429, 'Слишком много попыток. Попробуй позже.', 'RATE_LIMITED');
}
export function audit(db: Store, actor: string | null, action: string, target: string | null) {
  db.run('INSERT INTO audit VALUES(?,?,?,?,?)', id(), actor, action, target, Date.now());
}
export function quota(
  db: Store,
  userId: string,
  kind: 'chat' | 'image',
  userLimit: number,
  globalLimit: number,
) {
  const day = new Date().toISOString().slice(0, 10);
  db.tx(() => {
    for (const [who, max] of [
      [userId, userLimit],
      ['__global__', globalLimit],
    ] as const) {
      const used = db.get(
        'SELECT count FROM usage WHERE user_id=? AND kind=? AND day=?',
        who,
        kind,
        day,
      );
      if ((used?.count || 0) >= max)
        throw new HttpError(
          429,
          who === '__global__'
            ? 'Общий дневной лимит сервиса исчерпан.'
            : 'Твой дневной лимит исчерпан. Он обновится в 03:00 по Москве.',
          'QUOTA_EXCEEDED',
        );
      db.run(
        'INSERT INTO usage(user_id,kind,day,count) VALUES(?,?,?,1) ON CONFLICT(user_id,kind,day) DO UPDATE SET count=count+1',
        who,
        kind,
        day,
      );
    }
  });
}
