/**
 * adminside/src/app/layout/admin-header/admin-header.ts
 * ---------------------------------------------------------------------------
 * The site header AND the menu, present on every page of the admin website.
 *
 * THE MENU IS THE BRIEF'S REQUIREMENT
 *   "Implement a clear and functional menu that allows users to navigate
 *   seamlessly to the other required pages. This menu must be present on all
 *   pages." The archived admin site satisfied it by having every page call
 *   initAdminLayout(), which built the same menu from one array. In Angular that
 *   becomes one component rendered once by the application shell (app.html), so a
 *   new page CANNOT forget the menu - it is not part of any page's template.
 *
 * WHAT THE MENU CONTAINS
 *   Dashboard, Events, Add event, Registrations - the four pages this
 *   application has - plus a link back to the public website. The link uses the
 *   OTHER_SITE_URL injection token rather than a hard-coded path: the admin site
 *   is served from /admin/ in production and the public site from /, so the
 *   address differs per environment and is decided by environments/*.ts.
 *
 * The language and theme controls live here too, which is why they are also on
 * every page. Both write through the SHARED services, so the choice made here is
 * the same localStorage entry the public website reads - the two sites cannot
 * end up in different languages or themes.
 *
 * No API endpoint is called by this component.
 */
import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { OTHER_SITE_URL } from '@charity/shared/di/tokens';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import { ThemeService } from '@charity/shared/theme/theme.service';

/** One menu entry: the route and the translation key of its label. */
interface NavItem {
  readonly path: string;
  readonly labelKey: string;
}

@Component({
  selector: 'admin-header',
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  styleUrl: './admin-header.css',
  templateUrl: './admin-header.html',
})
export class AdminHeader {
  private readonly i18n = inject(TranslationService);
  private readonly theme = inject(ThemeService);

  /** Absolute URL of the public website; "/" under the production baseHref. */
  protected readonly otherSiteUrl = inject(OTHER_SITE_URL);

  /** The four pages, in the order the archived admin menu listed them. */
  protected readonly navItems: readonly NavItem[] = [
    { path: '/', labelKey: 'nav.dashboard' },
    { path: '/events', labelKey: 'nav.events' },
    { path: '/events/new', labelKey: 'nav.new' },
    { path: '/registrations', labelKey: 'nav.registrations' },
  ];

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
