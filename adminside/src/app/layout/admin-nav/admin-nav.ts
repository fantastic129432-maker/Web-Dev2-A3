import { Component, DestroyRef, DOCUMENT, afterNextRender, inject, input, viewChild, type ElementRef } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';

/** One menu entry: the route and the translation key of its label. */
interface NavItem {
  readonly path: string;
  readonly labelKey: string;
}

/**
 * The admin menu, and the NAV segment of the four every admin page shares (Header,
 * Nav, Body, Footer).
 *
 * THE MENU IS THE BRIEF'S REQUIREMENT
 *   "Implement a clear and functional menu that allows users to navigate seamlessly
 *   to the other required pages. This menu must be present on all pages." The
 *   archived admin site satisfied it by having every page call initAdminLayout(),
 *   which built the same menu from one array. In Angular that becomes one component
 *   rendered by the application shell, so a new page CANNOT forget the menu - it is
 *   not part of any page's template. Assessment 2 feedback asked for the pages to be
 *   split into Header, Nav, Body and Footer with the common parts built once, which
 *   is why the markup is a file of its own rather than a block inside
 *   admin-header.html.
 *
 * WHAT THE MENU CONTAINS
 *   Dashboard, Events, Add event, Registrations - the four pages this application
 *   has. The link back to the public website is NOT here: it belongs with the
 *   header's other controls, because it leaves this application entirely and uses
 *   the OTHER_SITE_URL injection token rather than a route.
 *
 * WHY THE HOST ELEMENT MUST NOT ADD A BOX
 *   The menu is a direct child of the shell's layout: `.admin-nav` is the sticky band
 *   in `adminside/src/styles.css`. `admin-nav.css` gives this host
 *   `display: contents`, so the <nav> is laid out exactly where it was before the
 *   markup moved and no CSS rule had to move with it.
 *
 * IT PUBLISHES ITS OWN HEIGHT, for the same reason the public site's header does.
 *   `.admin-nav` is pinned at `top: 0`, so it is the band a sticky element below it
 *   has to clear. The event form's right column follows the scroll with
 *   `top: calc(var(--site-header-height) + var(--sticky-card-gap))` (see section 1e
 *   of shared/event-form/event-form.css), and `--site-header-height` is this
 *   element's measured height - a ResizeObserver writing the property onto the
 *   document element, which is exactly what `SiteHeaderComponent` does for the
 *   public header (clientside/src/app/layout/site-header.ts). A ResizeObserver and
 *   not a window `resize` listener, because the value has to follow a language
 *   switch or any other reflow of the menu row, and a window resize event does not
 *   fire for those.
 *
 *   THE MENU REALLY DOES CHANGE HEIGHT, which is why this is measured rather than
 *   written into the stylesheet: 70.73px in all four languages from 601px up, but
 *   64.39px in English and Chinese at 390px and 115.78px when the Vietnamese and
 *   Japanese labels wrap the list onto a second row at that width. The stylesheet's
 *   fallback (base.css, section 1) is the 70.73px English value, used only for the
 *   frame before the first measurement.
 *
 * No API endpoint is called by this component.
 */
@Component({
  selector: 'admin-nav',
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  styleUrl: './admin-nav.css',
  templateUrl: './admin-nav.html',
})
export class AdminNav {
  /** The document whose root carries the measured nav height. */
  private readonly document = inject(DOCUMENT);

  /** This component's lifetime, which is what disconnects the observer. */
  private readonly destroyRef = inject(DestroyRef);

  /** The `<nav>` itself, so its real height can be measured. */
  private readonly navBox = viewChild<ElementRef<HTMLElement>>('navBox');

  constructor() {
    /*
     * Measured after the first render, because the height is only real once the
     * element is in the document, and re-measured on every resize of the element
     * itself. `viewChild` rather than `viewChild.required`: the menu is behind an
     * `@if`, and a hidden nav has no height to publish - in which case the
     * stylesheet's fallback stands and no sticky card is being offset from a menu
     * that is not there.
     */
    afterNextRender(() => {
      const element = this.navBox()?.nativeElement;
      if (!element) return;

      const publish = () => {
        const { height } = element.getBoundingClientRect();
        this.document.documentElement.style.setProperty('--site-header-height', `${height}px`);
      };

      publish();
      // Absent only in a browser old enough that the fallback is the better answer.
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(publish);
        observer.observe(element);
        this.destroyRef.onDestroy(() => observer.disconnect());
      }
    });
  }

  /**
   * Whether to render the menu.
   *
   * The header owns this input and forwards its value here, which is the wiring the
   * public website's `site-header`/`site-nav` pair uses as well, so the two
   * applications can be read side by side. No admin route currently passes `false` -
   * the staff menu is required on every admin page, including the admin 404 - so in
   * practice it is always true; the plumbing exists because the two shells are
   * deliberately identical in shape.
   */
  readonly showNav = input(true);

  /** The four pages, in the order the archived admin menu listed them. */
  protected readonly navItems: readonly NavItem[] = [
    { path: '/', labelKey: 'nav.dashboard' },
    { path: '/events', labelKey: 'nav.events' },
    { path: '/events/new', labelKey: 'nav.new' },
    { path: '/registrations', labelKey: 'nav.registrations' },
  ];
}
