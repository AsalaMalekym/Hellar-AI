import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { billingConfig, MICRO } from '../server/billing-config.js';
import { paid, signature, RESULT_PATH } from '../server/payments.js';
import {
  wallet,
  subscribe,
  reserve,
  settle,
  cost,
  chatReserve,
  summary,
} from '../server/billing.js';
import type { Services } from '../server/types.js';
const cfg = () => ({
  ...billingConfig({}),
  enabled: true,
  fxKopecks: 10000,
  merchant: 'test-merchant',
  password1: 'live-password-one',
  password2: 'live-password-two',
  testPassword1: 'test-password-one',
  testPassword2: 'test-password-two',
  test: false,
});
function notification(order: any, overrides: Record<string, string> = {}, testMode = false) {
  const body = {
    OutSum: (order.rub_kopecks / 100).toFixed(6),
    InvId: String(order.id),
    Shp_order: order.nonce,
    ...overrides,
  };
  return {
    ...body,
    SignatureValue: signature([
      body.OutSum,
      body.InvId,
      testMode ? cfg().testPassword2 : cfg().password2,
      'Shp_order=' + body.Shp_order,
    ]),
  };
}
test('payment: signed server callback, amount checks, replay protection, ownership, idempotency and CSRF', async (t) => {
  const f = await fixture({ key: 'test-only', billing: cfg() });
  t.after(() => f.close());
  const s = { db: f.db, c: f.c } as Services,
    a = f.client();
  await a.login();
  const requestKey = crypto.randomUUID();
  const start = await a.request('POST', '/billing/topup', { rubKopecks: 120000, requestKey });
  assert.equal(start.statusCode, 200, start.body);
  const repeat = await a.request('POST', '/billing/topup', { rubKopecks: 120000, requestKey });
  assert.equal(repeat.json().orderId, start.json().orderId);
  assert.equal(
    (await a.request('POST', '/billing/topup', { rubKopecks: 130000, requestKey })).statusCode,
    409,
  );
  const order = f.db.get('SELECT * FROM payment_orders WHERE id=?', start.json().orderId);
  const url = new URL(start.json().url);
  assert.equal(url.searchParams.get('IncCurrLabel'), 'SBP');
  assert.equal(
    url.searchParams.get('SignatureValue'),
    signature([
      cfg().merchant,
      '1200.00',
      order.id,
      url.searchParams.get('Receipt')!,
      cfg().password1,
      'Shp_order=' + order.nonce,
    ]),
  );
  assert.equal(wallet(s, f.admin).balance, 0);
  assert.throws(() => paid(s, notification(order, { OutSum: '1201.000000' })), /Сумма/);
  assert.throws(
    () => paid(s, { ...notification(order), SignatureValue: '0'.repeat(64) }),
    /подтверждён/,
  );
  assert.throws(() => paid(s, notification(order, { Shp_order: 'x'.repeat(32) })), /подтверждён/);
  assert.throws(() => paid(s, notification(order, { OutSum: '1200.000001' })), /Сумма/);
  // Even when collection is temporarily paused, honor an already paid order.
  f.c.billing.enabled = false;
  const body = new URLSearchParams(notification(order)).toString();
  const response = await f.app.inject({
    method: 'POST',
    url: RESULT_PATH,
    payload: body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.body, 'OK' + order.id);
  paid(s, notification(order));
  paid(s, notification(order));
  assert.equal(wallet(s, f.admin).balance, 12 * MICRO);
  assert.equal(f.db.get("SELECT COUNT(*) n FROM billing_ledger WHERE kind='topup'").n, 1);
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: RESULT_PATH,
        payload: body + '&OutSum=1200.00',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await f.app.inject({ method: 'POST', url: '/api/billing/subscribe', payload: {} })).statusCode,
    403,
  );
  const other = f.client();
  await other.register();
  const otherSummary = (await other.request('GET', '/billing')).json();
  assert.equal(otherSummary.wallet, 0);
  assert.equal(otherSummary.orders.length, 0);
  assert.equal((await other.request('GET', '/admin/billing')).statusCode, 403);
});
test('subscription and reservations: month, priority, concurrency, expiry, missing usage and exact 2x pricing', async (t) => {
  const f = await fixture({ key: 'test-only', billing: cfg() });
  t.after(() => f.close());
  const s = { db: f.db, c: f.c } as Services;
  wallet(s, f.admin);
  f.db.run('UPDATE wallets SET balance=? WHERE user_id=?', 20 * MICRO, f.admin);
  subscribe(s, f.admin);
  assert.equal(wallet(s, f.admin).balance, 8 * MICRO);
  assert.throws(() => subscribe(s, f.admin), /уже действует/);
  const plan = summary(s, f.admin).plan;
  assert.equal(plan!.remaining, 12 * MICRO);
  const h = reserve(s, f.admin, 'chat', 'gpt-4.1-mini', 2 * MICRO)!;
  const usage = { input: 1000000, cached: 500000, output: 1000000 };
  assert.equal(cost(usage, cfg().prices['gpt-4.1-mini'], 2), 3700000);
  settle(s, h, { input: 1000, cached: 500, output: 1000 });
  assert.equal(summary(s, f.admin).plan!.remaining, 12 * MICRO - 3700);
  settle(s, h, { input: 1000, cached: 500, output: 1000 });
  assert.equal(summary(s, f.admin).plan!.remaining, 12 * MICRO - 3700);
  const h2 = reserve(s, f.admin, 'chat', 'gpt-4.1-mini', 15 * MICRO)!;
  assert.throws(() => reserve(s, f.admin, 'image', 'gpt-image-1', 10 * MICRO), /Недостаточно/);
  assert.ok(wallet(s, f.admin).balance >= 0);
  f.db.run('UPDATE subscriptions SET expires_at=? WHERE user_id=?', Date.now() - 1, f.admin);
  settle(s, h2, null, true);
  assert.equal(wallet(s, f.admin).balance, 8 * MICRO);
  assert.equal(summary(s, f.admin).plan, null); // expired credit never moves to wallet
  const h3 = reserve(s, f.admin, 'chat', 'gpt-4.1-mini', 10000)!;
  settle(s, h3, null);
  assert.equal(f.db.get('SELECT state FROM billing_holds WHERE id=?', h3).state, 'review');
  assert.throws(() => reserve(s, f.admin, 'chat', 'gpt-4.1-mini', 1), /Уточняем/);
  settle(s, h3, null, false, { cost: 0, note: 'Provider did not charge this request' });
  assert.equal(wallet(s, f.admin).balance, 8 * MICRO);
  const h4 = reserve(s, f.admin, 'chat', 'gpt-4.1-mini', 10000)!;
  f.db.recover();
  assert.equal(f.db.get('SELECT state FROM billing_holds WHERE id=?', h4).state, 'review');
  settle(s, h4, { input: 0, cached: 20, output: 5 });
  assert.equal(f.db.get('SELECT state FROM billing_holds WHERE id=?', h4).state, 'review');
  settle(s, h4, null, true);
  const h5 = reserve(s, f.admin, 'chat', 'gpt-4.1-mini', 100)!;
  settle(s, h5, usage);
  assert.equal(f.db.get('SELECT charged FROM billing_holds WHERE id=?', h5).charged, 100);
  assert.match(f.db.get('SELECT note FROM billing_holds WHERE id=?', h5).note, /COST_OVERRUN/);
  assert.throws(() => chatReserve(s, 'unknown', [{ role: 'user', content: 'Hi' }]), /тариф/);
});
test('test payment never creates real credits; real signature cannot settle test order', async (t) => {
  const f = await fixture({ key: 'test-only', billing: { ...cfg(), test: true } });
  t.after(() => f.close());
  const a = f.client();
  await a.login();
  const r = await a.request('POST', '/billing/topup', {
    rubKopecks: 120000,
    requestKey: crypto.randomUUID(),
  });
  const order = f.db.get('SELECT * FROM payment_orders WHERE id=?', r.json().orderId),
    s = { db: f.db, c: f.c } as Services;
  assert.throws(() => paid(s, notification(order)), /подтверждён/);
  paid(s, notification(order, {}, true));
  assert.equal(wallet(s, f.admin).balance, 0);
  assert.equal(
    f.db.get('SELECT status FROM payment_orders WHERE id=?', order.id).status,
    'test_paid',
  );
  const other = f.client();
  await other.register();
  assert.equal(
    (
      await other.request('POST', '/billing/topup', {
        rubKopecks: 10000,
        requestKey: crypto.randomUUID(),
      })
    ).statusCode,
    503,
  );
});
test('chat route bills actual cached usage; insufficient credit prevents provider call', async (t) => {
  let calls = 0;
  const f = await fixture(
    { key: 'test-only', billing: cfg() },
    {
      ai: {
        ready: true,
        async *stream(_m, _messages, _signal, onUsage) {
          calls++;
          yield 'Ответ';
          onUsage?.({ input: 1000, cached: 500, output: 100 });
        },
        async image() {
          throw Error('unused');
        },
      },
    },
  );
  t.after(() => f.close());
  const a = f.client();
  await a.login();
  const chat = (await a.request('POST', '/chats', {})).json().chat;
  let r = await a.request('POST', '/chats/' + chat.id + '/generate', { content: 'Привет' });
  assert.equal(r.statusCode, 402);
  assert.equal(calls, 0);
  const s = { db: f.db, c: f.c } as Services;
  wallet(s, f.admin);
  f.db.run('UPDATE wallets SET balance=? WHERE user_id=?', MICRO, f.admin);
  r = await a.request('POST', '/chats/' + chat.id + '/generate', { content: 'Привет' });
  assert.equal(r.statusCode, 200, r.body);
  assert.match(r.body, /event: done/);
  assert.equal(calls, 1);
  assert.equal(wallet(s, f.admin).balance, MICRO - 820);
});

