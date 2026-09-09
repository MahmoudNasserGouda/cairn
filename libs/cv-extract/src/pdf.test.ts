import { buildPdf } from './__fixtures__/build';
import { extractPdfText, MAX_PDF_PAGES } from './pdf';

describe('extractPdfText', () => {
  it('reads the text layer of a single-page PDF', async () => {
    const pdf = buildPdf(['Ada Lovelace', 'ada@example.com', 'TypeScript, Docker']);
    const result = await extractPdfText(pdf);

    expect(result.pageCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain('Ada Lovelace');
    expect(result.text).toContain('ada@example.com');
    expect(result.text).toContain('TypeScript, Docker');
  });

  it('is deterministic', async () => {
    const pdf = buildPdf(['Senior Frontend Engineer, Acme 2019 - present']);
    const [first, second] = await Promise.all([extractPdfText(pdf), extractPdfText(pdf)]);
    expect(first.text).toBe(second.text);
  });

  it('does not consume the caller-owned buffer', async () => {
    const pdf = buildPdf(['Reusable']);
    await extractPdfText(pdf);
    // pdf.js detaches the buffer it is handed, so we must be handing it a copy.
    expect(pdf.byteLength).toBeGreaterThan(0);
    await expect(extractPdfText(pdf)).resolves.toMatchObject({ pageCount: 1 });
  });

  it('yields no text for a PDF with no text layer, rather than throwing', async () => {
    const result = await extractPdfText(buildPdf([]));
    expect(result.text).toBe('');
  });

  it('rejects a file that is not a PDF', async () => {
    await expect(extractPdfText(new TextEncoder().encode('not a pdf'))).rejects.toThrow();
  });

  it('parses in-process rather than spawning a worker of its own', () => {
    // The bundled fallbacks pdf.js would otherwise reach for are unusable under
    // our CSP, so this registration is load-bearing (see pdf.ts).
    expect((globalThis as { pdfjsWorker?: unknown }).pdfjsWorker).toBeDefined();
  });

  it('caps how many pages it will read', () => {
    expect(MAX_PDF_PAGES).toBeLessThanOrEqual(50);
  });
});
