import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type Services, type UserRow, publicUser } from './types.js';
import { verifyPassword, hashPassword, HttpError, rate } from './security.js';
import { type FileStorage, safeImage, enqueueDelete, collectFiles } from './storage.js';
export async function profileRoutes(app: FastifyInstance, s: Services, storage: FileStorage) {
  const { db } = s;
  app.patch('/api/profile', async (r) => {
    const u = s.requireUser(r);
    const b = z
      .object({
        name: z.string().trim().min(2).max(60),
        settings: z.object({
          motion: z.boolean(),
          style: z.enum(['comfortable', 'compact']).default('comfortable'),
        }),
      })
      .parse(r.body);
    db.run(
      'UPDATE users SET name=?,settings=? WHERE id=?',
      b.name,
      JSON.stringify(b.settings),
      u.id,
    );
    return { user: publicUser(db.get<UserRow>('SELECT * FROM users WHERE id=?', u.id)!) };
  });
  app.get('/api/profile/avatar', async (r, p) => {
    const u = s.requireUser(r);
    if (!u.avatar_key) throw new HttpError(404, 'Аватар не загружен.');
    return p.type('image/webp').send(await storage.read(u.avatar_key));
  });
  app.post('/api/profile/avatar', async (r) => {
    const u = s.requireUser(r);
    rate(db, 'avatar:' + u.id, 10, 3600000);
    const file = await r.file();
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype))
      throw new HttpError(400, 'Выбери PNG, JPEG или WebP до 2 МБ.');
    const data = await file.toBuffer();
    const cleaned = await safeImage(data, true);
    const key = await storage.put(cleaned, 'webp');
    try {
      db.tx(() => {
        const now = db.get<UserRow>('SELECT * FROM users WHERE id=?', u.id);
        if (!now) throw new HttpError(401, 'Сессия завершена.');
        enqueueDelete(db, now.avatar_key);
        db.run('UPDATE users SET avatar_key=? WHERE id=?', key, u.id);
      });
    } catch (e) {
      await storage.delete(key);
      throw e;
    }
    await collectFiles(db, storage);
    return { ok: true };
  });
  app.delete('/api/profile/avatar', async (r) => {
    const u = s.requireUser(r);
    db.tx(() => {
      enqueueDelete(db, u.avatar_key);
      db.run('UPDATE users SET avatar_key=NULL WHERE id=?', u.id);
    });
    await collectFiles(db, storage);
    return { ok: true };
  });
  app.post('/api/profile/password', async (r, p) => {
    const u = s.requireUser(r);
    rate(db, 'password:' + u.id, 5, 3600000);
    const b = z
      .object({
        currentPassword: z.string().max(128),
        password: z.string().min(12).max(128),
        confirmPassword: z.string(),
      })
      .refine((b) => b.password === b.confirmPassword, { message: 'Пароли не совпадают.' })
      .parse(r.body);
    if (!(await verifyPassword(b.currentPassword, u.password_hash)))
      throw new HttpError(400, 'Текущий пароль неверен.');
    const next = await hashPassword(b.password);
    s.abortUser(u.id);
    db.tx(() => {
      if (
        !db.run(
          'UPDATE users SET password_hash=? WHERE id=? AND password_hash=?',
          next,
          u.id,
          u.password_hash,
        ).changes
      )
        throw new HttpError(409, 'Пароль уже изменён. Войди снова.');
      db.run('DELETE FROM sessions WHERE user_id=?', u.id);
      db.run('DELETE FROM password_resets WHERE user_id=?', u.id);
    });
    return { ok: true, ...s.startSession(r, p, u) };
  });
  app.get('/api/profile/sessions', async (r) => {
    const u = s.requireUser(r);
    return {
      sessions: db
        .all(
          'SELECT id,created_at,expires_at,user_agent FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC',
          u.id,
          Date.now(),
        )
        .map((x) => ({ ...x, current: x.id === r.session!.id })),
    };
  });
  app.delete('/api/profile/sessions/:id', async (r, p) => {
    const u = s.requireUser(r);
    const sid = z.object({ id: z.string().uuid() }).parse(r.params).id;
    db.run('DELETE FROM sessions WHERE id=? AND user_id=?', sid, u.id);
    if (sid === r.session!.id) s.clearSession(p);
    return { ok: true };
  });
  app.post('/api/profile/sessions/revoke-others', async (r) => {
    const u = s.requireUser(r);
    db.run('DELETE FROM sessions WHERE user_id=? AND id<>?', u.id, r.session!.id);
    return { ok: true };
  });
  app.get('/api/profile/usage', async (r) => {
    const u = s.requireUser(r);
    const day = new Date().toISOString().slice(0, 10);
    return {
      day,
      usage: db.all('SELECT kind,count FROM usage WHERE user_id=? AND day=?', u.id, day),
      chats: db.get('SELECT COUNT(*) n FROM chats WHERE user_id=?', u.id).n,
      images: db.get(
        "SELECT COUNT(*) n FROM image_jobs WHERE user_id=? AND status='complete'",
        u.id,
      ).n,
    };
  });
  app.delete('/api/profile', async (r, p) => {
    const u = s.requireUser(r);
    rate(db, 'delete-account:' + u.id, 5, 3600000);
    const b = z
      .object({ password: z.string().max(128), confirmation: z.literal('УДАЛИТЬ') })
      .parse(r.body);
    if (!(await verifyPassword(b.password, u.password_hash)))
      throw new HttpError(400, 'Неверный пароль.');
    if (u.role === 'admin')
      throw new HttpError(
        400,
        'Аккаунт администратора удаляется оператором на сервере после передачи управления.',
      );
    if (db.get("SELECT id FROM payment_orders WHERE user_id=? AND status='pending' LIMIT 1", u.id) ||
        db.get("SELECT id FROM billing_holds WHERE user_id=? AND state IN ('reserved','review') LIMIT 1", u.id) ||
        db.get('SELECT user_id FROM wallets WHERE user_id=? AND balance>0', u.id) ||
        db.get('SELECT id FROM subscriptions WHERE user_id=? AND expires_at>?', u.id, Date.now()))
      throw new HttpError(409, 'Перед удалением аккаунта обратись к владельцу для закрытия платежей и остатка баланса.');
    s.abortUser(u.id);
    db.tx(() => {
      enqueueDelete(db, u.avatar_key);
      for (const x of db.all('SELECT file_key FROM image_jobs WHERE user_id=?', u.id))
        enqueueDelete(db, x.file_key);
      db.run('DELETE FROM users WHERE id=?', u.id);
      db.run('DELETE FROM usage WHERE user_id=?', u.id);
      db.run('DELETE FROM audit WHERE actor_id=? OR target_id=?', u.id, u.id);
    });
    s.clearSession(p);
    await collectFiles(db, storage);
    return { ok: true };
  });
}
