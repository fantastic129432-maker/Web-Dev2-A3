import { Routes } from '@angular/router';

/**
 * The public website's routing table.
 *
 * Every page is lazy, every title is a translation key carried in route data, and
 * a bare /register deliberately falls through to the 404.
 *
 * @file Routing for the CLIENT-SIDE website.
 *
 * WHY EVERY PAGE IS LOADED WITH `loadComponent`
 *   The legacy site was four separate HTML documents, so a visitor only ever
 *   downloaded the code for the page they asked for. A single-page application
 *   bundles everything together by default, which would undo that. `loadComponent`
 *   with a dynamic `import()` keeps the same property in Angular: the home page's
 *   bundle does not contain the search form, the registration form or the
 *   registrations table, and each one is fetched the first time its route is
 *   visited. It also means none of these components is referenced from anywhere
 *   else, so the bundler can prove the split is real.
 *
 * WHY `title` IS TRANSLATION KEYS RATHER THAN TEXT
 *   A route's `title` is evaluated once, when the router activates it, and has no
 *   access to the TranslationService at definition time. A hard-coded English
 *   string here would therefore stay English after the visitor switched language.
 *   The key is carried in `data` instead and each page component resolves it
 *   through `Title` + `TranslationService` when it runs - see
 *   `useDocumentTitle()` in `shared/page-title.ts`. `title:` is kept as well in
 *   the documented Angular form so the intent of each route is readable here.
 *
 * WHY THERE IS NO ROUTE FOR 'register' WITHOUT AN ID
 *   Registration is per event, exactly as the legacy page treated it: the event
 *   id travels in the URL. `**` therefore catches a bare /register and shows the
 *   friendly 404 rather than a form that cannot know what it is registering for.
 */
export const routes: Routes = [
  {
    path: '',
    title: 'Unity Heart Foundation | Charity Events',
    data: { titleKey: 'nav.siteName' },
    loadComponent: () => import('./pages/home/home').then((m) => m.HomePage),
  },
  {
    path: 'search',
    title: 'Search charity events | Unity Heart Foundation',
    data: { titleKey: 'search.title' },
    loadComponent: () => import('./pages/search/search').then((m) => m.SearchPage),
  },
  {
    path: 'events/:id',
    title: 'Event details | Unity Heart Foundation',
    data: { titleKey: 'event.breadcrumb' },
    loadComponent: () =>
      import('./pages/event-detail/event-detail').then((m) => m.EventDetailPage),
  },
  {
    path: 'register/:id',
    // The tab title is resolved through `data.titleKey` ('form.title'), not
    // through this string - see the comment at the top of this file.
    title: 'Register for an event | Unity Heart Foundation',
    data: { titleKey: 'form.title' },
    loadComponent: () => import('./pages/register/register').then((m) => m.RegisterPage),
  },
  {
    path: '**',
    title: 'Page not found | Unity Heart Foundation',
    data: { titleKey: 'notFound.title' },
    loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFoundPage),
  },
];
