import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/app.js';
import { config } from '../server/config.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../server/db.js';
test('migration and health', async () => {
  const db = new Store(':memory:');
  assert.equal(db.get('SELECT COUNT(*) n FROM migrations').n, 3);
  db.close();
  const app = await buildApp({ ...config(), dbPath: ':memory:' });
  assert.equal((await app.inject('/api/health')).statusCode, 200);
  await app.close();
});

test('email migration preserves existing owner and invitation and can reopen the database', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hellar-migration-'));
  const file = path.join(dir, 'old.sqlite');
  try {
    const old = new DatabaseSync(file);
    old.exec(readFileSync('migrations/001_initial.sql', 'utf8'));
    old.exec(
      "CREATE TABLE migrations(name TEXT PRIMARY KEY,applied_at INTEGER NOT NULL); INSERT INTO migrations VALUES('001_initial.sql',1)",
    );
    old
      .prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
      .run('owner', 'owner@example.com', 'Owner', 'existing-hash', 'admin', 1);
    old
      .prepare(
        'INSERT INTO invitations(id,token_hash,label,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?)',
      )
      .run('invite', 'invite-hash', 'Friend', 'owner', 1, 9999999999999);
    old.close();
    for (let i = 0; i < 2; i++) {
      const db = new Store(file);
      assert.equal(
        db.get('SELECT password_hash FROM users WHERE id=?', 'owner').password_hash,
        'existing-hash',
      );
      assert.equal(db.get('SELECT used_at FROM invitations WHERE id=?', 'invite').used_at, null);
      assert.equal(db.get('SELECT COUNT(*) n FROM migrations').n, 3);
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
