import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { requestNumber } from './RequestStats';

export default function RequestBalance({ generating }: { generating: boolean }) {
  const [data, setData] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true, loading = false;
    const load = async () => {
      if (loading || document.hidden) return;
      loading = true;
      try {
        const result = await api('/billing');
        if (active) { setData(result); setFailed(false); }
      } catch { if (active) setFailed(true); }
      finally { loading = false; }
    };
    void load();
    const refresh = () => { void load(); };
    const timer = setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [generating]);
  if (failed) return <div className="request-balance">Не удалось обновить остаток. <Link to="/billing">Проверить баланс</Link></div>;
  if (!data?.requests) return null;
  return (
    <div className="request-balance" aria-live="polite">
      {!data.enabled ? <p>Списания отключены — генерации пока не расходуют баланс.</p> : <>
        <p>Баланс: использовано {requestNumber(data.requests.wallet.used)} · остаток ≈ {requestNumber(data.requests.wallet.remainingEstimate)} текстовых запросов.</p>
        {data.plan && <p>Подписка: использовано {requestNumber(data.requests.plan.used)} · остаток ≈ {requestNumber(data.requests.plan.remainingEstimate)} текстовых запросов.</p>}
        <p>Картинки расходуют тот же остаток. {data.reserved > 0 && 'Часть кредитов зарезервирована.'}</p>
      </>}
      <Link to="/billing">Баланс и расход текста / картинок</Link>
    </div>
  );
}
