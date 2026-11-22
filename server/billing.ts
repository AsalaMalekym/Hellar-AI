import type { Services } from './types.js';
import { id, HttpError } from './security.js';
import { MICRO, PLAN_PRICE, PLAN_ALLOWANCE, type Price } from './billing-config.js';
import type { TextMessage } from './provider.js';
export type TokenUsage = { input: number; cached: number; output: number };
const integer = (x: number) => Number.isSafeInteger(x) && x >= 0;
export function cost(usage: TokenUsage, price: Price, markup = 1) {
  if (![usage.input, usage.cached, usage.output].every(integer) || usage.cached > usage.input)
    throw new HttpError(502, 'Не удалось подтвердить расход токенов.');
  // Rates use nano-USD/token. Round only the total, never individual token counts.
  const nano =
    (usage.input - usage.cached) * Math.round(price.input * 1000) +
    usage.cached * Math.round(price.cached * 1000) +
    usage.output * Math.round(price.output * 1000);
  const result = Math.ceil((nano * markup) / 1000);
  if (!integer(result)) throw new HttpError(502, 'Некорректный расход токенов.');
  return result;
}
export function ledger(
  s: Services,
  uid: string,
  kind: string,
  amount: number,
  reference: string,
  detail = '',
) {
  s.db.run(
    'INSERT INTO billing_ledger VALUES(?,?,?,?,?,?,?)',
    id(),
    uid,
    kind,
    amount,
    reference,
    detail,
    Date.now(),
  );
}
export function wallet(s: Services, uid: string) {
  s.db.run('INSERT OR IGNORE INTO wallets(user_id) VALUES(?)', uid);
  return s.db.get('SELECT * FROM wallets WHERE user_id=?', uid);
}
export function activePlan(s: Services, uid: string, now = Date.now()) {
  return s.db.get(
    'SELECT * FROM subscriptions WHERE user_id=? AND starts_at<=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1',
    uid,
    now,
    now,
  );
}
export function subscribe(s: Services, uid: string) {
  if (!s.c.billing.enabled || !s.c.key) throw new HttpError(503, 'Платные тарифы ещё не включены.');
  return s.db.tx(() => {
    if (activePlan(s, uid))
      throw new HttpError(409, 'Подписка уже действует. Продлить можно после окончания месяца.');
    wallet(s, uid);
    if (
      !s.db.run(
        'UPDATE wallets SET balance=balance-? WHERE user_id=? AND balance>=?',
        PLAN_PRICE,
        uid,
        PLAN_PRICE,
      ).changes
    )
      throw new HttpError(
        402,
        'Для подписки нужно 12 кредитов. Пополни баланс.',
        'INSUFFICIENT_BALANCE',
      );
    const now = Date.now(),
      d = new Date(now),
      day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    const sid = id();
    s.db.run(
      'INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?)',
      sid,
      uid,
      now,
      d.getTime(),
      PLAN_ALLOWANCE,
      PLAN_ALLOWANCE,
      now,
    );
    ledger(s, uid, 'subscription', -PLAN_PRICE, 'subscription:' + sid, 'Hellar — 1 месяц');
    return { ok: true };
  });
}
export function priceFor(s: Services, model: string): Price {
  const price = s.c.billing.prices[model];
  if (!price)
    throw new HttpError(503, 'Для этой модели ещё не настроен тариф.', 'PRICE_NOT_CONFIGURED');
  return price;
}
export function chatReserve(s: Services, model: string, messages: TextMessage[]) {
  // Byte upper bound plus framing allowance. Actual settlement uses provider usage, including context.
  const input = messages.reduce((n, m) => n + Buffer.byteLength(m.content, 'utf8') + 64, 128);
  return cost({ input, cached: 0, output: s.c.maxOutput }, priceFor(s, model), 2);
}
export function imageReserve(s: Services, prompt: string) {
  return cost(
    { input: Buffer.byteLength(prompt, 'utf8') + 256, cached: 0, output: 8192 },
    priceFor(s, s.c.imageModel),
    2,
  );
}
export function reserve(s: Services, uid: string, kind: string, model: string, amount: number) {
  if (!s.c.billing.enabled) return null;
  if (!integer(amount) || amount <= 0) throw Error('Invalid reservation');
  return s.db.tx(() => {
    // One uncertain paid operation must be reconciled before another can start.
    if (s.db.get("SELECT id FROM billing_holds WHERE user_id=? AND state='review'", uid))
      throw new HttpError(
        409,
        'Уточняем расход предыдущего запроса. Обратись к владельцу сайта.',
        'BILLING_REVIEW',
      );
    const w = wallet(s, uid),
      plan = activePlan(s, uid);
    const fromPackage = Math.min(plan?.remaining || 0, amount),
      fromWallet = amount - fromPackage;
    if (w.balance < fromWallet)
      throw new HttpError(
        402,
        'Недостаточно кредитов для этого запроса с учётом контекста и максимального ответа. Пополни баланс или сократи диалог.',
        'INSUFFICIENT_BALANCE',
      );
    if (fromPackage)
      s.db.run('UPDATE subscriptions SET remaining=remaining-? WHERE id=?', fromPackage, plan.id);
    if (fromWallet)
      s.db.run('UPDATE wallets SET balance=balance-? WHERE user_id=?', fromWallet, uid);
    const hid = id();
    s.db.run(
      'INSERT INTO billing_holds(id,user_id,kind,model,price_json,subscription_id,package_reserved,wallet_reserved,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      hid,
      uid,
      kind,
      model,
      JSON.stringify(priceFor(s, model)),
      plan?.id || null,
      fromPackage,
      fromWallet,
      Date.now(),
    );
    return hid;
  });
}
// Refund unused reservation to its original source, including an expired package (never to wallet).
export function settle(
  s: Services,
  hid: string | null,
  usage: TokenUsage | null,
  verifiedNoCharge = false,
  manual?: { cost: number; note: string },
) {
  if (!hid) return;
  s.db.tx(() => {
    const h = s.db.get('SELECT * FROM billing_holds WHERE id=?', hid);
    if (!h || h.state === 'settled') return;
    if (!usage && !verifiedNoCharge && !manual) {
      s.db.run(
        "UPDATE billing_holds SET state='review',note='Provider usage missing' WHERE id=?",
        hid,
      );
      return;
    }
    const price: Price = JSON.parse(h.price_json);
    try {
      if (usage) cost(usage, price);
    } catch {
      s.db.run(
        "UPDATE billing_holds SET state='review',note='Invalid provider usage' WHERE id=?",
        hid,
      );
      return;
    }
    const providerCost = manual ? manual.cost : usage ? cost(usage, price) : 0;
    const requested = manual ? manual.cost * 2 : usage ? cost(usage, price, 2) : 0;
    if (!integer(providerCost) || !integer(requested)) throw Error('Invalid settlement');
    const held = h.package_reserved + h.wallet_reserved;
    // Never surprise-charge beyond the amount reserved. Overruns remain visible to the owner.
    const charged = Math.min(requested, held);
    const packageSpent = Math.min(charged, h.package_reserved),
      walletSpent = charged - packageSpent;
    if (h.subscription_id)
      s.db.run(
        'UPDATE subscriptions SET remaining=remaining+? WHERE id=?',
        h.package_reserved - packageSpent,
        h.subscription_id,
      );
    s.db.run(
      'UPDATE wallets SET balance=balance+? WHERE user_id=?',
      h.wallet_reserved - walletSpent,
      h.user_id,
    );
    const note = (manual?.note || '') + (requested > held ? ' COST_OVERRUN' : '');
    s.db.run(
      "UPDATE billing_holds SET state='settled',charged=?,provider_cost=?,usage_json=?,note=?,settled_at=? WHERE id=?",
      charged,
      providerCost,
      usage ? JSON.stringify(usage) : null,
      note,
      Date.now(),
      hid,
    );
    ledger(s, h.user_id, h.kind, -charged, 'usage:' + hid, h.model);
  });
}
export function summary(s: Services, uid: string) {
  const b = s.c.billing,
    w = wallet(s, uid),
    plan = activePlan(s, uid);
  const reserved = s.db.get(
    "SELECT COALESCE(SUM(package_reserved+wallet_reserved),0) amount FROM billing_holds WHERE user_id=? AND state IN ('reserved','review')",
    uid,
  ).amount;
  return {
    enabled: b.enabled,
    fxKopecks: b.fxKopecks,
    wallet: w.balance,
    reserved,
    plan: plan
      ? { remaining: plan.remaining, granted: plan.granted, expiresAt: plan.expires_at }
      : null,
    price: PLAN_PRICE,
    allowance: PLAN_ALLOWANCE,
    unit: MICRO,
    planRubKopecks: b.fxKopecks ? Math.ceil((PLAN_PRICE * b.fxKopecks) / MICRO) : null,
    rates: b.prices,
    ledger: s.db.all(
      'SELECT kind,amount,detail,created_at FROM billing_ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50',
      uid,
    ),
    orders: s.db.all(
      'SELECT id,rub_kopecks,credit,status,test,created_at FROM payment_orders WHERE user_id=? ORDER BY id DESC LIMIT 20',
      uid,
    ),
  };
}
