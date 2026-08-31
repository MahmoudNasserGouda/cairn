/**
 * Central, UI-free configuration. Network allowlist here is the single source of
 * truth that the CSP `connect-src` and the CI bundle-origin guard are checked
 * against (SECURITY.md, scripts/check-bundle-origins.mjs).
 */

/** Origins the app is permitted to talk to. Keep in sync with apps/web/public/_headers. */
export const ALLOWED_CONNECT_ORIGINS: readonly string[] = [
  'https://api.github.com',
  'https://api.openai.com',
  'https://generativelanguage.googleapis.com',
  'https://openrouter.ai',
  'https://www.linkedin.com',
  'https://accounts.google.com',
  'https://oauth2.googleapis.com',
];

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
