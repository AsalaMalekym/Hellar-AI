import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp, type BuildOptions } from '../server/app.js';
import { config, type Config } from '../server/config.js';
import { Store } from '../server/db.js';
import { id, token, digest, hashPassword } from '../server/security.js';
export const PASSWORD = 'Test-password-2026!';
let hashed: Promise<string>;
export async function fixture(overrides: Partial<Config> = {}, options: BuildOptions = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hellar-test-'));
  const c = {
    ...config(),
    origin: 'http://localhost:5173',
    dbPath: path.join(dir, 'test.sqlite'),
    storagePath: path.join(dir, 'files'),
    ...overrides,
  };
  const db = new Store(c.dbPath);
  const admin = id();
  hashed ??= hashPassword(PASSWORD);
  db.run(
    'INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',
    admin,
    'admin@example.com',
    'Администратор',
    await hashed,
    'admin',
    Date.now(),
  );
  const seedInvite = () => {
    const raw = token();
    db.run(
      'INSERT INTO invitations(id,token_hash,label,created_at,expires_at) VALUES(?,?,?,?,?)',
      id(),
      digest(raw),
      'test',
      Date.now(),
      Date.now() + 3600000,
    );
    return raw;
  };
  const app = await buildApp(c, options);
  let counter = 0;
  function client() {
    const jar = new Map<string, string>();
    let csrf = '';
    const ip = '127.0.1.' + ++counter;
    return {
      async request(
        method: string,
        url: string,
        body?: unknown,
        headers: Record<string, string> = {},
      ) {
        const r = await app.inject({
          method: method as any,
          url: '/api' + url,
          payload: body as Record<string, unknown> | undefined,
          remoteAddress: ip,
          headers: {
            origin: c.origin,
            cookie: Array.from(jar)
              .map(([k, v]) => k + '=' + v)
              .join('; '),
            'x-csrf-token': csrf,
            ...headers,
          },
        });
        for (const v of [r.headers['set-cookie'] || []].flat()) {
          const [pair] = String(v).split(';');
          const at = pair.indexOf('=');
          jar.set(pair.slice(0, at), pair.slice(at + 1));
        }
        try {
          const data = r.json();
          if (data.csrf) csrf = data.csrf;
        } catch {}
        return r;
      },
      async init() {
        return this.request('GET', '/auth/me');
      },
      async login(email = 'admin@example.com', password = PASSWORD) {
        await this.init();
        return this.request('POST', '/auth/login', { email, password });
      },
      async register(email = 'member@example.com', invitation = seedInvite()) {
        await this.init();
        return this.request('POST', '/auth/register', {
          email,
          name: 'Тестовый пользователь',
          password: PASSWORD,
          confirmPassword: PASSWORD,
          invitation,
        });
      },
    };
  }
  return {
    app,
    db,
    c,
    admin,
    client,
    seedInvite,
    async close() {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
