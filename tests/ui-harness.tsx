/* Isolated visual-test fixtures. Not imported by the production entry point.
 * No network calls, sessions, real users, AI responses or authentication bypass.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Provider } from '../src/context';
import Layout from '../src/components/Layout';
import Home from '../src/pages/Home';
import Auth from '../src/pages/Auth';
import Chat from '../src/pages/Chat';
import Images from '../src/pages/Images';
import Account from '../src/pages/Account';
import Admin from '../src/pages/Admin';
import Billing from '../src/pages/Billing';
import '../src/styles.css';
let user = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Исследователь',
  email: 'visual-test@example.test',
  role: 'admin',
  created_at: 1794096000000,
  avatar: false,
  settings: { motion: false, style: 'comfortable' },
};
const chat = {
  id: '00000000-0000-4000-8000-000000000002',
  title: 'Проверка истории и Markdown',
  model: 'gpt-4.1-mini',
  system_prompt: '',
};
window.fetch = async (input, options) => {
  const url = String(input).split('?')[0];
  const route = new URLSearchParams(location.search).get('route') || '/';
  let data: any;
  if (url === '/api/auth/me')
    data = {
      user: route === '/login' || route === '/register' ? null : user,
      csrf: 'visual-fixture-not-a-session',
    };
  else if (url === '/api/status')
    data = {
      chatReady: false,
      imageReady: false,
      mailReady: false,
      chatModels: ['gpt-4.1-mini'],
      imageModel: 'gpt-image-2.5-flare',
      imageSizes: ['1024x1024', '1024x1536', '1536x1024'],
      limits: { chat: 100, image: 10 },
      version: 'UI test',
    };
  else if (url === '/api/billing') data = {
    enabled: true, test: true, paymentsReady: true, fxKopecks: 10000,
    wallet: 900000, reserved: 0, price:12000000, allowance:12000000,
    planRubKopecks:120000, plan:{remaining:11600000,granted:12000000,expiresAt:Date.now()+86400000*20},
    requests:{model:'gpt-4.1-mini',costMicro:4000,per100Rub:250,planEstimate:3000,totalUsed:117,
      wallet:{used:17,chat:15,image:2,remainingEstimate:225},
      plan:{used:100,chat:95,image:5,remainingEstimate:2900}},
    rates:{'gpt-4.1-mini':{input:.4,cached:.1,output:1.6},'gpt-image-2.5-flare':{input:5,cached:1.25,output:30}},
    ledger:[],orders:[],
  };
  else if (url === '/api/admin/billing') data={holds:[]};
  else if (url === '/api/chats') data = { chats: [chat] };
  else if (url === '/api/chats/' + chat.id)
    data = {
      chat,
      messages: [
        {
          id: '1',
          role: 'user',
          content: 'Тестовое сообщение для проверки вёрстки.',
          status: 'complete',
        },
        {
          id: '2',
          role: 'assistant',
          content:
            '**Тестовая фикстура интерфейса.** Это не ответ модели.\n\n- История сохраняет порядок\n- Код можно прочитать на телефоне\n\n```typescript\nconst universe = { name: "Hellar", edition: "Cosmic" };\nconsole.log(universe);\n```',
          status: 'complete',
        },
      ],
    };
  else if (url === '/api/images') data = { images: [], more: false };
  else if (url === '/api/profile/sessions')
    data = {
      sessions: [
        {
          id: 'test-session',
          current: true,
          created_at: 1794096000000,
          user_agent: 'Visual test browser',
        },
      ],
    };
  else if (url === '/api/profile/usage') data = { usage: [], chats: 1, images: 0 };
  else if (url === '/api/profile' && options?.method === 'PATCH') {
    user = { ...user, ...JSON.parse(String(options.body)) };
    data = { user };
  } else if (url === '/api/admin/users') data = { users: [user] };
  else if (url === '/api/admin/invitations') data = { invitations: [] };
  else
    return new Response(
      JSON.stringify({
        error: 'UI QA: действие не выполняется. Это изолированная тестовая фикстура.',
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
};
const route = new URLSearchParams(location.search).get('route') || '/';
createRoot(document.getElementById('root')!).render(
  <>
    <div
      style={{
        position: 'fixed',
        zIndex: 200,
        bottom: 0,
        left: 0,
        padding: '3px 10px',
        background: '#342049',
        color: '#e1caff',
        font: '10px monospace',
        pointerEvents: 'none',
      }}
    >
      UI QA · изолированные тестовые данные · не ответ ИИ
    </div>
    <MemoryRouter initialEntries={[route]}>
      <Provider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="login" element={<Auth mode="login" />} />
            <Route path="register" element={<Auth mode="register" />} />
            <Route path="chat" element={<Chat />} />
            <Route path="images" element={<Images />} />
            <Route path="account" element={<Account />} />
            <Route path="admin" element={<Admin />} />
            <Route path="billing" element={<Billing />} />
          </Route>
        </Routes>
      </Provider>
    </MemoryRouter>
  </>,
);
