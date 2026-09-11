import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { ParsedCv, UnifiedProfile } from '@cairn/profile';
import { ProfileComponent } from './profile.component';
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

function render(opts: { draft?: ParsedCv | null; profile?: UnifiedProfile | null }) {
  const draft = signal(
    opts.draft ? { fileName: 'cv.pdf', parsed: opts.draft, truncated: false } : null,
  );
  const committed: ParsedCv[] = [];

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
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
