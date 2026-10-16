/**
 * @file Application shell: the four segments every page shares.
 *
 * Header (which contains Nav), Body and Footer are rendered here, once, as siblings
 * of the routed page, so navigating never rebuilds them - which is why the language
 * and theme state survives a navigation and why `GET /api/health` is fetched once
 * per full page load rather than once per route.
 */
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { SiteFooterComponent } from './layout/site-footer';
import { SiteHeaderComponent } from './layout/site-header';
import { FragmentScrollService } from './shared/fragment-scroll';

/**
 * The root of the CLIENT-SIDE website: the four segments in order - Header (which
 * contains Nav), the routed page as Body, and Footer.
 *
 * WHY THE LAYOUT LIVES HERE RATHER THAN IN A ROUTED LAYOUT COMPONENT
 *   Every route wants the site chrome except for one detail: the wildcard 404 route
 *   shows the language and theme controls (a visitor who mistyped a URL still needs
 *   them) and the footer, but not a menu full of links to pages, so only the menu is
 *   hidden on that one route by inspecting the router's current URL. A layout
 *   component with child routes would be the tidier answer for a larger site, but
 *   here it would add a second `<router-outlet>`, a second level of lazy loading and
 *   a routing table that no longer reads as a flat list of the four pages the brief
 *   asks for.
 *
 * WHY THE ROUTE URL IS READ THROUGH toSignal
 *   Angular 22 is zoneless: template expressions are re-evaluated when a signal
 *   they read changes. The router is not a signal source by default, so the URL
 *   is projected into one - and `filter` drops every navigation event that is
 *   not a completed one, so the chrome cannot flicker half way through a
 *   navigation.
 *
 * The 404 page still needs to exist as a route of its own; this component only
 * decides whether it is framed by the site chrome.
 *
 * THE SHELL ALSO STARTS THE FRAGMENT WATCHER
 *   `FragmentScrollService` is created here, in the component that lives for the
 *   whole session, so it starts listening before the initial navigation resolves
 *   and stops when the application is torn down. It is not rendered and has no
 *   template: it is the answer to the cross-route fragment link described in its
 *   own file (`clientside/src/app/shared/fragment-scroll.ts`), which arrives
 *   before the home page's listing has rendered and would otherwise come to rest
 *   a thousand pixels short of the section it named.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SiteHeaderComponent, SiteFooterComponent],
  templateUrl: './app.html',
})
export class App {
  private readonly router = inject(Router);

  /**
   * The cross-route fragment watcher, created for its own subscription.
   *
   * Injected into a field rather than called from a method because the work is
   * the service's constructor: creating it subscribes to the router's events, and
   * the session it watches is this component's own lifetime.
   */
  private readonly fragmentScroll = inject(FragmentScrollService);

  /**
   * The URL after the latest completed navigation.
   *
   * `initialValue` is not optional here: the first emission only arrives after
   * the initial navigation resolves, and without a starting value the computed
   * below would have nothing to read on the very first render. `''` is the home
   * URL, which is also the right default for "show the chrome".
   */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects)
    ),
    { initialValue: '' }
  );

  /**
   * False only on the wildcard 404 route.
   *
   * `isNotFound` is preferred over comparing the URL to a list of known paths,
   * because the router is the only thing that knows which route actually matched
   * - the 404 route can be reached from any URL at all.
   */
  protected readonly showSiteChrome = computed(() => !this.isNotFoundUrl(this.url()));

  /**
   * A URL is "not found" when it is not one of the four real pages.
   *
   * Written as a small explicit test rather than a regex so the four patterns are
   * readable next to the routing table in app.routes.ts, and so a route added
   * there fails loudly (the chrome would appear on the 404 page) rather than
   * silently.
   */
  private isNotFoundUrl(url: string): boolean {
    const path = url.split('?')[0].split('#')[0];
    if (path === '' || path === '/') return false;
    if (path === '/search') return false;
    if (/^\/events\/[^/]+$/.test(path)) return false;
    if (/^\/register\/[^/]+$/.test(path)) return false;
    return true;
  }
}
