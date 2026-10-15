import { Component, input } from '@angular/core';
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
 * No API endpoint is called by this component.
 */
@Component({
  selector: 'admin-nav',
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  styleUrl: './admin-nav.css',
  templateUrl: './admin-nav.html',
})
export class AdminNav {
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
