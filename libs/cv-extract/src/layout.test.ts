/**
 * The geometry pdf.js hands us, and the fixtures that stand in for real CVs.
 *
 * Two jobs. First, prove `extractPdfLayout` reports position, size and font identity
 * faithfully — every layout decision in `libs/doc-layout` rests on these numbers, so
 * a fixture that lies about them would make the whole pipeline's tests worthless.
 * (Weight is deliberately absent: pdf.js reports every standard font as
 * `sans-serif`, so "is this bold" is unanswerable from the text layer. Distinct font
 * ids answer the question that actually matters — see the test that says so.)
 * Second, pin the current flat-text behaviour on the hard shapes, so the defects
 * ADR-0028 exists to fix are facts in the suite rather than claims in a document.
 */
import { describe, expect, it } from 'vitest';
import { extractPdfLayout, extractPdfText, type PdfTextRun } from './pdf';
import { extractCvText } from './extract';
import {
  bulletedRolesCv,
  buildPositionedPdf,
  buildScannedPdf,
  dateGutterCv,
  nonLatinCvDocx,
  singleColumnCv,
  twoColumnCv,
  type PdfRun,
} from './__fixtures__/build';

async function layoutOf(runs: readonly PdfRun[]) {
  return extractPdfLayout(buildPositionedPdf([runs]));
}

/** The run whose text starts with `prefix`, for asserting on one placement. */
function find(items: readonly PdfTextRun[], prefix: string): PdfTextRun {
  const hit = items.find((i) => i.text.startsWith(prefix));
  if (!hit) throw new Error(`no run starting with ${JSON.stringify(prefix)}`);
  return hit;
}

describe('extractPdfLayout', () => {
  it('reports where each run sits, not just what it says', async () => {
    const { pages } = await layoutOf(singleColumnCv());
    const items = pages[0]?.items ?? [];

    const name = find(items, 'Amara');
    const email = find(items, 'amara.okonkwo@');

    expect(name.x).toBeCloseTo(72, 0);
    expect(email.x).toBeCloseTo(72, 0);
    // The email is drawn 20pt below the name. Y grows upward in PDF space, and the
    // layout engine needs a consistent axis — we normalise to "down the page".
    expect(email.y - name.y).toBeCloseTo(20, 0);
  });

  it('reports font size, so a heading is distinguishable from body text', async () => {
    const { pages } = await layoutOf(singleColumnCv());
    const items = pages[0]?.items ?? [];

    expect(find(items, 'Amara').fontSize).toBeCloseTo(22, 0);
    expect(find(items, 'EXPERIENCE').fontSize).toBeCloseTo(13, 0);
    expect(find(items, 'Paystack').fontSize).toBeCloseTo(11, 0);
  });

  /**
   * Not "is it bold" — pdf.js cannot answer that from the text layer, because it
   * substitutes the standard fonts and reports every one of them as `sans-serif`.
   * What it *can* answer is "is this set in a different face from the body", which
   * is the question heading detection actually needs, and which keeps working for
   * embedded fonts whose names nobody can pattern-match.
   */
  it('gives an emphasised run a different font id from body text', async () => {
    const { pages } = await layoutOf(singleColumnCv());
    const items = pages[0]?.items ?? [];

    const heading = find(items, 'EXPERIENCE').fontName;
    const body = find(items, 'Paystack').fontName;

    expect(heading).not.toBe(body);
    // The name uses the same face as the headings at a larger size, so face and
    // size are independent signals and both are reported.
    expect(find(items, 'Amara').fontName).toBe(heading);
    expect(find(items, 'amara.okonkwo@').fontName).toBe(body);
  });

  it('keeps the two columns apart by x, which is what makes them recoverable', async () => {
    const { pages } = await layoutOf(twoColumnCv());
    const items = pages[0]?.items ?? [];

    const sidebar = find(items, 'Python');
    const main = find(items, 'Backend Engineer');

    expect(sidebar.x).toBeCloseTo(60, 0);
    expect(main.x).toBeCloseTo(240, 0);
    // Same baseline, different column — the pair a flat stream turns into one line.
    expect(sidebar.y).toBeCloseTo(main.y, 0);
  });

  it('keeps a bullet indented relative to the role above it', async () => {
    const { pages } = await layoutOf(bulletedRolesCv());
    const items = pages[0]?.items ?? [];

    const role = find(items, 'Backend Engineer');
    const bullet = find(items, '• Built');

    expect(bullet.x).toBeGreaterThan(role.x);
  });

  it('puts a gutter date on the same baseline as its role', async () => {
    const { pages } = await layoutOf(dateGutterCv());
    const items = pages[0]?.items ?? [];

    const role = find(items, 'Backend Engineer');
    const date = find(items, '2021 - present');

    expect(date.y).toBeCloseTo(role.y, 0);
    expect(date.x).toBeGreaterThan(role.x + 300);
  });

  it('carries page size, so x positions can be read as a fraction of the width', async () => {
    const { pages } = await layoutOf(singleColumnCv());
    expect(pages[0]?.width).toBeCloseTo(612, 0);
    expect(pages[0]?.height).toBeCloseTo(792, 0);
  });
});

describe('the fixtures are honest', () => {
  it('round-trips non-Latin text instead of mangling it', async () => {
    const result = await extractCvText('cv.docx', await nonLatinCvDocx());
    expect(result.kind).toBe('docx');
    expect(result.text).toContain('محمود');
    expect(result.text).toContain('TypeScript');
    expect(result.empty).toBe(false);
  });
  it('produces a scanned PDF with no text layer at all', async () => {
    const result = await extractCvText('scan.pdf', buildScannedPdf());
    expect(result.kind).toBe('pdf');
    expect(result.empty).toBe(true);
    expect(result.text.trim()).toBe('');
  });
});

/**
 * What flat extraction does with the hard shapes today.
 *
 * These are not aspirations — they are the current, wrong output, asserted on
 * purpose. `libs/doc-layout` (ADR-0028) is what makes them change, and when it does
 * these tests must be rewritten to the correct expectation rather than deleted.
 */
describe('flat text loses the layout (the defect ADR-0028 fixes)', () => {
  it('interleaves a two-column CV', async () => {
    const { text } = await extractPdfText(buildPositionedPdf([twoColumnCv()]));
    const flat = text.replace(/\s+/g, ' ').trim();

    // The sidebar's "SKILLS" and the main column's "EXPERIENCE" are drawn on one
    // baseline, so they arrive adjacent — as if they were a single heading.
    expect(flat).toContain('SKILLS EXPERIENCE');
    // And a skill name lands between two halves of the role it has nothing to do with.
    expect(flat).toContain('PostgreSQL Paystack');
  });

  /**
   * The date gutter survives flattening — and pinning that matters, because it is
   * the *same* pdf.js behaviour that ruins the two-column case above. Runs sharing a
   * baseline are emitted before the line break, so "role … date" comes out joined
   * and "sidebar … main column" comes out interleaved. One mechanism, two opposite
   * outcomes, and no way to keep the good one without the bad one until reading
   * order is decided from geometry rather than from emission order.
   */
  it('keeps a gutter date with its role — by the rule that breaks columns', async () => {
    const { text } = await extractPdfText(buildPositionedPdf([dateGutterCv()]));
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    expect(lines.some((l) => l.includes('Andela') && l.includes('2019'))).toBe(true);
  });
});
