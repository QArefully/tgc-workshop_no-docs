import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const KEYLEN = 64;
const SALT_LEN = 32;
const SEPARATOR = '.';

/**
 * Hash a plaintext password with a random salt using scrypt.
 * Returns a string of the form `hexSalt.hexHash`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN).toString('hex');
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  return `${salt}${SEPARATOR}${derived.toString('hex')}`;
}

/**
 * Verify a plaintext password against a stored `salt.hash` string.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const sepIdx = stored.indexOf(SEPARATOR);
  if (sepIdx === -1) return false;
  const salt = stored.slice(0, sepIdx);
  const expectedHex = stored.slice(sepIdx + 1);
  const derived = (await scryptAsync(password, salt, KEYLEN)) as Buffer;
  try {
    return timingSafeEqual(Buffer.from(expectedHex, 'hex'), derived);
  } catch {
    return false;
  }
}
