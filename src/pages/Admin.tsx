import { useEffect, useState, type FormEvent } from 'react';
import { Copy, KeyRound, Users, ShieldCheck } from 'lucide-react';
import { api, post, patch, remove } from '../api';
import { useApp } from '../context';
import { Button, ErrorBox, Loading } from '../components/ui';
export default function Admin() {
  const { notify, user } = useApp();
  const [invitations, setInvitations] = useState<any[]>([]),
    [users, setUsers] = useState<any[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [code, setCode] = useState('');
  async function load() {
    try {
      const [a, b] = await Promise.all([api('/admin/invitations'), api('/admin/users')]);
      setInvitations(a.invitations);
      setUsers(b.users);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function act(fn: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await act(async () => {
      const r = await post('/admin/invitations', {
        label: f.get('label'),
        days: Number(f.get('days')),
      });
      setCode(r.code);
    });
  }
  return (
    <section className="page-container">
      <p className="eyebrow">MISSION CONTROL</p>
      <h1>Управление доступом</h1>
      <p className="muted">Приглашай людей в Hellar и управляй закрытой бетой.</p>
      <ErrorBox message={error} />
      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="glass section-card">
            <h2>
              <KeyRound size={21} /> Новое приглашение
            </h2>
            <form className="inline-form" onSubmit={create}>
              <label>
                Подпись
                <input name="label" maxLength={80} placeholder="Например, для друга" />
              </label>
              <label>
                Срок действия
                <select name="days">
                  <option value="7">7 дней</option>
                  <option value="1">1 день</option>
                  <option value="30">30 дней</option>
                </select>
              </label>
              <Button busy={busy}>Создать код</Button>
            </form>
            {code && (
              <div className="code-box">
                <p>Код показывается только сейчас. Передай его получателю лично.</p>
                <code>{code}</code>
                <button
                  className="btn secondary"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(code)
                      .then(() => notify('Код скопирован'))
                      .catch(() => notify('Выдели и скопируй код вручную'))
                  }
                >
                  <Copy size={16} /> Скопировать
                </button>
              </div>
            )}
          </div>
          <div className="glass section-card">
            <h2>
              <KeyRound size={21} /> Приглашения
            </h2>
            {!invitations.length ? (
              <p className="muted">Приглашений пока нет.</p>
            ) : (
              <div className="record-list">
                {invitations.map((i) => (
                  <div className="record" key={i.id}>
                    <div>
                      <strong>{i.label || 'Без подписи'}</strong>
                      <small>
                        {i.used_at
                          ? 'Использовано: ' + (i.used_email || 'аккаунт удалён')
                          : i.revoked
                            ? 'Отозвано'
                            : i.expires_at < Date.now()
                              ? 'Срок истёк'
                              : 'До ' + new Date(i.expires_at).toLocaleDateString('ru-RU')}
                      </small>
                    </div>
                    {!i.used_at && !i.revoked && i.expires_at > Date.now() && (
                      <button
                        disabled={busy}
                        className="btn secondary"
                        onClick={() => act(() => remove('/admin/invitations/' + i.id))}
                      >
                        Отозвать
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="glass section-card">
            <h2>
              <Users size={21} /> Пользователи
            </h2>
            <div className="record-list">
              {users.map((u) => (
                <div className="record" key={u.id}>
                  <div>
                    <strong>
                      {u.name} {u.role === 'admin' && <ShieldCheck size={15} />}
                    </strong>
                    <small>{u.email}</small>
                    <small>
                      {u.blocked ? 'Доступ заблокирован' : 'Активен'} ·{' '}
                      {new Date(u.created_at).toLocaleDateString('ru-RU')}
                    </small>
                  </div>
                  {u.role !== 'admin' && u.id !== user?.id && (
                    <button
                      disabled={busy}
                      className="btn secondary"
                      onClick={() =>
                        act(() => patch('/admin/users/' + u.id, { blocked: !u.blocked }))
                      }
                    >
                      {u.blocked ? 'Разблокировать' : 'Заблокировать'}
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="muted fine">Показаны до 500 последних записей.</p>
          </div>
        </>
      )}
    </section>
  );
}
