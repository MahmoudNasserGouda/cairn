import { beforeEach, describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';
import { SheetComponent } from './sheet.component';

/**
 * `cn-sheet`'s behaviour, which is the whole reason it exists.
 *
 * The sign-in dialog already implemented focus trapping, Escape and focus restore
 * correctly, once. This component is that behaviour extracted so the next dialog does
 * not get a second, worse copy — and these tests are what stop *this* copy rotting.
 */

@Component({
  standalone: true,
  imports: [SheetComponent, ButtonComponent],
  template: `
    <button type="button" id="opener" (click)="open.set(true)">Open</button>
    <cn-sheet [(open)]="open" heading="Settings">
      <button type="button" id="first">First</button>
      <button type="button" id="last">Last</button>
    </cn-sheet>
  `,
})
class Host {
  readonly open = signal(false);
}

function render() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;

  return {
    fixture,
    open: fixture.componentInstance.open,
    el: <T extends Element>(selector: string): T | null =>
      document.querySelector<T>(selector) ?? host.querySelector<T>(selector),
    detect: (): void => fixture.detectChanges(),
  };
}

beforeEach(() => TestBed.resetTestingModule());

describe('opening and closing', () => {
  it('renders nothing until it is opened', () => {
    const view = render();

    expect(view.el('[role="dialog"]')).toBeNull();
  });

  it('is a labelled modal dialog when open', () => {
    const view = render();
    view.open.set(true);
    view.detect();

    const dialog = view.el('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog?.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe('Settings');
  });

  it('closes on Escape', () => {
    const view = render();
    view.open.set(true);
    view.detect();

    view
      .el('.backdrop')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    view.detect();

    expect(view.open()).toBe(false);
  });

  it('closes on a backdrop click', () => {
    const view = render();
    view.open.set(true);
    view.detect();

    const backdrop = view.el<HTMLElement>('.backdrop');
    backdrop?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    view.detect();

    expect(view.open()).toBe(false);
  });

  /**
   * A click that starts inside the panel and ends on the backdrop — dragging across a
   * text selection — must not dismiss. Only the backdrop itself counts.
   */
  it('does not close when the click came from inside the panel', () => {
    const view = render();
    view.open.set(true);
    view.detect();

    view.el('[role="dialog"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    view.detect();

    expect(view.open()).toBe(true);
  });

  it('closes on the close button', () => {
    const view = render();
    view.open.set(true);
    view.detect();

    view.el<HTMLButtonElement>('.close')?.click();
    view.detect();

    expect(view.open()).toBe(false);
  });
});

describe('focus', () => {
  it('moves focus into the sheet on open', async () => {
    const view = render();
    view.open.set(true);
    view.detect();
    // The component focuses in a microtask, after the `@if` has rendered the panel.
    await Promise.resolve();

    expect(document.activeElement?.className).toContain('close');
  });

  /**
   * Focus restore is not a nicety. Without it a keyboard user lands back at the top
   * of the document every time they dismiss a dialog, having lost the place they were
   * working in.
   */
  it('returns focus to whatever opened it', async () => {
    const view = render();
    const opener = view.el<HTMLButtonElement>('#opener');
    // A real click focuses the button first; `.click()` alone does not.
    opener?.focus();
    opener?.click();
    view.detect();
    await Promise.resolve();

    view.el<HTMLButtonElement>('.close')?.click();
    view.detect();

    expect(document.activeElement?.id).toBe('opener');
  });

  it('cycles Tab inside the panel rather than escaping to the page', async () => {
    const view = render();
    view.open.set(true);
    view.detect();
    await Promise.resolve();

    const backdrop = view.el<HTMLElement>('.backdrop');
    const last = view.el<HTMLButtonElement>('#last');
    last?.focus();

    const forward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    backdrop?.dispatchEvent(forward);

    // Tab off the last control wraps to the first, rather than to the page behind.
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement?.className).toContain('close');
  });

  it('cycles Shift+Tab backwards from the first control', async () => {
    const view = render();
    view.open.set(true);
    view.detect();
    await Promise.resolve();

    const backdrop = view.el<HTMLElement>('.backdrop');
    view.el<HTMLButtonElement>('.close')?.focus();

    const back = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    backdrop?.dispatchEvent(back);

    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('last');
  });
});
