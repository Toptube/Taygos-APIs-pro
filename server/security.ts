import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

const EPHEMERAL_SESSION_SECRET = crypto.randomBytes(32);
const EPHEMERAL_VAULT_SECRET = crypto.randomBytes(32);

function getSessionSecret(): Buffer {
  const envSecret = process.env.TAYGOS_SESSION_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    return crypto.createHash('sha256').update(envSecret).digest();
  }
  return EPHEMERAL_SESSION_SECRET;
}

function getVaultKey(): { key: Buffer; persistent: boolean } {
  const envMaster = process.env.TAYGOS_MASTER_KEY?.trim();
  if (envMaster && envMaster.length >= 1) {
    const derived = crypto.scryptSync(envMaster, 'taygos-vault-salt-v1', 32);
    return { key: derived, persistent: true };
  }
  return { key: EPHEMERAL_VAULT_SECRET, persistent: false };
}

export function hasPersistentMasterKey(): boolean {
  return Boolean(process.env.TAYGOS_MASTER_KEY?.trim());
}

export function hashSecret(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifySecret(plain: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  try {
    const actual = crypto.scryptSync(plain, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function sealSecret(plaintext: string): string {
  if (!plaintext) return '';
  const { key } = getVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function unsealSecret(sealed: string): string | null {
  if (!sealed) return null;
  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const [, ivHex, tagHex, dataHex] = parts;
    const { key } = getVaultKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function createAdminSessionToken(ttlSeconds = 60 * 60 * 12): string {
  const payload = {
    sub: 'taygos-admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    jti: crypto.randomBytes(12).toString('hex'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifyAdminSessionToken(token: string): boolean {
  if (!token) return false;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return false;
  const payloadB64 = token.slice(0, dotIdx);
  const sigB64 = token.slice(dotIdx + 1);
  if (!payloadB64 || !sigB64) return false;

  try {
    const expectedSig = crypto
      .createHmac('sha256', getSessionSecret())
      .update(payloadB64)
      .digest('base64url');
    const actualBuf = Buffer.from(sigB64, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (actualBuf.length !== expectedBuf.length) return false;
    if (!crypto.timingSafeEqual(actualBuf, expectedBuf)) return false;

    const decoded = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as { exp?: number; sub?: string };
    if (decoded.sub !== 'taygos-admin') return false;
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function generateTaygosKeyPair(): {
  publicKey: string;
  secretKey: string;
  secretMasked: string;
} {
  const pubHex = crypto.randomBytes(12).toString('hex');
  const secHex = crypto.randomBytes(24).toString('hex');
  const publicKey = `pk_taygos_live_${pubHex}`;
  const secretKey = `sk_taygos_live_${secHex}`;
  return {
    publicKey,
    secretKey,
    secretMasked: maskCredential(secretKey),
  };
}

export function maskCredential(value: string): string {
  if (!value) return '—';
  if (value.length <= 12) return '••••••••';
  const prefix = value.slice(0, 15);
  const suffix = value.slice(-4);
  return `${prefix}••••${suffix}`;
}

export function verifyHmacSignature(
  secretKey: string,
  timestampHeader: string,
  signatureHeader: string,
  rawBody: string
): boolean {
  const tsNum = Number(timestampHeader);
  if (!Number.isFinite(tsNum)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  // Allow +/- 5 minute clock skew to prevent replay attacks
  if (Math.abs(nowSec - tsNum) > 300) return false;

  const cleanSig = signatureHeader.replace(/^sha256=/i, '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleanSig)) return false;

  const expected = crypto
    .createHmac('sha256', secretKey)
    .update(`${timestampHeader}.${rawBody}`)
    .digest('hex');

  const actualBuf = Buffer.from(cleanSig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (net.isIPv4(normalized)) {
    const octets = normalized.split('.').map(Number);
    if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }

  if (net.isIPv6(normalized)) {
    if (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.') ||
      normalized.startsWith('::ffff:169.254.')
    ) {
      return true;
    }
    if (normalized.startsWith('::ffff:')) {
      const v4Part = normalized.slice(7);
      if (net.isIPv4(v4Part)) return isPrivateOrReservedIp(v4Part);
    }
    return false;
  }

  return true;
}

export async function assertSafeUpstreamUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid upstream URL format.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTP and HTTPS protocols are permitted for upstream providers.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error('Local or internal hostnames are blocked by gateway security policy.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error('Private, loopback, or metadata IP addresses are blocked.');
    }
    return parsed;
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records.length) {
      throw new Error('Upstream hostname could not be resolved.');
    }
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        throw new Error('Upstream hostname resolved to a private or loopback network address.');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('blocked')) {
      throw err;
    }
    // Allow creation if offline DNS fails? No, fail safe or warn clearly:
    throw new Error(
      `Upstream DNS verification failed for ${hostname}: ${
        err instanceof Error ? err.message : 'Lookup error'
      }`
    );
  }

  return parsed;
}
