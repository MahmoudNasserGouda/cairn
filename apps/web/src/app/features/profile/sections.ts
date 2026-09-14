import type { Routes } from '@angular/router';

/**
 * The hub's sections, in one place (ADR-0032).
 *
 * The sub-navigation and the routes are generated from this list, so a section cannot
 * exist in the nav without a route or the other way round — which is the failure mode
 * of every hand-maintained tab bar.
 *
 * Each is its own URL rather than an anchor on one long page: a section can then be
 * linked, bookmarked, and reached with the back button, and the browser restores the
 * right one on reload.
 */
export interface ProfileSection {
  readonly path: string;
  readonly label: string;
}

export const PROFILE_SECTIONS: readonly ProfileSection[] = [
  { path: 'overview', label: 'Overview' },
  { path: 'sources', label: 'Sources' },
  { path: 'skills', label: 'Skills' },
  { path: 'experience', label: 'Experience' },
  { path: 'education', label: 'Education' },
  { path: 'projects', label: 'Projects' },
  { path: 'open-source', label: 'Open source' },
] as const;

/** Lazily loaded, so a section nobody opens costs nothing. */
export const PROFILE_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'overview' },
  {
    path: 'overview',
    loadComponent: () =>
      import('./sections/overview.section').then((m) => m.OverviewSectionComponent),
  },
  {
    path: 'sources',
    loadComponent: () =>
      import('./sections/sources.section').then((m) => m.SourcesSectionComponent),
  },
  {
    path: 'skills',
    loadComponent: () =>
      import('./sections/skills.section').then((m) => m.SkillsSectionComponent),
  },
  {
    path: 'experience',
    loadComponent: () =>
      import('./sections/experience.section').then((m) => m.ExperienceSectionComponent),
  },
  {
    path: 'education',
    loadComponent: () =>
      import('./sections/education.section').then((m) => m.EducationSectionComponent),
  },
  {
    path: 'projects',
    loadComponent: () =>
      import('./sections/projects.section').then((m) => m.ProjectsSectionComponent),
  },
  {
    path: 'open-source',
    loadComponent: () =>
      import('./sections/open-source.section').then((m) => m.OpenSourceSectionComponent),
  },
];
