import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of, startWith } from 'rxjs';

import { ApiError } from '@charity/shared/api/api-error';
import { ApiService } from '@charity/shared/api/api.service';
import { APP_CONFIG } from '@charity/shared/config/app-config';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import type { Event, EventQuery } from '@charity/shared/models/event.model';
import type { EventStats } from '@charity/shared/models/reference.model';
import { formatCurrency, formatShortDate, formatTime } from '@charity/shared/util/format';

import { EventCardComponent } from '../../shared/event-card';
import { useDocumentTitle } from '../../shared/page-title';

/**
 * The order the home listing is fetched in, and the only one this page asks for.
 *
 * Fixed rather than chosen: this page is the browse view, so it always asks the API
 * for the soonest event first, and the API applies that order over the whole table
 * rather than over the twelve rows on screen. Sorting (and filtering) are the search
 * page's job - see "no client-side sorting" in the class comment below.
 */
const HOME_LISTING_QUERY: EventQuery = { sort: 'date', direction: 'asc' };

/** One headline statistic, already formatted for display. */
interface StatCard {
  value: string;
  labelKey: string;
  /**
   * The translation key of the note saying what the figure measures, or an empty
   * string when the headline names its own scope.
   *
   * Only the funding-goal card carries one: "Current funding goal" is measured over
   * the events the site still lists (see the note on statCards()), so which events
   * the money covers has to be said in words. The other three headlines state their
   * own scope ("Raised through events", "Upcoming events listed"), and a note on
   * every card would be noise rather than explanation.
   */
  noteKey: string;
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
 * ENDPOINTS USED (three, all read-only)
 *   `GET /api/events/upcoming`  the event grid and the hero's "next events" panel
 *   `GET /api/stats`            the four headline impact figures
 *   (the footer independently calls `GET /api/health`)
 *
 * WHY `GET /api/organization` IS NOT CALLED HERE
 *   It used to be, for the About section's lead sentence, which read
 *   `organization()?.mission || ('about.mission' | t)`. That made the API's
 *   `mission` field win whenever the request succeeded, so the sentence stayed
 *   English on the Chinese, Vietnamese and Japanese pages - the API's content
 *   layer is English by design (database/02_seed.sql carries the wording), and
 *   the owner has declined a content-localization pipeline. The lead sentence is
 *   the SITE'S OWN copy rather than an organisation's record, so it is the
 *   dictionary's `about.mission` in all four languages now, and the endpoint is
 *   no longer needed on this page at all. `ApiService.getOrganization()` and
 *   `GET /api/organization` are left in place: the API contract, its test and its
 *   documentation still cover the field, and the public site simply no longer
 *   renders it. Removing the call also removed the page's only silent failure -
 *   there is no section left that degrades to English.
 *
 * HOW THE DATA IS LOADED, AND WHY THIS SHAPE
 *   Each section is loaded separately and fails on its own. That is a deliberate
 *   carry-over from the legacy js/home.js: a failing /api/stats must not blank out
 *   the event listing. The impact figures ARE the "nice to have" of this page, so
 *   they are the ones that degrade to a note; the About section is static copy and
 *   cannot degrade at all.
 *
 *   The event grid is ONE request for the whole visit: `toSignal` over a single
 *   `getUpcomingEvents` call. It used to be driven by `toObservable(sort)` piped
 *   into `switchMap`, because the page carried a sort dropdown of its own; that
 *   control has been removed (browsing is this page's job, sorting is the search
 *   page's), so there is nothing left to re-issue the request and no in-flight
 *   request to cancel - `HOME_LISTING_QUERY` is the only order this page asks for.
 *   `takeUntilDestroyed` still ends the one-off stats request below when the
 *   visitor navigates away.
 *
 * WHY THE HERO PANEL REUSES THE SAME RESPONSE
 *   "Next events at a glance" shows the first four of the very events already
 *   fetched for the grid. A second request for the same rows would be wasteful and
 *   could disagree with the grid while it is loading.
 *
 * DESIGN DECISION: no client-side sorting
 *   The listing is fetched with `sort=date&direction=asc`, so the ORDER BY runs
 *   against the whole table rather than only the twelve rows this page asked for,
 *   and the order is a property of the data rather than of this component. A visitor
 *   who wants another order - or any filter at all - uses the search page, which is
 *   where those controls live and which the hero links to.
 *
 * THE CONTACT DETAILS ARE NOT ON THIS PAGE
 *   The white "Get in touch" section was removed: it repeated the footer's email,
 *   phone, office and hours a couple of hundred pixels above the footer itself. The
 *   footer is now the single home for contact details, and the About card's
 *   "Talk to our events team" button points at `#contact` - the id the footer now
 *   carries - so its fragment still resolves to the contact details instead of to a
 *   section that no longer exists. That button is a plain `href="#contact"` clicked
 *   on this page, so the browser performs the jump itself and the router is not
 *   involved; that was already true of the old `#contact` section, so nothing about
 *   this button changed but its target.
 *
 *   THE ONE FRAGMENT HERE THAT DOES INVOLVE THE ROUTER is `#about`, which the
 *   footer's "About us" link reaches from another route. `withInMemoryScrolling` in
 *   app.config.ts does have `anchorScrolling: 'enabled'`, and it scrolls to the
 *   anchor once, a frame after the route activates - a moment when the event
 *   listing above this section has not been fetched yet, so that first scroll is
 *   against a page that is still short. The second attempt is made by
 *   `shared/fragment-scroll.ts` as soon as this page's own content has arrived,
 *   which is what makes the footer link land here. It is also why this page's two
 *   own fragment links (`#upcoming-events` and `#contact`) need no help: their
 *   targets, the listing section and the footer, are in the document before either
 *   link is clicked.
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
   * context, i.e. in a field initialiser or the constructor. The one-off stats
   * request below is issued from a private method, so the reference is injected
   * once and handed over - which also makes the subscription's lifetime obvious at
   * the call site.
   */
  private readonly destroyRef = inject(DestroyRef);

  /** Tab title, from the route's `data.titleKey` ('nav.siteName'). */
  private readonly title = useDocumentTitle();

  /**
   * The event grid's state.
   *
   * One signal holding the whole state rather than three (`loading`, `events`,
   * `error`) because they always change together: the grid is either loading, or
   * showing a list, or showing an error. Three signals could be made to disagree
   * ("loading" with a list already on screen), and a single object cannot.
   *
   * One request, issued when the component is created: the page has no control that
   * could ask for a different listing, so no `switchMap` and no cancellation are
   * needed here any more.
   */
  protected readonly eventsState = toSignal(
    this.api.getUpcomingEvents({ ...HOME_LISTING_QUERY, limit: APP_CONFIG.homeEventLimit }).pipe(
      map((page): EventsState => ({ loading: false, events: page.items, error: null })),
      catchError((error: unknown) =>
        of<EventsState>({ loading: false, events: [], error: this.messageFor(error) })
      ),
      startWith<EventsState>({ loading: true, events: [], error: null })
    ),
    { initialValue: { loading: true, events: [], error: null } as EventsState }
  );

  /**
   * The headline figures, or null when /api/stats could not be reached.
   */
  protected readonly stats = signal<EventStats | null>(null);

  /** True once /api/stats has definitely failed, so a note can replace the cards. */
  protected readonly statsFailed = signal(false);

  /**
   * The events the hero panel lists, taken from the head of the same response.
   *
   * Four rather than three: with three, the card was the short side of the hero
   * row and left a block of empty dark green under it, which is what made the
   * section lean to the lower left. Four entries plus the card's own link to the
   * listing bring it up to roughly the height of the copy and buttons beside it.
   */
  protected readonly heroEvents = computed(() => this.eventsState().events.slice(0, 4));

  /**
   * The four impact cards, formatted and paired with their translation keys.
   *
   * THE GOAL CARD NAMES ITS OWN SCOPE
   *   `activeGoal` is the sum of the goal amounts of the events that are still to
   *   come - the published events whose derived state is `upcoming` or `ongoing`,
   *   which is the `event_state <> 'past'` filter in repository.mysql.ts and the
   *   filter in repository.local.ts. That is a real scope rather than the whole
   *   table: an event that has already finished keeps its goal in the database but
   *   is left out of this figure, and so is a suspended one, because the public view
   *   is what /api/stats reads. Read on its own, "Current funding goal" could equally
   *   mean every published event's goal, so the card carries a note under the figure
   *   (`home.statGoalScope`) instead of leaving a visitor to infer the scope from the
   *   number - the admin events list totals a wider set and says so in its own note,
   *   so the two figures have to be readable as two scopes rather than one mistake.
   *
   * @returns One card per headline figure, already formatted; empty until /api/stats
   *   has answered.
   */
  protected readonly statCards = computed<StatCard[]>(() => {
    const current = this.stats();
    if (!current) return [];
    return [
      { value: String(current.upcomingEvents), labelKey: 'home.statUpcoming', noteKey: '' },
      { value: String(current.organizations), labelKey: 'home.statPartners', noteKey: '' },
      { value: this.formatCompactCurrency(current.totalRaised), labelKey: 'home.statRaised', noteKey: '' },
      {
        value: this.formatCompactCurrency(current.activeGoal),
        labelKey: 'home.statGoal',
        noteKey: 'home.statGoalScope',
      },
    ];
  });

  constructor() {
    this.title.set();
    this.loadStats();
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
