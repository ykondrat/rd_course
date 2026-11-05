import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 32;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);

  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, keyB64] = stored.split('$');

  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  const actual = scryptSync(password, salt, expected.length, SCRYPT_PARAMS);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}