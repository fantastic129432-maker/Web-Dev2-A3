import { Component, inject, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { OTHER_SITE_URL } from '@charity/shared/di/tokens';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';

/**
 * The primary menu of the public website, and the NAV segment of the four every
 * page shares (Header, Nav, Body, Footer).
 *
 * WHY THE MENU IS A COMPONENT OF ITS OWN
 *   Assessment 2 feedback asked for the pages to be broken into Header, Nav, Body
 *   and Footer, with Header, Nav and Footer created once and common to every page.
 *   The menu used to be markup inside `site-header.html`; extracting it makes the
 *   nav segment something that exists in the source as well as in the rendered
 *   document, and it is still defined exactly once - `app-site-header` renders this
 *   component inside its `<header>` landmark, and the shell renders that header
 *   once, as a sibling of the routed page.
 *
 * WHERE THE MENU SITS, AND WHY THAT DID NOT HAVE TO BE RESTYLED
 *   The markup is deliberately still a direct child of `.site-header__nav`, the
 *   flex slot in which the shared stylesheet (`clientside/src/styles.css`)
 *   positions the settings bar and the menu. `site-nav.css` gives this component's
 *   host `display: contents`, so the new element contributes no box and the layout
 *   is exactly what it was before the markup moved. That is the reason no CSS rule
 *   moved with the markup: every class name below is one the global stylesheet
 *   already defines.
 *
 * Menu destinations, and why they are these three:
 *   Home           the landing page with the About and Contact sections
 *   Search Events  the filter form and the results
 *   Admin site     the OTHER_SITE_URL token, i.e. the separate staff website
 *
 * There is deliberately no "Register" item. Registration is per event, so a global
 * link would have no subject: it could only ask the visitor to pick an event first,
 * which is exactly what Home and Search already do. The Register button on an
 * event's own page carries the event id.
 *
 * The admin link IS in the public menu even though it is a staff tool. It was
 * footer-only at first, on the grounds that a separate site does not belong in a
 * visitor's journey - but the brief treats the two websites as two deliverables,
 * and a deliverable that cannot be found costs more than a slightly unusual menu
 * item. The footer keeps its link as well: two routes to the same place is not
 * duplication worth removing.
 *
 * `routerLinkActive` sets both the highlight class and `aria-current="page"`,
 * which is how a screen reader announces the current page.
 */
@Component({
  selector: 'app-site-nav',
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  templateUrl: './site-nav.html',
  styleUrl: './site-nav.css',
})
export class SiteNavComponent {
  /**
   * Whether to render the menu at all.
   *
   * The header owns this input, because the shell talks to the header, and forwards
   * its value here - the same wiring `admin-header` uses, so the two applications
   * can be read side by side. The 404 route ends up passing `false`: a menu of links
   * to pages the visitor was not looking for is noise on an error page. A signal
   * input (not a plain `@Input()`) because Angular 22's signal inputs are typed and
   * give the template a plain value to read without a `strictTemplates` null check.
   */
  readonly showNav = input(true);

  /**
   * Whether the mobile menu is currently open.
   *
   * The state lives in the header, which owns the hamburger button that toggles it;
   * this input is the value pushed down to the class the stylesheet keys off. Below
   * 760px the global stylesheet hides `.site-nav` and shows it again only with
   * `.site-nav--open`, so all this input has to do is decide whether that class is
   * on.
   */
  readonly menuOpen = input(false);

  /**
   * Emitted when one of the routed menu links is activated.
   *
   * The header listens to this and closes the mobile menu, so the menu cannot stay
   * open on top of the page it just navigated to. The admin-site link is
   * deliberately not wired to it: that link leaves this application altogether, so
   * there is no menu left on screen to close.
   */
  readonly linkActivated = output<void>();

  /** The admin site, provided in app.config.ts. */
  protected readonly otherSiteUrl = inject(OTHER_SITE_URL);
}
