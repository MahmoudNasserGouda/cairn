import { describe, expect, it } from 'vitest';
import { createPkcePair, deriveCodeChallenge, PKCE_METHOD } from './pkce';

/**
 * PKCE (RFC 7636), which exists here for one reason: it is what lets GitLab complete a
 * `code -> token` exchange **in the browser, with no `cairn-auth` Worker in the path**
 * (ADR-0034). Every other provider needs a client secret, and a secret needs a server.
 *
 * The properties below are the ones an attacker cares about. A verifier that is
 * predictable, reused, or reachable from the challenge turns PKCE back into a plain
 * authorization-code flow with extra steps.
 */

const UNRESERVED = /^[A-Za-z0-9\-._~]+$/;

describe('the verifier', () => {
  it('is within the length RFC 7636 allows', async () => {
    const { verifier } = await createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  /**
   * base64url, not base64. A `+` or `/` would be re-encoded in the form body and the
   * server would hash a different string than we did — an authentic-looking
   * `invalid_grant` that is entirely our own fault.
   */
  it('uses only unreserved characters, with no base64 padding', async () => {
    const { verifier } = await createPkcePair();
    expect(verifier).toMatch(UNRESERVED);
    expect(verifier).not.toContain('=');
  });

  it('is different every time', async () => {
    const pairs = await Promise.all([
      createPkcePair(),
      createPkcePair(),
      createPkcePair(),
    ]);
    expect(new Set(pairs.map((p) => p.verifier)).size).toBe(3);
  });

  it('draws its bytes from the given source, so randomness is the caller-s to audit', async () => {
    const zeros = (n: number) => new Uint8Array(n);
    const a = await createPkcePair(zeros);
    const b = await createPkcePair(zeros);
    expect(a.verifier).toBe(b.verifier);
  });
});

describe('the challenge', () => {
  /**
   * The RFC's own test vector (appendix B). If this passes, we are hashing and encoding
   * exactly what every conforming server expects — which is not something a round-trip
   * test against our own code could establish.
   */
  it('matches RFC 7636 appendix B', async () => {
    const challenge = await deriveCodeChallenge(
      'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    );
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('announces S256 and never plain', () => {
    // GitLab advertises both. `plain` sends the verifier in the clear in the redirect,
    // which is the attack PKCE was written to stop.
    expect(PKCE_METHOD).toBe('S256');
  });

  it('is base64url with no padding', async () => {
    const { challenge } = await createPkcePair();
    expect(challenge).toMatch(UNRESERVED);
    expect(challenge).not.toContain('=');
    expect(challenge).toHaveLength(43);
  });

  it('does not leak the verifier', async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(challenge).not.toBe(verifier);
    expect(challenge).not.toContain(verifier);
  });
});
