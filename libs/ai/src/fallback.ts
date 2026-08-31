/**
 * Non-AI fallbacks (ADR-0009). Every AI feature must remain useful with no key.
 * These produce deterministic, template-based output from structured inputs.
 */
export interface IssueExplainerInput {
  readonly title: string;
  readonly difficulty: string;
  readonly requiredKnowledge: readonly string[];
  readonly scopeClarity: number;
}

export function explainIssueWithoutAI(input: IssueExplainerInput): string {
  const knows =
    input.requiredKnowledge.length > 0
      ? input.requiredKnowledge.join(', ')
      : 'general familiarity with the codebase';
  const clarity =
    input.scopeClarity >= 0.6
      ? 'The issue looks well scoped.'
      : 'The issue is thinly described — ask a maintainer to clarify the expected outcome before starting.';
  return [
    `"${input.title}" is estimated ${input.difficulty}.`,
    `You will likely need: ${knows}.`,
    clarity,
    'Suggested path: reproduce locally, find the relevant files, write a failing test, then fix.',
  ].join(' ');
}

export interface ReadingOrderInput {
  readonly orderedFiles: readonly string[];
}

export function readingOrderWithoutAI(input: ReadingOrderInput): string {
  return input.orderedFiles
    .slice(0, 12)
    .map((f, i) => `${i + 1}. ${f}`)
    .join('\n');
}
