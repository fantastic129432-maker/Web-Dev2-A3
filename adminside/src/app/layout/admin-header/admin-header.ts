import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { OTHER_SITE_URL } from '@charity/shared/di/tokens';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import { ThemeService } from '@charity/shared/theme/theme.service';

import { AdminNav } from '../admin-nav/admin-nav';

/**
 * The admin header: the HEADER segment of the four every admin page shares (Header,
 * Nav, Body, Footer), holding the brand, the link back to the public website and the
 * language/theme controls, and rendering the NAV segment below its own band.
 *
 * WHAT IS IN IT, AND WHAT IS NOT
 *   The menu is `admin-nav`, a component of its own: see that file for the four
 *   destinations, for the brief's "menu on all pages" requirement and for why the
 *   menu is a file of its own. Everything here is chrome that is not navigation.
 *
 * THE CONTROLS ARE HERE, SO THEY ARE ON EVERY PAGE
 *   The language picker and the theme button live in this header, which the shell
 *   renders once, so both are on every admin screen. Both write through the SHARED
 *   services, so the choice made here is the same localStorage entry the public
 *   website reads - the two sites cannot end up in different languages or themes.
 *
 * WHY THE HEADER OWNS `showNav`
 *   The shell talks to the header, and the header forwards the value to the menu -
 *   the same wiring the public website's `site-header`/`site-nav` pair uses, so the
 *   two applications can be read side by side. No admin route asks for the menu to
 *   be hidden; the input exists because the two shells are deliberately identical in
 *   shape.
 *
 * No API endpoint is called by this component.
 */
@Component({
  selector: 'admin-header',
  imports: [RouterLink, AdminNav, TranslatePipe],
  styleUrl: './admin-header.css',
  templateUrl: './admin-header.html',
})
export class AdminHeader {
  private readonly i18n = inject(TranslationService);
  private readonly theme = inject(ThemeService);

  /** Absolute URL of the public website; "/" under the production baseHref. */
  protected readonly otherSiteUrl = inject(OTHER_SITE_URL);

  /**
   * Whether the menu should be rendered.
   *
   * Forwarded unchanged to `admin-nav`, which renders the `<nav>`. The admin site has
   * no route that hides the menu - the brief requires it on every page - so nothing
   * currently passes `false`; see the class comment for why the input is here anyway.
   */
  readonly showNav = input(true);

  /** The four supported languages, and the active one. */
  protected readonly languages = this.i18n.languages;
  protected readonly language = this.i18n.language;

  /**
   * The theme button's own label: the current PREFERENCE, not the resolved
   * theme. Otherwise "system" would be indistinguishable from whichever theme it
   * currently resolves to, and the three-state control would look like a
   * two-state one. ThemeService supplies the key; the pipe translates it, so the
   * label follows the language switcher.
   */
  protected readonly themeLabelKey = computed(() => this.theme.labelKey());

  /** Switch language: TranslationService updates a signal, every page re-renders. */
  protected selectLanguage(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.i18n.set(select.value);
  }

  /** Cycle light -> dark -> system, the same order the public website uses. */
  protected cycleTheme(): void {
    this.theme.cycle();
  }
}
