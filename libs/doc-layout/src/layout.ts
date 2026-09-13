/**
 * Positioned text runs -> a readable document (ADR-0028).
 *
 * Everything hard about parsing a CV is layout, and layout is decidable from
 * coordinates: which runs share a line, where the columns are, which lines belong
 * together, and which of them is a heading. pdf.js reports all of that with every run
 * — `str`, a transform carrying x and y, a width, a rendered size, a font id — and the
 * old `itemsToText` kept two of those and discarded the rest. That is why a
 * two-column CV interleaved and a bullet detached from its role.
 *
 * Pure: no IO, no clock, no randomness, no dependency on how the runs were obtained.
 * OCR output lands here in exactly the same shape as a text layer.
 */

/** One drawn run of text. `y` increases **downward**, so reading order is ascending. */
export interface PositionedRun {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  /** A stable per-face id. See `isEmphasised` for why this, and not a bold flag. */
  readonly fontName: string;
}

export interface PageInput {
  readonly width: number;
  readonly height: number;
  readonly items: readonly PositionedRun[];
}

export type BlockKind = 'heading' | 'paragraph' | 'bullet';

export interface LayoutLine {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
  readonly fontName: string;
  readonly runs: readonly PositionedRun[];
}

export interface LayoutBlock {
  readonly kind: BlockKind;
  readonly lines: readonly LayoutLine[];
  /** The block's lines joined by newlines, markers already stripped. */
  readonly text: string;
  /** 0-based, left to right. Full-width lines belong to no column and report -1. */
  readonly column: number;
}

export interface PageLayout {
  readonly blocks: readonly LayoutBlock[];
  readonly columns: number;
}

// ---------------------------------------------------------------------------
// Thresholds
//
// All relative to the text itself rather than absolute point values, so a CV set in
// 9pt and one set in 12pt are read the same way.
// ---------------------------------------------------------------------------

/** Baselines within this fraction of the font size are the same line. */
const LINE_TOLERANCE = 0.5;
/** A same-line gap wider than this many ems is a gutter, not a word space. */
const GUTTER_EMS = 2.5;
/** A vertical gap this much larger than the usual line pitch starts a new block. */
const BLOCK_GAP_RATIO = 1.6;
/** Text this much larger than the body is a heading whatever it says. */
const HEADING_SIZE_RATIO = 1.15;
/** A column gutter must be at least this fraction of the page width. */
const MIN_COLUMN_GAP = 0.06;
/** Distinct baselines needed on each side before a gap counts as a column boundary. */
const MIN_COLUMN_ROWS = 2;
/** Share of rows that may cross a gutter — a banner does, a column of prose does not. */
const ALLOWED_CROSSING_RATIO = 0.15;
/** Sampling resolution for the x-projection. */
const GUTTER_SAMPLES = 240;
/** Font sizes closer than this are the same style. */
const STYLE_EPSILON = 0.6;

const BULLET_MARKERS = ['•', '·', '●', '▪', '⁃', '*'];
/** Dashes only count as markers with a space after them — "well-known" is a word. */
const DASH_MARKERS = ['-', '–', '—'];

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

