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

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
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
    const title =
      line
        .replace(YEAR_RANGE_RE, '')
        .replace(/[|,–—-]+\s*$/, '')
        .trim() || 'Role';
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
