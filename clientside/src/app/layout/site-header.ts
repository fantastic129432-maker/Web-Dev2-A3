import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterNextRender, inject, input, signal, viewChild } from '@angular/core';
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
 *
 * WHY THE HEADER MEASURES ITSELF AND PUBLISHES ITS HEIGHT
 *   This header is sticky, so every sticky card in the page under it has to come to
 *   rest clear of its bottom edge - and that height is not the same in all four
 *   languages, because the nav labels and the settings note wrap onto more lines
 *   once the header row runs out of room. Measured in a 1000px-tall window:
 *   65.31px in English and 85.02px in Chinese at every two-column width, and in
 *   Vietnamese and Japanese 89.63px at 1400px wide against 113.94px and 162.56px at
 *   1024px wide, the narrowest window the two-column layouts are used at. The three
 *   sticky cards used to share a written `top: 96px` derived from the English
 *   height, so at 1024px their top edge came to rest 17.94px (Vietnamese) and
 *   66.56px (Japanese) BEHIND the header. The height is therefore read from the
 *   real element and written to `--site-header-height` on the document element
 *   (`:root` in clientside/src/styles.css carries the English fallback used before
 *   the first measurement, and the whole table), and the cards compute their offset
 *   from it. A ResizeObserver rather than a window `resize` listener is what makes
 *   the value follow a language switch, a font swap or any other reflow of this
 *   row, none of which the window fires an event for.
 */
@Component({
  selector: 'app-site-header',
  imports: [RouterLink, SettingsBarComponent, SiteNavComponent, TranslatePipe],
  templateUrl: './site-header.html',
  styleUrl: './site-header.css',
})
export class SiteHeaderComponent {
  protected readonly i18n = inject(TranslationService);

  /** The document whose root carries the measured header height. */
  private readonly document = inject(DOCUMENT);

  /** This component's lifetime, which is what disconnects the observer. */
  private readonly destroyRef = inject(DestroyRef);

  /** The `<header>` element itself, so its real height can be measured. */
  private readonly headerBox = viewChild.required<ElementRef<HTMLElement>>('headerBox');

  constructor() {
    /*
     * Measured AFTER the first render, because the height is only real once the
     * element is in the document, and re-measured on every resize of the element
     * itself. The fallback in the stylesheet is the English height, so the one frame
     * before this runs is a third of a pixel away from the value it writes.
     */
    afterNextRender(() => {
      const element = this.headerBox().nativeElement;
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
