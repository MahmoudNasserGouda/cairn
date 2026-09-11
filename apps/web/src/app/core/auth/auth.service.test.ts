import { describe, expect, it, beforeEach, vi } from 'vitest';
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

/** Put the page on an OAuth callback URL with a matching pending record. */
function arriveOnCallback(state: string, code = 'the-code'): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ provider: 'google', state }));
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: {
      search: `?code=${code}&state=${state}`,
      pathname: '/',
      hash: '#/dashboard',
      origin: 'https://app.example',
      href: 'https://app.example/',
      assign: vi.fn(),
    },
  });
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
      githubToken: string | null;
    };
    expect(stored.identities.map((i) => i.provider).sort()).toEqual(['github', 'google']);
    expect(stored.githubToken).toBe('gh-token');
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
