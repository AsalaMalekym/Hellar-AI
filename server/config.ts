import path from 'node:path';
import { billingConfig, type BillingConfig } from './billing-config.js';
export type Config = {
  billing: BillingConfig;
  origin: string;
  production: boolean;
  secure: boolean;
  dbPath: string;
  storagePath: string;
  trustProxy: boolean;
  key: string;
  chatModels: string[];
  imageModel: string;
  imageSizes: string[];
  chatLimit: number;
  imageLimit: number;
  globalChatLimit: number;
  globalImageLimit: number;
  maxOutput: number;
  contextChars: number;
  aiTimeout: number;
  imageTimeout: number;
  mailApiKey: string;
  captcha: { required: boolean; siteKey: string; secretKey: string };
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string; from: string };
};
const num = (v: string | undefined, d: number) => {
  const n = Number(v || d);
  if (!Number.isSafeInteger(n) || n < 1 || n > 100000000)
    throw Error('Invalid numeric environment setting');
  return n;
};
export function config(): Config {
  const production = process.env.NODE_ENV === 'production';
  const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
  if (new URL(origin).origin !== origin)
    throw Error('APP_ORIGIN must be an origin without trailing slash');
  const secure = process.env.COOKIE_SECURE === 'true';
  if (production && (!secure || !origin.startsWith('https://')))
    throw Error('Production requires HTTPS APP_ORIGIN and COOKIE_SECURE=true');
  const sizes = (process.env.IMAGE_SIZES || '1024x1024,1024x1536,1536x1024')
    .split(',')
    .map((x) => x.trim());
  if (
    sizes.some(
      (s) =>
        !/^\d{3,4}x\d{3,4}$/.test(s) ||
        s
          .split('x')
          .map(Number)
          .reduce((a, b) => a * b) > 36000000,
    )
  )
    throw Error('Invalid IMAGE_SIZES');
  return {
    billing: billingConfig(),
    origin,
    production,
    secure,
    dbPath: path.resolve(process.env.DATABASE_PATH || './data/hellar.sqlite'),
    storagePath: path.resolve(process.env.STORAGE_PATH || './data/files'),
    trustProxy: process.env.TRUST_PROXY === 'true',
    key: process.env.OPENAI_API_KEY || '',
    chatModels: (process.env.CHAT_MODELS || 'gpt-4.1-mini')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    imageModel: process.env.IMAGE_MODEL || 'gpt-image-1',
    imageSizes: sizes,
    chatLimit: num(process.env.CHAT_DAILY_LIMIT, 100),
    imageLimit: num(process.env.IMAGE_DAILY_LIMIT, 10),
    globalChatLimit: num(process.env.GLOBAL_CHAT_DAILY_LIMIT, 1000),
    globalImageLimit: num(process.env.GLOBAL_IMAGE_DAILY_LIMIT, 100),
    maxOutput: num(process.env.MAX_OUTPUT_TOKENS, 1500),
    contextChars: num(process.env.MAX_CONTEXT_CHARS, 48000),
    aiTimeout: num(process.env.AI_TIMEOUT_MS, 90000),
    imageTimeout: num(process.env.IMAGE_TIMEOUT_MS, 180000),
    mailApiKey: process.env.RESEND_API_KEY || '',
    captcha: {
      required:
        production || !!process.env.TURNSTILE_SITE_KEY || !!process.env.TURNSTILE_SECRET_KEY,
      siteKey: process.env.TURNSTILE_SITE_KEY || '',
      secretKey: process.env.TURNSTILE_SECRET_KEY || '',
    },
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: num(process.env.SMTP_PORT, 587),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASSWORD || '',
      from: process.env.MAIL_FROM || '',
    },
  };
}
