// TOTP (RFC 6238, SHA-1, 6 digits, 30s step) + base32 + provisioning URI + recovery codes.
// Self-contained (node:crypto) so it's testable without external deps. G-2 enrolment support.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/,'').toUpperCase().replace(/\s/g, '');
  let bits = '';
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return (bin % 1_000_000).toString().padStart(6, '0');
}

export function totpAt(secretBase32: string, atMs: number, step = 30): string {
  return hotp(base32Decode(secretBase32), Math.floor(atMs / 1000 / step));
}

// Verify with +/-1 step drift tolerance (RFC 6238 §5.2).
export function verifyTotp(secretBase32: string, token: string, atMs = Date.now(), window = 1): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const secret = base32Decode(secretBase32);
  const c = Math.floor(atMs / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    const cand = hotp(secret, c + w);
    if (cand.length === token.length && timingSafeEqual(Buffer.from(cand), Buffer.from(token))) return true;
  }
  return false;
}

export function provisioningUri(secretBase32: string, account: string, issuer = 'MarineX360'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export const maskSecret = (s: string) => s.length <= 4 ? '****' : `${s.slice(0, 4)}${'*'.repeat(s.length - 4)}`;

// Recovery codes: return plaintext ONCE to the user; persist only the hashes.
export function generateRecoveryCodes(count = 10): { plaintext: string[] } {
  const plaintext = Array.from({ length: count }, () => randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})(.{5})/, '$1-$2'));
  return { plaintext };
}
