import type { DeveloperSnapshot } from '@cairn/matching';
import type { Candidate, CandidateFacts, LaneId } from './model';
import {
  declaredStack,
  mergeLaneResults,
  newcomerSignal,
  pushRecency,
  rankRepositories,
  starApproachability,
} from './rank';

const NOW = Date.parse('2026-09-11T00:00:00Z');
const daysBefore = (days: number): string =>
  new Date(NOW - days * 86_400_000).toISOString();

function dev(overrides: Partial<DeveloperSnapshot> = {}): DeveloperSnapshot {
  return {
    skills: [
      { tag: 'typescript', level: 0.9, source: 'github' },
      { tag: 'angular', level: 0.6, source: 'cv' },
    ],
    experience: 'intermediate',
    interests: [],
    priorContributions: 2,
    ...overrides,
  };
}

function facts(overrides: Partial<CandidateFacts> = {}): CandidateFacts {
  return {
    fullName: 'acme/thing',
    owner: 'acme',
    repo: 'thing',
    description: 'a thing',
    stars: 1600,
    forks: 100,
    openIssues: 20,
    primaryLanguage: 'typescript',
    topics: ['angular'],
    allTopics: ['angular', 'awesome'],
    pushedAt: daysBefore(3),
    archived: false,
    isFork: false,
    htmlUrl: 'https://github.com/acme/thing',
    ...overrides,
  };
}

function candidate(
  overrides: Partial<CandidateFacts> = {},
  foundBy: readonly LaneId[] = ['core-skill'],
): Candidate {
  return { ...facts(overrides), foundBy };
}

