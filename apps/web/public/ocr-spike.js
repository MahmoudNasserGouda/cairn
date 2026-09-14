/**
 * Harness for the OCR sandbox spike (ADR-0028). Renders what the frame reports.
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

window.addEventListener('message', (event) => {
  // Identity, not origin — see above. Both halves matter: an opaque origin is what we
  // expect, and the window reference is what actually proves who sent it.
  if (event.source !== frame?.contentWindow) return;
  if (event.origin !== 'null') return;
  if (!event.data || event.data.type !== 'ocr-spike-result') return;

  const list = document.getElementById('results');
  list.textContent = '';
  for (const result of event.data.results) {
    const li = document.createElement('li');
    li.className = result.ok ? 'ok' : 'no';
    // textContent, not innerHTML: this renders strings that came out of a sandbox.
    li.textContent = `${result.ok ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`;
    list.appendChild(li);
  }
  window.__spike = event.data.results;
});
