/**
 * Turning positioned text runs into a readable document (ADR-0028).
 *
 * Everything hard about parsing a CV is layout, and layout is decidable from
 * coordinates alone: which runs share a line, where the columns are, which lines
 * belong together, and which of them is a heading. pdf.js hands all of that over with
 * every run and the old `itemsToText` threw it away — so these tests are written
 * against the geometry, not against strings.
 */
import { describe, expect, it } from 'vitest';
import { layoutPage, type PageInput, type PositionedRun } from './layout';

const BODY = 11;
const BODY_FONT = 'f_body';
const HEAD_FONT = 'f_head';

/** A run placed at (x, y), sized like body text unless told otherwise. */
function run(
  text: string,
  x: number,
  y: number,
  over: Partial<PositionedRun> = {},
): PositionedRun {
  const fontSize = over.fontSize ?? BODY;
  return {
    text,
    x,
    y,
    width: text.length * fontSize * 0.5,
    height: fontSize,
    fontSize,
    fontName: over.fontName ?? BODY_FONT,
    ...over,
  };
}

function page(items: readonly PositionedRun[]): PageInput {
  return { width: 612, height: 792, items };
}

const text = (input: PageInput): string[] => layoutPage(input).blocks.map((b) => b.text);

describe('lines', () => {
  it('joins runs that share a baseline, left to right', () => {
    const out = layoutPage(page([run('world', 103, 100), run('Hello', 72, 100)]));
    expect(out.blocks[0]?.text).toBe('Hello world');
  });

  it('tolerates a baseline that is off by a fraction of the font size', () => {
    const out = layoutPage(page([run('Hello', 72, 100), run('world', 103, 100.9)]));
    expect(out.blocks[0]?.lines).toHaveLength(1);
  });

  it('separates runs that are genuinely on different lines', () => {
    const out = layoutPage(page([run('Hello', 72, 100), run('world', 72, 118)]));
    expect(out.blocks[0]?.lines).toHaveLength(2);
  });

  it('does not weld two words that are a gutter apart', () => {
    // Same baseline, but 300pt of whitespace between them: a date gutter, not a phrase.
    const out = layoutPage(
      page([run('Backend Engineer', 72, 100), run('2021', 430, 100)]),
    );
    expect(out.blocks[0]?.text).toBe('Backend Engineer\t2021');
  });
});

describe('columns', () => {
  /**
   * The headline defect. Read as a flat stream, a sidebar and a main column
   * interleave into nonsense — "SKILLS EXPERIENCE Python Backend Engineer". The gap
   * between them is plainly visible in the x-projection; nothing else is needed.
   */
  const twoColumn = page([
    run('SKILLS', 60, 100, { fontSize: 13, fontName: HEAD_FONT }),
    run('EXPERIENCE', 240, 100, { fontSize: 13, fontName: HEAD_FONT }),
    run('Python', 60, 120),
    run('Backend Engineer', 240, 120),
    run('PostgreSQL', 60, 138),
    run('Paystack', 240, 138),
  ]);

  it('reads a column at a time instead of a row at a time', () => {
    expect(text(twoColumn)).toEqual([
      'SKILLS',
      'Python\nPostgreSQL',
      'EXPERIENCE',
      'Backend Engineer\nPaystack',
    ]);
  });

  it('reports how many columns it found', () => {
    expect(layoutPage(twoColumn).columns).toBe(2);
  });

  it('does not invent a column in ordinary single-column text', () => {
    const single = page([
      run('Amara Okonkwo', 72, 80, { fontSize: 22, fontName: HEAD_FONT }),
      run('Backend Engineer at Paystack', 72, 110),
      run('Built payment reconciliation services', 72, 128),
    ]);
    expect(layoutPage(single).columns).toBe(1);
  });

  /**
   * A name banner runs the full width above both columns. It belongs to neither, and
   * must not be swept into whichever one it happens to start in.
   */
  it('keeps a full-width heading above the columns it spans', () => {
    const withBanner = page([
      run('AMARA OKONKWO', 60, 60, { fontSize: 22, fontName: HEAD_FONT, width: 420 }),
      ...twoColumn.items,
    ]);
    expect(text(withBanner)[0]).toBe('AMARA OKONKWO');
    expect(layoutPage(withBanner).columns).toBe(2);
  });
});

