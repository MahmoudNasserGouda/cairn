import { beforeEach, describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ScoreBreakdown } from '@cairn/scoring';
import { UI, yearRange } from './index';

/**
 * The `cn-*` library, tested for the things that can actually be wrong.
 *
 * Not the CSS — a test asserting `padding: var(--space-5)` only restates the
 * stylesheet, and `tokens.test.ts` already catches the failure mode that matters
 * there. What is tested here is semantics: what a screen reader is told, what the
 * keyboard can reach, and whether an unknown value is distinguishable from zero.
 */

function render(template: string, state: Record<string, unknown> = {}) {
  @Component({ standalone: true, imports: [...UI], template })
  class Host {
    [key: string]: unknown;
  }

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(Host);
  Object.assign(fixture.componentInstance, state);
  fixture.detectChanges();

  const host = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host,
    text: (): string => (host.textContent ?? '').replace(/\s+/g, ' ').trim(),
    find: <T extends Element>(selector: string): T | null =>
      host.querySelector<T>(selector),
    // `Array.from`, not a spread: `apps/web/tsconfig.json` omits `DOM.Iterable`,
    // so spreading a NodeList degrades to `any[]`.
    all: (selector: string): Element[] => Array.from(host.querySelectorAll(selector)),
  };
}

beforeEach(() => TestBed.resetTestingModule());

describe('cn-button', () => {
  it('stays a real button, so a form still submits', () => {
    const view = render(`<button cn-button type="submit">Save</button>`);
    const button = view.find<HTMLButtonElement>('button');

    expect(button?.tagName).toBe('BUTTON');
    expect(button?.type).toBe('submit');
  });

  it('carries its variant and size as classes', () => {
    const view = render(`<button cn-button variant="danger" size="sm">Remove</button>`);

    expect(view.find('button')?.className).toContain('v-danger');
    expect(view.find('button')?.className).toContain('s-sm');
  });

  /**
   * Loading is not disabled, and the difference is a real one: a control that leaves
   * the tab order mid-interaction drops the keyboard user wherever they stood.
   */
  it('announces loading without removing itself from the tab order', () => {
    const view = render(`<button cn-button [loading]="true">Save</button>`);
    const button = view.find<HTMLButtonElement>('button');

    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.disabled).toBe(false);
  });
});

describe('cn-tag', () => {
  /**
   * Colour is never the only signal (docs/design-system.md). "The blue one means you
   * typed it" is not something anyone should have to learn.
   */
  it('writes the source out as well as painting it', () => {
    const view = render(`<cn-tag source="manual">TypeScript</cn-tag>`);

    expect(view.text()).toContain('TypeScript');
    expect(view.text()).toContain('you');
    expect(view.find('cn-tag')?.className).toContain('src-manual');
  });

  it('names each source the way a person would', () => {
    const view = render(`
      <cn-tag source="github">a</cn-tag>
      <cn-tag source="linkedin">b</cn-tag>
      <cn-tag source="cv">c</cn-tag>
    `);

    expect(view.text()).toContain('GitHub');
    expect(view.text()).toContain('LinkedIn');
    expect(view.text()).toContain('CV');
  });

  it('is a plain chip with no source', () => {
    const view = render(`<cn-tag>docker</cn-tag>`);

    expect(view.find('.src')).toBeNull();
    expect(view.find('cn-tag')?.className).not.toContain('has-source');
  });
});

