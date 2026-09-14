import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { extractSkills, projectKey } from '@cairn/profile';
import { ProfileService } from '../../../core/profile/profile.service';
import { SectionComponent } from '../../../ui';
import {
  EntryListComponent,
  type EntryField,
  type EntryRow,
  type EntrySaved,
} from '../entry-list.component';
import { optional, toHttpUrl, toText } from '../draft';

const FIELDS: readonly EntryField[] = [
  { key: 'name', label: 'Name', type: 'text', placeholder: 'ledger-cli' },
  {
    key: 'description',
    label: 'What it is',
    type: 'textarea',
    optional: true,
    hint: 'Technologies mentioned here are recognised automatically.',
  },
  {
    key: 'url',
    label: 'Link',
    type: 'text',
    optional: true,
    placeholder: 'github.com/you/it',
  },
];

@Component({
  selector: 'cn-profile-projects',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionComponent, EntryListComponent],
  template: `
    <cn-section
      heading="Projects"
      description="Your pinned GitHub repositories, anything a LinkedIn archive listed,
        and whatever you add here."
    >
      <cn-entry-list
        [rows]="rows()"
        [fields]="fields"
        [requiredKeys]="['name']"
        addLabel="Add a project"
        editLabel="Edit this project"
        emptyHeadline="No projects yet"
        emptyDetail="Pin a repository on GitHub and it appears here, or add one by hand."
        (saved)="save($event)"
        (removed)="remove($event)"
      />
    </cn-section>
  `,
})
export class ProjectsSectionComponent {
  private readonly profile = inject(ProfileService);
  protected readonly fields = FIELDS;

  protected readonly rows = computed<EntryRow[]>(() =>
    (this.profile.profile()?.projects ?? []).map((entry) => ({
      key: projectKey(entry),
      title: entry.name,
      subtitle: entry.description,
      detail: entry.technologies.length ? entry.technologies.join(' · ') : entry.url,
      source: entry.from.source,
      draft: {
        name: entry.name,
        description: entry.description ?? '',
        url: entry.url ?? '',
      },
    })),
  );

  protected async save(event: EntrySaved): Promise<void> {
    const v = event.values;
    const name = (v['name'] ?? '').trim();
    const description = toText(v['description']);
    await this.profile.edit({
      kind: 'project',
      ...(event.replaces ? { replaces: event.replaces } : {}),
      entry: {
        name,
        ...optional('description', description),
        ...optional('url', toHttpUrl(v['url'])),
        // The same conservative reader the archive importer uses: it under-reports
        // rather than claiming a project used Go because the description said
        // "go live".
        technologies: extractSkills(`${name} ${description ?? ''}`),
      },
    });
  }

  protected async remove(key: string): Promise<void> {
    await this.profile.edit({ kind: 'remove', key });
  }
}