test('billable failures: rejected requests release credit; unknown streamed usage needs admin reconciliation', async t => {
 let mode = 'reject';
 const f = await fixture({ key: 'test-only', billing: cfg() }, { ai: {
  ready: true,
  async *stream() {
   if (mode === 'reject') throw Object.assign(new Error('provider rejected'), { status:429 });
   yield 'Часть ответа'; throw new Error('connection lost');
  },
  async image() { throw Error('unused'); },
 }});
 t.after(() => f.close()); const a = f.client(); await a.login();
 const s = { db:f.db,c:f.c } as Services;
 wallet(s,f.admin);f.db.run('UPDATE wallets SET balance=? WHERE user_id=?',MICRO,f.admin);
 const chat = (await a.request('POST','/chats',{})).json().chat;
 await a.request('POST',`/chats/${chat.id}/generate`,{content:'Отклонённый запрос'});
 assert.equal(wallet(s,f.admin).balance,MICRO);
 assert.equal(f.db.get("SELECT COUNT(*) n FROM billing_holds WHERE state='review'").n,0);
 mode = 'partial';
 await a.request('POST',`/chats/${chat.id}/generate`,{content:'Оборванный запрос'});
 const hold = f.db.get("SELECT * FROM billing_holds WHERE state='review'");assert.ok(hold);
 assert.ok(wallet(s,f.admin).balance < MICRO);
 assert.equal((await a.request('POST',`/chats/${chat.id}/generate`,{content:'Попытка повтора'})).statusCode,409);
 assert.equal((await a.request('POST',`/admin/billing/${hold.id}/resolve`,{providerCostMicro:-1,note:'Недопустимое отрицательное число'})).statusCode,400);
 assert.equal((await a.request('POST',`/admin/billing/${hold.id}/resolve`,{providerCostMicro:0,note:'Сверка: провайдер не подтвердил расход'})).statusCode,200);
 assert.equal(wallet(s,f.admin).balance,MICRO);
 assert.equal((await a.request('POST',`/admin/billing/${hold.id}/resolve`,{providerCostMicro:0,note:'Повтор того же возврата резерва'})).statusCode,409);
 assert.equal(wallet(s,f.admin).balance,MICRO);
});

