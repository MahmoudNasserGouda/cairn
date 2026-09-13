import { extractSkills, type SkillTag } from '@cairn/shared';
import type { LayoutBlock, LayoutLine, PageLayout } from '@cairn/doc-layout';

/**
 * Layout blocks -> a structured CV (ADR-0028).
 *
 * `libs/doc-layout` answers *what is on the page and in what order*. This answers
 * *what it means*: which section a block belongs to, which lines are roles, which
 * dates belong to which role.
 *
 * The split is the point. Geometry cannot tell a right-hand date gutter from a
 * sidebar column — they are the same shape — so the layout engine refuses to guess
 * and carries `y` through instead. Here, "that looks like a date range, and it is
 * level with that role" is a judgement the code is allowed to make, because here it
 * is reading meaning rather than coordinates.
 *
 * Pure: no IO, no clock, no randomness. Provenance is stamped by the caller.
 */

export interface ParsedRole {
  readonly title: string;
  readonly organization?: string;
  readonly startYear?: number;
  readonly endYear?: number | 'present';
  /** The role's bullet points, in document order. */
  readonly highlights: readonly string[];
}

export interface ParsedEducation {
  readonly institution: string;
  readonly startYear?: number;
  readonly endYear?: number | 'present';
}

export type CvSection =
  | 'summary'
  | 'experience'
  | 'education'
  | 'skills'
  | 'projects'
  | 'certifications'
  | 'languages';

export interface ParsedCv {
  readonly name?: string;
  readonly email?: string;
  readonly skills: readonly SkillTag[];
  readonly experience: readonly ParsedRole[];
  readonly education: readonly ParsedEducation[];
  /** Sections the parser recognised, for the review UI. */
  readonly sections: readonly CvSection[];
}

// ---------------------------------------------------------------------------
// Recognisers
// ---------------------------------------------------------------------------

/**
 * Section headings, by the words people actually use.
 *
 * Matched on a normalised heading rather than by substring: "SKILLS & TOOLS" and
 * "Technical Skills" are both the skills section, but a *paragraph* mentioning skills
 * is not. Only blocks the layout engine already called a heading are consulted, which
 * is what makes a keyword list safe here where it was not safe over raw text.
 */
const SECTION_WORDS: Readonly<Record<string, CvSection>> = {
  summary: 'summary',
  profile: 'summary',
  about: 'summary',
  objective: 'summary',
  experience: 'experience',
  employment: 'experience',
  work: 'experience',
  career: 'experience',
  education: 'education',
  academic: 'education',
  qualifications: 'education',
  skills: 'skills',
  technologies: 'skills',
  competencies: 'skills',
  projects: 'projects',
  portfolio: 'projects',
  certifications: 'certifications',
  certificates: 'certifications',
  licenses: 'certifications',
  languages: 'languages',
};

const EMAIL = /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,255}\.[a-z]{2,24}/i;

/**
 * A date range, as CVs write them. Bounded quantifiers throughout: this runs over
 * untrusted CV text, and an unbounded `\d+` or `[^-]*` here is the shape that made
 * three other patterns quadratic (see the ReDoS fixes in #42 and #44).
 */
const DATE_RANGE =
  /\b((?:19|20)\d{2})\s{0,4}(?:-|–|—|to|until)\s{0,4}((?:19|20)\d{2}|present|current|now|today)\b/i;
/** A lone year, for a role dated only by when it started. */
const SINGLE_YEAR = /\b((?:19|20)\d{2})\b/;

const PRESENT = /^(?:present|current|now|today)$/i;

function normaliseHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .trim();
}

function sectionOf(block: LayoutBlock): CvSection | null {
  if (block.kind !== 'heading') return null;
  // A heading is a few words; a long line of prose set in bold is not a section.
  const words = normaliseHeading(block.text).split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return null;
  for (const word of words) {
    const section = SECTION_WORDS[word];
    if (section) return section;
  }
  return null;
}

interface DateRange {
  readonly startYear: number;
  readonly endYear?: number | 'present';
}

function dateRangeIn(text: string): DateRange | null {
  const range = DATE_RANGE.exec(text);
  if (range) {
    const end = range[2] as string;
    return {
      startYear: Number(range[1]),
      endYear: PRESENT.test(end) ? 'present' : Number(end),
    };
  }
  const single = SINGLE_YEAR.exec(text);
  return single ? { startYear: Number(single[1]) } : null;
}

