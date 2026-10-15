import { Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslationService } from '@charity/shared/i18n/translation.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';

import { SettingsBarComponent } from './settings-bar';
import { SiteNavComponent } from './site-nav/site-nav';

/**
 * The site header: the HEADER segment of the four every page shares (Header, Nav,
 * Body, Footer), holding the brand and the language/theme controls, and rendering
 * the NAV segment inside its own `<header>` landmark.
 *
 * WHAT IS IN IT, AND WHAT IS NOT
 *   The brand, the settings bar and the mobile menu button. The menu itself is
 *   `app-site-nav`, a component of its own: see that file for why the three
 *   destinations are Home, Search Events and Admin site, and for why the menu lives
 *   in this header rather than beside it in the shell. The component is rendered
 *   once, above `<router-outlet>`, so it is identical on every page - which is what
 *   the legacy js/nav.js achieved by writing the same markup into every document.
 *
 * WHY THE HEADER STILL OWNS `showNav` AND `menuOpen`
 *   Both pieces of state describe the header's own controls. `showNav` is the shell's
 *   instruction ("this route does not want a menu") and the header forwards it to the
 *   nav; `menuOpen` is the answer to the hamburger button, which is a child of this
 *   template because that is the position the layout stylesheet gives it. Keeping the
 *   button and the state here, and pushing the result down as an input, means the nav
 *   component holds no state of its own and the two can never disagree. The admin
 *   header forwards `showNav` the same way; it has no menu button, because the admin
 *   menu is always visible, so it has no `menuOpen` either.
 */
@Component({
  selector: 'app-site-header',
  imports: [RouterLink, SettingsBarComponent, SiteNavComponent, TranslatePipe],
  templateUrl: './site-header.html',
  styleUrl: './site-header.css',
})
export class SiteHeaderComponent {
  protected readonly i18n = inject(TranslationService);

  /**
   * Whether the page wants the primary menu.
   *
   * The 404 route passes `false`: a menu of links to pages the visitor was not
   * looking for is noise on an error page, but the language and theme controls
   * still matter, so the header itself stays. Forwarded unchanged to
   * `app-site-nav`, which is the component that decides whether to render the
   * `<nav>`. A signal input (not a plain `@Input()`) because Angular 22's signal
   * inputs are typed and give the template a plain value to read without a
   * `strictTemplates` null check.
   */
  readonly showNav = input(true);

  /**
   * Whether the mobile menu is open.
   *
   * A signal rather than a class toggled by hand: the header is zoneless, so DOM
   * state written outside a signal would not repaint the template. Below 760px the
   * global stylesheet hides `.site-nav` and shows it again only with
   * `.site-nav--open`, so all this state has to do is decide whether that class is
   * on - which the nav component applies from its `menuOpen` input.
   */
  protected readonly menuOpen = signal(false);

  /** Flip the mobile menu: the click handler on the header's menu button. */
  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  /**
   * Close the menu after a navigation, so it does not cover the new page.
   *
   * Wired to the nav component's `linkActivated` output rather than to a `click` on
   * markup this template does not own any more.
   */
  protected closeMenu(): void {
    this.menuOpen.set(false);
  }
}
