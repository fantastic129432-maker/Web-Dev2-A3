import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

import { ApiError } from '@charity/shared/api/api-error';
import { ApiService } from '@charity/shared/api/api.service';
import { APP_CONFIG } from '@charity/shared/config/app-config';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import type { Event, EventQuery } from '@charity/shared/models/event.model';
import type { EventStats, Organization } from '@charity/shared/models/reference.model';
import { formatCurrency, formatShortDate, formatTime } from '@charity/shared/util/format';

import { EventCardComponent } from '../../shared/event-card';
import { useDocumentTitle } from '../../shared/page-title';

/** The four sort orders the home page offers, and the API parameters they mean. */
type SortChoice = 'date-asc' | 'date-desc' | 'name-asc' | 'progress-desc';

/** One headline statistic, already formatted for display. */
interface StatCard {
  value: string;
  labelKey: string;
}

/** What the event grid is currently doing. */
interface EventsState {
  loading: boolean;
  /**
   * The events to show.
   *
   * `readonly` because `Paged<T>.items` is a readonly array - the API result is a
   * value that arrived over the wire, and nothing in this page may push into it.
   * Declaring it mutable here would be a compile error at the assignment instead.
   */
  events: readonly Event[];
  error: string | null;
}

/**
 * The home page.
 *
 * ENDPOINTS USED (four, all read-only)
 *   `GET /api/events/upcoming`  the event grid and the hero's "next events" panel
 *   `GET /api/stats`            the four headline impact figures
 *   `GET /api/organization`     the featured organisation's mission statement
 *   (the footer independently calls `GET /api/health`)
 *
 * HOW THE DATA IS LOADED, AND WHY THIS SHAPE
 *   Each section is loaded separately and fails on its own. That is a deliberate
 *   carry-over from the legacy js/home.js: a failing /api/stats must not blank out
 *   the event listing, and an unreachable /api/organization must leave the static
 *   mission sentence on the page rather than an error. The impact figures ARE the
 *   "nice to have" of this page, so they are the ones that degrade to a note.
 *
 *   The event grid is driven by `toObservable(sort)` piped into `switchMap`, which
 *   means changing the sort ORDER cancels the request in flight and issues the new
 *   one. There is therefore no way to race two sorts and render the wrong list,
 *   and no manual subscription to clean up: `takeUntilDestroyed` ends the whole
 *   chain when the visitor navigates away.
 *
 * WHY THE HERO PANEL REUSES THE SAME RESPONSE
 *   "Next events at a glance" shows the first three of the very events already
 *   fetched for the grid. A second request for the same rows would be wasteful and
 *   could disagree with the grid during a sort change.
 *
 * DESIGN DECISION: no client-side sorting
 *   Sorting is sent to the API (`sort` + `direction`) rather than done in the
 *   browser, so the ORDER BY runs against the whole table rather than only the
 *   twelve rows this page asked for.
 */
@Component({
  selector: 'app-home-page',
  imports: [RouterLink, EventCardComponent, TranslatePipe],
  templateUrl: './home.html',
})
export class HomePage {
  private readonly api = inject(ApiService);
  private readonly i18n = inject(TranslationService);

  /**
   * The component's lifetime, passed explicitly to `takeUntilDestroyed()`.
   *
   * `takeUntilDestroyed()` with no argument only works inside an injection
   * context, i.e. in a field initialiser or the constructor. The one-off requests
   * below are issued from private methods, so the reference is injected once and
   * handed over - which also makes the subscription's lifetime obvious at the
   * call site.
   */
  private readonly destroyRef = inject(DestroyRef);

  /** Tab title, from the route's `data.titleKey` ('nav.siteName'). */
  private readonly title = useDocumentTitle();

  /** The selected sort order, as the <select>'s value. */
  protected readonly sort = signal<SortChoice>('date-asc');

  /**
   * The event grid's state.
   *
   * One signal holding the whole state rather than three (`loading`, `events`,
   * `error`) because they always change together: the grid is either loading, or
   * showing a list, or showing an error. Three signals could be made to disagree
   * ("loading" with a list already on screen), and a single object cannot.
   */
  protected readonly eventsState = toSignal(
    toObservable(this.sort).pipe(
      switchMap((choice) =>
        this.api.getUpcomingEvents({ ...this.toQuery(choice), limit: APP_CONFIG.homeEventLimit }).pipe(
          map((page): EventsState => ({ loading: false, events: page.items, error: null })),
          catchError((error: unknown) =>
            of<EventsState>({ loading: false, events: [], error: this.messageFor(error) })
          ),
          startWith<EventsState>({ loading: true, events: [], error: null })
        )
      )
    ),
    { initialValue: { loading: true, events: [], error: null } as EventsState }
  );

