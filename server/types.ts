import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Store } from './db.js';
export type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: 'user' | 'admin';
  blocked: number;
  avatar_key: string | null;
  settings: string;
  created_at: number;
};
export type Session = { id: string; user_id: string; csrf: string; expires_at: number };
declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    session: Session | null;
  }
}
export type Services = {
  c: Config;
  db: Store;
  requireUser: (r: FastifyRequest) => UserRow;
  requireAdmin: (r: FastifyRequest) => UserRow;
  startSession: (r: FastifyRequest, p: FastifyReply, u: UserRow) => { csrf: string };
  abortUser: (id: string) => void;
  clearSession: (p: FastifyReply) => void;
};
export const publicUser = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  created_at: u.created_at,
  avatar: !!u.avatar_key,
  settings: JSON.parse(u.settings),
});
