/**
 * Minimal, defensive ZIP reader — just enough to pull one named entry out of a
 * DOCX. Hand-rolled rather than pulling in a zip dependency so the zip-bomb
 * defences for SECURITY.md T7 ("Malicious CV file") are ours to enforce:
 * entry-count cap, declared-size rejection, and a running byte cap that aborts
 * inflation mid-stream. No filesystem, no network, no eval.
 */

/** A DOCX with more entries than this is not a CV. */
const MAX_ENTRIES = 512;
/** Hard ceiling on a single inflated entry. A CV's document.xml is well under 1 MB. */
export const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
/** EOCD is 22 bytes plus a comment of at most 0xffff. */
const EOCD_MAX_SCAN = 22 + 0xffff;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;

const STORED = 0;
const DEFLATED = 8;

interface CentralEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

export class ZipError extends Error {}

function findEocd(view: DataView): number {
  const start = Math.max(0, view.byteLength - EOCD_MAX_SCAN);
  for (let i = view.byteLength - 22; i >= start; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  throw new ZipError('not a zip archive (no end-of-central-directory record)');
}

function readCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);

  const total = view.getUint16(eocd + 10, true);
  const dirSize = view.getUint32(eocd + 12, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  if (total === ZIP64_SENTINEL_16 || dirOffset === ZIP64_SENTINEL_32) {
    throw new ZipError('zip64 archives are not supported');
  }
  if (total > MAX_ENTRIES) {
    throw new ZipError(`archive has ${total} entries (limit ${MAX_ENTRIES})`);
  }
  if (dirOffset + dirSize > bytes.byteLength) {
    throw new ZipError('central directory runs past the end of the archive');
  }

  const decoder = new TextDecoder('utf-8');
  const entries: CentralEntry[] = [];
  let p = dirOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > bytes.byteLength || view.getUint32(p, true) !== CENTRAL_SIG) {
      throw new ZipError('malformed central directory');
    }
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    entries.push({
      name: decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength)),
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      uncompressedSize: view.getUint32(p + 24, true),
      localHeaderOffset: view.getUint32(p + 42, true),
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Inflate `data`, aborting as soon as the output exceeds `maxBytes`. Streaming the
 * cap (rather than trusting the header) is what stops a zip bomb whose central
 * directory understates the uncompressed size.
 */
async function inflateRaw(data: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const pump = (async () => {
    await writer.write(data);
    await writer.close();
  })().catch(() => undefined);

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ZipError(`entry inflates past the ${maxBytes}-byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    await pump;
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * Read one entry by exact name. Returns `undefined` when the archive has no such
 * entry; throws `ZipError` when the archive itself is malformed or over a limit.
 * Only STORED and DEFLATED are accepted — anything else (including encrypted
 * entries) is rejected rather than guessed at.
 */
export async function readZipEntry(
  bytes: Uint8Array,
  name: string,
  maxBytes = MAX_ENTRY_BYTES,
): Promise<Uint8Array | undefined> {
  const entry = readCentralDirectory(bytes).find((e) => e.name === name);
  if (!entry) return undefined;
  if (entry.uncompressedSize > maxBytes) {
    throw new ZipError(
      `${name} declares ${entry.uncompressedSize} bytes (limit ${maxBytes})`,
    );
  }
  if (entry.method !== STORED && entry.method !== DEFLATED) {
    throw new ZipError(`${name} uses unsupported compression method ${entry.method}`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const local = entry.localHeaderOffset;
  if (local + 30 > bytes.byteLength || view.getUint32(local, true) !== LOCAL_SIG) {
    throw new ZipError(`${name} has a malformed local header`);
  }
  // The local header's extra field may differ in length from the central one.
  const dataStart =
    local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.byteLength) {
    throw new ZipError(`${name} runs past the end of the archive`);
  }
  const data = bytes.subarray(dataStart, dataEnd);

  if (entry.method === STORED) {
    if (data.byteLength > maxBytes) {
      throw new ZipError(`${name} exceeds the ${maxBytes}-byte limit`);
    }
    return data.slice();
  }
  return inflateRaw(data, maxBytes);
}
