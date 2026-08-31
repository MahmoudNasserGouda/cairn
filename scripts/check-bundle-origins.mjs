/**
 * CI supply-chain guard (ADR-0021, ADR-0022). Scans the built web bundle for
 * outbound origins and fails if any is not in the documented allowlist. Catches a
 * dependency that starts phoning home.
 *
 * Skips (exit 0 with a notice) when no build output exists, unless --strict.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const strict = process.argv.includes('--strict');
const DIST = 'apps/web/dist';
const CONFIG = 'libs/shared/src/config.ts';

if (!existsSync(DIST)) {
  const msg = `${DIST} not found — run "npm run build:web" first.`;
  if (strict) {
    console.error(msg);
    process.exit(1);
  }
  console.info(`(skipped) ${msg}`);
  process.exit(0);
}

const allow = new Set(
  [...readFileSync(CONFIG, 'utf8').matchAll(/'(https:\/\/[^']+)'/g)].map(
    (m) => new URL(m[1]).origin,
  ),
);
// Origins that are fine to appear as *text* (doc links in error messages, standards
// URLs, source-map comments). These are never used as fetch targets by our code;
// the CSP connect-src is the actual runtime control.
const IGNORE = [
  'https://www.w3.org',
  'https://schema.org',
  'https://github.com',
  'https://fonts.gstatic.com',
  'https://fonts.googleapis.com',
  'https://angular.dev',
  'https://angular.io',
  'https://v8.dev',
  'https://developer.mozilla.org',
  'https://tools.ietf.org',
  'https://datatracker.ietf.org',
  'https://caniuse.com',
];

const ASSET_EXT = new Set(['.js', '.mjs', '.css', '.html', '.json']);
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : ASSET_EXT.has(extname(p)) ? [p] : [];
  });

const found = new Map();
for (const file of walk(DIST)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/https:\/\/[a-z0-9.-]+/gi)) {
    let origin;
    try {
      origin = new URL(m[0]).origin;
    } catch {
      continue;
    }
    if (allow.has(origin) || IGNORE.includes(origin)) continue;
    if (!found.has(origin)) found.set(origin, file);
  }
}

if (found.size > 0) {
  console.error(
    'Bundle-origin guard failed — undocumented outbound origins in the build:\n',
  );
  for (const [origin, file] of found)
    console.error(`  ✗ ${origin}  (first seen in ${file})`);
  console.error(
    '\nAdd to ALLOWED_CONNECT_ORIGINS + CSP after review, or remove the dependency.',
  );
  process.exit(1);
}
console.info('✓ bundle-origin guard passed');
