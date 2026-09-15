import { Injectable, computed, inject, signal } from '@angular/core';
import {
  AuthError,
  buildAuthorizeUrl,
  createPkcePair,
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
const PROVIDER_ORDER: readonly ProviderId[] = ['github', 'gitlab', 'linkedin', 'google'];

const PROVIDERS = OAUTH_PROVIDERS as Record<ProviderId, OAuthProvider>;

export type AuthStatus = 'anonymous' | 'authenticating' | 'ready' | 'error';

interface PendingRedirect {
  readonly provider: ProviderId;
  readonly state: string;
  /**
   * The PKCE verifier, for providers that use it (ADR-0034). It has to outlive a
   * full-page redirect, which is why it is here and not in a field, and it is read
   * exactly once — `readAndClearPending` removes the record before the exchange, so a
   * replayed callback URL finds nothing to spend.
   */
  readonly verifier?: string;
}

interface PersistedSession {
  readonly identities: readonly Identity[];
  /** Access tokens for data connections, by provider. Session-scoped (ADR-0020). */
  readonly tokens?: Readonly<Record<string, string>>;
  /** Pre-GitLab shape, still read so an open tab survives the deploy that adds it. */
  readonly githubToken?: string | null;
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

  /** Data connections — GitHub, and GitLab once an application id is set. */
  readonly dataProviders: readonly OAuthProvider[] = this.availableProviders.filter(
    (p) => p.role === 'data',
  );

  /** The primary data connection (GitHub), if configured. */
  readonly dataProvider: OAuthProvider | null = this.dataProviders[0] ?? null;

  /** Identity-only providers (LinkedIn, Google), if configured. */
  readonly identityProviders: readonly OAuthProvider[] = this.availableProviders.filter(
    (p) => p.role === 'identity',
  );

  /** GitHub access token for API calls, if signed in with GitHub. */
  get githubToken(): string | null {
    return this.tokens.get('github') ?? null;
  }

  /**
   * The retained access token for a data connection, or null.
   *
   * Only `role: 'data'` providers have one: an identity-only token is dropped straight
   * after its one userinfo call and never reaches this map (ADR-0025).
   */
  tokenFor(provider: ProviderId): string | null {
    return this.tokens.get(provider) ?? null;
  }

  hasIdentity(provider: ProviderId): boolean {
    return this._identities().some((i) => i.provider === provider);
  }

  /** The connected identity for a provider, or null. */
  identityFor(provider: ProviderId): Identity | null {
    return this._identities().find((i) => i.provider === provider) ?? null;
  }

  /** Start the redirect flow for one provider. Navigates away on success. */
  async signIn(providerId: ProviderId): Promise<void> {
    const url = await this.prepareSignIn(providerId);
    if (url !== null) globalThis.location.assign(url);
  }

  /**
   * Everything `signIn` does except the navigation: mint the CSRF `state`, mint a PKCE
   * verifier for providers that need one, store the pending record, and return the
   * authorize URL.
   *
   * Split out because it is the half with decisions in it and `location.assign` cannot
   * be stubbed — jsdom makes `location` non-configurable, which is the same wall that
   * pushed the callback tests onto `history.replaceState`. Navigation is then a single
   * line with nothing to get wrong, and the interesting part is directly testable.
   *
   * Returns null when the provider is not configured; the error is already set.
   */
  async prepareSignIn(providerId: ProviderId): Promise<string | null> {
    const provider = PROVIDERS[providerId];
    if (!isProviderConfigured(provider)) {
      this.fail(`${provider.label} sign-in is not configured yet`);
      return null;
    }
    const state = createStateToken();
    // Minted per attempt, never reused: a verifier is single-use by definition, and a
    // shared one would let an intercepted code from an earlier attempt be spent.
    const pkce = provider.pkce === true ? await createPkcePair() : null;
    const pending: PendingRedirect = {
      provider: providerId,
      state,
      ...(pkce !== null ? { verifier: pkce.verifier } : {}),
    };
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    } catch {
      this.fail('this browser blocked session storage, which sign-in needs');
      return null;
    }
    this._error.set(null);
    return buildAuthorizeUrl(provider, state, pkce?.challenge);
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
      const token = await exchangeCodeForToken({
        provider,
        code: params.code,
        ...(pending.verifier !== undefined ? { verifier: pending.verifier } : {}),
      });
      const identity = await fetchIdentity({ provider, token: token.accessToken });
      // Data connections keep their token to read with; identity-only providers drop
      // theirs here and never see it again (ADR-0025).
      if (provider.role === 'data') {
        this.tokens.set(provider.id, token.accessToken);
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
        tokens: Object.fromEntries(this.tokens),
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
      if (identities.length === 0) {
        sessionStorage.removeItem(SESSION_KEY);
        return;
      }
      this.tokens.clear();
      // `githubToken` is the pre-GitLab shape. Still read, so a tab open across the
      // deploy that adds GitLab keeps its GitHub connection instead of silently
      // dropping it on the next refresh.
      const legacy = parsed.githubToken;
      if (typeof legacy === 'string' && legacy.length > 0) {
        this.tokens.set('github', legacy);
      }
      for (const [provider, token] of Object.entries(parsed.tokens ?? {})) {
        if (typeof token === 'string' && token.length > 0) {
          this.tokens.set(provider as ProviderId, token);
        }
      }
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
