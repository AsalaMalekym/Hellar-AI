export interface Mailer {
  ready: boolean;
  sendReset(email: string, url: string): Promise<void>;
  sendVerification(email: string, url: string): Promise<void>;
}
export function mailContent(kind: 'reset' | 'verify', url: string) {
  return kind === 'reset'
    ? {
        subject: 'Hellar AI — восстановление доступа',
        text: `Запрошено восстановление пароля Hellar AI. Ссылка действует 30 минут:\n${url}\n\nЕсли это не ты, проигнорируй письмо. Не пересылай эту ссылку.`,
      }
    : {
        subject: 'Hellar AI — подтверждение почты',
        text: `Чтобы подтвердить свою почту и создать аккаунт Hellar AI, открой ссылку и задай пароль. Ссылка действует 30 минут:\n${url}\n\nЕсли ты не регистрировался, проигнорируй письмо: аккаунт не будет создан. Не пересылай эту ссылку.`,
      };
}
export function createApiMailer(key: string, from: string, request: typeof fetch = fetch): Mailer {
  const ready = !!(key && from);
  async function send(email: string, url: string, kind: 'reset' | 'verify') {
    if (!ready) throw Error('MAIL_NOT_CONFIGURED');
    const response = await request('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], ...mailContent(kind, url) }),
      signal: AbortSignal.timeout(10000),
    });
    // Never surface provider responses, recipients or tokens in logs/errors.
    if (!response.ok) throw Error('MAIL_DELIVERY_FAILED');
    const data = (await response.json()) as { id?: string };
    if (!data.id) throw Error('MAIL_DELIVERY_FAILED');
  }
  return {
    ready,
    sendReset: (email, url) => send(email, url, 'reset'),
    sendVerification: (email, url) => send(email, url, 'verify'),
  };
}
