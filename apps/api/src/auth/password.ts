// Password hashing — scrypt with per-hash salt. Stored as scrypt$N$r$p$salt$hash (all hex/b64).
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(_scrypt) as (pw: string | Buffer, salt: Buffer, keylen: number, opts: any) => Promise<Buffer>;

const N = 16384, r = 8, p = 1, KEYLEN = 32;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = await scrypt(plain, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, rr, pp, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const dk = await scrypt(plain, salt, expected.length, { N: +n, r: +rr, p: +pp });
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}
