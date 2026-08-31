import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./pages/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'repositories',
    loadComponent: () =>
      import('./pages/repositories.component').then((m) => m.RepositoriesComponent),
  },
  { path: '**', redirectTo: 'dashboard' },
];
