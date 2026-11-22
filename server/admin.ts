import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { config } from './config.js';
import { Store } from './db.js';
import { hashPassword, id } from './security.js';
import { z } from 'zod';
async function hidden(question: string): Promise<string> {
  if (!stdin.isTTY)
    throw Error(
      'Interactive terminal required. Password is never accepted as a command-line argument.',
    );
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const listener = (chunk: Buffer) => {
      for (const c of chunk.toString()) {
        if (c === '\u0003') {
          cleanup();
          reject(Error('Cancelled'));
          return;
        }
        if (c === '\r' || c === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (c === '\u007f') {
          value = value.slice(0, -1);
        } else if (c >= ' ') value += c;
      }
    };
    function cleanup() {
      stdin.off('data', listener);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    }
    stdin.on('data', listener);
  });
}
const rl = createInterface({ input: stdin, output: stdout });
const email = z
  .string()
  .email()
  .max(254)
  .parse((await rl.question('Admin email: ')).trim().toLowerCase());
const name = z
  .string()
  .min(2)
  .max(60)
  .parse((await rl.question('Admin display name: ')).trim());
rl.close();
const password = await hidden('Admin password (12–128 chars, hidden): ');
z.string().min(12).max(128).parse(password);
if (password !== (await hidden('Confirm password: '))) throw Error('Passwords do not match');
const hashed = await hashPassword(password);
const db = new Store(config().dbPath);
try {
  db.tx(() => {
    if (db.get("SELECT id FROM users WHERE role='admin'"))
      throw Error(
        'An administrator already exists. This bootstrap command is only for the first administrator.',
      );
    db.run(
      'INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',
      id(),
      email,
      name,
      hashed,
      'admin',
      Date.now(),
    );
  });
  console.log('Administrator created. You can sign in and create invitations.');
} finally {
  db.close();
}
