import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import type { UnifiedProfile } from '@cairn/profile';
import type { RepositorySnapshot, IssueSnapshot } from '@cairn/matching';
import { DashboardComponent } from './dashboard.component';
import { ProfileService } from '../core/profile/profile.service';
import { TargetService } from '../core/targets/target.service';

const PROFILE: UnifiedProfile = {
  schemaVersion: 1,
  identities: [{ provider: 'github', displayName: 'Octo' }],
  skills: [
    { tag: 'typescript', level: 0.9, source: 'github' },
    { tag: 'react', level: 0.6, source: 'github' },
  ],
  technologies: ['typescript', 'react'],
  experienceLevel: 'intermediate',
  interests: ['web'],
  experience: [
    { title: 'Public GitHub activity', startYear: 2020, endYear: 2024, source: 'github' },
  ],
  totalYears: 4,
};

const REPO: RepositorySnapshot = {
  fullName: 'a/b',
  technologies: ['typescript', 'go'],
  topics: ['typescript'],
  activity: 0.8,
  health: 0.7,
  newcomerFriendliness: 0.6,
  requiredExperience: 'intermediate',
};

const REPO_NO_TECH: RepositorySnapshot = { ...REPO, technologies: [], topics: [] };

const ISSUE: IssueSnapshot = {
  number: 1,
  requiredSkills: ['typescript'],
  difficulty: 'easy',
  scopeClarity: 0.8,
  mentorshipOffered: true,
};

function render(opts: {
  profile?: UnifiedProfile | null;
  repo?: RepositorySnapshot | null;
  issue?: IssueSnapshot | null;
}) {
  const profile = signal(opts.profile ?? null);
  const repoSnapshot = signal(opts.repo ?? null);
  const issueSnapshot = signal(opts.issue ?? null);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: ProfileService,
        useValue: {
          profile,
          loading: signal(false),
          error: signal(null),
          priorContributions: signal(3),
          priorContributionsKnown: signal(true),
          hasCv: signal(false),
        },
      },
      {
        provide: TargetService,
        useValue: {
          repoSnapshot,
          issueSnapshot,
          results: signal([]),
          searching: signal(false),
          issues: signal([]),
          issueNumber: signal(null),
          loading: signal(false),
          error: signal(null),
          repoName: signal(opts.repo ? 'a/b' : null),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(DashboardComponent);
  fixture.detectChanges();
  return fixture;
}

function text(fixture: ReturnType<typeof render>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

beforeEach(() => {
  TestBed.resetTestingModule();
});

describe('scores without a profile', () => {
  it('shows no percentages at all rather than demo-data ones', () => {
    // Regression: DEMO_DEV meant an anonymous visitor was scored as a fictional
    // beginner and the result was labelled with their own numbers.
    const fixture = render({ profile: null, repo: REPO, issue: ISSUE });
    const body = text(fixture);

    expect(body).not.toMatch(/\d+%/);
    expect(body).toMatch(/Connect GitHub or import a CV/);
  });

  it('prompts for a profile, not for a target, when the target already exists', () => {
    const fixture = render({ profile: null, repo: REPO });
    expect(text(fixture)).toMatch(/need a real profile/);
  });
});

describe('scores with a profile', () => {
  it('renders match and skill coverage once a repo is picked', () => {
    const fixture = render({ profile: PROFILE, repo: REPO });
    const body = text(fixture);

    expect(body).toMatch(/Repository match/);
    expect(body).toMatch(/Skill coverage/);
    expect(body).toMatch(/\d+%/);
  });

  it('waits for an issue before showing contribution confidence', () => {
    const withoutIssue = text(render({ profile: PROFILE, repo: REPO }));
    expect(withoutIssue).toMatch(/pick an open issue/);

    const withIssue = text(render({ profile: PROFILE, repo: REPO, issue: ISSUE }));
    expect(withIssue).not.toMatch(/pick an open issue/);
  });

  it('shows a dash, not 100%, when the repo declares no technologies', () => {
    const fixture = render({ profile: PROFILE, repo: REPO_NO_TECH });
    const body = text(fixture);

    expect(body).toMatch(/no technologies detected/);
    expect(body).toMatch(/nothing to\s+compare against/);
  });

  it('asks for a target when there is a profile but no repo', () => {
    const fixture = render({ profile: PROFILE, repo: null });
    expect(text(fixture)).toMatch(/Pick a repository/);
  });
});
