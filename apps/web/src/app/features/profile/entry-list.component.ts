import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type { ProfileSource } from '@cairn/profile';
import {
  ButtonComponent,
  EmptyStateComponent,
  FieldComponent,
  FieldControlDirective,
  SheetComponent,
  TagComponent,
  yearRange,
} from '../../ui';

/** One input on the entry form. */
export interface EntryField {
  readonly key: string;
  readonly label: string;
  readonly type: 'text' | 'textarea' | 'year' | 'year-or-present' | 'lines';
  readonly hint?: string;
  readonly placeholder?: string;
  readonly optional?: boolean;
}

/** A row, as the list renders it. The section maps its own model into this. */
export interface EntryRow {
  readonly key: string;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly startYear?: number | undefined;
  readonly endYear?: number | 'present' | undefined;
  readonly detail?: string | undefined;
  readonly bullets?: readonly string[] | undefined;
  readonly source: ProfileSource;
  /** The form's values for this row, keyed by `EntryField.key`. */
  readonly draft: Readonly<Record<string, string>>;
}

export interface EntrySaved {
  readonly values: Readonly<Record<string, string>>;
  /** The identity being replaced, or undefined for a new entry. */
  readonly replaces?: string | undefined;
}

/**
 * A list of profile entries, editable in place (ADR-0032).
 *
 * One component for roles, degrees, projects, certifications and languages, because
 * they are the same interaction five times: read the rows, open a form, save or
 * remove. Five hand-written copies would drift, and the fifth would be the one
 * missing the confirm-before-delete.
 *
 * What it deliberately does **not** own is meaning. The section above it maps its own
 * model into `EntryRow` and turns the saved values back into a `ProfileEdit` — so
 * "what is a role" stays in the section that knows, and this file only knows about
 * rows and fields.
 */
