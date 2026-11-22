import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, PASSWORD } from './helpers.js';
import { digest } from '../server/security.js';
import { createApiMailer } from '../server/mail-api.js';

test('registration creates no account or session until mailbox owner chooses a password; token is hashed and single-use', async () => {
  const f = await fixture();
  try {
    const a = f.client();
    await a.init();
    const invitation = f.seedInvite();
    const result = await a.request('POST', '/auth/register', {
      email: '  Person@EXAMPLE.com ',
      name: 'Person',
      invitation,
      password: 'Attacker-password-123!',
      confirmPassword: 'Attacker-password-123!',
    });
    assert.equal(result.statusCode, 200);
    assert.equal(f.db.get('SELECT id FROM users WHERE email=?', 'person@example.com'), undefined);
    assert.equal((await a.request('GET', '/auth/me')).json().user, null);
    assert.equal(
      f.db.get('SELECT used_at FROM invitations WHERE token_hash=?', digest(invitation)).used_at,
      null,
    );
    const token = f.verificationLinks.get('person@example.com')!.split('#')[1];
    assert.equal(
      f.db.get('SELECT token_hash FROM pending_registrations').token_hash,
      digest(token),
    );
    assert.ok(!result.body.includes(token));
    assert.equal((await a.login('person@example.com', 'Attacker-password-123!')).statusCode, 401);
    const owner = f.client();
    await owner.init();
    const body = { token, password: PASSWORD, confirmPassword: PASSWORD };
    assert.equal((await owner.request('POST', '/auth/verify-email', body)).statusCode, 200);
    assert.ok(
      f.db.get('SELECT email_verified_at FROM users WHERE email=?', 'person@example.com')
        .email_verified_at,
    );
    assert.equal((await a.login('person@example.com', 'Attacker-password-123!')).statusCode, 401);
    assert.equal((await a.login('person@example.com')).statusCode, 200);
    assert.equal((await owner.request('POST', '/auth/verify-email', body)).statusCode, 400);
  } finally {
    await f.close();
  }
});

test('expired links and revoked invitations cannot create users; resend issues a fresh email link', async () => {
  const f = await fixture();
  try {
    const a = f.client();
    await a.init();
    const invitation = f.seedInvite();
    const b = { email: 'person@example.com', name: 'Person', invitation };
    await a.request('POST', '/auth/register', b);
    const old = f.verificationLinks.get(b.email)!.split('#')[1];
    f.db.run('UPDATE pending_registrations SET expires_at=0');
    assert.equal(
      (
        await a.request('POST', '/auth/verify-email', {
          token: old,
          password: PASSWORD,
          confirmPassword: PASSWORD,
        })
      ).statusCode,
      400,
    );
    await a.request('POST', '/auth/register', b);
    const fresh = f.verificationLinks.get(b.email)!.split('#')[1];
    assert.notEqual(fresh, old);
    f.db.run('UPDATE invitations SET revoked=1 WHERE token_hash=?', digest(invitation));
    assert.equal(
      (
        await a.request('POST', '/auth/verify-email', {
          token: fresh,
          password: PASSWORD,
          confirmPassword: PASSWORD,
        })
      ).statusCode,
      400,
    );
    assert.equal(f.db.get('SELECT id FROM users WHERE email=?', b.email), undefined);
  } finally {
    await f.close();
  }
});

test('email outage does not create an account, consume an invitation or retain a verification link', async () => {
  for (const ready of [false, true]) {
    const f = await fixture(
      {},
      {
        mailer: {
          ready,
          async sendReset() {
            throw Error('offline');
          },
          async sendVerification() {
            throw Error('offline');
          },
        },
      },
    );
    try {
      const a = f.client();
      await a.init();
      const invitation = f.seedInvite();
      assert.equal(
        (
          await a.request('POST', '/auth/register', {
            email: 'person@example.com',
            name: 'Person',
            invitation,
          })
        ).statusCode,
        503,
      );
      assert.equal(f.db.get('SELECT id FROM users WHERE email=?', 'person@example.com'), undefined);
      assert.equal(f.db.get('SELECT * FROM pending_registrations'), undefined);
      assert.equal(
        f.db.get('SELECT used_at FROM invitations WHERE token_hash=?', digest(invitation)).used_at,
        null,
      );
      assert.equal((await a.login()).statusCode, 200); // Existing owner is preserved.
    } finally {
      await f.close();
    }
  }
});