test('admin can test SBP with billing off while chat stays available and real checkout stays closed', async t => {
 const f = await fixture({key:'test-only',billing:{...cfg(),enabled:false,test:true}}, {ai:{
  ready:true, async *stream(){yield 'Работает без списания';}, async image(){throw Error('unused');}
 }});
 t.after(()=>f.close());const a=f.client();await a.login();
 assert.equal(billingConfig({}).fxKopecks,10000);
 const before=(await a.request('GET','/billing')).json();
 assert.equal(before.enabled,false);assert.equal(before.paymentsReady,true);assert.equal(before.planRubKopecks,120000);
 const result=await a.request('POST','/billing/topup',{rubKopecks:120000,requestKey:crypto.randomUUID()});
 assert.equal(result.statusCode,200,result.body);
 const order=f.db.get('SELECT * FROM payment_orders WHERE id=?',result.json().orderId);
 paid({db:f.db,c:f.c} as Services,notification(order,{},true));
 assert.equal((await a.request('GET','/billing')).json().wallet,0);
 assert.equal((await a.request('POST','/billing/subscribe',{})).statusCode,503);
 const member=f.client();await member.register();
 assert.equal((await member.request('GET','/billing')).json().paymentsReady,false);
 assert.equal((await member.request('POST','/billing/topup',{rubKopecks:120000,requestKey:crypto.randomUUID()})).statusCode,503);
 const chat=(await member.request('POST','/chats',{})).json().chat;
 const generated=await member.request('POST','/chats/'+chat.id+'/generate',{content:'Привет'});
 assert.equal(generated.statusCode,200,generated.body);assert.match(generated.body,/event: done/);
 assert.equal(f.db.get('SELECT COUNT(*) n FROM billing_holds').n,0);
 f.c.billing.test=false;
 assert.equal((await a.request('POST','/billing/topup',{rubKopecks:120000,requestKey:crypto.randomUUID()})).statusCode,503);
});
