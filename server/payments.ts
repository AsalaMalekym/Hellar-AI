import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Services } from './types.js';
import { equal, token, HttpError, rate, audit } from './security.js';
import { MICRO } from './billing-config.js';
import { ledger, wallet, summary, subscribe, settle } from './billing.js';
export const RESULT_PATH = '/api/payments/robokassa/result';
export const isPaymentCallback = (r: { method: string; url: string }) =>
  r.method === 'POST' && r.url.split('?')[0] === RESULT_PATH;
export const signature = (parts: (string | number)[]) =>
  createHash('sha256').update(parts.join(':')).digest('hex');
export function paymentReady(s: Services) {
  const b = s.c.billing;
  if (
    (b.password1 && b.password1 === b.testPassword1) ||
    (b.password2 && b.password2 === b.testPassword2)
  )
    return false;
  return !!(
    s.c.key &&
    b.enabled &&
    b.fxKopecks &&
    b.merchant &&
    (b.test ? b.testPassword1 && b.testPassword2 : b.password1 && b.password2)
  );
}
export function parseForm(body: string) {
  const pairs = new URLSearchParams(body),
    result: Record<string, string> = {};
  for (const [key, value] of pairs) {
    if (Object.hasOwn(result, key)) throw new HttpError(400, 'Повторяющийся параметр.');
    Object.defineProperty(result, key, { value, enumerable: true });
  }
  return result;
}
export function paid(s: Services, body: unknown) {
  const b = z
    .object({
      OutSum: z.string().regex(/^\d{1,9}(\.\d{1,6})?$/),
      InvId: z.string().regex(/^[1-9]\d{0,14}$/),
      SignatureValue: z.string().regex(/^[a-fA-F0-9]{64}$/),
      Shp_order: z.string().min(20).max(100),
    })
    .parse(body);
  // No unsigned extra custom fields can change attribution or payment mode.
  if (Object.keys(body as object).some((k) => /^shp_/i.test(k) && k !== 'Shp_order'))
    throw new HttpError(400, 'Некорректные параметры.');
  const order = s.db.get('SELECT * FROM payment_orders WHERE id=?', Number(b.InvId));
  if (!order || order.nonce !== b.Shp_order || order.merchant !== s.c.billing.merchant)
    throw new HttpError(403, 'Платёж не подтверждён.');
  const cfg = s.c.billing,
    pass = order.test ? cfg.testPassword2 : cfg.password2;
  if (
    !pass ||
    !equal(
      signature([b.OutSum, b.InvId, pass, 'Shp_order=' + b.Shp_order]),
      b.SignatureValue.toLowerCase(),
    )
  )
    throw new HttpError(403, 'Платёж не подтверждён.');
  const [whole, fraction = ''] = b.OutSum.split('.');
  const kopecks = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  if (/[1-9]/.test(fraction.slice(2)) || kopecks !== order.rub_kopecks)
    throw new HttpError(400, 'Сумма платежа не совпадает.');
  s.db.tx(() => {
    const current = s.db.get('SELECT status FROM payment_orders WHERE id=?', order.id);
    if (current.status !== 'pending') return;
    // Test notifications NEVER create spendable credit, even for an administrator.
    if (!order.test) {
      wallet(s, order.user_id);
      s.db.run('UPDATE wallets SET balance=balance+? WHERE user_id=?', order.credit, order.user_id);
      ledger(
        s,
        order.user_id,
        'topup',
        order.credit,
        'payment:' + order.id,
        (order.rub_kopecks / 100).toFixed(2) + ' ₽',
      );
    }
    s.db.run(
      'UPDATE payment_orders SET status=?,paid_at=? WHERE id=?',
      order.test ? 'test_paid' : 'paid',
      Date.now(),
      order.id,
    );
  });
  return 'OK' + b.InvId;
}
function checkout(s: Services, order: any, email: string) {
  const b = s.c.billing,
    amount = (order.rub_kopecks / 100).toFixed(2);
  const pass = order.test ? b.testPassword1 : b.password1;
  if (!pass || order.merchant !== b.merchant)
    throw new HttpError(503, 'Настройки магазина изменились. Создай новый платёж.');
  const description = 'Предоплата услуг Hellar AI';
  const receipt = encodeURIComponent(
    JSON.stringify({
      items: [
        {
          name: description,
          quantity: 1,
          sum: Number(amount),
          tax: 'none',
          payment_method: 'advance',
          payment_object: 'service',
        },
      ],
    }),
  );
  const params = new URLSearchParams({
    MerchantLogin: b.merchant,
    OutSum: amount,
    InvId: String(order.id),
    Description: description,
    Email: email,
    Culture: 'ru',
    Encoding: 'utf-8',
    IncCurrLabel: 'SBP',
    IsTest: String(order.test),
    Receipt: receipt,
    Shp_order: order.nonce,
    SignatureValue: signature([
      b.merchant,
      amount,
      order.id,
      receipt,
      pass,
      'Shp_order=' + order.nonce,
    ]),
  });
  return 'https://auth.robokassa.ru/Merchant/Index.aspx?' + params.toString();
}
export async function billingRoutes(app: FastifyInstance, s: Services) {
  app.get('/api/billing', async (r) => {
    const u = s.requireUser(r);
    return {
      ...summary(s, u.id),
      paymentsReady: paymentReady(s) && (!s.c.billing.test || u.role === 'admin'),
      test: s.c.billing.test,
    };
  });
  app.post('/api/billing/subscribe', async (r) => {
    const u = s.requireUser(r);
    rate(s.db, 'subscribe:' + u.id, 10, 60000);
    return subscribe(s, u.id);
  });
  app.post('/api/billing/topup', async (r) => {
    const u = s.requireUser(r);
    if (!paymentReady(s) || (s.c.billing.test && u.role !== 'admin'))
      throw new HttpError(503, 'Пополнение пока не подключено.');
    rate(s.db, 'topup:' + u.id, 10, 60000);
    const b = z
      .object({
        rubKopecks: z.number().int().min(10000).max(5000000),
        requestKey: z.string().uuid(),
      })
      .parse(r.body);
    const order = s.db.tx(() => {
      const existing = s.db.get(
        'SELECT * FROM payment_orders WHERE user_id=? AND request_key=?',
        u.id,
        b.requestKey,
      );
      if (existing) {
        if (existing.rub_kopecks !== b.rubKopecks)
          throw new HttpError(409, 'Сумма уже созданного платежа отличается.');
        return existing;
      }
      const cfg = s.c.billing;
      s.db.run(
        'INSERT INTO payment_orders(user_id,request_key,nonce,rub_kopecks,credit,fx_kopecks,merchant,test,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        u.id,
        b.requestKey,
        token(),
        b.rubKopecks,
        Math.floor((b.rubKopecks * MICRO) / cfg.fxKopecks),
        cfg.fxKopecks,
        cfg.merchant,
        cfg.test ? 1 : 0,
        Date.now(),
      );
      return s.db.get(
        'SELECT * FROM payment_orders WHERE user_id=? AND request_key=?',
        u.id,
        b.requestKey,
      );
    });
    return {
      orderId: order.id,
      status: order.status,
      credit: order.credit,
      rubKopecks: order.rub_kopecks,
      url: order.status === 'pending' ? checkout(s, order, u.email) : null,
      test: !!order.test,
    };
  });
  app.post(RESULT_PATH, async (r, p) => p.type('text/plain; charset=utf-8').send(paid(s, r.body)));
  app.get('/api/admin/billing', async (r) => {
    s.requireAdmin(r);
    return {
      holds: s.db.all(
        "SELECT id,user_id,kind,model,package_reserved,wallet_reserved,state,provider_request_id,note,created_at FROM billing_holds WHERE state='review' OR note LIKE '%COST_OVERRUN%' ORDER BY created_at DESC LIMIT 100",
      ),
    };
  });
  app.post('/api/admin/billing/:id/resolve', async (r) => {
    const u = s.requireAdmin(r);
    const hid = z
      .string()
      .uuid()
      .parse((r.params as any).id);
    const b = z
      .object({
        providerCostMicro: z
          .number()
          .int()
          .min(0)
          .max(100 * MICRO),
        note: z.string().trim().min(10).max(300),
      })
      .parse(r.body);
    const hold = s.db.get('SELECT * FROM billing_holds WHERE id=?', hid);
    if (!hold) throw new HttpError(404, 'Операция не найдена.');
    if (hold.state !== 'review')
      throw new HttpError(409, 'Операция уже обработана или ещё выполняется.');
    settle(s, hid, null, false, {
      cost: b.providerCostMicro,
      note: 'Admin ' + u.id + ': ' + b.note,
    });
    audit(s.db, u.id, 'billing_reconciled', hid);
    return { ok: true };
  });
}
