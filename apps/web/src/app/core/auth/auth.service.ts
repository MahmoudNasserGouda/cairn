import { Injectable, computed, inject, signal } from '@angular/core';
import {
  AuthError,
  buildAuthorizeUrl,
  createStateToken,
  exchangeCodeForToken,
  fetchViewer,
  parseCallbackParams,
  type GithubViewer,
} from '@cairn/auth';
import { GITHUB_OAUTH } from '@cairn/shared';
import { IndexedDbStore } from '../indexeddb-store';

const STATE_KEY = 'cairn.oauth.github.state';
const GH_CACHE_PREFIX = 'gh:';

export type AuthStatus = 'anonymous' | 'authenticating' | 'authenticated' | 'error';

/**
 * GitHub sign-in for the web app (ADR-0020). The access token lives in memory for
 * the session only — never LocalStorage, never IndexedDB, never logged. The
 * `code -> token` step goes through the token-exchange Worker (ADR-0024).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly store = inject(IndexedDbStore);

  private readonly _status = signal<AuthStatus>('anonymous');
  private readonly _viewer = signal<GithubViewer | null>(null);
  private readonly _error = signal<string | null>(null);
  private token: string | null = null;

  readonly status = this._status.asReadonly();
  readonly viewer = this._viewer.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isAuthenticated = computed(() => this._status() === 'authenticated');

  /**
   * False until a real OAuth App client ID is set in `libs/shared/src/config.ts`
   * (and `wrangler secret put GITHUB_CLIENT_SECRET` has been run for `cairn-auth`).
   * The header hides the button rather than sending the user to a GitHub 404.
   */
  readonly isConfigured =
    GITHUB_OAUTH.clientId.length > 0 &&
    !GITHUB_OAUTH.clientId.includes('0000000000000000');

  /** Access token for the current session, in memory only. */
  get accessToken(): string | null {
    return this.token;
  }

  /** Start the redirect flow. Navigates away — nothing after this call runs. */
  signIn(): void {
    if (!this.isConfigured) {
      this.fail('GitHub sign-in is not configured yet');
      return;
    }
    const state = createStateToken();
    try {
      sessionStorage.setItem(STATE_KEY, state);
    } catch {
      this.fail('this browser blocked session storage, which sign-in needs');
      return;
    }
    this._error.set(null);
    globalThis.location.assign(buildAuthorizeUrl(GITHUB_OAUTH, state));
  }

  signOut(): void {
    this.token = null;
    this._viewer.set(null);
    this._status.set('anonymous');
    this._error.set(null);
    void this.wipeGithubCache();
  }

  /**
   * Run once at startup. If the current URL is an OAuth callback, finish the flow
   * and strip the query string. A no-op on a normal load.
   */
  async completeSignInFromRedirect(): Promise<void> {
    const params = parseCallbackParams(globalThis.location.search);
    if (params.kind === 'none') return;

    const expected = readAndClearState();
    cleanUrl();

    if (params.kind === 'error') {
      // The user declining on GitHub is a normal outcome, not an error state.
      if (params.error !== 'access_denied') {
        this.fail(params.description ?? params.error);
      }
      return;
    }
    if (expected === null || params.state !== expected) {
      this.fail('sign-in could not be verified; please try again');
      return;
    }

    this._status.set('authenticating');
    try {
      const token = await exchangeCodeForToken({
        endpoint: GITHUB_OAUTH.tokenExchangeUrl,
        code: params.code,
        redirectUri: GITHUB_OAUTH.redirectUri,
      });
      const viewer = await fetchViewer({ token: token.accessToken });
      this.token = token.accessToken;
      this._viewer.set(viewer);
      this._status.set('authenticated');
    } catch (e) {
      this.fail(e instanceof AuthError ? e.message : 'sign-in failed');
    }
  }

  private fail(message: string): void {
    this.token = null;
    this._viewer.set(null);
    this._status.set('error');
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

function readAndClearState(): string | null {
  try {
    const value = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    return value;
  } catch {
    return null;
  }
}

function cleanUrl(): void {
  const { pathname, hash } = globalThis.location;
  globalThis.history.replaceState({}, '', pathname + (hash || '#/dashboard'));
}
