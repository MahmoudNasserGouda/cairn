import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * GitLab ships with a placeholder application id, so `isProviderConfigured` hides it
 * until a deployment registers a real one (ADR-0034). These tests need it visible, and
 * only its id is overridden — every other provider stays exactly as configured.
 */
vi.mock('@cairn/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cairn/shared')>();
  return {
    ...actual,
    OAUTH_PROVIDERS: {
      ...actual.OAUTH_PROVIDERS,
      gitlab: { ...actual.OAUTH_PROVIDERS.gitlab, clientId: 'gl-test-app-id' },
    },
  };
});
import { TestBed } from '@angular/core/testing';
import type { Identity } from '@cairn/auth';
import { AuthService } from './auth.service';
import { IndexedDbStore } from '../indexeddb-store';

const SESSION_KEY = 'cairn.session.v1';
const PENDING_KEY = 'cairn.oauth.pending';

const GITHUB: Identity = {
  provider: 'github',
  subject: 'gh-1',
  displayName: 'Octo',
  email: null,
  avatarUrl: null,
  profileUrl: null,
};
const GOOGLE: Identity = {
  provider: 'google',
  subject: 'g-1',
  displayName: 'Octo',
  email: 'o@example.com',
  avatarUrl: null,
  profileUrl: null,
};

/** An in-memory stand-in: jsdom has no IndexedDB. */
class FakeStore {
  private readonly map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(prefix?: string): Promise<string[]> {
    const all = [...this.map.keys()];
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
}

function makeService(): AuthService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: IndexedDbStore, useClass: FakeStore }],
  });
  return TestBed.inject(AuthService);
}

/**
 * Put the page on an OAuth callback URL with a matching pending record.
 *
 * Through `history.replaceState`, which is how a page's URL actually changes, rather
 * than by redefining `globalThis.location`. The redefinition worked only while
 * `location` happened to be a configurable data property on the test global — an
 * accident of the environment, not a guarantee — and it stopped working the moment
 * the Angular compiler joined the Vitest pipeline (ADR-0032), with
 * `TypeError: Cannot redefine property: location`. `replaceState` sets `search`,
 * `pathname` and `hash` for real, which is all `AuthService` reads.
 */
function arriveOnCallback(state: string, code = 'the-code'): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ provider: 'google', state }));
  globalThis.history.replaceState({}, '', `/?code=${code}&state=${state}#/dashboard`);
}

beforeEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('session restore', () => {
  it('rehydrates identities and the GitHub token on a normal load', async () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ identities: [GITHUB], githubToken: 'gh-token' }),
    );
    const auth = makeService();
    await auth.completeSignInFromRedirect();

    expect(auth.isSignedIn()).toBe(true);
    expect(auth.githubToken).toBe('gh-token');
    expect(auth.status()).toBe('ready');
  });

  it('KEEPS an existing GitHub connection when a second provider signs in', async () => {
    // Regression: the callback branch skipped restoreSession(), so `_identities`
    // started empty and persistSession() overwrote the stored session with only the
    // provider that had just returned — silently disconnecting GitHub.
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ identities: [GITHUB], githubToken: 'gh-token' }),
    );
    arriveOnCallback('state-123');

    const auth = makeService();
    vi.spyOn(await import('@cairn/auth'), 'exchangeCodeForToken').mockResolvedValue({
      accessToken: 'g-token',
      tokenType: 'bearer',
      scopes: [],
    });
    vi.spyOn(await import('@cairn/auth'), 'fetchIdentity').mockResolvedValue(GOOGLE);

    await auth.completeSignInFromRedirect();

    expect(auth.hasIdentity('github')).toBe(true);
    expect(auth.hasIdentity('google')).toBe(true);
    expect(auth.githubToken).toBe('gh-token');

    const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}') as {
      identities: Identity[];
      tokens: Record<string, string>;
    };
    expect(stored.identities.map((i) => i.provider).sort()).toEqual(['github', 'google']);
    // Tokens are keyed by provider now that GitHub is not the only data connection
    // (ADR-0034). Google's is absent because an identity-only token is never kept.
    expect(stored.tokens).toEqual({ github: 'gh-token' });
  });

  it('drops a stored session whose identity list is empty', async () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ identities: [], githubToken: 'orphan' }),
    );
    const auth = makeService();
    await auth.completeSignInFromRedirect();

    expect(auth.isSignedIn()).toBe(false);
    expect(auth.githubToken).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('survives a corrupt stored session', async () => {
    sessionStorage.setItem(SESSION_KEY, 'not json');
    const auth = makeService();
    await auth.completeSignInFromRedirect();

    expect(auth.isSignedIn()).toBe(false);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe('sign out', () => {
  it('clears one provider without touching the others', async () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ identities: [GITHUB, GOOGLE], githubToken: 'gh-token' }),
    );
    const auth = makeService();
    await auth.completeSignInFromRedirect();

    auth.signOut('github');

    expect(auth.hasIdentity('github')).toBe(false);
    expect(auth.hasIdentity('google')).toBe(true);
    expect(auth.githubToken).toBeNull();
  });

  it('wipes the stored session entirely when signing out of everything', async () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ identities: [GITHUB], githubToken: 'gh-token' }),
    );
    const auth = makeService();
    await auth.completeSignInFromRedirect();

    auth.signOut();

    expect(auth.isSignedIn()).toBe(false);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(auth.status()).toBe('anonymous');
  });
});

