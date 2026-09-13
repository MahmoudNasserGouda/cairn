import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import type { ParsedCv, UnifiedProfile } from '@cairn/profile';
import { ProfileComponent } from './profile.component';
import { AiService } from '../core/ai/ai.service';
import { AiSettingsService } from '../core/ai/ai-settings.service';
import { CvImportService } from '../core/cv/cv-import.service';
import { ProfileService } from '../core/profile/profile.service';

const PARSED: ParsedCv = {
  name: 'Octo Cat',
  email: 'octo@example.com',
  skills: ['typescript', 'docker'],
  experience: [
    {
      title: 'Engineer',
      organization: 'Acme',
      startYear: 2020,
      endYear: 'present',
      source: 'cv',
    },
  ],
  sections: ['skills', 'experience'],
};

const MERGED: UnifiedProfile = {
  schemaVersion: 1,
  identities: [{ provider: 'github', displayName: 'Octo' }],
  skills: [{ tag: 'typescript', level: 0.9, source: 'github' }],
  technologies: ['typescript'],
  experienceLevel: 'intermediate',
  interests: [],
  experience: [],
  totalYears: 3,
};

function render(opts: {
  draft?: ParsedCv | null;
  profile?: UnifiedProfile | null;
  hasKey?: boolean;
  /** What the stubbed provider "replies" when the component asks. */
  aiReply?: string;
}) {
  const draft = signal(
    opts.draft
      ? { fileName: 'cv.pdf', parsed: opts.draft, text: 'raw cv text', truncated: false }
      : null,
  );
  const committed: ParsedCv[] = [];

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: CvImportService,
        useValue: {
          draft,
          status: signal(draft() ? 'review' : 'idle'),
          error: signal(null),
          busy: signal(false),
          maxBytes: 5 * 1024 * 1024,
          reset: () => draft.set(null),
          import: async () => undefined,
        },
      },
      {
        provide: ProfileService,
        useValue: {
          profile: signal(opts.profile ?? null),
          loading: signal(false),
          error: signal(null),
          hasCv: signal(false),
          setCv: async (cv: ParsedCv) => {
            committed.push(cv);
          },
          clearCv: async () => undefined,
        },
      },
      {
        provide: AiSettingsService,
        useValue: { hasKey: signal(opts.hasKey ?? false), provider: signal('openai') },
      },
      {
        provide: AiService,
        useValue: {
          running: signal(false),
          run: async () =>
            opts.aiReply === undefined
              ? { status: 'declined' }
              : { status: 'ok', text: opts.aiReply },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(ProfileComponent);
  fixture.detectChanges();
  return { fixture, committed, draft };
}

function text(el: unknown): string {
  return ((el as { nativeElement: HTMLElement }).nativeElement.textContent ?? '').replace(
    /\s+/g,
    ' ',
  );
}

beforeEach(() => {
  TestBed.resetTestingModule();
});

describe('CV review is mandatory', () => {
  it('shows the review form and commits nothing until confirmed', () => {
    const { fixture, committed } = render({ draft: PARSED });

    expect(text(fixture)).toMatch(/Check what we read/);
    expect(text(fixture)).toMatch(/Nothing is added to your profile until you confirm/);
    expect(committed).toEqual([]);
  });

  it('commits only the skills still ticked', () => {
    const { fixture, committed } = render({ draft: PARSED });
    const cmp = fixture.componentInstance as unknown as {
      toggleSkill(tag: string): void;
      confirm(): void;
    };

    cmp.toggleSkill('docker');
    cmp.confirm();

    expect(committed).toHaveLength(1);
    expect(committed[0]?.skills).toEqual(['typescript']);
  });

  it('keeps "present" as an open-ended role rather than NaN', () => {
    const { fixture, committed } = render({ draft: PARSED });
    const cmp = fixture.componentInstance as unknown as { confirm(): void };

    cmp.confirm();

    expect(committed[0]?.experience[0]).toMatchObject({
      title: 'Engineer',
      organization: 'Acme',
      startYear: 2020,
      endYear: 'present',
    });
  });

  it('drops an unticked role', () => {
    const { fixture, committed } = render({ draft: PARSED });
    const cmp = fixture.componentInstance as unknown as {
      toggleRole(i: number): void;
      confirm(): void;
    };

    cmp.toggleRole(0);
    cmp.confirm();

    expect(committed[0]?.experience).toEqual([]);
  });

  it('discarding commits nothing and closes the form', () => {
    const { fixture, committed, draft } = render({ draft: PARSED });
    const cmp = fixture.componentInstance as unknown as { cancel(): void };

    cmp.cancel();

    expect(committed).toEqual([]);
    expect(draft()).toBeNull();
  });
});

describe('merged profile panel', () => {
  it('invites a connection when there is no profile', () => {
    const { fixture } = render({ profile: null });
    expect(text(fixture)).toMatch(/connect GitHub from the sign-in menu/);
  });

  it('lists the merged skills with their source', () => {
    const { fixture } = render({ profile: MERGED });
    const body = text(fixture);

    expect(body).toMatch(/Merged profile/);
    expect(body).toMatch(/typescript/);
    expect(body).toMatch(/github/);
  });
});

describe('optional AI refinement', () => {
  const REPLY = JSON.stringify({
    name: 'Octo Cat',
    skills: ['typescript', 'kubernetes'],
    experience: [{ title: 'Maintainer', organization: 'OSS', startYear: 2018 }],
  });

  it('offers nothing but a pointer to settings with no key', () => {
    const { fixture } = render({ draft: PARSED });
    const body = text(fixture);

    expect(body).toMatch(/A parser read this, not a model/);
    expect(body).not.toMatch(/Re-read this CV with AI/);
  });

  it('proposes what the parser missed and applies nothing on its own', async () => {
    const { fixture, committed } = render({
      draft: PARSED,
      hasKey: true,
      aiReply: REPLY,
    });
    const cmp = fixture.componentInstance as unknown as {
      refine(): Promise<void>;
      confirm(): void;
    };

    await cmp.refine();
    fixture.detectChanges();
    const body = text(fixture);

    // Suggested and new.
    expect(body).toMatch(/kubernetes/);
    expect(body).toMatch(/Maintainer/);
    expect(body).toMatch(/AI-generated/);

    // Confirming without accepting anything commits the parser's fields only.
    cmp.confirm();
    expect(committed[0]?.skills).toEqual(['typescript', 'docker']);
    expect(committed[0]?.experience).toHaveLength(1);
    expect(committed[0]?.experience[0]?.title).toBe('Engineer');
  });

  it('commits a suggestion once it is accepted', async () => {
    const { fixture, committed } = render({
      draft: PARSED,
      hasKey: true,
      aiReply: REPLY,
    });
    const cmp = fixture.componentInstance as unknown as {
      refine(): Promise<void>;
      acceptSkill(tag: string): void;
      acceptRole(role: {
        title: string;
        organization?: string;
        startYear?: number;
      }): void;
      newRoles(): readonly { title: string }[];
      confirm(): void;
    };

    await cmp.refine();
    cmp.acceptSkill('kubernetes');
    cmp.acceptRole({ title: 'Maintainer', organization: 'OSS', startYear: 2018 });
    cmp.confirm();

    expect(committed[0]?.skills).toEqual(['typescript', 'docker', 'kubernetes']);
    expect(committed[0]?.experience).toHaveLength(2);
    expect(committed[0]?.experience[1]).toMatchObject({
      title: 'Maintainer',
      organization: 'OSS',
      startYear: 2018,
      source: 'cv',
    });
  });

  it('says so plainly when the model replies with nothing usable', async () => {
    const { fixture } = render({
      draft: PARSED,
      hasKey: true,
      aiReply: 'I am afraid I cannot help with that.',
    });
    const cmp = fixture.componentInstance as unknown as { refine(): Promise<void> };

    await cmp.refine();
    fixture.detectChanges();

    expect(text(fixture)).toMatch(/the parsed fields above are unchanged/);
  });

  it('only offers what the form does not already hold', async () => {
    const { fixture } = render({
      draft: PARSED,
      hasKey: true,
      aiReply: JSON.stringify({ skills: ['typescript', 'docker'], experience: [] }),
    });
    const cmp = fixture.componentInstance as unknown as { refine(): Promise<void> };

    await cmp.refine();
    fixture.detectChanges();

    expect(text(fixture)).toMatch(/the model found the same things the parser did/);
  });
});