  /**
   * The organisation's mission, or null while it is unknown.
   *
   * On failure this stays null and the template keeps the static `about.mission`
   * sentence, so the About section is never empty.
   */
  protected readonly organization = signal<Organization | null>(null);

  /** The headline figures, or null when /api/stats could not be reached. */
  protected readonly stats = signal<EventStats | null>(null);

  /** True once /api/stats has definitely failed, so a note can replace the cards. */
  protected readonly statsFailed = signal(false);

  /** The first three events, for the hero panel. */
  protected readonly heroEvents = computed(() => this.eventsState().events.slice(0, 3));

  /** The four impact cards, formatted and paired with their translation keys. */
  protected readonly statCards = computed<StatCard[]>(() => {
    const current = this.stats();
    if (!current) return [];
    return [
      { value: String(current.upcomingEvents), labelKey: 'home.statUpcoming' },
      { value: String(current.organizations), labelKey: 'home.statPartners' },
      { value: this.formatCompactCurrency(current.totalRaised), labelKey: 'home.statRaised' },
      { value: this.formatCompactCurrency(current.activeGoal), labelKey: 'home.statGoal' },
    ];
  });

  constructor() {
    this.title.set();
    this.loadOrganization();
    this.loadStats();
  }

  /**
   * The query parameters for one sort choice.
   *
   * `date-asc`/`date-desc` map to the API's `date` column, `name-asc` to `name`
   * and `progress-desc` to `progress` - the sort whitelist the API exposes. The
   * mapping lives in one function so the dropdown's value strings and the API's
   * parameter names never drift apart.
   */
  private toQuery(choice: SortChoice): EventQuery {
    switch (choice) {
      case 'date-desc':
        return { sort: 'date', direction: 'desc' };
      case 'name-asc':
        return { sort: 'name', direction: 'asc' };
      case 'progress-desc':
        return { sort: 'progress', direction: 'desc' };
      default:
        return { sort: 'date', direction: 'asc' };
    }
  }

  /**
   * Re-read the listing when the visitor changes the sort order.
   *
   * Bound to the <select>'s `change` event rather than `ngModel`: the value is
   * only ever read here, so two-way binding would add a forms import for nothing.
   */
  protected onSortChange(value: string): void {
    // Narrow the raw DOM string back to the union the signal is typed with. The
    // <select> can only contain the four literals, so anything else is a bug in
    // the template rather than user input, and falling back to the default keeps
    // the page working.
    const allowed: readonly SortChoice[] = ['date-asc', 'date-desc', 'name-asc', 'progress-desc'];
    const next = allowed.find((choice) => choice === value);
    this.sort.set(next ?? 'date-asc');
  }

  /**
   * `GET /api/organization` - the featured organisation's mission.
   */
  private loadOrganization(): void {
    this.api
      .getOrganization()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (organization) => this.organization.set(organization),
        // The static mission in the template stays visible, so the About section
        // is still complete for the visitor if this call fails. Reported in the
        // console only, because there is nothing useful to do about it.
        error: (error: unknown) =>
          console.warn('Organisation details could not be loaded:', this.messageFor(error)),
      });
  }

  /** `GET /api/stats` - the four headline figures. */
  private loadStats(): void {
    this.api
      .getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => this.stats.set(stats),
        error: () => this.statsFailed.set(true),
      });
  }

  /**
   * The human-readable half of a failure.
   *
   * ApiError already carries a status-appropriate, translated sentence, so this
   * prefers it; anything else falls back to the generic key. Doing the lookup here
   * rather than in the template keeps the `t` call next to the code that needs the
   * string (and fluent in the active language, because `i18n.t` reads the signal).
   */
  private messageFor(error: unknown): string {
    if (error instanceof ApiError) return error.friendlyMessage((key) => this.i18n.t(key));
    return this.i18n.t('error.generic');
  }

  /**
   * "$99k" rather than "$99,290" on a small statistic card.
   *
   * One decimal place only under $10,000, so "$1.5k" and "$99k" both stay short
   * while the ordering of the numbers is still visible at a glance.
   */
  private formatCompactCurrency(amount: number | null | undefined): string {
    const value = Number(amount ?? 0) || 0;
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
    }
    return formatCurrency(value);
  }

  /** "11 Oct 2026 · 6:30 pm · Coffs Harbour" for one line of the hero panel. */
  protected heroLine(event: Event): string {
    const parts = [formatShortDate(event.dateStart ?? event.eventDate)];
    const time = formatTime(event.startTime);
    if (time) parts.push(time);
    if (event.city) parts.push(event.city);
    return parts.join(' \u00B7 ');
  }
}