describe('callback verification', () => {
  it('refuses a callback whose state does not match the pending record', async () => {
    arriveOnCallback('state-abc');
    sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ provider: 'google', state: 'a-different-state' }),
    );
    const auth = makeService();
    await auth.completeSignInFromRedirect();

    expect(auth.isSignedIn()).toBe(false);
    expect(auth.error()).toMatch(/could not be verified/);
  });
});

/**
 * GitLab's PKCE flow (ADR-0034), from this side of the boundary.
 *
 * `libs/auth` owns the cryptography and is tested against RFC 7636's own vector. What is
 * left here is the part only the app can get wrong: a secret that has to survive a
 * full-page redirect, be spent exactly once, and never appear in a URL.
 */
describe('gitlab sign-in (PKCE)', () => {
  const GITLAB: Identity = {
    provider: 'gitlab',
    subject: '12345',
    displayName: 'Amara',
    email: null,
    avatarUrl: null,
    profileUrl: 'https://gitlab.com/amara',
  };

  it('stores the verifier for the callback and sends only the challenge', async () => {
    const auth = makeService();
    const url = new URL(String(await auth.prepareSignIn('gitlab')));

    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? '{}') as {
      provider?: string;
      verifier?: string;
    };
    expect(pending.provider).toBe('gitlab');
    expect((pending.verifier ?? '').length).toBeGreaterThanOrEqual(43);

    expect(url.origin).toBe('https://gitlab.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).not.toBe(pending.verifier);
    // The one thing that must never happen: the secret in the address bar.
    expect(url.toString()).not.toContain(pending.verifier ?? 'no-verifier');
  });

  it('mints a fresh verifier per attempt', async () => {
    const auth = makeService();
    await auth.prepareSignIn('gitlab');
    const first = sessionStorage.getItem(PENDING_KEY);
    await auth.prepareSignIn('gitlab');
    expect(sessionStorage.getItem(PENDING_KEY)).not.toBe(first);
  });

  it('adds no PKCE parameters for providers that do not use it', async () => {
    const auth = makeService();
    const url = new URL(String(await auth.prepareSignIn('github')));
    expect(url.searchParams.get('code_challenge')).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? '{}')).not.toHaveProperty(
      'verifier',
    );
  });

  it('spends the verifier on the exchange and keeps the token for data reads', async () => {
    let sentBody = '';
    let tokenUrl = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (
      url: string,
      init: RequestInit,
    ) => {
      if (String(url).includes('/oauth/token')) {
        tokenUrl = String(url);
        sentBody = init.body as string;
        return new Response(
          JSON.stringify({ access_token: 'gl-token', scope: 'read_api' }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ id: 12345, username: 'amara', web_url: 'u' }),
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as unknown as typeof fetch);

    sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ provider: 'gitlab', state: 'st', verifier: 'the-verifier' }),
    );
    globalThis.history.replaceState({}, '', '/?code=c&state=st#/profile');

    const auth = makeService();
    await auth.completeSignInFromRedirect();

    // Straight to GitLab. If this ever became a cairn-auth route, the one architectural
    // claim ADR-0034 makes would be gone and every other test here would still pass.
    expect(tokenUrl).toBe('https://gitlab.com/oauth/token');
    expect(new URLSearchParams(sentBody).get('code_verifier')).toBe('the-verifier');
    expect(new URLSearchParams(sentBody).get('client_secret')).toBeNull();
    expect(auth.hasIdentity('gitlab')).toBe(true);
    // GitLab is a data connection, so unlike LinkedIn its token is retained.
    expect(auth.tokenFor('gitlab')).toBe('gl-token');
  });

  /**
   * The pending record is cleared before the exchange, so a replayed callback URL finds
   * nothing to spend. Without a verifier the exchange refuses outright rather than
   * downgrading to a plain code exchange, which GitLab would probably accept.
   */
  it('fails closed when the verifier is missing rather than downgrading', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ provider: 'gitlab', state: 'st' }),
    );
    globalThis.history.replaceState({}, '', '/?code=c&state=st#/profile');

    const auth = makeService();
    await auth.completeSignInFromRedirect();

    expect(auth.hasIdentity('gitlab')).toBe(false);
    expect(auth.error()).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps gitlab and github tokens apart', async () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        identities: [GITHUB, GITLAB],
        tokens: { github: 'gh-token', gitlab: 'gl-token' },
      }),
    );
    globalThis.history.replaceState({}, '', '/#/dashboard');
    const auth = makeService();
    await auth.completeSignInFromRedirect();

    expect(auth.githubToken).toBe('gh-token');
    expect(auth.tokenFor('gitlab')).toBe('gl-token');

    auth.signOut('gitlab');
    expect(auth.tokenFor('gitlab')).toBeNull();
    // Signing out of one data connection must not take the other with it.
    expect(auth.githubToken).toBe('gh-token');
  });

  it('still reads a session written before gitlab existed', async () => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ identities: [GITHUB], githubToken: 'gh-token' }),
    );
    globalThis.history.replaceState({}, '', '/#/dashboard');
    const auth = makeService();
    await auth.completeSignInFromRedirect();
    expect(auth.githubToken).toBe('gh-token');
  });
});
