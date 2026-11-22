import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fixture } from './helpers.js';
import type { AIProvider } from '../server/provider.js';
import { LocalStorage } from '../server/storage.js';
const ai: AIProvider = {
  ready: true,
  async *stream() {
    yield '';
  },
  async image(_prompt, size) {
    const [width, height] = size.split('x').map(Number);
    return sharp({ create: { width, height, channels: 3, background: '#8650f5' } })
      .png()
      .toBuffer();
  },
};
test('image generation, owner-only file access, download, history, quotas and deletion', async () => {
  const f = await fixture({ imageLimit: 1 }, { ai });
  try {
    const a = f.client(),
      b = f.client();
    await a.register();
    await b.register('other@example.com');
    const invalid = await a.request('POST', '/images', {
      prompt: 'Purple cosmos',
      size: '1024x1820',
    });
    assert.equal(invalid.statusCode, 400);
    const r = await a.request('POST', '/images', { prompt: 'Purple cosmos', size: '1024x1024' });
    assert.equal(r.statusCode, 200, r.body);
    const j = r.json().image;
    assert.equal(j.width, 1024);
    assert.equal(j.status, 'complete');
    assert.equal((await b.request('GET', '/images/' + j.id + '/file')).statusCode, 404);
    assert.equal((await b.request('DELETE', '/images/' + j.id)).statusCode, 404);
    const download = await a.request('GET', '/images/' + j.id + '/file?download=1');
    assert.equal(download.statusCode, 200);
    assert.match(download.headers['content-type']!, /image\/png/);
    assert.match(download.headers['content-disposition']!, /attachment/);
    assert.equal((await a.request('GET', '/images')).json().images[0].prompt, 'Purple cosmos');
    assert.equal((await b.request('GET', '/images')).json().images.length, 0);
    assert.equal(
      (await a.request('POST', '/images', { prompt: 'again', size: '1024x1024' })).statusCode,
      429,
    );
    const key = f.db.get('SELECT file_key FROM image_jobs WHERE id=?', j.id).file_key;
    assert.equal((await a.request('DELETE', '/images/' + j.id)).statusCode, 200);
    await assert.rejects(new LocalStorage(f.c.storagePath).read(key));
  } finally {
    await f.close();
  }
});
test('image provider error is sanitized, wrong dimensions rejected, missing key explicit', async () => {
  const f = await fixture(
    {},
    {
      ai: {
        ...ai,
        async image() {
          throw Error('api-secret-do-not-leak');
        },
      },
    },
  );
  try {
    const a = f.client();
    await a.register();
    const r = await a.request('POST', '/images', { prompt: 'galaxy', size: '1024x1024' });
    assert.equal(r.statusCode, 502);
    assert.doesNotMatch(r.body, /api-secret/);
    const jobs = (await a.request('GET', '/images')).json().images;
    assert.equal(jobs[0].status, 'error');
    assert.equal((await a.request('GET', '/images/' + jobs[0].id + '/file')).statusCode, 404);
  } finally {
    await f.close();
  }
  const x = await fixture(
    {},
    {
      ai: {
        ...ai,
        async image() {
          return sharp({ create: { width: 20, height: 20, channels: 3, background: '#000' } })
            .png()
            .toBuffer();
        },
      },
    },
  );
  try {
    const a = x.client();
    await a.register();
    assert.equal(
      (await a.request('POST', '/images', { prompt: 'galaxy', size: '1024x1024' })).statusCode,
      502,
    );
  } finally {
    await x.close();
  }
  const missing = await fixture({ key: '' });
  try {
    const a = missing.client();
    await a.register();
    assert.equal(
      (await a.request('POST', '/images', { prompt: 'galaxy', size: '1024x1024' })).statusCode,
      503,
    );
  } finally {
    await missing.close();
  }
});
test('image timeout persists interrupted history and releases concurrency lock', async () => {
  const f = await fixture(
    { imageTimeout: 30 },
    {
      ai: {
        ...ai,
        async image(_p, _s, signal) {
          await new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
          throw Error('unreachable');
        },
      },
    },
  );
  try {
    const a = f.client();
    await a.register();
    const r = await a.request('POST', '/images', { prompt: 'cosmos', size: '1024x1024' });
    assert.equal(r.statusCode, 502);
    assert.match(r.json().error, /Время ожидания/);
    assert.equal((await a.request('GET', '/images')).json().images[0].status, 'interrupted');
    assert.equal(f.db.get('SELECT COUNT(*) n FROM generation_locks').n, 0);
  } finally {
    await f.close();
  }
});
