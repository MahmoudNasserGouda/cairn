/**
 * License allowlist guard (ADR-0021). Fails if any resolved dependency carries a
 * license outside the permissive allowlist. Uses `npm` metadata — no extra dep.
 */
import { execFileSync } from 'node:child_process';

const ALLOW = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'Python-2.0',
  'MIT-0',
  'WTFPL',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'Zlib',
]);

// Packages we have reviewed and accept despite a missing/odd SPDX string.
const EXCEPTIONS = new Set([]);

const tree = JSON.parse(readNpmLsJson());

/**
 * `npm ls --json` still prints the full, valid dependency tree to stdout even
 * when it exits non-zero for a problem unrelated to what we're reading it
 * for — e.g. `ELSPROBLEMS` when a transitive dependency's own peer range is
 * stale (currently `@angular/build` declaring `vitest@^3.1.1` against our
 * `vitest@4.x`, a builder integration this repo never invokes). `execFileSync`
 * throws on that exit code before handing back stdout, so read it off the
 * thrown error instead of trusting the exit code — the license data is intact
 * either way, and a genuinely unparseable output still throws below.
 */
function readNpmLsJson() {
  const opts = {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  };
  try {
    return execFileSync('npm', ['ls', '--all', '--json', '--long'], opts);
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout.length > 0) {
      return error.stdout;
    }
    throw error;
  }
}

const bad = [];
const seen = new Set();

/** @param {Record<string, any>} node */
function walk(node) {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    // Skip deps that aren't actually installed on this platform (optional native
    // binaries, unmet peers) — they carry no resolved license metadata.
    if (
      !dep.version ||
      dep.version === '?' ||
      dep.missing ||
      name.startsWith('@cairn/')
    ) {
      walk(dep);
      continue;
    }
    const id = `${name}@${dep.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!EXCEPTIONS.has(name)) {
      const license = normalize(dep.license ?? dep.licenses);
      if (!license.some((l) => ALLOW.has(l))) {
        bad.push(`${id}: ${license.join(' OR ') || 'UNKNOWN'}`);
      }
    }
    walk(dep);
  }
}

/** @param {unknown} value @returns {string[]} */
function normalize(value) {
  if (!value) return [];
  if (typeof value === 'string') {
    return value
      .replace(/[()]/g, '')
      .split(/\s+OR\s+|\s+AND\s+/i)
      .map((s) => s.trim());
  }
  if (Array.isArray(value)) return value.flatMap((v) => normalize(v.type ?? v));
  if (typeof value === 'object' && 'type' in value) return normalize(value.type);
  return [];
}

walk(tree);

if (bad.length > 0) {
  console.error('License allowlist guard failed:\n');
  for (const b of bad) console.error(`  ✗ ${b}`);
  console.error('\nReview and add to ALLOW or EXCEPTIONS in scripts/check-licenses.mjs');
  process.exit(1);
}
console.info(`✓ license guard passed (${seen.size} packages)`);
