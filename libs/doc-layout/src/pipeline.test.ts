/**
 * The layout engine against the real fixtures, through real pdf.js.
 *
 * `layout.test.ts` works on hand-placed runs, which proves the algorithm. This proves
 * the *pipeline*: a PDF goes in, `extractPdfLayout` reads its geometry, and the blocks
 * that come out are the ones a person would read off the page.
 *
 * Every assertion here is the inverse of a characterization test in
 * `libs/cv-extract/src/layout.test.ts`, which pins what flat extraction does to the
 * same files. Those are the defects; these are the fixes.
 */
import { describe, expect, it } from 'vitest';
import { extractPdfLayout } from '@cairn/cv-extract';
import {
  buildPositionedPdf,
  bulletedRolesCv,
  dateGutterCv,
  singleColumnCv,
  twoColumnCv,
  type PdfRun,
} from '@cairn/cv-extract/testing';
import { layoutPage, type LayoutBlock, type PageInput } from './layout';

async function blocksOf(runs: readonly PdfRun[]): Promise<LayoutBlock[]> {
  const { pages } = await extractPdfLayout(buildPositionedPdf([runs]));
  const page = pages[0];
  if (!page) throw new Error('no page');
  return [...layoutPage(page).blocks];
}

const textOf = (blocks: readonly LayoutBlock[]): string[] => blocks.map((b) => b.text);

describe('a single-column CV', () => {
  it('reads top to bottom, with the sections intact', async () => {
    const blocks = await blocksOf(singleColumnCv());
    const text = textOf(blocks).join('\n');

    expect(text).toContain('Amara Okonkwo');
    expect(text).toContain('EXPERIENCE');
    expect(text).toContain('Python, PostgreSQL, Docker, Kubernetes');
    expect(textOf(blocks).indexOf('EXPERIENCE')).toBeLessThan(
      textOf(blocks).findIndex((t) => t.includes('SKILLS')),
    );
  });

  it('marks the name and the section headings as headings', async () => {
    const blocks = await blocksOf(singleColumnCv());
    const headings = blocks.filter((b) => b.kind === 'heading').map((b) => b.text);

    expect(headings).toContain('EXPERIENCE');
    expect(headings).toContain('SKILLS');
  });
});

describe('a two-column CV', () => {
  /**
   * The defect this whole library exists for. Flat extraction produces
   * "SKILLS EXPERIENCE" and "PostgreSQL Paystack, Lagos" — a sidebar welded to a main
   * column one baseline at a time. See the characterization test in
   * `libs/cv-extract/src/layout.test.ts`, which asserts exactly that.
   */
  it('no longer interleaves the sidebar into the main column', async () => {
    const flat = textOf(await blocksOf(twoColumnCv())).join('\n');

    expect(flat).not.toContain('SKILLS EXPERIENCE');
    expect(flat).not.toContain('PostgreSQL Paystack');
  });

  it('reads each column as a column', async () => {
    const blocks = await blocksOf(twoColumnCv());
    const joined = textOf(blocks).join('\n');

    // The sidebar's skills end up together, in order, and away from the main column.
    expect(joined).toContain('Python\nPostgreSQL\nDocker\nKubernetes');
    // And the main column's role keeps its own detail.
    expect(joined).toContain('Backend Engineer\nPaystack, Lagos');
  });

  it('puts the full-width name above both columns', async () => {
    const blocks = await blocksOf(twoColumnCv());
    expect(blocks[0]?.text).toBe('Amara Okonkwo');
  });
});

describe('a CV with a date gutter', () => {
  /**
   * A date gutter and a sidebar column are geometrically identical, and this library
   * deliberately does **not** guess which it is looking at — that judgement needs
   * meaning, not coordinates, and belongs in `libs/cv-parse`.
   *
   * What it guarantees instead is that the rows stay recoverable: the dates are split
   * into their own column, and each date line keeps the baseline of the role it dates.
   * Pairing them back up is then a lookup by `y`, not a guess.
   */
  it('separates the dates but keeps each level with its role', async () => {
    const { pages } = await extractPdfLayout(buildPositionedPdf([dateGutterCv()]));
    const blocks = layoutPage(pages[0] as PageInput).blocks;
    const lines = blocks.flatMap((b) => b.lines.map((l) => ({ ...l, column: b.column })));

    for (const [roleText, dateText] of [
      ['Backend Engineer', '2021 - present'],
      ['Data Analyst', '2019 - 2021'],
    ]) {
      const role = lines.find((l) => l.text.includes(roleText as string));
      const date = lines.find((l) => l.text.includes(dateText as string));

      expect(role, roleText).toBeDefined();
      expect(date, dateText).toBeDefined();
      // Different columns...
      expect(date?.column).not.toBe(role?.column);
      // ...but the same row, which is what makes them re-pairable.
      expect(date?.y).toBeCloseTo(role?.y ?? -1, 0);
    }
  });
});

describe('a CV with bulleted roles', () => {
  /**
   * Flattened, every bullet is a peer of every role and nothing says which belongs to
   * which. The indent and the vertical gaps are the only evidence, and they are
   * geometry — so the bullets group under the role above them, in order.
   */
  it('groups the bullets under the role they belong to', async () => {
    const blocks = await blocksOf(bulletedRolesCv());
    const kinds = blocks.map((b) => `${b.kind}:${b.text.split('\n')[0]}`);

    const firstRole = kinds.findIndex((k) => k.includes('Backend Engineer'));
    const firstBullets = kinds.findIndex((k) => k.startsWith('bullet:Built'));
    const secondRole = kinds.findIndex((k) => k.includes('Data Analyst'));
    const secondBullets = kinds.findIndex((k) => k.startsWith('bullet:Reporting'));

    expect(firstRole).toBeGreaterThanOrEqual(0);
    expect(firstBullets).toBeGreaterThan(firstRole);
    expect(secondRole).toBeGreaterThan(firstBullets);
    expect(secondBullets).toBeGreaterThan(secondRole);
  });

  it('strips the markers and keeps the bullets of one role together', async () => {
    const blocks = await blocksOf(bulletedRolesCv());
    const bullets = blocks.filter((b) => b.kind === 'bullet');

    expect(bullets[0]?.lines.map((l) => l.text)).toEqual([
      'Built payment reconciliation in Python.',
      'Cut nightly batch time by half.',
    ]);
  });
});
