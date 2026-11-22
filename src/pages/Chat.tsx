import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  Send,
  Square,
  Copy,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  X,
} from 'lucide-react';
import { api, post, patch, remove, csrfHeaders } from '../api';
import { useApp } from '../context';
import { Button, ErrorBox, Empty, Loading, Modal } from '../components/ui';
import Markdown from '../components/Markdown';
import { readEvents } from '../stream';
type ChatRow = { id: string; title: string; model: string; system_prompt: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; status: string };
export default function Chat() {
  const { status, notify, user } = useApp();
  const [params, setParams] = useSearchParams();
  const [chats, setChats] = useState<ChatRow[]>([]),
    [chat, setChat] = useState<ChatRow | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [text, setText] = useState(params.get('prompt') || ''),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [sidebar, setSidebar] = useState(false),
    [settings, setSettings] = useState(false),
    [deleting, setDeleting] = useState(false);
  const controller = useRef<AbortController | null>(null),
    panel = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    request = useRef(0),
    searchRequest = useRef(0);
  const selectedId = params.get('id');
  async function list() {
    const seq = ++searchRequest.current;
    const r = await api('/chats?q=' + encodeURIComponent(query));
    if (seq === searchRequest.current) setChats(r.chats);
  }
  async function load(id: string) {
    const seq = ++request.current;
    setLoading(true);
    setError('');
    try {
      const r = await api('/chats/' + id);
      if (seq === request.current) {
        setChat(r.chat);
        setMessages(r.messages);
        follow.current = true;
      }
    } catch (e) {
      if (seq === request.current) setError((e as Error).message);
    } finally {
      if (seq === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    return () => {
      request.current++;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => list().catch((e) => setError(e.message)), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (busy) return;
    if (selectedId && selectedId !== chat?.id) void load(selectedId);
    else if (!selectedId && chat) {
      request.current++;
      setChat(null);
      setMessages([]);
    }
  }, [selectedId, busy]);
  useEffect(() => {
    if (follow.current && panel.current) panel.current.scrollTop = panel.current.scrollHeight;
  }, [messages, loading]);
  async function choose(c: ChatRow) {
    if (busy) return;
    setSidebar(false);
    setParams({ id: c.id });
  }
  function fresh() {
    if (busy) return;
    request.current++;
    setChat(null);
    setMessages([]);
    setError('');
    setParams({});
    setSidebar(false);
    setText('');
  }
  async function send(regenerate = false) {
    if (busy || controller.current || (!regenerate && !text.trim())) return;
    const content = text.trim();
    setBusy(true);
    setError('');
    follow.current = true;
    let current = chat;
    let accepted = false;
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (!current) {
        const r = await post('/chats', { model: status?.chatModels[0] });
        current = r.chat;
        setChat(current);
        setParams({ id: current!.id });
        await list();
      }
      const response = await fetch('/api/chats/' + current!.id + '/generate', {
        method: 'POST',
        headers: csrfHeaders(),
        credentials: 'same-origin',
        signal: abort.signal,
        body: JSON.stringify(regenerate ? { regenerate: true } : { content }),
      });
      if (!response.ok) {
        const r = await response.json();
        throw Error(r.error || 'Ошибка генерации');
      }
      if (!response.body) throw Error('Браузер не поддерживает потоковый ответ');
      accepted = true;
      setText('');
      let finished = false;
      await readEvents(response.body, ({ event, data }) => {
        if (event === 'start')
          setMessages((prev) => {
            const base = regenerate && prev.at(-1)?.role === 'assistant' ? prev.slice(0, -1) : prev;
            return [
              ...base,
              ...(regenerate
                ? []
                : [{ id: 'outgoing', role: 'user' as const, content, status: 'complete' }]),
              { id: data.id, role: 'assistant', content: '', status: 'streaming' },
            ];
          });
        if (event === 'delta')
          setMessages((prev) =>
            prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: m.content + data.text } : m,
            ),
          );
        if (event === 'error') {
          setError(data.message);
          finished = true;
        }
        if (event === 'done') finished = true;
      });
      if (!finished)
        throw Error('Соединение прервалось. Сохранённую часть ответа можно открыть повторно.');
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
    } finally {
      controller.current = null;
      if (current && accepted) {
        try {
          const r = await api('/chats/' + current.id);
          setChat(r.chat);
          setMessages(r.messages);
          await list();
        } catch {}
      }
      setBusy(false);
    }
  }
  async function stop() {
    controller.current?.abort();
    if (chat)
      try {
        await post('/chats/' + chat.id + '/stop');
      } catch (e) {
        setError((e as Error).message);
      }
  }
  async function saveSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!chat) return;
    const b = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await patch('/chats/' + chat.id, b);
      setChat({ ...chat, ...b } as ChatRow);
      setSettings(false);
      await list();
      notify('Настройки диалога сохранены');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div
      className={
        'workspace chat-workspace ' + (user?.settings.style === 'compact' ? 'compact' : '')
      }
    >
      <aside className={'glass chat-sidebar ' + (sidebar ? 'open' : '')}>
        <div className="sidebar-heading">
          <span>Твои диалоги</span>
          <button
            className="icon-btn mobile-only"
            aria-label="Закрыть историю"
            onClick={() => setSidebar(false)}
          >
            <X size={20} />
          </button>
        </div>
        <button className="btn full" onClick={fresh} disabled={busy}>
          <Plus size={18} /> Новый диалог
        </button>
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Поиск по названиям чатов"
            placeholder="Найти диалог…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="chat-list">
          {chats.map((c) => (
            <button
              disabled={busy}
              key={c.id}
              className={'chat-item ' + (chat?.id === c.id ? 'selected' : '')}
              onClick={() => choose(c)}
            >
              <MessageSquare size={16} />
              <span>{c.title}</span>
            </button>
          ))}
          {!chats.length && <p className="fine muted">Здесь появятся твои разговоры.</p>}
        </div>
        <div className="sidebar-bottom">
          <span className="live-dot" /> Приватная история
          <p>Видна только тебе · до 200 последних диалогов</p>
        </div>
      </aside>
      {sidebar && (
        <button
          className="sidebar-overlay"
          aria-label="Закрыть историю"
          onClick={() => setSidebar(false)}
        />
      )}
      <section className="glass chat-main">
        <header className="chat-top">
          <button
            className="icon-btn mobile-only"
            aria-label="Открыть историю"
            onClick={() => setSidebar(true)}
          >
            <PanelLeftOpen size={21} />
          </button>
          <div>
            <h1>{chat?.title || 'Hellar Chat'}</h1>
            <span className="fine muted">
              {chat?.model || status?.chatModels[0] || 'Текстовый интеллект'}
            </span>
          </div>
          {chat && (
            <button
              className="icon-btn"
              aria-label="Настройки диалога"
              disabled={busy}
              onClick={() => setSettings(true)}
            >
              <SlidersHorizontal size={19} />
            </button>
          )}
        </header>
        <div
          className="messages"
          ref={panel}
          onScroll={() => {
            if (panel.current)
              follow.current =
                panel.current.scrollHeight - panel.current.scrollTop - panel.current.clientHeight <
                100;
          }}
        >
          {loading ? (
            <Loading />
          ) : !messages.length ? (
            <div className="chat-welcome">
              <Empty title="С чего начнём исследование?">
                Разберём сложную тему, напишем текст или найдём новую идею.
              </Empty>
              <div className="starter-prompts">
                {[
                  'Помоги составить план проекта',
                  'Объясни сложное простыми словами',
                  'Придумай необычную историю',
                ].map((s) => (
                  <button key={s} onClick={() => setText(s)}>
                    {s} <Sparkles size={15} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <article className={'message ' + m.role} key={m.id}>
                <div className="message-symbol">
                  {m.role === 'assistant' ? <Sparkles size={16} /> : user?.name[0]}
                </div>
                <div className="message-body">
                  <div className="message-label">
                    {m.role === 'assistant' ? 'Hellar AI' : 'Ты'}
                    {m.status === 'interrupted' && <span> · остановлено</span>}
                    {m.status === 'error' && <span> · ошибка генерации</span>}
                  </div>
                  {m.content ? (
                    <Markdown text={m.content} />
                  ) : m.status === 'streaming' ? (
                    <div className="thinking" role="status" aria-label="ИИ готовит ответ">
                      <i />
                      <i />
                      <i />
                    </div>
                  ) : (
                    <p className="muted">Ответ не получен. Можно повторить запрос.</p>
                  )}
                  {m.role === 'assistant' && (
                    <div className="message-actions">
                      <button
                        className="icon-btn"
                        aria-label="Скопировать ответ"
                        disabled={!m.content}
                        onClick={() =>
                          navigator.clipboard
                            .writeText(m.content)
                            .then(() => notify('Ответ скопирован'))
                            .catch(() => notify('Не удалось скопировать. Выдели текст вручную'))
                        }
                      >
                        <Copy size={15} />
                      </button>
                      {i === messages.length - 1 && (
                        <button
                          className="icon-btn"
                          aria-label="Повторить генерацию"
                          disabled={busy}
                          onClick={() => send(true)}
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
        <div className="composer-area">
          <ErrorBox message={error} />
          {status && !status.chatReady && (
            <div className="setup-notice">
              ИИ ещё не подключён. Для ответов владелец должен настроить серверный API-ключ.
            </div>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              aria-label="Сообщение"
              placeholder="Отправь мысль во вселенную…"
              value={text}
              maxLength={12000}
              rows={2}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  matchMedia('(pointer:fine)').matches
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            {busy ? (
              <button
                className="send-btn stop"
                type="button"
                aria-label="Остановить генерацию"
                onClick={stop}
              >
                <Square size={19} />
              </button>
            ) : (
              <button
                className="send-btn"
                aria-label="Отправить сообщение"
                disabled={!text.trim() || loading}
              >
                <Send size={19} />
              </button>
            )}
          </form>
          <p className="composer-note">
            ИИ может ошибаться. Проверяй важные ответы. <span>{text.length} / 12 000</span>
          </p>
        </div>
      </section>
      {settings && chat && (
        <Modal title="Настройки диалога" onClose={() => setSettings(false)}>
          <ErrorBox message={error} />
          <form className="stack" onSubmit={saveSettings}>
            <label>
              Название
              <input name="title" defaultValue={chat.title} maxLength={100} required />
            </label>
            <label>
              Модель
              <select name="model" defaultValue={chat.model}>
                {status?.chatModels.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label>
              Системные инструкции
              <textarea
                name="system_prompt"
                defaultValue={chat.system_prompt}
                maxLength={4000}
                rows={5}
                placeholder="Например: отвечай кратко, с примерами"
              />
            </label>
            <Button>Сохранить</Button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                setSettings(false);
                setDeleting(true);
              }}
            >
              <Trash2 size={16} /> Удалить диалог
            </button>
          </form>
        </Modal>
      )}
      {deleting && chat && (
        <Modal title="Удалить диалог?" onClose={() => setDeleting(false)}>
          <p>Историю «{chat.title}» нельзя будет восстановить.</p>
          <Button
            className="danger"
            onClick={async () => {
              try {
                await remove('/chats/' + chat.id);
                setDeleting(false);
                fresh();
                await list();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Удалить
          </Button>
        </Modal>
      )}
    </div>
  );
}
