import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { Provider, useApp } from './context';
import Layout from './components/Layout';
import Home from './pages/Home';
import Auth from './pages/Auth';
import Setup from './pages/Setup';
import CaptchaGate from './components/CaptchaGate';
import Guard from './components/Guard';
import { Empty, Loading } from './components/ui';
const Billing = lazy(() => import('./pages/Billing'));
const Chat = lazy(() => import('./pages/Chat')),
  Images = lazy(() => import('./pages/Images')),
  Account = lazy(() => import('./pages/Account')),
  Admin = lazy(() => import('./pages/Admin'));
function About() {
  return (
    <div className="page-container narrow glass prose">
      <p className="eyebrow">HELLAR AI</p>
      <h1>О проекте</h1>
      <p>
        Cosmic Edition — личное пространство для разговоров и визуальных идей. Доступ только по
        приглашениям.
      </p>
      <h2>Прозрачно о данных</h2>
      <p>
        После подключения API текст сообщений и промпты передаются OpenAI. История, настройки и
        изображения хранятся на сервере приложения. Токены сессий доступны только серверу через
        HttpOnly cookie.
      </p>
      <p>
        Без ключа ИИ не генерирует ответы. Без почтового сервиса письма не отправляются. Пополнение и подписка доступны после подключения владельцем приёма платежей.
      </p>
      <h2>Закрытая бета</h2>
      <p>
        Функции ИИ становятся доступны после подключения владельцем сервиса. Доступ к моделям
        зависит от настроек проекта.
      </p>
      <Link className="text-link" to="/">
        Вернуться во вселенную →
      </Link>
    </div>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <Provider>
        <CaptchaGate>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                {(['login', 'register', 'forgot', 'reset', 'verify-email'] as const).map((mode) => (
                  <Route key={mode} path={mode} element={<Auth key={mode} mode={mode} />} />
                ))}
                <Route
                  path="chat"
                  element={
                    <Guard>
                      <Chat />
                    </Guard>
                  }
                />
                <Route
                  path="account"
                  element={
                    <Guard>
                      <Account />
                    </Guard>
                  }
                />
                <Route
                  path="admin"
                  element={
                    <Guard admin>
                      <Admin />
                    </Guard>
                  }
                />
                <Route
                  path="images"
                  element={
                    <Guard>
                      <Images />
                    </Guard>
                  }
                />
                <Route path="billing" element={<Guard><Billing /></Guard>} />
                <Route path="setup" element={<Setup />} />
                <Route path="about" element={<About />} />
                <Route
                  path="*"
                  element={
                    <Empty
                      title="Кажется, мы вышли за орбиту"
                      action={
                        <Link className="btn" to="/">
                          На главную
                        </Link>
                      }
                    >
                      Этой страницы нет. Координаты главной всё ещё на месте.
                    </Empty>
                  }
                />
              </Route>
            </Routes>
          </Suspense>
        </CaptchaGate>
      </Provider>
    </BrowserRouter>
  );
}
