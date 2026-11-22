import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { post, setCsrf } from '../api';
import { useApp } from '../context';
import Turnstile from '../components/Turnstile';
import { Button, ErrorBox, Loading, Planet } from '../components/ui';
export default function Auth({
  mode,
}: {
  mode: 'login' | 'register' | 'forgot' | 'reset' | 'verify-email';
}) {
  const { user, loading, refresh, status, emailLinkToken } = useApp(),
    navigate = useNavigate();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(''),
    [captchaToken, setCaptchaToken] = useState(''),
    [captchaAttempt, setCaptchaAttempt] = useState(0);
  const isLink = mode === 'reset' || mode === 'verify-email';
  const needsCaptcha = (mode === 'register' || mode === 'forgot') && !!status?.captchaRequired;
  const titles = {
    login: 'С возвращением',
    register: 'Твоя вселенная ждёт',
    forgot: 'Вернём доступ',
    reset: 'Новый пароль',
    'verify-email': 'Подтверди почту и задай пароль',
  };
  if (loading) return <Loading />;
  if (user && (mode === 'login' || mode === 'register')) return <Navigate to="/chat" replace />;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const b = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (isLink) b.token = emailLinkToken;
      if (needsCaptcha) b.captchaToken = captchaToken;
      const r = await post('/auth/' + mode, b);
      if (r.csrf) setCsrf(r.csrf);
      if (mode === 'forgot' || mode === 'register') setDone(r.message);
      else if (mode === 'reset') {
        history.replaceState(null, '', location.pathname);
        await refresh();
        setDone('Пароль обновлён. Теперь можно войти.');
      } else {
        await refresh();
        navigate('/chat');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (needsCaptcha) {
        setCaptchaToken('');
        setCaptchaAttempt((x) => x + 1);
      }
    }
  }
  return (
    <section className="auth-page">
      <div className="auth-intro">
        <Planet mini />
        <p className="eyebrow">HELLAR • ACCESS</p>
        <h1>{titles[mode]}</h1>
        <p>
          Одно пространство для мыслей,
          <br />
          идей и новых открытий.
        </p>
        <span className="subtle">
          <ShieldCheck size={16} /> Закрытая бета по приглашениям
        </span>
      </div>
      <div className="glass auth-card">
        <h2>
          {mode === 'login'
            ? 'Вход в аккаунт'
            : mode === 'register'
              ? 'Создать аккаунт'
              : titles[mode]}
        </h2>
        <ErrorBox message={error} />
        {done ? (
          <div className="success-box" role="status">
            <p>{done}</p>
            <Link className="text-link" to="/login">
              Перейти ко входу
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="stack">
            {mode === 'register' && (
              <>
                <label>
                  Имя
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={60}
                    autoComplete="nickname"
                    placeholder="Как тебя называть"
                  />
                </label>
                <label>
                  Код приглашения
                  <input
                    name="invitation"
                    required
                    minLength={20}
                    maxLength={150}
                    autoComplete="off"
                    placeholder="Код от администратора"
                  />
                </label>
              </>
            )}
            {!isLink && (
              <label>
                Электронная почта
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </label>
            )}
            {(mode === 'login' || isLink) && (
              <label>
                Пароль
                <input
                  name="password"
                  type="password"
                  required
                  minLength={mode === 'login' ? 1 : 12}
                  maxLength={128}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder={mode === 'login' ? 'Твой пароль' : 'Не менее 12 символов'}
                />
              </label>
            )}
            {isLink && (
              <label>
                Повтори пароль
                <input
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
            )}
            {(mode === 'forgot' || mode === 'register') && status && !status.mailReady && (
              <p className="notice">
                Почтовая отправка пока не настроена владельцем. Письмо сейчас отправить не
                получится.
              </p>
            )}
            {mode === 'register' && (
              <p className="notice">
                Сначала подтвердим твою почту. Пароль ты задашь по ссылке из письма. Аккаунт
                появится только после этого.
              </p>
            )}
            {isLink && !emailLinkToken && (
              <ErrorBox message="Ссылка неполная. Открой её заново из письма или запроси новое письмо." />
            )}
            {needsCaptcha && status && (
              <Turnstile
                key={captchaAttempt}
                siteKey={status.turnstileSiteKey}
                action={mode}
                onToken={setCaptchaToken}
              />
            )}
            <Button
              busy={busy}
              disabled={
                (needsCaptcha && !captchaToken) ||
                (isLink && !emailLinkToken) ||
                ((mode === 'register' || mode === 'forgot') && !status?.mailReady)
              }
            >
              {mode === 'login'
                ? 'Войти'
                : mode === 'register'
                  ? 'Подтвердить почту'
                  : mode === 'forgot'
                    ? 'Получить ссылку'
                    : mode === 'verify-email'
                      ? 'Создать аккаунт'
                      : 'Сохранить пароль'}
            </Button>
          </form>
        )}
        <div className="auth-links">
          {mode === 'login' ? (
            <>
              <Link to="/forgot">Забыл пароль?</Link>
              <Link to="/register">Есть приглашение</Link>
            </>
          ) : (
            <Link to="/login">Уже есть аккаунт? Войти</Link>
          )}
        </div>
      </div>
    </section>
  );
}
