import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
export class Store {
  readonly db: DatabaseSync;
  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)',
    );
    for (const name of readdirSync(path.resolve('migrations'))
      .filter((x) => x.endsWith('.sql'))
      .sort()) {
      if (!this.get('SELECT name FROM migrations WHERE name=?', name))
        this.tx(() => {
          this.db.exec(readFileSync(path.resolve('migrations', name), 'utf8'));
          this.run('INSERT INTO migrations VALUES(?,?)', name, Date.now());
        });
    }
  }
  recover() {
    this.run("UPDATE messages SET status='interrupted' WHERE status='streaming'");
    this.run(
      "UPDATE image_jobs SET status='interrupted',error='Генерация прервана перезапуском сервера' WHERE status='pending'",
    );
    this.run('DELETE FROM generation_locks');
    this.run("UPDATE billing_holds SET state='review',note='restart' WHERE state='reserved'");
  }
  get<T = any>(s: string, ...v: SQLInputValue[]): T | undefined {
    return this.db.prepare(s).get(...v) as T | undefined;
  }
  all<T = any>(s: string, ...v: SQLInputValue[]): T[] {
    return this.db.prepare(s).all(...v) as T[];
  }
  run(s: string, ...v: SQLInputValue[]) {
    return this.db.prepare(s).run(...v);
  }
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
