export type User = {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  created_at: number;
  avatar: boolean;
  settings: { motion?: boolean; style?: string };
};
export type Status = {
  chatReady: boolean;
  imageReady: boolean;
  mailReady: boolean;
  avatarReady?: boolean;
  chatModels: string[];
  imageModel: string;
  imageSizes: string[];
  limits: { chat: number; image: number };
  version: string;
};
let csrf = '';
export function setCsrf(s: string) {
  csrf = s;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = '',
  ) {
    super(message);
  }
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const h = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    h.set('Content-Type', 'application/json');
  if (options.method && options.method !== 'GET') h.set('X-CSRF-Token', csrf);
  const r = await fetch('/api' + path, { credentials: 'same-origin', ...options, headers: h });
  const j = await r.json().catch(() => ({ error: 'Сервер вернул некорректный ответ' }));
  if (!r.ok) throw new ApiError(j.error || 'Ошибка сервера', r.status, j.code);
  return j;
}
export const post = <T = any>(path: string, data: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export const patch = <T = any>(path: string, data: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });
export const remove = (path: string, data: unknown = {}) =>
  api(path, { method: 'DELETE', body: JSON.stringify(data) });
export function csrfHeaders() {
  return { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
}
