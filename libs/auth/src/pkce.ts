/**
 * PKCE — Proof Key for Code Exchange (RFC 7636), for the one provider that can use it.
 *
 * GitHub, LinkedIn and Google all require a client secret to turn an authorization code
 * into a token, which is why `cairn-auth` exists at all (ADR-0024). **GitLab does not**:
 * its discovery document advertises `S256` for public clients, so the browser can finish
 * the exchange itself and no server is in the path (ADR-0034).
 *
 * The shape is simple. Before redirecting, the client invents a high-entropy secret (the
 * *verifier*), sends only its SHA-256 hash (the *challenge*) to the authorization
 * endpoint, and presents the verifier at the token endpoint. An attacker who intercepts
 * the redirect gets a code they cannot spend, because they never saw the verifier.
 *
 * Framework-free and WebCrypto-only: `apps/web` and `apps/extension` (ADR-0014) share it.
 */

/** Never `plain`, which puts the verifier in the redirect URL — the attack PKCE stops. */
export const PKCE_METHOD = 'S256' as const;

export interface PkcePair {
  /** Held in `sessionStorage` until the callback, then used once and cleared. */
  readonly verifier: string;
  /** Sent to the authorization endpoint. Safe to put in a URL. */
  readonly challenge: string;
}

function defaultRandomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * base64url without padding (RFC 4648 §5) — the encoding RFC 7636 requires.
 *
 * Plain base64 would be wrong in a way that is hard to see: `+` and `/` survive a
 * `JSON.stringify` unchanged but are re-encoded inside a form body, so the server would
 * hash a different string and answer `invalid_grant`. That failure looks like a rejected
 * login, not like an encoding bug.
 */
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * SHA-256 the verifier and base64url the digest.
 *
 * Exported for the RFC's own test vector: round-tripping our encoder against our decoder
 * would prove only that we are self-consistent, which is exactly the kind of test that
 * passes while the integration fails.
 */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

/**
 * A fresh verifier and its challenge. 32 random bytes encode to 43 characters, the
 * shortest length the RFC permits and 256 bits of entropy.
 *
 * `randomBytes` is injectable so the caller — not this module — owns the question of
 * where randomness comes from, and so the determinism of the derivation is testable
 * without stubbing `crypto` globally.
 */
export async function createPkcePair(
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes,
): Promise<PkcePair> {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: await deriveCodeChallenge(verifier) };
}
