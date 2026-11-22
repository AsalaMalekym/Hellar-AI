import { pbkdf2 as nodePbkdf2 } from 'node:crypto';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

const ITERATIONS = 600000;
const KEY_LENGTH = 32;
type NativeDerive = (password: string, salt: string) => Promise<Buffer>;
const nativeDerive: NativeDerive = (password, salt) => new Promise((resolve, reject) => {
  nodePbkdf2(password, salt, ITERATIONS, KEY_LENGTH, 'sha256', (error, key) =>
    error ? reject(error) : resolve(key));
});

// Hosted Workers may enforce a native PBKDF2 cap that local workerd does not.
// The fallback computes the same PBKDF2-SHA256 bytes, with the same UTF-8 salt,
// iteration count and output length. Existing hashes remain valid.
export async function derivePasswordKey(password: string, salt: string, native: NativeDerive = nativeDerive): Promise<Buffer> {
  try {
    return await native(password, salt);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!/pbkdf2/i.test(message) || !/iteration counts above \d+ are not supported/i.test(message)) throw error;
    const encoder = new TextEncoder();
    return Buffer.from(await pbkdf2Async(sha256, encoder.encode(password), encoder.encode(salt), {
      c: ITERATIONS, dkLen: KEY_LENGTH, asyncTick: 10,
    }));
  }
}
