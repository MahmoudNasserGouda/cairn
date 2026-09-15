import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { collectArticles, parseDevtoUsername, type DevtoProfile } from '@cairn/devto';
import { devtoToFragment } from '@cairn/profile';
import { ButtonComponent, CardComponent, TagComponent } from '../../ui';
import { ProfileService } from '../profile/profile.service';

type Status = 'idle' | 'looking' | 'found' | 'empty' | 'error';

/**
 * Connecting a dev.to profile (ADR-0036).
 *
 * The smallest importer in the app, and deliberately the least ambitious. It adds
 * **interests only** — writing about a technology is evidence of interest, not of
 * competence — and the review screen says so plainly, because a list of a user's own
 * articles looks like it is about to become a portfolio and it is not.
 *
 * Articles are shown here and nowhere else in the product. Reaction and comment counts
 * are shown beside them and go no further: popularity is not a signal this product
 * scores on (ADR-0017 settled the equivalent question for sponsorship).
 *
 * Everything is interpolated, never `innerHTML`. Every string here came off a public
 * feed anyone can publish to (SECURITY.md T7), and `url` reaches an `href` — which is
 * why the reader keeps only `https://dev.to` links.
 */
@Component({
  selector: 'cn-devto-import',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, CardComponent, TagComponent],
  template: `
    <cn-card>
      <h3>dev.to</h3>
      <p class="muted">
        What you write about, which is not the same as what you are good at — so this adds
        <strong>interests only</strong>, never skills. Interests help us find projects
        worth your time; they never change a match score.
      </p>

      <label class="field">
        <span>Your dev.to username</span>
        <input
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="amara_okonkwo"
          [value]="entry()"
          (input)="onType($event)"
          (keydown.enter)="look()"
        />
      </label>

      @if (invalid()) {
        <p class="error" role="alert">
          That doesn't look like a dev.to username. Just the name — or paste your profile
          link.
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
          No published articles found for that username. Nothing was added.
        </p>
      }

      @if (status() === 'found' && found(); as who) {
        <section class="review">
          <p class="who">
            <a [href]="who.profileUrl" target="_blank" rel="noopener noreferrer"
              >dev.to/{{ who.username }}</a
            >
            <span class="muted">· {{ who.articles.length }} articles read</span>
          </p>

          @if (tags().length === 0) {
            <p class="muted">
              None of the tags on these articles are technologies we recognise, so there
              is nothing to add. Tags like <code>discuss</code> and
              <code>watercooler</code> are left out.
            </p>
          } @else {
            <p class="label">Interests this would add</p>
            <p class="tags">
              @for (tag of tags(); track tag) {
                <cn-tag source="devto">{{ tag }}</cn-tag>
              }
            </p>
          }

          <p class="label">Articles we read</p>
          <ul class="articles">
            @for (article of who.articles.slice(0, 8); track article.url) {
              <li>
                <a [href]="article.url" target="_blank" rel="noopener noreferrer">{{
                  article.title
                }}</a>
                <span class="muted"
                  >{{ article.reactions }} reactions ·
                  {{ article.comments }} comments</span
                >
              </li>
            }
          </ul>
          <p class="muted small">
            Article titles and counts are shown here only. They are not added to your
            profile, and reactions never affect a score.
          </p>

          <div class="actions">
            <button cn-button [disabled]="tags().length === 0" (click)="confirm()">
              Add these interests
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
      .label {
        margin: var(--space-4) 0 var(--space-2);
        font-size: var(--text-sm);
        font-weight: var(--weight-medium);
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
        margin: 0;
        font-size: var(--text-sm);
        display: flex;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .who a,
      .articles a {
        color: var(--accent);
      }
      .tags {
        margin: 0;
        display: flex;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .articles {
        list-style: none;
        margin: 0 0 var(--space-3);
        padding: 0;
        display: grid;
        gap: var(--space-2);
      }
      .articles li {
        display: grid;
        gap: 2px;
        font-size: var(--text-sm);
      }
      .actions {
        display: flex;
        gap: var(--space-3);
        flex-wrap: wrap;
        margin-top: var(--space-4);
      }
    `,
  ],
})
export class DevtoImportComponent {
  private readonly profile = inject(ProfileService);

  readonly entry = signal('');
  readonly status = signal<Status>('idle');
  readonly error = signal<string | null>(null);
  readonly invalid = signal(false);
  readonly found = signal<DevtoProfile | null>(null);

  /**
   * The interests this would actually add — computed by running the real mapper, not by
   * listing the raw tags.
   *
   * Showing `tag_list` instead would promise things the taxonomy then silently drops,
   * which is the kind of small dishonesty that makes a user stop trusting the rest.
   */
  readonly tags = signal<readonly string[]>([]);

  protected onType(event: Event): void {
    this.entry.set((event.target as HTMLInputElement).value);
    this.invalid.set(false);
    this.error.set(null);
  }

  async look(): Promise<void> {
    const username = parseDevtoUsername(this.entry());
    if (username === null) {
      this.invalid.set(true);
      this.status.set('idle');
      return;
    }
    this.invalid.set(false);
    this.error.set(null);
    this.status.set('looking');
    try {
      const result = await collectArticles(username);
      this.found.set(result);
      this.tags.set((devtoToFragment(result, today()).interests ?? []).map((i) => i.tag));
      this.status.set(result.articles.length > 0 ? 'found' : 'empty');
    } catch (e) {
      this.found.set(null);
      this.tags.set([]);
      this.status.set('error');
      this.error.set(e instanceof Error ? e.message : 'could not read that profile');
    }
  }

  async confirm(): Promise<void> {
    const result = this.found();
    if (result === null) return;
    await this.profile.apply(devtoToFragment(result, today()));
    this.cancel();
  }

  cancel(): void {
    this.found.set(null);
    this.tags.set([]);
    this.status.set('idle');
    this.entry.set('');
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
