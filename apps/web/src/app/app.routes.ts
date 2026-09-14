import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard.page').then((m) => m.DashboardPageComponent),
  },
  {
    // The profile is a hub with its own sections, each a real URL (ADR-0032) — so a
    // section can be linked, bookmarked and reached with the back button.
    path: 'profile',
    loadComponent: () =>
      import('./features/profile/profile.page').then((m) => m.ProfilePageComponent),
    loadChildren: () =>
      import('./features/profile/sections').then((m) => m.PROFILE_ROUTES),
  },
  {
    path: 'discover',
    loadComponent: () =>
      import('./features/discover/discover.page').then((m) => m.DiscoverPageComponent),
  },
  {
    path: 'repositories',
    loadComponent: () =>
      import('./features/repositories/repositories.page').then(
        (m) => m.RepositoriesPageComponent,
      ),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings.page').then((m) => m.SettingsPageComponent),
  },
  { path: '**', redirectTo: 'dashboard' },
];
