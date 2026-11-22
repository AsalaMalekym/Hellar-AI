import nodemailer from 'nodemailer';
import type { Config } from './config.js';
import { createApiMailer, mailContent, type Mailer } from './mail-api.js';
export type { Mailer } from './mail-api.js';
export function createMailer(c: Config): Mailer {
  if (c.mailApiKey) return createApiMailer(c.mailApiKey, c.smtp.from);
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
        ...mailContent('reset', url),
      });
    },
    async sendVerification(email, url) {
      if (!transport) throw Error('MAIL_NOT_CONFIGURED');
      await transport.sendMail({ from: c.smtp.from, to: email, ...mailContent('verify', url) });
    },
  };
}
