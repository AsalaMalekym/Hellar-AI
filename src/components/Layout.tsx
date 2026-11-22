import { useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import {
  Orbit,
  MessageSquare,
  Image,
  UserRound,
  Shield,
  Menu,
  X,
  ArrowUpRight,
  Home,
} from 'lucide-react';
import { Space } from './ui';
import { useApp } from '../context';
export default function Layout() {
  const { user, status } = useApp();
  const [open, setOpen] = useState(false);
  const nav = [
    { to: '/', label: 'Вселенная', Icon: Home },
    { to: '/chat', label: 'Hellar Chat', Icon: MessageSquare },
    { to: '/images', label: 'Hellar Images', Icon: Image },
    { to: '/account', label: 'Мой кабинет', Icon: UserRound },
  ];
  return (
    <>
      <Space />
      <div className="app-layout">
        <header className="site-header">
          <Link to="/" className="logo">
            <span>
              <Orbit size={26} />
            </span>
            <b>
              HELLAR <em>AI</em>
            </b>
            <small>COSMIC EDITION</small>
          </Link>
          <nav className="desktop-nav" aria-label="Основная навигация">
            {nav.slice(0, 3).map((n) => (
              <NavLink end={n.to === '/'} key={n.to} to={n.to}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <span className="beta-pill">PRIVATE BETA</span>
            <Link className="btn small" to={user ? '/account' : '/login'}>
              <span className="header-name">{user ? user.name : 'Войти'}</span>
              <ArrowUpRight size={15} />
            </Link>
            <button
              className="icon-btn menu-toggle"
              aria-label="Открыть меню"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </button>
          </div>
        </header>
        {open && (
          <div className="menu-backdrop" onClick={() => setOpen(false)}>
            <nav className="glass mobile-drawer" onClick={(e) => e.stopPropagation()}>
              <button
                className="icon-btn close"
                onClick={() => setOpen(false)}
                aria-label="Закрыть меню"
              >
                <X />
              </button>
              <h2>Твоя вселенная</h2>
              {nav.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setOpen(false)}>
                  <n.Icon size={20} />
                  {n.label}
                </NavLink>
              ))}
              {user?.role === 'admin' && (
                <NavLink to="/admin" onClick={() => setOpen(false)}>
                  <Shield size={20} />
                  Управление
                </NavLink>
              )}
            </nav>
          </div>
        )}
        <main id="main-content">
          <Outlet />
        </main>
        <footer className="site-footer">
          <span>
            HELLAR AI <i>✦</i> COSMIC EDITION
          </span>
          <span>Создавай за пределами привычного</span>
          <Link to="/about">О проекте и данных</Link>
        </footer>
        <nav className="bottom-nav" aria-label="Навигация телефона">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              <n.Icon size={19} />
              <span>{n.label.replace('Hellar ', '')}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </>
  );
}
