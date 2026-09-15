import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import type { UnifiedProfile } from '@cairn/profile';
import type { RepositorySnapshot, IssueSnapshot } from '@cairn/matching';
import { DashboardPageComponent } from './dashboard.page';
import { ProfileService } from '../../core/profile/profile.service';
import { TargetService } from '../../core/targets/target.service';
import { AI_ENABLED } from '../../core/features';
import { AiService } from '../../core/ai/ai.service';
import { AiSettingsService } from '../../core/ai/ai-settings.service';
import { buildProfile, testRole, testSkill } from '@cairn/profile/testing';

const PROFILE: UnifiedProfile = buildProfile({
  identities: [{ provider: 'github', displayName: 'Octo' }],
  skills: [testSkill('typescript', 0.9), testSkill('react', 0.6)],
  interests: [
    { tag: 'web', from: { source: 'cv', confidence: 1, capturedAt: '2026-09-15' } },
  ],
  experience: [
    testRole(
      'Public GitHub activity',
      { organization: 'GitHub', startYear: 2020, endYear: 2024 },
      'github',
    ),
  ],
});

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

const ISSUE_ITEM = {
  number: 1,
  title: 'Fix the flaky import test',
  body: 'It fails about one run in ten.',
  labels: ['good first issue'],
  commentCount: 2,
  reactions: 0,
  htmlUrl: 'https://github.com/a/b/issues/1',
};

function render(opts: {
  profile?: UnifiedProfile | null;
  repo?: RepositorySnapshot | null;
  issue?: IssueSnapshot | null;
  hasKey?: boolean;
}) {
  const profile = signal(opts.profile ?? null);
  const repoSnapshot = signal(opts.repo ?? null);
  const issueSnapshot = signal(opts.issue ?? null);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      // AI ships frozen (ADR-0033). These tests cover the *enabled* path, which
      // has to keep working for unfreezing to be one constant; the frozen path is
      // covered in core/ai/ai-freeze.test.ts.
      { provide: AI_ENABLED, useValue: true },
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
          issueNumber: signal(opts.issue ? opts.issue.number : null),
          selectedIssue: signal(opts.issue ? ISSUE_ITEM : null),
          loading: signal(false),
          error: signal(null),
          repoName: signal(opts.repo ? 'a/b' : null),
        },
      },
      { provide: AiSettingsService, useValue: { hasKey: signal(opts.hasKey ?? false) } },
      {
        provide: AiService,
        useValue: { running: signal(false), run: async () => ({ status: 'declined' }) },
      },
    ],
  });
  const fixture = TestBed.createComponent(DashboardPageComponent);
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
    expect(body).toMatch(/No profile to score/);
  });

  it('prompts for a profile, not for a target, when the target already exists', () => {
    const fixture = render({ profile: null, repo: REPO });
    // Still the *profile* prompt, not the target one, even though a target exists.
    expect(text(fixture)).toMatch(/No profile to score/);
    expect(text(fixture)).not.toMatch(/No target chosen/);
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

    expect(body).toMatch(/reports no stack for this repository/);
    expect(body).toMatch(/nothing\s+to compare against/);
  });

  it('asks for a target when there is a profile but no repo', () => {
    const fixture = render({ profile: PROFILE, repo: null });
    expect(text(fixture)).toMatch(/No target chosen/);
  });
});

describe('issue explainer', () => {
  it('explains the picked issue with no API key at all', () => {
    // ADR-0009: the non-AI path is the feature's floor, not an error state.
    const body = text(render({ profile: PROFILE, repo: REPO, issue: ISSUE }));

    expect(body).toMatch(/Understand this issue/);
    expect(body).toMatch(/Fix the flaky import test/);
    expect(body).toMatch(/estimated easy/);
    expect(body).toMatch(/typescript/);
    expect(body).not.toMatch(/Explain with AI/);
    expect(body).toMatch(/Add your own API key/);
  });

  it('offers the written version only once a key exists', () => {
    const body = text(
      render({ profile: PROFILE, repo: REPO, issue: ISSUE, hasKey: true }),
    );

    expect(body).toMatch(/Explain with AI/);
    // The deterministic read is still what is on screen until the user asks.
    expect(body).toMatch(/estimated easy/);
  });

  it('explains the issue even with no profile — understanding it needs no scores', () => {
    const body = text(render({ profile: null, repo: REPO, issue: ISSUE }));

    expect(body).toMatch(/Understand this issue/);
    expect(body).toMatch(/estimated easy/);
  });

  it('says nothing about an issue until one is picked', () => {
    expect(text(render({ profile: PROFILE, repo: REPO }))).not.toMatch(
      /Understand this issue/,
    );
  });
});
