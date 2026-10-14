import { Routes } from '@angular/router';

/**
 * adminside/src/app/app.routes.ts
 * ---------------------------------------------------------------------------
 * The five pages of the admin website, plus the catch-all.
 *
 * WHY EVERY ROUTE IS LAZY
 *   `loadComponent` splits each page into its own chunk, so the dashboard does not
 *   download the event form, and a staff member who only ever reads the
 *   registration list never pays for the editor. The first paint of the admin site
 *   is therefore small even though the application as a whole is not.
 *
 * ROUTE ORDER MATTERS FOR ONE PAIR
 *   'events/new' must be declared before 'events/:id/edit' is considered - they
 *   cannot actually collide (one has two segments, the other three), but keeping
 *   the literal before the parameterised route is the habit that stops a future
 *   'events/:id' from swallowing 'events/new'.
 *
 * The page title is NOT set here. Each page sets it through usePageTitle(), which
 * reacts to the language switcher; a static route `title` would stay English after
 * the staff member changed language.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'events',
    loadComponent: () => import('./pages/event-list/event-list').then((m) => m.EventList),
  },
  {
    path: 'events/new',
    loadComponent: () => import('./pages/event-new/event-new').then((m) => m.EventNew),
  },
  {
    path: 'events/:id/edit',
    loadComponent: () => import('./pages/event-edit/event-edit').then((m) => m.EventEdit),
  },
  {
    path: 'registrations',
    loadComponent: () => import('./pages/registrations/registrations').then((m) => m.Registrations),
  },
  {
    path: '**',
    loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFound),
  },
];
