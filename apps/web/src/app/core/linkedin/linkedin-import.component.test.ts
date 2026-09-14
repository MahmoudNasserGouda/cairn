import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import type { LinkedinArchive } from '@cairn/linkedin-archive';
import { LinkedinImportComponent } from './linkedin-import.component';
import { LinkedinImportService } from './linkedin-import.service';
import { ProfileService } from '../profile/profile.service';

function archive(overrides: Partial<LinkedinArchive> = {}): LinkedinArchive {
  return {
    identity: {
      firstName: 'Amara',
      lastName: 'Okonkwo',
      headline: 'Backend engineer',
      websites: [],
      twitterHandles: [],
    },
    positions: [
      {
        title: 'Backend Engineer',
        organization: 'Paystack',
        startYear: 2021,
        endYear: 'present',
        highlights: ['Built payment reconciliation in Python.'],
      },
    ],
    education: [],
    skills: ['Python'],
    certifications: [],
    projects: [],
    languages: [],
    emails: ['amara@example.test'],
    report: {
      read: ['Export/Profile.csv', 'Export/Positions.csv'],
      missing: ['Languages.csv'],
      skipped: ['Export/Connections.csv', 'Export/messages.csv'],
    },
    ...overrides,
  };
}

function render(opts: { draft?: LinkedinArchive | null; imported?: boolean } = {}) {
  const draft = signal(
    opts.draft === undefined || opts.draft === null
      ? null
      : { fileName: 'export.zip', archive: opts.draft },
  );
  const committed: LinkedinArchive[] = [];
  let cleared = 0;

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: LinkedinImportService,
        useValue: {
          draft,
          status: signal(draft() ? 'review' : 'idle'),
          error: signal(null),
          busy: signal(false),
          reset: () => draft.set(null),
          import: async () => undefined,
        },
      },
      {
        provide: ProfileService,
        useValue: {
          hasLinkedinArchive: signal(opts.imported ?? false),
          setLinkedin: async (value: LinkedinArchive) => {
            committed.push(value);
          },
          clearLinkedin: async () => {
            cleared++;
          },
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(LinkedinImportComponent);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  // The same cast the other component tests use: the actions are `protected` so the
  // template can reach them, which is not the same as being private to the class.
  const cmp = fixture.componentInstance as unknown as {
    confirm(): Promise<void>;
    cancel(): void;
    remove(): Promise<void>;
  };

  return {
    fixture,
    cmp,
    text: (): string => (host.textContent ?? '').replace(/\s+/g, ' '),
    html: (): string => host.innerHTML,
    committed,
    cleared: () => cleared,
    draft,
  };
}

beforeEach(() => {
  TestBed.resetTestingModule();
});

describe('before an import', () => {
  it('explains where the file comes from and shows no review', () => {
    const view = render();

    expect(view.text()).toContain('Get a copy of your data');
    expect(view.text()).not.toContain('Check what we read');
  });

  /**
   * The refusal is the feature (ADR-0029), so it is stated before the user hands over
   * the file rather than only after.
   */
  it('names the files it will never open', () => {
    const view = render();

    expect(view.text()).toContain('Connections.csv');
    expect(view.text()).toContain('messages.csv');
  });

  it('offers removal only once an archive is actually contributing', () => {
    expect(render({ imported: false }).text()).not.toContain('Remove LinkedIn data');
    expect(render({ imported: true }).text()).toContain('Remove LinkedIn data');
  });

  it('removes the archive when asked', async () => {
    const view = render({ imported: true });
    await view.cmp.remove();

    expect(view.cleared()).toBe(1);
  });
});

describe('the review step', () => {
  it('shows what was read, down to the highlights', () => {
    const text = render({ draft: archive() }).text();

    expect(text).toContain('Amara Okonkwo');
    expect(text).toContain('Backend Engineer');
    expect(text).toContain('Paystack');
    expect(text).toContain('2021 – present');
    expect(text).toContain('Built payment reconciliation in Python.');
    expect(text).toContain('amara@example.test');
  });

  /**
   * A privacy claim the user can check against the file they downloaded is worth more
   * than a policy paragraph they have to believe.
   */
  it('reports what it opened and what it left alone', () => {
    const text = render({ draft: archive() }).text();

    expect(text).toContain('Opened 2');
    expect(text).toContain('Profile.csv, Positions.csv');
    expect(text).toContain('Left unopened: 2');
    expect(text).toContain('Connections.csv, messages.csv');
    expect(text).toContain('Not in your archive: Languages.csv');
  });

  it('commits nothing until the user confirms', () => {
    const view = render({ draft: archive() });

    expect(view.committed).toEqual([]);
  });

  it('hands the reviewed archive to the profile, then clears the draft', async () => {
    const view = render({ draft: archive() });
    await view.cmp.confirm();

    expect(view.committed).toHaveLength(1);
    expect(view.committed[0]?.positions[0]?.organization).toBe('Paystack');
    expect(view.draft()).toBeNull();
  });

  it('discards without committing', () => {
    const view = render({ draft: archive() });
    view.cmp.cancel();

    expect(view.committed).toEqual([]);
    expect(view.draft()).toBeNull();
  });

  /**
   * The archive is a file the user was emailed, so every string in it is attacker
   * material (SECURITY.md T7). Angular's interpolation is the whole defence, and this
   * is what would notice if someone reached for `innerHTML` in a future edit.
   */
  it('renders hostile text as text', () => {
    const view = render({
      draft: archive({
        identity: {
          firstName: '<img src=x onerror="alert(1)">',
          lastName: 'Okonkwo',
          summary: '<script>alert(2)</script>',
          websites: [],
          twitterHandles: [],
        },
      }),
    });

    expect(view.html()).not.toContain('<img src=x');
    expect(view.html()).not.toContain('<script>');
    expect(view.text()).toContain('<img src=x onerror="alert(1)">');
    expect(view.text()).toContain('<script>alert(2)</script>');
  });
});
