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

// ---------------------------------------------------------------------------
// Positioned PDFs
//
// `buildPdf` above stacks lines down the left margin, which is the one shape a
// text extractor cannot get wrong. Real CVs are not that shape: they have columns,
// a date gutter, indented bullets, and headings set larger and bolder than the
// body. Every one of those is decidable from coordinates and font metrics — which
// is exactly what pdf.js returns and what `itemsToText` currently throws away.
//
// So the builders below place runs at explicit points on the page, in points with
// the PDF origin at the bottom-left, and let a test state the layout it means.
// ---------------------------------------------------------------------------

/** One drawn run of text at an absolute position on the page. */
export interface PdfRun {
  readonly text: string;
  /** Points from the left edge. */
  readonly x: number;
  /** Points from the **bottom** edge — PDF's own origin, not the screen's. */
  readonly y: number;
  /** Point size. Defaults to 11, the usual CV body size. */
  readonly size?: number;
  readonly bold?: boolean;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

function escapePdfText(value: string): string {
  return value.replace(/([\\()])/g, '\\$1');
}

/**
 * WinAnsi codes for the non-ASCII glyphs a CV actually uses. The base-14 fonts are
 * single-byte, so a bullet has to go out as byte 0x95 — writing it as a UTF-16 hex
 * string made pdf.js decode it one byte at a time and produce `" B u l l e t`.
 * Anything outside this table cannot be drawn in Helvetica at all; a fixture that
 * needs it uses DOCX instead, which is UTF-8 XML and has no such trap.
 */
const WIN_ANSI: Readonly<Record<string, number>> = {
  '•': 0x95, // bullet
  '–': 0x96, // en dash
  '—': 0x97, // em dash
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '·': 0xb7, // middle dot
};

function pdfString(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const winAnsi = WIN_ANSI[ch];
    if (winAnsi !== undefined) {
      out += '\\' + winAnsi.toString(8);
      continue;
    }
    if (code < 0x20 || code > 0x7e) {
      throw new Error(
        `buildPositionedPdf cannot draw ${JSON.stringify(ch)} in Helvetica — ` +
          'use a DOCX fixture for non-Latin text',
      );
    }
    out += escapePdfText(ch);
  }
  return `(${out})`;
}

function contentStreamFor(runs: readonly PdfRun[]): string {
  return runs
    .map((run) => {
      const font = run.bold === true ? '/F2' : '/F1';
      const size = run.size ?? 11;
      const at = `1 0 0 1 ${run.x} ${run.y} Tm`;
      return `BT ${font} ${size} Tf ${at} ${pdfString(run.text)} Tj ET`;
    })
    .join('\n');
}

/** Assemble numbered objects into a PDF with a real xref table. */
function assemblePdf(objects: readonly string[]): Uint8Array {
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

/**
 * A PDF whose pages draw `runs` exactly where they are placed. Regular text uses
 * Helvetica and `bold: true` uses Helvetica-Bold, so a heading is distinguishable
 * by font name as well as by size — pdf.js reports both.
 */
export function buildPositionedPdf(pages: readonly (readonly PdfRun[])[]): Uint8Array {
  const streams = pages.map(contentStreamFor);
  // 1 catalog, 2 pages, 3 F1, 4 F2, then per page: a page object and its stream.
  const firstPageObj = 5;
  const kids = pages.map((_, i) => `${firstPageObj + i * 2} 0 R`).join(' ');

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold ' +
      '/Encoding /WinAnsiEncoding >>',
  ];
  streams.forEach((stream, i) => {
    const contentsRef = firstPageObj + i * 2 + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> ' +
        `/Contents ${contentsRef} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length + 1} >>\nstream\n${stream}\nendstream`);
  });
  return assemblePdf(objects);
}

/**
 * A page carrying an image and **no text layer at all** — the scanned or
 * photographed CV. `extractCvText` must report `empty: true` for this and hand it
 * to the OCR sandbox rather than pretending it read a blank document (ADR-0028).
 * The image is an 8x8 greyscale ramp, small enough to inline uncompressed.
 */
export function buildScannedPdf(): Uint8Array {
  const raw = Array.from({ length: 64 }, (_, i) =>
    String.fromCharCode((i * 4) % 256),
  ).join('');
  const draw = 'q 468 0 0 648 72 72 cm /Im0 Do Q';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /XObject /Subtype /Image /Width 8 /Height 8 ' +
      `/ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${raw.length} >>\n` +
      `stream\n${raw}\nendstream`,
    `<< /Length ${draw.length + 1} >>\nstream\n${draw}\nendstream`,
  ];
  return assemblePdf(objects);
}

// ---------------------------------------------------------------------------
// CV shapes
//
// Named layouts rather than anonymous coordinate soup, so a failing test names the
// real-world shape it broke on. All synthetic: no real CV is ever committed here
// (docs/testing.md).
// ---------------------------------------------------------------------------

const TOP = PAGE_HEIGHT - 72;

/** The easy case: one column, headings above the content they introduce. */
export function singleColumnCv(): PdfRun[] {
  return [
    { text: 'Amara Okonkwo', x: 72, y: TOP, size: 22, bold: true },
    { text: 'amara.okonkwo@example.com', x: 72, y: TOP - 20 },
    { text: 'EXPERIENCE', x: 72, y: TOP - 56, size: 13, bold: true },
    { text: 'Backend Engineer', x: 72, y: TOP - 78, size: 12, bold: true },
    { text: 'Paystack', x: 72, y: TOP - 94 },
    { text: '2021 - present', x: 72, y: TOP - 110 },
    { text: 'SKILLS', x: 72, y: TOP - 146, size: 13, bold: true },
    { text: 'Python, PostgreSQL, Docker, Kubernetes', x: 72, y: TOP - 168 },
  ];
}

