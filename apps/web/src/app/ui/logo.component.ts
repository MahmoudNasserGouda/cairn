import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

let nextLogoId = 0;

/**
 * The cairn mark (ADR-0032, `brand/README.md`).
 *
 * Rujoom (رجوم) is the Arabic word for cairns — the stacked stones that mark a trail
 * for whoever comes next. Four stones, alternating tilt, the brand gradient
 * `#8FB4FA → #3E68C0`, and a white hairline at 18% so they separate without an
 * outline. The geometry is `brand/mark.svg`, not an approximation of it.
 *
 * One component rather than a copy per place it appears: the shell and every empty
 * state draw the same mark, and two hand-copied versions would drift the first time
 * one of them was nudged.
 *
 * The gradient gets a per-instance id. Two SVGs sharing one `id` in a document is not
 * a rendering problem here — the definitions are identical — but it is the kind of
 * thing that silently stops being true.
 */
@Component({
  selector: 'cn-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 64 64"
      [attr.width]="pixels()"
      [attr.height]="pixels()"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          [id]="gradientId"
          x1="32"
          y1="6"
          x2="32"
          y2="58"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stop-color="var(--stone-400)" />
          <stop offset="1" stop-color="var(--stone-700)" />
        </linearGradient>
      </defs>
      <g stroke="#ffffff" stroke-opacity="0.18" stroke-width="1" [attr.fill]="fill()">
        <rect
          x="12"
          y="44"
          width="40"
          height="13"
          rx="6.5"
          transform="rotate(-4 32 50.5)"
        />
        <rect x="16" y="31" width="32" height="12" rx="6" transform="rotate(5 32 37)" />
        <rect
          x="20"
          y="20"
          width="24"
          height="11"
          rx="5.5"
          transform="rotate(-5 32 25.5)"
        />
        <rect x="24" y="9" width="16" height="10" rx="5" transform="rotate(6 32 14)" />
      </g>
    </svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      svg {
        display: block;
      }
    `,
  ],
})
export class LogoComponent {
  readonly size = input(24);
  /**
   * Draw in one flat colour instead of the gradient.
   *
   * For places where the mark is decoration rather than identity — an empty state
   * sitting inside a card — and full brand colour would pull the eye away from the
   * thing the user is supposed to do next.
   */
  readonly flat = input<string | null>(null);

  protected readonly gradientId = `cn-logo-${nextLogoId++}`;
  protected readonly pixels = computed(() => this.size());
  protected readonly fill = computed(() => this.flat() ?? `url(#${this.gradientId})`);
}
