import { useEffect, useRef, useState } from 'react';
import { ErrorBox } from './ui';
type Widget = {
  render: (node: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Widget;
  }
}
let pending: Promise<Widget> | undefined;
function load(): Promise<Widget> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (pending) return pending;
  pending = new Promise<Widget>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    const timer = window.setTimeout(() => {
      script.remove();
      reject(Error('Капча не загрузилась. Проверь соединение и повтори.'));
    }, 15000);
    script.onload = () => {
      clearTimeout(timer);
      window.turnstile ? resolve(window.turnstile) : reject(Error('Капча недоступна.'));
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(Error('Не удалось загрузить капчу. Проверь соединение.'));
    };
    document.head.append(script);
  }).catch((error) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
export default function Turnstile({
  siteKey,
  action,
  onToken,
}: {
  siteKey: string;
  action: string;
  onToken: (value: string) => void;
}) {
  const node = useRef<HTMLDivElement>(null),
    callback = useRef(onToken);
  callback.current = onToken;
  const [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false,
      id: string | undefined,
      api: Widget | undefined;
    callback.current('');
    setError('');
    void load()
      .then((widget) => {
        if (cancelled || !node.current) return;
        api = widget;
        id = widget.render(node.current, {
          sitekey: siteKey,
          action,
          theme: 'dark',
          language: 'ru',
          size: node.current.clientWidth < 300 ? 'compact' : 'flexible',
          callback: (value: string) => {
            setError('');
            callback.current(value);
          },
          'expired-callback': () => callback.current(''),
          'timeout-callback': () => {
            callback.current('');
            setError('Время проверки истекло. Повтори капчу.');
          },
          'error-callback': () => {
            callback.current('');
            setError('Не удалось пройти проверку. Попробуй ещё раз.');
          },
        });
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
      if (id !== undefined) api?.remove(id);
    };
  }, [siteKey, action, attempt]);
  return (
    <div className="captcha-widget">
      <div ref={node} />
      <ErrorBox message={error} />
      {error && (
        <button className="btn secondary" type="button" onClick={() => setAttempt((x) => x + 1)}>
          Повторить капчу
        </button>
      )}
    </div>
  );
}
