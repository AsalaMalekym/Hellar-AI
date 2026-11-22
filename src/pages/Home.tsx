import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  ArrowRight,
  Sparkles,
  MessageSquare,
  Image,
  ShieldCheck,
  Code2,
  PenLine,
  Lightbulb,
  Orbit,
} from 'lucide-react';
import { Planet } from '../components/ui';
import { useApp } from '../context';
export default function Home() {
  const { user, status } = useApp();
  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <i /> ТВОЯ ЛИЧНАЯ ИИ-ВСЕЛЕННАЯ
          </div>
          <h1>
            Мысли шире.
            <br />
            <span>Создавай без границ.</span>
          </h1>
          <p>
            От первой искры до большой идеи.
            <br />
            Общайся, исследуй и превращай воображение
            <br className="desktop-break" /> в изображения — в одной вселенной Hellar.
          </p>
          <div className="hero-buttons">
            <Link to={user ? '/chat' : '/register'} className="btn">
              {user ? 'Начать разговор' : 'Войти во вселенную'}
              <ArrowUpRight size={18} />
            </Link>
            <Link to="/images" className="text-link">
              Открыть студию <ArrowRight size={16} />
            </Link>
          </div>
          <div className="hero-caption">
            <ShieldCheck size={14} />
            Закрытое пространство · Только по приглашениям
          </div>
        </div>
        <div className="hero-visual">
          <Planet />
          <span className="coordinate coordinate-one">HELLAR SYSTEM / 01</span>
          <span className="coordinate coordinate-two">∞ ВОЗМОЖНОСТЕЙ</span>
          <span className="floating-label">
            <Sparkles size={14} />
            Воображение — твоя орбита
          </span>
        </div>
      </section>
      <section className="glass mission-panel">
        <div className="mission-heading">
          <div>
            <span className="eyebrow">ВЫБЕРИ СВОЮ ОРБИТУ</span>
            <h2>Большие идеи начинаются здесь.</h2>
          </div>
          <span className="status-pill">
            <i />
            {status?.chatReady ? 'ИИ подключён' : 'Ожидает настройки API'}
          </span>
        </div>
        <div className="mission-grid">
          <Link to="/chat" className="mission-card">
            <div className="feature-icon">
              <MessageSquare />
            </div>
            <span className="card-number">01 / ДИАЛОГИ</span>
            <h3>Hellar Chat</h3>
            <p>Собеседник с характером. Для сложных вопросов, свежих идей и простых разговоров.</p>
            <span className="card-link">
              Начать разговор
              <ArrowUpRight size={18} />
            </span>
            <div className="card-orbit" />
          </Link>
          <Link to="/images" className="mission-card image-card">
            <div className="feature-icon cyan">
              <Image />
            </div>
            <span className="card-number">02 / ВООБРАЖЕНИЕ</span>
            <h3>Hellar Images</h3>
            <p>Опиши то, чего ещё нет. Создай изображение и сохрани его в личной галерее.</p>
            <span className="card-link">
              Открыть студию
              <ArrowUpRight size={18} />
            </span>
            <div className="mini-galaxy" />
          </Link>
        </div>
        <div className="prompt-strip">
          <span>С чего начнём?</span>
          {[
            {
              Icon: Lightbulb,
              label: 'Придумать идею',
              text: 'Помоги придумать идею для нового проекта. Сначала задай уточняющие вопросы.',
            },
            {
              Icon: PenLine,
              label: 'Написать текст',
              text: 'Помоги написать текст. Сначала уточни тему, аудиторию и формат.',
            },
            {
              Icon: Code2,
              label: 'Разобраться с кодом',
              text: 'Помоги разобраться с кодом. Я пришлю задачу.',
            },
          ].map((p) => (
            <Link to={'/chat?prompt=' + encodeURIComponent(p.text)} key={p.label}>
              <p.Icon size={14} />
              {p.label}
              <ArrowUpRight size={12} />
            </Link>
          ))}
        </div>
      </section>
      <section className="home-footnote">
        <Orbit size={19} />
        <p>
          Твоя вселенная — твои правила.
          <br />
          <span>Личные диалоги, приватная галерея и спокойный фокус на главном.</span>
        </p>
        <Link to="/account">
          Мой кабинет <ArrowRight size={15} />
        </Link>
      </section>
    </div>
  );
}
