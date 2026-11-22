import { EventEmitter } from 'node:events';
import { ZodError } from 'zod';
import { HttpError } from '../server/security.js';

// Small Fetch adapter for the exact route API used by server/{auth,chat,images,profile}.
// No Fastify runtime or dynamic code generation is included in the Worker.
export class Router {
  routes: { method: string; pattern: string; handler: any }[] = [];
  before: (r: any, p: any) => Promise<void> = async () => {};
  get(pattern: string, handler: any) { this.routes.push({ method: 'GET', pattern, handler }); }
  post(pattern: string, handler: any) { this.routes.push({ method: 'POST', pattern, handler }); }
  patch(pattern: string, handler: any) { this.routes.push({ method: 'PATCH', pattern, handler }); }
  delete(pattern: string, handler: any) { this.routes.push({ method: 'DELETE', pattern, handler }); }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const headers = new Headers({
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    let status = 200, sent = false, value: any;
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let streamResponse: Response | undefined;
    let streamResolve!: (r: Response) => void;
    const ready = new Promise<Response>((resolve) => { streamResolve = resolve; });
    const raw: any = new EventEmitter();
    raw.destroyed = false;
    raw.writableNeedDrain = false; // Shared chat route caps the response at 100k characters.
    raw.setHeader = (k: string, v: any) => headers.set(k, String(v));
    raw.writeHead = (code: number, extra: Record<string,string>) => {
      status = code;
      for (const [k,v] of Object.entries(extra)) if (k.toLowerCase() !== 'connection') headers.set(k,v);
      const stream = new ReadableStream<Uint8Array>({
        start(c) { controller = c; },
        cancel() { raw.destroyed = true; raw.emit('close'); },
      });
      streamResponse = new Response(stream, { status, headers });
      streamResolve(streamResponse);
    };
    raw.write = (text: string) => { if (!raw.destroyed) controller?.enqueue(new TextEncoder().encode(text)); return true; };
    raw.end = () => { if (!raw.destroyed) { raw.destroyed = true; controller?.close(); } };
    const p: any = {
      raw, get sent() { return sent; },
      code(n: number) { status = n; return p; },
      header(k: string, v: string) { headers.set(k,v); return p; },
      type(v: string) { headers.set('Content-Type',v); return p; },
      getHeaders() { return Object.fromEntries(headers); },
      hijack() { sent = true; },
      send(v: any) { sent = true; value = v; return p; },
      setCookie(name: string, content: string, opts: any) {
        headers.append('Set-Cookie', `${name}=${encodeURIComponent(content)}; Path=/; HttpOnly; SameSite=Strict${opts.secure ? '; Secure' : ''}${opts.maxAge != null ? '; Max-Age=' + opts.maxAge : ''}`); return p;
      },
      clearCookie(name: string, opts: any) { return p.setCookie(name, '', { ...opts, maxAge: 0 }); },
    };
    const task = (async () => {
      try {
        const path = url.pathname.split('/');
        let selected: any, params: Record<string,string> = {};
        for (const route of this.routes) {
          if (route.method !== request.method) continue;
          const parts = route.pattern.split('/');
          if (parts.length !== path.length) continue;
          const candidate: Record<string,string> = {};
          if (parts.every((part, i) => part.startsWith(':') ? (candidate[part.slice(1)] = decodeURIComponent(path[i]), true) : part === path[i])) { selected = route; params = candidate; break; }
        }
        const cookies: Record<string,string> = {};
        for (const pair of (request.headers.get('cookie') || '').split(';')) {
          const i = pair.indexOf('=');
          if (i > 0) try { cookies[pair.slice(0,i).trim()] = decodeURIComponent(pair.slice(i+1)); } catch {}
        }
        const r: any = { params, query: Object.fromEntries(url.searchParams),
          headers: Object.fromEntries(request.headers), method: request.method, url: url.pathname,
          cookies, user: null, session: null,
          ip: request.headers.get('x-hellar-client-ip') || 'unknown',
          log: { warn() {}, error() {} }, body: undefined,
          file: async () => { throw new HttpError(503, 'Загрузка аватаров пока недоступна.'); },
        };
        await this.before(r,p);
        if (!selected) throw new HttpError(404, 'Не найдено.');
        if (request.body) {
          const reader = request.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
          while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 65536) { await reader.cancel(); throw new HttpError(413,'Слишком большой запрос.'); } chunks.push(next.value); }
          const body = Buffer.concat(chunks).toString('utf8');
          if (body) {
            if (!(request.headers.get('content-type') || '').includes('application/json')) throw new HttpError(415,'Ожидается JSON.');
            try { r.body = JSON.parse(body); } catch { throw new HttpError(400,'Некорректный JSON.'); }
          }
        }
        const result = await selected.handler(r,p);
        if (streamResponse) return streamResponse;
        if (!sent) value = result;
        if (Buffer.isBuffer(value)) return new Response(new Uint8Array(value), {status, headers});
        headers.set('Content-Type','application/json; charset=utf-8');
        return new Response(JSON.stringify(value ?? null), { status, headers });
      } catch (error) {
        if (streamResponse) { raw.end(); return streamResponse; }
        const e = error as any;
        const code = e instanceof HttpError ? e.status : e instanceof ZodError ? 400 : 500;
        const message = e instanceof HttpError ? e.message : e instanceof ZodError ? e.issues[0]?.message : 'Внутренняя ошибка. Попробуй позже.';
        headers.set('Content-Type','application/json; charset=utf-8');
        return new Response(JSON.stringify({error:message,code:e instanceof HttpError ? e.code : ''}), {status:code,headers});
      }
    })();
    // The streaming body keeps the request alive; aborting it cancels the provider.
    return Promise.race([ready, task]);
  }
}
