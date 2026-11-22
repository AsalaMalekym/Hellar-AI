import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Sparkles, RefreshCw } from 'lucide-react';
import { api, post } from '../api';
import { useApp } from '../context';
import { Button, ErrorBox, Loading } from '../components/ui';
const credits = (micro: number) =>
  (micro / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 6 });
const rub = (kopecks: number) =>
  (kopecks / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB' });
const labels: Record<string, string> = {
  topup: 'Пополнение',
  subscription: 'Подписка на месяц',
  chat: 'Ответ ИИ',
  image: 'Изображение',
};
const orderLabels: Record<string, string> = {
  pending: 'Ожидает подтверждения',
  paid: 'Зачислено',
  test_paid: 'Тест завершён — без зачисления',
};
export default function Billing() {
  const { user, notify } = useApp();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('1000'),
    [holds, setHolds] = useState<any[]>([]);
  const paymentKey = useRef<{ amount: number; key: string } | null>(null);
  const load = useCallback(async () => {
    const result = await api('/billing');
    setData(result);
    if (user?.role === 'admin') setHolds((await api('/admin/billing')).holds);
  }, [user?.role]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  // The return URL alone never proves payment. Read only our server's ledger.
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void load().catch(() => {});
    };
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 10000);
    return () => {
      window.removeEventListener('focus', refresh);
      clearInterval(timer);
    };
  }, [load]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function topup() {
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(amount))
      throw Error('Введи сумму в рублях, максимум два знака после запятой.');
    const rubKopecks = Math.round(Number(amount.replace(',', '.')) * 100);
    if (rubKopecks < 10000 || rubKopecks > 5000000) throw Error('Пополнение от 100 до 50 000 ₽.');
    if (paymentKey.current?.amount !== rubKopecks)
      paymentKey.current = { amount: rubKopecks, key: crypto.randomUUID() };
    const result = await post('/billing/topup', { rubKopecks, requestKey: paymentKey.current.key });
    if (!result.url) {
      paymentKey.current = null;
      notify('Платёж уже обработан');
      return;
    }
    const url = new URL(result.url);
    if (url.origin !== 'https://auth.robokassa.ru') throw Error('Некорректный адрес оплаты.');
    window.location.assign(result.url);
  }
  const previewRub = Math.round(Number(amount.replace(',', '.')) * 100);
  return (
    <section className="page-container billing-page">
      <p className="eyebrow">ЭНЕРГИЯ ДЛЯ ТВОИХ ИДЕЙ</p>
      <div className="billing-heading">
        <h1>Баланс и подписка</h1>
        <Button className="secondary" busy={busy} onClick={() => act(load)}>
          <RefreshCw size={17} />
          Обновить
        </Button>
      </div>
      <ErrorBox message={error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          {!data.enabled && (
            <div className="notice">
              Платные тарифы готовятся к запуску. Сейчас списания отключены.
            </div>
          )}
          {data.test && user?.role === 'admin' && (
            <div className="notice">
              Тестовый режим Robokassa: тестовая оплата не увеличивает баланс и не активирует
              подписку.
            </div>
          )}
          <div className="billing-grid">
            <article className="glass section-card">
              <h2>
                <Wallet size={22} /> Купленный баланс
              </h2>
              <p className="billing-number">
                {credits(data.wallet)} <span>кредитов</span>
              </p>
              <p className="muted">
                Не сгорает. Расходуется после месячного пакета или без подписки.
              </p>
              {data.reserved > 0 && (
                <p role="status">
                  Зарезервировано: {credits(data.reserved)} кредитов. Остаток вернётся после
                  подтверждения расхода.
                </p>
              )}
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(topup);
                }}
              >
                <label>
                  Сумма пополнения, ₽
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    disabled={busy}
                  />
                </label>
                <div className="billing-presets">
                  {['300', '1000', '3000'].map((value) => (
                    <button
                      type="button"
                      className="btn secondary"
                      key={value}
                      disabled={busy}
                      onClick={() => setAmount(value)}
                    >
                      {value} ₽
                    </button>
                  ))}
                </div>
                {data.fxKopecks > 0 ? (
                  <p className="fine muted">
                    1 кредит = {rub(data.fxKopecks)}. Будет начислено:{' '}
                    {Number.isFinite(previewRub) && previewRub > 0
                      ? credits(Math.floor((previewRub * 1e6) / data.fxKopecks))
                      : '—'}{' '}
                    кредитов. Сумма и курс фиксируются при создании платежа.
                  </p>
                ) : (
                  <p className="muted">Рублёвая цена появится перед запуском оплаты.</p>
                )}
                <Button busy={busy} disabled={!data.paymentsReady}>
                  {data.test && user?.role === 'admin'
                    ? 'Проверить оплату СБП'
                    : 'Пополнить через СБП'}
                </Button>
                {!data.paymentsReady && (
                  <p className="fine muted">Приём платежей пока не подключён.</p>
                )}
              </form>
            </article>
            <article className="glass section-card billing-plan">
              <span className="pill">HELLAR · МЕСЯЦ</span>
              <h2>
                <Sparkles size={22} /> Больше пространства для идей
              </h2>
              <p className="billing-number">
                {data.planRubKopecks ? rub(data.planRubKopecks) : '$12'} <span>/ месяц</span>
              </p>
              <p>12 кредитов в месячном пакете для чата и изображений.</p>
              <p className="muted">
                Разные модели и длина диалога расходуют пакет по-разному. Остаток пакета не
                переносится на следующий месяц.
              </p>
              {data.plan ? (
                <div className="stack">
                  <strong>
                    Осталось {credits(data.plan.remaining)} из {credits(data.plan.granted)} кредитов
                  </strong>
                  <progress
                    aria-label="Остаток месячного пакета"
                    value={data.plan.remaining}
                    max={data.plan.granted}
                  />
                  <p>Действует до {new Date(data.plan.expiresAt).toLocaleString('ru-RU')}.</p>
                  <p className="muted">
                    Автопродление выключено. Купить следующий месяц можно после окончания текущего.
                  </p>
                </div>
              ) : (
                <>
                  <Button
                    busy={busy}
                    disabled={!data.enabled || data.wallet < data.price}
                    onClick={() =>
                      act(async () => {
                        await post('/billing/subscribe');
                        notify('Подписка активна на один месяц');
                      })
                    }
                  >
                    Подключить за 12 кредитов
                  </Button>
                  {data.wallet < data.price && (
                    <p className="fine muted">Сначала пополни баланс до 12 кредитов.</p>
                  )}
                  <p className="fine muted">
                    Одно списание с баланса. Автоматических платежей нет.
                  </p>
                </>
              )}
            </article>
          </div>
          <div className="glass section-card">
            <h2>Как расходуются кредиты</h2>
            <p>
              1 кредит соответствует $1 стоимости услуг Hellar. Это внутренняя единица учёта, не
              криптовалюта. Цена запросов — себестоимость API ×2: месячный пакет покрывает до $6
              расхода API.
            </p>
            <p className="muted">
              Учитываются входные токены (включая историю диалога), кешированные токены и ответ.
              Перед запросом резервируется сумма на максимальный ответ; после получения расхода
              лишний резерв возвращается. При обрыве и отсутствии данных провайдера резерв ожидает
              проверки владельцем.
            </p>
            <p className="muted">
              Когда пакет заканчивается, дальнейшие запросы расходуют купленный баланс. Дневные
              ограничения сайта также действуют.
            </p>
            <div className="billing-table">
              <table>
                <thead>
                  <tr>
                    <th>Модель</th>
                    <th>Вход</th>
                    <th>Кеш</th>
                    <th>Ответ</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(
                    data.rates as Record<string, { input: number; cached: number; output: number }>,
                  ).map(([model, price]) => (
                    <tr key={model}>
                      <td>{model}</td>
                      <td>{price.input * 2}</td>
                      <td>{price.cached * 2}</td>
                      <td>{price.output * 2}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fine muted">
              Кредитов за 1 миллион токенов. Для изображений «вход» — текст запроса, «ответ» —
              токены изображения.
            </p>
          </div>
          <div className="billing-grid">
            <div className="glass section-card">
              <h2>История операций</h2>
              <div className="record-list">
                {data.ledger.length ? (
                  data.ledger.map((x: any, i: number) => (
                    <div className="record" key={i}>
                      <div>
                        <strong>{labels[x.kind] || x.kind}</strong>
                        <small>
                          {x.detail} · {new Date(x.created_at).toLocaleString('ru-RU')}
                        </small>
                      </div>
                      <span>
                        {x.amount > 0 ? '+' : ''}
                        {credits(x.amount)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="muted">Здесь появятся пополнения и расходы.</p>
                )}
              </div>
            </div>
            <div className="glass section-card">
              <h2>Платежи СБП</h2>
              <p className="fine muted">
                Подтверждение оплаты может прийти с задержкой. Статус обновляется автоматически.
              </p>
              <div className="record-list">
                {data.orders.length ? (
                  data.orders.map((x: any) => (
                    <div className="record" key={x.id}>
                      <div>
                        <strong>
                          №{x.id} · {rub(x.rub_kopecks)}
                        </strong>
                        <small>
                          {orderLabels[x.status] || x.status}
                          {x.test ? ' · тест' : ''}
                        </small>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">Платежей пока нет.</p>
                )}
              </div>
            </div>
          </div>
          {user?.role === 'admin' && holds.length > 0 && (
            <div className="glass section-card">
              <h2>Проверка расхода</h2>
              <p className="muted">
                Сверь операцию с данными OpenAI. Укажи фактическую себестоимость в USD; 0
                освобождает весь резерв.
              </p>
              {holds.map((h) => (
                <form
                  className="stack billing-review"
                  key={h.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    void act(async () => {
                      await post('/admin/billing/' + h.id + '/resolve', {
                        providerCostMicro: Math.round(Number(form.get('cost')) * 1e6),
                        note: form.get('note'),
                      });
                    });
                  }}
                >
                  <strong>
                    {h.model} · {new Date(h.created_at).toLocaleString('ru-RU')}
                  </strong>
                  <small>
                    {h.id} · {h.user_id}
                  </small>
                  <p>{h.note}</p>
                  <p>Запрос провайдера: {h.provider_request_id || 'ID не получен'}</p>
                  {h.state === 'review' && (
                    <>
                      <label>
                        Подтверждённая себестоимость, USD
                        <input
                          name="cost"
                          type="number"
                          min="0"
                          max="100"
                          step="0.000001"
                          required
                        />
                      </label>
                      <label>
                        Основание сверки
                        <input
                          name="note"
                          minLength={10}
                          maxLength={300}
                          required
                          placeholder="ID запроса или причина возврата резерва"
                        />
                      </label>
                      <Button busy={busy}>Завершить сверку</Button>
                    </>
                  )}
                </form>
              ))}
            </div>
          )}
        </>
      )}
      <Link className="text-link" to="/account">
        Вернуться в личный кабинет
      </Link>
    </section>
  );
}
