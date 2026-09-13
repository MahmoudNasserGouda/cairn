import { stripToText, type SkillTag } from '@cairn/shared';
import { extractSkills } from './taxonomy';
import type { ProfileFragment } from './merge';
import { parsedCvToFragment } from './migrate';

/**
 * Deterministic CV parsing (ADR-0011). Input is plain text already extracted from
 * PDF/DOCX in a sandboxed worker by apps/web. No AI, no network.
 *
 * This is the *flat-text* parser, and it is on its way out: ADR-0028 replaces it with
 * a layout pipeline (`libs/doc-layout` → `libs/cv-parse`) that reads the geometry
 * pdf.js already returns. It stays until that lands so the CV path keeps working.
 */

/** A role as the flat parser sees it — no provenance yet, no bullets. */
export interface ParsedRole {
  readonly title: string;
  readonly organization?: string;
  readonly startYear?: number;
  readonly endYear?: number | 'present';
}

export interface ParsedCv {
  readonly name?: string;
  readonly email?: string;
  readonly skills: readonly SkillTag[];
  readonly experience: readonly ParsedRole[];
  /** Sections the parser recognised, for the review UI. */
  readonly sections: readonly string[];
}

/**
 * Bounded on purpose. Unbounded (`[a-z0-9._%+-]+@…`) this is quadratic on untrusted CV
 * text: `-` is inside the class, so a long run of dashes is consumed greedily, `@`
 * fails, the engine backtracks the whole run, and then restarts from the next offset.
 * Measured at 3.2 seconds for a 60k-dash line.
 *
 * The limits are RFC 5321's own — 64 octets of local part, 255 of domain — so this is
 * a correctness fix as much as a safety one: a 60,000-character local part was never
 * an email address. Capping the quantifiers caps the backtracking, which makes the
 * whole scan linear.
 */
const EMAIL_RE = /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,255}\.[a-z]{2,24}/i;
const YEAR_RANGE_RE =
  /((?:19|20)\d{2})\s*(?:-|–|—|to)\s*((?:19|20)\d{2}|present|current|now)/i;
const SECTION_HEADS = [
  'summary',
  'experience',
  'work experience',
  'employment',
  'education',
  'skills',
  'technical skills',
  'projects',
  'certifications',
];

export function parseCvText(raw: string): ParsedCv {
  const text = stripToText(raw);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const email = EMAIL_RE.exec(text)?.[0];
  const name = guessName(lines, email);
  const sections = lines
    .map((l) => l.toLowerCase().replace(/[:#*]/g, '').trim())
    .filter((l) => SECTION_HEADS.includes(l));

  const skills = extractSkills(text);
  const experience = extractExperience(lines);

  return {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    skills,
    experience,
    sections: [...new Set(sections)],
  };
}

function guessName(
  lines: readonly string[],
  email: string | undefined,
): string | undefined {
  const first = lines[0];
  if (!first) return undefined;
  if (email && first.includes(email)) return undefined;
  const words = first.split(/\s+/);
  if (
    words.length >= 1 &&
    words.length <= 4 &&
    /^[A-Za-z][A-Za-z'.-]*$/.test(words[0]!)
  ) {
    return first;
  }
  return undefined;
}

/**
 * Characters that trail a role once its date range has been cut out — "Engineer, |"
 * and similar.
 *
 * Trimmed by walking backwards rather than with `/[|,–—-]+\s*$/`, which is the
 * same backtracking shape CodeQL flagged in `linkKey`: a run of delimiters, then an
 * end anchor, so the engine consumes the run, fails `$`, gives one back, fails again,
 * and restarts from the next offset. Measured on a line of repeated dashes before this
 * change: 5k in 39ms, 20k in 658ms, 60k in **5.7 seconds** — quadratic, on CV text,
 * which is untrusted input (SECURITY.md T7). The worker's 10s budget turned that into
 * a failed parse rather than a hung tab, but a budget is a backstop, not a fix.
 */
const TRAILING_NOISE = new Set([...'|,–—- 	']);

function trimTrailingNoise(value: string): string {
  let end = value.length;
  while (end > 0 && TRAILING_NOISE.has(value[end - 1] as string)) end--;
  return value.slice(0, end);
}

function extractExperience(lines: readonly string[]): ParsedRole[] {
  const out: ParsedRole[] = [];
  for (const line of lines) {
    const m = YEAR_RANGE_RE.exec(line);
    if (!m) continue;
    const startYear = Number(m[1]);
    const endRaw = m[2]!.toLowerCase();
    const endYear = /present|current|now/.test(endRaw)
      ? ('present' as const)
      : Number(endRaw);
    const title = trimTrailingNoise(line.replace(YEAR_RANGE_RE, '')).trim() || 'Role';
    out.push({ title, startYear, endYear });
  }
  return out;
}

/**
 * Turn a reviewed CV into a profile fragment (ADR-0031).
 *
 * It *proposes*; the merge decides. Everything it produces is stamped `source: 'cv'`,
 * so a hand-edited field outranks it and a re-import updates the CV's own entries
 * rather than duplicating them.
 */
export function cvToFragment(parsed: ParsedCv, capturedAt: string): ProfileFragment {
  return parsedCvToFragment(parsed, capturedAt);
}
