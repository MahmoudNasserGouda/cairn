import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  cvRefinementPrompt,
  parseCvRefinement,
  type CvRefinement,
  type CvRefinementRole,
} from '@cairn/ai';
import type { ParsedCv, ParsedRole } from '@cairn/profile';
import { AI_ENABLED } from '../features';
import { AiService } from '../ai/ai.service';
import { AiSettingsService } from '../ai/ai-settings.service';
import { ProfileService } from '../profile/profile.service';
import { CvImportService } from './cv-import.service';
import {
  ButtonComponent,
  CardComponent,
  FieldComponent,
  FieldControlDirective,
  TagComponent,
} from '../../ui';

interface SkillChoice {
  readonly tag: string;
  readonly include: boolean;
}

/** Experience as the form holds it: everything a string, nothing validated yet. */
interface RoleDraft {
  readonly title: string;
  readonly organization: string;
  readonly startYear: string;
  readonly endYear: string;
  readonly include: boolean;
}

const EMPTY_ROLE: RoleDraft = {
  title: '',
  organization: '',
  startYear: '',
  endYear: '',
  include: true,
};

function value(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

function toRole(entry: ParsedRole): RoleDraft {
  return {
    title: entry.title,
    organization: entry.organization ?? '',
    startYear: entry.startYear ? String(entry.startYear) : '',
    endYear: entry.endYear === undefined ? '' : String(entry.endYear),
    include: true,
  };
}

function toEntry(role: RoleDraft): ParsedRole {
  const start = Number.parseInt(role.startYear, 10);
  const end = role.endYear.trim().toLowerCase();
  const endYear = /^(?:present|current|now)$/.test(end)
    ? ('present' as const)
    : Number.parseInt(end, 10);

  return {
    title: role.title.trim() || 'Role',
    ...(role.organization.trim() ? { organization: role.organization.trim() } : {}),
    ...(Number.isFinite(start) ? { startYear: start } : {}),
    ...(endYear === 'present' || Number.isFinite(endYear) ? { endYear } : {}),
  };
}

/**
 * CV import and its mandatory review step (ADR-0011: "nothing is committed to the
 * profile without confirmation").
 *
 * It used to *be* the profile page, with a summary panel bolted underneath. A CV is
 * one of four sources, so it now lives under **Sources** in the profile hub
 * (ADR-0032) alongside the LinkedIn importer it mirrors — and the page that was 773
 * lines is gone.
 *
 * Everything here is interpolated, never `innerHTML`: extracted CV text is untrusted
 * (SECURITY.md T7) and Angular's escaping is the whole defence.
 */
@Component({
  selector: 'cn-cv-import',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ButtonComponent,
    CardComponent,
    FieldComponent,
    FieldControlDirective,
    TagComponent,
  ],
  template: `
    <cn-card>
      <h2>Import a CV</h2>
      <p class="muted">
        PDF, Word (.docx) or plain text, up to {{ maxMb }} MB. The file is read inside a
        sandboxed worker in this tab — it is never uploaded, and the file itself is never
        stored.
      </p>

      <div
        class="drop"
        [class.over]="dragging()"
        (dragover)="onDragOver($event)"
        (dragleave)="dragging.set(false)"
        (drop)="onDrop($event)"
      >
        <input
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,.text"
          (change)="onPick($event)"
        />
        <span class="muted">or drop a file here</span>
      </div>

      @if (cv.busy()) {
        <p class="muted" role="status">Reading your CV…</p>
      }
      @if (cv.error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }

      @if (profileSvc.hasCv() && !review()) {
        <div class="actions">
          <button cn-button variant="quiet" size="sm" (click)="removeCv()">
            Remove imported CV
          </button>
        </div>
      }
    </cn-card>

    @if (review(); as form) {
      <cn-card class="stacked">
        <h2>Check what we read</h2>
        <p class="muted">
          Nothing is added to your profile until you confirm. Uncheck anything the parser
          got wrong.
          @if (cv.draft()?.truncated) {
            <strong>Only the first pages were read.</strong>
          }
        </p>

        <div class="fields">
          <cn-field label="Name">
            <input cn-control type="text" [value]="form.name" (input)="setName($event)" />
          </cn-field>
          <cn-field label="Email" optional>
            <input
              cn-control
              type="email"
              [value]="form.email"
              (input)="setEmail($event)"
            />
          </cn-field>
        </div>

        <h3>Skills</h3>
        <div class="choices">
          @for (skill of form.skills; track skill.tag) {
            <label class="choice">
              <input
                type="checkbox"
                [checked]="skill.include"
                (change)="toggleSkill(skill.tag)"
              />
              {{ skill.tag }}
            </label>
          } @empty {
            <p class="muted">No skills recognised.</p>
          }
        </div>

        <h3>Experience</h3>
        @for (role of form.roles; track $index) {
          <div class="role">
            <input
              type="checkbox"
              [checked]="role.include"
              [attr.aria-label]="'Include ' + (role.title || 'this role')"
              (change)="toggleRole($index)"
            />
            <input
              type="text"
              [value]="role.title"
              aria-label="Title"
              placeholder="Title"
              (input)="setRole($index, 'title', $event)"
            />
            <input
              type="text"
              [value]="role.organization"
              aria-label="Organisation"
              placeholder="Organisation"
              (input)="setRole($index, 'organization', $event)"
            />
            <input
              type="text"
              class="year"
              [value]="role.startYear"
              aria-label="From"
              placeholder="From"
              (input)="setRole($index, 'startYear', $event)"
            />
            <input
              type="text"
              class="year"
              [value]="role.endYear"
              aria-label="To"
              placeholder="To"
              (input)="setRole($index, 'endYear', $event)"
            />
          </div>
        }
        <button cn-button variant="quiet" size="sm" (click)="addRole()">
          Add a role
        </button>

        @if (aiEnabled) {
          <div class="ai">
            @if (aiSettings.hasKey()) {
              <button cn-button variant="ghost" size="sm" (click)="refine()">
                Re-read this CV with AI
              </button>
              <span class="muted">
                Sends the CV text to your own {{ aiSettings.provider() }} key. You'll see
                exactly what goes, and nothing is applied until you accept it.
              </span>
            } @else {
              <p class="muted">
                A parser read this, not a model. Add your own API key under
                <a routerLink="/settings">Settings</a> to have one re-read the CV and
                suggest what the parser missed.
              </p>
            }
            @if (aiError(); as message) {
              <p class="error" role="alert">{{ message }}</p>
            }
          </div>

          @if (proposal()) {
            <div class="proposal">
              <h3>
                Suggestions
                <cn-tag tone="warn">AI-generated · may be wrong</cn-tag>
              </h3>
              @if (newName(); as suggested) {
                <p class="row">
                  <span>Name: {{ suggested }}</span>
                  <button
                    cn-button
                    variant="quiet"
                    size="sm"
                    (click)="acceptName(suggested)"
                  >
                    Use this
                  </button>
                </p>
              }
              @if (newEmail(); as suggested) {
                <p class="row">
                  <span>Email: {{ suggested }}</span>
                  <button
                    cn-button
                    variant="quiet"
                    size="sm"
                    (click)="acceptEmail(suggested)"
                  >
                    Use this
                  </button>
                </p>
              }
              @if (newSkills().length) {
                <p class="muted">Skills the parser missed — tap to add:</p>
                <div class="choices">
                  @for (tag of newSkills(); track tag) {
                    <button
                      cn-button
                      variant="quiet"
                      size="sm"
                      (click)="acceptSkill(tag)"
                    >
                      + {{ tag }}
                    </button>
                  }
                </div>
              }
              @if (newRoles().length) {
                <p class="muted">Roles the parser missed:</p>
                @for (role of newRoles(); track $index) {
                  <p class="row">
                    <span>
                      {{ role.title }}
                      @if (role.organization) {
                        · {{ role.organization }}
                      }
                    </span>
                    <button
                      cn-button
                      variant="quiet"
                      size="sm"
                      (click)="acceptRole(role)"
                    >
                      Add
                    </button>
                  </p>
                }
              }
              @if (nothingNew()) {
                <p class="muted">
                  Nothing new — the model found the same things the parser did.
                </p>
              }
            </div>
          }
        }

        <div class="actions">
          <button cn-button (click)="confirm()">Add to my profile</button>
          <button cn-button variant="quiet" (click)="cancel()">Discard</button>
        </div>
      </cn-card>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .stacked {
        margin-top: var(--space-4);
      }
      h2 {
        margin: 0 0 var(--space-2);
        font-size: var(--text-lg);
      }
      h3 {
        margin: var(--space-5) 0 var(--space-2);
        font-size: var(--text-sm);
        color: var(--fg-muted);
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      .muted {
        color: var(--fg-muted);
        font-size: var(--text-sm);
      }
      .error {
        color: var(--bad);
        font-size: var(--text-sm);
      }
      .drop {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        flex-wrap: wrap;
        border: 1px dashed var(--border-strong);
        border-radius: var(--radius-md);
        padding: var(--space-4);
        margin-top: var(--space-3);
      }
      .drop.over {
        border-color: var(--accent);
        background: var(--accent-soft);
      }
      .fields {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
        gap: var(--space-3);
      }
      .choices {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-4);
      }
      .choice {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-sm);
      }
      .role {
        display: grid;
        grid-template-columns: auto 2fr 2fr 1fr 1fr;
        align-items: center;
        gap: var(--space-2);
        margin-bottom: var(--space-2);
      }
      .role input[type='checkbox'] {
        width: auto;
      }
      .ai,
      .proposal {
        margin-top: var(--space-5);
        padding-top: var(--space-4);
        border-top: 1px solid var(--border);
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        margin: var(--space-2) 0;
        font-size: var(--text-sm);
      }
      .actions {
        display: flex;
        gap: var(--space-2);
        margin-top: var(--space-5);
        flex-wrap: wrap;
      }

      @media (max-width: 40rem) {
        .role {
          grid-template-columns: auto 1fr;
        }
      }
    `,
  ],
})
export class CvImportComponent {
  protected readonly cv = inject(CvImportService);
  protected readonly profileSvc = inject(ProfileService);
  protected readonly ai = inject(AiService);
  protected readonly aiSettings = inject(AiSettingsService);
  /** Frozen off by default; the whole refinement block is absent then (ADR-0033). */
  protected readonly aiEnabled = inject(AI_ENABLED);

