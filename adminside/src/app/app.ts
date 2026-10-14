import { DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AdminFooter } from './layout/admin-footer/admin-footer';
import { AdminHeader } from './layout/admin-header/admin-header';

/**
 * adminside/src/app/app.ts
 * ---------------------------------------------------------------------------
 * The application shell: the header and the menu, the content area the router
 * fills, and the footer.
 *
 * WHY THE SHELL OWNS THE LAYOUT
 *   The archived admin site had every page call initAdminLayout() to build the
 *   same header and menu, and the brief requires that menu "on all pages". Here
 *   the shell renders it once, so a page physically cannot be missing it - and the
 *   pages themselves contain only their own content.
 *
 * The <body> class is set here rather than in index.html for a reason: Angular
 * renders INSIDE <body>, so index.html cannot put a class on an element it does
 * not own. Two rules in the admin stylesheet are written against
 * `body.admin-body` (the page background and the admin page heading), so the class
 * has to exist before the first page paints - which a constructor-time write does.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AdminHeader, AdminFooter],
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private readonly document = inject(DOCUMENT);

  constructor() {
    this.document.body.classList.add('admin-body');
  }
}
