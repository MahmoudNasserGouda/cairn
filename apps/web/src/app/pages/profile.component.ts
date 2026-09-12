import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  cvRefinementPrompt,
  parseCvRefinement,
  type CvRefinement,
  type CvRefinementRole,
} from '@cairn/ai';
import type { ExperienceEntry, ParsedCv } from '@cairn/profile';
import type { SkillProficiency } from '@cairn/shared';
import { AiService } from '../core/ai/ai.service';
import { AiSettingsService } from '../core/ai/ai-settings.service';
import { CvImportService } from '../core/cv/cv-import.service';
import { ProfileService } from '../core/profile/profile.service';

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

function toRole(entry: ExperienceEntry): RoleDraft {
  return {
    title: entry.title,
    organization: entry.organization ?? '',
    startYear: entry.startYear ? String(entry.startYear) : '',
    endYear: entry.endYear === undefined ? '' : String(entry.endYear),
    include: true,
  };
}

function toEntry(role: RoleDraft): ExperienceEntry {
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
    source: 'cv',
  };
}

/**
 * CV import and the mandatory review step (ADR-0011: "nothing is committed to the
 * profile without confirmation"). Everything here is interpolated, never
 * `innerHTML` — extracted CV text is untrusted (SECURITY.md T7) and Angular's
 * escaping is the whole defence.
 */