@Component({
  selector: 'cn-entry-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    FieldComponent,
    FieldControlDirective,
    SheetComponent,
    TagComponent,
  ],
  template: `
    @if (rows().length) {
      <ol class="rows">
        @for (row of rows(); track row.key) {
          <li>
            <div class="when">{{ range(row) || '—' }}</div>
            <div class="what">
              <p class="title">
                {{ row.title }}
                <cn-tag [source]="row.source">from</cn-tag>
              </p>
              @if (row.subtitle) {
                <p class="subtitle">{{ row.subtitle }}</p>
              }
              @if (row.detail) {
                <p class="detail">{{ row.detail }}</p>
              }
              @if (row.bullets?.length) {
                <ul class="bullets">
                  @for (bullet of row.bullets; track $index) {
                    <li>{{ bullet }}</li>
                  }
                </ul>
              }
            </div>
            <div class="row-actions">
              <button cn-button variant="quiet" size="sm" (click)="startEdit(row)">
                Edit
              </button>
              <button cn-button variant="quiet" size="sm" (click)="confirming.set(row)">
                Remove
              </button>
            </div>
          </li>
        }
      </ol>
    } @else {
      <cn-empty-state [headline]="emptyHeadline()" [detail]="emptyDetail()" compact>
        <button cn-button size="sm" (click)="startAdd()">{{ addLabel() }}</button>
      </cn-empty-state>
    }

    @if (rows().length) {
      <div class="add">
        <button cn-button variant="ghost" size="sm" (click)="startAdd()">
          {{ addLabel() }}
        </button>
      </div>
    }

    <cn-sheet [(open)]="formOpen" [heading]="editing() ? editLabel() : addLabel()">
      <div class="form">
        @for (field of fields(); track field.key) {
          <cn-field
            [label]="field.label"
            [hint]="field.hint ?? null"
            [optional]="field.optional ?? false"
          >
            @if (field.type === 'textarea' || field.type === 'lines') {
              <textarea
                cn-control
                rows="4"
                [value]="draft()[field.key] ?? ''"
                [placeholder]="field.placeholder ?? ''"
                (input)="set(field.key, $event)"
              ></textarea>
            } @else {
              <input
                cn-control
                [type]="field.type === 'year' ? 'text' : 'text'"
                [value]="draft()[field.key] ?? ''"
                [placeholder]="field.placeholder ?? ''"
                (input)="set(field.key, $event)"
              />
            }
          </cn-field>
        }
      </div>

      <div slot="footer">
        <button cn-button variant="quiet" (click)="formOpen.set(false)">Cancel</button>
        <button cn-button [disabled]="!valid()" (click)="save()">Save</button>
      </div>
    </cn-sheet>

    @if (confirming(); as row) {
      <cn-sheet
        [open]="true"
        (openChange)="confirming.set(null)"
        heading="Remove this entry?"
      >
        <p class="confirm">
          <strong>{{ row.title }}</strong>
          @if (row.subtitle) {
            · {{ row.subtitle }}
          }
        </p>
        <p class="confirm muted">
          It stays removed — re-importing the source it came from will not bring it back.
        </p>
        <div slot="footer">
          <button cn-button variant="quiet" (click)="confirming.set(null)">
            Keep it
          </button>
          <button cn-button variant="danger" (click)="confirmRemove(row)">Remove</button>
        </div>
      </cn-sheet>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .rows {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--space-4);
      }
      .rows > li {
        display: grid;
        grid-template-columns: 7rem minmax(0, 1fr) auto;
        gap: var(--space-3);
        align-items: start;
      }
      .when {
        font-size: var(--text-xs);
        color: var(--fg-subtle);
        padding-top: 0.2rem;
        text-align: right;
        white-space: nowrap;
      }
      .what {
        min-width: 0;
      }
      .title {
        margin: 0;
        font-weight: var(--weight-medium);
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .subtitle,
      .detail {
        margin: var(--space-1) 0 0;
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      .detail {
        color: var(--fg-subtle);
      }
      .bullets {
        margin: var(--space-2) 0 0;
        padding-left: var(--space-4);
        display: grid;
        gap: var(--space-1);
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      .row-actions {
        display: flex;
        gap: var(--space-1);
      }
      .add {
        margin-top: var(--space-4);
      }
      .form {
        display: grid;
        gap: var(--space-4);
      }
      .confirm {
        margin: 0 0 var(--space-2);
      }
      .confirm.muted {
        color: var(--fg-muted);
        font-size: var(--text-sm);
      }

      @media (max-width: 40rem) {
        .rows > li {
          grid-template-columns: minmax(0, 1fr);
          gap: var(--space-1);
        }
        .when {
          text-align: left;
        }
        .row-actions {
          margin-top: var(--space-1);
        }
      }
    `,
  ],
})
export class EntryListComponent {
  readonly rows = input.required<readonly EntryRow[]>();
  readonly fields = input.required<readonly EntryField[]>();
  readonly addLabel = input('Add an entry');
  readonly editLabel = input('Edit entry');
  readonly emptyHeadline = input('Nothing here yet');
  readonly emptyDetail = input<string | null>(null);
  /** Keys that must be filled in before Save is offered. */
  readonly requiredKeys = input<readonly string[]>([]);

  readonly saved = output<EntrySaved>();
  readonly removed = output<string>();

  protected readonly formOpen = signal(false);
  protected readonly editing = signal<EntryRow | null>(null);
  protected readonly draft = signal<Record<string, string>>({});
  protected readonly confirming = signal<EntryRow | null>(null);

  protected readonly valid = computed(() => {
    const values = this.draft();
    return this.requiredKeys().every((key) => (values[key] ?? '').trim() !== '');
  });

  protected startAdd(): void {
    this.editing.set(null);
    this.draft.set({});
    this.formOpen.set(true);
  }

  protected startEdit(row: EntryRow): void {
    this.editing.set(row);
    this.draft.set({ ...row.draft });
    this.formOpen.set(true);
  }

  protected set(key: string, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.draft.update((current) => ({ ...current, [key]: value }));
  }

  protected save(): void {
    if (!this.valid()) return;
    const replaces = this.editing()?.key;
    this.formOpen.set(false);
    this.saved.emit({ values: this.draft(), ...(replaces ? { replaces } : {}) });
  }

  /**
   * Removal asks first, and says what it means.
   *
   * Not politeness: a removal leaves a tombstone, so re-importing the CV it came from
   * will *not* bring it back. That is the right behaviour — otherwise the user deletes
   * the same entry after every import — but it makes an accidental click expensive
   * enough to be worth one question.
   */
  protected confirmRemove(row: EntryRow): void {
    this.confirming.set(null);
    this.removed.emit(row.key);
  }

  protected range(row: EntryRow): string {
    return yearRange(row.startYear, row.endYear);
  }
}
