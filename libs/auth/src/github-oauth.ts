/**
 * Framework-free GitHub OAuth helpers (ADR-0020, ADR-0024).
 *
 * GitHub's OAuth does not support Authorization Code + PKCE, so the browser cannot
 * complete the `code -> token` exchange directly (it would need the client secret).
 * A minimal stateless Cloudflare Worker holds the secret and performs that one step
 * (`api/optional-serverless/github-oauth/`). Everything else — the authorize
 * redirect, CSRF `state`, and the authenticated `GET /user` call — happens in the
 * client with the user's own token.
 *
 * This module has no Angular / DOM-framework dependencies so `apps/web` and, later,
 * `apps/extension` (ADR-0014) can both use it. It never logs the `code` or the token.
 */

export interface GithubOAuthConfig {
  /** OAuth App client ID. Public, not a secret. */
  readonly clientId: string;
  /** `https://github.com/login/oauth/authorize`. */
  readonly authorizeUrl: string;
  /** The token-exchange Worker endpoint (ADR-0024). */
  readonly tokenExchangeUrl: string;
  /** Exact redirect URI, must match the value registered on the OAuth App. */
  readonly redirectUri: string;
  /** Narrowest scopes that work (ADR-0020). Identity only needs `read:user`. */
  readonly scopes: readonly string[];
}

export interface GithubToken {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly scopes: readonly string[];
}

export interface GithubViewer {
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string;
  readonly htmlUrl: string;
  readonly email: string | null;
}

export type CallbackParams =
  | { readonly kind: 'code'; readonly code: string; readonly state: string }
  | {
      readonly kind: 'error';
      readonly error: string;
      readonly description: string | null;
    }
  | { readonly kind: 'none' };

/** Thrown for every auth failure. Messages never contain the code or token. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function defaultRandomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * A single-use CSRF `state` value (128 bits, hex). The caller stores it in
 * `sessionStorage` before redirecting and checks it once on return (ADR-0020).
 */
export function createStateToken(
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes,
): string {
  let hex = '';
  for (const byte of randomBytes(16)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Build the GitHub authorize URL to navigate the top-level window to. */
export function buildAuthorizeUrl(config: GithubOAuthConfig, state: string): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'true');
  return url.toString();
}

/** Classify a redirect-callback query string. State validation is the caller's job. */
export function parseCallbackParams(search: string): CallbackParams {
  const query = new URLSearchParams(search);
  const error = query.get('error');
  if (error !== null) {
    return { kind: 'error', error, description: query.get('error_description') };
  }
  const code = query.get('code');
  const state = query.get('state');
  if (code !== null && state !== null) return { kind: 'code', code, state };
  return { kind: 'none' };
}

export interface ExchangeOptions {
  readonly endpoint: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly fetchImpl?: typeof fetch;
}

interface TokenExchangeBody {
  readonly access_token?: string;
  readonly token_type?: string;
  readonly scope?: string;
  readonly error?: string;
  readonly error_description?: string;
}

/** POST the authorization code to the token-exchange Worker and parse its reply. */
export async function exchangeCodeForToken(opts: ExchangeOptions): Promise<GithubToken> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let res: Response;
  try {
    res = await doFetch(opts.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ code: opts.code, redirect_uri: opts.redirectUri }),
    });
  } catch {
    throw new AuthError('could not reach the sign-in service');
  }
  let body: TokenExchangeBody;
  try {
    body = (await res.json()) as TokenExchangeBody;
  } catch {
    throw new AuthError(`sign-in service returned an invalid response (${res.status})`);
  }
  if (!res.ok || body.error !== undefined || body.access_token === undefined) {
    throw new AuthError(
      body.error_description ?? body.error ?? `token exchange failed (${res.status})`,
    );
  }
  return {
    accessToken: body.access_token,
    tokenType: body.token_type ?? 'bearer',
    scopes:
      body.scope === undefined
        ? []
        : body.scope
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
  };
}

export interface ViewerOptions {
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  readonly apiBaseUrl?: string;
}

interface ViewerBody {
  readonly login: string;
  readonly name: string | null;
  readonly avatar_url: string;
  readonly html_url: string;
  readonly email: string | null;
}

/**
 * `GET /user` with the access token. Deliberately uncached — the identity is held
 * in memory for the session and re-fetched on the next sign-in (ADR-0020).
 */
export async function fetchViewer(opts: ViewerOptions): Promise<GithubViewer> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const base = opts.apiBaseUrl ?? 'https://api.github.com';
  let res: Response;
  try {
    res = await doFetch(`${base}/user`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${opts.token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
  } catch {
    throw new AuthError('could not reach GitHub');
  }
  if (!res.ok) throw new AuthError(`could not load your GitHub profile (${res.status})`);
  const user = (await res.json()) as ViewerBody;
  return {
    login: user.login,
    name: user.name ?? null,
    avatarUrl: user.avatar_url,
    htmlUrl: user.html_url,
    email: user.email ?? null,
  };
}
