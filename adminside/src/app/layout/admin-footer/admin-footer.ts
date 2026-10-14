/**
 * adminside/src/app/layout/admin-footer/admin-footer.ts
 * ---------------------------------------------------------------------------
 * The footer on every page, including the one fact the archived admin site also
 * put there: which DATA SOURCE the API is answering from.
 *
 * WHY THE FOOTER ASKS THE API ITSELF
 *   "local" means the API is serving its in-memory mirror of the seed file and
 *   "mysql" means it is connected to a real database, and that difference is what
 *   a demonstration or a marker most often needs to know. The footer is the one
 *   place every page shares, so it is asked once here rather than on each page.
 *
 *   It calls GET /api/health. A failure is NOT an error the person has to act on -
 *   the footer simply says the API could not be reached (the error.offline key),
 *   which is genuinely useful information and needs no dialog.
 */
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ApiService } from '@charity/shared/api/api.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';

@Component({
  selector: 'admin-footer',
  imports: [TranslatePipe],
  styleUrl: './admin-footer.css',
  templateUrl: './admin-footer.html',
})
export class AdminFooter {
  private readonly api = inject(ApiService);

  /**
   * The data source the API reported ("local" or "mysql"), or null while the
   * request is in flight / after it failed.
   */
  protected readonly dataSource = signal<string | null>(null);

  /** True when GET /api/health could not be reached. */
  protected readonly unreachable = signal(false);

  /**
   * The year is computed rather than written into the template so the copyright
   * line cannot go stale, which is exactly what the archived footer did with
   * #admin-year.
   */
  protected readonly year = new Date().getFullYear();

  constructor() {
    this.api
      .getHealth()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (health) => this.dataSource.set(health.database.driver),
        error: () => this.unreachable.set(true),
      });
  }
}
