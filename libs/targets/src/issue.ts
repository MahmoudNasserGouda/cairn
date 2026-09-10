import type { IssueAnalysis } from '@cairn/issue-analysis';
import type { IssueSnapshot } from '@cairn/matching';

/** Build the `IssueSnapshot` the matching engine scores against. */
export function issueToSnapshot(
  item: { readonly number: number },
  analysis: IssueAnalysis,
): IssueSnapshot {
  return {
    number: item.number,
    difficulty: analysis.difficulty,
    requiredSkills: [...analysis.requiredKnowledge],
    scopeClarity: analysis.scopeClarity,
    mentorshipOffered: analysis.newcomerLabelled,
  };
}
