import { parseCvText, cvToProfile } from './cv';
import { extractSkills, canonicalizeSkill } from './taxonomy';
import { mergeProfile, emptyProfile, estimateYears } from './model';

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
    expect(p.experience[0]).toMatchObject({
      startYear: 2019,
      endYear: 'present',
      source: 'cv',
    });
  });

  it('does not choke on an empty or junk CV', () => {
    expect(parseCvText('').skills).toEqual([]);
    expect(parseCvText('<<< binary garbage >>>').experience).toEqual([]);
  });
});

describe('cvToProfile / mergeProfile', () => {
  it('produces a profile whose experience level reflects the years', () => {
    const p = cvToProfile(parseCvText(SAMPLE_CV));
    expect(p.skills.find((s) => s.tag === 'typescript')?.source).toBe('cv');
    expect(['intermediate', 'advanced', 'expert']).toContain(p.experienceLevel);
  });

  it('keeps the highest proficiency when merging duplicate skills', () => {
    const merged = mergeProfile(emptyProfile(), {
      skills: [
        { tag: 'typescript', level: 0.3, source: 'cv' },
        { tag: 'typescript', level: 0.8, source: 'github' },
      ],
    });
    expect(merged.skills).toEqual([{ tag: 'typescript', level: 0.8, source: 'github' }]);
  });

  it('estimateYears sums non-overlapping-ish ranges', () => {
    expect(
      estimateYears([
        { title: 'a', startYear: 2016, endYear: 2019, source: 'cv' },
        { title: 'b', startYear: 2019, endYear: 2022, source: 'cv' },
      ]),
    ).toBe(6);
  });
});
