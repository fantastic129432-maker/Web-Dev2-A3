import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { ApiService } from '@charity/shared/api/api.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import { TranslationService, type TranslationValues } from '@charity/shared/i18n/translation.service';
import type { Event as CharityEvent } from '@charity/shared/models/event.model';
import type { HealthReport, EventStats } from '@charity/shared/models/reference.model';
import type { Registration } from '@charity/shared/models/registration.model';
import { formatCurrency, formatDateTime, formatShortDate } from '@charity/shared/util/format';

import { banner, errorBanner, type Banner } from '../../core/feedback';
import { usePageTitle } from '../../core/page-title';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { FeedbackBanner } from '../../shared/feedback-banner/feedback-banner';

/** How many recent registrations the bottom table carries. */
const RECENT_LIMIT = 5;

/** How many needs-attention entries the card lists before it counts the rest. */
const ATTENTION_LIMIT = 4;

/** How many days ahead counts as "starting soon" for the no-registrations rule. */
const STARTING_SOON_DAYS = 7;

/**
 * One statistic tile.
 *
 * The tiles no longer carry a `tone`. The thin coloured bar they used to draw was
 * decorative - green for money, amber for tickets sold, teal for two of the
 * counts - and none of those colours meant anything a reader could name, so the
 * six figures are now told apart by their label alone. See the class comment.
 */
interface StatTile {
  readonly value: string;
  readonly labelKey: string;
}

/** One label/value row of the health panel. */
interface HealthRow {
  readonly labelKey: string;
  readonly value: string;
}

/**
 * Why an event is on the needs-attention list.
 *
 * The union is closed on purpose: every member has a label, an explanatory
 * sentence and an icon in the template, so a new rule with no wording cannot be
 * added by accident.
 */
type AttentionReason = 'soldOut' | 'notPublished' | 'noRegistrations';

/** One event the dashboard wants a staff member to look at, with its reason. */
interface AttentionItem {
  /** Primary key of the event, used by the link and by the @for track. */
  readonly eventId: number;
  /** The event's stored name. */
  readonly eventName: string;
  /** The rule that matched; the template chooses the icon from it. */
  readonly reason: AttentionReason;
  /** Translation key of the short label, for example "At capacity". */
  readonly labelKey: string;
  /** Translation key of the sentence that explains that label. */
  readonly detailKey: string;
  /** Values substituted into `detailKey`, such as the capacity or the date. */
  readonly detailValues: TranslationValues;
}

/** The three states the compact health card's status line can report. */
type HealthState = 'ok' | 'degraded' | 'down';

/**
 * The landing page: the state of the event programme at a glance, the events that
 * need a decision, the API's health, and the five most recent registrations.
 *
 * ENDPOINTS
 *   GET /api/stats           the headline counts (upcoming events, categories,
 *                            organisations, total raised, registrations, tickets
 *                            sold). Used INSTEAD of the archived page's habit of
 *                            counting the event list in the browser: the API
 *                            already computes these, and counting rows client-side
 *                            only works while the list fits in one page.
 *   GET /api/admin/events    every event whatever its publishing status, which is
 *                            what the needs-attention list is derived from: the
 *                            response already carries the publishing status, the
 *                            capacity, the registration and ticket counts and the
 *                            dates, so no new endpoint was needed for it.
 *   GET /api/health          which data source is answering (DATA_SOURCE=local or
 *                            mysql), whether the database is connected, how many
 *                            tables it has, and whether the Assessment 3
 *                            registrations table exists.
 *   GET /api/registrations   the five most recent registrations.
 *   DELETE /api/registrations/:id   the row's Cancel action.
 *
 * WHY THE PAGE LOOKS LIKE THIS
 *   The quick-action block ("What do you want to do?") is gone. Its three cards
 *   pointed at /events/new, /events and /registrations - the same three
 *   destinations as the admin menu less than 200px above them - so it was
 *   navigation repeated as content while occupying the prime position under the
 *   statistics. The space it used now carries what the statistics cannot say:
 *   which events have a problem.
 *
 *   The health report is business information only to whoever is debugging, so it
 *   became a compact card in a two-column row instead of a full-width table whose
 *   values stopped around 45% and left half the card empty. It keeps a status
 *   line, three facts, and the complete report one disclosure away, so nothing
 *   that was on the page before has been lost - only re-prioritised.
 *
 *   The six tiles are a 3x2 grid rather than one row of six: at 1440px six
 *   columns leave 219px each and the first value that is not a small integer
 *   ("$99,290") is squeezed; three columns leave the value room at every width the
 *   admin site is used at, and the two rows also separate the six figures the way
 *   the brief describes them - what is coming up, then what it has produced.
 *
 *   The failures are handled in two groups on purpose: a dead /health must not
 *   blank a dashboard whose statistics loaded perfectly well, so the health panel
 *   reports its own state and the rest of the page carries on. The three requests
 *   whose figures the page is built from are asked for together instead, because
 *   they come from the same repository and splitting them would only add a second
 *   failure mode to explain.
 */
