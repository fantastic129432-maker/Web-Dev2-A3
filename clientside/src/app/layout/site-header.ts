import { Component, inject, input, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { OTHER_SITE_URL } from '@charity/shared/di/tokens';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';

import { SettingsBarComponent } from './settings-bar';

/**
 * The site header: brand, primary menu, the language/theme controls and the
 * mobile menu button. Rendered once, above `<router-outlet>`, so it is identical
 * on every page - which is what the legacy js/nav.js achieved by writing the same
 * markup into every document.
 *
 * Menu destinations, and why they are these three:
 *   Home          the landing page with the About and Contact sections
 *   Search Events the filter form and the results
 *   Admin site    the OTHER_SITE_URL token, i.e. the separate staff website
 *
 * There is deliberately no "Register" item. Registration is per event, so a
 * global link would have no subject: it could only ask the visitor to pick an
 * event first, which is exactly what Home and Search already do. The Register
 * button on an event's own page carries the event id.
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
  selector: 'app-site-header',
  imports: [RouterLink, RouterLinkActive, SettingsBarComponent, TranslatePipe],
  templateUrl: './site-header.html',
  styleUrl: './site-header.css',
})
export class SiteHeaderComponent {
  protected readonly i18n = inject(TranslationService);

  /**
   * Whether to render the primary menu.
   *
   * The 404 route passes `false`: a menu of links to pages the visitor was not
   * looking for is noise on an error page, but the language and theme controls
   * still matter, so the header itself stays. A signal input (not a plain
   * `@Input()`) because Angular 22's signal inputs are typed and give the
   * template a plain value to read without a `strictTemplates` null check.
   */
  readonly showNav = input(true);

  /** The admin (or, from the admin site, client) URL, provided in app.config.ts. */
  protected readonly otherSiteUrl = inject(OTHER_SITE_URL);

  /**
   * Whether the mobile menu is open.
   *
   * A signal rather than a class toggled by hand: the header is zoneless, so DOM
   * state written outside a signal would not repaint the template. Below 760px
   * the stylesheet hides `.site-nav` and shows it again only with
   * `.site-nav--open`, so all this has to do is decide whether that class is on.
   */
  protected readonly menuOpen = signal(false);

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  /** Close the menu after a navigation, so it does not cover the new page. */
  protected closeMenu(): void {
    this.menuOpen.set(false);
  }
}
