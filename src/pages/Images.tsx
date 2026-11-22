import { useEffect, useState, useRef } from 'react';
import {
  Sparkles,
  Download,
  Trash2,
  RotateCcw,
  Expand,
  Image as ImageIcon,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { api, post, remove } from '../api';
import { useApp } from '../context';
import { Button, Empty, ErrorBox, Loading, Modal } from '../components/ui';
import RequestBalance from '../components/RequestBalance';
type Job = {
  id: string;
  prompt: string;
  model: string;
  size: string;
  status: string;
  error: string | null;
  width: number;
  height: number;
  created_at: number;
};
const ratios = ['1:1', '9:16', '16:9'];
export function sizeFor(ratio: string, sizes: string[]) {
  const [a, b] = ratio.split(':').map(Number);
  return sizes.find((s) => {
    const [w, h] = s.split('x').map(Number);
    return Math.abs(w / h - a / b) < 0.001;
  });
}
export default function Images() {
  const { status, notify } = useApp();
  const [prompt, setPrompt] = useState(''),
    [ratio, setRatio] = useState('1:1'),
    [jobs, setJobs] = useState<Job[]>([]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [view, setView] = useState<Job | null>(null),
    [deleting, setDeleting] = useState<Job | null>(null),
    [more, setMore] = useState(false);
  const mounted = useRef(true);
  const size = sizeFor(ratio, status?.imageSizes || []);
  async function load(append = false) {
    const r = await api('/images' + (append ? '?offset=' + jobs.length : ''));
    if (mounted.current) {
      setJobs(append ? (prev) => [...prev, ...r.images] : r.images);
      setMore(r.more);
      setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    load().catch((e) => {
      setError(e.message);
      setLoading(false);
    });
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!jobs.some((j) => j.status === 'pending')) return;
    const interval = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(interval);
  }, [jobs.some((j) => j.status === 'pending')]);
  async function generate(text = prompt, chosen = size) {
    if (busy) return;
    if (!chosen) {
      setError(
        'Этот формат не поддерживается настроенной моделью. Выбери предложенный вариант ниже.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await post('/images', { prompt: text, size: chosen });
      if (mounted.current) {
        await load();
        setView(result.image);
        notify('Изображение готово');
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        await load().catch(() => {});
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const suggestion = ratio === '9:16' ? '2:3' : '3:2';
  return (
    <section className="page-container images-page">
      <div className="studio-heading">
        <div>
          <p className="eyebrow">HELLAR • CREATIVE SPACE</p>
          <h1>Воображение без границ</h1>
          <p className="muted">Преврати свою идею в новую вселенную.</p>
        </div>
        <span className="pill">
          <Sparkles size={13} /> {status?.imageModel || 'Hellar Images'}
        </span>
      </div>
      <div className="studio-grid">
        <aside className="glass section-card studio-controls">
          <RequestBalance generating={busy} />
          <h2>
            <Sparkles size={20} /> Твоя идея
          </h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void generate();
            }}
          >
            <label>
              Опиши изображение
              <textarea
                aria-label="Промпт изображения"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                required
                minLength={3}
                maxLength={4000}
                rows={7}
                placeholder="Одинокий исследователь на краю фиолетовой планеты, далёкие туманности, кинематографичный свет…"
              />
            </label>
            <div className="fine muted prompt-count">{prompt.length} / 4 000</div>
            <fieldset className="ratio-field">
              <legend>Соотношение сторон</legend>
              <div className="ratio-options">
                {ratios.map((r) => (
                  <button
                    type="button"
                    key={r}
                    className={'ratio-option ' + (ratio === r ? 'active' : '')}
                    aria-pressed={ratio === r}
                    onClick={() => setRatio(r)}
                  >
                    <span className={'ratio-shape ratio-' + r.replace(':', '-')} />
                    {r}
                  </button>
                ))}
              </div>
            </fieldset>
            {!size && status && (
              <div className="notice">
                Точный формат {ratio} не поддерживается этой конфигурацией модели.
                {sizeFor(suggestion, status.imageSizes) && (
                  <button type="button" className="text-link" onClick={() => setRatio(suggestion)}>
                    Использовать {suggestion} →
                  </button>
                )}
              </div>
            )}
            {size && (
              <p className="fine muted">
                {ratio} · {size.replace('x', ' × ')} пикселей
              </p>
            )}
            {!ratios.includes(ratio) && (
              <span className="pill">Выбран поддерживаемый формат {ratio}</span>
            )}
            <ErrorBox message={error} />
            {status && !status.imageReady && (
              <p className="setup-notice">
                Генерация пока не подключена. Для создания изображений требуется серверный API-ключ.
              </p>
            )}
            <Button busy={busy} disabled={!prompt.trim() || !size}>
              <Sparkles size={18} /> {busy ? 'Создаём вселенную…' : 'Создать изображение'}
            </Button>
          </form>
          <div className="studio-tips">
            <p className="eyebrow">ДОБАВЬ ДЕТАЛИ</p>
            <p>
              Объект → окружение → свет → стиль. Чем точнее идея, тем ближе результат к твоему
              замыслу.
            </p>
            <span className="fine muted">
              Одна генерация — одно изображение. Лимит: {status?.limits.image ?? '—'} в день.
            </span>
          </div>
        </aside>
        <div className="studio-gallery">
          <div className="gallery-title">
            <h2>
              Твои миры <span>{jobs.length}</span>
            </h2>
            <span className="fine muted">Приватная галерея</span>
          </div>
          {busy && (
            <div className="glass image-progress">
              <div className="orbit-loader">
                <i />
                <Sparkles size={24} />
              </div>
              <h3>Собираем свет и детали</h3>
              <p>Можно остаться здесь или вернуться в галерею позже.</p>
            </div>
          )}
          {loading ? (
            <Loading />
          ) : !jobs.length && !busy ? (
            <div className="glass gallery-empty">
              <Empty title="Твоя галерея начинается здесь">
                Опиши первый мир. Здесь сохранятся изображения и история твоих идей.
              </Empty>
              <div className="empty-grid-decoration" aria-hidden="true">
                <div />
                <div />
                <div />
              </div>
            </div>
          ) : (
            <div className="image-grid">
              {jobs.map((j) => (
                <article className="glass image-card" key={j.id}>
                  {j.status === 'complete' ? (
                    <button
                      className="image-preview"
                      aria-label="Открыть изображение: полноэкранный просмотр"
                      onClick={() => setView(j)}
                    >
                      <img src={'/api/images/' + j.id + '/file'} alt={j.prompt} loading="lazy" />
                      <span>
                        <Expand size={17} />
                      </span>
                    </button>
                  ) : (
                    <div className="image-placeholder">
                      {j.status === 'pending' ? (
                        <Loading text="Изображение создаётся…" />
                      ) : (
                        <>
                          <ImageIcon size={28} />
                          <p>{j.error || 'Генерация прервана.'}</p>
                        </>
                      )}
                    </div>
                  )}
                  <div className="image-info">
                    <p title={j.prompt}>{j.prompt}</p>
                    <small>
                      {new Date(j.created_at).toLocaleDateString('ru-RU')} ·{' '}
                      {j.size.replace('x', ' × ')}
                    </small>
                    <div className="image-actions">
                      {j.status === 'complete' && (
                        <a
                          className="icon-btn"
                          aria-label="Скачать изображение"
                          href={'/api/images/' + j.id + '/file?download=1'}
                          download
                        >
                          <Download size={17} />
                        </a>
                      )}
                      <button
                        className="icon-btn"
                        aria-label="Повторить этот промпт"
                        disabled={busy || j.status === 'pending'}
                        onClick={() => {
                          setPrompt(j.prompt);
                          void generate(j.prompt, j.size);
                        }}
                      >
                        <RotateCcw size={17} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="Удалить изображение"
                        onClick={() => setDeleting(j)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {more && (
            <Button
              className="secondary full"
              onClick={() => load(true).catch((e) => setError(e.message))}
            >
              Показать ещё
            </Button>
          )}
        </div>
      </div>
      {view && (
        <Modal title="Твой новый мир" onClose={() => setView(null)}>
          <div className="lightbox">
            <img src={'/api/images/' + view.id + '/file'} alt={view.prompt} />
            <p>{view.prompt}</p>
            <p className="fine muted">
              {view.width} × {view.height} · {view.model}
            </p>
            <a className="btn" href={'/api/images/' + view.id + '/file?download=1'} download>
              <Download size={18} /> Скачать PNG
            </a>
          </div>
        </Modal>
      )}
      {deleting && (
        <Modal title="Удалить результат?" onClose={() => setDeleting(null)}>
          <p>Изображение и запись промпта будут удалены без возможности восстановления.</p>
          <Button
            className="danger"
            onClick={async () => {
              try {
                await remove('/images/' + deleting.id);
                setDeleting(null);
                await load();
                notify('Результат удалён');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Удалить
          </Button>
        </Modal>
      )}
    </section>
  );
}
