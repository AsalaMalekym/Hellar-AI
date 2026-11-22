import { reserve, settle, imageReserve, type TokenUsage } from './billing.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import sharp from 'sharp';
import type { Services } from './types.js';
import { id, HttpError, rate, quota } from './security.js';
import { type AIProvider, providerError } from './provider.js';
import { Generations } from './generation.js';
import { type FileStorage, safeImage, enqueueDelete, collectFiles } from './storage.js';
export async function imageRoutes(
  app: FastifyInstance,
  s: Services,
  ai: AIProvider,
  jobs: Generations,
  storage: FileStorage,
) {
  const { db, c } = s;
  const publicJob = (row: any) => ({
    id: row.id,
    prompt: row.prompt,
    model: row.model,
    size: row.size,
    status: row.status,
    error: row.error,
    width: row.width,
    height: row.height,
    created_at: row.created_at,
  });
  function own(r: any) {
    const u = s.requireUser(r),
      key = z.object({ id: z.string().uuid() }).parse(r.params).id;
    const job = db.get('SELECT * FROM image_jobs WHERE id=? AND user_id=?', key, u.id);
    if (!job) throw new HttpError(404, 'Изображение не найдено.');
    return job;
  }
  app.get('/api/images', async (r) => {
    const u = s.requireUser(r);
    const b = z
      .object({ offset: z.coerce.number().int().min(0).max(100000).default(0) })
      .parse(r.query);
    const rows = db.all(
      'SELECT * FROM image_jobs WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 51 OFFSET ?',
      u.id,
      b.offset,
    );
    return { images: rows.slice(0, 50).map(publicJob), more: rows.length > 50 };
  });
  app.get('/api/images/:id/file', async (r, p) => {
    const job = own(r);
    if (job.status !== 'complete' || !job.file_key) throw new HttpError(404, 'Файл ещё не готов.');
    const download = z.object({ download: z.string().optional() }).parse(r.query).download === '1';
    p.header(
      'Content-Disposition',
      (download ? 'attachment' : 'inline') + '; filename="hellar-' + job.id + '.png"',
    );
    p.header('Cross-Origin-Resource-Policy', 'same-origin');
    return p.type('image/png').send(await storage.read(job.file_key));
  });
  app.delete('/api/images/:id', async (r) => {
    const job = own(r);
    jobs.stop(r.user!.id, job.id);
    db.tx(() => {
      enqueueDelete(db, job.file_key);
      db.run('DELETE FROM image_jobs WHERE id=? AND user_id=?', job.id, r.user!.id);
    });
    await collectFiles(db, storage);
    return { ok: true };
  });
  app.post('/api/images', async (r, p) => {
    const u = s.requireUser(r);
    const b = z
      .object({
        prompt: z.string().trim().min(3).max(4000),
        size: z
          .string()
          .refine(
            (x) => c.imageSizes.includes(x),
            'Формат не поддерживается выбранной моделью. Выбери доступный размер.',
          ),
      })
      .parse(r.body);
    if (!ai.ready)
      throw new HttpError(
        503,
        'Генерация изображений ещё не подключена. Владелец должен настроить API-ключ.',
        'AI_NOT_CONFIGURED',
      );
    rate(db, 'image:' + u.id, 5, 60000);
    const key = id(),
      job = jobs.start(u.id, 'image', key, c.imageTimeout);
    let stored: string | null = null;
    let hold: string | null = null,
      usage: TokenUsage | null = null,
      providerStarted = false,
      noCharge = false;
    try {
      if (c.billing.enabled)
        hold = reserve(s, u.id, 'image', c.imageModel, imageReserve(s, b.prompt));
      quota(db, u.id, 'image', c.imageLimit, c.globalImageLimit);
      db.run(
        'INSERT INTO image_jobs(id,user_id,prompt,model,size,status,created_at) VALUES(?,?,?,?,?,?,?)',
        key,
        u.id,
        b.prompt,
        c.imageModel,
        b.size,
        'pending',
        Date.now(),
      );
      try {
        providerStarted = true;
        const bytes = await ai.image(
          b.prompt,
          b.size,
          job.signal,
          (value) => {
            usage = value;
          },
          (requestId) => {
            if (hold)
              db.run('UPDATE billing_holds SET provider_request_id=? WHERE id=?', requestId, hold);
          },
        );
        job.signal.throwIfAborted();
        const clean = await safeImage(bytes);
        const meta = await sharp(clean).metadata();
        const [w, h] = b.size.split('x').map(Number);
        if (meta.width !== w || meta.height !== h)
          throw new HttpError(
            502,
            'Провайдер вернул другой размер изображения. Результат не сохранён.',
          );
        if (
          !db.get('SELECT id FROM sessions WHERE id=? AND expires_at>?', r.session!.id, Date.now())
        )
          throw new HttpError(401, 'Сессия завершена.');
        stored = await storage.put(clean, 'png');
        job.signal.throwIfAborted();
        const changed = db.run(
          "UPDATE image_jobs SET status='complete',file_key=?,width=?,height=? WHERE id=? AND user_id=?",
          stored,
          meta.width!,
          meta.height!,
          key,
          u.id,
        );
        if (!changed.changes) {
          await storage.delete(stored);
          stored = null;
          throw new HttpError(409, 'Запрос уже удалён.');
        }
        const result = db.get('SELECT * FROM image_jobs WHERE id=?', key);
        settle(s, hold, usage);
        return { image: publicJob(result) };
      } catch (e) {
        noCharge =
          !(e instanceof HttpError) && [400, 401, 403, 404, 422, 429].includes((e as any)?.status);
        if (stored) {
          enqueueDelete(db, stored);
          await collectFiles(db, storage);
        }
        const message = providerError(e, job.signal);
        db.run(
          'UPDATE image_jobs SET status=?,error=?,file_key=NULL WHERE id=?',
          job.signal.aborted ? 'interrupted' : 'error',
          message,
          key,
        );
        r.log.warn(
          { event: 'image_generation_failed', type: (e as Error)?.name },
          'Image generation failed',
        );
        return p.code(502).send({ error: message, id: key });
      }
    } finally {
      try {
        settle(s, hold, usage, !providerStarted || noCharge);
      } finally {
        job.release();
      }
    }
  });
}
