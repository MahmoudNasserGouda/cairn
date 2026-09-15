/**
 * Framework-free multi-provider OAuth helpers (ADR-0020, ADR-0024, ADR-0025).
 *
 * Cairn signs the user in with GitHub, LinkedIn, or Google. **Only GitHub is a data
 * connection** — its token is used to read repositories. LinkedIn and Google are
 * identity only: name, email, avatar (ADR-0025; LinkedIn has no profile-data API —
 * ADR-0012).
 *
 * GitHub, LinkedIn and Google support no usable public-client PKCE flow from a static
 * origin, so their `code -> token` step goes through the stateless `cairn-auth` Worker
 * (`api/optional-serverless/oauth/`, ADR-0024). The authorize redirect, single-use
 * CSRF `state`, and the userinfo call stay in the client.
 *
 * **GitLab is the exception, and it is the interesting one** (ADR-0034). It advertises
 * `S256` for public clients, so its exchange runs in the browser against GitLab's own
 * token endpoint with no secret and no Worker anywhere in the path — the first evidence
 * in this codebase that `cairn-auth` is a provider limitation rather than a design
 * necessity. Providers carrying `pkce: true` take that path; everyone else is unchanged.
 *
 * No Angular / DOM-framework imports — `apps/web` and later `apps/extension`
 * (ADR-0014) both use this. The `code` and tokens are never logged.
 */

import { PKCE_METHOD } from './pkce';

export type ProviderId = 'github' | 'linkedin' | 'google' | 'gitlab';

export interface OAuthProvider {
  readonly id: ProviderId;
  readonly label: string;
  /**
   * `data` — the token is kept and used to read the user's content (GitHub repos).
   * `identity` — sign-in only; the token is discarded after the one userinfo call
   * and Cairn only ever gets name / email / avatar (ADR-0025).
   */
  readonly role: 'data' | 'identity';
  /**
   * How the identity call is shaped: `github` and `gitlab` each use their REST user
   * endpoint (different field names), `oidc` an OpenID `userinfo` endpoint.
   */
  readonly kind: 'github' | 'oidc' | 'gitlab';
  /**
   * True when the provider supports Authorization Code + PKCE for a public client.
   *
   * It changes two things and they travel together: the authorize URL carries a
   * `code_challenge`, and `tokenExchangeUrl` stops meaning "a `cairn-auth` route" and
   * starts meaning "the provider's own token endpoint". There is no client secret on
   * this path, because there is nowhere in a static bundle to put one.
   */
  readonly pkce?: boolean;
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

/**
 * Build the provider's authorize URL to navigate the top-level window to.
 *
 * `codeChallenge` is required for a `pkce` provider and ignored by every other. Note
 * that it is the *challenge* — the hash — never the verifier: this string ends up in a
 * URL, in history, and in the provider's logs.
 */
export function buildAuthorizeUrl(
  provider: OAuthProvider,
  state: string,
  codeChallenge?: string,
): string {
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', provider.redirectUri);
  url.searchParams.set('scope', provider.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  if (provider.pkce === true && codeChallenge !== undefined) {
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', PKCE_METHOD);
  }
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
  /**
   * The PKCE verifier kept from before the redirect. **Required** when
   * `provider.pkce` is true, and an error rather than an omission if missing — see
   * `exchangeCodeForToken`.
   */
  readonly verifier?: string;
  readonly fetchImpl?: typeof fetch;
}

interface TokenExchangeBody {
  readonly access_token?: string;
  readonly token_type?: string;
  readonly scope?: string;
  readonly error?: string;
  readonly error_description?: string;
}

/**
 * Turn an authorization code into a token, by whichever of the two routes the provider
 * supports.
 *
 * - **PKCE** (`provider.pkce`) — a form-encoded POST straight to the provider, carrying
 *   the verifier and no secret. `application/x-www-form-urlencoded` is CORS-safelisted,
 *   so this is a simple request and costs no preflight; JSON would add a round trip for
 *   nothing.
 * - **Worker** — a JSON POST to `cairn-auth`, which holds the client secret the provider
 *   insists on (ADR-0024).
 *
 * Neither branch ever puts the code in an error message.
 */
export async function exchangeCodeForToken(opts: ExchangeOptions): Promise<OAuthToken> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const usePkce = opts.provider.pkce === true;

  if (usePkce && (opts.verifier === undefined || opts.verifier.length === 0)) {
    // Deliberately fails here rather than sending the request without it. GitLab would
    // very likely accept a plain code exchange, so a missing verifier would silently
    // downgrade the flow to the one PKCE exists to replace — and it would *work*, which
    // is what makes it dangerous rather than merely broken.
    throw new AuthError(`${opts.provider.label} sign-in could not be completed securely`);
  }

  let res: Response;
  try {
    res = await doFetch(
      opts.provider.tokenExchangeUrl,
      usePkce
        ? {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              accept: 'application/json',
            },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: opts.provider.clientId,
              code: opts.code,
              redirect_uri: opts.provider.redirectUri,
              code_verifier: opts.verifier as string,
            }).toString(),
          }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              code: opts.code,
              redirect_uri: opts.provider.redirectUri,
            }),
          },
    );
  } catch {
    throw new AuthError(
      usePkce
        ? `could not reach ${opts.provider.label}`
        : 'could not reach the sign-in service',
    );
  }
  let body: TokenExchangeBody;
  try {
    body = (await res.json()) as TokenExchangeBody;
  } catch {
    throw new AuthError(
      usePkce
        ? `${opts.provider.label} returned an invalid response (${res.status})`
        : `sign-in service returned an invalid response (${res.status})`,
    );
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
