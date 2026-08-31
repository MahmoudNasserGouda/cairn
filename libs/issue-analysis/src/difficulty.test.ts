import { analyzeIssue, extractRequiredKnowledge, type IssueInput } from './difficulty';

const base: IssueInput = {
  title: 'Fix typo in docs',
  body: 'There is a small typo in the README. Expected "the", actual "teh".',
  labels: ['good first issue'],
  commentCount: 1,
  linkedPrCount: 0,
  participantCount: 1,
  reactions: 0,
};

describe('extractRequiredKnowledge', () => {
  it('pulls known technologies from free text', () => {
    expect(
      extractRequiredKnowledge('Migrate the Angular module to TypeScript strict'),
    ).toEqual(['angular', 'typescript']);
  });
});

describe('analyzeIssue', () => {
  it('is deterministic', () => {
    expect(analyzeIssue(base)).toEqual(analyzeIssue(base));
  });

  it('caps difficulty for good-first-issue labelled work', () => {
    const a = analyzeIssue(base);
    expect(a.newcomerLabelled).toBe(true);
    expect(['trivial', 'easy']).toContain(a.difficulty);
  });

  it('rates a contested architecture issue as hard/expert', () => {
    const a = analyzeIssue({
      ...base,
      title: 'Redesign the rendering pipeline',
      body: 'We need to rework how the compiler emits code. Affects TypeScript, WASM, and the build.',
      labels: ['architecture', 'needs design'],
      commentCount: 40,
      linkedPrCount: 3,
      participantCount: 15,
    });
    expect(['hard', 'expert']).toContain(a.difficulty);
    expect(a.requiredKnowledge).toContain('typescript');
  });

  it('reports low scope clarity for a one-line issue', () => {
    const a = analyzeIssue({ ...base, body: 'broken' });
    expect(a.scopeClarity).toBeLessThan(0.3);
  });
});
