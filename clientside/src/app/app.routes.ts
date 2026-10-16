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
 * WHY `title` IS A TRANSLATION KEY IN `data` AND NOT THE ROUTER'S OWN `title:`
 *   This table used to carry both: a `data.titleKey` AND a hard-coded English
 *   `title:` string. The English one won. `DefaultTitleStrategy.updateTitle()` is
 *   called by the router AFTER the activated components have been constructed
 *   (it runs once `ActivateRoutes` has finished, immediately after NavigationEnd),
 *   so the page's own `useDocumentTitle().set()` happened first and was then
 *   overwritten. Measured on the built development bundle: with
 *   `title: 'Search charity events | Unity Heart Foundation'` on this route,
 *   /search rendered that English title on a page whose `<html lang>` was
 *   `zh-CN`, while /events/2 was correctly Chinese - its page sets the title a
 *   second time from the API's answer, after the router has had its turn. The
 *   strings were therefore English chrome in all four languages, written in
 *   TypeScript where neither the template check nor the dictionary checks could
 *   see them. Every route now carries ONLY the key in `data`, each page component
 *   resolves it through `Title` + `TranslationService` when it runs - see
 *   `useDocumentTitle()` in `shared/page-title.ts` - and no route sets a static
 *   `title:`, which is what adminside/src/app/app.routes.ts has always done.
 *
 * WHY THERE IS NO ROUTE FOR 'register' WITHOUT AN ID
 *   Registration is per event, exactly as the legacy page treated it: the event
 *   id travels in the URL. `**` therefore catches a bare /register and shows the
 *   friendly 404 rather than a form that cannot know what it is registering for.
 */
export const routes: Routes = [
  {
    path: '',
    data: { titleKey: 'nav.siteName' },
    loadComponent: () => import('./pages/home/home').then((m) => m.HomePage),
  },
  {
    path: 'search',
    data: { titleKey: 'search.title' },
    loadComponent: () => import('./pages/search/search').then((m) => m.SearchPage),
  },
  {
    path: 'events/:id',
    data: { titleKey: 'event.breadcrumb' },
    loadComponent: () =>
      import('./pages/event-detail/event-detail').then((m) => m.EventDetailPage),
  },
  {
    path: 'register/:id',
    // The tab title is resolved through `data.titleKey` ('form.title') - see the
    // comment at the top of this file for why no `title:` string is set here.
    data: { titleKey: 'form.title' },
    loadComponent: () => import('./pages/register/register').then((m) => m.RegisterPage),
  },
  {
    path: '**',
    data: { titleKey: 'notFound.title' },
    loadComponent: () => import('./pages/not-found/not-found').then((m) => m.NotFoundPage),
  },
];
