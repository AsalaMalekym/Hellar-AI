import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { Store } from './db.js';
import { Router } from './router.js';
import { R2Storage } from './storage.js';
import { authRoutes } from '../server/auth.js';
import { chatRoutes } from '../server/chat.js';
import { imageRoutes } from '../server/images.js';
import { profileRoutes } from '../server/profile.js';
import { Generations } from '../server/generation.js';
import { provider } from '../server/provider.js';
import { config } from '../server/config.js';
import { digest, equal, hashPassword, HttpError, id, rate, token } from '../server/security.js';
import type { Services, UserRow, Session } from '../server/types.js';
import packageInfo from '../package.json';

export interface Env {
  HELLAR: DurableObjectNamespace;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  APP_ORIGIN?: string;
  OPENAI_API_KEY?: string;
  SETUP_TOKEN?: string;
  [key: string]: unknown;
}
export class HellarDatabase extends DurableObject<Env> {
  private router!: Router;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx,env);
    ctx.blockConcurrencyWhile(async () => {
      const db = new Store(ctx.storage);
      db.recover();
      // config() reads non-secret settings; all request trust decisions use the fixed APP_ORIGIN.
      const c = config();
      c.key = env.OPENAI_API_KEY || '';
      const jobs = new Generations(db as any);
      const ai = provider(c);
      const storage = new R2Storage(env.FILES);
      const router = this.router = new Router();
      const sessionName = c.secure ? '__Host-hellar-session' : 'hellar-session';
      const preName = c.secure ? '__Host-hellar-pre' : 'hellar-pre';
      const s: Services = {
        c, db: db as any,
        abortUser: (uid) => jobs.stop(uid),
        requireUser(r) { if (!r.user) throw new HttpError(401,'Войди в аккаунт.','UNAUTHENTICATED'); return r.user; },
        requireAdmin(r) { const u = s.requireUser(r); if (u.role !== 'admin') throw new HttpError(403,'Недостаточно прав.'); return u; },
        startSession(r,p,u) {
          const raw = token(), csrf = token(), sid = id();
          db.run('DELETE FROM sessions WHERE expires_at<?',Date.now());
          db.run('DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 19)',u.id);
          db.run('INSERT INTO sessions(id,user_id,token_hash,csrf,created_at,expires_at,user_agent) VALUES(?,?,?,?,?,?,?)',sid,u.id,digest(raw),csrf,Date.now(),Date.now()+604800000,(r.headers['user-agent']||'Unknown').slice(0,200));
          p.setCookie(sessionName,raw,{httpOnly:true,secure:c.secure,sameSite:'strict',path:'/',maxAge:604800});
          p.clearCookie(preName,{path:'/',secure:c.secure});
          return {csrf};
        },
        clearSession(p) { p.clearCookie(sessionName,{path:'/',secure:c.secure,httpOnly:true,sameSite:'strict'}); },
      };
      router.before = async (r,p) => {
        rate(db as any, 'all:' + r.ip,240,60000);
        const raw = r.cookies[sessionName];
        if (raw) {
          const sess = db.get<Session>('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',digest(raw),Date.now());
          if (sess) { const u = db.get<UserRow>('SELECT * FROM users WHERE id=? AND blocked=0',sess.user_id); if (u) {r.user=u;r.session=sess;} }
        }
        if (!['GET','HEAD','OPTIONS'].includes(r.method)) {
          if (r.headers.origin !== c.origin) throw new HttpError(403,'Источник запроса не разрешён.','CSRF_REJECTED');
          const expected = r.session?.csrf || r.cookies[preName] || '';
          if (!expected || !equal(expected,String(r.headers['x-csrf-token']||''))) throw new HttpError(403,'Обнови страницу и повтори действие.','CSRF_REJECTED');
        }
      };
      router.get('/api/health',async () => ({ok:true,version:packageInfo.version,runtime:'cloudflare'}));
      router.get('/api/status',async () => ({ version:packageInfo.version,chatReady:ai.ready,imageReady:ai.ready,mailReady:false,avatarReady:false,chatModels:c.chatModels,imageModel:c.imageModel,imageSizes:c.imageSizes,limits:{chat:c.chatLimit,image:c.imageLimit} }));
      router.post('/api/setup',async (r:any) => {
        rate(db as any,'setup:'+r.ip,5,3600000);
        if (!env.SETUP_TOKEN || env.SETUP_TOKEN.length < 32 || !equal(String(r.headers['x-setup-token']||''),env.SETUP_TOKEN)) throw new HttpError(403,'Неверный ключ первоначальной настройки.');
        if (db.get("SELECT id FROM users WHERE role='admin'")) throw new HttpError(409,'Администратор уже создан.');
        const b = z.object({email:z.string().email().max(254).transform(x=>x.trim().toLowerCase()),name:z.string().trim().min(2).max(60),password:z.string().min(12).max(128)}).parse(r.body);
        const hashed = await hashPassword(b.password);
        db.tx(() => {
          if (db.get("SELECT id FROM users WHERE role='admin'")) throw new HttpError(409,'Администратор уже создан.');
          db.run('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',id(),b.email,b.name,hashed,'admin',Date.now());
        });
        return {ok:true};
      });
      const mailer = { ready:false, async sendReset() { throw new HttpError(503,'Почтовый сервис ещё не подключён.'); } };
      await authRoutes(router as any,s,mailer);
      await chatRoutes(router as any,s,ai,jobs);
      await imageRoutes(router as any,s,ai,jobs,storage);
      await profileRoutes(router as any,s,storage);
    });
  }
  fetch(request: Request) { return this.router.fetch(request); }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (!env.APP_ORIGIN || new URL(env.APP_ORIGIN).origin !== url.origin) return Response.json({error:'APP_ORIGIN должен совпадать с адресом сайта.'},{status:503});
      const forwarded = new Request(request);
      // Trust only the Cloudflare edge value, never a caller-supplied forwarded IP.
      forwarded.headers.set('x-hellar-client-ip', request.headers.get('CF-Connecting-IP') || 'local');
      const object = env.HELLAR.get(env.HELLAR.idFromName('hellar-main-v1'));
      return object.fetch(forwarded);
    }
    const response = await env.ASSETS.fetch(request);
    const result = new Response(response.body,response);
    result.headers.set('X-Content-Type-Options','nosniff');
    result.headers.set('X-Frame-Options','DENY');
    result.headers.set('Referrer-Policy','no-referrer');
    result.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    return result;
  },
};
