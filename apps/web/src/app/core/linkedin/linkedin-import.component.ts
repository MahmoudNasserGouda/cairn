import { Component, computed, inject, signal } from '@angular/core';
import { REFUSED_FILES } from '@cairn/linkedin-archive';
import { LinkedinImportService } from './linkedin-import.service';
import { ProfileService } from '../profile/profile.service';

/** Where LinkedIn puts the export button, so the instructions can be one click. */
const DOWNLOAD_URL = 'https://www.linkedin.com/mypreferences/d/download-my-data';

/**
 * LinkedIn archive import and its mandatory review step (ADR-0029).
 *
 * Its own component rather than another section of `profile.component.ts`, which is
 * already 770 lines. The import has a real amount of UI — an explanation of how to get
 * the file, a privacy report, and a review of eight sections — and none of it is
 * coupled to the CV form it would have sat next to.
 *
 * **Everything is interpolated, never `innerHTML`.** Every string here came out of a
 * file someone was emailed (SECURITY.md T7, and now the archive row): Angular's
 * escaping is the whole defence, and URLs are already scheme-filtered by the reader.
 *
 * The review is not a formality. ADR-0011 set the rule for CVs — "nothing is committed
 * to the profile without confirmation" — and ADR-0029 inherits it. What this shows is
 * everything the merge would receive, plus what was deliberately left unopened.
 */
@Component({
  selector: 'cn-linkedin-import',
  standalone: true,
  template: `
    <section class="panel">
      <h2>Import your LinkedIn archive</h2>

      @if (profileSvc.hasLinkedinArchive() && !draft()) {
        <p class="muted small">
          Your LinkedIn archive is part of your profile. Re-importing is safe — it updates
          what it recognises and leaves anything you edited by hand alone.
        </p>
      }

      <p class="muted small">
        LinkedIn has no API that returns your profile, so this reads the ZIP they send
        you. Ask for it at
        <a [href]="downloadUrl" target="_blank" rel="noopener noreferrer">
          Settings &amp; Privacy → Data Privacy → Get a copy of your data</a
        >; it arrives by email, usually within a few minutes. Upload it here — the file is
        read inside a sandboxed worker in this tab, is never uploaded anywhere, and is
        never stored.
      </p>

      <details class="note">
        <summary>What Rujoom reads, and what it refuses to open</summary>
        <p class="muted small">
          It opens eight files, all about you: your profile, positions, education, skills,
          certifications, projects, languages and email addresses.
        </p>
        <p class="muted small">
          It never opens {{ refused }}. Those are other people's personal data, and nobody
          in them agreed to anything. This is enforced in the parser, not promised in a
          policy — after an import you can see exactly which files were opened.
        </p>
      </details>

      <div
        class="drop"
        [class.over]="dragging()"
        (dragover)="onDragOver($event)"
        (dragleave)="dragging.set(false)"
        (drop)="onDrop($event)"
      >
        <input type="file" accept=".zip,application/zip" (change)="onPick($event)" />
        <span class="muted small">or drop the .zip here</span>
      </div>

      @if (linkedin.busy()) {
        <p class="muted" role="status">Reading your archive…</p>
      }
      @if (linkedin.error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }

      @if (profileSvc.hasLinkedinArchive() && !draft()) {
        <div class="actions">
          <button type="button" class="ghost" (click)="remove()">
            Remove LinkedIn data
          </button>
        </div>
      }
    </section>

    @if (draft(); as archive) {
      <section class="panel">
        <h2>Check what we read</h2>
        <p class="muted small">
          Nothing is added to your profile until you confirm. Anything you have already
          edited by hand stays as you left it.
        </p>

        <div class="report">
          <p class="small">
            <strong>Opened {{ archive.report.read.length }}</strong>
            {{ archive.report.read.length === 1 ? 'file' : 'files' }}:
            <span class="muted">{{ fileList(archive.report.read) }}</span>
          </p>
          @if (archive.report.missing.length) {
            <p class="small muted">
              Not in your archive: {{ fileList(archive.report.missing) }}
            </p>
          }
          @if (archive.report.skipped.length) {
            <p class="small">
              <strong>Left unopened: {{ archive.report.skipped.length }}</strong>
              <span class="muted">
                — {{ fileList(archive.report.skipped.slice(0, 8)) }}
                @if (archive.report.skipped.length > 8) {
                  and {{ archive.report.skipped.length - 8 }} more
                }
              </span>
            </p>
          }
        </div>

        @if (archive.identity; as who) {
          <h3>You</h3>
          <ul class="facts">
            @if (name(); as value) {
              <li><span class="key">Name</span> {{ value }}</li>
            }
            @if (who.headline) {
              <li><span class="key">Headline</span> {{ who.headline }}</li>
            }
            @if (who.location) {
              <li><span class="key">Location</span> {{ who.location }}</li>
            }
            @if (who.summary) {
              <li><span class="key">Summary</span> {{ who.summary }}</li>
            }
            @for (site of who.websites; track site) {
              <li><span class="key">Website</span> {{ site }}</li>
            }
          </ul>
        }

        @if (archive.emails.length) {
          <h3>Email addresses</h3>
          <ul class="facts">
            @for (address of archive.emails; track address) {
              <li>{{ address }}</li>
            }
          </ul>
        }

        @if (archive.positions.length) {
          <h3>Positions ({{ archive.positions.length }})</h3>
          <ul class="entries">
            @for (role of archive.positions; track $index) {
              <li>
                <strong>{{ role.title }}</strong>
                @if (role.organization) {
                  · {{ role.organization }}
                }
                <span class="muted small">{{ years(role.startYear, role.endYear) }}</span>
                @if (role.highlights.length) {
                  <ul class="bullets">
                    @for (line of role.highlights; track $index) {
                      <li class="muted small">{{ line }}</li>
                    }
                  </ul>
                }
              </li>
            }
          </ul>
        }

        @if (archive.education.length) {
          <h3>Education ({{ archive.education.length }})</h3>
          <ul class="entries">
            @for (entry of archive.education; track $index) {
              <li>
                <strong>{{ entry.institution }}</strong>
                @if (entry.degree) {
                  · {{ entry.degree }}
                }
                <span class="muted small">{{
                  years(entry.startYear, entry.endYear)
                }}</span>
              </li>
            }
          </ul>
        }

        @if (archive.skills.length) {
          <h3>Skills ({{ archive.skills.length }})</h3>
          <div class="tags">
            @for (skill of archive.skills; track skill) {
              <span class="tag">{{ skill }}</span>
            }
          </div>
          <p class="muted small">
            Rujoom keeps the ones its matching taxonomy knows; the rest stay on LinkedIn.
          </p>
        }

        @if (archive.projects.length) {
          <h3>Projects ({{ archive.projects.length }})</h3>
          <ul class="entries">
            @for (project of archive.projects; track $index) {
              <li>
                <strong>{{ project.name }}</strong>
                @if (project.description) {
                  <span class="muted small"> — {{ project.description }}</span>
                }
              </li>
            }
          </ul>
        }

        @if (archive.certifications.length) {
          <h3>Certifications ({{ archive.certifications.length }})</h3>
          <ul class="entries">
            @for (entry of archive.certifications; track $index) {
              <li>
                <strong>{{ entry.name }}</strong>
                @if (entry.issuer) {
                  · {{ entry.issuer }}
                }
                @if (entry.year) {
                  <span class="muted small"> {{ entry.year }}</span>
                }
              </li>
            }
          </ul>
        }

        @if (archive.languages.length) {
          <h3>Languages ({{ archive.languages.length }})</h3>
          <ul class="entries">
            @for (entry of archive.languages; track $index) {
              <li>
                <strong>{{ entry.name }}</strong>
                @if (entry.proficiency) {
                  <span class="muted small"> — {{ entry.proficiency }}</span>
                }
              </li>
            }
          </ul>
        }

        <div class="actions">
          <button type="button" [disabled]="saving()" (click)="confirm()">
            Add to my profile
          </button>
          <button type="button" class="ghost" (click)="cancel()">Discard</button>
        </div>
      </section>
    }
  `,
  styles: [
    `
      /* Phase 7's design system replaces these; until then they match the rest of
         the app rather than inventing a second look. */
      .muted {
        color: var(--fg-muted);
      }
      .small {
        font-size: 0.85rem;
      }
      .panel {
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 1rem 1.15rem;
        background: var(--surface);
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
      .note {
        margin: 0.6rem 0;
        font-size: 0.85rem;
      }
      .note summary {
        cursor: pointer;
        color: var(--accent);
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
      .report {
        border-left: 2px solid var(--border);
        padding-left: 0.75rem;
        margin: 0.75rem 0;
      }
      .report p {
        margin: 0.25rem 0;
      }
      .facts,
      .entries,
      .bullets {
        margin: 0;
        padding-left: 1.1rem;
      }
      .facts {
        list-style: none;
        padding-left: 0;
      }
      .facts li {
        margin-bottom: 0.2rem;
      }
      .entries > li {
        margin-bottom: 0.5rem;
      }
      .key {
        display: inline-block;
        min-width: 5.5rem;
        color: var(--fg-muted);
        font-size: 0.85rem;
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
      .actions {
        display: flex;
        gap: 0.5rem;
        margin-top: 1rem;
        flex-wrap: wrap;
      }
      button {
        padding: 0.45rem 0.9rem;
        border-radius: 8px;
        border: 1px solid var(--accent);
        background: var(--accent);
        color: #0e0e10;
        font: inherit;
        cursor: pointer;
      }
      button.ghost {
        background: transparent;
        color: var(--fg);
        border-color: var(--border);
      }
      button[disabled] {
        opacity: 0.6;
        cursor: default;
      }
    `,
  ],
})
export class LinkedinImportComponent {
  protected readonly linkedin = inject(LinkedinImportService);
  protected readonly profileSvc = inject(ProfileService);

