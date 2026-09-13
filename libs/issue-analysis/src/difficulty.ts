import { clamp01, extractSkills, type Difficulty, type SkillTag } from '@cairn/shared';

export interface IssueInput {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly commentCount: number;
  readonly linkedPrCount: number;
  readonly participantCount: number;
  readonly reactions: number;
}

export interface IssueAnalysis {
  readonly difficulty: Difficulty;
  /** Confidence in the difficulty estimate, [0, 1]. */
  readonly confidence: number;
  /** Technologies/skills the issue text implies are needed. */
  readonly requiredKnowledge: readonly SkillTag[];
  /** How clearly the work is scoped, [0, 1]. */
  readonly scopeClarity: number;
  readonly newcomerLabelled: boolean;
  readonly signals: Readonly<Record<string, number>>;
}

const EASY_LABELS = [
  'good first issue',
  'good-first-issue',
  'beginner',
  'beginner friendly',
  'easy',
  'starter',
  'e-easy',
  'low-hanging-fruit',
];
const HARD_LABELS = [
  'hard',
  'complex',
  'architecture',
  'breaking change',
  'needs design',
  'epic',
  'research',
];

/**
 * Technologies the issue text implies are needed.
 *
 * Delegates to the shared taxonomy rather than keeping a local list. Two things were
 * wrong with the list that used to live here. It matched with `hay.includes(t)`, a bare
 * substring test, so short tags matched inside ordinary words — an issue body saying
 * "redact sensitive parsed values in logs" was reported as requiring `go`, and
 * "category"/"java" matched the same way. And it was a second vocabulary: it could emit
 * `sql` and `testing`, which no `DeveloperSnapshot` can ever carry, so those tags
 * scored zero coverage forever while the taxonomy's own tags went undetected (ADR-0007
 * — one vocabulary on both sides of a comparison).
 *
 * `extractSkills` matches on word-ish boundaries and canonicalises aliases, so
 * `nodejs` in an issue body now reaches the developer's `node` skill.
 */
export function extractRequiredKnowledge(text: string): SkillTag[] {
  return extractSkills(text);
}

function scopeClarity(input: IssueInput): number {
  const len = input.body.trim().length;
  const hasRepro = /steps to reproduce|reproduc|expected|actual/i.test(input.body);
  const hasChecklist = /- \[[ x]\]/i.test(input.body);
  const hasCode = /```/.test(input.body);
  return clamp01(
    0.4 * clamp01(len / 600) +
      0.25 * Number(hasRepro) +
      0.2 * Number(hasChecklist) +
      0.15 * Number(hasCode),
  );
}

/** Deterministic difficulty estimate (Phase 3 "Issue Explainer" — AI-free core). */
export function analyzeIssue(input: IssueInput): IssueAnalysis {
  const labels = input.labels.map((l) => l.toLowerCase().trim());
  const newcomerLabelled = labels.some((l) => EASY_LABELS.includes(l));
  const hardLabelled = labels.some((l) => HARD_LABELS.includes(l));

  const text = `${input.title}\n${input.body}`;
  const knowledge = extractRequiredKnowledge(text);
  const clarity = scopeClarity(input);

  // Difficulty score in [0, 1]; higher = harder.
  const discussionPressure = clamp01(
    (input.commentCount / 30) * 0.5 + (input.participantCount / 12) * 0.5,
  );
  const breadth = clamp01(knowledge.length / 6);
  let d =
    0.35 * discussionPressure +
    0.25 * breadth +
    0.2 * (1 - clarity) +
    0.2 * clamp01(input.linkedPrCount / 3);

  if (newcomerLabelled) d = Math.min(d, 0.3);
  if (hardLabelled) d = Math.max(d, 0.7);

  const difficulty: Difficulty =
    d < 0.15
      ? 'trivial'
      : d < 0.35
        ? 'easy'
        : d < 0.6
          ? 'moderate'
          : d < 0.82
            ? 'hard'
            : 'expert';

  const confidence = clamp01(
    0.4 +
      0.3 * Number(newcomerLabelled || hardLabelled) +
      0.3 * clamp01(input.body.length / 400),
  );

  return {
    difficulty,
    confidence,
    requiredKnowledge: knowledge,
    scopeClarity: clarity,
    newcomerLabelled,
    signals: { discussionPressure, breadth, clarity, difficultyScore: d },
  };
}
