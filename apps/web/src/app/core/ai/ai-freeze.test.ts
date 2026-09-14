/**
 * The AI freeze (ADR-0033).
 *
 * `FEATURES.ai` is off by default, and with it off the shipped product must be
 * *entirely* AI-free: no control on any page, and no reachable path to a provider.
 * Both states are tested, because a flag exercised in one state is a flag that breaks
 * in the other — and because the flag is the only thing standing between a frozen
 * feature and a live one.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import type { ParsedCv, UnifiedProfile } from '@cairn/profile';
import type { RepositorySnapshot, IssueSnapshot } from '@cairn/matching';
import { AI_ENABLED } from '../features';
import { AiService } from './ai.service';
import { AiSettingsService } from './ai-settings.service';
import { AiDisclosureService } from './ai-disclosure.service';
import { CvImportService } from '../cv/cv-import.service';
import { ProfileService } from '../profile/profile.service';
import { TargetService } from '../targets/target.service';
import { AppComponent } from '../../app.component';
import { AuthService } from '../auth/auth.service';
import { SignInDialogService } from '../auth/sign-in-dialog.service';
import { DashboardComponent } from '../../pages/dashboard.component';
import { CvImportComponent } from '../cv/cv-import.component';
import { SettingsComponent } from '../../pages/settings.component';
import { buildProfile, testLevel, testSkill } from '@cairn/profile/testing';

const PROFILE: UnifiedProfile = buildProfile({
  identities: [{ provider: 'github', displayName: 'Octo' }],
  skills: [testSkill('typescript', 0.9)],
  interests: ['web'],
  experienceLevel: testLevel('intermediate'),
});

const REPO: RepositorySnapshot = {
  fullName: 'a/b',
  technologies: ['typescript'],
  topics: ['typescript'],
  activity: 0.8,
  health: 0.7,
  newcomerFriendliness: 0.6,
  requiredExperience: 'intermediate',
};

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

const PARSED: ParsedCv = {
  name: 'Octo Cat',
  email: 'octo@example.com',
  skills: ['typescript'],
  experience: [],
  sections: ['skills'],
};

/**
 * Everything the four AI-touching components need, with a key already saved — the
 * most permissive state there is, so anything hidden is hidden by the flag alone.
 */
function configure(enabled: boolean, opts: { hasKey?: boolean } = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AI_ENABLED, useValue: enabled },
      {
        provide: AiSettingsService,
        useValue: {
          hasKey: signal(opts.hasKey ?? true),
          provider: signal('openrouter'),
          model: signal('some/model'),
          storage: signal('persistent'),
          setProvider: () => undefined,
          setModel: () => undefined,
          setStorage: () => undefined,
          saveKey: async () => undefined,
          clearAll: async () => undefined,
        },
      },
      {
        provide: AiService,
        useValue: { running: signal(false), run: async () => ({ status: 'declined' }) },
      },
      {
        provide: AuthService,
        useValue: {
          isSignedIn: signal(false),
          status: signal('signed-out'),
          primaryIdentity: signal(null),
          availableProviders: [],
          signOut: () => undefined,
        },
      },
      {
        provide: SignInDialogService,
        useValue: { open: signal(false), show: () => undefined, close: () => undefined },
      },
      {
        provide: ProfileService,
        useValue: {
          profile: signal(PROFILE),
          loading: signal(false),
          error: signal(null),
          priorContributions: signal(3),
          priorContributionsKnown: signal(true),
          // The page embeds `<cn-linkedin-import />`, which reads this.
          hasLinkedinArchive: signal(false),
          hasCv: signal(false),
          cv: signal(null),
        },
      },
      {
        provide: TargetService,
        useValue: {
          repoSnapshot: signal(REPO),
          issueSnapshot: signal(ISSUE),
          results: signal([]),
          searching: signal(false),
          issues: signal([]),
          issueNumber: signal(1),
          selectedIssue: signal(ISSUE_ITEM),
          loading: signal(false),
          error: signal(null),
          repoName: signal('a/b'),
        },
      },
      {
        provide: CvImportService,
        useValue: {
          draft: signal({
            fileName: 'cv.pdf',
            parsed: PARSED,
            text: 'raw cv text',
            truncated: false,
          }),
          status: signal('review'),
          error: signal(null),
          busy: signal(false),
          maxBytes: 5 * 1024 * 1024,
          reset: () => undefined,
          import: async () => undefined,
        },
      },
    ],
  });
}

