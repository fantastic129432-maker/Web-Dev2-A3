import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { OTHER_SITE_URL } from '@charity/shared/di/tokens';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';

import { ApiStatusComponent } from '../shared/api-status';

/**
 * The site footer. Rendered once, below `<router-outlet>`, so every page ends
 * with the same three columns: who we are, where to go, and what this project is.
 *
 * The contact details are the same fictional values the legacy footer and the
 * home page's Contact section used (hello@unityheart.org.au, (02) 6620 1001,
 * Lismore NSW), and they are translation keys rather than literals so the footer
 * follows the language switcher like the rest of the interface.
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
