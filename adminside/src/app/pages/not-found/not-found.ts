/**
 * adminside/src/app/pages/not-found/not-found.ts
 * ---------------------------------------------------------------------------
 * The page for a URL that matches no route ("/**").
 *
 * A single-page application answers this case in the browser rather than with a
 * server 404, so without this route a mistyped or stale admin URL would render an
 * empty shell - no header context beyond the menu, no explanation. It calls no API.
 */
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';

import { usePageTitle } from '../../core/page-title';

@Component({
  selector: 'admin-not-found',
  imports: [RouterLink, TranslatePipe],
  styleUrl: './not-found.css',
  templateUrl: './not-found.html',
})
export class NotFound {
  constructor() {
    usePageTitle('notFound.heading');
  }
}
