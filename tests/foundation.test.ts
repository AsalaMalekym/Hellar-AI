import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { config } from '../server/config.js';
import { Store } from '../server/db.js';
test('migration and health', async () => {
  const db = new Store(':memory:');
  assert.equal(db.get('SELECT COUNT(*) n FROM migrations').n, 1);
  db.close();
  const app = await buildApp({ ...config(), dbPath: ':memory:' });
  assert.equal((await app.inject('/api/health')).statusCode, 200);
  await app.close();
});
