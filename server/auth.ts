import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services, UserRow } from './types.js';
import { publicUser } from './types.js';
import {
  id,
  token,
  digest,
  hashPassword,
  verifyPassword,
  rate,
  audit,
  HttpError,
} from './security.js';
import type { Mailer } from './mail-api.js';
import type { Captcha } from './captcha.js';
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const password = z.string().min(12, 'Пароль должен содержать минимум 12 символов').max(128);
const register = z.object({
  email,
  name: z.string().trim().min(2).max(60),
  invitation: z.string().trim().min(20).max(150),
  captchaToken: z.string().max(2048).optional(),
});
export async function authRoutes(
  app: FastifyInstance,
  s: Services,
  mailer: Mailer,
  captcha: Captcha,
) {
  const { db, c } = s;
  app.get('/api/auth/me', async (r, p) => {
    if (!r.user) {
      const csrf = token();
      p.setCookie(c.secure ? '__Host-hellar-pre' : 'hellar-pre', csrf, {
        httpOnly: true,
        secure: c.secure,
        sameSite: 'strict',
        path: '/',
        maxAge: 3600,
      });
      return { user: null, csrf };
    }
    return { user: captcha.passed(r) ? publicUser(r.user) : null, csrf: r.session!.csrf };
  });
  app.post('/api/auth/register', async (r) => {
    rate(db, 'register:' + r.ip, 5, 3600000);
    const b = register.parse(r.body);
    await captcha.verify(b.captchaToken, 'register', r);
    if (!mailer.ready)
      throw new HttpError(
        503,
        'Почта ещё не подключена. Регистрация временно недоступна.',
        'MAIL_NOT_CONFIGURED',
      );
    rate(db, 'verify-email:' + b.email, 3, 3600000);
    const invHash = digest(b.invitation);
    const inv = db.get('SELECT * FROM invitations WHERE token_hash=?', invHash);
    if (!inv || inv.used_at || inv.revoked || inv.expires_at <= Date.now())
      throw new HttpError(400, 'Приглашение недействительно, отозвано или уже использовано.');
    if (db.get('SELECT id FROM users WHERE email=?', b.email))
      throw new HttpError(409, 'Регистрация с такими данными недоступна. Попробуй войти.');
    const raw = token(),
      hash = digest(raw);
    db.run('DELETE FROM pending_registrations WHERE expires_at<?', Date.now());
    db.run(
      'INSERT INTO pending_registrations VALUES(?,?,?,?,?)',
      hash,
      b.email,
      b.name,
      invHash,
      Date.now() + 1800000,
    );
    try {
      await mailer.sendVerification(b.email, c.origin + '/verify-email#' + raw);
    } catch {
      db.run('DELETE FROM pending_registrations WHERE token_hash=?', hash);
      throw new HttpError(
        503,
        'Не удалось отправить письмо. Попробуй ещё раз позже.',
        'MAIL_DELIVERY_FAILED',
      );
    }
    return {
      message:
        'Письмо отправлено. Открой ссылку в течение 30 минут и задай пароль. Если письма нет, проверь «Спам» или повтори регистрацию.',
    };
  });
  app.post('/api/auth/verify-email', async (r, p) => {
    rate(db, 'verify:' + r.ip, 10, 3600000);
    const b = z
      .object({ token: z.string().min(20).max(150), password, confirmPassword: z.string() })
      .refine((x) => x.password === x.confirmPassword, { message: 'Пароли не совпадают' })
      .parse(r.body);
    const hash = digest(b.token);
    function pending() {
      const row = db.get(
        'SELECT * FROM pending_registrations WHERE token_hash=? AND expires_at>?',
        hash,
        Date.now(),
      );
      if (!row)
        throw new HttpError(400, 'Ссылка недействительна или истекла. Повтори регистрацию.');
      return row;
    }
    pending();
    const hashed = await hashPassword(b.password),
      uid = id();
    db.tx(() => {
      const row = pending();
      if (db.get('SELECT id FROM users WHERE email=?', row.email))
        throw new HttpError(409, 'Аккаунт уже существует. Войди или восстанови пароль.');
      const changed = db.run(
        'UPDATE invitations SET used_at=? WHERE token_hash=? AND used_at IS NULL AND revoked=0 AND expires_at>?',
        Date.now(),
        row.invitation_hash,
        Date.now(),
      );
      if (changed.changes !== 1)
        throw new HttpError(400, 'Приглашение недействительно или уже использовано.');
      db.run(
        'INSERT INTO users(id,email,name,password_hash,created_at,email_verified_at) VALUES(?,?,?,?,?,?)',
        uid,
        row.email,
        row.name,
        hashed,
        Date.now(),
        Date.now(),
      );
      db.run('UPDATE invitations SET used_by=? WHERE token_hash=?', uid, row.invitation_hash);
      db.run('DELETE FROM pending_registrations WHERE email=?', row.email);
    });
    const user = db.get<UserRow>('SELECT * FROM users WHERE id=?', uid)!;
    audit(db, uid, 'register.verified', uid);
    return { user: publicUser(user), ...s.startSession(r, p, user) };
  });
  app.post('/api/auth/login', async (r, p) => {
    const b = z.object({ email, password: z.string().min(1).max(128) }).parse(r.body);
    rate(db, 'login-ip:' + r.ip, 20, 900000);
    rate(db, 'login-email:' + b.email, 8, 900000);
    const u = db.get<UserRow>('SELECT * FROM users WHERE email=?', b.email);
    const valid = await verifyPassword(
      b.password,
      u?.password_hash || `pbkdf2$600000$${'0'.repeat(32)}$${'0'.repeat(64)}`,
    );
    if (!u || !valid || u.blocked)
      throw new HttpError(401, 'Неверная почта или пароль, либо доступ ограничен.');
    return { user: publicUser(u), ...s.startSession(r, p, u) };
  });
  app.post('/api/auth/logout', async (r, p) => {
    if (r.user) s.abortUser(r.user.id);
    if (r.session) db.run('DELETE FROM sessions WHERE id=?', r.session.id);
    s.clearSession(p);
    return { ok: true };
  });
  app.post('/api/auth/forgot', async (r) => {
    rate(db, 'forgot-ip:' + r.ip, 5, 3600000);
    const b = z.object({ email, captchaToken: z.string().max(2048).optional() }).parse(r.body);
    await captcha.verify(b.captchaToken, 'forgot', r);
    rate(db, 'forgot-email:' + b.email, 3, 3600000);
    if (!mailer.ready)
      throw new HttpError(
        503,
        'Отправка почты ещё не настроена. Обратись к владельцу сервиса.',
        'MAIL_NOT_CONFIGURED',
      );
    const u = db.get<UserRow>('SELECT * FROM users WHERE email=? AND blocked=0', b.email);
    if (u) {
      const raw = token(),
        rid = id();
      db.run(
        'INSERT INTO password_resets(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)',
        rid,
        u.id,
        digest(raw),
        Date.now() + 1800000,
      );
      try {
        await mailer.sendReset(u.email, c.origin + '/reset#' + raw);
      } catch {
        db.run('DELETE FROM password_resets WHERE id=?', rid);
        r.log.warn({ event: 'mail_delivery_failed' }, 'Mail provider failed');
      }
    }
    return { message: 'Если аккаунт существует, письмо с инструкциями будет отправлено.' };
  });
  app.post('/api/auth/reset', async (r, p) => {
    rate(db, 'reset:' + r.ip, 10, 3600000);
    const b = z
      .object({ token: z.string().min(20).max(150), password, confirmPassword: z.string() })
      .refine((x) => x.password === x.confirmPassword, { message: 'Пароли не совпадают' })
      .parse(r.body);
    const hash = digest(b.token);
    const found = db.get(
      'SELECT * FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at>?',
      hash,
      Date.now(),
    );
    if (!found) throw new HttpError(400, 'Ссылка недействительна или срок действия истёк.');
    const hashed = await hashPassword(b.password);
    db.tx(() => {
      const row = db.get(
        'SELECT * FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at>?',
        hash,
        Date.now(),
      );
      if (!row) throw new HttpError(400, 'Ссылка уже использована.');
      s.abortUser(row.user_id);
      db.run(
        'UPDATE users SET password_hash=?,email_verified_at=COALESCE(email_verified_at,?) WHERE id=?',
        hashed,
        Date.now(),
        row.user_id,
      );
      db.run('UPDATE password_resets SET used_at=? WHERE user_id=?', Date.now(), row.user_id);
      db.run('DELETE FROM sessions WHERE user_id=?', row.user_id);
    });
    s.clearSession(p);
    return { ok: true };
  });
  app.get('/api/admin/users', async (r) => {
    s.requireAdmin(r);
    return {
      users: db.all(
        'SELECT id,email,name,role,blocked,created_at FROM users ORDER BY created_at DESC LIMIT 500',
      ),
    };
  });
  app.get('/api/admin/invitations', async (r) => {
    s.requireAdmin(r);
    return {
      invitations: db.all(
        'SELECT i.id,i.label,i.created_at,i.expires_at,i.used_at,i.revoked,u.email AS used_email FROM invitations i LEFT JOIN users u ON u.id=i.used_by ORDER BY i.created_at DESC LIMIT 500',
      ),
    };
  });
  app.post('/api/admin/invitations', async (r) => {
    const u = s.requireAdmin(r);
    rate(db, 'invite:' + u.id, 30, 3600000);
    const b = z
      .object({
        label: z.string().trim().max(80).default('Приглашение'),
        days: z.number().int().min(1).max(30).default(7),
      })
      .parse(r.body);
    const raw = token(),
      iid = id();
    db.run(
      'INSERT INTO invitations(id,token_hash,label,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?)',
      iid,
      digest(raw),
      b.label,
      u.id,
      Date.now(),
      Date.now() + b.days * 86400000,
    );
    audit(db, u.id, 'invite.create', iid);
    return { id: iid, code: raw };
  });
  app.delete('/api/admin/invitations/:id', async (r) => {
    const u = s.requireAdmin(r);
    const iid = z.object({ id: z.string().uuid() }).parse(r.params).id;
    db.run('UPDATE invitations SET revoked=1 WHERE id=? AND used_at IS NULL', iid);
    audit(db, u.id, 'invite.revoke', iid);
    return { ok: true };
  });
  app.patch('/api/admin/users/:id', async (r) => {
    const u = s.requireAdmin(r);
    const uid = z.object({ id: z.string().uuid() }).parse(r.params).id;
    const b = z.object({ blocked: z.boolean() }).parse(r.body);
    if (uid === u.id) throw new HttpError(400, 'Нельзя заблокировать свой аккаунт.');
    const target = db.get<UserRow>('SELECT * FROM users WHERE id=?', uid);
    if (!target) throw new HttpError(404, 'Пользователь не найден.');
    if (target.role === 'admin')
      throw new HttpError(400, 'Изменение доступа администратора выполняется на сервере.');
    db.tx(() => {
      db.run('UPDATE users SET blocked=? WHERE id=?', b.blocked ? 1 : 0, uid);
      if (b.blocked) {
        s.abortUser(uid);
        db.run('DELETE FROM sessions WHERE user_id=?', uid);
      }
    });
    audit(db, u.id, b.blocked ? 'user.block' : 'user.unblock', uid);
    return { ok: true };
  });
}
