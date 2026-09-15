/**
 * Design-token contract guard (ADR-0032, docs/design-system.md).
 *
 * > A token-contract test fails the build when a referenced variable stops existing,
 * > so a removed token is a red test rather than a silently unstyled page.
 *
 * That failure mode is the whole reason this exists. CSS custom properties fail
 * **quietly**: `color: var(--fg-mutedd)` does not throw, does not warn, and does not
 * show up in a typecheck — the declaration is dropped and the text inherits whatever
 * was above it. On a page with a lot of muted text that reads as a styling choice
 * rather than a bug, and it survives review.
 *
 * A guard rather than a Vitest case, for the same reason `check-csp.mjs` is one: it
 * is static analysis over source files, not a behaviour anyone can render. It also
 * keeps `node:fs` out of the Angular test program, where `apps/web/tsconfig.json`
 * sets `types: []` and the linter cannot resolve it.
 *
 *   node scripts/check-tokens.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const SRC = 'apps/web/src';
const TOKENS = join(SRC, 'styles', 'tokens.css');

/** `var(--x)` and `var(--x, fallback)` — the name is all we need. */
const VAR_USE = /var\(\s*(--[a-zA-Z0-9-]+)/g;
/** A custom property declaration: `--x: value`. */
const VAR_DEF = /(--[a-zA-Z0-9-]+)\s*:/g;
/**
 * An Angular host style binding — `'[style.--avatar-size.px]': 'pixels()'`.
 *
 * A legitimate way to set a custom property, and the scanner has to know it or the
 * first component that sizes itself from a signal fails as a false positive.
 */
const VAR_HOST_BINDING = /\[style\.(--[a-zA-Z0-9-]+)/g;

/**
 * The semantic aliases components are supposed to reference.
 *
 * The ramps (`--stone-*`, `--ink-*`) are raw material; these are the contract. A
 * component asking for `--stone-700` would not survive a palette change, so the names
 * that matter are pinned here.
 */
const REQUIRED = [
  '--bg',
  '--surface',
  '--surface-raised',
  '--surface-sunken',
  '--fg',
  '--fg-muted',
  '--fg-subtle',
  '--border',
  '--border-strong',
  '--accent',
  '--accent-fg',
  '--accent-hover',
  '--accent-soft',
  '--good',
  '--warn',
  '--bad',
  '--src-github',
  '--src-linkedin',
  '--src-cv',
  '--src-manual',
  '--src-gitlab',
  '--src-stackexchange',
  '--src-devto',
  '--font-sans',
  '--text-xs',
  '--text-base',
  '--text-3xl',
  '--space-1',
  '--space-12',
  '--radius-sm',
  '--radius-full',
  '--shadow-sm',
  '--ease',
  '--dur-fast',
];

/**
 * Colours the dark theme must restate.
 *
 * Anything omitted here inherits its light value, and something goes invisible.
 * Spacing and radii are deliberately absent: `--space-4` is the same in both themes,
 * and should be.
 */
const MUST_DIFFER_IN_DARK = [
  '--bg',
  '--surface',
  '--surface-raised',
  '--surface-sunken',
  '--fg',
  '--fg-muted',
  '--fg-subtle',
  '--border',
  '--border-strong',
  '--accent',
  '--accent-fg',
  '--accent-soft',
  '--good',
  '--warn',
  '--bad',
  '--src-linkedin',
  '--src-cv',
  '--src-gitlab',
  '--src-stackexchange',
  '--src-devto',
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return ['.ts', '.css'].includes(extname(path)) ? [path] : [];
  });
}

function namesIn(text, pattern) {
  return new Set([...text.matchAll(pattern)].map((match) => match[1]));
}

const tokenSource = readFileSync(TOKENS, 'utf8');
const defined = namesIn(tokenSource, VAR_DEF);
const failures = [];

for (const token of REQUIRED) {
  if (!defined.has(token)) failures.push(`${TOKENS}: missing required token ${token}`);
}

const darkAt = tokenSource.indexOf('prefers-color-scheme: dark');
if (darkAt === -1) {
  failures.push(`${TOKENS}: no dark-theme block`);
} else {
  const overridden = namesIn(tokenSource.slice(darkAt), VAR_DEF);
  for (const token of MUST_DIFFER_IN_DARK) {
    if (!overridden.has(token)) {
      failures.push(`${TOKENS}: ${token} is not redefined for dark mode`);
    }
  }
}

/**
 * A backtick inside a CSS comment in a `styles: []` block.
 *
 * Angular component styles are template literals, so a backtick in a comment
 * terminates the string early. What follows is then parsed as TypeScript, and the
 * compiler reports `Failed to resolve styles at position 1 to a string` — from the
 * decorator, with no line number and no mention of a backtick.
 *
 * Caught here because it has now happened three times in this codebase, twice in a
 * CSS comment and once in an HTML one. `ngc` does fail on it, but only under
 * `npm run typecheck`: the dev server keeps serving the last good bundle, so the
 * browser shows stale styles and the edit looks like it simply had no effect. That is
 * an expensive way to learn it, and it is documented in docs/design-system.md —
 * documentation that plainly was not enough.
 */
function backticksInStyles(text) {
  if (!/styles:\s*\[/.test(text)) return [];
  const found = [];
  // Every `/* … */` comment, JSDoc excluded. Deliberately not scoped to the styles
  // string: in the broken case the backtick *is* the apparent end of that string, so
  // any attempt to find its closing backtick lands inside the comment and the window
  // shuts before the bug does. The first version of this guard made exactly that
  // mistake and reported nothing.
  //
  // A plain block comment containing a backtick is the bug; a JSDoc one (`/**`) is
  // ordinary prose about code and is skipped.
  for (const comment of text.matchAll(/\/\*[\s\S]*?\*\//g)) {
    if (comment[0].startsWith('/**')) continue;
    if (!comment[0].includes('`')) continue;
    found.push(comment[0].replace(/\s+/g, ' ').trim().slice(0, 64));
  }
  return found;
}

for (const file of walk(SRC)) {
  if (file === TOKENS) continue;
  const text = readFileSync(file, 'utf8');
  for (const comment of backticksInStyles(text)) {
    failures.push(
      `${relative('.', file)}: backtick in a CSS comment ends the styles string — ${comment}…`,
    );
  }
  // A stylesheet may set its own local variable — `cn-tag` sets `--chip` per source,
  // `cn-avatar` sets `--avatar-size`. Legitimate and local, in CSS or on the host.
  const local = new Set([...namesIn(text, VAR_DEF), ...namesIn(text, VAR_HOST_BINDING)]);
  for (const token of namesIn(text, VAR_USE)) {
    if (!defined.has(token) && !local.has(token)) {
      failures.push(`${relative('.', file)}: undefined token ${token}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Design-token guard failed:\n');
  for (const line of failures) console.error(`  ✗ ${line}`);
  console.error(
    `\nEvery var(--x) must resolve to a token in ${TOKENS} or to a local variable ` +
      'the same file sets.',
  );
  process.exit(1);
}

console.info(`✓ design-token guard passed (${defined.size} tokens)`);
