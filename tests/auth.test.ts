import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, PASSWORD } from './helpers.js';
test('invitation registration, single use, duplicate email rollback, login and logout', async () => {
  const f = await fixture();
  try {
    const a = f.client();
    await a.init();
    assert.equal(
      (
        await a.request('POST', '/auth/register', {
          email: 'a@example.com',
          name: 'Alex',
          password: PASSWORD,
          confirmPassword: PASSWORD,
          invitation: 'invalid-token-that-is-long-enough',
        })
      ).statusCode,
      400,
    );
    const inv = f.seedInvite();
    assert.equal((await a.register('a@example.com', inv)).statusCode, 200);
    const b = f.client();
    assert.equal((await b.register('b@example.com', inv)).statusCode, 400);
    const fresh = f.seedInvite();
    assert.equal((await b.register('a@example.com', fresh)).statusCode, 409);
    assert.equal((await b.register('b@example.com', fresh)).statusCode, 200);
    assert.equal((await a.request('POST', '/auth/logout')).statusCode, 200);
    assert.equal((await a.request('GET', '/auth/me')).json().user, null);
    assert.equal((await a.login('a@example.com', 'wrong-password')).statusCode, 401);
    assert.equal((await a.login('a@example.com')).statusCode, 200);
    assert.equal((await a.request('GET', '/auth/me')).json().user.email, 'a@example.com');
  } finally {
    await f.close();
  }
});
test('CSRF and roles protect admin; invitation revocation and blocking', async () => {
  const f = await fixture();
  try {
    const admin = f.client(),
      u = f.client(),
      anon = f.client();
    await anon.init();
    assert.equal((await anon.request('GET', '/admin/users')).statusCode, 401);
    await admin.login();
    const reg = await u.register();
    const uid = reg.json().user.id;
    assert.equal((await u.request('GET', '/admin/users')).statusCode, 403);
    assert.equal(
      (await admin.request('POST', '/admin/invitations', {}, { origin: 'https://evil.test' }))
        .statusCode,
      403,
    );
    assert.equal(
      (await admin.request('POST', '/admin/invitations', {}, { 'x-csrf-token': 'bad' })).statusCode,
      403,
    );
    const inv = (
      await admin.request('POST', '/admin/invitations', { label: 'friend', days: 1 })
    ).json();
    assert.ok(inv.code);
    const list = (await admin.request('GET', '/admin/invitations')).json().invitations;
    assert.ok(!('token_hash' in list[0]));
    await admin.request('DELETE', '/admin/invitations/' + inv.id);
    assert.equal((await anon.register('new@example.com', inv.code)).statusCode, 400);
    assert.equal(
      (await admin.request('PATCH', '/admin/users/' + uid, { blocked: true })).statusCode,
      200,
    );
    assert.equal((await u.request('GET', '/auth/me')).json().user, null);
    assert.equal((await u.login('member@example.com')).statusCode, 401);
  } finally {
    await f.close();
  }
});
test('password reset single use and session invalidation, unavailable SMTP explicit', async () => {
  let link = '';
  const f = await fixture(
    {},
    {
      mailer: {
        ready: true,
        async sendVerification() {},
        async sendReset(_email, url) {
          link = url;
        },
      },
    },
  );
  try {
    const u = f.client();
    await u.register();
    await u.request('POST', '/auth/forgot', { email: 'member@example.com' });
    assert.ok(link.includes('/reset#'));
    const x = f.client();
    await x.init();
    const b = {
      token: link.split('#')[1],
      password: 'Replacement-password!',
      confirmPassword: 'Replacement-password!',
    };
    assert.equal((await x.request('POST', '/auth/reset', b)).statusCode, 200);
    assert.equal((await u.request('GET', '/auth/me')).json().user, null);
    await x.init();
    assert.equal((await x.request('POST', '/auth/reset', b)).statusCode, 400);
    assert.equal((await u.login('member@example.com', b.password)).statusCode, 200);
  } finally {
    await f.close();
  }
  const missing = await fixture(
    {},
    {
      mailer: {
        ready: false,
        async sendVerification() { throw Error('must not send'); },
        async sendReset() {
          throw Error('must not send');
        },
      },
    },
  );
  try {
    const u = missing.client();
    await u.init();
    assert.equal(
      (await u.request('POST', '/auth/forgot', { email: 'a@example.com' })).statusCode,
      503,
    );
  } finally {
    await missing.close();
  }
});
test('parallel redemption grants exactly one account; login limit enforced', async () => {
  const f = await fixture();
  try {
    const a = f.client(),
      b = f.client();
    await a.init();
    await b.init();
    const invitation = f.seedInvite();
    const body = { name: 'Тест', password: PASSWORD, confirmPassword: PASSWORD, invitation };
    const result = await Promise.all([
      a.register('a@example.com', invitation),
      b.register('b@example.com', invitation),
    ]);
    assert.deepEqual(result.map((x) => x.statusCode).sort(), [200, 400]);
    const anon = f.client();
    await anon.init();
    for (let i = 0; i < 8; i++)
      assert.equal(
        (await anon.request('POST', '/auth/login', { email: 'admin@example.com', password: 'bad' }))
          .statusCode,
        401,
      );
    assert.equal(
      (
        await anon.request('POST', '/auth/login', {
          email: 'admin@example.com',
          password: PASSWORD,
        })
      ).statusCode,
      429,
    );
  } finally {
    await f.close();
  }
});