@Component({
  selector: 'admin-dashboard',
  imports: [RouterLink, TranslatePipe, FeedbackBanner, ConfirmDialog],
  styleUrl: './dashboard.css',
  templateUrl: './dashboard.html',
})
export class Dashboard {
  private readonly api = inject(ApiService);
  private readonly i18n = inject(TranslationService);
  private readonly destroyRef = inject(DestroyRef);

  /** The headline statistics, or null before they arrive. */
  protected readonly stats = signal<EventStats | null>(null);

  /** The API's health report, or null before it arrives. */
  protected readonly health = signal<HealthReport | null>(null);

  /** The five most recent registrations, newest first. */
  protected readonly recent = signal<readonly Registration[]>([]);

  /**
   * Every event the admin list returns, whatever its status: the source the
   * needs-attention card is derived from.
   */
  protected readonly events = signal<readonly CharityEvent[]>([]);

  /** True until the statistics, the events and the recent registrations have settled. */
  protected readonly loading = signal(true);

  /** The page-level failure message, or null when nothing has failed. */
  protected readonly banner = signal<Banner | null>(null);

  /** Exposed to the template: money is formatted the same way everywhere. */
  protected readonly formatCurrency = formatCurrency;

  /** True when GET /api/health could not be reached; the panel says so. */
  protected readonly healthUnreachable = signal(false);

  /** The registration awaiting confirmation, or null when no dialog is open. */
  protected readonly pendingDelete = signal<Registration | null>(null);

  /** True while the DELETE is in flight, so the dialog's button cannot repeat it. */
  protected readonly deleting = signal(false);

  /**
   * The six numbers the brief asks the dashboard for, in two rows: what is
   * coming up, then what it has produced. Money is rendered with the shared
   * formatCurrency so it matches every other total in the project.
   *
   * WHY TWO OF THEM CAN INCLUDE A SUSPENDED EVENT'S FIGURES
   *   GET /api/stats does not count all six from the same place, and that is
   *   deliberate. `upcomingEvents`, `totalRaised` and the two reference counts
   *   come from the PUBLIC view, which is fixed to `status = 'active'`, so a
   *   suspended event and the money raised for it are excluded - the same rule
   *   that hides it from the public website. `registrations` and `ticketsSold`
   *   come from the registrations table itself, which has no status filter, so
   *   they DO include registrations taken before an event was suspended: those
   *   people registered, and a staff member clearing the event needs to see
   *   them. Anything that reads these two numbers has to expect that difference,
   *   which is also why the needs-attention card below can list a suspended
   *   event that `upcomingEvents` does not count.
   */
  protected readonly tiles = computed<readonly StatTile[]>(() => {
    const value = this.stats();
    if (!value) return [];

    return [
      { value: String(value.upcomingEvents), labelKey: 'dash.upcoming' },
      { value: String(value.categories), labelKey: 'dash.categories' },
      { value: String(value.organizations), labelKey: 'dash.organizations' },
      { value: formatCurrency(value.totalRaised), labelKey: 'dash.totalRaised' },
      { value: String(value.registrations), labelKey: 'dash.registrations' },
      { value: String(value.ticketsSold), labelKey: 'dash.ticketsSold' },
    ];
  });

