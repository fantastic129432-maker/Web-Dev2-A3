import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { OTHER_SITE_URL } from '@charity/shared/di/tokens';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';

import { ApiStatusComponent } from '../shared/api-status';

/**
 * The site footer. Rendered once, below `<router-outlet>`, so every page ends
 * with the same three columns: who we are, where to go, and what we do - plus the
 * bottom bar carrying the copyright, the assessment notice and the live API
 * indicator.
 *
 * THE THIRD COLUMN IS NO LONGER THE PROJECT NOTE (review item E1)
 *   It used to be headed "Student project" and held nothing but the academic
 *   disclaimer, which gave a course assessment the same column weight as the
 *   charity beside it. The disclaimer now sits as a small muted line beside the
 *   copyright in the bottom bar - still visible, still in the accessibility tree,
 *   still the same two dictionary keys - and the column carries the
 *   organisation's mission instead (`about.heading` and `about.mission`, the same
 *   two keys the home page's About section uses). The admin link moved with it so
 *   it is not lost.
 *
 * THE SINGLE HOME FOR CONTACT DETAILS
 *   These are the same fictional values the legacy footer and the home page's
 *   Contact section used (hello@unityheart.org.au, (02) 6620 1001, Lismore NSW).
 *   The home page's white "Get in touch" section repeated them a couple of hundred
 *   pixels above this column, so it was removed and this footer became the one
 *   place they appear; `id="contact"` on the `<footer>` element is what keeps the
 *   About section's "Talk to our events team" fragment link pointing at a real
 *   element rather than at the section that no longer exists. They deliberately
 *   did NOT also move into the new third column: two columns carrying the same
 *   email address is the duplication this structure exists to prevent.
 *
 *   The heading, the address and the hours are translation keys, so they follow the
 *   language switcher like the rest of the interface. The email address and the
 *   phone number are literals, because they are the same text in every language and
 *   a translated email address would not resolve.
 *
 * The live API indicator is a child component (`app-api-status`) that calls
 * `GET /api/health`. It is deliberately NOT part of this component: it is the
 * only thing here with state, and keeping the request in its own component means
 * a health-check failure can never leave the rest of the footer blank.
 *
 * The copyright year is read from the system clock rather than hard-coded, so the
 * footer does not silently go stale.
 */
@Component({
  selector: 'app-site-footer',
  imports: [RouterLink, ApiStatusComponent, TranslatePipe],
  templateUrl: './site-footer.html',
  styleUrl: './site-footer.css',
})
export class SiteFooterComponent {
  /** The admin site, provided in app.config.ts. */
  protected readonly otherSiteUrl = inject(OTHER_SITE_URL);

  /** The current year for the copyright line. */
  protected readonly year = new Date().getFullYear();
}
