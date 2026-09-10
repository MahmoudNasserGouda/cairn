import { analyzeIssue } from '@cairn/issue-analysis';
import { issueToSnapshot } from './issue';

const analysis = analyzeIssue({
  title: 'Fix typo in the TypeScript docs',
  body: 'Small change. Steps to reproduce: open the page. Expected: no typo.\n```ts\nconst a = 1;\n```',
  labels: ['good first issue', 'documentation'],
  commentCount: 1,
  linkedPrCount: 0,
  participantCount: 1,
  reactions: 0,
});

describe('issueToSnapshot', () => {
  it('carries the number and maps analysis fields', () => {
    const snap = issueToSnapshot({ number: 42 }, analysis);
    expect(snap.number).toBe(42);
    expect(snap.difficulty).toBe(analysis.difficulty);
    expect(snap.requiredSkills).toEqual([...analysis.requiredKnowledge]);
    expect(snap.scopeClarity).toBe(analysis.scopeClarity);
    expect(snap.mentorshipOffered).toBe(true);
  });

  it('is deterministic', () => {
    expect(issueToSnapshot({ number: 1 }, analysis)).toEqual(
      issueToSnapshot({ number: 1 }, analysis),
    );
  });
});