describe('cn-field', () => {
  it('ties the label to the control without the caller wiring anything', () => {
    const view = render(`
      <cn-field label="Organisation"><input cn-control type="text" /></cn-field>
    `);
    const label = view.find<HTMLLabelElement>('label');
    const input = view.find<HTMLInputElement>('input');

    expect(input?.id).toBeTruthy();
    expect(label?.getAttribute('for')).toBe(input?.id);
  });

  it('describes the control by its hint', () => {
    const view = render(`
      <cn-field label="Name" hint="As you want it shown">
        <input cn-control type="text" />
      </cn-field>
    `);
    const input = view.find<HTMLInputElement>('input');
    const hint = view.find('.hint');

    expect(input?.getAttribute('aria-describedby')).toBe(hint?.id);
    expect(input?.getAttribute('aria-invalid')).toBeNull();
  });

  it('replaces the hint with the error, and marks the control invalid', () => {
    const view = render(`
      <cn-field label="Year" hint="Four digits" error="That is not a year">
        <input cn-control type="text" />
      </cn-field>
    `);
    const input = view.find<HTMLInputElement>('input');

    expect(view.find('.hint')).toBeNull();
    expect(view.find('.error')?.getAttribute('role')).toBe('alert');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(input?.getAttribute('aria-describedby')).toBe(view.find('.error')?.id);
  });

  it('gives each field its own ids, so two on a page do not collide', () => {
    const view = render(`
      <cn-field label="First"><input cn-control type="text" /></cn-field>
      <cn-field label="Second"><input cn-control type="text" /></cn-field>
    `);
    const [a, b] = view.all('input') as HTMLInputElement[];

    expect(a?.id).toBeTruthy();
    expect(a?.id).not.toBe(b?.id);
  });
});

describe('cn-avatar', () => {
  it('shows the image when there is one', () => {
    const view = render(
      `<cn-avatar name="Amara Okonkwo" src="https://avatars.githubusercontent.com/u/1" />`,
    );

    expect(view.find('img')).not.toBeNull();
    expect(view.find('cn-avatar')?.getAttribute('aria-label')).toBe('Amara Okonkwo');
  });

  it('falls back to initials with no image', () => {
    const view = render(`<cn-avatar name="Amara Okonkwo" />`);

    expect(view.text()).toBe('AO');
  });

  /**
   * `img-src` allows only `'self'`, `data:` and `avatars.githubusercontent.com`, so a
   * LinkedIn or Google avatar is blocked by policy and *always* lands here. A broken
   * image icon where a face should be is not an edge case for those users.
   */
  it('falls back when the image is blocked or fails', () => {
    const view = render(
      `<cn-avatar name="Ada Lovelace" src="https://cdn.example/x.png" />`,
    );
    view.find<HTMLImageElement>('img')?.dispatchEvent(new Event('error'));
    view.fixture.detectChanges();

    expect(view.find('img')).toBeNull();
    expect(view.text()).toBe('AL');
  });

  it('handles a single-word name and an empty one', () => {
    expect(render(`<cn-avatar name="octocat" />`).text()).toBe('OC');
    expect(render(`<cn-avatar name="" />`).text()).toBe('?');
  });
});

describe('cn-score-bar', () => {
  const breakdown: ScoreBreakdown = {
    total: 0.72,
    percent: 72,
    weightsVersion: 1,
    parts: [
      { key: 'skillFit', value: 0.9, weight: 0.5, contribution: 0.45, note: '4 of 5' },
      { key: 'newcomerSignal', value: 0.54, weight: 0.5, contribution: 0.27 },
    ],
  };

  it('shows the number with its named parts, not behind a toggle', () => {
    const view = render(`<cn-score-bar label="Match" [breakdown]="score" />`, {
      score: breakdown,
    });

    expect(view.text()).toContain('72');
    expect(view.text()).toContain('Skill fit');
    expect(view.text()).toContain('Newcomer signal');
    expect(view.text()).toContain('4 of 5');
  });

  it('exposes the total as a meter a screen reader can read', () => {
    const view = render(`<cn-score-bar label="Match" [breakdown]="score" />`, {
      score: breakdown,
    });
    const meter = view.find('[role="meter"]');

    expect(meter?.getAttribute('aria-valuenow')).toBe('72');
    expect(meter?.getAttribute('aria-label')).toBe('Match');
  });

  /**
   * The bug this prevents actually shipped: a rate-limited merged-PR count rendered
   * as 0 and read as a track record of none.
   */
  it('says "couldn\'t check" rather than showing a zero', () => {
    const view = render(
      `<cn-score-bar label="Track record" [unknown]="true" unknownReason="GitHub rate limit" />`,
    );

    expect(view.text()).toContain("couldn't check");
    expect(view.text()).toContain('GitHub rate limit');
    expect(view.text()).not.toContain('0%');
    expect(view.find('[role="meter"]')).toBeNull();
  });

  it('can hide the parts for a compact row', () => {
    const view = render(
      `<cn-score-bar label="Match" [breakdown]="score" [showParts]="false" />`,
      { score: breakdown },
    );

    expect(view.find('.parts')).toBeNull();
    expect(view.text()).toContain('72');
  });
});