/** The value carrying the most characters — the body size, or the body face. */
function dominant<T extends string | number>(
  runs: readonly PositionedRun[],
  pick: (run: PositionedRun) => T,
): T | undefined {
  const weight = new Map<T, number>();
  for (const run of runs) {
    const key = pick(run);
    weight.set(key, (weight.get(key) ?? 0) + run.text.trim().length);
  }
  let best: T | undefined;
  let bestWeight = -1;
  // Ties broken by value, so the result does not depend on insertion order.
  for (const [key, value] of [...weight.entries()].sort((a, b) =>
    String(a[0]).localeCompare(String(b[0])),
  )) {
    if (value > bestWeight) {
      best = key;
      bestWeight = value;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 1. Runs -> lines
// ---------------------------------------------------------------------------

/**
 * Group runs that share a baseline.
 *
 * Runs are sorted by y and then x first, so the result cannot depend on the order
 * pdf.js happened to emit them in — which is an emission order, not a reading order,
 * and is exactly what the flat extractor mistook for one.
 */
function toLines(runs: readonly PositionedRun[]): LayoutLine[] {
  const sorted = [...runs]
    .filter((r) => r.text.trim().length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const groups: PositionedRun[][] = [];
  for (const run of sorted) {
    const current = groups[groups.length - 1];
    const anchor = current?.[0];
    const tolerance = Math.max(anchor?.fontSize ?? run.fontSize, 1) * LINE_TOLERANCE;
    if (current && anchor && Math.abs(run.y - anchor.y) <= tolerance) {
      current.push(run);
    } else {
      groups.push([run]);
    }
  }

  return groups.map((group) => {
    const ordered = [...group].sort((a, b) => a.x - b.x);
    const first = ordered[0] as PositionedRun;
    return {
      text: joinRuns(ordered),
      x: first.x,
      y: first.y,
      fontSize: Math.max(...ordered.map((r) => r.fontSize)),
      fontName: dominant(ordered, (r) => r.fontName) ?? first.fontName,
      runs: ordered,
    };
  });
}

/**
 * Join runs on one line, marking a wide gap with a tab rather than a space.
 *
 * A date sitting in a right-hand gutter is on the same baseline as its role but is
 * not part of the sentence. Welding them with a space loses the distinction; a tab
 * keeps the column visible for whoever parses the line next.
 */
function joinRuns(ordered: readonly PositionedRun[]): string {
  let out = (ordered[0]?.text ?? '').trim();
  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1] as PositionedRun;
    const run = ordered[i] as PositionedRun;
    const gap = run.x - (previous.x + previous.width);
    const separator = gap > run.fontSize * GUTTER_EMS ? '\t' : ' ';
    out += separator + run.text.trim();
  }
  return trimTrailingSpace(out);
}

/**
 * Trim trailing spaces and tabs, without a regex.
 *
 * `/[ \t]+$/` is the same run-then-anchor shape CodeQL has now flagged five times in
 * this codebase: the engine consumes the whole run, fails the `$`, gives one character
 * back, fails again, and restarts from the next offset. Measured on a line of tabs:
 * 20k in 242ms, 60k in **2.2 seconds** — and the tabs here come from column gaps in an
 * untrusted document, so a hostile CV decides how many there are.
 *
 * Worth naming plainly: this library was written to avoid exactly this, and the claim
 * that it kept regexes off the hot path was wrong. The scanner caught what the author
 * did not.
 */
function trimTrailingSpace(value: string): string {
  let end = value.length;
  while (end > 0) {
    const code = value.charCodeAt(end - 1);
    if (code !== 32 && code !== 9) break;
    end--;
  }
  return value.slice(0, end);
}

// ---------------------------------------------------------------------------
// 2. Lines -> columns
// ---------------------------------------------------------------------------

interface Span {
  readonly left: number;
  readonly right: number;
}

function runSpan(run: PositionedRun): Span {
  return { left: run.x, right: run.x + run.width };
}

/**
 * Find the vertical gutter separating two columns, if there is one.
 *
 * **Measured on runs, before they are grouped into lines** — which is the whole trick.
 * A sidebar entry and a main-column entry printed at the same height share a baseline,
 * so grouping first welds them into one line that spans the gutter and hides it. That
 * merged line *is* the interleaving this exists to undo; detecting columns from it
 * would be circular.
 *
 * The method is an x-projection with a **tolerance**, not a search for a perfectly
 * empty band. An earlier version demanded zero crossings, and a name banner across the
 * top of a two-column CV — one run, straddling the boundary — was enough to hide the
 * gutter underneath it. Excluding wide runs instead did not work either: a banner need
 * not be wide, it only needs to straddle. So a few crossings are allowed, and what
 * separates a gutter from ordinary prose is that prose is crossed by *most* rows while
 * a gutter is crossed by almost none.
 *
 * Only one split is looked for. Three-column CVs exist, and are rare enough that
 * guessing at them would cost more in false splits than it would gain.
 */
function findGutter(runs: readonly PositionedRun[], pageWidth: number): number | null {
  if (runs.length < 2) return null;
  const spans = runs.map(runSpan);
  const left = Math.min(...spans.map((s) => s.left));
  const right = Math.max(...spans.map((s) => s.right));
  const usedWidth = right - left;
  if (usedWidth <= 0) return null;

  const rowOf = (run: PositionedRun): number =>
    Math.round(run.y / Math.max(run.fontSize, 1));
  const rows = new Set(runs.map(rowOf));
  const allowed = Math.max(1, Math.floor(rows.size * ALLOWED_CROSSING_RATIO));

  const step = Math.max(usedWidth / GUTTER_SAMPLES, 0.5);
  const clear: boolean[] = [];
  for (let x = left; x <= right; x += step) {
    const crossings = spans.filter((s) => s.left < x && s.right > x).length;
    clear.push(crossings <= allowed);
  }

  // Collect every clear band, not just the widest one. The ragged right margin of a
  // single wide column is also "clear", and on a page whose gutter carries a banner it
  // can be the *wider* of the two — so taking the widest and testing it in isolation
  // found the margin, rejected it, and reported no columns at all. Each candidate is
  // tried in turn, widest first, and the first that is a real boundary wins.
  const bands: { at: number; width: number }[] = [];
  let runStart = -1;
  clear.forEach((isClear, i) => {
    if (isClear && runStart === -1) runStart = i;
    if ((!isClear || i === clear.length - 1) && runStart !== -1) {
      const length = (isClear ? i + 1 : i) - runStart;
      bands.push({
        at: left + (runStart + length / 2) * step,
        width: length * step,
      });
      runStart = -1;
    }
  });

  const rowOfRun = (run: PositionedRun): number => rowOf(run);
  const minimum = pageWidth * MIN_COLUMN_GAP;

  for (const band of bands.sort((a, b) => b.width - a.width)) {
    if (band.width < minimum) break;

    // Both sides must have rows that *begin* there. Without this, the clear band just
    // inside a single column's ragged right edge reads as a gutter.
    const startsLeft = new Set<number>();
    const startsRight = new Set<number>();
    for (const run of runs) {
      (run.x < band.at ? startsLeft : startsRight).add(rowOfRun(run));
    }
    if (startsLeft.size >= MIN_COLUMN_ROWS && startsRight.size >= MIN_COLUMN_ROWS) {
      return band.at;
    }
  }
  return null;
}

/** Which column a run belongs to: 0, 1, or -1 when it spans the gutter. */
function columnOfRun(run: PositionedRun, gutter: number): number {
  const span = runSpan(run);
  if (span.left < gutter && span.right > gutter) return -1;
  return span.left >= gutter ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 3. Lines -> blocks
// ---------------------------------------------------------------------------

function bulletBody(text: string): string | null {
  for (const marker of BULLET_MARKERS) {
    if (text.startsWith(marker)) return text.slice(marker.length).trim();
  }
  for (const marker of DASH_MARKERS) {
    if (text.startsWith(`${marker} `)) return text.slice(marker.length).trim();
  }
  return null;
}

/**
 * Is this line set apart from the body?
 *
 * Size answers it when a heading is larger. When it is not — a CV section heading is
 * often body-sized and merely bold — the font *id* answers it instead. pdf.js cannot
 * report weight: it substitutes the standard fonts and describes every one of them as
 * `sans-serif`, and the objects that carry the real name resolve only after
 * `render()`, which the extraction path deliberately never calls. The per-face id it
 * does report is the better signal anyway, because "set differently from the body"
 * is the actual question and it survives embedded fonts with arbitrary names.
 */
function isEmphasised(line: LayoutLine, bodySize: number, bodyFont: string): boolean {
  return line.fontSize >= bodySize * HEADING_SIZE_RATIO || line.fontName !== bodyFont;
}

function kindOf(
  line: LayoutLine,
  bodySize: number,
  bodyFont: string,
): { kind: BlockKind; text: string } {
  const body = bulletBody(line.text);
  if (body !== null) return { kind: 'bullet', text: body };
  return {
    kind: isEmphasised(line, bodySize, bodyFont) ? 'heading' : 'paragraph',
    text: line.text,
  };
}

/**
 * Group a column's lines into blocks.
 *
 * Two things start a new one: a vertical gap noticeably larger than the column's own
 * line pitch, and a change of kind. The pitch is measured per column rather than
 * assumed, because a sidebar is often set tighter than the main text.
 */
function toBlocks(
  lines: readonly LayoutLine[],
  column: number,
  bodySize: number,
  bodyFont: string,
): LayoutBlock[] {
  if (lines.length === 0) return [];

  const gaps = lines.slice(1).map((line, i) => line.y - (lines[i] as LayoutLine).y);
  const pitch = median(gaps.filter((g) => g > 0)) || (lines[0] as LayoutLine).fontSize;

  const blocks: LayoutBlock[] = [];
  let current: { kind: BlockKind; lines: LayoutLine[]; texts: string[] } | null = null;

  lines.forEach((line, index) => {
    const { kind, text } = kindOf(line, bodySize, bodyFont);
    const previous = lines[index - 1];
    const gap = previous ? line.y - previous.y : 0;
    const broken = previous !== undefined && gap > pitch * BLOCK_GAP_RATIO;
    // A block is homogeneous in *style*, not merely in kind. A section heading and
    // the role title under it are both emphasised, so without this they merge into a
    // single block holding "EXPERIENCE" and "Backend Engineer" — two different things
    // at two different levels.
    const restyled =
      previous !== undefined &&
      (Math.abs(line.fontSize - previous.fontSize) > STYLE_EPSILON ||
        line.fontName !== previous.fontName);

    if (current === null || broken || restyled || current.kind !== kind) {
      if (current) {
        blocks.push({
          kind: current.kind,
          lines: current.lines,
          text: current.texts.join('\n'),
          column,
        });
      }
      current = { kind, lines: [], texts: [] };
    }
    current.lines.push({ ...line, text });
    current.texts.push(text);
  });

  if (current !== null) {
    const finished = current as { kind: BlockKind; lines: LayoutLine[]; texts: string[] };
    blocks.push({
      kind: finished.kind,
      lines: finished.lines,
      text: finished.texts.join('\n'),
      column,
    });
  }
  return blocks;
}

/**
 * What "ordinary text" looks like on this page.
 *
 * Both figures resisted the obvious answer, for the same reason. Taking the most
 * common size *by character count* breaks on a short document where one long heading
 * carries more characters than the body it introduces — so the size is the **median
 * line's**, which a heading cannot dominate however long it is.
 *
 * The face has the same problem and needs a different fix, because faces are
 * categorical and have no median. So it is read only from lines that are **not
 * already headings by size**: whatever face the un-emphasised text uses is the body
 * face, and everything else is emphasis. Reading it from every line let a large
 * heading define the body face, after which every actual body line looked emphasised.
 */
function bodyStyle(
  lines: readonly LayoutLine[],
  runs: readonly PositionedRun[],
): { bodySize: number; bodyFont: string } {
  const bodySize = median(lines.map((l) => l.fontSize));
  const ordinary = lines.filter((l) => l.fontSize < bodySize * HEADING_SIZE_RATIO);
  const candidates = (ordinary.length > 0 ? ordinary : lines).flatMap((l) => l.runs);
  const bodyFont =
    dominant(candidates, (r) => r.fontName) ?? (runs[0] as PositionedRun).fontName;
  return { bodySize, bodyFont };
}

// ---------------------------------------------------------------------------
// 4. The whole page
// ---------------------------------------------------------------------------

/**
 * Lay out one page into blocks, in reading order.
 *
 * Reading order is the point. A flat extractor emits runs in the order the PDF drew
 * them, which for a two-column CV interleaves the sidebar into the main text one line
 * at a time. Here, a full-width line breaks the page into bands, and each band is read
 * column by column — so a name banner stays above the columns it spans, and a sidebar
 * is read as a sidebar.
 */
export function layoutPage(page: PageInput): PageLayout {
  const runs = [...page.items].filter((r) => r.text.trim().length > 0);
  if (runs.length === 0) return { blocks: [], columns: 0 };

  const allLines = toLines(runs);
  const { bodySize, bodyFont } = bodyStyle(allLines, runs);

  const gutter = findGutter(runs, page.width);
  if (gutter === null) {
    return { blocks: toBlocks(allLines, 0, bodySize, bodyFont), columns: 1 };
  }

  // Group runs by column *first*, then into lines within each column, so a sidebar
  // entry and a main-column entry at the same height stay apart.
  const byColumn: PositionedRun[][] = [[], [], []]; // [spanning, left, right]
  for (const run of runs) {
    const column = columnOfRun(run, gutter);
    (byColumn[column === -1 ? 0 : column + 1] as PositionedRun[]).push(run);
  }

  const spanning = toLines(byColumn[0] as PositionedRun[]);
  const columns = [
    toLines(byColumn[1] as PositionedRun[]),
    toLines(byColumn[2] as PositionedRun[]),
  ];

  // A full-width line breaks the page into bands: everything below it and above the
  // next one is read column by column. That is what keeps a name banner above the
  // columns it spans instead of inside whichever one it happens to start in.
  const boundaries = [...spanning.map((l) => l.y), Infinity];
  const blocks: LayoutBlock[] = [];
  let from = -Infinity;

  boundaries.forEach((boundary, index) => {
    for (const column of [0, 1]) {
      const slice = (columns[column] as LayoutLine[]).filter(
        (l) => l.y > from && l.y < boundary,
      );
      blocks.push(...toBlocks(slice, column, bodySize, bodyFont));
    }
    const banner = spanning[index];
    if (banner) blocks.push(...toBlocks([banner], -1, bodySize, bodyFont));
    from = boundary;
  });

  return { blocks, columns: 2 };
}

/** Lay out every page of a document, concatenated in order. */
export function layoutDocument(pages: readonly PageInput[]): LayoutBlock[] {
  return pages.flatMap((page) => layoutPage(page).blocks);
}
