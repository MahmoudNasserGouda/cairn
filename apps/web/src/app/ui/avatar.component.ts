import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';

/** "Amara Okonkwo" → "AO"; "amara" → "AM". Never more than two letters. */
function initialsOf(name: string): string {
  const words = name
    .split(/[\s._-]+/)
    .map((word) => word.trim())
    .filter((word) => word !== '');

  if (words.length === 0) return '?';
  const first = words[0] as string;
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first[0] ?? ''}${(words[words.length - 1] as string)[0] ?? ''}`.toUpperCase();
}

/**
 * An avatar, with initials when the image does not arrive (ADR-0032).
 *
 * The fallback is not defensive decoration. `img-src` allows `'self'`, `data:` and
 * `avatars.githubusercontent.com` and nothing else
 * ([ADR-0019](../../../../docs/adr/0019-security-first-rendering.md)), so an avatar URL
 * from any other provider is **blocked by policy** and will never load. LinkedIn and
 * Google identities therefore always land on initials, by design — and a broken-image
 * icon where a person's face should be is the kind of detail that makes an interface
 * feel unfinished.
 */
@Component({
  selector: 'cn-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (src() && !failed()) {
      <img
        [src]="src()"
        alt=""
        [width]="pixels()"
        [height]="pixels()"
        loading="lazy"
        decoding="async"
        (error)="failed.set(true)"
      />
    } @else {
      <span class="initials" aria-hidden="true">{{ initials() }}</span>
    }
  `,
  host: {
    '[class]': "'size-' + size()",
    '[style.--avatar-size.px]': 'pixels()',
    // The name is on the label, not the image, so one accessible name covers both the
    // photo and the initials fallback.
    role: 'img',
    '[attr.aria-label]': 'name()',
  },
  styles: [
    `
      :host {
        /* Overridden by the host binding; declared here so the component still
           renders at a sane size if that binding is ever lost. */
        --avatar-size: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        width: var(--avatar-size);
        height: var(--avatar-size);
        border-radius: var(--radius-full);
        overflow: hidden;
        background: var(--accent-soft);
        color: var(--accent);
        border: 1px solid var(--border);
        font-weight: var(--weight-semibold);
        line-height: 1;
        user-select: none;
      }
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      :host(.size-sm) .initials {
        font-size: var(--text-xs);
      }
      :host(.size-md) .initials {
        font-size: var(--text-sm);
      }
      :host(.size-lg) .initials {
        font-size: var(--text-xl);
      }
    `,
  ],
})
export class AvatarComponent {
  readonly name = input.required<string>();
  readonly src = input<string | null | undefined>(null);
  readonly size = input<'sm' | 'md' | 'lg'>('md');

  protected readonly failed = signal(false);
  protected readonly pixels = computed(() => ({ sm: 24, md: 36, lg: 64 })[this.size()]);
  protected readonly initials = computed(() => initialsOf(this.name()));
}