describe('mergeLaneResults', () => {
  it('de-duplicates a repo found by several lanes and keeps every lane', () => {
    const merged = mergeLaneResults([
      { lane: 'core-skill', results: [facts()] },
      { lane: 'newcomer', results: [facts()] },
      { lane: 'interests', results: [facts({ fullName: 'other/repo' })] },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.foundBy).toEqual(['core-skill', 'newcomer']);
  });

  it('does not repeat a lane that returned the same repo twice', () => {
    const merged = mergeLaneResults([
      { lane: 'core-skill', results: [facts(), facts()] },
    ]);
    expect(merged[0]?.foundBy).toEqual(['core-skill']);
  });
});

describe('pushRecency', () => {
  it('scores a fortnight of silence as full activity, a year as none', () => {
    expect(pushRecency(daysBefore(0), NOW)).toBe(1);
    expect(pushRecency(daysBefore(14), NOW)).toBe(1);
    expect(pushRecency(daysBefore(400), NOW)).toBe(0);
    expect(pushRecency(daysBefore(180), NOW)).toBeGreaterThan(0);
    expect(pushRecency(daysBefore(180), NOW)).toBeLessThan(1);
  });

  it('treats a missing or unparseable timestamp as no evidence, not as fresh', () => {
    expect(pushRecency(null, NOW)).toBe(0);
    expect(pushRecency('not a date', NOW)).toBe(0);
  });
});

describe('starApproachability', () => {
  it('peaks at the band for the level rather than rewarding popularity', () => {
    // 150k stars is a worse place for an intermediate first PR than 1.6k.
    const peak = starApproachability(1600, 3.2);
    expect(peak).toBeGreaterThan(starApproachability(150_000, 3.2));
    expect(peak).toBeGreaterThan(starApproachability(5, 3.2));
  });

  it('scores an unstarred repo at zero', () => {
    expect(starApproachability(0, 3.2)).toBe(0);
  });
});

describe('newcomerSignal', () => {
  it('weighs the good-first-issues qualifier above a self-declared topic', () => {
    const viaLane = newcomerSignal(candidate({ allTopics: [] }, ['newcomer']));
    const viaTopic = newcomerSignal(
      candidate({ allTopics: ['hacktoberfest'] }, ['core-skill']),
    );
    expect(viaLane).toBeGreaterThan(viaTopic);
  });

  it('reads newcomer markers from allTopics, which the taxonomy filter strips', () => {
    // `good-first-issue` is not a technology, so it never reaches `topics`.
    const marked = candidate({ topics: [], allTopics: ['good-first-issue'] }, [
      'core-skill',
    ]);
    expect(newcomerSignal(marked)).toBeGreaterThan(
      newcomerSignal(candidate({ topics: [], allTopics: [] }, ['core-skill'])),
    );
  });
});

describe('declaredStack', () => {
  it('combines the primary language with known topics, without duplicates', () => {
    expect(declaredStack(facts({ topics: ['typescript', 'angular'] }))).toEqual([
      'typescript',
      'angular',
    ]);
  });

  it('is empty when GitHub reported neither a language nor a known topic', () => {
    expect(declaredStack(facts({ primaryLanguage: null, topics: [] }))).toEqual([]);
  });
});

describe('rankRepositories', () => {
  it('drops archived repos, forks, and repos with no declared stack', () => {
    const result = rankRepositories(
      dev(),
      [
        candidate({ fullName: 'a/archived', archived: true }),
        candidate({ fullName: 'a/fork', isFork: true }),
        candidate({ fullName: 'a/bare', primaryLanguage: null, topics: [] }),
        candidate({ fullName: 'a/good' }),
      ],
      { now: NOW },
    );
    expect(result.recommendations.map((r) => r.candidate.fullName)).toEqual(['a/good']);
    expect(result.rejected).toEqual({ archived: 1, fork: 1, 'no-declared-stack': 1 });
    expect(result.considered).toBe(4);
  });

  it('never floats a stackless repo to the top on an empty-coverage technicality', () => {
    // `skillCoverage` returns a neutral 1 for an empty requirement list. Scoring a
    // repo whose stack we could not read would therefore make it a perfect match —
    // the same trap `SkillGap.analysed` exists to avoid. It has to be excluded.
    const result = rankRepositories(
      dev({ skills: [] }),
      [candidate({ fullName: 'a/bare', primaryLanguage: null, topics: [] })],
      { now: NOW },
    );
    expect(result.recommendations).toEqual([]);
  });

  it('ranks a matching, active, beginner-labelled repo above a stale mismatch', () => {
    const result = rankRepositories(
      dev(),
      [
        candidate({ fullName: 'z/stale', pushedAt: daysBefore(300), stars: 120_000 }),
        candidate({ fullName: 'a/great' }, ['core-skill', 'newcomer']),
      ],
      { now: NOW },
    );
    expect(result.recommendations[0]?.candidate.fullName).toBe('a/great');
  });

  it('breaks ties by name so a run is reproducible', () => {
    const result = rankRepositories(
      dev(),
      [candidate({ fullName: 'b/same' }), candidate({ fullName: 'a/same' })],
      { now: NOW },
    );
    expect(result.recommendations.map((r) => r.candidate.fullName)).toEqual([
      'a/same',
      'b/same',
    ]);
  });

  it('honours the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      candidate({ fullName: `acme/r${i}` }),
    );
    expect(
      rankRepositories(dev(), many, { now: NOW, limit: 5 }).recommendations,
    ).toHaveLength(5);
  });

  it('splits the stack into what you know and what you would learn', () => {
    const [top] = rankRepositories(
      dev(),
      [candidate({ primaryLanguage: 'typescript', topics: ['angular', 'graphql'] })],
      { now: NOW },
    ).recommendations;
    expect(top?.known).toEqual(['typescript', 'angular']);
    expect(top?.newToYou).toEqual(['graphql']);
  });

  it('reorders under the learning preset without changing the candidate set', () => {
    const familiar = candidate({
      fullName: 'a/familiar',
      primaryLanguage: 'typescript',
      topics: ['angular'],
    });
    const novel = candidate({
      fullName: 'b/novel',
      primaryLanguage: 'typescript',
      topics: ['rust', 'wasm'],
    });
    const quick = rankRepositories(dev(), [familiar, novel], {
      now: NOW,
      preset: 'quick-win',
    });
    const learning = rankRepositories(dev(), [familiar, novel], {
      now: NOW,
      preset: 'learning',
    });
    expect(quick.recommendations[0]?.candidate.fullName).toBe('a/familiar');
    expect(
      learning.recommendations.find((r) => r.candidate.fullName === 'b/novel')?.score
        .total,
    ).toBeGreaterThan(
      quick.recommendations.find((r) => r.candidate.fullName === 'b/novel')?.score
        .total ?? 1,
    );
    expect(learning.preset).toBe('learning');
  });

  it('explains itself with named signals, not repository prose', () => {
    const [top] = rankRepositories(
      dev(),
      [
        candidate({ description: 'PWNED <img onerror=alert(1)>' }, [
          'core-skill',
          'newcomer',
        ]),
      ],
      { now: NOW },
    ).recommendations;

    expect(top?.reasons[0]).toMatch(/good first issue/i);
    expect(top?.reasons.some((r) => /typescript/.test(r))).toBe(true);
    expect(top?.reasons.some((r) => /last push 3 days ago/i.test(r))).toBe(true);
    // The description is untrusted external text and never reaches a reason line.
    for (const reason of top?.reasons ?? []) {
      expect(reason).not.toContain('PWNED');
      expect(reason).not.toContain('onerror');
    }
  });

  it('scores every weighted part so the why-panel has no blanks', () => {
    const [top] = rankRepositories(dev(), [candidate()], { now: NOW }).recommendations;
    expect(top?.score.parts.map((p) => p.key)).toEqual([
      'skillFit',
      'technologyFit',
      'newcomerSignal',
      'activity',
      'approachability',
      'learning',
    ]);
    for (const part of top?.score.parts ?? []) expect(part.note).toBeTruthy();
  });
});