  /**
   * The health card's status line: which state to draw, and which label to show.
   *
   * Only `connected === false` degrades the card. `connected` is `boolean | null`
   * and null means the driver could not report it, which is not a claim that the
   * database is down; the fact rows below print "-" for that case (see
   * healthRows), so the status line must not turn it into an alarm.
   */
  protected readonly healthStatus = computed<{ state: HealthState; labelKey: string }>(() => {
    const database = this.healthUnreachable() ? null : this.health()?.database;
    if (!database) return { state: 'down', labelKey: 'health.statusDown' };
    if (database.connected === false) return { state: 'degraded', labelKey: 'health.statusDegraded' };
    return { state: 'ok', labelKey: 'health.statusOk' };
  });

  /**
   * The three facts the compact health card shows.
   *
   * Chosen for what a staff member or a marker asks first - which data source
   * answered, whether the database is connected, and how many tables it has. The
   * two remaining facts are not dropped: healthRows carries the complete report
   * and the card renders it behind its "Developer details" disclosure.
   */
  protected readonly healthFacts = computed<readonly HealthRow[]>(() => {
    const report = this.health();
    if (!report) return [];

    return [
      { labelKey: 'admin.dataSource', value: report.database.driver },
      { labelKey: 'health.connected', value: this.yesNo(report.database.connected) },
      {
        labelKey: 'health.tableCount',
        value: report.database.tableCount === undefined ? '-' : String(report.database.tableCount),
      },
    ];
  });

  /**
   * The complete health report as label/value rows, for the debugging disclosure.
   *
   * `connected` is `boolean | null` - null means the driver could not report it -
   * so a null is shown as "-" rather than as "No", which would be a claim the
   * API did not make. This list must stay complete: it is where the facts that no
   * longer fit the compact card are still available.
   */
  protected readonly healthRows = computed<readonly HealthRow[]>(() => {
    const report = this.health();
    if (!report) return [];

    const database = report.database;

    return [
      { labelKey: 'admin.dataSource', value: database.driver },
      { labelKey: 'health.database', value: database.database },
      { labelKey: 'health.connected', value: this.yesNo(database.connected) },
      {
        labelKey: 'health.tableCount',
        value: database.tableCount === undefined ? '-' : String(database.tableCount),
      },
      { labelKey: 'health.registrationTable', value: this.yesNo(database.registrationTable) },
    ];
  });

  /**
   * Every event that needs attention, before the card caps the list.
   *
   * The rules and their order are documented on attentionFor; this computed only
   * walks the events and keeps the matches.
   */
  private readonly allAttention = computed<readonly AttentionItem[]>(() => {
    const found: AttentionItem[] = [];
    for (const event of this.events()) {
      const item = this.attentionFor(event);
      if (item) found.push(item);
    }
    return found;
  });

  /** The needs-attention entries the card lists. */
  protected readonly attention = computed<readonly AttentionItem[]>(() =>
    this.allAttention().slice(0, ATTENTION_LIMIT)
  );

  /** How many further events need attention beyond the ones listed. */
  protected readonly attentionMore = computed(() => Math.max(0, this.allAttention().length - ATTENTION_LIMIT));

