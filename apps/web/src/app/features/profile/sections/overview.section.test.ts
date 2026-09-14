import { beforeEach, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withHashLocation } from '@angular/router';
import { buildProfile, testLevel, testSkill } from '@cairn/profile/testing';
import type { ProfileEdit, UnifiedProfile } from '@cairn/profile';
import { AuthService } from '../../../core/auth/auth.service';
import { ProfileService } from '../../../core/profile/profile.service';
import { OverviewSectionComponent } from './overview.section';

/**
 * The hub's Overview, which is where a hand edit actually happens.
 *
 * `manual` provenance has existed since Profile v2 and nothing could produce it —
 * there was no UI. These tests are the first that watch a person's typing reach the
 * top of the precedence ladder.
 */

const MERGED: UnifiedProfile = buildProfile({
  contact: {
    name: {
      value: 'Octo Cat',
      from: { source: 'github', confidence: 0.5, capturedAt: '2026-09-14' },
    },
    emails: [],
  },
  skills: [testSkill('typescript', 0.9)],
  experienceLevel: testLevel('intermediate'),
});

function render(opts: { profile?: UnifiedProfile | null } = {}) {
  const edits: ProfileEdit[] = [];

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([], withHashLocation()),
      {
        provide: ProfileService,
        useValue: {
          profile: signal(opts.profile ?? null),
          loading: signal(false),
          error: signal(null),
          unreadable: signal(false),
          edit: async (e: ProfileEdit) => {
            edits.push(e);
          },
        },
      },
      { provide: AuthService, useValue: { identities: signal([]) } },
    ],
  });

  const fixture = TestBed.createComponent(OverviewSectionComponent);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;

  return {
    fixture,
    edits,
    text: (): string => (host.textContent ?? '').replace(/\s+/g, ' ').trim(),
    all: (selector: string): Element[] => Array.from(host.querySelectorAll(selector)),
    el: <T extends Element>(s: string): T | null => host.querySelector<T>(s),
  };
}

beforeEach(() => TestBed.resetTestingModule());

describe('with no profile', () => {
  it('says what a profile is made of, and offers somewhere to start', () => {
    const view = render({ profile: null });

    expect(view.text()).toMatch(/Nothing here yet/);
    expect(view.el('a[href="#/profile/sources"]')).not.toBeNull();
  });
});

describe('with a merged profile', () => {
  it('shows each field with the source it came from', () => {
    const view = render({ profile: MERGED });

    expect(view.text()).toContain('Octo Cat');
    // Provenance is written out, not only painted — colour is never the only signal.
    expect(view.text()).toContain('GitHub');
  });

  it('shows the derived level and the years behind it', () => {
    const view = render({ profile: MERGED });

    expect(view.text()).toMatch(/Derived from/);
    expect(view.text()).toContain('intermediate');
  });
});

describe('editing', () => {
  /**
   * The moment ADR-0031 was built for: a value a parser guessed, corrected by the
   * person it is about, becoming the highest-precedence claim in the system.
   */
  it('turns a correction into a manual edit', () => {
    const view = render({ profile: MERGED });
    const cmp = view.fixture.componentInstance as unknown as {
      setContact(field: string, value: string): Promise<void>;
    };

    void cmp.setContact('name', 'Amara Okonkwo');

    expect(view.edits).toEqual([
      { kind: 'contact', field: 'name', value: 'Amara Okonkwo' },
    ]);
  });

  it('states an experience level the dates do not imply', () => {
    const view = render({ profile: MERGED });
    const cmp = view.fixture.componentInstance as unknown as {
      setLevel(value: string): Promise<void>;
    };

    void cmp.setLevel('expert');

    expect(view.edits).toEqual([{ kind: 'experience-level', value: 'expert' }]);
  });

  it('commits nothing just by rendering', () => {
    expect(render({ profile: MERGED }).edits).toEqual([]);
  });
});
