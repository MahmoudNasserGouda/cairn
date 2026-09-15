import { describe, expect, it } from 'vitest';
import { stackexchangeToFragment, type StackExchangeInput } from './stackexchange';
import { emptyProfile } from './model';
import { mergeProfile } from './merge';
import { githubToFragment } from './github';

/**
 * Stack Exchange into a profile fragment (ADR-0035).
 *
 * The only externally-judged signal in the product. Every other source either asks the
 * user (CV, LinkedIn, manual) or counts their output (GitHub, GitLab); this one reports
 * what other practitioners in a tag made of their answers.
 *
 * ADR-0035 left two questions open. Both are answered here, and the answers live in
 * these tests rather than in a number chosen offstage.
 */

const DAY = '2026-09-15';
const CTX = { currentYear: 2026 };

const input = (
  tags: { tag: string; answers: number; score: number }[],
): StackExchangeInput => ({
  userId: 22656,
  site: 'stackoverflow',
  displayName: 'Amara Okonkwo',
  profileUrl: 'https://stackoverflow.com/users/22656/amara',
  reputation: 40_000,
  tags,
});

const find = (f: ReturnType<typeof stackexchangeToFragment>, tag: string) =>
  f.skills?.find((s) => s.tag === tag);

const githubPython = githubToFragment(
  {
    login: 'a',
    createdAt: '2020-01-01T00:00:00Z',
    repos: [{ topics: [], languages: { Python: 50_000 } }],
  },
  DAY,
);

const cvPython = {
  skills: [
    {
      tag: 'python' as const,
      level: 0.4,
      from: { source: 'cv' as const, confidence: 1, capturedAt: DAY },
    },
  ],
};

const build = (...fragments: Parameters<typeof mergeProfile>[1][]) =>
  fragments.reduce((p, f) => mergeProfile(p, f, CTX), emptyProfile());

describe('an unbounded score becoming a level', () => {
  /**
   * `answer_score` has no ceiling and a brutal tail: the top C# answerer is at 269,885,
   * and a strong working developer is at two or three figures. Mapped against any
   * absolute scale that makes almost everyone a beginner, which is exactly the
   * objection ADR-0035 raised.
   *
   * So the level is relative to the person's own strongest tag — the shape GitHub's
   * `bytes / maxBytes` already has. One sentence: *how this tag ranks among your own
   * answers*.
   */
  it('ranks a tag against the persons own strongest, not against the site', () => {
    const fragment = stackexchangeToFragment(
      input([
        { tag: 'python', answers: 140, score: 1240 },
        { tag: 'django', answers: 20, score: 620 },
      ]),
      DAY,
    );
    expect(find(fragment, 'python')?.level).toBe(1);
    expect(find(fragment, 'django')?.level).toBe(0.5);
  });

  /**
   * Which leaves the flaw relative scaling always has: one answer scoring 2 would make
   * that tag a 1.0. **Confidence** carries the absolute question instead, and confidence
   * is what the merge uses to break a tie inside the measured tier.
   *
   * One sentence: *confidence rises with the peer score behind the tag, on a log scale,
   * because the difference between 5 and 50 matters far more than 5,000 and 50,000*.
   */
  it('keeps a thin presence at low confidence however it ranks', () => {
    const thin = stackexchangeToFragment(
      input([{ tag: 'python', answers: 1, score: 2 }]),
      DAY,
    );
    const solid = stackexchangeToFragment(
      input([{ tag: 'python', answers: 140, score: 1240 }]),
      DAY,
    );

    expect(find(thin, 'python')?.level).toBe(1);
    expect(find(solid, 'python')?.level).toBe(1);
    // Same level, very different claim.
    expect(find(thin, 'python')?.from.confidence).toBeLessThan(
      find(solid, 'python')?.from.confidence ?? 0,
    );
    expect(find(thin, 'python')?.from.confidence).toBeLessThan(0.5);
  });

  it('never reaches certainty, because a peer score is still a proxy', () => {
    const enormous = stackexchangeToFragment(
      input([{ tag: 'csharp', answers: 19_991, score: 269_885 }]),
      DAY,
    );
    // `c#` is the canonical tag, not `csharp` — the alias table settles that.
    expect(find(enormous, 'c#')?.from.confidence).toBeLessThan(1);
  });

  it('carries no weight, because an answer score is not a volume of code', () => {
    // Adding a peer score to a byte count would be arithmetic across two units. The
    // merge only combines weighed claims, so omitting it is what keeps them apart.
    const fragment = stackexchangeToFragment(
      input([{ tag: 'python', answers: 9, score: 90 }]),
      DAY,
    );
    expect(find(fragment, 'python')?.weight).toBeUndefined();
  });
});

