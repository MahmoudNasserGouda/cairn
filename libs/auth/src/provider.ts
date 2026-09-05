/**
 * Framework-free multi-provider OAuth helpers (ADR-0020, ADR-0024, ADR-0025).
 *
 * Cairn signs the user in with GitHub, LinkedIn, or Google. **Only GitHub is a data
 * connection** — its token is used to read repositories. LinkedIn and Google are
 * identity only: name, email, avatar (ADR-0025; LinkedIn has no profile-data API —
 * ADR-0012).
 *
 * None of these providers support a usable public-client PKCE flow from a static
 * origin, so the `code -> token` step goes through the stateless `cairn-auth` Worker
 * (`api/optional-serverless/oauth/`, ADR-0024). The authorize redirect, single-use
 * CSRF `state`, and the userinfo call stay in the client.
 *
 * No Angular / DOM-framework imports — `apps/web` and later `apps/extension`
 * (ADR-0014) both use this. The `code` and tokens are never logged.
 */

export type ProviderId = 'github' | 'linkedin' | 'google';

export interface OAuthProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** `github` uses the REST user endpoint; `oidc` uses an OpenID `userinfo` endpoint. */
  readonly kind: 'github' | 'oidc';
  /** OAuth client ID. Public, not a secret. Empty / placeholder ⇒ provider disabled. */
  readonly clientId: string;
  readonly authorizeUrl: string;
  /** `cairn-auth` route for this provider, e.g. `https://cairn-auth…/github/token`. */
  readonly tokenExchangeUrl: string;
  /** `https://api.github.com/user` or the provider's OIDC `userinfo` URL. */
  readonly userInfoUrl: string;
  /**
   * True when `userInfoUrl` has no CORS headers, so the browser cannot call it
   * directly — the identity fetch is relayed through `cairn-auth`'s
   * `identityExchangeUrl` instead (needs only the access token, no client secret).
   */
  readonly identityViaWorker?: boolean;
  readonly identityExchangeUrl?: string;
  /** Exact redirect URI; must match what is registered on the OAuth app. */
  readonly redirectUri: string;
  readonly scopes: readonly string[];
}

export interface OAuthToken {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly scopes: readonly string[];
}

/** Normalised identity across providers. `subject` is the provider's stable user id. */
export interface Identity {
  readonly provider: ProviderId;
  readonly subject: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly profileUrl: string | null;
}

export type CallbackParams =
  | { readonly kind: 'code'; readonly code: string; readonly state: string }
  | {
      readonly kind: 'error';
      readonly error: string;
      readonly description: string | null;
    }
  | { readonly kind: 'none' };

/** Thrown for every auth failure. Messages never contain the code or a token. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** True unless the client ID is empty or the committed placeholder. */
export function isProviderConfigured(provider: OAuthProvider): boolean {
  const id = provider.clientId;
  return id.length > 0 && !/^(x{3,}|0{8,}|changeme|placeholder|set-)/i.test(id);
}

function defaultRandomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * A single-use CSRF `state` (128 bits, hex). The caller stores it (with the provider
 * id) in `sessionStorage` before redirecting and checks it once on return.
 */
export function createStateToken(
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes,
): string {
  let hex = '';
  for (const byte of randomBytes(16)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Build the provider's authorize URL to navigate the top-level window to. */
export function buildAuthorizeUrl(provider: OAuthProvider, state: string): string {
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', provider.redirectUri);
  url.searchParams.set('scope', provider.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  if (provider.id === 'github') {
    url.searchParams.set('allow_signup', 'true');
  }
  if (provider.id === 'google') {
    // Identity only — no refresh token, and let the user pick the account.
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');
  }
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
  readonly provider: OAuthProvider;
  readonly code: string;
  readonly fetchImpl?: typeof fetch;
}

interface TokenExchangeBody {
  readonly access_token?: string;
  readonly token_type?: string;
  readonly scope?: string;
  readonly error?: string;
  readonly error_description?: string;
}

/** POST the authorization code to the `cairn-auth` Worker and parse its reply. */
export async function exchangeCodeForToken(opts: ExchangeOptions): Promise<OAuthToken> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let res: Response;
  try {
    res = await doFetch(opts.provider.tokenExchangeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        code: opts.code,
        redirect_uri: opts.provider.redirectUri,
      }),
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
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
  };
}
