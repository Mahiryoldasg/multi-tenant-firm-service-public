import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SALT_BYTES = 16;
const KEY_BYTES = 64;
// "<salt>:<key>" in lowercase hex, sized by SALT_BYTES and KEY_BYTES.
const STORED_FORMAT = /^[0-9a-f]{32}:[0-9a-f]{128}$/;

/** Hashes a password with scrypt and a fresh random salt, for `users.password_hash`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

/** Checks a password against a stored hash in constant time; a malformed hash never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!STORED_FORMAT.test(stored)) return false;

  const [saltHex = '', keyHex = ''] = stored.split(':');
  const key = await deriveKey(password, Buffer.from(saltHex, 'hex'));
  return timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

// Async scrypt runs on the libuv thread pool, so the login and create handlers that call it later
// do not block the event loop. Node's default cost applies (N=16384, r=8, p=1).
function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, (error, key) => (error ? reject(error) : resolve(key)));
  });
}
