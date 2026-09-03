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
const GH_CACHE_PREFIX = 'gh:';
const PROVIDER_ORDER: readonly ProviderId[] = ['github', 'linkedin', 'google'];

const PROVIDERS = OAUTH_PROVIDERS as Record<ProviderId, OAuthProvider>;

export type AuthStatus = 'anonymous' | 'authenticating' | 'ready' | 'error';

interface PendingRedirect {
  readonly provider: ProviderId;
  readonly state: string;
}

/**
 * Multi-provider sign-in for the web app (ADR-0020, ADR-0025). Access tokens live in
 * memory for the session only — never LocalStorage, never IndexedDB, never logged.
 * Only the GitHub token is retained (it reads repositories); LinkedIn / Google are
 * identity only, so their tokens are dropped right after the profile fetch.
 * Every `code -> token` exchange goes through the `cairn-auth` Worker (ADR-0024).
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

  /** GitHub access token for API calls, if signed in with GitHub. */
  get githubToken(): string | null {
    return this.tokens.get('github') ?? null;
  }

  hasIdentity(provider: ProviderId): boolean {
    return this._identities().some((i) => i.provider === provider);
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
    if (providerId === undefined || providerId === 'github') {
      void this.wipeGithubCache();
    }
  }

  /**
   * Run once at startup. If the current URL is an OAuth callback, finish the flow
   * and strip the query string. A no-op on a normal load.
   */
  async completeSignInFromRedirect(): Promise<void> {
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
    } catch (e) {
      this.fail(e instanceof AuthError ? e.message : 'sign-in failed');
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
