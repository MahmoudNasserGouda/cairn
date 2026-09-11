import { Injectable, computed, inject, signal } from '@angular/core';
import {
  AuthError,
  buildAuthorizeUrl,
  createStateToken,
  exchangeCodeForToken,
  fetchIdentity,
  isProviderConfigured,
  parseCallbackParams,
  type Identity,
  type OAuthProvider,
  type ProviderId,
} from '@cairn/auth';
import { OAUTH_PROVIDERS } from '@cairn/shared';
import { IndexedDbStore } from '../indexeddb-store';

const PENDING_KEY = 'cairn.oauth.pending';
const SESSION_KEY = 'cairn.session.v1';
const GH_CACHE_PREFIX = 'gh:';
const PROVIDER_ORDER: readonly ProviderId[] = ['github', 'linkedin', 'google'];

const PROVIDERS = OAUTH_PROVIDERS as Record<ProviderId, OAuthProvider>;

export type AuthStatus = 'anonymous' | 'authenticating' | 'ready' | 'error';

interface PendingRedirect {
  readonly provider: ProviderId;
  readonly state: string;
}

interface PersistedSession {
  readonly identities: readonly Identity[];
  readonly githubToken: string | null;
}

/**
 * Multi-provider sign-in for the web app (ADR-0020, ADR-0025). Access tokens live in
 * memory for the session only — never LocalStorage, never IndexedDB, never logged.
 * Only the GitHub token is retained (it reads repositories); LinkedIn / Google are
 * identity only, so their tokens are dropped right after the profile fetch.
 * Every `code -> token` exchange goes through the `cairn-auth` Worker (ADR-0024).
 *
 * To survive a page refresh (but not a tab close), the identities and the GitHub
 * token are mirrored into `sessionStorage` — never LocalStorage / IndexedDB, and
 * wiped on sign-out (ADR-0020 correction 2026-09-10).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly store = inject(IndexedDbStore);

  private readonly _status = signal<AuthStatus>('anonymous');
  private readonly _identities = signal<readonly Identity[]>([]);
  private readonly _error = signal<string | null>(null);
  private readonly tokens = new Map<ProviderId, string>();

  readonly status = this._status.asReadonly();
  readonly identities = this._identities.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isSignedIn = computed(() => this._identities().length > 0);

  /** Identity shown in the header — GitHub if connected, otherwise the first. */
  readonly primaryIdentity = computed(
    () =>
      this._identities().find((i) => i.provider === 'github') ??
      this._identities()[0] ??
      null,
  );

  /** Providers with a real client ID set, in a stable order. */
  readonly availableProviders: readonly OAuthProvider[] = PROVIDER_ORDER.map(
    (id) => PROVIDERS[id],
  ).filter(isProviderConfigured);

  /** The one data connection (GitHub), if configured. */
  readonly dataProvider: OAuthProvider | null =
    this.availableProviders.find((p) => p.role === 'data') ?? null;

  /** Identity-only providers (LinkedIn, Google), if configured. */
  readonly identityProviders: readonly OAuthProvider[] = this.availableProviders.filter(
    (p) => p.role === 'identity',
  );

  /** GitHub access token for API calls, if signed in with GitHub. */
  get githubToken(): string | null {
    return this.tokens.get('github') ?? null;
  }

  hasIdentity(provider: ProviderId): boolean {
    return this._identities().some((i) => i.provider === provider);
  }

  /** The connected identity for a provider, or null. */
  identityFor(provider: ProviderId): Identity | null {
    return this._identities().find((i) => i.provider === provider) ?? null;
  }

  /** Start the redirect flow for one provider. Navigates away on success. */
  signIn(providerId: ProviderId): void {
    const provider = PROVIDERS[providerId];
    if (!isProviderConfigured(provider)) {
      this.fail(`${provider.label} sign-in is not configured yet`);
      return;
    }
    const state = createStateToken();
    const pending: PendingRedirect = { provider: providerId, state };
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    } catch {
      this.fail('this browser blocked session storage, which sign-in needs');
      return;
    }
    this._error.set(null);
    globalThis.location.assign(buildAuthorizeUrl(provider, state));
  }

  /** Sign out of one provider, or of everything when called with no argument. */
  signOut(providerId?: ProviderId): void {
    if (providerId === undefined) {
      this.tokens.clear();
      this._identities.set([]);
    } else {
      this.tokens.delete(providerId);
      this._identities.update((list) => list.filter((i) => i.provider !== providerId));
    }
    this._status.set(this._identities().length > 0 ? 'ready' : 'anonymous');
    this._error.set(null);
    this.persistSession();
    if (providerId === undefined || providerId === 'github') {
      void this.wipeGithubCache();
    }
  }

  /**
   * Run once at startup. Rehydrates any stored session, then — if the current URL
   * is an OAuth callback — finishes that flow and strips the query string.
   */
  async completeSignInFromRedirect(): Promise<void> {
    // Always rehydrate first. A callback load is still a *fresh* page: without this
    // the identities and GitHub token saved before the redirect are absent, and the
    // `persistSession()` at the end of this method would overwrite them with the one
    // provider that just came back — silently disconnecting GitHub whenever a user
    // adds a second identity.
    this.restoreSession();

    const params = parseCallbackParams(globalThis.location.search);
    if (params.kind === 'none') return;

    const pending = readAndClearPending();
    cleanUrl();

    if (params.kind === 'error') {
      if (params.error !== 'access_denied') {
        this.fail(params.description ?? params.error);
      }
      return;
    }
    if (pending === null || params.state !== pending.state) {
      this.fail('sign-in could not be verified; please try again');
      return;
    }
    const provider = PROVIDERS[pending.provider];

    this._status.set('authenticating');
    try {
      const token = await exchangeCodeForToken({ provider, code: params.code });
      const identity = await fetchIdentity({ provider, token: token.accessToken });
      if (provider.id === 'github') {
        this.tokens.set('github', token.accessToken);
      }
      this._identities.update((list) => [
        ...list.filter((i) => i.provider !== provider.id),
        identity,
      ]);
      this._status.set('ready');
      this.persistSession();
    } catch (e) {
      this.fail(e instanceof AuthError ? e.message : 'sign-in failed');
    }
  }

  /** Mirror identities + GitHub token to sessionStorage (best-effort). */
  private persistSession(): void {
    try {
      const identities = this._identities();
      if (identities.length === 0) {
        sessionStorage.removeItem(SESSION_KEY);
        return;
      }
      const payload: PersistedSession = {
        identities,
        githubToken: this.tokens.get('github') ?? null,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    } catch {
      /* a session that cannot be remembered is not worth an error banner */
    }
  }

  /** Rehydrate from sessionStorage on a normal page load. */
  private restoreSession(): void {
    let raw: string | null;
    try {
      raw = sessionStorage.getItem(SESSION_KEY);
    } catch {
      return;
    }
    if (raw === null) return;
    try {
      const parsed = JSON.parse(raw) as PersistedSession;
      const identities = Array.isArray(parsed.identities)
        ? parsed.identities.filter(
            (i): i is Identity => !!i && typeof (i as Identity).provider === 'string',
          )
        : [];
      const token = typeof parsed.githubToken === 'string' ? parsed.githubToken : null;
      if (identities.length === 0) {
        sessionStorage.removeItem(SESSION_KEY);
        return;
      }
      this.tokens.clear();
      if (token) this.tokens.set('github', token);
      this._identities.set(identities);
      this._status.set('ready');
    } catch {
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  private fail(message: string): void {
    this._status.set(this._identities().length > 0 ? 'ready' : 'error');
    this._error.set(message);
  }

  private async wipeGithubCache(): Promise<void> {
    try {
      for (const key of await this.store.keys(GH_CACHE_PREFIX)) {
        await this.store.delete(key);
      }
    } catch {
      /* best-effort; nothing sensitive is left if this fails */
    }
  }
}

function readAndClearPending(): PendingRedirect | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as PendingRedirect;
    return typeof parsed.provider === 'string' && typeof parsed.state === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function cleanUrl(): void {
  const { pathname, hash } = globalThis.location;
  globalThis.history.replaceState({}, '', pathname + (hash || '#/dashboard'));
}