describe('blocks', () => {
  it('starts a new block where the vertical gap jumps', () => {
    const out = layoutPage(
      page([
        run('Backend Engineer', 72, 100),
        run('Paystack', 72, 118),
        // A section break: three times the line spacing.
        run('EDUCATION', 72, 190, { fontSize: 13, fontName: HEAD_FONT }),
        run('BSc Computer Science', 72, 208),
      ]),
    );
    expect(out.blocks.map((b) => b.text)).toEqual([
      'Backend Engineer\nPaystack',
      'EDUCATION',
      'BSc Computer Science',
    ]);
  });

  it('keeps consecutive lines of one paragraph together', () => {
    const out = layoutPage(
      page([run('one', 72, 100), run('two', 72, 118), run('three', 72, 136)]),
    );
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0]?.text).toBe('one\ntwo\nthree');
  });
});

describe('headings', () => {
  it('finds a heading by size, whatever it is called', () => {
    const out = layoutPage(
      page([
        run('Curriculum Vitae of Amara', 72, 80, { fontSize: 20, fontName: HEAD_FONT }),
        run('some body text here', 72, 120),
      ]),
    );
    expect(out.blocks[0]?.kind).toBe('heading');
    expect(out.blocks[1]?.kind).toBe('paragraph');
  });

  /**
   * A CV section heading is often the same size as the body and merely bold. pdf.js
   * cannot say "bold" — it substitutes the standard fonts and reports them all as
   * `sans-serif` — but it does report a stable per-face id, and "set in a different
   * face from the body" is the question that actually matters (ADR-0028).
   */
  it('finds a heading set in a different face at the same size', () => {
    const out = layoutPage(
      page([
        run('EXPERIENCE', 72, 100, { fontName: HEAD_FONT }),
        run('Backend Engineer', 72, 120),
        run('Paystack', 72, 138),
        run('Built things', 72, 156),
      ]),
    );
    expect(out.blocks[0]?.kind).toBe('heading');
  });

  it('does not call the body a heading just because it is the only text', () => {
    const out = layoutPage(page([run('just one line', 72, 100)]));
    expect(out.blocks[0]?.kind).toBe('paragraph');
  });
});

describe('bullets', () => {
  it('recognises a bullet by its marker and strips it', () => {
    const out = layoutPage(
      page([
        run('Backend Engineer', 72, 100, { fontName: HEAD_FONT }),
        run('• Built payment reconciliation', 92, 118),
        run('• Cut batch time by half', 92, 136),
      ]),
    );
    const bullet = out.blocks.find((b) => b.kind === 'bullet');
    expect(bullet).toBeDefined();
    expect(bullet?.lines.map((l) => l.text)).toEqual([
      'Built payment reconciliation',
      'Cut batch time by half',
    ]);
  });

  it.each(['•', '-', '–', '*', '·'])('accepts "%s" as a marker', (mark) => {
    const out = layoutPage(
      page([
        run('Heading', 72, 100, { fontName: HEAD_FONT }),
        run(`${mark} item`, 92, 118),
      ]),
    );
    expect(out.blocks.find((b) => b.kind === 'bullet')?.text).toBe('item');
  });

  it('does not mistake a hyphenated phrase for a bullet', () => {
    const out = layoutPage(page([run('well-known engineer', 72, 100)]));
    expect(out.blocks[0]?.kind).toBe('paragraph');
  });
});

describe('degenerate input', () => {
  it('returns nothing for an empty page', () => {
    expect(layoutPage(page([])).blocks).toEqual([]);
  });

  it('ignores whitespace-only runs', () => {
    expect(layoutPage(page([run('   ', 72, 100)])).blocks).toEqual([]);
  });

  it('is deterministic', () => {
    const input = page([run('b', 140, 100), run('a', 72, 100), run('c', 72, 120)]);
    expect(layoutPage(input)).toEqual(layoutPage(input));
  });

  it('does not depend on the order runs arrive in', () => {
    const items = [run('a', 72, 100), run('b', 140, 100), run('c', 72, 120)];
    const forwards = layoutPage(page(items));
    const backwards = layoutPage(page([...items].reverse()));
    expect(backwards).toEqual(forwards);
  });
});
