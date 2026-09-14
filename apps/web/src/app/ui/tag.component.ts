import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** The four sources a profile field can come from (ADR-0031). */
export type TagSource = 'github' | 'linkedin' | 'cv' | 'manual';
export type TagTone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';

/** How each source is written when it appears as a label. */
const SOURCE_LABEL: Readonly<Record<TagSource, string>> = {
  github: 'GitHub',
  linkedin: 'LinkedIn',
  cv: 'CV',
  manual: 'you',
};

/**
 * A skill, topic or source chip (ADR-0032).
 *
 * The provenance variant is the interesting one. Give it a `source` and it paints
 * itself in that source's colour — consistently, everywhere a source appears — and
 * names the source in its accessible label. Colour is never the only signal
 * (`docs/design-system.md`): the source is also written out, because "the blue one
 * means you typed it" is not something anyone should have to learn.
 *
 * `manual` is the accent, because a typed value outranks every import and the
 * interface should show that without a sentence explaining it.
 */
@Component({
  selector: 'cn-tag',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-content />
    @if (source(); as from) {
      <span class="src">{{ label(from) }}</span>
    }
  `,
  host: {
    '[class]': 'classes()',
    '[attr.title]': 'hint()',
  },
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-1) var(--space-3);
        border: 1px solid var(--border);
        border-radius: var(--radius-full);
        font-size: var(--text-xs);
        line-height: 1.4;
        color: var(--fg-muted);
        background: var(--surface);
        max-width: 100%;
      }
      .src {
        font-size: var(--text-xs);
        color: var(--chip, var(--fg-subtle));
        border-left: 1px solid var(--border);
        padding-left: var(--space-2);
        white-space: nowrap;
      }

      :host(.has-source) {
        color: var(--fg);
        border-color: color-mix(in srgb, var(--chip) 40%, var(--border));
        background: color-mix(in srgb, var(--chip) 8%, var(--surface));
      }
      :host(.src-github) {
        --chip: var(--src-github);
      }
      :host(.src-linkedin) {
        --chip: var(--src-linkedin);
      }
      :host(.src-cv) {
        --chip: var(--src-cv);
      }
      :host(.src-manual) {
        --chip: var(--src-manual);
      }

      :host(.tone-accent) {
        color: var(--accent);
        border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
        background: var(--accent-soft);
      }
      :host(.tone-good) {
        color: var(--good);
        border-color: color-mix(in srgb, var(--good) 40%, var(--border));
      }
      :host(.tone-warn) {
        color: var(--warn);
        border-color: color-mix(in srgb, var(--warn) 40%, var(--border));
      }
      :host(.tone-bad) {
        color: var(--bad);
        border-color: color-mix(in srgb, var(--bad) 40%, var(--border));
      }
    `,
  ],
})
export class TagComponent {
  /** Paints the chip in this source's colour and names it. */
  readonly source = input<TagSource | null>(null);
  readonly tone = input<TagTone>('neutral');
  /** Extra context on hover — never the only place something important is said. */
  readonly hint = input<string | null>(null);

  protected readonly classes = computed(() => {
    const source = this.source();
    return [
      source ? `has-source src-${source}` : '',
      this.tone() !== 'neutral' ? `tone-${this.tone()}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  });

  protected label(source: TagSource): string {
    return SOURCE_LABEL[source];
  }
}