  protected readonly dragging = signal(false);
  protected readonly maxMb = Math.round(this.cv.maxBytes / (1024 * 1024));

  private readonly name = signal('');
  private readonly email = signal('');
  private readonly skills = signal<readonly SkillChoice[]>([]);
  private readonly roles = signal<readonly RoleDraft[]>([]);
  private readonly sections = signal<readonly string[]>([]);
  /** What the model proposed, if the user has run a refinement pass. */
  protected readonly proposal = signal<CvRefinement | null>(null);
  protected readonly aiError = signal<string | null>(null);
  /** The draft the form was last seeded from, so a new import reseeds it. */
  private seededFrom: ParsedCv | null = null;

  constructor() {
    // Seeding is a write, so it belongs in an effect rather than in `review`.
    effect(() => {
      const draft = this.cv.draft();
      if (draft) this.seed(draft.parsed);
    });
  }

  protected readonly review = computed(() => {
    if (!this.cv.draft()) return null;
    return {
      name: this.name(),
      email: this.email(),
      skills: this.skills(),
      roles: this.roles(),
      sections: this.sections(),
    };
  });

  protected readonly chosenSkills = computed(() =>
    this.skills().filter((s) => s.include),
  );

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.cv.import(file);
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.cv.import(file);
  }

  protected setName(event: Event): void {
    this.name.set(value(event));
  }

  protected setEmail(event: Event): void {
    this.email.set(value(event));
  }

  protected toggleSkill(tag: string): void {
    this.skills.update((list) =>
      list.map((s) => (s.tag === tag ? { ...s, include: !s.include } : s)),
    );
  }

  protected toggleRole(index: number): void {
    this.roles.update((list) =>
      list.map((r, i) => (i === index ? { ...r, include: !r.include } : r)),
    );
  }

  protected setRole(index: number, field: keyof RoleDraft, event: Event): void {
    const next = value(event);
    this.roles.update((list) =>
      list.map((r, i) => (i === index ? { ...r, [field]: next } : r)),
    );
  }

  protected addRole(): void {
    this.roles.update((list) => [...list, EMPTY_ROLE]);
  }

  protected confirm(): void {
    this.proposal.set(null);
    const name = this.name().trim();
    const email = this.email().trim();
    const parsed: ParsedCv = {
      ...(name ? { name } : {}),
      ...(email ? { email } : {}),
      skills: this.chosenSkills().map((s) => s.tag),
      experience: this.roles()
        .filter((r) => r.include)
        .map(toEntry),
      sections: this.sections(),
    };
    void this.profileSvc.setCv(parsed);
    this.seededFrom = null;
    this.cv.reset();
  }

  protected cancel(): void {
    this.proposal.set(null);
    this.aiError.set(null);
    this.seededFrom = null;
    this.cv.reset();
  }

  protected removeCv(): void {
    void this.profileSvc.clearCv();
  }

  /**
   * Only ever *offer* what the form does not already hold. A suggestion the user
   * accepts disappears from the list because these derive from the form's own state,
   * so there is no separate "accepted" bookkeeping to get out of step.
   */
  protected readonly newSkills = computed<readonly string[]>(() => {
    const suggested = this.proposal()?.skills ?? [];
    const have = new Set(this.skills().map((s) => s.tag));
    return suggested.filter((tag) => !have.has(tag));
  });

  protected readonly newRoles = computed<readonly CvRefinementRole[]>(() => {
    const suggested = this.proposal()?.experience ?? [];
    const have = new Set(this.roles().map((r) => r.title.trim().toLowerCase()));
    return suggested.filter((r) => !have.has(r.title.trim().toLowerCase()));
  });

  protected readonly newName = computed(() => {
    const suggested = this.proposal()?.name;
    return suggested && suggested !== this.name() ? suggested : null;
  });

  protected readonly newEmail = computed(() => {
    const suggested = this.proposal()?.email;
    return suggested && suggested !== this.email() ? suggested : null;
  });

  protected readonly nothingNew = computed(
    () =>
      this.newName() === null &&
      this.newEmail() === null &&
      this.newSkills().length === 0 &&
      this.newRoles().length === 0,
  );

  /**
   * The optional BYOK pass over the CV (ADR-0011). It proposes; the review form still
   * decides. The disclosure panel inside `AiService.run` is what actually sends
   * anything, so a user who cancels there has sent nothing.
   */
  protected async refine(): Promise<void> {
    const draft = this.cv.draft();
    if (!draft) return;
    this.aiError.set(null);

    const outcome = await this.ai.run(
      'Re-reading your CV',
      cvRefinementPrompt(draft.text),
    );
    if (outcome.status === 'declined') return;
    if (outcome.status === 'error') {
      this.aiError.set(outcome.message);
      return;
    }

    const parsed = parseCvRefinement(outcome.text);
    if (!parsed.ok) {
      this.aiError.set(`${parsed.error} — the parsed fields above are unchanged.`);
      return;
    }
    this.proposal.set(parsed.value);
  }

  protected acceptName(name: string): void {
    this.name.set(name);
  }

  protected acceptEmail(email: string): void {
    this.email.set(email);
  }

  protected acceptSkill(tag: string): void {
    this.skills.update((list) => [...list, { tag, include: true }]);
  }

  protected acceptRole(role: CvRefinementRole): void {
    this.roles.update((list) => [
      ...list,
      {
        title: role.title,
        organization: role.organization ?? '',
        startYear: role.startYear === undefined ? '' : String(role.startYear),
        endYear: role.endYear === undefined ? '' : String(role.endYear),
        include: true,
      },
    ]);
  }

  /** Copy a fresh parse into the editable form exactly once per import. */
  private seed(parsed: ParsedCv): void {
    if (this.seededFrom === parsed) return;
    this.seededFrom = parsed;
    this.proposal.set(null);
    this.aiError.set(null);
    this.name.set(parsed.name ?? '');
    this.email.set(parsed.email ?? '');
    this.skills.set(parsed.skills.map((tag) => ({ tag, include: true })));
    this.roles.set(parsed.experience.map(toRole));
    this.sections.set(parsed.sections);
  }
}
