import schema from '../migrations/001_initial.sql';
// One shared object preserves the original application's synchronous transactions.
export class Store {
  constructor(private storage: DurableObjectStorage) {
    storage.sql.exec('PRAGMA foreign_keys=ON');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)');
    if (!this.get('SELECT name FROM migrations WHERE name=?', '001_initial.sql')) {
      this.tx(() => {
        storage.sql.exec(schema);
        this.run('INSERT INTO migrations VALUES(?,?)', '001_initial.sql', Date.now());
      });
    }
  }
  get<T = any>(sql: string, ...values: any[]): T | undefined { return this.all<T>(sql, ...values)[0]; }
  all<T = any>(sql: string, ...values: any[]): T[] { return this.storage.sql.exec(sql, ...values).toArray() as T[]; }
  run(sql: string, ...values: any[]) {
    this.storage.sql.exec(sql, ...values).toArray();
    return { changes: this.get('SELECT changes() AS n').n };
  }
  tx<T>(fn: () => T): T { return this.storage.transactionSync(fn); }
  recover() {
    this.run("UPDATE messages SET status='interrupted' WHERE status='streaming'");
    this.run("UPDATE image_jobs SET status='interrupted',error='Генерация прервана перезапуском сервера' WHERE status='pending'");
    this.run('DELETE FROM generation_locks');
  }
  close() {}
}
