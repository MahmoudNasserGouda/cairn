/**
 * Serve a built `apps/web` the way the host does, including `_headers`.
 *
 * The Angular dev server rewrites every unknown path to the SPA and sends no security
 * headers at all, so it cannot answer the questions that matter about
 * `apps/web/public/_headers`: does the CSP actually apply, does it apply *per path*,
 * and does a document served under it behave as intended. Until now the only way to
 * find out was to deploy.
 *
 * This is not a production server and is not wired into the build. It reads the same
 * `_headers` file Cloudflare does, applies the first matching block per path, and
 * serves files. Enough to verify a policy before shipping it — which is what
 * ADR-0028's `/ocr/*` sandbox needs.
 *
 *   node scripts/serve-static.mjs [root] [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const root = process.argv[2] ?? 'apps/web/dist/browser';
const port = Number(process.argv[3] ?? 4290);
const headersFile = join(root, '_headers');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.onnx': 'application/octet-stream',
};

/**
 * Parse `_headers`: a path pattern in column 0, then indented `Name: value` lines.
 * Cloudflare applies every matching rule; the last one to set a header wins, so the
 * blocks are kept in file order and applied in order.
 */
async function loadHeaderRules() {
  let text;
  try {
    text = await readFile(headersFile, 'utf8');
  } catch {
    return [];
  }

  const rules = [];
  let current = null;
  for (const raw of text.split('\n')) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), headers: [] };
      rules.push(current);
      continue;
    }
    const at = raw.indexOf(':');
    if (current && at > 0) {
      current.headers.push([raw.slice(0, at).trim(), raw.slice(at + 1).trim()]);
    }
  }
  return rules;
}

/** Cloudflare's `_headers` globbing, reduced to the `*` this project actually uses. */
function matches(pattern, pathname) {
  if (!pattern.includes('*')) return pattern === pathname;
  const [prefix] = pattern.split('*');
  return pathname.startsWith(prefix);
}

const rules = await loadHeaderRules();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);

  // Contained to `root`: this is a local tool, but a path-traversal bug in a thing
  // that serves files is a path-traversal bug regardless of its audience.
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, safe);

  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      file = join(file, 'index.html');
      pathname = join(pathname, 'index.html');
    }
  } catch {
    // Unlike the dev server, an unknown path is a 404 rather than the SPA. A silent
    // rewrite is exactly what hid `/ocr/spike.html` behind the application shell.
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(`404 ${pathname}`);
    return;
  }

  let body;
  try {
    body = await readFile(file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(`404 ${pathname}`);
    return;
  }

  const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' };
  for (const rule of rules) {
    if (!matches(rule.pattern, pathname)) continue;
    for (const [name, value] of rule.headers) headers[name] = value;
  }

  res.writeHead(200, headers);
  res.end(body);
});

server.listen(port, () => {
  console.info(
    `serving ${root} on http://localhost:${port} with ${rules.length} header rules`,
  );
});
