/**
 * CI security guard (ADR-0019, ADR-0022). Fails the build on:
 *   1. `unsafe-inline` / `unsafe-eval` / wildcard hosts in the CSP
 *   2. `connect-src` drifting from libs/shared ALLOWED_CONNECT_ORIGINS
 *   3. `bypassSecurityTrust*` or unsanitised `innerHTML =` in source
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const problems = [];
const HEADERS = 'apps/web/public/_headers';
const CONFIG = 'libs/shared/src/config.ts';

// --- 1 & 2: CSP checks ---
if (!existsSync(HEADERS)) {
  problems.push(
    `${HEADERS} is missing — the static host CSP must be version-controlled.`,
  );
} else {
  const headers = readFileSync(HEADERS, 'utf8');
  const cspLine = headers
    .split('\n')
    .find((l) => l.toLowerCase().includes('content-security-policy'));
  if (!cspLine) {
    problems.push(`${HEADERS} has no Content-Security-Policy header.`);
  } else {
    const csp = cspLine.split(':').slice(1).join(':').trim();
    const directive = (name) => {
      const m = csp.match(new RegExp(`(?:^|;)\\s*${name}([^;]*)`));
      return m ? m[1].trim() : null;
    };

    // Non-negotiable 1: no unsafe-inline / unsafe-eval in SCRIPT execution contexts.
    for (const name of ['script-src', 'script-src-elem', 'default-src']) {
      const value = directive(name);
      if (!value) continue;
      for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'"]) {
        if (value.includes(bad)) {
          problems.push(`CSP ${name} contains ${bad} (non-negotiable 1).`);
        }
      }
    }
    // style-src 'unsafe-inline' is a documented Angular exception; anywhere else it is not.
    for (const name of ['img-src', 'connect-src', 'font-src', 'frame-src']) {
      if ((directive(name) ?? '').includes("'unsafe-inline'")) {
        problems.push(`CSP ${name} contains 'unsafe-inline'.`);
      }
    }
    if (!/script-src\s+'self'/.test(csp)) {
      problems.push("CSP must pin script-src to 'self' (no CDN scripts).");
    }
    for (const name of ['object-src', 'base-uri', 'frame-ancestors']) {
      if ((directive(name) ?? '') !== "'none'") {
        problems.push(`CSP ${name} must be 'none'.`);
      }
    }
    if (/(script-src|connect-src|default-src|img-src)[^;]*\s\*(\s|;|$)/.test(csp)) {
      problems.push('CSP uses a wildcard host in a fetch directive.');
    }

    const connectMatch = csp.match(/connect-src([^;]*)/);
    if (connectMatch && existsSync(CONFIG)) {
      const declared = [
        ...readFileSync(CONFIG, 'utf8').matchAll(/'(https:\/\/[^']+)'/g),
      ].map((m) => m[1]);
      const inCsp = connectMatch[1]
        .trim()
        .split(/\s+/)
        .filter((t) => t.startsWith('https://'));
      for (const origin of inCsp) {
        if (!declared.includes(origin)) {
          problems.push(
            `CSP connect-src allows ${origin} which is not in ALLOWED_CONNECT_ORIGINS.`,
          );
        }
      }
    }
  }
}

// --- 3: source sink checks ---
const SRC_ROOTS = ['libs', 'apps/web/src', 'apps/extension/src'];
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.html']);
const walk = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'dist') return [];
    const s = statSync(p);
    if (s.isDirectory()) return walk(p);
    return CODE_EXT.has(extname(p)) ? [p] : [];
  });
};

const BANNED = [
  {
    re: /bypassSecurityTrust\w*/,
    msg: 'bypassSecurityTrust* is banned without a reviewed exception',
  },
  {
    re: /\.innerHTML\s*=(?!=)/,
    msg: 'direct innerHTML assignment — route through the sanitizer',
  },
  { re: /\bnew Function\s*\(/, msg: 'new Function() is eval-equivalent' },
];
const ALLOW_MARK = 'osc-security-reviewed';

for (const file of SRC_ROOTS.flatMap(walk)) {
  if (file.endsWith('.test.ts') || file.includes('check-csp')) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARK)) return;
    for (const { re, msg } of BANNED) {
      if (re.test(line)) problems.push(`${file}:${i + 1}  ${msg}`);
    }
  });
}

if (problems.length > 0) {
  console.error('CSP / rendering security guard failed:\n');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('\nSee SECURITY.md and docs/adr/0019-security-first-rendering.md');
  process.exit(1);
}
console.info('✓ CSP / rendering security guard passed');
