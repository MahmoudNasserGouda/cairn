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

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/**
 * Remove every `<...>` span, scanning once from left to right.
 *
 * This was `/<[^>]*>/g`, which CodeQL flagged twice — and one of the two was real.
 * A run of `<` with no `>` made it quadratic: the engine consumed the rest of the
 * string looking for a `>`, failed, backtracked the whole run, and started again from
 * the next offset. **200k `<` took 22 seconds.** `parseCvText` runs every imported CV
 * through here, so that is untrusted input (SECURITY.md T7) on a hot path.
 *
 * The second alert — `js/incomplete-multi-character-sanitization`, "may still contain
 * `<script`" — could not be reproduced against the old pattern and does not apply to
 * this one either, for a reason worth stating rather than assuming. The scan always
 * runs from a `<` to the **next** `>`, so any `<` left in the output has no `>` after
 * it anywhere, and therefore cannot open a tag. A removal can never splice two halves
 * into a new one. `sanitizer.test.ts` asserts that on the shapes that break naive
 * strippers, so it is a test rather than an argument.
 *
 * A `<` with no closing `>` is kept verbatim, which is what the regex did too: it is
 * text, not markup, and dropping it would silently eat a "5 < 10".
 */
function stripTags(dirty: string): string {
  let out = '';
  let at = 0;

  for (;;) {
    const open = dirty.indexOf('<', at);
    if (open === -1) return out + dirty.slice(at);

    out += dirty.slice(at, open);
    const close = dirty.indexOf('>', open + 1);
    if (close === -1) return out + dirty.slice(open);

    at = close + 1;
  }
}

/**
 * Dependency-free, DOM-free fallback: remove all markup and decode basic entities.
 * Not a substitute for the DOMPurify pipeline when rendering rich content — it is
 * the safe default when only plain text is needed.
 */
export function stripToText(dirty: string): string {
  return stripTags(dirty)
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITY_MAP[m.toLowerCase()] ?? m)
    .trim();
}

/** A no-frills sanitizer usable in non-DOM contexts (SSR-less, tests, portfolio text). */
export const plainTextSanitizer: HtmlSanitizer = {
  sanitize: (dirty) => stripToText(dirty),
};
