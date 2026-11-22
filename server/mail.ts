import nodemailer from 'nodemailer';
import type { Config } from './config.js';
export interface Mailer {
  ready: boolean;
  sendReset(email: string, url: string): Promise<void>;
}
export function createMailer(c: Config): Mailer {
  const ready = !!(c.smtp.host && c.smtp.from);
  const transport = ready
    ? nodemailer.createTransport({
        host: c.smtp.host,
        port: c.smtp.port,
        secure: c.smtp.secure,
        requireTLS: !c.smtp.secure,
        auth: c.smtp.user ? { user: c.smtp.user, pass: c.smtp.pass } : undefined,
        connectionTimeout: 10000,
        socketTimeout: 15000,
      })
    : null;
  return {
    ready,
    async sendReset(email, url) {
      if (!transport) throw Error('MAIL_NOT_CONFIGURED');
      await transport.sendMail({
        from: c.smtp.from,
        to: email,
        subject: 'Hellar AI — восстановление доступа',
        text: `Запрошено восстановление пароля Hellar AI. Ссылка действует 30 минут:\n${url}\n\nЕсли это не ты, проигнорируй письмо. Не пересылай эту ссылку.`,
      });
    },
  };
}
