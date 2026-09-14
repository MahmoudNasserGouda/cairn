/**
 * The OCR sandbox's script (ADR-0028) — currently a **spike**, not an engine.
 *
 * ADR-0028 named one unknown and made it the thing to settle before anything is built
 * on it: an opaque-origin document fetches its subresources cross-origin, so can this
 * document load the WASM and model files it needs from our own origin at all?
 *
 * This answers exactly that, and nothing else. It compiles a 41-byte hand-written
 * WebAssembly module, fetches the same module as a file, and reports what happened to
 * the parent. If both work, the OCR engine drops in here unchanged. If either fails,
 * the fallback in ADR-0028 — serving this document from a separate Workers subdomain —
 * is the answer, and it is better to know that now than after vendoring 16 MB of
 * models.
 */

/** A minimal valid module exporting `add(i32, i32) -> i32`. Hand-assembled so the
 *  probe depends on nothing and cannot be confused with a real payload. */
const PROBE_MODULE = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f,
  0x7f, 0x01, 0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64,
  0x00, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
]);

// Sent before anything else runs. If the parent hears this and nothing more, the
// script started and something after it failed — which is a very different diagnosis
// from "the script never executed", and the two are indistinguishable from outside an
// opaque origin without it.
try {
  parent.postMessage({ type: 'ocr-spike-alive' }, '*');
} catch {
  // Nothing to do: if postMessage itself fails there is no channel to report on.
}

async function check(name, run) {
  try {
    return { name, ok: true, detail: String(await run()) };
  } catch (error) {
    return {
      name,
      ok: false,
      detail: String(error && error.message ? error.message : error),
    };
  }
}

async function probe() {
  const results = [];

  // 1. Is this really an opaque origin? If `origin` is not "null" the sandbox is not
  //    isolated, and every other guarantee in ADR-0028 is void.
  results.push(
    await check('opaque-origin', () => {
      if (window.origin !== 'null')
        throw new Error(`origin is ${window.origin}, expected null`);
      return 'origin is null';
    }),
  );

  // 2. Can it read the application's storage? It must not be able to.
  results.push(
    await check('storage-isolated', () => {
      try {
        const probe = window.localStorage.length;
        throw new Error(`localStorage readable (${probe} keys)`);
      } catch (error) {
        if (String(error).includes('readable')) throw error;
        return 'localStorage blocked, as an opaque origin should be';
      }
    }),
  );

  // 3. Did the same-site script this file *is* actually load? Reaching here proves it,
  //    but say so explicitly — it is half the question ADR-0028 asked.
  results.push(await check('script-from-our-origin', () => 'this script ran'));

  // 4. Compile WebAssembly from bytes. Blocked without `wasm-unsafe-eval`.
  results.push(
    await check('wasm-compile-inline', async () => {
      const { instance } = await WebAssembly.instantiate(PROBE_MODULE);
      const sum = instance.exports.add(2, 3);
      if (sum !== 5) throw new Error(`add(2,3) returned ${sum}`);
      return 'compiled and ran';
    }),
  );

  // 5. The real question: fetch a binary asset from our origin, as an opaque origin.
  //    This is what the model files will have to do.
  results.push(
    await check('fetch-wasm-asset', async () => {
      const response = await fetch('probe.wasm');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      return `${buffer.byteLength} bytes`;
    }),
  );

  // 6. And streaming-compile it, which is how ONNX Runtime actually loads.
  results.push(
    await check('wasm-instantiate-streaming', async () => {
      const { instance } = await WebAssembly.instantiateStreaming(fetch('probe.wasm'));
      return `add(20,22) = ${instance.exports.add(20, 22)}`;
    }),
  );

  // Rendered into this document as well as posted out. Reading the DOM is how the
  // result gets checked without evaluating script *inside* the sandbox — an injected
  // evaluation runs outside CSP, so it would happily compile WebAssembly whether or
  // not the policy allows it, and prove nothing.
  const list = document.createElement('ul');
  list.id = 'results';
  for (const result of results) {
    const item = document.createElement('li');
    item.textContent = `${result.ok ? 'PASS' : 'FAIL'} ${result.name} — ${result.detail}`;
    list.appendChild(item);
  }
  document.body.appendChild(list);

  parent.postMessage({ type: 'ocr-spike-result', results }, '*');
}

// An error before `probe` finishes would otherwise look like silence.
window.addEventListener('error', (event) => {
  parent.postMessage(
    {
      type: 'ocr-spike-result',
      results: [{ name: 'uncaught', ok: false, detail: String(event.message) }],
    },
    '*',
  );
});

void probe();
