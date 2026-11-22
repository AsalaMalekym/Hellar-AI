import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import staticPlugin from '@fastify/static';
import multipart from '@fastify/multipart';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { config, type Config } from './config.js';
import { Store } from './db.js';
import { id, token, digest, equal, HttpError, rate } from './security.js';
import { createCaptcha } from './captcha.js';
import { authRoutes } from './auth.js';
import { createMailer, type Mailer } from './mail.js';
import type { UserRow, Services, Session } from './types.js';
import { imageRoutes } from './images.js';
import { chatRoutes } from './chat.js';
import { provider, type AIProvider } from './provider.js';
import { Generations } from './generation.js';
import { profileRoutes } from './profile.js';
import { LocalStorage, collectFiles, type FileStorage } from './storage.js';
export type BuildOptions = {
  mailer?: Mailer;
  securityFetch?: typeof fetch;
  logger?: boolean;
  storage?: FileStorage;
  ai?: AIProvider;
};
export async function buildApp(c: Config = config(), options: BuildOptions = {}) {
  const app = Fastify({
    logger: options.logger
      ? {
          level: 'warn',
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.body',
            'res.headers.set-cookie',
          ],
          serializers: {
            err: (e: any) => ({
              type: e?.name || 'Error',
              code: e?.code,
              message: 'Redacted error',
              stack: '',
            }),
          },
        }
      : false,
    bodyLimit: 65536,
    trustProxy: c.trustProxy,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const version = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')).version;
  const db = new Store(c.dbPath);
  db.recover();
  const jobs = new Generations(db);
  const ai = options.ai || provider(c);
  const sessionName = c.secure ? '__Host-hellar-session' : 'hellar-session',
    preName = c.secure ? '__Host-hellar-pre' : 'hellar-pre';
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
        frameSrc: ['https://challenges.cloudflare.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'blob:', 'data:'],
        connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: c.production ? [] : null,
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: c.production ? undefined : false,
  });
  await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 2 } });
  app.decorateRequest('user', null);
  app.decorateRequest('session', null);
  const s: Services = {
    c,
    db,
    abortUser: (id) => jobs.stop(id),
    requireUser(r) {
      if (!r.user) throw new HttpError(401, 'Войди в аккаунт.', 'UNAUTHENTICATED');
      return r.user;
    },
    requireAdmin(r) {
      const u = s.requireUser(r);
      if (u.role !== 'admin') throw new HttpError(403, 'Недостаточно прав.');
      return u;
    },
    startSession(r, p, u) {
      const raw = token(),
        csrf = token(),
        sid = id();
      db.run('DELETE FROM sessions WHERE expires_at<?', Date.now());
      db.run(
        'DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 19)',
        u.id,
      );
      db.run(
        'INSERT INTO sessions(id,user_id,token_hash,csrf,created_at,expires_at,user_agent) VALUES(?,?,?,?,?,?,?)',
        sid,
        u.id,
        digest(raw),
        csrf,
        Date.now(),
        Date.now() + 7 * 86400000,
        (r.headers['user-agent'] || 'Unknown').slice(0, 200),
      );
      p.setCookie(sessionName, raw, {
        httpOnly: true,
        secure: c.secure,
        sameSite: 'strict',
        path: '/',
        maxAge: 604800,
      });
      p.clearCookie(preName, { path: '/' });
      return { csrf };
    },
    clearSession(p) {
      p.clearCookie(sessionName, {
        path: '/',
        secure: c.secure,
        httpOnly: true,
        sameSite: 'strict',
      });
    },
  };
  const captcha = createCaptcha(s, options.securityFetch);
  captcha.routes(app);
  app.addHook('onRequest', async (r, p) => {
    p.header('Cache-Control', 'no-store');
    rate(db, 'all:' + r.ip, 240, 60000);
    const raw = r.cookies[sessionName];
    if (raw) {
      const sess = db.get<Session>(
        'SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',
        digest(raw),
        Date.now(),
      );
      if (sess) {
        const u = db.get<UserRow>('SELECT * FROM users WHERE id=? AND blocked=0', sess.user_id);
        if (u) {
          r.user = u;
          r.session = sess;
        }
      }
    }
    captcha.guard(r);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method)) {
      if (r.headers.origin !== c.origin)
        throw new HttpError(403, 'Источник запроса не разрешён.', 'CSRF_REJECTED');
      const expected = r.session?.csrf || r.cookies[preName] || '';
      const sent = String(r.headers['x-csrf-token'] || '');
      if (!expected || !equal(expected, sent))
        throw new HttpError(403, 'Обнови страницу и повтори действие.', 'CSRF_REJECTED');
    }
  });
  app.setErrorHandler((error, r, p) => {
    if (error instanceof HttpError)
      return p.code(error.status).send({ error: error.message, code: error.code });
    if (error instanceof ZodError)
      return p.code(400).send({
        error: error.issues[0]?.message || 'Проверь введённые данные.',
        code: 'VALIDATION_ERROR',
      });
    const e = error as any;
    if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.statusCode === 413)
      return p.code(413).send({ error: 'Слишком большой файл или запрос.' });
    if (e.code?.startsWith('FST_ERR') && e.statusCode < 500)
      return p.code(e.statusCode).send({ error: 'Некорректный запрос.' });
    if (e.code === 'ERR_SQLITE_ERROR' && String(e.message).includes('UNIQUE'))
      return p.code(409).send({ error: 'Такая запись уже существует.' });
    r.log.error({ event: 'request_failed', requestId: r.id, type: e?.name }, 'Request failed');
    return p.code(500).send({ error: 'Внутренняя ошибка. Попробуй позже.' });
  });
  const mailer = options.mailer || createMailer(c);
  app.get('/api/health', async () => ({ ok: true, version }));
  app.get('/api/status', async () => ({
    version,
    chatReady: ai.ready,
    imageReady: ai.ready,
    mailReady: mailer.ready,
    captchaRequired: captcha.required,
    captchaReady: captcha.ready,
    turnstileSiteKey: captcha.ready ? c.captcha.siteKey : '',
    chatModels: c.chatModels,
    imageModel: c.imageModel,
    imageSizes: c.imageSizes,
    limits: { chat: c.chatLimit, image: c.imageLimit },
  }));
  await authRoutes(app, s, mailer, captcha);
  const storage = options.storage || new LocalStorage(c.storagePath);
  await collectFiles(db, storage);
  await profileRoutes(app, s, storage);
  await chatRoutes(app, s, ai, jobs);
  await imageRoutes(app, s, ai, jobs, storage);
  if (c.production && existsSync(path.resolve('dist/index.html'))) {
    await app.register(staticPlugin, { root: path.resolve('dist'), wildcard: false });
    app.setNotFoundHandler((r, p) => {
      if (r.url.startsWith('/api/')) return p.code(404).send({ error: 'Не найдено.' });
      let pathname: string;
      try {
        pathname = decodeURIComponent(r.url.split('?')[0]);
      } catch {
        return p.code(404).send({ error: 'Не найдено.' });
      }
      if (
        pathname.split('/').some((part) => part.startsWith('.')) ||
        /^\/(tests|src|server|migrations)(\/|$)/.test(pathname)
      )
        return p.code(404).send({ error: 'Не найдено.' });
      if (r.method === 'GET' && !path.extname(pathname)) return p.sendFile('index.html');
      return p.code(404).send({ error: 'Не найдено.' });
    });
  }
  app.addHook('preClose', async () => jobs.close());
  app.addHook('onClose', async () => {
    jobs.close();
    db.close();
  });
  return app;
}