  constructor() {
    usePageTitle('dash.heading');

    // loading() starts true, so the spinner is already on screen.
    this.load();

    // Reported separately: see the class comment.
    this.api
      .getHealth()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => this.health.set(report),
        error: () => this.healthUnreachable.set(true),
      });
  }

  /* -------------------------------------------------------------- loading ---- */

  /**
   * Read the three things the page's own figures come from, together.
   *
   * The statistics, the admin event list and the recent registrations are all
   * needed before the page can be drawn, so they are requested together rather
   * than one after another. Called from the constructor, and again after a
   * registration is cancelled so no figure on the page still counts it.
   */
  private load(): void {
    forkJoin({
      stats: this.api.getStats(),
      events: this.api.getAdminEvents({ limit: 100, state: 'all', publishStatus: 'all' }),
      recent: this.api.getRegistrations({ limit: RECENT_LIMIT }),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ stats, events, recent }) => {
          this.stats.set(stats);
          this.events.set(events.items);
          this.recent.set(recent.items);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.banner.set(errorBanner(error, this.i18n.t, this.i18n.t('error.heading')));
        },
      });
  }

  /* --------------------------------------------------- needs attention ------- */

  /**
   * Decide whether one event needs attention, and why.
   *
   * THE RULES, TESTED IN THIS ORDER; the first match wins, so an event is listed
   * once even when two rules would both catch it:
   *
   *   1. AT CAPACITY - a capacity is recorded and the tickets sold have reached
   *      it, so the next registration would be refused or oversold. Reads
   *      `capacity` and `ticketsSold`.
   *   2. NOT PUBLISHED - the publishing status is `suspended` or `cancelled`, so
   *      the event is invisible on the public website and is either waiting for a
   *      decision or has already had one. Reads `status`.
   *   3. STARTING SOON WITH NOBODY REGISTERED - `upcoming`, no registrations at
   *      all, and within STARTING_SOON_DAYS of its start date, which is the point
   *      at which an empty registration list stops being early. Reads `eventState`,
   *      `registrationCount` and the dates, and needs "today" (see today()).
   *
   * Rules that the response cannot support were dropped rather than invented: the
   * admin list carries no per-event donation target or tickets-remaining figure,
   * so "under-subscribed" and "nearly sold out" have nothing to compare against,
   * and there is no endpoint that would supply one without being invented too.
   *
   * @param event - One row of GET /api/admin/events.
   * @returns The reason and its wording, or null when the event needs nothing.
   */
  private attentionFor(event: CharityEvent): AttentionItem | null {
    const base = { eventId: event.eventId, eventName: event.eventName };

    const capacity = Number(event.capacity ?? 0);
    const ticketsSold = Number(event.ticketsSold ?? 0);
    if (event.capacity !== null && event.capacity !== undefined && capacity > 0 && ticketsSold >= capacity) {
      return {
        ...base,
        reason: 'soldOut',
        labelKey: 'dash.attentionSoldOut',
        detailKey: 'dash.attentionSoldOutDetail',
        detailValues: { capacity, sold: ticketsSold },
      };
    }

    if (event.status === 'suspended' || event.status === 'cancelled') {
      return {
        ...base,
        reason: 'notPublished',
        // The status labels already exist for the event list's status filter, so
        // the badge here reads exactly as it does there.
        labelKey: `status.${event.status}`,
        detailKey: 'dash.attentionUnpublishedDetail',
        detailValues: {},
      };
    }

    const startsOn = event.dateStart ?? event.eventDate ?? '';
    const days = this.daysUntil(startsOn);
    if (
      event.eventState === 'upcoming' &&
      Number(event.registrationCount ?? 0) === 0 &&
      days !== null &&
      days >= 0 &&
      days <= STARTING_SOON_DAYS
    ) {
      return {
        ...base,
        reason: 'noRegistrations',
        labelKey: 'dash.attentionNoRegistrations',
        detailKey: 'dash.attentionNoRegistrationsDetail',
        detailValues: { date: formatShortDate(startsOn) },
      };
    }

    return null;
  }

  /**
   * The date the API is calling "today", as `YYYY-MM-DD`.
   *
   * The day window in the "starting soon" rule has to be measured against the same
   * clock the API used to derive each event's `eventState`, or the two disagree
   * and an event the API calls upcoming can fall outside the window. With
   * DATA_SOURCE=local the API pins that date (`demoToday` in the health report, so
   * a demonstration is reproducible whatever the machine's clock says) and it is
   * used whenever the API sends it; the browser's own date is the fallback for
   * MySQL mode, or for a health request that failed. Both are read as signals, so
   * the list re-derives itself when the health report arrives.
   *
   * @returns Today's date in the same form the event dates are stored in.
   */
  private today(): string {
    const demoToday = this.health()?.database?.demoToday;
    if (typeof demoToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(demoToday)) return demoToday;

    const now = new Date();
    const pad = (part: number): string => String(part).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  /**
   * Whole days from today to a date.
   *
   * Both dates are read as UTC midnight so a daylight-saving change cannot turn a
   * whole number of days into 0.96 of one and round a boundary case the wrong way.
   *
   * @param date - A `YYYY-MM-DD` date, or an empty value when the event records none.
   * @returns The number of days (negative for a date in the past), or null when either
   *   date cannot be parsed.
   */
  private daysUntil(date: string | null | undefined): number | null {
    if (!date) return null;
    const from = Date.parse(`${this.today()}T00:00:00Z`);
    const to = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(from) || Number.isNaN(to)) return null;
    return Math.round((to - from) / 86_400_000);
  }

  /**
   * Render a `boolean | null` health flag as a word, or as "-" when it is unknown.
   *
   * @param flag - The flag as the API sent it.
   * @returns "Yes" or "No" in the active language, or "-" when the API made no claim.
   */
  private yesNo(flag: boolean | null | undefined): string {
    return flag === null || flag === undefined ? '-' : this.i18n.t(flag ? 'health.yes' : 'health.no');
  }

  /* --------------------------------------------------------------- cancel ---- */

  /**
   * Open the confirmation dialog for one registration.
   *
   * The dashboard reuses the same dialog, the same wording and the same feedback
   * banner as the registrations page rather than inventing a second destructive
   * flow, so cancelling a registration behaves the same wherever it is done.
   *
   * @param registration - The row whose Cancel button was pressed.
   */
  protected askCancel(registration: Registration): void {
    this.pendingDelete.set(registration);
  }

  /** Close the confirmation dialog without deleting anything. */
  protected cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  /**
   * Remove the registration the dialog is about, then refresh what counted it.
   *
   * DELETE /api/registrations/:id is the existing endpoint and 204 means it is
   * gone. The three reads behind this page are repeated afterwards - the recent
   * list, the statistics and the admin event list - so the row disappears and no
   * total is left quoting a registration that no longer exists.
   *
   * The subscription is created OUTSIDE the constructor, so takeUntilDestroyed is
   * given an explicit DestroyRef: called with no argument it needs an injection
   * context and would throw the moment the button is pressed.
   */
  protected confirmCancel(): void {
    const target = this.pendingDelete();
    if (!target || this.deleting()) return;

    this.deleting.set(true);

    this.api
      .deleteRegistration(target.registrationId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.deleting.set(false);
          this.pendingDelete.set(null);
          this.banner.set(
            banner(
              'success',
              `${target.attendeeName} · ${target.eventName ?? target.eventId}`,
              this.i18n.t('registrations.deleted')
            )
          );
          this.load();
        },
        error: (error: unknown) => {
          this.deleting.set(false);
          this.pendingDelete.set(null);
          this.banner.set(errorBanner(error, this.i18n.t, this.i18n.t('error.heading')));
        },
      });
  }

  /* -------------------------------------------------------------- display ---- */

  /** The timestamp of a registration, in the visitor's locale. */
  protected when(registration: Registration): string {
    return formatDateTime(registration.registeredAt);
  }
}
