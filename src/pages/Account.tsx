import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  UserRound,
  LogOut,
  Shield,
  SlidersHorizontal,
  Trash2,
  Upload,
  MessageSquare,
  Image as ImageIcon,
} from 'lucide-react';
import { api, post, patch, remove, setCsrf } from '../api';
import { useApp } from '../context';
import { Button, ErrorBox, Modal } from '../components/ui';
export default function Account() {
  const { user, refresh, notify, status } = useApp(),
    navigate = useNavigate();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [sessions, setSessions] = useState<any[]>([]),
    [usage, setUsage] = useState<any>(null),
    [deleting, setDeleting] = useState(false),
    [avatarVersion, setAvatarVersion] = useState(0);
  async function load() {
    try {
      const [a, b] = await Promise.all([api('/profile/sessions'), api('/profile/usage')]);
      setSessions(a.sessions);
      setUsage(b);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await act(async () => {
      await patch('/profile', {
        name: f.get('name'),
        settings: { motion: f.get('motion') === 'on', style: f.get('style') },
      });
      await refresh();
      notify('Профиль сохранён');
    });
  }
  async function password(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      b = Object.fromEntries(new FormData(form));
    await act(async () => {
      const r = await post('/profile/password', b);
      setCsrf(r.csrf);
      await refresh();
      await load();
      form.reset();
      notify('Пароль обновлён. Другие сессии завершены');
    });
  }
  if (!user) return null;
  return (
    <section className="page-container">
      <p className="eyebrow">ТВОЯ ОРБИТА</p>
      <h1>Личный кабинет</h1>
      <ErrorBox message={error} />
      <p><Link className="btn secondary" to="/billing">Баланс и подписка</Link></p>
      <div className="profile-grid">
        <div>
          <div className="glass section-card profile-summary">
            <div className="avatar">
              {user.avatar ? (
                <img src={'/api/profile/avatar?v=' + avatarVersion} alt="Твой аватар" />
              ) : (
                <UserRound size={38} />
              )}
            </div>
            <h2>{user.name}</h2>
            <p className="muted">{user.email}</p>
            <span className="pill">
              {user.role === 'admin' ? 'Администратор' : 'Исследователь'}
            </span>
            <p className="fine muted">
              В Hellar с {new Date(user.created_at).toLocaleDateString('ru-RU')}
            </p>
            <label className="btn secondary upload-label">
              <Upload size={16} /> Загрузить аватар
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy || status?.avatarReady === false}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void act(async () => {
                      if (file.size > 2097152) throw Error('Максимум 2 МБ');
                      const body = new FormData();
                      body.append('avatar', file);
                      await api('/profile/avatar', { method: 'POST', body });
                      setAvatarVersion((v) => v + 1);
                      await refresh();
                      notify('Аватар обновлён');
                    });
                  e.target.value = '';
                }}
              />
            </label>
            <p className="fine muted">{status?.avatarReady === false ? 'Загрузка аватаров пока недоступна.' : 'PNG, JPEG, WebP · до 2 МБ'}</p>
            {user.avatar && (
              <button
                className="text-link"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await remove('/profile/avatar');
                    await refresh();
                  })
                }
              >
                Удалить аватар
              </button>
            )}
            <button
              className="btn secondary full"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await post('/auth/logout');
                  await refresh();
                  navigate('/');
                })
              }
            >
              <LogOut size={17} /> Выйти
            </button>
          </div>
          <div className="glass section-card">
            <h2>Твои открытия</h2>
            <Link className="stat-link" to="/chat">
              <MessageSquare size={19} /> Диалоги <strong>{usage?.chats ?? '—'}</strong>
            </Link>
            <Link className="stat-link" to="/images">
              <ImageIcon size={19} /> Изображения <strong>{usage?.images ?? '—'}</strong>
            </Link>
            <p className="fine muted">
              Сегодня: {usage?.usage.find((x: any) => x.kind === 'chat')?.count || 0} /{' '}
              {status?.limits.chat ?? '—'} текстовых запросов;{' '}
              {usage?.usage.find((x: any) => x.kind === 'image')?.count || 0} /{' '}
              {status?.limits.image ?? '—'} изображений. Сброс в 00:00 UTC.
            </p>
            {user.role === 'admin' && (
              <Link className="text-link" to="/admin">
                Управление доступом →
              </Link>
            )}
          </div>
        </div>
        <div>
          <div className="glass section-card">
            <h2>
              <SlidersHorizontal size={21} /> Профиль и интерфейс
            </h2>
            <form className="stack" onSubmit={save}>
              <label>
                Имя
                <input name="name" defaultValue={user.name} required minLength={2} maxLength={60} />
              </label>
              <label>
                Плотность чата
                <select name="style" defaultValue={user.settings.style || 'comfortable'}>
                  <option value="comfortable">Комфортная</option>
                  <option value="compact">Компактная</option>
                </select>
              </label>
              <label className="check-label">
                <input
                  name="motion"
                  type="checkbox"
                  defaultChecked={user.settings.motion !== false}
                />{' '}
                Космические анимации
              </label>
              <p className="fine muted">Системная настройка уменьшения движения имеет приоритет.</p>
              <Button busy={busy}>Сохранить изменения</Button>
            </form>
          </div>
          <div className="glass section-card">
            <h2>
              <Shield size={21} /> Безопасность
            </h2>
            <form className="stack" onSubmit={password}>
              <label>
                Текущий пароль
                <input
                  name="currentPassword"
                  type="password"
                  required
                  autoComplete="current-password"
                  maxLength={128}
                />
              </label>
              <label>
                Новый пароль
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Повтори новый пароль
                <input
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <Button className="secondary" busy={busy}>
                Изменить пароль
              </Button>
            </form>
          </div>
          <div className="glass section-card">
            <h2>Активные сессии</h2>
            <div className="record-list">
              {sessions.map((x) => (
                <div className="record" key={x.id}>
                  <div>
                    <strong>{x.current ? 'Это устройство' : 'Другое устройство'}</strong>
                    <small>{x.user_agent}</small>
                    <small>Вход: {new Date(x.created_at).toLocaleString('ru-RU')}</small>
                  </div>
                  {!x.current && (
                    <button
                      className="btn secondary"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          await remove('/profile/sessions/' + x.id);
                          await load();
                        })
                      }
                    >
                      Завершить
                    </button>
                  )}
                </div>
              ))}
            </div>
            <Button
              className="secondary"
              busy={busy}
              onClick={() =>
                act(async () => {
                  await post('/profile/sessions/revoke-others');
                  await load();
                  notify('Другие сессии завершены');
                })
              }
            >
              Завершить остальные
            </Button>
          </div>
          <div className="glass section-card danger-zone">
            <h2>Удаление аккаунта</h2>
            <p className="muted">
              Профиль, диалоги и изображения будут удалены без возможности восстановления.
            </p>
            {user.role === 'admin' ? (
              <p className="fine muted">
                Удаление администратора доступно оператору на сервере после передачи управления.
              </p>
            ) : (
              <Button className="danger" onClick={() => setDeleting(true)}>
                <Trash2 size={17} /> Удалить аккаунт
              </Button>
            )}
          </div>
        </div>
      </div>
      {deleting && (
        <Modal title="Удалить аккаунт навсегда?" onClose={() => setDeleting(false)}>
          <ErrorBox message={error} />
      <p><Link className="btn secondary" to="/billing">Баланс и подписка</Link></p>
          <p>Все твои чаты и изображения будут удалены. Введи пароль и слово УДАЛИТЬ.</p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const b = Object.fromEntries(new FormData(e.currentTarget));
              void act(async () => {
                await remove('/profile', b);
                await refresh();
                navigate('/');
              });
            }}
          >
            <label>
              Пароль
              <input
                type="password"
                name="password"
                required
                maxLength={128}
                autoComplete="current-password"
              />
            </label>
            <label>
              Подтверждение
              <input name="confirmation" required pattern="УДАЛИТЬ" autoComplete="off" />
            </label>
            <Button busy={busy} className="danger">
              Удалить безвозвратно
            </Button>
          </form>
        </Modal>
      )}
    </section>
  );
}
