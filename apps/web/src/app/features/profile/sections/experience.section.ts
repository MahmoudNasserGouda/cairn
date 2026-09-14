import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { experienceKey, type ExperienceEntry } from '@cairn/profile';
import { ProfileService } from '../../../core/profile/profile.service';
import { SectionComponent } from '../../../ui';
import {
  EntryListComponent,
  type EntryField,
  type EntryRow,
  type EntrySaved,
} from '../entry-list.component';
import { fromEndYear, optional, toEndYear, toLines, toText, toYear } from '../draft';

const FIELDS: readonly EntryField[] = [
  { key: 'title', label: 'Title', type: 'text', placeholder: 'Backend Engineer' },
  {
    key: 'organization',
    label: 'Organisation',
    type: 'text',
    placeholder: 'Paystack',
    hint: 'Used with the start year to recognise this role across imports.',
  },
  { key: 'location', label: 'Location', type: 'text', optional: true },
  { key: 'startYear', label: 'From', type: 'year', placeholder: '2021' },
  {
    key: 'endYear',
    label: 'To',
    type: 'year-or-present',
    placeholder: 'present',
    hint: 'A year, or "present" if you are still there.',
  },
  {
    key: 'highlights',
    label: 'What you did',
    type: 'lines',
    optional: true,
    hint: 'One per line.',
  },
];

@Component({
  selector: 'cn-profile-experience',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionComponent, EntryListComponent],
  template: `
    <cn-section
      heading="Experience"
      description="Roles from every source, merged. Edit anything — what you type outranks
        every import, and stays put the next time you re-import."
    >
      <cn-entry-list
        [rows]="rows()"
        [fields]="fields"
        [requiredKeys]="['title']"
        addLabel="Add a role"
        editLabel="Edit this role"
        emptyHeadline="No roles yet"
        emptyDetail="Connect GitHub, import a CV or a LinkedIn archive — or add a role
          yourself."
        (saved)="save($event)"
        (removed)="remove($event)"
      />
    </cn-section>
  `,
})
export class ExperienceSectionComponent {
  private readonly profile = inject(ProfileService);
  protected readonly fields = FIELDS;

  protected readonly rows = computed<EntryRow[]>(() =>
    (this.profile.profile()?.experience ?? []).map((entry) => ({
      key: experienceKey(entry),
      title: entry.title,
      subtitle: entry.organization,
      startYear: entry.startYear,
      endYear: entry.endYear,
      detail: entry.location,
      bullets: entry.highlights,
      source: entry.from.source,
      draft: {
        title: entry.title,
        organization: entry.organization ?? '',
        location: entry.location ?? '',
        startYear: entry.startYear === undefined ? '' : String(entry.startYear),
        endYear: fromEndYear(entry.endYear),
        highlights: entry.highlights.join('\n'),
      },
    })),
  );

  protected async save(event: EntrySaved): Promise<void> {
    const v = event.values;
    const entry: Omit<ExperienceEntry, 'from'> = {
      title: (v['title'] ?? '').trim(),
      ...optional('organization', toText(v['organization'])),
      ...optional('location', toText(v['location'])),
      ...optional('startYear', toYear(v['startYear'])),
      ...optional('endYear', toEndYear(v['endYear'])),
      highlights: toLines(v['highlights']),
    };
    await this.profile.edit({
      kind: 'experience',
      ...(event.replaces ? { replaces: event.replaces } : {}),
      entry,
    });
  }

  protected async remove(key: string): Promise<void> {
    await this.profile.edit({ kind: 'remove', key });
  }
}
