import { describe, expect, it } from 'vitest';
import { Component, input, model } from '@angular/core';
import { TestBed } from '@angular/core/testing';

/**
 * The test harness itself, under test.
 *
 * This exists because of a failure that cost an hour and would have cost the next
 * person the same. Without the Angular compiler in the Vite pipeline, Vitest runs
 * Angular in pure JIT — which learns a component's inputs from decorator metadata, so
 * **signal inputs (`input()`, `model()`) do not bind at all**. Not an error, not a
 * warning: the input keeps its default value and the component renders exactly as if
 * the caller had passed nothing. `componentRef.setInput` fails the same silent way.
 *
 * It was invisible until ADR-0032's `cn-*` library, because until then no component in
 * this app had ever taken an input from a parent template — everything was
 * service-driven. A component library is nothing but inputs.
 *
 * The fix has two halves, and **both** are easy to undo by accident:
 *
 * 1. `@analogjs/vite-plugin-angular` in the `app` project's `plugins`
 *    (`vitest.config.ts`).
 * 2. `tsconfig.vitest.json` with **`noEmit: false`**. Our base config sets
 *    `noEmit: true`, which is right for a typecheck and leaves the Angular compiler
 *    with nothing to emit — the plugin then produces no component definitions, and
 *    signal inputs go quiet again.
 *
 * If these ever fail, that is the cause. They are not testing Angular; they are
 * testing that our own build wiring still reaches it.
 */

@Component({ selector: 'x-probe', standalone: true, template: `{{ value() }}` })
class Probe {
  readonly value = input('unset');
}

@Component({ selector: 'x-two-way', standalone: true, template: `{{ open() }}` })
class TwoWay {
  readonly open = model(false);
}

@Component({
  standalone: true,
  imports: [Probe],
  template: `<x-probe value="bound" />`,
})
class Host {}

describe('the Angular compiler is in the Vitest pipeline', () => {
  it('binds a signal input from a template attribute', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toBe('bound');
  });

  it('binds a signal input through componentRef.setInput', () => {
    const fixture = TestBed.createComponent(Probe);
    fixture.componentRef.setInput('value', 'bound');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toBe('bound');
  });

  it('binds a two-way model', () => {
    const fixture = TestBed.createComponent(TwoWay);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toBe('true');
  });
});
