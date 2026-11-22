import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { derivePasswordKey } from '../server/password-kdf.js';

const cappedNative = async (): Promise<Buffer> => {
  throw new DOMException('Pbkdf2 failed: iteration counts above 100000 are not supported (requested 600000)', 'NotSupportedError');
};

test('hosted Workers iteration cap falls back to byte-identical 600k PBKDF2, including Unicode passwords', async () => {
  for (const password of ['Example-password-2026!', 'Пароль🌌-é-2026!']) {
    const salt = '0123456789abcdef0123456789abcdef';
    const expected = pbkdf2Sync(password, salt, 600000, 32, 'sha256');
    assert.deepEqual(await derivePasswordKey(password, salt, cappedNative), expected);
    assert.deepEqual(await derivePasswordKey(password, salt), expected);
  }
});

test('unrelated native crypto failures are propagated instead of hidden', async () => {
  const failure = new Error('Unexpected crypto failure');
  await assert.rejects(derivePasswordKey('test','salt',async () => { throw failure; }), e => e === failure);
});
