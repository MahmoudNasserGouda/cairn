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

  /**
   * `_headers` read per path block, not as "the first CSP line in the file".
   *
   * The old reading stopped at the first match, so every later block was invisible —
   * which is exactly what happened when the `/ocr/*` sandbox was added: a block
   * carrying `'wasm-unsafe-eval'` appeared and this guard passed. The point of
   * ADR-0028 is that the exception is confined to one path, and a guard that cannot
   * see the other blocks cannot enforce that confinement.
   */
  const blocks = [];
  let current = null;
  for (const raw of headers.split('\n')) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { path: raw.trim(), csp: null, headers: new Map(), unset: new Set() };
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    // `! Header-Name` removes a header this path would otherwise inherit. It is the
    // only way a block can stop `/*` from also applying — see the accumulation note
    // below.
    const unset = /^\s*!\s*([A-Za-z0-9-]+)\s*$/.exec(raw);
    if (unset) {
      current.unset.add(unset[1].toLowerCase());
      continue;
    }
    const at = raw.indexOf(':');
    if (at > 0) {
      current.headers.set(
        raw.slice(0, at).trim().toLowerCase(),
        raw.slice(at + 1).trim(),
      );
    }
    if (raw.toLowerCase().includes('content-security-policy')) {
      current.csp = raw.split(':').slice(1).join(':').trim();
    }
  }

  /**
   * The only path ADR-0028 permits `'wasm-unsafe-eval'` on. An allowlist of exactly
   * one entry, on purpose: adding a second is a decision, and a decision should have
   * to edit this line.
   */
  const WASM_EXEMPT = new Set(['/ocr/*']);

  for (const block of blocks) {
    if (block.csp === null || WASM_EXEMPT.has(block.path)) continue;
    if (block.csp.includes("'wasm-unsafe-eval'")) {
      problems.push(
        `CSP for ${block.path} contains 'wasm-unsafe-eval' — permitted only on ` +
          `${[...WASM_EXEMPT].join(', ')} (ADR-0028, non-negotiable 1).`,
      );
    }
  }

  // The sandbox is a boundary only while it stays one: no network beyond its own
  // assets, and nothing inherited from the application's policy.
  for (const path of WASM_EXEMPT) {
    const block = blocks.find((b) => b.path === path);
    if (!block || block.csp === null) continue;
    if (!/default-src\s+'none'/.test(block.csp)) {
      problems.push(`CSP for ${path} must set default-src 'none' (ADR-0028).`);
    }
    const connect = /connect-src([^;]*)/.exec(block.csp);
    if (connect && /https?:\/\//.test(connect[1])) {
      problems.push(
        `CSP for ${path} names an outbound origin in connect-src — the sandbox has ` +
          `no network egress beyond its own assets (ADR-0028).`,
      );
    }

    /**
     * The sandbox has to be *frameable*, and this is where that is decided.
     *
     * Cloudflare **appends**; it does not override. `/*` matches `/ocr/*` too, and a
     * block that names the same header does not replace the inherited value — both are
     * sent. Verified 2026-09-15 by serving the real build through `wrangler dev`:
     * every `/ocr/*` response carried **two** `Content-Security-Policy` headers and
     * **two** `X-Frame-Options` values.
     *
     * Both matter, and for different reasons:
     *
     * - Two CSPs are enforced *cumulatively* — a resource must satisfy every policy —
     *   so the application's `script-src 'self'` intersects with the sandbox's and
     *   removes `'wasm-unsafe-eval'` again, and `frame-ancestors 'none'` intersects to
     *   forbid framing outright.
     * - Two `X-Frame-Options` values are a conflict, which Chromium resolves as DENY.
     *
     * The only fix is to **unset** the inherited headers with `!` before setting the
     * block's own. An earlier version of this guard modelled the block's header as
     * replacing the inherited one (`own ?? inherited`), which is why a configuration
     * that sent two CSPs passed it — and why the spike kept reporting an empty frame
     * that read exactly like "WebAssembly is unavailable in an opaque origin".
     */
    for (const name of ['content-security-policy', 'x-frame-options']) {
      const inheritedFrom = blocks.find((b) => b.path === '/*' && b.headers.has(name));
      if (inheritedFrom && !block.unset.has(name)) {
        problems.push(
          `${path} inherits ${name} from /* and does not unset it. Cloudflare appends ` +
            `rather than overrides, so both values are sent: CSPs are then enforced ` +
            `cumulatively (losing 'wasm-unsafe-eval' and forbidding framing), and two ` +
            `X-Frame-Options values resolve to DENY. Add "! ${name}" to the ${path} ` +
            `block before its own value (ADR-0028).`,
        );
      }
    }
    const own = block.headers.get('x-frame-options');
    if (own && own.toUpperCase() === 'DENY') {
      problems.push(
        `${path} sets X-Frame-Options: DENY — the sandbox document cannot be framed at ` +
          `all, so the path is unreachable (ADR-0028).`,
      );
    }
    if (!/frame-ancestors\s+'self'/.test(block.csp)) {
      problems.push(
        `CSP for ${path} must set frame-ancestors 'self' — the app origin embeds it, ` +
          `and nothing else may (ADR-0028).`,
      );
    }

    /**
     * The second header that has to *undo* something, and the one that actually
     * stopped the spike.
     *
     * The sandbox runs on an **opaque origin**, which belongs to no site and no
     * origin. `Cross-Origin-Resource-Policy: same-site` and `same-origin` therefore
     * can never match it — the frame loads and is then refused every one of its own
     * assets, which is `NS_ERROR_DOM_CORP_FAILED` on `sandbox.js` and looks exactly
     * like "WebAssembly is unavailable here". `cross-origin` is the only value an
     * opaque-origin document can satisfy.
     *
     * It is deliberately not a free pass: these are the engine and its models, public
     * static files with nothing user-specific in them, and framing the sandbox
     * *document* is still governed by `frame-ancestors 'self'` above.
     */
    const corp = block.headers.get('cross-origin-resource-policy');
    if (corp && corp.trim().toLowerCase() !== 'cross-origin') {
      problems.push(
        `${path} sets Cross-Origin-Resource-Policy: ${corp} — an opaque origin belongs ` +
          `to no site, so only 'cross-origin' can match it and the sandbox is refused ` +
          `its own assets (ADR-0028).`,
      );
    }
  }

  const appBlock = blocks.find((b) => b.path === '/*');
  if (!appBlock || appBlock.csp === null) {
    problems.push(`${HEADERS} has no Content-Security-Policy header for /*.`);
  } else {
    const csp = appBlock.csp;
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

// --- 2b: built index.html must not self-violate the CSP ---
// The strict CSP declares `base-uri 'none'` and `script-src 'self'`; a `<base>`
// element or an inline event handler (e.g. the critical-CSS `onload=` preload
// trick) in the built HTML would be blocked by the browser. Only asserted when a
// production build is present, so `guard` still runs standalone (ADR-0019).
const BUILT_HTML = 'apps/web/dist/browser/index.html';
if (existsSync(BUILT_HTML)) {
  const html = readFileSync(BUILT_HTML, 'utf8');
  if (/<base\b/i.test(html)) {
    problems.push(
      `${BUILT_HTML} contains a <base> element — violates CSP base-uri 'none' ` +
        '(supply the base href via APP_BASE_HREF instead).',
    );
  }
  if (/\son\w+\s*=/i.test(html)) {
    problems.push(
      `${BUILT_HTML} contains an inline event handler (on*=) — violates CSP ` +
        "script-src 'self' (disable optimization.styles.inlineCritical).",
    );
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
const ALLOW_MARK = 'cairn-security-reviewed';

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
