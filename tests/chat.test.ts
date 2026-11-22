import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import type { AIProvider, TextMessage } from '../server/provider.js';
import { contextWindow } from '../server/chat.js';
import { readEvents } from '../src/stream.js';
const mock: AIProvider = {
  ready: true,
  async *stream() {
    yield 'Привет, ';
    yield '**мир**!';
  },
  async image() {
    throw Error('not used');
  },
};
test('SSE, history, context, regenerate, rename, owner isolation and quota', async () => {
  let context: TextMessage[] = [];
  const f = await fixture(
    { chatLimit: 2 },
    {
      ai: {
        ...mock,
        async *stream(_model, messages) {
          context = messages;
          yield* mock.stream(_model, messages, new AbortController().signal);
        },
      },
    },
  );
  try {
    const a = f.client(),
      b = f.client();
    await a.register();
    await b.register('other@example.com');
    const c = (await a.request('POST', '/chats', { system_prompt: 'Отвечай кратко.' })).json().chat;
    assert.equal((await b.request('GET', '/chats/' + c.id)).statusCode, 404);
    assert.equal((await b.request('DELETE', '/chats/' + c.id)).statusCode, 404);
    assert.equal(
      (await b.request('POST', '/chats/' + c.id + '/generate', { content: 'x' })).statusCode,
      404,
    );
    const result = await a.request('POST', '/chats/' + c.id + '/generate', { content: 'Привет' });
    assert.equal(result.statusCode, 200);
    assert.match(result.headers['content-type']!, /text\/event-stream/);
    assert.match(result.body, /event: delta/);
    assert.match(result.body, /event: done/);
    assert.equal(context[0].content, 'Отвечай кратко.');
    let history = (await a.request('GET', '/chats/' + c.id)).json().messages;
    assert.equal(history.length, 2);
    assert.equal(history[1].content, 'Привет, **мир**!');
    assert.equal(history[1].status, 'complete');
    assert.equal(
      (await a.request('POST', '/chats/' + c.id + '/generate', { regenerate: true })).statusCode,
      200,
    );
    assert.equal((await a.request('GET', '/chats/' + c.id)).json().messages.length, 2);
    assert.equal(
      (await a.request('POST', '/chats/' + c.id + '/generate', { content: 'again' })).statusCode,
      429,
    );
    assert.equal(
      (await a.request('PATCH', '/chats/' + c.id, { title: 'Новое название' })).statusCode,
      200,
    );
    assert.equal((await a.request('GET', '/chats?q=Новое')).json().chats.length, 1);
    await a.request('DELETE', '/chats/' + c.id);
    assert.equal(f.db.get('SELECT COUNT(*) n FROM messages WHERE chat_id=?', c.id).n, 0);
  } finally {
    await f.close();
  }
});
test('missing key is explicit; upstream failures sanitized and partial output saved', async () => {
  const f = await fixture({ key: '' });
  try {
    const a = f.client();
    await a.register();
    const c = (await a.request('POST', '/chats', {})).json().chat;
    const r = await a.request('POST', '/chats/' + c.id + '/generate', { content: 'hello' });
    assert.equal(r.statusCode, 503);
    assert.equal(r.json().code, 'AI_NOT_CONFIGURED');
    assert.equal((await a.request('GET', '/chats/' + c.id)).json().messages.length, 0);
  } finally {
    await f.close();
  }
  const x = await fixture(
    {},
    {
      ai: {
        ...mock,
        async *stream() {
          yield 'Часть';
          throw Error('secret-key-private-error');
        },
      },
    },
  );
  try {
    const a = x.client();
    await a.register();
    const c = (await a.request('POST', '/chats', {})).json().chat;
    const r = await a.request('POST', '/chats/' + c.id + '/generate', { content: 'hello' });
    assert.match(r.body, /event: error/);
    assert.doesNotMatch(r.body, /secret-key/);
    const m = (await a.request('GET', '/chats/' + c.id)).json().messages.at(-1);
    assert.equal(m.content, 'Часть');
    assert.equal(m.status, 'error');
  } finally {
    await x.close();
  }
});
test('cancel interrupts provider and saves status; concurrent requests rejected', async () => {
  let started!: () => void;
  const begin = new Promise<void>((r) => (started = r));
  const f = await fixture(
    {},
    {
      ai: {
        ...mock,
        async *stream(_m, _c, signal) {
          yield 'Начало';
          started();
          await new Promise<void>((resolve, reject) => {
            if (signal.aborted) reject(signal.reason);
            else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
      },
    },
  );
  try {
    const a = f.client();
    await a.register();
    const c = (await a.request('POST', '/chats', {})).json().chat;
    const generation = a.request('POST', '/chats/' + c.id + '/generate', { content: 'hello' });
    await begin;
    assert.equal(
      (await a.request('POST', '/chats/' + c.id + '/generate', { content: 'second' })).statusCode,
      409,
    );
    assert.equal((await a.request('POST', '/chats/' + c.id + '/stop')).statusCode, 200);
    const r = await generation;
    assert.match(r.body, /interrupted/);
    assert.equal(
      (await a.request('GET', '/chats/' + c.id)).json().messages.at(-1).status,
      'interrupted',
    );
  } finally {
    await f.close();
  }
});
test('context budget and SSE split UTF-8 chunks', async () => {
  const c = contextWindow(
    [
      { role: 'user', content: 'old'.repeat(20) },
      { role: 'assistant', content: 'large'.repeat(20) },
      { role: 'user', content: 'new' },
    ],
    'system',
    20,
  );
  assert.equal(c.length, 2);
  assert.equal(c[1].content, 'new');
  const raw = new TextEncoder().encode(
    'event: delta\ndata: {"text":"Привет"}\n\nevent: done\ndata: {}\n\n',
  );
  const output: any[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < raw.length; i += 3) controller.enqueue(raw.slice(i, i + 3));
      controller.close();
    },
  });
  await readEvents(stream, (e) => output.push(e));
  assert.equal(output[0].data.text, 'Привет');
  assert.equal(output[1].event, 'done');
});
