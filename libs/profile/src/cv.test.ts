import { parseCvText, cvToFragment } from './cv';
import { extractSkills, canonicalizeSkill } from './taxonomy';
import { mergeProfile } from './merge';
import { emptyProfile, estimateYears } from './model';

const SAMPLE_CV = `Ada Lovelace
ada@example.com

Summary
Frontend engineer.

Technical Skills
JavaScript, TypeScript, Angular, RxJS, Node.js, Docker, k8s

Work Experience
Senior Frontend Engineer, Acme  2019 - present
Frontend Developer, Globex  2016 - 2019
`;

describe('taxonomy', () => {
  it('canonicalizes aliases', () => {
    expect(canonicalizeSkill('JS')).toBe('javascript');
    expect(canonicalizeSkill('k8s')).toBe('kubernetes');
    expect(canonicalizeSkill('Node.js')).toBe('node');
  });
  it('extracts known skills from a skills line', () => {
    const s = extractSkills('JavaScript, TypeScript, Angular, Docker');
    expect(s).toEqual(['angular', 'docker', 'javascript', 'typescript']);
  });
});

describe('parseCvText', () => {
  it('is deterministic', () => {
    expect(parseCvText(SAMPLE_CV)).toEqual(parseCvText(SAMPLE_CV));
  });

  it('pulls name, email, skills and experience', () => {
    const p = parseCvText(SAMPLE_CV);
    expect(p.name).toBe('Ada Lovelace');
    expect(p.email).toBe('ada@example.com');
    expect(p.skills).toContain('typescript');
    expect(p.skills).toContain('kubernetes');
    expect(p.sections).toEqual(expect.arrayContaining(['summary', 'technical skills']));
    expect(p.experience).toHaveLength(2);
    // The parser reports what the document says; it does not stamp provenance.
    // `cvToFragment` does that, which is what keeps parsing and merging separable.
    expect(p.experience[0]).toMatchObject({
      startYear: 2019,
      endYear: 'present',
    });
  });

  it('does not choke on an empty or junk CV', () => {
    expect(parseCvText('').skills).toEqual([]);
    expect(parseCvText('<<< binary garbage >>>').experience).toEqual([]);
  });
});

describe('cvToFragment', () => {
  const DAY = '2026-09-13';
  const ctx = { currentYear: 2026 };

  it('produces a profile whose experience level reflects the years', () => {
    const p = mergeProfile(
      emptyProfile(),
      cvToFragment(parseCvText(SAMPLE_CV), DAY),
      ctx,
    );
    expect(p.skills.find((s) => s.tag === 'typescript')?.from.source).toBe('cv');
    expect(['intermediate', 'advanced', 'expert']).toContain(p.experienceLevel.value);
  });

  /**
   * The old merge kept whichever claim had the *highest level*, regardless of source
   * — so GitHub's byte-count guess beat a CV the user had reviewed. Precedence
   * replaces that: the CV wins, and GitHub's number survives as evidence rather than
   * being thrown away (ADR-0031).
   */
  it('lets the reviewed CV win over a higher GitHub level, keeping both as evidence', () => {
    const p = mergeProfile(
      mergeProfile(
        emptyProfile(),
        {
          skills: [
            {
              tag: 'typescript',
              level: 0.8,
              from: { source: 'github', confidence: 1, capturedAt: DAY },
            },
          ],
        },
        ctx,
      ),
      {
        skills: [
          {
            tag: 'typescript',
            level: 0.3,
            from: { source: 'cv', confidence: 1, capturedAt: DAY },
          },
        ],
      },
      ctx,
    );

    const ts = p.skills.find((s) => s.tag === 'typescript');
    expect(ts?.level).toBe(0.3);
    expect(ts?.from.source).toBe('cv');
    expect(ts?.evidence.map((e) => e.source).sort()).toEqual(['cv', 'github']);
  });

  it('estimateYears sums non-overlapping-ish ranges', () => {
    const from = { source: 'cv' as const, confidence: 1, capturedAt: DAY };
    expect(
      estimateYears(
        [
          { title: 'a', startYear: 2016, endYear: 2019, highlights: [], from },
          { title: 'b', startYear: 2019, endYear: 2022, highlights: [], from },
        ],
        2026,
      ),
    ).toBe(6);
  });
});

/**
 * Both of this PR's ReDoS fixes, kept honest. CodeQL found the one in `linkKey`;
 * this one is the same shape, in the same PR, on input that is *more* clearly
 * untrusted — so leaving it knowingly would have been the inconsistent choice.
 */
describe('parsing does not blow up on hostile input', () => {
  it('parses a hostile line in linear time', () => {
    // A run of dashes is the worst case for two separate patterns here: the trailing
    // delimiter trim, and the email scan (`-` is inside its local-part class). Both
    // were quadratic; together they took **12.4 seconds** on this input.
    const line = `Engineer 2019 - 2021 ${'-'.repeat(120_000)}x`;
    const started = performance.now();
    const parsed = parseCvText(line);
    const elapsed = performance.now() - started;

    expect(parsed.experience[0]?.startYear).toBe(2019);
    expect(elapsed).toBeLessThan(1000);
  });

  it('still finds a real email address', () => {
    const cv = ['Ada Lovelace', 'ada.lovelace+cv@example.co.uk'].join('\n');
    expect(parseCvText(cv).email).toBe('ada.lovelace+cv@example.co.uk');
  });

  it('still strips the delimiters it is meant to', () => {
    expect(
      parseCvText('Backend Engineer, Paystack | 2021 - present').experience[0],
    ).toMatchObject({ title: 'Backend Engineer, Paystack', startYear: 2021 });
  });
});
