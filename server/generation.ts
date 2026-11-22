import type { Store } from './db.js';
import { HttpError } from './security.js';
export class Generations {
  private active = new Map<
    string,
    { user: string; resource: string; controller: AbortController }
  >();
  constructor(private db: Store) {}
  start(user: string, kind: string, resource: string, timeout: number) {
    const key = kind + ':' + user;
    this.db.tx(() => {
      this.db.run('DELETE FROM generation_locks WHERE expires_at<?', Date.now());
      if (this.db.get('SELECT key FROM generation_locks WHERE key=?', key))
        throw new HttpError(409, 'Уже выполняется генерация. Дождись результата или останови её.');
      this.db.run(
        'INSERT INTO generation_locks(key,expires_at) VALUES(?,?)',
        key,
        Date.now() + timeout + 10000,
      );
    });
    const controller = new AbortController();
    this.active.set(key, { user, resource, controller });
    return {
      controller,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]),
      release: () => {
        this.active.delete(key);
        this.db.run('DELETE FROM generation_locks WHERE key=?', key);
      },
    };
  }
  stop(user: string, resource?: string) {
    for (const x of this.active.values())
      if (x.user === user && (!resource || x.resource === resource)) x.controller.abort();
  }
  close() {
    for (const x of this.active.values()) x.controller.abort();
  }
  has(user: string, kind: string) {
    return this.active.has(kind + ':' + user);
  }
}