describe('cn-empty-state', () => {
  it('names the gap and carries the action that closes it', () => {
    const view = render(`
      <cn-empty-state headline="No skills yet" detail="Connect GitHub or import a CV.">
        <button cn-button>Connect GitHub</button>
      </cn-empty-state>
    `);

    expect(view.text()).toContain('No skills yet');
    expect(view.text()).toContain('Connect GitHub or import a CV.');
    expect(view.find('button')).not.toBeNull();
  });

  it('hides the mark in compact mode', () => {
    expect(
      render(`<cn-empty-state headline="x" [compact]="true" />`).find('svg'),
    ).toBeNull();
  });
});

describe('cn-section', () => {
  it('renders an h2 by default and an h3 when nested', () => {
    expect(render(`<cn-section heading="Experience" />`).find('h2')).not.toBeNull();
    expect(
      render(`<cn-section heading="Roles" [level]="3" />`).find('h3'),
    ).not.toBeNull();
  });

  it('ties the landmark to its heading when given an id', () => {
    const view = render(`<cn-section heading="Skills" headingId="skills-h" />`);

    expect(view.find('cn-section')?.getAttribute('aria-labelledby')).toBe('skills-h');
    expect(view.find('h2')?.id).toBe('skills-h');
  });
});

describe('cn-timeline', () => {
  it('renders entries with their bullets', () => {
    const view = render(`<cn-timeline [entries]="entries" />`, {
      entries: [
        {
          id: '1',
          title: 'Backend Engineer',
          subtitle: 'Paystack',
          startYear: 2021,
          endYear: 'present',
          bullets: ['Built payment reconciliation.'],
        },
      ],
    });

    expect(view.text()).toContain('Backend Engineer');
    expect(view.text()).toContain('Paystack');
    expect(view.text()).toContain('2021 – present');
    expect(view.text()).toContain('Built payment reconciliation.');
  });

  it('shows a placeholder rather than a blank column for an undated entry', () => {
    const view = render(`<cn-timeline [entries]="entries" />`, {
      entries: [{ id: '1', title: 'Volunteer' }],
    });

    expect(view.find('.when')?.textContent?.trim()).toBe('—');
  });
});

describe('yearRange', () => {
  it('reads the way a person would write it', () => {
    expect(yearRange(2019, 'present')).toBe('2019 – present');
    expect(yearRange(2019, 2021)).toBe('2019 – 2021');
    expect(yearRange(2019, undefined)).toBe('2019');
    expect(yearRange(undefined, 2021)).toBe('2021');
    // A role that started and ended in one year is "2020", not "2020 – 2020".
    expect(yearRange(2020, 2020)).toBe('2020');
    expect(yearRange(undefined, undefined)).toBe('');
  });
});

describe('a signal-driven input', () => {
  it('updates the view when the signal changes', () => {
    const loading = signal(false);
    const view = render(`<button cn-button [loading]="loading()">Save</button>`, {
      loading,
    });

    expect(view.find('button')?.getAttribute('aria-busy')).toBeNull();
    loading.set(true);
    view.fixture.detectChanges();
    expect(view.find('button')?.getAttribute('aria-busy')).toBe('true');
  });
});
