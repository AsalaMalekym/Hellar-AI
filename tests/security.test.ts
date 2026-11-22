import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, PASSWORD } from './helpers.js';
import { id, token, digest, quota } from '../server/security.js';
import { Store } from '../server/db.js';
test('secure cookie flags, cache headers, CSRF on encoded paths, SQL input and body limit', async () => {
  const f = await fixture({
    production: true,
    secure: true,
    origin: 'https://hellar.example.test',
  });
  try {
    const a = f.client();
    const first = await a.init();
    assert.match(String(first.headers['set-cookie']), /__Host-hellar-pre/);
    assert.match(String(first.headers['set-cookie']), /HttpOnly/);
    assert.match(String(first.headers['set-cookie']), /Secure/);
    assert.match(String(first.headers['set-cookie']), /SameSite=Strict/);
    await a.login();
    assert.equal((await a.request('GET', '/admin/users')).statusCode, 200);
    assert.equal(
      (await a.request('POST', '/auth/logout', {}, { 'x-csrf-token': '' })).statusCode,
      403,
    );
    assert.equal(
      (await a.request('POST', '/auth/logout', {}, { origin: 'https://evil.test' })).statusCode,
      403,
    );
    assert.equal(
      (await a.request('GET', '/chats?q=' + encodeURIComponent("' OR 1=1 --"))).statusCode,
      200,
    );
    const tooBig = await a.request('POST', '/chats', { title: 'x'.repeat(70000) });
    assert.equal(tooBig.statusCode, 413);
    for (const url of ['/api%2fauth/logout', '//api/auth/logout', '/api/../api/auth/logout']) {
      const r = await f.app.inject({ method: 'POST', url, payload: {} });
      assert.ok(r.statusCode >= 400);
    }
    const h = await a.request('GET', '/auth/me');
    assert.equal(h.headers['cache-control'], 'no-store');
    assert.match(String(h.headers['content-security-policy']), /default-src 'self'/);
    assert.doesNotMatch(h.body, /password_hash|token_hash|OPENAI_API_KEY/);
    for (const path of ['/tests/qa.html', '/.env', '/%2eenv', '/server/app.ts']) {
      const asset = await f.app.inject(path);
      assert.equal(asset.statusCode, 404);
    }
  } finally {
    await f.close();
  }
});
test('expired and revoked invitations rejected; expired reset cannot be redeemed', async () => {
  const f = await fixture();
  try {
    const a = f.client();
    await a.init();
    for (const expired of [true, false]) {
      const code = token();
      f.db.run(
        'INSERT INTO invitations(id,token_hash,label,created_at,expires_at,revoked) VALUES(?,?,?,?,?,?)',
        id(),
        digest(code),
        'test',
        Date.now(),
        Date.now() + (expired ? -1000 : 100000),
        expired ? 0 : 1,
      );
      assert.equal((await a.register('user' + expired + '@example.com', code)).statusCode, 400);
    }
    const reset = token();
    f.db.run(
      'INSERT INTO password_resets(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)',
      id(),
      f.admin,
      digest(reset),
      Date.now() - 1000,
    );
    assert.equal(
      (
        await a.request('POST', '/auth/reset', {
          token: reset,
          password: PASSWORD,
          confirmPassword: PASSWORD,
        })
      ).statusCode,
      400,
    );
  } finally {
    await f.close();
  }
});
test('global quota is atomic and per-user quota rolls back on global exhaustion', async () => {
  const db = new Store(':memory:');
  try {
    quota(db, 'a', 'chat', 10, 1);
    assert.throws(() => quota(db, 'b', 'chat', 10, 1));
    assert.equal(db.get('SELECT count FROM usage WHERE user_id=?', 'b'), undefined);
    assert.equal(db.get('SELECT count FROM usage WHERE user_id=?', '__global__').count, 1);
  } finally {
    db.close();
  }
});
test('opening database does not interrupt jobs; explicit restart recovery does', async () => {
  const f = await fixture();
  try {
    const c = id(),
      m = id();
    f.db.run(
      'INSERT INTO chats VALUES(?,?,?,?,?,?,?)',
      c,
      f.admin,
      'test',
      'test',
      '',
      Date.now(),
      Date.now(),
    );
    f.db.run(
      'INSERT INTO messages VALUES(?,?,?,?,?,?)',
      m,
      c,
      'assistant',
      'partial',
      'streaming',
      Date.now(),
    );
    const connection = new Store(f.c.dbPath);
    assert.equal(connection.get('SELECT status FROM messages WHERE id=?', m).status, 'streaming');
    connection.recover();
    assert.equal(connection.get('SELECT status FROM messages WHERE id=?', m).status, 'interrupted');
    connection.close();
  } finally {
    await f.close();
  }
});
