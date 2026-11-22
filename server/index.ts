import { buildApp } from './app.js';
import { config } from './config.js';
const app = await buildApp(config(), { logger: true });
await app.listen({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3001) });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => void app.close().then(() => process.exit(0)));
