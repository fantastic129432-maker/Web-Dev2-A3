import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';

import { useDocumentTitle } from '../../shared/page-title';

/**
 * The wildcard route's page: a friendly "nothing here" screen.
 *
 * This is the one page with no API call at all. It exists because the public site
 * is a single-page application: a server would have answered a mistyped address
 * with its own 404 document, but here the router catches the unknown path and this
 * component is what the visitor sees instead of a blank screen or the home page
 * pretending nothing happened.
 *
 * WHY IT OFFERS TWO ROUTES BACK RATHER THAN ONE
 *   "Home" and "Search" are the two things a visitor who mistyped a URL is most
 *   likely to have wanted, and they are the only two pages that list events. The
 *   site menu is hidden on this route (see App), so these buttons are the way back.
 *
 * The title comes from the route's `data.titleKey` ('notFound.title'), which is
 * what makes the browser tab say "Page not found" rather than the site name.
 */
@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './not-found.html',
})
export class NotFoundPage {
  /** Tab title, from the route's `data.titleKey` ('notFound.title'). */
  private readonly title = useDocumentTitle();

  constructor() {
    this.title.set();
  }
}
