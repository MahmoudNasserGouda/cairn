import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { certificationKey, educationKey, languageKey } from '@cairn/profile';
import { ProfileService } from '../../../core/profile/profile.service';
import { SectionComponent } from '../../../ui';
import {
  EntryListComponent,
  type EntryField,
  type EntryRow,
  type EntrySaved,
} from '../entry-list.component';
import { optional, toHttpUrl, toText, toYear } from '../draft';

const EDUCATION_FIELDS: readonly EntryField[] = [
  {
    key: 'institution',
    label: 'Institution',
    type: 'text',
    placeholder: 'University of Lagos',
  },
  {
    key: 'degree',
    label: 'Degree',
    type: 'text',
    optional: true,
    placeholder: 'BSc Computer Science',
  },
  { key: 'startYear', label: 'From', type: 'year', optional: true, placeholder: '2014' },
  { key: 'endYear', label: 'To', type: 'year', optional: true, placeholder: '2018' },
];

const CERTIFICATION_FIELDS: readonly EntryField[] = [
  {
    key: 'name',
    label: 'Name',
    type: 'text',
    placeholder: 'AWS Certified Solutions Architect',
  },
  {
    key: 'issuer',
    label: 'Issued by',
    type: 'text',
    optional: true,
    placeholder: 'Amazon Web Services',
  },
  { key: 'year', label: 'Year', type: 'year', optional: true, placeholder: '2022' },
  {
    key: 'url',
    label: 'Link',
    type: 'text',
    optional: true,
    hint: 'Where it can be verified.',
  },
];

const LANGUAGE_FIELDS: readonly EntryField[] = [
  { key: 'name', label: 'Language', type: 'text', placeholder: 'Igbo' },
  {
    key: 'proficiency',
    label: 'Proficiency',
    type: 'text',
    optional: true,
    placeholder: 'Native',
    hint: 'However you would describe it.',
  },
];

/**
 * Education, certifications and spoken languages.
 *
 * Three lists on one page because each is short and they answer the same question —
 * what you have studied and what you can show for it. Giving them a nav item each
 * would be three destinations that are usually empty.
 */
@Component({
  selector: 'cn-profile-education',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionComponent, EntryListComponent],
  template: `
    <cn-section
      heading="Education"
      description="Where you studied. Imported where a source knew, and yours to correct."
    >
      <cn-entry-list
        [rows]="education()"
        [fields]="educationFields"
        [requiredKeys]="['institution']"
        addLabel="Add education"
        editLabel="Edit this entry"
        emptyHeadline="No education recorded"
        emptyDetail="A LinkedIn archive or a CV usually fills this in."
        (saved)="saveEducation($event)"
        (removed)="remove($event)"
      />
    </cn-section>

    <cn-section
      heading="Certifications"
      description="Things you have been assessed on."
      class="stacked"
    >
      <cn-entry-list
        [rows]="certifications()"
        [fields]="certificationFields"
        [requiredKeys]="['name']"
        addLabel="Add a certification"
        editLabel="Edit this certification"
        emptyHeadline="No certifications"
        emptyDetail="Add one, or import a LinkedIn archive that lists them."
        (saved)="saveCertification($event)"
        (removed)="remove($event)"
      />
    </cn-section>

    <cn-section heading="Languages" description="Spoken, not programmed." class="stacked">
      <cn-entry-list
        [rows]="languages()"
        [fields]="languageFields"
        [requiredKeys]="['name']"
        addLabel="Add a language"
        editLabel="Edit this language"
        emptyHeadline="No languages recorded"
        emptyDetail="Worth adding — a lot of projects need maintainers who speak more
          than English."
        (saved)="saveLanguage($event)"
        (removed)="remove($event)"
      />
    </cn-section>
  `,
  styles: [
    `
      .stacked {
        margin-top: var(--space-8);
      }
    `,
  ],
})
export class EducationSectionComponent {
  private readonly profile = inject(ProfileService);

  protected readonly educationFields = EDUCATION_FIELDS;
  protected readonly certificationFields = CERTIFICATION_FIELDS;
  protected readonly languageFields = LANGUAGE_FIELDS;

  protected readonly education = computed<EntryRow[]>(() =>
    (this.profile.profile()?.education ?? []).map((entry) => ({
      key: educationKey(entry),
      title: entry.institution,
      subtitle: entry.degree,
      startYear: entry.startYear,
      endYear: entry.endYear,
      source: entry.from.source,
      draft: {
        institution: entry.institution,
        degree: entry.degree ?? '',
        startYear: entry.startYear === undefined ? '' : String(entry.startYear),
        endYear: entry.endYear === undefined ? '' : String(entry.endYear),
      },
    })),
  );

  protected readonly certifications = computed<EntryRow[]>(() =>
    (this.profile.profile()?.certifications ?? []).map((entry) => ({
      key: certificationKey(entry),
      title: entry.name,
      subtitle: entry.issuer,
      startYear: entry.year,
      endYear: entry.year,
      detail: entry.url,
      source: entry.from.source,
      draft: {
        name: entry.name,
        issuer: entry.issuer ?? '',
        year: entry.year === undefined ? '' : String(entry.year),
        url: entry.url ?? '',
      },
    })),
  );

  protected readonly languages = computed<EntryRow[]>(() =>
    (this.profile.profile()?.languages ?? []).map((entry) => ({
      key: languageKey(entry),
      title: entry.name,
      subtitle: entry.proficiency,
      source: entry.from.source,
      draft: { name: entry.name, proficiency: entry.proficiency ?? '' },
    })),
  );

  protected async saveEducation(event: EntrySaved): Promise<void> {
    const v = event.values;
    await this.profile.edit({
      kind: 'education',
      ...(event.replaces ? { replaces: event.replaces } : {}),
      entry: {
        institution: (v['institution'] ?? '').trim(),
        ...optional('degree', toText(v['degree'])),
        ...optional('startYear', toYear(v['startYear'])),
        ...optional('endYear', toYear(v['endYear'])),
      },
    });
  }

  protected async saveCertification(event: EntrySaved): Promise<void> {
    const v = event.values;
    await this.profile.edit({
      kind: 'certification',
      ...(event.replaces ? { replaces: event.replaces } : {}),
      entry: {
        name: (v['name'] ?? '').trim(),
        ...optional('issuer', toText(v['issuer'])),
        ...optional('year', toYear(v['year'])),
        ...optional('url', toHttpUrl(v['url'])),
      },
    });
  }

  protected async saveLanguage(event: EntrySaved): Promise<void> {
    const v = event.values;
    await this.profile.edit({
      kind: 'language',
      ...(event.replaces ? { replaces: event.replaces } : {}),
      entry: {
        name: (v['name'] ?? '').trim(),
        ...optional('proficiency', toText(v['proficiency'])),
      },
    });
  }

  protected async remove(key: string): Promise<void> {
    await this.profile.edit({ kind: 'remove', key });
  }
}
