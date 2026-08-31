import { stripToText, type SkillProficiency, type SkillTag } from '@cairn/shared';
import { extractSkills } from './taxonomy';
import type { ExperienceEntry, UnifiedProfile } from './model';
import { mergeProfile, emptyProfile } from './model';

/**
 * Deterministic CV parsing (ADR-0011). Input is plain text already extracted from
 * PDF/DOCX in a sandboxed worker by apps/web. No AI, no network. An optional BYOK
 * AI pass can refine the result but is never required.
 */
export interface ParsedCv {
  readonly name?: string;
  readonly email?: string;
  readonly skills: readonly SkillTag[];
  readonly experience: readonly ExperienceEntry[];
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

function extractExperience(lines: readonly string[]): ExperienceEntry[] {
  const out: ExperienceEntry[] = [];
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
    out.push({ title, startYear, endYear, source: 'cv' });
  }
  return out;
}

/** Turn a ParsedCv into a profile fragment merged onto a base profile. */
export function cvToProfile(
  parsed: ParsedCv,
  base: UnifiedProfile = emptyProfile(),
): UnifiedProfile {
  const skills: SkillProficiency[] = parsed.skills.map((tag) => ({
    tag,
    level: 0.5,
    source: 'cv',
  }));
  return mergeProfile(base, { skills, experience: parsed.experience });
}