describe('whether it outranks a byte count', () => {
  /**
   * ADR-0035 recorded this as undecided, and it is decided here: **a substantial
   * Stack Exchange presence outranks a language byte count; a thin one does not.**
   *
   * The argument is that a byte count says what someone wrote, not how well — it is a
   * proxy, and a proxy should not carry maximum confidence. Peer assessment measures the
   * same underlying thing, by people who read the work. Neither gets a rung of its own,
   * because that would assert an order between two kinds of measurement; the confidence
   * tiebreak inside the measured tier is where it is said.
   */
  it('lets a substantial presence win the level', () => {
    const profile = build(
      githubPython,
      stackexchangeToFragment(input([{ tag: 'python', answers: 140, score: 1240 }]), DAY),
    );

    const python = profile.skills.find((s) => s.tag === 'python');
    expect(python?.from.source).toBe('stackexchange');
    // Both claims survive, so the number a user sees is explainable rather than asserted.
    expect(python?.evidence.map((e) => e.source).sort()).toEqual([
      'github',
      'stackexchange',
    ]);
  });

  it('leaves a thin presence as evidence only', () => {
    const profile = build(
      githubPython,
      stackexchangeToFragment(input([{ tag: 'python', answers: 1, score: 2 }]), DAY),
    );

    const python = profile.skills.find((s) => s.tag === 'python');
    expect(python?.from.source).toBe('github');
    expect(python?.evidence.some((e) => e.source === 'stackexchange')).toBe(true);
  });

  it('does not outrank a CV, because nothing has established that it should', () => {
    // Left undecided by ADR-0035, and therefore not decided here by accident: `cv` is a
    // rung above every measured source, and that is unchanged.
    const profile = build(
      cvPython,
      stackexchangeToFragment(
        input([{ tag: 'python', answers: 9999, score: 99_999 }]),
        DAY,
      ),
    );
    expect(profile.skills.find((s) => s.tag === 'python')?.from.source).toBe('cv');
  });
});

describe('what it must never do', () => {
  /**
   * ADR-0035: coverage is uneven and the network's demographics are not this product's.
   * A user with no account is not "less proven", so nothing here may subtract.
   */
  it('never lowers a level another source established', () => {
    const base = build({
      skills: [
        {
          tag: 'python',
          level: 0.9,
          from: { source: 'cv', confidence: 1, capturedAt: DAY },
        },
      ],
    });
    const after = mergeProfile(
      base,
      stackexchangeToFragment(input([{ tag: 'python', answers: 1, score: 1 }]), DAY),
      CTX,
    );
    expect(after.skills.find((s) => s.tag === 'python')?.level).toBe(0.9);
  });

  it('drops tags the taxonomy does not know, rather than inventing skills', () => {
    const fragment = stackexchangeToFragment(
      input([
        { tag: 'python', answers: 10, score: 100 },
        { tag: 'homework', answers: 40, score: 400 },
      ]),
      DAY,
    );
    expect(find(fragment, 'python')).toBeDefined();
    expect(fragment.skills?.some((s) => String(s.tag) === 'homework')).toBe(false);
  });

  /**
   * Found in a browser against a real profile, not in a fixture. Stack Exchange tags
   * are not disjoint: `c#` and `.net` both canonicalise to `c#`, and the top answerer
   * carries 269,885 points on the first and 93,603 on the second. Emitting one claim
   * per *raw* tag meant the second silently replaced the first — the profile reported
   * the smaller number, and looked entirely plausible doing it.
   *
   * The strongest tag wins rather than the sum, because the same answer is usually
   * tagged with both and adding them would count it twice.
   */
  it('keeps the strongest of several tags that mean the same skill', () => {
    const fragment = stackexchangeToFragment(
      input([
        { tag: 'c#', answers: 19_991, score: 269_885 },
        { tag: '.net', answers: 5638, score: 93_603 },
        { tag: 'java', answers: 10_585, score: 159_709 },
      ]),
      DAY,
    );

    expect(fragment.skills).toHaveLength(2);
    expect(find(fragment, 'c#')?.level).toBe(1);
    expect(find(fragment, 'c#')?.note).toContain('269,885');
    // And the ranking that depends on it: Java is 59% of C#, not 171% of .NET.
    expect(find(fragment, 'java')?.level).toBe(0.59);
  });

  it('maps the networks own spellings through the taxonomy', () => {
    const fragment = stackexchangeToFragment(
      input([
        { tag: 'c#', answers: 10, score: 100 },
        { tag: 'node.js', answers: 10, score: 100 },
      ]),
      DAY,
    );
    // The canonical forms, which are not the spellings either network uses:
    // Stack Exchange says `c#` and `node.js`, and this table says `c#` and `node`.
    expect(fragment.skills?.map((s) => s.tag).sort()).toEqual(['c#', 'node']);
  });
});

describe('attribution', () => {
  /**
   * CC BY-SA is a condition of the API's terms, and ADR-0035 makes it a condition of
   * shipping: anything rendered from this source carries a visible link back.
   */
  it('always emits a link to the profile it read', () => {
    const fragment = stackexchangeToFragment(
      input([{ tag: 'python', answers: 1, score: 1 }]),
      DAY,
    );
    expect(fragment.links).toContainEqual(
      expect.objectContaining({
        kind: 'stackexchange',
        url: 'https://stackoverflow.com/users/22656/amara',
      }),
    );
  });

  it('emits the link even when the profile has no usable tags at all', () => {
    const fragment = stackexchangeToFragment(input([]), DAY);
    expect(fragment.links?.[0]?.kind).toBe('stackexchange');
    expect(fragment.skills).toEqual([]);
  });
});