const settings = { required: true, siteKey: 'public-site-key', secretKey: 'secret-server-key' };
test('server enforces entry captcha, action/hostname, single-use tokens, separate registration captcha and pass expiry', async () => {
  let calls = 0;
  const fakeFetch = (async (_url: any, init: any) => {
    calls++;
    const body = JSON.parse(init.body);
    assert.equal(body.secret, settings.secretKey);
    if (body.response === 'outage') throw Error('unavailable');
    return Response.json({
      success: body.response !== 'failed',
      hostname: body.response === 'wrong-host' ? 'evil.example' : 'localhost',
      action:
        body.response === 'wrong-action'
          ? 'register'
          : body.response.startsWith('register')
            ? 'register'
            : 'site_entry',
    });
  }) as typeof fetch;
  const f = await fixture({ captcha: settings }, { securityFetch: fakeFetch });
  try {
    const a = f.client();
    await a.init();
    const status = (await a.request('GET', '/status')).json();
    assert.equal(status.captchaRequired, true);
    assert.ok(!JSON.stringify(status).includes(settings.secretKey));
    assert.equal((await a.login()).json().code, 'CAPTCHA_REQUIRED');
    assert.equal((await a.request('POST', '/security/challenge', {})).statusCode, 400);
    for (const captchaToken of ['wrong-host', 'wrong-action', 'failed'])
      assert.equal(
        (await a.request('POST', '/security/challenge', { captchaToken })).statusCode,
        400,
      );
    assert.equal(
      (await a.request('POST', '/security/challenge', { captchaToken: 'outage' })).statusCode,
      503,
    );
    assert.equal(
      (await a.request('POST', '/security/challenge', { captchaToken: 'entry-good' })).statusCode,
      200,
    );
    const before = calls;
    assert.equal(
      (await a.request('POST', '/security/challenge', { captchaToken: 'entry-good' })).statusCode,
      400,
    );
    assert.equal(calls, before);
    assert.equal((await a.login()).statusCode, 200);
    const guest = f.client();
    await guest.init();
    assert.equal((await guest.request('GET', '/admin/users')).json().code, 'CAPTCHA_REQUIRED');
    await guest.request('POST', '/security/challenge', { captchaToken: 'guest-good' });
    const body = { email: 'person@example.com', name: 'Person', invitation: f.seedInvite() };
    assert.equal((await guest.request('POST', '/auth/register', body)).statusCode, 400);
    assert.equal(
      (await guest.request('POST', '/auth/register', { ...body, captchaToken: 'another-entry' }))
        .statusCode,
      400,
    );
    assert.equal(
      (await guest.request('POST', '/auth/register', { ...body, captchaToken: 'register-good' }))
        .statusCode,
      200,
    );
    f.db.run('UPDATE captcha_passes SET expires_at=0');
    assert.equal((await a.request('GET', '/admin/users')).json().code, 'CAPTCHA_REQUIRED');
    assert.equal((await a.request('GET', '/auth/me')).json().user, null);
  } finally {
    await f.close();
  }
});

test('captcha fails closed when required keys are missing', async () => {
  const f = await fixture({ captcha: { required: true, siteKey: '', secretKey: '' } });
  try {
    const a = f.client();
    await a.init();
    assert.equal(
      (await a.request('POST', '/security/challenge', { captchaToken: 'anything' })).statusCode,
      503,
    );
    assert.equal((await a.login()).json().code, 'CAPTCHA_REQUIRED');
  } finally {
    await f.close();
  }
});

test('HTTP email sender uses authenticated API and rejects provider failure without exposing details', async () => {
  const sent: any[] = [];
  const fetcher = (async (url: any, init: any) => {
    sent.push({ url, ...init });
    return Response.json({ id: 'message-id' });
  }) as typeof fetch;
  const mailer = createApiMailer('secret-key', 'Hellar <no-reply@example.com>', fetcher);
  await mailer.sendVerification(
    'person@example.com',
    'https://example.com/verify-email#test-token',
  );
  await mailer.sendReset('person@example.com', 'https://example.com/reset#reset-token');
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.equal(sent[0].headers.Authorization, 'Bearer secret-key');
  assert.match(JSON.parse(sent[0].body).text, /verify-email#test-token/);
  assert.match(JSON.parse(sent[1].body).text, /reset#reset-token/);
  const failing = createApiMailer(
    'secret-key',
    'sender@example.com',
    (async () => new Response('private provider details', { status: 403 })) as typeof fetch,
  );
  await assert.rejects(failing.sendReset('person@example.com', 'url'), /MAIL_DELIVERY_FAILED/);
});