/**
 * Split "Backend Engineer, Paystack" into a title and an employer.
 *
 * Only on a separator the writer put there. Guessing which half of an unpunctuated
 * line is the employer would be inventing data, and `organization` feeds the identity
 * key a role is merged on (ADR-0031) — a wrong guess there does not just display
 * badly, it splits one role into two.
 */
function splitTitle(text: string): { title: string; organization?: string } {
  // A comma rarely has a space before it; the word-ish separators always do. Requiring
  // leading whitespace for all of them meant "Backend Engineer, Paystack" never split
  // at all, and the employer then had to be guessed from the next line instead.
  const separator = /\s*(?:,|·|\||—|–)\s+|\s+(?:at|@)\s+/i.exec(text);
  if (!separator || separator.index === 0) return { title: text.trim() };

  const title = text.slice(0, separator.index).trim();
  const organization = text.slice(separator.index + separator[0].length).trim();
  return organization.length > 0 && title.length > 0
    ? { title, organization }
    : { title: text.trim() };
}

/**
 * Could this plain line be the employer of the role above it?
 *
 * A CV writes an employer on its own line as often as it writes it beside the title,
 * so a plain line under a role has to be considered — but a role's *description* sits
 * in exactly the same place. An employer is a name: short, and not a sentence. Without
 * this guard, "Payment reconciliation services in Python." became the employer of the
 * role above it, which then keyed the whole role on a sentence (ADR-0031 merges on
 * organisation, so a wrong one splits one job into two).
 */
function looksLikeOrganization(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    words.length > 0 &&
    words.length <= 5 &&
    text.length <= 60 &&
    !/[.!?]$/.test(text.trim()) &&
    !/^\d/.test(text)
  );
}

// ---------------------------------------------------------------------------
// Re-pairing a date column
// ---------------------------------------------------------------------------

/** Baselines within this fraction of a line's height count as the same row. */
const ROW_TOLERANCE = 0.6;

/**
 * Lines that are nothing but a date, which the layout engine put in their own column.
 *
 * This is the other half of the bargain in ADR-0028: geometry splits a right-hand
 * gutter because it cannot know what it is, and the dates are re-attached here by
 * baseline. Only lines that are *entirely* a date qualify — a sidebar entry that
 * happens to mention a year is content, not an annotation.
 */
function dateAnnotations(blocks: readonly LayoutBlock[]): Map<number, DateRange> {
  const byRow = new Map<number, DateRange>();
  for (const block of blocks) {
    for (const line of block.lines) {
      const range = dateOnly(line.text);
      if (range) byRow.set(line.y, range);
    }
  }
  return byRow;
}

/** The range on a line that is *nothing but* a date, or null. */
function dateOnly(text: string): DateRange | null {
  const range = dateRangeIn(text);
  if (!range) return null;
  const rest = text.replace(DATE_RANGE, '').replace(/[\s,.\-–—]+/g, '');
  return rest.length === 0 ? range : null;
}

function annotationFor(
  line: LayoutLine,
  annotations: ReadonlyMap<number, DateRange>,
): DateRange | null {
  const tolerance = Math.max(line.fontSize, 1) * ROW_TOLERANCE;
  for (const [y, range] of annotations) {
    if (Math.abs(y - line.y) <= tolerance) return range;
  }
  return null;
}

/**
 * A block that is only a date column, and must not become a role of its own.
 *
 * Tested on each line's **own text**, not on whether an annotation exists at its
 * baseline. Keying on `y` alone was the obvious shortcut and it was wrong in exactly
 * the case this whole path exists for: a role sharing a baseline with its date looked
 * like a date, so "Backend Engineer, Paystack" was skipped as an annotation and the
 * role vanished from the CV.
 */