  protected readonly dragging = signal(false);
  protected readonly saving = signal(false);
  protected readonly downloadUrl = DOWNLOAD_URL;
  protected readonly refused = REFUSED_FILES.join(', ');

  protected readonly draft = computed(() => this.linkedin.draft()?.archive ?? null);

  protected readonly name = computed(() => {
    const who = this.draft()?.identity;
    return [who?.firstName, who?.lastName].filter(Boolean).join(' ');
  });

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.linkedin.import(file);
  }

  protected onPick(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void this.linkedin.import(file);
  }

  /** The reviewed archive, committed. The merge decides what survives (ADR-0031). */
  protected async confirm(): Promise<void> {
    const archive = this.draft();
    if (!archive || this.saving()) return;
    this.saving.set(true);
    try {
      await this.profileSvc.setLinkedin(archive);
      this.linkedin.reset();
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    this.linkedin.reset();
  }

  protected async remove(): Promise<void> {
    await this.profileSvc.clearLinkedin();
  }

  /** "2019 – present", "2019", or nothing at all. */
  protected years(start?: number, end?: number | 'present'): string {
    if (start === undefined && end === undefined) return '';
    if (start === undefined) return String(end);
    if (end === undefined) return String(start);
    return `${start} – ${end}`;
  }

  /** Entry names without their wrapper folder, which is noise in a list of eight. */
  protected fileList(names: readonly string[]): string {
    return names.map((name) => name.slice(name.lastIndexOf('/') + 1)).join(', ');
  }
}
