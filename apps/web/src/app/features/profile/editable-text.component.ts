import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
  booleanAttribute,
} from '@angular/core';
import type { ProfileSource } from '@cairn/profile';
import {
  ButtonComponent,
  FieldComponent,
  FieldControlDirective,
  TagComponent,
} from '../../ui';

/**
 * One field of the profile, shown with where it came from and editable in place
 * (ADR-0031, ADR-0032).
 *
 * The provenance chip is not decoration. Every value on this page is either something
 * a parser guessed or something the user stated, and those deserve to look different
 * — `docs/design-system.md` calls it "the user outranks the parser". Showing the
 * source also tells someone *which* import to go and fix when a value is wrong.
 *
 * Read mode is a button, not a div with a click handler, so it is reachable and
 * operable from the keyboard without any `tabindex` or `keydown` of our own.
 */
@Component({
  selector: 'cn-editable-text',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, FieldComponent, FieldControlDirective, TagComponent],
  template: `
    @if (editing()) {
      <cn-field [label]="label()" [hint]="hint()">
        @if (multiline()) {
          <textarea
            cn-control
            rows="4"
            [value]="draft()"
            (input)="draft.set(text($event))"
            (keydown.escape)="cancel()"
          ></textarea>
        } @else {
          <input
            cn-control
            type="text"
            [value]="draft()"
            [placeholder]="placeholder()"
            (input)="draft.set(text($event))"
            (keydown.enter)="commit()"
            (keydown.escape)="cancel()"
          />
        }
      </cn-field>
      <div class="actions">
        <button cn-button size="sm" (click)="commit()">Save</button>
        <button cn-button variant="quiet" size="sm" (click)="cancel()">Cancel</button>
      </div>
    } @else {
      <div class="read">
        <span class="label">{{ label() }}</span>
        <button
          type="button"
          class="value"
          [class.is-empty]="value() === ''"
          [attr.aria-label]="'Edit ' + label()"
          (click)="start()"
        >
          {{ value() || placeholder() || 'Not set' }}
        </button>
        @if (source(); as from) {
          <cn-tag [source]="from" [hint]="sourceHint(from)">from</cn-tag>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .read {
        display: grid;
        grid-template-columns: 7.5rem minmax(0, 1fr) auto;
        align-items: baseline;
        gap: var(--space-2) var(--space-3);
        padding: var(--space-1) 0;
      }
      .label {
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      .value {
        font: inherit;
        text-align: left;
        color: var(--fg);
        background: none;
        border: 0;
        border-radius: var(--radius-sm);
        padding: var(--space-1) var(--space-2);
        margin: calc(var(--space-1) * -1) calc(var(--space-2) * -1);
        cursor: text;
        white-space: pre-wrap;
        min-width: 0;
      }
      .value:hover {
        background: var(--surface-sunken);
      }
      .value.is-empty {
        color: var(--fg-subtle);
        font-style: italic;
      }
      .actions {
        display: flex;
        gap: var(--space-2);
        margin-top: var(--space-2);
      }

      @media (max-width: 36rem) {
        .read {
          grid-template-columns: minmax(0, 1fr) auto;
        }
        .label {
          grid-column: 1 / -1;
        }
      }
    `,
  ],
})
export class EditableTextComponent {
  readonly label = input.required<string>();
  readonly value = input('');
  readonly source = input<ProfileSource | null>(null);
  readonly hint = input<string | null>(null);
  readonly placeholder = input('');
  readonly multiline = input(false, { transform: booleanAttribute });

  /** Emits the new value. An empty string means the user cleared the field. */
  readonly changed = output<string>();

  protected readonly editing = signal(false);
  protected readonly draft = signal('');

  protected readonly sourceHint = computed(() => (from: ProfileSource) => {
    const where = {
      manual: 'You typed this. No import will overwrite it.',
      linkedin: 'From your LinkedIn archive.',
      cv: 'Read from your CV.',
      github: 'Inferred from your GitHub account.',
    };
    return where[from];
  })();

  protected start(): void {
    this.draft.set(this.value());
    this.editing.set(true);
  }

  protected commit(): void {
    const next = this.draft();
    this.editing.set(false);
    if (next !== this.value()) this.changed.emit(next);
  }

  protected cancel(): void {
    this.editing.set(false);
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  }
}
