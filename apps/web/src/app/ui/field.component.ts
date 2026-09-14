import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  Directive,
  computed,
  inject,
  input,
} from '@angular/core';

let nextFieldId = 0;

/**
 * Label + control + hint + error, correctly associated (ADR-0032).
 *
 * It exists to make the wrong thing hard. A placeholder is not a label: it disappears
 * the moment someone types, which is exactly when they most need to know what they are
 * filling in. So the label is required, and the association is not the caller's to
 * remember.
 *
 *     <cn-field label="Organisation" hint="Where you worked.">
 *       <input cn-control type="text" [value]="org()" (input)="setOrg($event)" />
 *     </cn-field>
 *
 * `cn-control` on the input is the whole wiring: it injects this component and takes
 * its `id`, `aria-describedby` and `aria-invalid` from it. That works because a
 * projected node's element injector follows where it is *written*, not where it lands
 * — so the input can reach the field that wraps it without this component ever
 * touching the DOM. A component that reaches into its own projected children breaks
 * the first time someone wraps a child in an `@if`.
 */
@Component({
  selector: 'cn-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label [attr.for]="controlId()">
      {{ label() }}
      @if (optional()) {
        <span class="optional">optional</span>
      }
    </label>

    <ng-content />

    @if (error(); as message) {
      <p class="error" [id]="errorId()" role="alert">{{ message }}</p>
    } @else if (hint(); as message) {
      <p class="hint" [id]="hintId()">{{ message }}</p>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        min-width: 0;
      }
      label {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        font-size: var(--text-sm);
        font-weight: var(--weight-medium);
        color: var(--fg);
      }
      .optional {
        font-size: var(--text-xs);
        font-weight: var(--weight-normal);
        color: var(--fg-subtle);
      }
      .hint,
      .error {
        margin: 0;
        font-size: var(--text-xs);
      }
      .hint {
        color: var(--fg-subtle);
      }
      .error {
        color: var(--bad);
      }
    `,
  ],
})
export class FieldComponent {
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly optional = input(false, { transform: booleanAttribute });
  /** Override the generated control id. Rarely needed; the default is unique. */
  readonly controlIdOverride = input<string | null>(null, { alias: 'for' });

  private readonly seq = nextFieldId++;

  readonly controlId = computed(() => this.controlIdOverride() ?? `cn-field-${this.seq}`);
  protected readonly hintId = computed(() => `${this.controlId()}-hint`);
  protected readonly errorId = computed(() => `${this.controlId()}-error`);

  /** What the control should announce itself as described by, or nothing. */
  readonly describedBy = computed(() =>
    this.error() !== null
      ? `${this.controlId()}-error`
      : this.hint() !== null
        ? `${this.controlId()}-hint`
        : null,
  );
}

/**
 * Ties a native control to the `cn-field` that labels it.
 *
 * Everything visual about inputs is global (`styles.css`), because an input should
 * look the same whether or not it happens to sit inside a field. This directive is
 * about semantics only: id, description and validity.
 */
@Directive({
  selector: 'input[cn-control], textarea[cn-control], select[cn-control], [cnControl]',
  standalone: true,
  host: {
    '[id]': 'field.controlId()',
    '[attr.aria-describedby]': 'field.describedBy()',
    '[attr.aria-invalid]': "field.error() !== null ? 'true' : null",
  },
})
export class FieldControlDirective {
  protected readonly field = inject(FieldComponent);
}
