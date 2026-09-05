/**
 * Central, UI-free configuration. Network allowlist here is the single source of
 * truth that the CSP `connect-src` and the CI bundle-origin guard are checked
 * against (SECURITY.md, scripts/check-bundle-origins.mjs).
 */

/** Origins the app is permitted to talk to. Keep in sync with apps/web/public/_headers. */
export const ALLOWED_CONNECT_ORIGINS: readonly string[] = [
  'https://api.github.com',
  'https://cairn-auth.mahmoudnasser98.workers.dev',
  'https://api.linkedin.com',
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
 */
const OAUTH_REDIRECT_URI = 'https://cairn.mahmoudnasser98.workers.dev/';
const OAUTH_EXCHANGE_BASE = 'https://cairn-auth.mahmoudnasser98.workers.dev';

export const OAUTH_PROVIDERS = {
  github: {
    id: 'github',
    label: 'GitHub',
    kind: 'github',
    clientId: 'Ov23lihiwqB2C0ahsnse',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenExchangeUrl: `${OAUTH_EXCHANGE_BASE}/github/token`,
    userInfoUrl: 'https://api.github.com/user',
    redirectUri: OAUTH_REDIRECT_URI,
    scopes: ['read:user'],
  },
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    kind: 'oidc',
    clientId: '781m6umb51095v',
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenExchangeUrl: `${OAUTH_EXCHANGE_BASE}/linkedin/token`,
    userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
    redirectUri: OAUTH_REDIRECT_URI,
    scopes: ['openid', 'profile', 'email'],
  },
  google: {
    id: 'google',
    label: 'Google',
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
  contributors: 12 * 60 * 60 * 1000,
  issues: 60 * 60 * 1000,
  pulls: 60 * 60 * 1000,
  commitActivity: 6 * 60 * 60 * 1000,
  releases: 12 * 60 * 60 * 1000,
} as const;

/** Total cache budget before LRU eviction kicks in. */
export const CACHE_MAX_ENTRIES = 2000;

/** CV upload safety limits (ADR-0011, SECURITY.md T7). */
export const CV_MAX_BYTES = 5 * 1024 * 1024;
export const CV_PARSE_TIMEOUT_MS = 10_000;
