import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/server/auth/password.ts';

describe('password hashing', () => {
  it('stores a 16-byte salt and a 64-byte key as lowercase hex', async () => {
    expect(await hashPassword('correct horse battery staple')).toMatch(
      /^[0-9a-f]{32}:[0-9a-f]{128}$/,
    );
  });

  it('salts every hash, so the same password never hashes the same way twice', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);

    expect(first).not.toBe(second);
  });

  it('accepts the right password and rejects any other', async () => {
    const stored = await hashPassword('correct horse battery staple');

    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true);
    await expect(verifyPassword('Correct horse battery staple', stored)).resolves.toBe(false);
    await expect(verifyPassword('', stored)).resolves.toBe(false);
  });

  it.each([
    { label: 'an empty value', stored: '' },
    { label: 'a value without a separator', stored: 'abc' },
    { label: 'non-hex parts', stored: 'zz:zz' },
    { label: 'a key that is too short', stored: `${'a'.repeat(32)}:${'b'.repeat(64)}` },
    { label: 'uppercase hex', stored: `${'A'.repeat(32)}:${'B'.repeat(128)}` },
  ])('returns false for $label instead of throwing', async ({ stored }) => {
    await expect(verifyPassword('anything', stored)).resolves.toBe(false);
  });
});
