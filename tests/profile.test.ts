import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, PASSWORD } from './helpers.js';
import { safeImage, LocalStorage } from '../server/storage.js';
import sharp from 'sharp';
test('profile persists, session revocation, password change and account erasure', async () => {
  const f = await fixture();
  try {
    const a = f.client(),
      b = f.client();
    await a.register();
    await b.login('member@example.com');
    assert.equal(
      (
        await a.request('PATCH', '/profile', {
          name: 'Новое имя',
          settings: { motion: false, style: 'compact' },
        })
      ).statusCode,
      200,
    );
    const me = (await a.request('GET', '/auth/me')).json().user;
    assert.equal(me.name, 'Новое имя');
    assert.equal(me.settings.motion, false);
    assert.equal((await a.request('GET', '/profile/sessions')).json().sessions.length, 2);
    await a.request('POST', '/profile/sessions/revoke-others');
    assert.equal((await b.request('GET', '/auth/me')).json().user, null);
    await b.login('member@example.com');
    assert.equal(
      (
        await a.request('POST', '/profile/password', {
          currentPassword: PASSWORD,
          password: 'New-password-2026!',
          confirmPassword: 'New-password-2026!',
        })
      ).statusCode,
      200,
    );
    assert.equal((await b.request('GET', '/auth/me')).json().user, null);
    assert.equal(
      (
        await a.request('DELETE', '/profile', {
          password: 'New-password-2026!',
          confirmation: 'УДАЛИТЬ',
        })
      ).statusCode,
      200,
    );
    assert.equal(f.db.get('SELECT COUNT(*) n FROM users WHERE id=?', me.id).n, 0);
    assert.equal(f.db.get('SELECT COUNT(*) n FROM sessions WHERE user_id=?', me.id).n, 0);
    assert.equal((await a.request('GET', '/auth/me')).json().user, null);
  } finally {
    await f.close();
  }
});
test('image sanitation and traversal protection', async () => {
  const f = await fixture();
  try {
    const raw = await sharp({
      create: { width: 30, height: 20, channels: 3, background: '#8650f5' },
    })
      .png()
      .toBuffer();
    const cleaned = await safeImage(raw, true),
      meta = await sharp(cleaned).metadata();
    assert.equal(meta.width, 256);
    assert.equal(meta.format, 'webp');
    await assert.rejects(safeImage(Buffer.from('<svg onload="alert(1)"></svg>'), true));
    const store = new LocalStorage(f.c.storagePath);
    await assert.rejects(store.read('../secret'));
    const key = await store.put(cleaned, 'webp');
    assert.deepEqual(await store.read(key), cleaned);
    await store.delete(key);
    await assert.rejects(store.read(key));
  } finally {
    await f.close();
  }
});

test('avatar endpoint sanitizes uploaded image, isolates access, erases files with account', async () => {
  const f = await fixture();
  try {
    const a = f.client(),
      b = f.client();
    const registered = (await a.register()).json();
    await b.register('other@example.com');
    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#8650f5' },
    })
      .png()
      .toBuffer();
    const boundary = 'hellar-test-boundary';
    const payload = Buffer.concat([
      Buffer.from(
        '--' +
          boundary +
          '\r\nContent-Disposition: form-data; name="avatar"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n',
      ),
      png,
      Buffer.from('\r\n--' + boundary + '--\r\n'),
    ]);
    assert.equal(
      (
        await a.request('POST', '/profile/avatar', payload, {
          'content-type': 'multipart/form-data; boundary=' + boundary,
        })
      ).statusCode,
      200,
    );
    const download = await a.request('GET', '/profile/avatar');
    assert.equal(download.statusCode, 200);
    assert.match(download.headers['content-type']!, /image\/webp/);
    assert.equal((await b.request('GET', '/profile/avatar')).statusCode, 404);
    const key = f.db.get('SELECT avatar_key FROM users WHERE id=?', registered.user.id).avatar_key;
    await a.request('DELETE', '/profile', { password: PASSWORD, confirmation: 'УДАЛИТЬ' });
    await assert.rejects(new LocalStorage(f.c.storagePath).read(key));
    assert.equal(f.db.get('SELECT COUNT(*) n FROM file_gc').n, 0);
  } finally {
    await f.close();
  }
});
