import { buildDocx, buildPdf, paragraphs } from './__fixtures__/build';
import { detectKind, extractCvText, UnsupportedCvFileError } from './extract';
import { normalizeLines, stripControlChars } from './text';

const encoder = new TextEncoder();

const PLAIN_CV = `Ada Lovelace
ada@example.com

Technical Skills
JavaScript, TypeScript, Angular, Docker

Work Experience
Senior Frontend Engineer, Acme  2019 - present
`;

describe('detectKind', () => {
  it('trusts magic bytes over the filename', async () => {
    const docx = await buildDocx(paragraphs(['x']));
    expect(detectKind('resume.pdf', docx)).toBe('docx');
    expect(detectKind('resume.docx', buildPdf(['x']))).toBe('pdf');
  });

  it('identifies a PDF and a DOCX with no extension at all', async () => {
    expect(detectKind('resume', buildPdf(['x']))).toBe('pdf');
    expect(detectKind('resume', await buildDocx(paragraphs(['x'])))).toBe('docx');
  });

  it('falls back to the extension for plain text, which has no signature', () => {
    for (const name of ['cv.txt', 'CV.MD', 'notes.markdown', 'resume.text']) {
      expect(detectKind(name, encoder.encode('hello'))).toBe('text');
    }
  });

  it('rejects anything else rather than guessing', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(() => detectKind('photo.png', png)).toThrow(UnsupportedCvFileError);
  });
});

describe('extractCvText', () => {
  it('reads a plain-text CV', async () => {
    const result = await extractCvText('cv.txt', encoder.encode(PLAIN_CV));
    expect(result.kind).toBe('text');
    expect(result.empty).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain('Senior Frontend Engineer, Acme 2019 - present');
  });

  it('reads a DOCX', async () => {
    const docx = await buildDocx(paragraphs(PLAIN_CV.trim().split('\n')));
    const result = await extractCvText('cv.docx', docx);
    expect(result.kind).toBe('docx');
    expect(result.empty).toBe(false);
    expect(result.text).toContain('ada@example.com');
  });

  it('reads a PDF and reports its page count', async () => {
    const result = await extractCvText('cv.pdf', buildPdf(PLAIN_CV.trim().split('\n')));
    expect(result.kind).toBe('pdf');
    expect(result.pageCount).toBe(1);
    expect(result.text).toContain('Ada Lovelace');
  });

  it('flags a PDF with no text layer as empty rather than failing', async () => {
    // A scanned CV parses fine and yields nothing; ADR-0011 sends it to manual entry.
    const result = await extractCvText('scan.pdf', buildPdf([]));
    expect(result.empty).toBe(true);
    expect(result.text).toBe('');
  });

  it('treats a near-blank document as empty', async () => {
    const result = await extractCvText('cv.txt', encoder.encode('  CV  '));
    expect(result.empty).toBe(true);
  });

  it('is deterministic', async () => {
    const bytes = encoder.encode(PLAIN_CV);
    const [a, b] = await Promise.all([
      extractCvText('cv.txt', bytes),
      extractCvText('cv.txt', bytes),
    ]);
    expect(a).toEqual(b);
  });
});

describe('normalisation of untrusted text (SECURITY.md T7)', () => {
  const zwsp = String.fromCodePoint(0x200b);
  const bom = String.fromCodePoint(0xfeff);
  const bell = String.fromCodePoint(0x07);
  const esc = String.fromCodePoint(0x1b);

  it('strips control and zero-width characters but keeps tab and newline', () => {
    const smuggled = `Ada${zwsp}Lovelace${bell}${esc}[31m${bom}\tEngineer\nRow`;
    expect(stripControlChars(smuggled)).toBe('AdaLovelace[31m\tEngineer\nRow');
  });

  it('normalises CRLF and lone CR, and caps blank runs', () => {
    expect(normalizeLines('a\r\nb\rc\n\n\n\nd')).toBe('a\nb\nc\n\nd');
  });

  it('squeezes runs of spaces and tabs and trims each line', () => {
    expect(normalizeLines('  Senior   Engineer \t\t Acme  ')).toBe(
      'Senior Engineer Acme',
    );
  });
});
