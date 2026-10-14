/**
 * adminside/src/app/pages/dashboard/dashboard.ts
 * ---------------------------------------------------------------------------
 * The landing page: the state of the event programme at a glance, the API's
 * health, and the way in to the three working pages.
 *
 * ENDPOINTS
 *   GET /api/stats          the headline counts (upcoming events, categories,
 *                           organisations, total raised, registrations, tickets
 *                           sold). Used INSTEAD of the archived page's habit of
 *                           counting the event list in the browser: the API
 *                           already computes these, and counting rows client-side
 *                           only works while the list fits in one page.
 *   GET /api/health         which data source is answering (DATA_SOURCE=local or
 *                           mysql), whether the database is connected, how many
 *                           tables it has, and whether the Assessment 3
 *                           registrations table exists.
 *   GET /api/registrations  the five most recent registrations.
 *
 * The two failures are handled separately on purpose: a dead /health must not
 * blank a dashboard whose statistics loaded perfectly well, so the health panel
 * reports its own state and the rest of the page carries on.
 */
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { ApiService } from '@charity/shared/api/api.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import type { HealthReport, EventStats } from '@charity/shared/models/reference.model';
import type { Registration } from '@charity/shared/models/registration.model';
import { formatCurrency, formatDateTime } from '@charity/shared/util/format';

import { errorBanner, type Banner } from '../../core/feedback';import { usePageTitle } from '../../core/page-title';
import { FeedbackBanner } from '../../shared/feedback-banner/feedback-banner';

/** One statistic tile. `tone` picks the admin-stat--* accent colour. */
interface StatTile {
  readonly value: string;
  readonly labelKey: string;
  readonly tone: 'brand' | 'ok' | 'warn' | 'muted';
}

/** One label/value row of the health panel. */
interface HealthRow {
  readonly labelKey: string;
  readonly value: string;
}

@Component({
  selector: 'admin-dashboard',
  imports: [RouterLink, TranslatePipe, FeedbackBanner],
  styleUrl: './dashboard.css',
  templateUrl: './dashboard.html',
})
export class Dashboard {
  private readonly api = inject(ApiService);
  private readonly i18n = inject(TranslationService);

  protected readonly stats = signal<EventStats | null>(null);
  protected readonly health = signal<HealthReport | null>(null);
  protected readonly recent = signal<readonly Registration[]>([]);
  protected readonly loading = signal(true);
  protected readonly banner = signal<Banner | null>(null);

  /** Exposed to the template: money is formatted the same way everywhere. */
  protected readonly formatCurrency = formatCurrency;

  /** True when GET /api/health could not be reached; the panel says so. */
  protected readonly healthUnreachable = signal(false);

  /**
   * The six numbers the brief asks the dashboard for, in two rows: what is
   * coming up, then what it has produced. Money is rendered with the shared
   * formatCurrency so it matches every other total in the project.
   */
  protected readonly tiles = computed<readonly StatTile[]>(() => {
    const value = this.stats();
    if (!value) return [];

    return [
      { value: String(value.upcomingEvents), labelKey: 'dash.upcoming', tone: 'brand' },
      { value: String(value.categories), labelKey: 'dash.categories', tone: 'muted' },
      { value: String(value.organizations), labelKey: 'dash.organizations', tone: 'muted' },
      { value: formatCurrency(value.totalRaised), labelKey: 'dash.totalRaised', tone: 'ok' },
      { value: String(value.registrations), labelKey: 'dash.registrations', tone: 'brand' },
      { value: String(value.ticketsSold), labelKey: 'dash.ticketsSold', tone: 'warn' },
    ];
  });

  /**
   * The health report as label/value rows.
   *
   * `connected` is `boolean | null` - null means the driver could not report it -
   * so a null is shown as "-" rather than as "No", which would be a claim the
   * API did not make.
   */
  protected readonly healthRows = computed<readonly HealthRow[]>(() => {
    const report = this.health();
    if (!report) return [];

    const database = report.database;
    const yesNo = (flag: boolean | null | undefined): string =>
      flag === null || flag === undefined ? '-' : this.i18n.t(flag ? 'health.yes' : 'health.no');

    return [
      { labelKey: 'admin.dataSource', value: database.driver },
      { labelKey: 'health.database', value: database.database },
      { labelKey: 'health.connected', value: yesNo(database.connected) },
      {
        labelKey: 'health.tableCount',
        value: database.tableCount === undefined ? '-' : String(database.tableCount),
      },
      { labelKey: 'health.registrationTable', value: yesNo(database.registrationTable) },
    ];
  });

  constructor() {
    usePageTitle('dash.heading');

    // The statistics and the recent registrations are needed together before the
    // page can be drawn, so they are requested together.
    forkJoin({
      stats: this.api.getStats(),
      recent: this.api.getRegistrations({ limit: 5 }),
    })
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: ({ stats, recent }) => {
          this.stats.set(stats);
          this.recent.set(recent.items);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.banner.set(errorBanner(error, this.i18n.t, this.i18n.t('error.heading')));
        },
      });

    // Reported separately: see the class comment.
    this.api
      .getHealth()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (report) => this.health.set(report),
        error: () => this.healthUnreachable.set(true),
      });
  }

  /** The timestamp of a registration, in the visitor's locale. */
  protected when(registration: Registration): string {
    return formatDateTime(registration.registeredAt);
  }
}
