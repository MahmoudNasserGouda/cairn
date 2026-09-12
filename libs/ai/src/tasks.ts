import { err, ok, toKnownSkills, type Result, type SkillTag } from '@cairn/shared';
import type { BuildPromptInput } from './prompt';

/**
 * The two BYOK tasks the app can run today (ADR-0009). Each is a pair: a prompt
 * builder that hands `buildMessages` / `disclose` an already-fenced input, and — where
 * the model is asked for data rather than prose — a strict parser for what comes back.
 *
 * Both halves are pure and framework-free, so the whole contract with the provider is
 * testable without a network. Validation is not politeness: the CV text and the issue
 * body are untrusted (SECURITY.md T7 / T10), so a model that has been talked into
 * obeying them must not be able to push arbitrary content into the profile.
 */

export interface CvRefinementRole {
  readonly title: string;
  readonly organization?: string;
  readonly startYear?: number;
  readonly endYear?: number | 'present';
}

export interface CvRefinement {
  readonly name?: string;
  readonly email?: string;
  readonly skills: readonly SkillTag[];
  readonly experience: readonly CvRefinementRole[];
}

const CV_SCHEMA = [
  '{',
  '  "name": string | null,',
  '  "email": string | null,',
  '  "skills": string[],',
  '  "experience": [{ "title": string, "organization": string | null,',
  '                   "startYear": number | null, "endYear": number | "present" | null }]',
  '}',
].join('\n');

/**
 * Ask the provider to re-read a CV the deterministic parser has already seen.
 *
 * The whole CV text goes in the payload — that is the disclosure the user consents to
 * (ADR-0011), and it is why the review form stays mandatory afterwards.
 */
export function cvRefinementPrompt(cvText: string): BuildPromptInput {
  return {
    task: 'Extract structured facts from a CV',
    userQuestion: [
      'Read the CV below and extract the facts it states.',
      'Reply with a single JSON object and nothing else — no prose, no code fence,',
      'no explanation. Use this exact shape:',
      '',
      CV_SCHEMA,
      '',
      'Use null for anything the CV does not state. Do not invent employers, dates or',
      'technologies. "skills" must list technologies only, not soft skills.',
    ].join('\n'),
    docs: [{ label: 'CV text', content: cvText }],
  };
}

export interface IssueExplainerDoc {
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
}

/** Plain-language explanation of one issue for a would-be first-time contributor. */
export function issueExplainerPrompt(issue: IssueExplainerDoc): BuildPromptInput {
  return {
    task: 'Explain an open-source issue to a newcomer',
    userQuestion: [
      `Explain issue #${issue.number} in ${issue.repo} to a developer who has never`,
      'contributed to this project. Cover, in short paragraphs: what is actually being',
      'asked for, what a contributor would need to know, and a realistic first step.',
      'Say so plainly if the issue is too vague to act on. Reply in prose, under 250',
      'words. Do not include code blocks, links or markdown.',
    ].join(' '),
    docs: [
      {
        label: `issue #${issue.number}: ${issue.title}`,
        content: [
          `Labels: ${issue.labels.join(', ') || 'none'}`,
          '',
          issue.body || '(no description)',
        ].join('\n'),
      },
    ],
  };
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const EARLIEST_YEAR = 1950;
const LATEST_YEAR = 2100;
const MAX_ROLES = 20;
const MAX_NAME = 80;
const MAX_FIELD = 120;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return trimmed.length > 0 ? trimmed : undefined;
}

function year(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) return undefined;
  return n >= EARLIEST_YEAR && n <= LATEST_YEAR ? n : undefined;
}

function endYear(value: unknown): number | 'present' | undefined {
  if (typeof value === 'string' && /^(present|current|now)$/i.test(value.trim())) {
    return 'present';
  }
  return year(value);
}

function role(value: unknown): CvRefinementRole | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const title = text(raw['title'], MAX_FIELD);
  if (title === undefined) return undefined;

  const organization = text(raw['organization'], MAX_FIELD);
  const start = year(raw['startYear']);
  const end = endYear(raw['endYear']);
  return {
    title,
    ...(organization ? { organization } : {}),
    ...(start !== undefined ? { startYear: start } : {}),
    ...(end !== undefined ? { endYear: end } : {}),
  };
}

/**
 * Pull the JSON object out of a model reply. Models wrap JSON in prose or a code
 * fence often enough that refusing those replies would waste the user's money, so we
 * take the outermost braces — but nothing looser than that.
 */
function extractJson(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * Validate a CV refinement reply. Everything is optional and everything is bounded:
 * unknown keys are ignored, skills outside the taxonomy are dropped, years outside a
 * plausible range are dropped, and strings are trimmed to a length the review form can
 * display. A reply with nothing usable left is an error, not an empty success — the
 * caller should tell the user the run produced nothing rather than silently no-op.
 */
export function parseCvRefinement(raw: string): Result<CvRefinement> {
  const parsed = extractJson(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err('the model did not reply with JSON');
  }
  const obj = parsed as Record<string, unknown>;

  const name = text(obj['name'], MAX_NAME);
  const emailRaw = text(obj['email'], MAX_FIELD);
  const email = emailRaw !== undefined && EMAIL_RE.test(emailRaw) ? emailRaw : undefined;

  const skills = Array.isArray(obj['skills'])
    ? toKnownSkills(obj['skills'].filter((s): s is string => typeof s === 'string'))
    : [];

  const experience = Array.isArray(obj['experience'])
    ? obj['experience']
        .map(role)
        .filter((r): r is CvRefinementRole => r !== undefined)
        .slice(0, MAX_ROLES)
    : [];

  if (
    name === undefined &&
    email === undefined &&
    skills.length === 0 &&
    experience.length === 0
  ) {
    return err('the model returned nothing we could use');
  }

  return ok({
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    skills,
    experience,
  });
}
