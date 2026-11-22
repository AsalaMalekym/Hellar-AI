import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api, setCsrf, type User, type Status } from './api';
let mePending: Promise<any> | null = null;
const me = () => {
  mePending ??= api('/auth/me').finally(() => {
    mePending = null;
  });
  return mePending;
};
type State = {
  user: User | null;
  status: Status | null;
  loading: boolean;
  error: string;
  statusError: string;
  emailLinkToken: string;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
};
const Ctx = createContext<State>(null!);
export function Provider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [status, setStatus] = useState<Status | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [statusError, setStatusError] = useState('');
  const [emailLinkToken] = useState(() =>
    ['/reset', '/verify-email'].includes(location.pathname) ? location.hash.slice(1) : '',
  );
  useEffect(() => {
    if (emailLinkToken) history.replaceState(null, '', location.pathname + location.search);
  }, [emailLinkToken]);
  async function refresh() {
    try {
      const data = await me();
      setUser(data.user);
      setCsrf(data.csrf || '');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    api('/status')
      .then(setStatus)
      .catch((e) => setStatusError((e as Error).message));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.motion = user?.settings?.motion === false ? 'reduced' : 'full';
  }, [user]);
  return (
    <Ctx.Provider
      value={{
        user,
        status,
        loading,
        error,
        statusError,
        emailLinkToken,
        refresh,
        notify: setToast,
      }}
    >
      {children}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </Ctx.Provider>
  );
}
export const useApp = () => useContext(Ctx);
