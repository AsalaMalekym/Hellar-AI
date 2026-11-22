import { useEffect, useState, type ReactNode } from 'react';
import { post } from '../api';
import { useApp } from '../context';
import Turnstile from './Turnstile';
import { Button, ErrorBox, Loading, Planet, Space } from './ui';
export default function CaptchaGate({ children }: { children: ReactNode }) {
  const { status, loading, statusError, refresh } = useApp();
  const [passed, setPassed] = useState(false),
    [token, setToken] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const invalidate = () => {
      setPassed(false);
      setToken('');
      setAttempt((x) => x + 1);
    };
    window.addEventListener('hellar:captcha-required', invalidate);
    return () => window.removeEventListener('hellar:captcha-required', invalidate);
  }, []);
  useEffect(() => {
    if (!passed) return;
    const timer = setTimeout(() => {
      setPassed(false);
      setToken('');
      setAttempt((x) => x + 1);
    }, 29 * 60000);
    return () => clearTimeout(timer);
  }, [passed]);
  if (loading || (!status && !statusError)) return <Loading text="Подключаемся к Hellar…" />;
  if (status && (!status.captchaRequired || passed)) return <>{children}</>;
  async function verify() {
    setBusy(true);
    setError('');
    try {
      await post('/security/challenge', { captchaToken: token });
      await refresh();
      setPassed(true);
    } catch (e) {
      setError((e as Error).message);
      setToken('');
      setAttempt((x) => x + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="captcha-gate">
      <Space />
      <section className="glass auth-card stack">
        <Planet mini />
        <p className="eyebrow">HELLAR AI</p>
        <h1>Проверка безопасности</h1>
        <p>Подтверди, что ты человек, чтобы открыть сайт.</p>
        <ErrorBox message={error || statusError} />
        {status?.captchaReady ? (
          <>
            <Turnstile
              key={attempt}
              siteKey={status.turnstileSiteKey}
              action="site_entry"
              onToken={setToken}
            />
            <Button busy={busy} disabled={!token} onClick={verify}>
              Продолжить
            </Button>
          </>
        ) : (
          <>
            <p>Проверка безопасности ещё настраивается. Попробуй позже.</p>
            <button className="btn" onClick={() => location.reload()}>
              Обновить страницу
            </button>
          </>
        )}
      </section>
    </main>
  );
}