function isDateOnly(block: LayoutBlock): boolean {
  return block.lines.length > 0 && block.lines.every((l) => dateOnly(l.text) !== null);
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

/** A role being assembled from the lines under its heading. */
interface RoleDraft {
  role: ParsedRole;
  readonly highlights: string[];
}

/**
 * Read a laid-out page as a CV.
 *
 * One pass with a **section cursor**, which is how a person reads one: a heading
 * changes what the blocks after it mean, and nothing else does. The old parser had no
 * cursor — it scanned every line for a date range and called whatever was left a job
 * title, which is why a CV's education ended up in its work history.
 *
 * Written as a plain loop over explicit state rather than with callbacks. An earlier
 * version passed `openRole` in and out through closures, and TypeScript could not
 * narrow it across them; the shape that defeats the compiler is usually the shape that
 * defeats the reader too.
 */
export function parseCv(page: PageLayout): ParsedCv {
  const blocks = page.blocks;
  const annotations = dateAnnotations(blocks);

  const sections = new Set<CvSection>();
  const experience: ParsedRole[] = [];
  const education: ParsedEducation[] = [];
  const prose: string[] = [];

  let section: CvSection | null = null;
  let draft: RoleDraft | null = null;

  const close = (): void => {
    if (draft === null) return;
    experience.push({ ...draft.role, highlights: [...draft.highlights] });
    draft = null;
  };

  for (const block of blocks) {
    const heading = sectionOf(block);
    if (heading !== null) {
      close();
      sections.add(heading);
      section = heading;
      continue;
    }

    // A column holding nothing but dates has already been read as annotation. Letting
    // it through would put "2021 - present" in the CV as though it were a job.
    if (isDateOnly(block)) continue;

    if (block.kind === 'bullet') {
      prose.push(block.text);
      if (draft !== null) draft.highlights.push(...block.lines.map((l) => l.text));
      continue;
    }

    if (section === 'experience') {
      draft = readExperience(block, annotations, draft, close);
      continue;
    }

    if (section === 'education') {
      for (const line of block.lines) {
        const range = dateRangeIn(line.text) ?? annotationFor(line, annotations);
        const institution = line.text.replace(DATE_RANGE, '').replace(/\t/g, ' ').trim();
        if (institution.length > 0) education.push({ institution, ...(range ?? {}) });
      }
      continue;
    }

    // Everything else — the header, skills, projects, certifications, a summary — is
    // read for technologies. A skills line and a project description mention the same
    // things, and the taxonomy is the one vocabulary that decides what counts.
    prose.push(block.text);
  }
  close();

  const email = EMAIL.exec(blocks.map((b) => b.text).join('\n'))?.[0];
  const name = nameFrom(blocks, email);

  return {
    ...(name !== null ? { name } : {}),
    ...(email !== undefined ? { email } : {}),
    skills: extractSkills(prose.join('\n')),
    experience,
    education,
    sections: [...sections],
  };
}

/**
 * One block inside the experience section. Returns the role left open, if any.
 *
 * An emphasised line starts a role; a plain line under an open one fills in what the
 * heading did not say — the employer, or the dates when the CV keeps them in a gutter.
 */
function readExperience(
  block: LayoutBlock,
  annotations: ReadonlyMap<number, DateRange>,
  open: RoleDraft | null,
  close: () => void,
): RoleDraft | null {
  let draft = open;

  for (const line of block.lines) {
    const range = dateRangeIn(line.text) ?? annotationFor(line, annotations);
    const rest = line.text.replace(DATE_RANGE, '').replace(/\t/g, ' ').trim();

    // A line that is *only* a date still dates the role above it. Skipping it before
    // applying the range left "Backend Engineer / Paystack / 2021 - present" with no
    // years at all — the date was read, then thrown away for having nothing else on it.
    if (rest.length === 0) {
      if (draft !== null && range && draft.role.startYear === undefined) {
        draft.role = { ...draft.role, ...range };
      }
      continue;
    }

    if (block.kind === 'heading' || draft === null) {
      close();
      const { title, organization } = splitTitle(rest);
      draft = {
        role: {
          title,
          ...(organization !== undefined ? { organization } : {}),
          ...(range ?? {}),
          highlights: [],
        },
        highlights: [],
      };
      continue;
    }

    if (draft.role.organization === undefined && looksLikeOrganization(rest)) {
      draft.role = { ...draft.role, organization: rest };
    }
    if (range && draft.role.startYear === undefined) {
      draft.role = { ...draft.role, ...range };
    }
  }
  return draft;
}

/**
 * The name: the largest text on the page, if it looks like a name at all.
 *
 * The old parser took line one and hoped, which made "Curriculum Vitae" a common first
 * name. Size is the honest signal — a CV sets its owner's name larger than anything
 * else on the page — and the email guard stops a contact line from taking its place.
 */
function nameFrom(
  blocks: readonly LayoutBlock[],
  email: string | undefined,
): string | null {
  let best: { text: string; size: number } | null = null;

  for (const block of blocks) {
    for (const line of block.lines) {
      if (email !== undefined && line.text.includes(email)) continue;
      if (EMAIL.test(line.text)) continue;
      if (best === null || line.fontSize > best.size) {
        best = { text: line.text.trim(), size: line.fontSize };
      }
    }
  }
  if (best === null) return null;

  const words = best.text.split(/\s+/);
  const plausible =
    words.length >= 1 &&
    words.length <= 5 &&
    !/\d/.test(best.text) &&
    best.text.length <= 60;
  return plausible ? best.text : null;
}