@Component({
  selector: 'cn-profile',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h1>Your profile</h1>
    <p class="muted">
      Rujoom builds one profile from your GitHub activity and, optionally, your CV.
      Everything below is computed on this device.
    </p>

    <section class="panel">
      <h2>Import a CV</h2>
      <p class="muted small">
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
        <span class="muted small">or drop a file here</span>
      </div>

      @if (cv.busy()) {
        <p class="muted" role="status">Reading your CV…</p>
      }
      @if (cv.error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </section>

    @if (review(); as form) {
      <section class="panel">
        <h2>Check what we read</h2>
        <p class="muted small">
          Nothing is added to your profile until you confirm. Uncheck anything the parser
          got wrong.
          @if (cv.draft()?.truncated) {
            <strong> Only the first pages were read.</strong>
          }
        </p>

        <div class="fields">
          <label>
            Name
            <input type="text" [value]="form.name" (input)="setName($event)" />
          </label>
          <label>
            Email
            <input type="email" [value]="form.email" (input)="setEmail($event)" />
          </label>
        </div>

        <h3>
          Skills <span class="muted small">{{ chosenSkills().length }} selected</span>
        </h3>
        @if (form.skills.length) {
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
            }
          </div>
        } @else {
          <p class="muted small">
            No known technologies matched. You can still keep the roles below.
          </p>
        }

        <h3>Experience</h3>
        @for (role of form.roles; track $index) {
          <div class="role" [class.excluded]="!role.include">
            <input
              type="checkbox"
              [checked]="role.include"
              [attr.aria-label]="'Include ' + (role.title || 'this role')"
              (change)="toggleRole($index)"
            />
            <input
              class="title"
              type="text"
              placeholder="Title"
              [value]="role.title"
              (input)="setRole($index, 'title', $event)"
            />
            <input
              type="text"
              placeholder="Organisation"
              [value]="role.organization"
              (input)="setRole($index, 'organization', $event)"
            />
            <input
              class="year"
              type="text"
              placeholder="From"
              [value]="role.startYear"
              (input)="setRole($index, 'startYear', $event)"
            />
            <input
              class="year"
              type="text"
              placeholder="To / present"
              [value]="role.endYear"
              (input)="setRole($index, 'endYear', $event)"
            />
          </div>
        } @empty {
          <p class="muted small">No dated roles were found — add one below.</p>
        }
        <button type="button" class="ghost" (click)="addRole()">Add a role</button>

        @if (form.sections.length) {
          <p class="muted small">Sections recognised: {{ form.sections.join(', ') }}</p>
        }

        <div class="refine">
          @if (aiSettings.hasKey()) {
            <button
              type="button"
              class="ghost"
              [disabled]="ai.running()"
              (click)="refine()"
            >
              {{ ai.running() ? 'Asking your provider…' : 'Re-read this CV with AI' }}
            </button>
            <span class="muted small">
              Sends the CV text to your own {{ aiSettings.provider() }} key. You'll see
              exactly what goes, and nothing is applied until you accept it.
            </span>
          } @else {
            <p class="muted small">
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
            <h3>Suggestions <span class="ai-tag">AI-generated · may be wrong</span></h3>
            @if (newName(); as suggested) {
              <p class="row">
                <span>Name: {{ suggested }}</span>
                <button type="button" class="tiny" (click)="acceptName(suggested)">
                  Use this
                </button>
              </p>
            }
            @if (newEmail(); as suggested) {
              <p class="row">
                <span>Email: {{ suggested }}</span>
                <button type="button" class="tiny" (click)="acceptEmail(suggested)">
                  Use this
                </button>
              </p>
            }
            @if (newSkills().length) {
              <p class="muted small">Skills the parser missed — tap to add:</p>
              <div class="choices">
                @for (tag of newSkills(); track tag) {
                  <button type="button" class="tiny" (click)="acceptSkill(tag)">
                    + {{ tag }}
                  </button>
                }
              </div>
            }
            @if (newRoles().length) {
              <p class="muted small">Roles the parser missed:</p>
              @for (role of newRoles(); track $index) {
                <p class="row">
                  <span>
                    {{ role.title }}
                    @if (role.organization) {
                      · {{ role.organization }}
                    }
                    @if (role.startYear) {
                      <span class="muted">
                        {{ role.startYear }}–{{ role.endYear ?? '' }}</span
                      >
                    }
                  </span>
                  <button type="button" class="tiny" (click)="acceptRole(role)">
                    Add
                  </button>
                </p>
              }
            }
            @if (nothingNew()) {
              <p class="muted small">
                Nothing new — the model found the same things the parser did.
              </p>
            }
          </div>
        }

        <div class="actions">
          <button type="button" (click)="confirm()">Add to my profile</button>
          <button type="button" class="ghost" (click)="cancel()">Discard</button>
        </div>
      </section>
    }

    <section class="panel">
      <h2>Merged profile</h2>
      @if (profileSvc.loading()) {
        <p class="muted">Loading your GitHub profile…</p>
      }
      @if (profileSvc.error(); as err) {
        <p class="error">Couldn't load your GitHub profile: {{ err }}</p>
      }

      @if (profileSvc.profile(); as p) {
        <p class="sub">
          {{ p.experienceLevel }} · ~{{ p.totalYears }} yrs · {{ p.skills.length }} skills
        </p>
        <div class="tags">
          @for (skill of sortedSkills(); track skill.tag) {
            <span class="tag" [class]="'src-' + skill.source">
              {{ skill.tag }}
              <span class="src">{{ skill.source }}</span>
            </span>
          } @empty {
            <span class="muted">No skills yet.</span>
          }
        </div>
        @if (p.experience.length) {
          <ul class="roles">
            @for (entry of p.experience; track $index) {
              <li>
                {{ entry.title }}
                @if (entry.organization) {
                  · {{ entry.organization }}
                }
                @if (entry.startYear) {
                  <span class="muted">
                    {{ entry.startYear }}–{{ entry.endYear ?? '' }}</span
                  >
                }
              </li>
            }
          </ul>
        }
        @if (profileSvc.hasCv()) {
          <button type="button" class="ghost" (click)="removeCv()">
            Remove imported CV
          </button>
        }
      } @else {
        <p class="muted">
          Nothing yet — connect GitHub from the sign-in menu, or import a CV above.
        </p>
      }
    </section>
  `,
  styles: [
    `
      .muted {
        color: var(--muted);
      }
      .small {
        font-size: 0.85rem;
      }
      .panel {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 1rem 1.15rem;
        background: var(--panel);
        margin-bottom: 1.25rem;
      }
      h2 {
        margin: 0 0 0.35rem;
        font-size: 1.05rem;
      }
      h3 {
        margin: 1.2rem 0 0.5rem;
        font-size: 0.95rem;
      }
      .drop {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
        border: 1px dashed var(--border);
        border-radius: 10px;
        padding: 1rem;
        margin-top: 0.75rem;
      }
      .drop.over {
        border-color: var(--accent);
      }
      .error {
        color: #f87171;
      }
      .fields {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.85rem;
        color: var(--muted);
        flex: 1 1 12rem;
      }
      input[type='text'],
      input[type='email'] {
        padding: 0.4rem 0.6rem;
        background: var(--bg);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: 8px;
        font: inherit;
        min-width: 0;
      }
      .choices {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem 0.9rem;
      }
      .choice {
        flex: 0 0 auto;
        flex-direction: row;
        align-items: center;
        gap: 0.35rem;
        color: var(--fg);
        font-size: 0.9rem;
      }
      .role {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
        flex-wrap: wrap;
      }
      .role input[type='text'] {
        flex: 1 1 8rem;
      }
      .role .title {
        flex: 3 1 14rem;
      }
      .role .year {
        flex: 0 0 6.5rem;
      }
      .role.excluded {
        opacity: 0.45;
      }
      .actions {
        display: flex;
        gap: 0.6rem;
        margin-top: 1.1rem;
      }
      button {
        padding: 0.45rem 0.9rem;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: var(--accent);
        color: #06131f;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      button.ghost {
        background: none;
        color: var(--fg);
        font-weight: 400;
      }
      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }
      .tag {
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 0.1rem 0.55rem;
        font-size: 0.8rem;
      }
      .tag .src {
        color: var(--muted);
        font-size: 0.7rem;
        margin-left: 0.3rem;
      }
      .tag.src-cv {
        border-color: var(--accent);
      }
      .refine {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
        margin-top: 1.2rem;
      }
      .proposal {
        border: 1px dashed var(--accent);
        border-radius: 10px;
        padding: 0.75rem 1rem;
        margin-top: 0.9rem;
      }
      .proposal h3 {
        margin-top: 0;
      }
      .ai-tag {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted);
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 0.05rem 0.45rem;
        vertical-align: middle;
      }
      .proposal .row {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin: 0.35rem 0;
        font-size: 0.9rem;
      }
      .proposal .row button {
        margin-left: auto;
      }
      .tiny {
        padding: 0.15rem 0.55rem;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: none;
        color: var(--fg);
        font: inherit;
        font-size: 0.8rem;
        cursor: pointer;
      }
      .tiny:hover {
        border-color: var(--accent);
      }
      .sub {
        color: var(--muted);
        margin: 0.25rem 0 0.75rem;
      }
      .roles {
        margin: 0.9rem 0 0;
        padding-left: 1.1rem;
      }
    `,
  ],
})
export class ProfileComponent {
  protected readonly cv = inject(CvImportService);
  protected readonly profileSvc = inject(ProfileService);
  protected readonly ai = inject(AiService);
  protected readonly aiSettings = inject(AiSettingsService);

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

  protected readonly sortedSkills = computed<readonly SkillProficiency[]>(() => {
    const profile = this.profileSvc.profile();
    return profile ? [...profile.skills].sort((a, b) => b.level - a.level) : [];
  });

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
