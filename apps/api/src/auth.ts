import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing for the two v1 accounts (plan D8).
 *
 * DEVIATION FROM SPEC, deliberate: NF-15 names Argon2id or bcrypt (cost >= 12). This uses
 * Node's built-in scrypt instead — a memory-hard KDF of comparable strength — to avoid a
 * native dependency for two credentials that are operator-set and never user-chosen.
 * When real auth lands (plan D9 phase), swap this module for Argon2id and satisfy NF-15
 * literally; nothing outside this file needs to change.
 */
const KEYLEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, hashHex] = parts;
  if (saltHex === undefined || hashHex === undefined) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;

  const derived = await scrypt(password, salt, KEYLEN);
  return timingSafeEqual(derived, expected);
}
