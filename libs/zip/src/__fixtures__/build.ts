/**
 * ZIP fixture builder.
 *
 * Archives are constructed byte-for-byte here rather than committed as binaries, so
 * the repo stays free of opaque blobs and each test can state exactly which malformed
 * or hostile shape it is exercising — a lying manifest, an unsupported compression
 * method, a directory that runs off the end.
 */

const DEFLATED = 8;

export interface ZipEntryInput {
  readonly name: string;
  readonly data: Uint8Array;
  /** Compression method to record and use. Defaults to deflate. */
  readonly method?: number;
  /** Override the uncompressed size in both headers, to fake a bomb's manifest. */
  readonly declaredSize?: number;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const pump = (async () => {
    await writer.write(data);
    await writer.close();
  })();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await pump;
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Build a ZIP archive with local headers, a central directory, and an EOCD. */
export async function buildZip(entries: readonly ZipEntryInput[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? DEFLATED;
    const name = encoder.encode(entry.name);
    const payload =
      method === DEFLATED ? await deflateRaw(entry.data) : entry.data.slice();
    const declaredSize = entry.declaredSize ?? entry.data.byteLength;

    const local = new Uint8Array(30 + name.byteLength + payload.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(8, method, true);
    lv.setUint32(18, payload.byteLength, true);
    lv.setUint32(22, declaredSize, true);
    lv.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(payload, 30 + name.byteLength);
    locals.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, payload.byteLength, true);
    cv.setUint32(24, declaredSize, true);
    cv.setUint16(28, name.byteLength, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.byteLength;
  }

  const dirSize = centrals.reduce((n, c) => n + c.byteLength, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, eocd];
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}
