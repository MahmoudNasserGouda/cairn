import { clamp01, toSkillTag, type Difficulty, type SkillTag } from '@cairn/shared';

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

const KNOWN_TECH = [
  'typescript',
  'javascript',
  'rust',
  'go',
  'python',
  'java',
  'c++',
  'angular',
  'react',
  'vue',
  'node',
  'webpack',
  'vite',
  'graphql',
  'sql',
  'docker',
  'kubernetes',
  'wasm',
  'css',
  'html',
  'accessibility',
  'i18n',
  'testing',
];

export function extractRequiredKnowledge(text: string): SkillTag[] {
  const hay = text.toLowerCase();
  const found = new Set<SkillTag>();
  for (const t of KNOWN_TECH) {
    if (hay.includes(t)) found.add(toSkillTag(t));
  }
  return [...found].sort();
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
