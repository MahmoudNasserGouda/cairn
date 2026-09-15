import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  collectAnswerTags,
  parseUserRef,
  StackExchangeQuotaError,
  type StackExchangeProfile,
} from '@cairn/stackexchange';
import { stackexchangeToFragment } from '@cairn/profile';
import { ButtonComponent, CardComponent, TagComponent } from '../../ui';
import { ProfileService } from '../profile/profile.service';

type Status = 'idle' | 'looking' | 'found' | 'empty' | 'error';

/**
 * Connecting a Stack Exchange profile (ADR-0035).
 *
 * **The user supplies the id and nothing is guessed.** No matching a GitHub login
 * against a display name, no "is this you?" — attaching a stranger's reputation to
 * someone's profile is a failure with no acceptable version, so the only input is a
 * link they pasted.
 *
 * The review step before committing is ADR-0011's rule, inherited: nothing reaches the
 * profile without confirmation. It earns its place twice over here, because the same
 * screen is where **attribution** happens. CC BY-SA and the API's terms require a link
 * back to the source, and ADR-0035 makes that a condition of shipping rather than a
 * nicety — so the profile being read is named and linked before anything is merged, and
 * the link goes into the profile afterwards.
 *
 * Everything is interpolated, never `innerHTML`: every string here came off a public
 * profile that anyone can edit (SECURITY.md T7).
 */
@Component({
  selector: 'cn-stackexchange-import',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, TagComponent],
  template: `
    <cn-card>
      <h3>Stack Exchange</h3>
      <p class="muted">
        The one source that measures what other developers made of your work, rather than
        how much of it there is. Paste your profile link — we read it the way any visitor
        would, with no sign-in and no access to your account.
      </p>

      <label class="field">
        <span>Your profile link</span>
        <input
          type="text"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          placeholder="stackoverflow.com/users/22656/jon-skeet"
          [value]="entry()"
          (input)="onType($event)"
          (keydown.enter)="look()"
        />
      </label>

      @if (invalid()) {
        <p class="error" role="alert">
          That doesn't look like a Stack Exchange profile link. It should look like
          <code>stackoverflow.com/users/22656/jon-skeet</code> — any site on the network
          works.
        </p>
      }
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }

      <button
        cn-button
        [disabled]="entry().length === 0 || status() === 'looking'"
        (click)="look()"
      >
        {{ status() === 'looking' ? 'Looking…' : 'Look up' }}
      </button>

      @if (status() === 'empty') {
        <p class="muted">
          Nothing to read there — either that profile has no answers yet, or the link
          points at a user who doesn't exist. Nothing was added.
        </p>
      }

      @if (status() === 'found' && found(); as who) {
        <section class="review">
          <p class="who">
            <!-- Attribution, and the reason this screen exists at all. -->
            Found
            <a [href]="who.profileUrl ?? ''" target="_blank" rel="noopener noreferrer">{{
              who.displayName ?? 'this profile'
            }}</a>
            @if (who.reputation !== null) {
              <span class="muted"
                >· {{ who.reputation.toLocaleString() }} reputation</span
              >
            }
          </p>

          @if (who.tags.length === 0) {
            <p class="muted">No answer tags to add.</p>
          } @else {
            <ul class="tags">
              @for (tag of who.tags.slice(0, 12); track tag.tag) {
                <li>
                  <cn-tag source="stackexchange">{{ tag.tag }}</cn-tag>
                  <span class="muted"
                    >{{ tag.answers.toLocaleString() }} answers scoring
                    {{ tag.score.toLocaleString() }}</span
                  >
                </li>
              }
            </ul>
            <p class="muted small">
              Tags we don't recognise as technologies are left out. Content from Stack
              Exchange is licensed CC BY-SA and stays credited to the profile above.
            </p>
          }

          <div class="actions">
            <button cn-button [disabled]="who.tags.length === 0" (click)="confirm()">
              Add to my profile
            </button>
            <button cn-button variant="quiet" (click)="cancel()">Cancel</button>
          </div>
        </section>
      }
    </cn-card>
  `,
  styles: [
    `
      h3 {
        margin: 0 0 var(--space-2);
        font-size: var(--text-base);
      }
      .muted {
        color: var(--fg-muted);
        font-size: var(--text-sm);
      }
      .small {
        font-size: var(--text-xs);
      }
      .field {
        display: grid;
        gap: var(--space-2);
        margin: var(--space-4) 0;
      }
      .field span {
        font-size: var(--text-sm);
        font-weight: var(--weight-medium);
      }
      .field input {
        width: 100%;
        padding: var(--space-3);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-sm);
        background: var(--surface-sunken);
        color: var(--fg);
        font: inherit;
      }
      .field input:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
      .error {
        color: var(--bad);
        font-size: var(--text-sm);
        margin: 0 0 var(--space-3);
      }
      .review {
        margin-top: var(--space-5);
        padding-top: var(--space-5);
        border-top: 1px solid var(--border);
      }
      .who {
        margin: 0 0 var(--space-4);
        font-size: var(--text-sm);
      }
      .who a {
        color: var(--accent);
      }
      .tags {
        list-style: none;
        margin: 0 0 var(--space-4);
        padding: 0;
        display: grid;
        gap: var(--space-2);
      }
      .tags li {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        font-size: var(--text-sm);
      }
      .actions {
        display: flex;
        gap: var(--space-3);
        flex-wrap: wrap;
      }
    `,
  ],
})
export class StackexchangeImportComponent {
  private readonly profile = inject(ProfileService);

  readonly entry = signal('');
  readonly status = signal<Status>('idle');
  readonly error = signal<string | null>(null);
  readonly invalid = signal(false);
  readonly found = signal<StackExchangeProfile | null>(null);

  protected onType(event: Event): void {
    this.entry.set((event.target as HTMLInputElement).value);
    this.invalid.set(false);
    this.error.set(null);
  }

  /** Look the profile up. Reads only what a stranger with a browser could read. */
  async look(): Promise<void> {
    const ref = parseUserRef(this.entry());
    if (ref === null) {
      this.invalid.set(true);
      this.status.set('idle');
      return;
    }
    this.invalid.set(false);
    this.error.set(null);
    this.status.set('looking');
    try {
      const result = await collectAnswerTags(ref);
      this.found.set(result);
      // "Found nobody" and "found someone with no answers" are the same screen for the
      // user, and neither is an error — but neither is "no expertise" either, so the
      // wording says nothing was added rather than reporting a result.
      this.status.set(result.found && result.tags.length > 0 ? 'found' : 'empty');
    } catch (e) {
      this.found.set(null);
      this.status.set('error');
      this.error.set(
        e instanceof StackExchangeQuotaError
          ? // Never "no expertise": the allowance is per IP, so this genuinely means we
            // could not look, which is a different fact from finding nothing.
            `${e.message} Nothing was changed on your profile.`
          : e instanceof Error
            ? e.message
            : 'could not read that profile',
      );
    }
  }

  async confirm(): Promise<void> {
    const result = this.found();
    if (result === null) return;
    await this.profile.apply(
      stackexchangeToFragment(
        {
          userId: result.userId,
          site: result.site,
          displayName: result.displayName,
          profileUrl: result.profileUrl,
          reputation: result.reputation,
          tags: result.tags,
        },
        new Date().toISOString().slice(0, 10),
      ),
    );
    this.cancel();
  }

  cancel(): void {
    this.found.set(null);
    this.status.set('idle');
    this.entry.set('');
  }
}
