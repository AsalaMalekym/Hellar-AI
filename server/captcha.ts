import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Services } from './types.js';
import { digest, HttpError, rate, token } from './security.js';

export function createCaptcha(s: Services, request: typeof fetch = fetch) {
  const { c, db } = s;
  const required = c.captcha.required;
  const testKeys = [c.captcha.siteKey, c.captcha.secretKey].some((key) => /^[123]x/.test(key));
  const ready = !!(c.captcha.siteKey && c.captcha.secretKey) && !(c.production && testKeys);
  const cookieName = c.secure ? '__Host-hellar-human' : 'hellar-human';
  const agent = (r: FastifyRequest) => digest(r.headers['user-agent'] || '');
  function passed(r: FastifyRequest) {
    if (!required) return true;
    const raw = r.cookies[cookieName];
    return !!(
      ready &&
      raw &&
      db.get(
        'SELECT token_hash FROM captcha_passes WHERE token_hash=? AND agent_hash=? AND expires_at>?',
        digest(raw),
        agent(r),
        Date.now(),
      )
    );
  }
  async function verify(raw: unknown, action: string, r: FastifyRequest) {
    if (!required) return;
    if (!ready)
      throw new HttpError(
        503,
        'Проверка безопасности ещё настраивается. Попробуй позже.',
        'CAPTCHA_NOT_CONFIGURED',
      );
    if (typeof raw !== 'string' || !raw || raw.length > 2048)
      throw new HttpError(400, 'Пройди проверку «Я не робот».', 'CAPTCHA_INVALID');
    // Siteverify replay detection is eventually consistent: claim each token locally
    // before awaiting the provider, so concurrent requests cannot reuse it.
    db.run('DELETE FROM captcha_tokens WHERE expires_at<?', Date.now());
    const claim = db.run(
      'INSERT OR IGNORE INTO captcha_tokens(token_hash,expires_at) VALUES(?,?)',
      digest(raw),
      Date.now() + 600000,
    );
    if (claim.changes !== 1) throw new HttpError(400, 'Пройди капчу ещё раз.', 'CAPTCHA_INVALID');
    let result: { success?: boolean; hostname?: string; action?: string };
    try {
      const response = await request('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: c.captcha.secretKey, response: raw }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw Error('provider');
      result = (await response.json()) as typeof result;
    } catch {
      throw new HttpError(
        503,
        'Не удалось проверить капчу. Попробуй ещё раз.',
        'CAPTCHA_UNAVAILABLE',
      );
    }
    if (
      result.success !== true ||
      result.hostname !== new URL(c.origin).hostname ||
      result.action !== action
    )
      throw new HttpError(
        400,
        'Капча недействительна или истекла. Пройди проверку ещё раз.',
        'CAPTCHA_INVALID',
      );
  }
  function guard(r: FastifyRequest) {
    const path = decodeURIComponent(r.url.split('?')[0]);
    if (!path.startsWith('/api/')) return;
    if (['/api/health', '/api/status', '/api/auth/me', '/api/security/challenge'].includes(path))
      return;
    if (!passed(r))
      throw new HttpError(
        403,
        'Пройди проверку безопасности, чтобы продолжить.',
        'CAPTCHA_REQUIRED',
      );
  }
  function routes(app: FastifyInstance) {
    app.post('/api/security/challenge', async (r, p) => {
      rate(db, 'captcha:' + r.ip, 30, 60000);
      await verify((r.body as any)?.captchaToken, 'site_entry', r);
      if (required) {
        const raw = token();
        db.run('DELETE FROM captcha_passes WHERE expires_at<?', Date.now());
        const old = r.cookies[cookieName];
        if (old) db.run('DELETE FROM captcha_passes WHERE token_hash=?', digest(old));
        db.run(
          'INSERT INTO captcha_passes VALUES(?,?,?)',
          digest(raw),
          agent(r),
          Date.now() + 1800000,
        );
        p.setCookie(cookieName, raw, {
          httpOnly: true,
          secure: c.secure,
          sameSite: 'strict',
          path: '/',
          maxAge: 1800,
        });
      }
      return { ok: true };
    });
  }
  return { required, ready, verify, passed, guard, routes };
}
export type Captcha = ReturnType<typeof createCaptcha>;
