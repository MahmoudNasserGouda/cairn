/**
 * Central, UI-free configuration. Network allowlist here is the single source of
 * truth that the CSP `connect-src` and the CI bundle-origin guard are checked
 * against (SECURITY.md, scripts/check-bundle-origins.mjs).
 */

/**
 * Capability flags. Framework-free and build-time, so every client reads the same
 * answer; `apps/web` wraps this in an injection token so both states stay testable.
 *
 * `ai` — the BYOK layer is built and correct but **frozen off**
 * ([ADR-0033](../../../docs/adr/0033-ai-capability-frozen.md)) while the deterministic
 * core it is meant to be optional *to* is brought up to strength. With it off nothing
 * can reach a provider: no key can be entered, no AI control renders, and `AiService`
 * refuses before it would even open the disclosure panel. Unfreezing is this one
 * constant — and ADRs 0009 and 0010 still govern what happens next.
 */
export const FEATURES = {
  ai: false,
} as const;

/** Origins the app is permitted to talk to. Keep in sync with apps/web/public/_headers. */
export const ALLOWED_CONNECT_ORIGINS: readonly string[] = [
  'https://api.github.com',
  'https://cairn-auth.mahmoudnasser98.workers.dev',
  'https://openidconnect.googleapis.com',
  'https://api.openai.com',
  'https://generativelanguage.googleapis.com',
  'https://openrouter.ai',
  'https://www.linkedin.com',
  'https://accounts.google.com',
  'https://oauth2.googleapis.com',
];

/**
 * OAuth sign-in providers (ADR-0020, ADR-0024, ADR-0025). `clientId` values are
 * public; set the real ones per deployment (empty / placeholder ⇒ that provider is
 * hidden). The `code -> token` step for every provider runs in the `cairn-auth`
 * Worker — none offer a usable public-client PKCE flow from a static origin.
 * `redirectUri` must exactly match each OAuth app's registered callback URL.
 *
 * Only `github` is a data connection; `linkedin` and `google` are identity only
 * (ADR-0025 — LinkedIn has no profile-data API, ADR-0012).
 *
 * `identityViaWorker`: LinkedIn's `userinfo` endpoint has no CORS headers, so the
 * browser cannot call it directly — the identity fetch is relayed through
 * `cairn-auth` instead (`identityExchangeUrl`), which needs only the access token,
 * not the client secret (ADR-0024).
 */
export const PRODUCTION_ORIGIN = 'https://cairn.mahmoudnasser98.workers.dev';
const OAUTH_EXCHANGE_BASE = 'https://cairn-auth.mahmoudnasser98.workers.dev';

/**
 * The callback URL handed to every provider. Derived from the origin the app is
 * actually served from, so `npm run -w @cairn/web start` on `localhost:4200` signs
 * in against localhost instead of bouncing the developer to production. Falls back
 * to the production origin outside a browser (unit tests, SSR-less tooling).
 *
 * This is not a trust boundary: each provider only accepts a `redirect_uri` that is
 * registered on its OAuth app, so an unregistered origin fails at the provider. To
 * enable a new origin you must register it there *and* add it to the Worker's
 * `ALLOWED_ORIGIN` list (`api/optional-serverless/oauth`).
 */
function resolveRedirectUri(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return origin !== undefined && origin.length > 0 && origin !== 'null'
    ? `${origin}/`
    : `${PRODUCTION_ORIGIN}/`;
}

const OAUTH_REDIRECT_URI = resolveRedirectUri();

export const OAUTH_PROVIDERS = {
  github: {
    id: 'github',
    label: 'GitHub',
    role: 'data',
    kind: 'github',
    clientId: 'Ov23lihiwqB2C0ahsnse',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenExchangeUrl: `${OAUTH_EXCHANGE_BASE}/github/token`,
    userInfoUrl: 'https://api.github.com/user',
    redirectUri: OAUTH_REDIRECT_URI,
    /**
     * Read-only, and deliberately short of `repo` (ADR-0030).
     *
     * `user:email` lets a CV's address be matched to the account, which is what makes
     * cross-source identity resolution possible at all. `read:org` unlocks
     * organisation affiliations. Both are reads.
     *
     * **Classic `repo` is not requested and must not be.** It grants full control of
     * private repositories *including write access to code* — GitHub offers no
     * read-only equivalent — and this token lives in `sessionStorage`. Private-repo
     * reading is a separate opt-in fine-grained PAT instead.
     */
    scopes: ['read:user', 'user:email', 'read:org'],
  },
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    role: 'identity',
    kind: 'oidc',
    clientId: '781m6umb51095v',
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenExchangeUrl: `${OAUTH_EXCHANGE_BASE}/linkedin/token`,
    userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
    identityViaWorker: true,
    identityExchangeUrl: `${OAUTH_EXCHANGE_BASE}/linkedin/identity`,
    redirectUri: OAUTH_REDIRECT_URI,
    scopes: ['openid', 'profile', 'email'],
  },
  google: {
    id: 'google',
    label: 'Google',
    role: 'identity',
    kind: 'oidc',
    clientId: '240010716894-oa879cie6cre2o86970prhl2f5toukb5.apps.googleusercontent.com',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenExchangeUrl: `${OAUTH_EXCHANGE_BASE}/google/token`,
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    redirectUri: OAUTH_REDIRECT_URI,
    scopes: ['openid', 'profile', 'email'],
  },
} as const;

/** Per-resource cache TTLs in milliseconds (ADR-0006). Open question: calibration. */
export const CACHE_TTL_MS = {
  repoMetadata: 24 * 60 * 60 * 1000,
  languages: 24 * 60 * 60 * 1000,
  repoSearch: 10 * 60 * 1000,
  contributors: 12 * 60 * 60 * 1000,
  issues: 60 * 60 * 1000,
  pulls: 60 * 60 * 1000,
  commitActivity: 6 * 60 * 60 * 1000,
  releases: 12 * 60 * 60 * 1000,
  /** The whole viewer profile, in one GraphQL request (ADR-0030). */
  viewer: 60 * 60 * 1000,
} as const;

/** Total cache budget before LRU eviction kicks in. */
export const CACHE_MAX_ENTRIES = 2000;

/** CV upload safety limits (ADR-0011, SECURITY.md T7). */
export const CV_MAX_BYTES = 5 * 1024 * 1024;
export const CV_PARSE_TIMEOUT_MS = 10_000;
