import { reserve, settle, chatReserve, type TokenUsage } from './billing.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { once } from 'node:events';
import type { Services } from './types.js';
import { id, HttpError, rate, quota } from './security.js';
import { type AIProvider, type TextMessage, providerError } from './provider.js';
import { Generations } from './generation.js';
export function contextWindow(messages: TextMessage[], system: string, limit: number) {
  const result: TextMessage[] = [];
  let remaining = Math.max(0, limit - system.length);
  for (const m of [...messages].reverse()) {
    if (m.content.length > remaining) break;
    result.unshift(m);
    remaining -= m.content.length;
    if (result.length >= 40) break;
  }
  if (!result.length) throw new HttpError(400, 'Сообщение превышает доступный размер контекста.');
  while (result[0]?.role === 'assistant') result.shift();
  return [
    {
      role: 'system' as const,
      content: system || 'Ты Hellar AI. Отвечай понятно, точно и на языке пользователя.',
    },
    ...result,
  ];
}
export async function chatRoutes(
  app: FastifyInstance,
  s: Services,
  ai: AIProvider,
  jobs: Generations,
) {
  const { db, c } = s;
  const cid = (r: any) => z.object({ id: z.string().uuid() }).parse(r.params).id;
  function own(r: any) {
    const u = s.requireUser(r),
      chat = db.get('SELECT * FROM chats WHERE id=? AND user_id=?', cid(r), u.id);
    if (!chat) throw new HttpError(404, 'Диалог не найден.');
    return chat;
  }
  const model = z.string().refine((x) => c.chatModels.includes(x), 'Эта модель не разрешена.');
  app.get('/api/chats', async (r) => {
    const u = s.requireUser(r);
    const b = z.object({ q: z.string().max(100).optional() }).parse(r.query);
    return {
      chats: db.all(
        'SELECT id,title,model,system_prompt,created_at,updated_at FROM chats WHERE user_id=? AND instr(lower(title),lower(?))>0 ORDER BY updated_at DESC LIMIT 200',
        u.id,
        b.q || '',
      ),
    };
  });
  app.post('/api/chats', async (r) => {
    const u = s.requireUser(r);
    rate(db, 'chat-create:' + u.id, 30, 3600000);
    const b = z
      .object({
        model: model.default(c.chatModels[0]),
        title: z.string().trim().min(1).max(100).default('Новый диалог'),
        system_prompt: z.string().max(4000).default(''),
      })
      .parse(r.body);
    if (db.get('SELECT COUNT(*) n FROM chats WHERE user_id=?', u.id).n >= 1000)
      throw new HttpError(429, 'Максимум 1000 диалогов. Удали ненужные.');
    const key = id();
    db.run(
      'INSERT INTO chats VALUES(?,?,?,?,?,?,?)',
      key,
      u.id,
      b.title,
      b.model,
      b.system_prompt,
      Date.now(),
      Date.now(),
    );
    return { chat: db.get('SELECT * FROM chats WHERE id=?', key) };
  });
  app.get('/api/chats/:id', async (r) => {
    const chat = own(r);
    return {
      chat,
      messages: db.all(
        'SELECT id,role,content,status,created_at FROM messages WHERE chat_id=? ORDER BY created_at,rowid',
        chat.id,
      ),
    };
  });
  app.patch('/api/chats/:id', async (r) => {
    const chat = own(r);
    const b = z
      .object({
        title: z.string().trim().min(1).max(100).optional(),
        model: model.optional(),
        system_prompt: z.string().max(4000).optional(),
      })
      .parse(r.body);
    if (jobs.has(r.user!.id, 'chat')) throw new HttpError(409, 'Дождись завершения ответа.');
    db.run(
      'UPDATE chats SET title=?,model=?,system_prompt=?,updated_at=? WHERE id=?',
      b.title ?? chat.title,
      b.model ?? chat.model,
      b.system_prompt ?? chat.system_prompt,
      Date.now(),
      chat.id,
    );
    return { ok: true };
  });
  app.delete('/api/chats/:id', async (r) => {
    const chat = own(r);
    jobs.stop(r.user!.id, chat.id);
    db.run('DELETE FROM chats WHERE id=? AND user_id=?', chat.id, r.user!.id);
    return { ok: true };
  });
  app.post('/api/chats/:id/stop', async (r) => {
    const chat = own(r);
    jobs.stop(r.user!.id, chat.id);
    return { ok: true };
  });
  app.post('/api/chats/:id/generate', async (r, p) => {
    const chat = own(r),
      u = r.user!;
    const b = z
      .object({
        content: z.string().trim().min(1).max(12000).optional(),
        regenerate: z.boolean().default(false),
      })
      .refine((x) => x.regenerate || !!x.content, { message: 'Напиши сообщение.' })
      .parse(r.body);
    if (!ai.ready)
      throw new HttpError(
        503,
        'ИИ ещё не подключён. Владелец должен настроить API-ключ.',
        'AI_NOT_CONFIGURED',
      );
    if (!c.chatModels.includes(chat.model))
      throw new HttpError(400, 'Модель больше недоступна. Выбери другую в настройках диалога.');
    rate(db, 'chat:' + u.id, 12, 60000);
    const job = jobs.start(u.id, 'chat', chat.id, c.aiTimeout);
    let hold: string | null = null,
      usage: TokenUsage | null = null,
      providerStarted = false,
      noCharge = false;
    let mid = '',
      output = '',
      status = 'streaming';
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const onClose = () => job.controller.abort();
    try {
      let history = db.all(
        'SELECT * FROM messages WHERE chat_id=? ORDER BY created_at,rowid',
        chat.id,
      );
      if (history.length >= 500) throw new HttpError(400, 'Диалог достиг лимита. Создай новый.');
      let previous: any = null;
      if (b.regenerate) {
        if (!history.length) throw new HttpError(400, 'Нет сообщения для повторной генерации.');
        if (history.at(-1).role === 'assistant') previous = history.pop();
        if (history.at(-1)?.role !== 'user')
          throw new HttpError(400, 'Не найден запрос пользователя.');
      } else history.push({ role: 'user', content: b.content });
      const context = contextWindow(
        history.filter((x) => x.content).map(({ role, content }) => ({ role, content })),
        chat.system_prompt,
        c.contextChars,
      );
      if (c.billing.enabled)
        hold = reserve(s, u.id, 'chat', chat.model, chatReserve(s, chat.model, context));
      quota(db, u.id, 'chat', c.chatLimit, c.globalChatLimit);
      mid = id();
      db.tx(() => {
        if (previous) db.run('DELETE FROM messages WHERE id=?', previous.id);
        if (!b.regenerate)
          db.run(
            'INSERT INTO messages VALUES(?,?,?,?,?,?)',
            id(),
            chat.id,
            'user',
            b.content!,
            'complete',
            Date.now(),
          );
        db.run(
          'INSERT INTO messages VALUES(?,?,?,?,?,?)',
          mid,
          chat.id,
          'assistant',
          '',
          'streaming',
          Date.now(),
        );
        db.run(
          'UPDATE chats SET updated_at=?,title=? WHERE id=?',
          Date.now(),
          chat.title === 'Новый диалог' && !b.regenerate ? b.content!.slice(0, 65) : chat.title,
          chat.id,
        );
      });
      p.hijack();
      for (const [k, v] of Object.entries(p.getHeaders()))
        if (v !== undefined) p.raw.setHeader(k, v);
      p.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      });
      p.raw.on('close', onClose);
      const send = (event: string, data: unknown) => {
        if (!p.raw.destroyed)
          p.raw.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
      };
      send('start', { id: mid });
      heartbeat = setInterval(() => {
        if (!p.raw.destroyed) p.raw.write(': heartbeat\n\n');
      }, 15000);
      let saved = 0;
      try {
        providerStarted = true;
        for await (const text of ai.stream(
          chat.model,
          context,
          job.signal,
          (value) => {
            usage = value;
          },
          (requestId) => {
            if (hold)
              db.run('UPDATE billing_holds SET provider_request_id=? WHERE id=?', requestId, hold);
          },
        )) {
          job.signal.throwIfAborted();
          if (
            !db.get(
              'SELECT id FROM sessions WHERE id=? AND expires_at>?',
              r.session!.id,
              Date.now(),
            )
          ) {
            job.controller.abort();
            job.signal.throwIfAborted();
          }
          output += text;
          if (output.length > 100000) throw new HttpError(502, 'Ответ превысил допустимый размер.');
          send('delta', { text });
          if (p.raw.writableNeedDrain) await once(p.raw, 'drain', { signal: job.signal });
          if (Date.now() - saved > 800) {
            db.run('UPDATE messages SET content=? WHERE id=?', output, mid);
            saved = Date.now();
          }
        }
        if (!output) throw new HttpError(502, 'Модель вернула пустой ответ.');
        settle(s, hold, usage);
        status = 'complete';
        send('done', { status });
      } catch (e) {
        noCharge =
          !output &&
          !(e instanceof HttpError) &&
          [400, 401, 403, 404, 422, 429].includes((e as any)?.status);
        status = job.signal.aborted ? 'interrupted' : 'error';
        send('error', { message: providerError(e, job.signal), status });
        r.log.warn(
          { event: 'chat_generation_failed', type: (e as Error)?.name },
          'Chat generation failed',
        );
      } finally {
        db.run('UPDATE messages SET content=?,status=? WHERE id=?', output, status, mid);
        p.raw.end();
      }
    } catch (e) {
      if (!p.sent) throw e;
      throw e;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      p.raw.off('close', onClose);
      try {
        settle(s, hold, usage, !providerStarted || noCharge);
      } finally {
        job.release();
      }
    }
  });
}
