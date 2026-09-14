import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./pages/dashboard.component').then((m) => m.DashboardComponent),
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
      import('./pages/discover.component').then((m) => m.DiscoverComponent),
  },
  {
    path: 'repositories',
    loadComponent: () =>
      import('./pages/repositories.component').then((m) => m.RepositoriesComponent),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./pages/settings.component').then((m) => m.SettingsComponent),
  },
  { path: '**', redirectTo: 'dashboard' },
];