/**
 * Two columns — a narrow sidebar and a main column. Read as a flat text stream this
 * interleaves into nonsense ("SKILLS EXPERIENCE Python Backend Engineer"), because
 * the extractor sees one run after another and not two columns. `libs/doc-layout`
 * must split them on the x-gap.
 */
export function twoColumnCv(): PdfRun[] {
  const SIDEBAR = 60;
  const MAIN = 240;
  return [
    // The name banners across the top, above both columns — which is where a real
    // two-column CV puts it, and the case that proves a spanning line is not swept
    // into whichever column it happens to start in.
    { text: 'Amara Okonkwo', x: SIDEBAR, y: TOP, size: 22, bold: true },
    { text: 'SKILLS', x: SIDEBAR, y: TOP - 40, size: 12, bold: true },
    { text: 'EXPERIENCE', x: MAIN, y: TOP - 40, size: 12, bold: true },
    { text: 'Python', x: SIDEBAR, y: TOP - 60 },
    { text: 'Backend Engineer', x: MAIN, y: TOP - 60, bold: true },
    { text: 'PostgreSQL', x: SIDEBAR, y: TOP - 76 },
    { text: 'Paystack, Lagos', x: MAIN, y: TOP - 76 },
    { text: 'Docker', x: SIDEBAR, y: TOP - 92 },
    { text: 'Built payment reconciliation services.', x: MAIN, y: TOP - 92 },
    { text: 'Kubernetes', x: SIDEBAR, y: TOP - 108 },
    { text: 'Data Analyst', x: MAIN, y: TOP - 140, bold: true },
    { text: 'EDUCATION', x: SIDEBAR, y: TOP - 148, size: 12, bold: true },
    { text: 'Andela', x: MAIN, y: TOP - 156 },
    { text: 'BSc Computer Science', x: SIDEBAR, y: TOP - 168 },
  ];
}

/**
 * Roles whose detail sits in indented bullets underneath them. Flattened, every
 * bullet is a peer of every role and nothing says which belongs to which; the
 * indent and the vertical gaps are the only evidence, and they are geometry.
 */
export function bulletedRolesCv(): PdfRun[] {
  const LEFT = 72;
  const INDENT = 92;
  return [
    { text: 'Amara Okonkwo', x: LEFT, y: TOP, size: 22, bold: true },
    { text: 'EXPERIENCE', x: LEFT, y: TOP - 40, size: 13, bold: true },
    { text: 'Backend Engineer, Paystack', x: LEFT, y: TOP - 64, size: 12, bold: true },
    { text: '• Built payment reconciliation in Python.', x: INDENT, y: TOP - 82 },
    { text: '• Cut nightly batch time by half.', x: INDENT, y: TOP - 98 },
    { text: 'Data Analyst, Andela', x: LEFT, y: TOP - 130, size: 12, bold: true },
    { text: '• Reporting over PostgreSQL.', x: INDENT, y: TOP - 148 },
  ];
}

/**
 * Dates in a right-hand gutter, level with the role they belong to. The pairing is
 * a *row*: same baseline, different column. A flat stream loses it, and the CV
 * parser then reports a role with no dates and a date range with no role.
 */
export function dateGutterCv(): PdfRun[] {
  const LEFT = 72;
  const GUTTER = 430;
  return [
    { text: 'Amara Okonkwo', x: LEFT, y: TOP, size: 22, bold: true },
    { text: 'EXPERIENCE', x: LEFT, y: TOP - 40, size: 13, bold: true },
    { text: 'Backend Engineer, Paystack', x: LEFT, y: TOP - 64, size: 12, bold: true },
    { text: '2021 - present', x: GUTTER, y: TOP - 64 },
    { text: 'Data Analyst, Andela', x: LEFT, y: TOP - 96, size: 12, bold: true },
    { text: '2019 - 2021', x: GUTTER, y: TOP - 96 },
  ];
}

/** Arabic for "Mahmoud Nasser" / "Experience" / "Frontend developer". */
const AR_NAME = 'محمود ناصر';
const AR_EXPERIENCE = 'الخبرة';
const AR_ROLE = 'مطور واجهات';

/**
 * A non-Latin CV, as **DOCX** rather than PDF.
 *
 * This is not a shortcut. A PDF drawn in a base-14 font is single-byte encoded, so
 * Arabic cannot be represented in one at all without embedding a font and a
 * ToUnicode CMap — machinery that would test our fixture builder, not our parser.
 * DOCX is UTF-8 XML, so the text arrives exactly as written and the test can be
 * about what it means to be about: that non-Latin text survives extraction, and
 * that the skills taxonomy reads the Latin technology names without inventing
 * matches out of the Arabic.
 */
export function nonLatinCvDocx(): Promise<Uint8Array> {
  return buildDocx(
    paragraphs([
      AR_NAME,
      AR_EXPERIENCE,
      AR_ROLE,
      'TypeScript, Angular, Docker',
      '2020 - present',
    ]),
  );
}
