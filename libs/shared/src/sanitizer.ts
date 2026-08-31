/**
 * HTML sanitisation contract (ADR-0019, SECURITY.md T1/T15).
 *
 * All content originating outside our own code — GitHub Markdown, issue/PR bodies,
 * AI responses, CV text, user free-text — MUST pass through an `HtmlSanitizer`
 * before it reaches the DOM.
 *
 * `apps/web` supplies a DOMPurify-backed implementation configured with the
 * allowlist below. This module ships only the contract plus a dependency-free
 * `stripToText` fallback, so libs stay framework/DOM-free.
 */
export interface HtmlSanitizer {
  /** Return HTML safe to assign to a Trusted-Types sink. */
  sanitize(dirtyHtml: string): string;
}

/** Tag allowlist for the web app's DOMPurify configuration. */
export const ALLOWED_TAGS: readonly string[] = [
  'a',
  'p',
  'br',
  'hr',
  'em',
  'strong',
  'del',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
];

export const ALLOWED_ATTR: readonly string[] = ['href', 'title', 'alt', 'src'];

/** Schemes permitted in href/src. Anything else (javascript:, data:) is dropped. */
export const ALLOWED_URI_SCHEMES: readonly string[] = ['https', 'mailto'];

const TAG_RE = /<[^>]*>/g;
const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/**
 * Dependency-free, DOM-free fallback: remove all markup and decode basic entities.
 * Not a substitute for the DOMPurify pipeline when rendering rich content — it is
 * the safe default when only plain text is needed.
 */
export function stripToText(dirty: string): string {
  return dirty
    .replace(TAG_RE, '')
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITY_MAP[m.toLowerCase()] ?? m)
    .trim();
}

/** A no-frills sanitizer usable in non-DOM contexts (SSR-less, tests, portfolio text). */
export const plainTextSanitizer: HtmlSanitizer = {
  sanitize: (dirty) => stripToText(dirty),
};
