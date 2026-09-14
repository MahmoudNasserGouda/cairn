import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { canonicalizeSkill, isKnownSkill, type ProfileSkill } from '@cairn/profile';
import { KNOWN_SKILLS, type SkillTag } from '@cairn/shared';
import { ProfileService } from '../../../core/profile/profile.service';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  FieldComponent,
  FieldControlDirective,
  SectionComponent,
  SheetComponent,
  TagComponent,
} from '../../../ui';

@Component({
  selector: 'cn-profile-skills',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    FieldComponent,
    FieldControlDirective,
    SectionComponent,
    SheetComponent,
    TagComponent,
  ],
  template: `
    <cn-section
      heading="Skills"
      description="What the matching engine scores you against. Every one shows where it
        came from, and what every other source said about it."
    >
      <button
        cn-button
        variant="ghost"
        size="sm"
        slot="actions"
        (click)="adding.set(true)"
      >
        Add a skill
      </button>

      @if (skills().length) {
        <ul class="skills">
          @for (skill of skills(); track skill.tag) {
            <li>
              <cn-card padding="sm">
                <div class="head">
                  <span class="tag">{{ skill.tag }}</span>
                  <cn-tag [source]="skill.from.source">from</cn-tag>
                  <span class="level">{{ percent(skill) }}%</span>
                </div>

                <label class="slider">
                  <span class="sr-only">Level for {{ skill.tag }}</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    [value]="percent(skill)"
                    (change)="setLevel(skill.tag, $event)"
                  />
                </label>

                @if (skill.evidence.length) {
                  <ul class="evidence">
                    @for (e of skill.evidence; track e.source) {
                      <li>
                        <strong>{{ e.source }}</strong>
                        {{ round(e.level) }}%
                        @if (e.note) {
                          — {{ e.note }}
                        }
                      </li>
                    }
                  </ul>
                }

                <button cn-button variant="quiet" size="sm" (click)="remove(skill.tag)">
                  I don't have this
                </button>
              </cn-card>
            </li>
          }
        </ul>
      } @else {
        <cn-empty-state
          headline="No skills yet"
          detail="Connect GitHub to measure them from your code, import a CV, or add one
            yourself."
        >
          <button cn-button (click)="adding.set(true)">Add a skill</button>
        </cn-empty-state>
      }
    </cn-section>

    <cn-sheet [(open)]="adding" heading="Add a skill">
      <cn-field
        label="Technology"
        hint="Rujoom scores against a fixed vocabulary, so it only accepts names it can
          match on."
        [error]="error()"
      >
        <input
          cn-control
          type="text"
          list="cn-known-skills"
          [value]="draft()"
          (input)="setDraft($event)"
          (keydown.enter)="add()"
          placeholder="typescript"
        />
      </cn-field>
      <datalist id="cn-known-skills">
        @for (tag of known; track tag) {
          <option [value]="tag"></option>
        }
      </datalist>

      <div slot="footer">
        <button cn-button variant="quiet" (click)="adding.set(false)">Cancel</button>
        <button cn-button [disabled]="!canAdd()" (click)="add()">Add</button>
      </div>
    </cn-sheet>
  `,
  styles: [
    `
      .skills {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
        gap: var(--space-3);
      }
      .head {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .tag {
        font-weight: var(--weight-medium);
        margin-right: auto;
      }
      .level {
        font-size: var(--text-sm);
        color: var(--fg-muted);
      }
      .slider {
        display: block;
        margin: var(--space-3) 0 var(--space-2);
      }
      .slider input {
        width: 100%;
      }
      .evidence {
        list-style: none;
        margin: 0 0 var(--space-3);
        padding: 0;
        display: grid;
        gap: var(--space-1);
        font-size: var(--text-xs);
        color: var(--fg-subtle);
      }
      .evidence strong {
        font-weight: var(--weight-medium);
        color: var(--fg-muted);
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
    `,
  ],
})
export class SkillsSectionComponent {
  private readonly profile = inject(ProfileService);

  protected readonly known = KNOWN_SKILLS;
  protected readonly adding = signal(false);
  protected readonly draft = signal('');

  protected readonly skills = computed(() => this.profile.profile()?.skills ?? []);

  /**
   * Refused before it is added, not silently dropped afterwards.
   *
   * `toKnownSkills` quietly discards anything outside the taxonomy, which is right for
   * an import — a CV listing "Stakeholder Management" should not fail — but wrong for
   * something a person just typed and expects to see.
   */
  protected readonly error = computed(() => {
    const text = this.draft().trim();
    if (text === '') return null;
    return isKnownSkill(text)
      ? null
      : `Rujoom does not match on "${text}" yet, so adding it would not affect any score.`;
  });

  protected readonly canAdd = computed(
    () => this.draft().trim() !== '' && this.error() === null,
  );

  protected percent(skill: ProfileSkill): number {
    return Math.round(skill.level * 100);
  }

  protected round(level: number): number {
    return Math.round(level * 100);
  }

  protected setDraft(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  protected async add(): Promise<void> {
    if (!this.canAdd()) return;
    const tag = canonicalizeSkill(this.draft().trim());
    this.adding.set(false);
    this.draft.set('');
    // Mid-scale, like a CV's claim: stated rather than measured. The slider is there
    // for anyone who wants to say more.
    await this.profile.edit({ kind: 'skill', tag, level: 0.5 });
  }

  protected async setLevel(tag: SkillTag, event: Event): Promise<void> {
    const percent = Number((event.target as HTMLInputElement).value);
    await this.profile.edit({ kind: 'skill', tag, level: percent / 100 });
  }

  protected async remove(tag: SkillTag): Promise<void> {
    await this.profile.edit({ kind: 'remove-skill', tag });
  }
}