function hostOf(component: Parameters<typeof TestBed.createComponent>[0]): HTMLElement {
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

function textOf(component: Parameters<typeof TestBed.createComponent>[0]): string {
  return hostOf(component).textContent ?? '';
}

/**
 * The key field is a `placeholder`, not text — asserting on `textContent` alone would
 * pass whether or not the input was rendered, which is the wrong kind of green.
 */
const KEY_INPUT = 'input[name="cn-ai-key"]';
const PROVIDER_SELECT = 'select';

beforeEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
});

describe('with AI frozen (the default)', () => {
  it('offers no AI re-read on the CV review form', () => {
    configure(false);
    const body = textOf(CvImportComponent);
    expect(body).not.toMatch(/re-read this cv with ai/i);
    // Nor the "add a key to unlock it" nudge — there is nothing to unlock.
    expect(body).not.toMatch(/api key/i);
  });

  it('offers no AI issue explanation on the dashboard', () => {
    configure(false);
    const body = textOf(DashboardComponent);
    expect(body).not.toMatch(/explain with ai/i);
    expect(body).not.toMatch(/ai-generated/i);
  });

  it('shows no AI configuration on the settings page', () => {
    configure(false, { hasKey: false });
    const host = hostOf(SettingsComponent);
    expect(host.querySelector(KEY_INPUT)).toBeNull();
    expect(host.querySelector(PROVIDER_SELECT)).toBeNull();
    expect(host.textContent ?? '').not.toMatch(/openrouter/i);
  });

  /** ADR-0033: a user who already stored a key must still be able to remove it. */
  it('still offers to clear a key that was stored before the freeze', () => {
    configure(false, { hasKey: true });
    expect(textOf(SettingsComponent)).toMatch(/clear all ai data/i);
  });

  it('does not mount the disclosure dialog', () => {
    configure(false);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('cn-ai-disclosure-dialog')).toBeNull();
  });
});

describe('with AI enabled', () => {
  it('offers the AI re-read on the CV review form', () => {
    configure(true);
    expect(textOf(CvImportComponent)).toMatch(/re-read this cv with ai/i);
  });

  it('offers the AI issue explanation on the dashboard', () => {
    configure(true);
    expect(textOf(DashboardComponent)).toMatch(/explain with ai/i);
  });

  it('shows AI configuration on the settings page', () => {
    configure(true, { hasKey: false });
    const host = hostOf(SettingsComponent);
    expect(host.querySelector(KEY_INPUT)).not.toBeNull();
    expect(host.querySelector(PROVIDER_SELECT)).not.toBeNull();
  });

  it('mounts the disclosure dialog', () => {
    configure(true);
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('cn-ai-disclosure-dialog')).not.toBeNull();
  });
});

describe('AiService is inert while frozen', () => {
  function service(enabled: boolean) {
    const ask = vi.fn(async () => null);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AI_ENABLED, useValue: enabled },
        { provide: AiDisclosureService, useValue: { ask } },
        {
          provide: AiSettingsService,
          useValue: {
            peekKey: () => 'sk-a-real-looking-key',
            provider: signal('openrouter'),
            model: signal('some/model'),
          },
        },
      ],
    });
    return { ai: TestBed.inject(AiService), ask, fetchMock };
  }

  const PROMPT = {
    task: 'Explain an issue',
    userQuestion: 'What does this want?',
    docs: [{ label: 'issue #1', content: 'Something is broken.' }],
  };

  /**
   * The template gate is the thing a user sees; this is the thing that matters. A
   * caller reaching `run()` some other way must still send nothing — not even reach
   * the disclosure panel, which is what would otherwise offer to send it.
   */
  it('refuses to run and never opens the disclosure panel', async () => {
    const { ai, ask, fetchMock } = service(false);
    const outcome = await ai.run('Re-reading your CV', PROMPT);

    expect(outcome.status).toBe('error');
    expect(ask).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reaches the disclosure panel when enabled', async () => {
    const { ai, ask } = service(true);
    await ai.run('Re-reading your CV', PROMPT);
    expect(ask).toHaveBeenCalledOnce();
  });
});
