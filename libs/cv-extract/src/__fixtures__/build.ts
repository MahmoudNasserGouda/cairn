/**
 * Test fixture builders. DOCX and PDF samples are constructed byte-for-byte here
 * rather than committed as binaries, so the repo stays free of opaque blobs and
 * each test can state exactly which malformed or hostile shape it is exercising.
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

/** Wrap `word/document.xml` markup in an otherwise-plausible DOCX package. */
export async function buildDocx(documentXml: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  return buildZip([
    {
      name: '[Content_Types].xml',
      data: encoder.encode('<?xml version="1.0"?><Types/>'),
    },
    { name: 'word/document.xml', data: encoder.encode(documentXml) },
  ]);
}

/** Turn plain lines into the `<w:p>/<w:r>/<w:t>` markup Word actually emits. */
export function paragraphs(lines: readonly string[]): string {
  const body = lines
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

/**
 * Build a single-page PDF whose content stream draws `lines` with Helvetica.
 * Uncompressed, with a real xref table, so pdf.js parses it the ordinary way
 * rather than via its damaged-file recovery path.
 */
export function buildPdf(lines: readonly string[]): Uint8Array {
  const escape = (s: string): string => s.replace(/([\\()])/g, '\\$1');
  const draw = lines
    .map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 16} Td (${escape(line)}) Tj ET`)
    .join('\n');
  const stream = `${draw}\n`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) {
    pdf += `${String(at).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefAt}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}
