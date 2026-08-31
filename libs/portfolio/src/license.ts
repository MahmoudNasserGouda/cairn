/**
 * Offline premium-unlock verification (ADR-0018). The hosted store issues a license
 * signed with an Ed25519 private key that lives only in the issuer's environment.
 * The app ships the PUBLIC key and verifies signatures locally — no server call,
 * no secret in the repo (SECURITY.md T12).
 *
 * License string format:  base64url(payloadJson) + "." + base64url(signature)
 */
export interface LicensePayload {
  readonly sku: string;
  readonly purchaser: string;
  readonly issuedAt: string; // ISO date
  readonly features: readonly string[];
}

export interface LicenseVerification {
  readonly valid: boolean;
  readonly payload?: LicensePayload;
  readonly reason?: string;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8(s: string): Uint8Array<ArrayBuffer> {
  const src = new TextEncoder().encode(s);
  const out = new Uint8Array(new ArrayBuffer(src.byteLength));
  out.set(src);
  return out;
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPublicKey(spkiB64url: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    b64urlToBytes(spkiB64url),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
}

/**
 * Verify a license string against the app's embedded public key.
 * `publicKeyRawB64url` is the 32-byte raw Ed25519 public key, base64url-encoded.
 */
export async function verifyLicense(
  license: string,
  publicKeyRawB64url: string,
): Promise<LicenseVerification> {
  const parts = license.trim().split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed license' };
  const [payloadPart, sigPart] = parts as [string, string];

  let payload: LicensePayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(b64urlToBytes(payloadPart)),
    ) as LicensePayload;
  } catch {
    return { valid: false, reason: 'unreadable payload' };
  }

  let key: CryptoKey;
  try {
    key = await importPublicKey(publicKeyRawB64url);
  } catch {
    return { valid: false, reason: 'bad public key' };
  }

  const ok = await crypto.subtle.verify(
    'Ed25519',
    key,
    b64urlToBytes(sigPart),
    utf8(payloadPart),
  );
  if (!ok) return { valid: false, reason: 'signature mismatch' };
  return { valid: true, payload };
}

export function licenseGrants(v: LicenseVerification, feature: string): boolean {
  return v.valid === true && (v.payload?.features.includes(feature) ?? false);
}
