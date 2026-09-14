import { beforeEach, describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withHashLocation } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { SignInDialogService } from '../core/auth/sign-in-dialog.service';
import { ShellComponent } from './shell.component';
import { PRIMARY_NAV, SETTINGS_NAV } from './nav';

/**
 * The shell (ADR-0032), tested for the things a sidebar can get wrong.
 *
 * The layout itself is CSS and is verified in a browser; what is tested here is the
 * structure a screen reader and a keyboard actually meet — landmarks, the current
 * destination, and the sheet that carries what the bottom bar has no room for.
 */

interface Identity {
  readonly provider: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

function render(
  opts: {
    identity?: Identity | null;
    status?: string;
    providers?: readonly string[];
  } = {},
) {
  const identity = opts.identity ?? null;
  let signedOut = 0;
  const shown: number[] = [];

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      // Hash routing, as `app.config.ts` configures it — otherwise every href in
      // this test is `/dashboard` while the app ships `#/dashboard`, and the test
      // would be asserting against a shape that never renders.
      provideRouter([], withHashLocation()),
      {
        provide: AuthService,
        useValue: {
          isSignedIn: signal(identity !== null),
          primaryIdentity: signal(identity),
          status: signal(opts.status ?? (identity ? 'authenticated' : 'anonymous')),
          availableProviders: opts.providers ?? ['github'],
          signOut: () => {
            signedOut++;
          },
        },
      },
      {
        provide: SignInDialogService,
        useValue: {
          open: signal(false),
          show: () => shown.push(1),
          hide: () => undefined,
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(ShellComponent);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;

  const cmp = fixture.componentInstance as unknown as {
    moreOpen: { (): boolean; set(v: boolean): void };
    signInFromSheet(): void;
    signOutFromSheet(): void;
  };

  return {
    fixture,
    cmp,
    host,
    text: (): string => (host.textContent ?? '').replace(/\s+/g, ' ').trim(),
    all: (selector: string): Element[] => Array.from(host.querySelectorAll(selector)),
    el: <T extends Element>(selector: string): T | null =>
      host.querySelector<T>(selector),
    signedOut: () => signedOut,
    shown: () => shown.length,
    detect: (): void => fixture.detectChanges(),
  };
}

beforeEach(() => TestBed.resetTestingModule());

describe('landmarks and the keyboard entry point', () => {
  it('puts a skip link ahead of the navigation, pointing at the one main landmark', () => {
    const view = render();
    const skip = view.el<HTMLAnchorElement>('.skip-link');
    const main = view.el<HTMLElement>('main');

    expect(skip?.getAttribute('href')).toBe('#main');
    expect(main?.id).toBe('main');
    expect(view.all('main')).toHaveLength(1);
    // Ahead of the nav in DOM order, or it is not a skip link.
    expect(skip?.compareDocumentPosition(view.el('nav') as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  /**
   * `main` is focusable only so the skip link can land on it — a jump that moves the
   * viewport but not focus leaves the next Tab back at the top of the page.
   */
  it('lets the skip link actually land somewhere', () => {
    expect(render().el('main')?.getAttribute('tabindex')).toBe('-1');
  });
});

describe('navigation', () => {
  it('renders every primary destination in the sidebar and the bottom bar', () => {
    const view = render();

    for (const item of PRIMARY_NAV) {
      // Scoped to the navs: the brand also links to /dashboard, and counting that
      // would make this test pass for the wrong reason.
      const links = view.all(`nav a[href="#${item.path}"]`);
      // One in each nav — they are the same list rendered twice, and only one is ever
      // displayed. A destination in one and not the other is the bug this catches.
      expect(links.length, item.label).toBe(2);
    }
  });

  it('explains each destination, which a top bar had no room for', () => {
    const text = render().text();

    for (const item of PRIMARY_NAV) {
      expect(text).toContain(item.label);
      expect(text).toContain(item.hint);
    }
  });

  it('keeps Settings out of the primary list', () => {
    const view = render();

    expect(view.el(`nav.primary a[href="#${SETTINGS_NAV.path}"]`)).toBeNull();
    expect(view.el(`a.settings[href="#${SETTINGS_NAV.path}"]`)).not.toBeNull();
    // And out of the bottom bar's four slots.
    expect(view.el(`.bottombar a[href="#${SETTINGS_NAV.path}"]`)).toBeNull();
  });

  it('hides the mark and icons from assistive technology', () => {
    const view = render();
    const decorative = view.all('svg');

    expect(decorative.length).toBeGreaterThan(0);
    for (const svg of decorative) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('the account area', () => {
  it('offers sign-in when nobody is signed in', () => {
    const view = render();

    expect(view.text()).toContain('Sign in');
    expect(view.text()).not.toContain('Sign out');
  });

  it('shows who is signed in, and how to leave', () => {
    const view = render({
      identity: { provider: 'github', displayName: 'Amara Okonkwo', avatarUrl: null },
    });

    expect(view.text()).toContain('Amara Okonkwo');
    expect(view.text()).toContain('Sign out');
  });

  it('says so plainly when sign-in is not configured at all', () => {
    // A developer running this without OAuth client ids gets an explanation, not a
    // button that cannot work.
    const view = render({ providers: [] });

    expect(view.text()).toContain('not configured');
    expect(view.text()).not.toContain('Sign in');
  });

  it('reports an in-flight sign-in as a live region', () => {
    const view = render({ status: 'authenticating' });

    expect(view.el('[role="status"]')?.textContent).toContain('Signing in');
  });
});

describe('the More sheet', () => {
  it('stays shut until asked', () => {
    expect(render().el('[role="dialog"]')).toBeNull();
  });

  it('carries what the bottom bar has no room for', () => {
    const view = render({
      identity: { provider: 'github', displayName: 'Amara Okonkwo', avatarUrl: null },
    });
    view.cmp.moreOpen.set(true);
    view.detect();

    const sheet = view.el('[role="dialog"]');
    expect(sheet?.textContent).toContain('Settings');
    expect(sheet?.textContent).toContain('Sign out');
  });

  /**
   * Two modals at once is a focus trap fighting a focus trap: whichever installs
   * second takes the keyboard, and Escape closes the wrong one.
   */
  it('closes itself before opening the sign-in dialog', () => {
    const view = render();
    view.cmp.moreOpen.set(true);
    view.detect();

    view.cmp.signInFromSheet();

    expect(view.cmp.moreOpen()).toBe(false);
    expect(view.shown()).toBe(1);
  });

  it('closes itself when signing out from inside it', () => {
    const view = render({
      identity: { provider: 'github', displayName: 'Amara', avatarUrl: null },
    });
    view.cmp.moreOpen.set(true);
    view.detect();

    view.cmp.signOutFromSheet();

    expect(view.cmp.moreOpen()).toBe(false);
    expect(view.signedOut()).toBe(1);
  });
});
