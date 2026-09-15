/**
 * Harness for the OCR sandbox spike (ADR-0028). Renders what the frame reports — and,
 * when it reports nothing, says *why* nothing arrived.
 *
 * ## Why the diagnosis matters as much as the result
 *
 * The first run of this page (2026-09-14, real Chrome) showed an empty frame and a
 * parent stuck on "running…". Three very different causes produce exactly that, and
 * the page could not tell them apart:
 *
 * 1. the frame document never loaded (it was being served
 *    `X-Frame-Options: DENY`, inherited from the `/*` block — a real bug, now fixed);
 * 2. the frame loaded but its script was refused;
 * 3. the script ran and the message did not arrive.
 *
 * It was (1), and it looked identical to (2) — which is the answer that would have
 * killed the whole approach. So the page now distinguishes them: it watches the
 * frame's load event, fetches the sandbox document itself to show the headers it is
 * actually served, and reports a timeout as a timeout rather than as silence.
 *
 * ## Origin checking
 *
 * CodeQL flagged the first version as `js/missing-origin-check` (medium), and the
 * finding is worth more than the fix: **the usual advice does not apply here.** A
 * frame sandboxed with `allow-scripts` and no `allow-same-origin` runs on an opaque
 * origin, so every message it sends arrives with `event.origin === "null"` — the same
 * value a hostile `data:` or `blob:` frame would carry. Comparing origin strings
 * therefore cannot distinguish our sandbox from anyone else's, and a check that reads
 * like security while proving nothing is worse than none.
 *
 * What does distinguish it is **window identity**: `event.source` is a reference to
 * the exact `contentWindow` we created. That comparison is unforgeable by a third
 * party, and it is the check the OCR integration will have to use for the same reason.
 */
const frame = document.querySelector('iframe');
const list = document.getElementById('results');
const diagnosis = document.getElementById('diagnosis');

/** Milliseconds to wait before calling silence a result in its own right. */
const PATIENCE = 6000;

let heard = false;
let loaded = false;

function say(text, cls) {
  const li = document.createElement('li');
  if (cls) li.className = cls;
  // textContent, not innerHTML: some of this renders strings that came out of a
  // sandbox, and the rest renders response headers.
  li.textContent = text;
  list.appendChild(li);
}

function note(text, cls) {
  const p = document.createElement('p');
  if (cls) p.className = cls;
  p.textContent = text;
  diagnosis.appendChild(p);
}

frame.addEventListener('load', () => {
  loaded = true;
});

window.addEventListener('message', (event) => {
  // Identity, not origin — see above. Both halves matter: an opaque origin is what we
  // expect, and the window reference is what actually proves who sent it.
  if (event.source !== frame?.contentWindow) return;
  if (event.origin !== 'null') return;
  if (!event.data || event.data.type !== 'ocr-spike-result') return;

  heard = true;
  list.textContent = '';
  for (const result of event.data.results) {
    say(
      `${result.ok ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`,
      result.ok ? 'ok' : 'no',
    );
  }
  window.__spike = event.data.results;
});

/**
 * A parent-side CSP block (`frame-src`, or `default-src` standing in for it) fires
 * here rather than in the frame, so it is worth catching: it is the one failure the
 * frame itself can never report.
 */
document.addEventListener('securitypolicyviolation', (event) => {
  note(
    `The application's own CSP blocked ${event.blockedURI || 'something'} ` +
      `(${event.effectiveDirective}). That is this page's policy, not the sandbox's.`,
    'no',
  );
});

/**
 * Show the headers the sandbox document is actually served.
 *
 * The bug that produced the first empty result was an *inherited* header — the
 * `/ocr/*` block overrode three headers and silently kept `X-Frame-Options: DENY`
 * from `/*`, because Cloudflare applies every matching rule rather than the most
 * specific one. Printing what arrived is the difference between diagnosing that in a
 * minute and guessing at it for an hour.
 */
async function showServedHeaders() {
  try {
    const response = await fetch('ocr/', { cache: 'no-store' });
    const xfo = response.headers.get('x-frame-options');
    const csp = response.headers.get('content-security-policy');

    note(`GET ocr/ → ${response.status}`);
    note(
      `X-Frame-Options: ${xfo ?? '(none)'}`,
      xfo && xfo.toUpperCase() === 'DENY' ? 'no' : 'ok',
    );
    if (xfo && xfo.toUpperCase() === 'DENY') {
      note(
        'DENY forbids framing from anywhere, same-origin included — the frame cannot ' +
          'load at all, and an empty result below means nothing about WASM.',
        'no',
      );
    }
    note(
      `Content-Security-Policy: ${csp ?? '(none — a dev server that ignores _headers?)'}`,
    );
  } catch (error) {
    note(`Could not read the sandbox document's headers: ${String(error)}`, 'no');
  }
}

setTimeout(() => {
  if (heard) return;
  list.textContent = '';
  if (!loaded) {
    say(
      'The frame never loaded. Its document was refused before any script could run, ' +
        'so this says nothing about WebAssembly — check the headers above.',
      'no',
    );
    return;
  }
  say(
    'The frame loaded but reported nothing within ' +
      PATIENCE / 1000 +
      's. Its document was served, so the block is inside it: either the script was ' +
      'refused, or it ran and could not post back.',
    'no',
  );
  say(
    'If the box below is blank, the script did not run. If the box shows results but ' +
      'this list does not, the postMessage channel is the problem.',
  );
}, PATIENCE);

void showServedHeaders();
