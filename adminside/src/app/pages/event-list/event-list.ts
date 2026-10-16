import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ApiError } from '@charity/shared/api/api-error';
import { ApiService } from '@charity/shared/api/api.service';
import { PUBLISH_STATUSES } from '@charity/shared/config/app-config';
import { OTHER_SITE_URL } from '@charity/shared/di/tokens';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import type { Event as CharityEvent } from '@charity/shared/models/event.model';
import { formatCurrency, formatDateRange } from '@charity/shared/util/format';

import { banner, conflictFacts, errorBanner, type Banner } from '../../core/feedback';
import { usePageTitle } from '../../core/page-title';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { FeedbackBanner } from '../../shared/feedback-banner/feedback-banner';

/**
 * The main admin listing, showing EVERY event whatever its status, with the three
 * actions the brief asks for.
 *
 * ENDPOINTS
 *   GET    /api/admin/events       the list feature. The admin view is what makes
 *                                  this page different from the public one: active,
 *                                  past, suspended and cancelled events all appear,
 *                                  with their registration and ticket counts.
 *   DELETE /api/events/:id         204 on success. A 409 means the event already
 *                                  has registrations - the data-integrity rule the
 *                                  brief requires - and is reported with the
 *                                  event's name, its registration count and the
 *                                  suggestion to suspend it instead. The row's own
 *                                  Delete button is then disabled and labelled, so
 *                                  the rule is visible next to the data rather than
 *                                  only in a banner that can be scrolled away.
 *
 * The filters live in the URL (replaceUrl, so Back is not filled with filter
 * states) exactly as the archived page did: a filtered view can be refreshed or
 * shared, and the dashboard's "review the registrations" style links can
 * preselect a filter.
 *
 * THE TOTALS ROW
 *   Every figure in it comes from the API's own per-event columns
 *   (`registrationCount`, `ticketsSold`, `raisedAmount`, `goalAmount`) rather
 *   than from counting anything in the browser: the browser only ever sees the
 *   page of events it was given, so a count derived from the DOM would silently
 *   become a count of the rows that happen to be on screen. It is summed here
 *   only because the row is a total of THIS list, and the two money figures are
 *   restricted to the published rows so that they equal the dashboard's own
 *   totals for the same data - see totalRaised(), which is where that rule and
 *   the reason for it are written down. Sums are rendered with the shared
 *   formatCurrency, the same formatter the dashboard's money tile uses, so a
 *   figure does not read one way on this page and another way there.
 *
 * THE TOTALS ROW SAYS WHAT IT COVERS
 *   Both money lines are narrower than the table above them, which cannot be seen
 *   from the figures alone. The registrations page's footer solves exactly that
 *   problem with a note under its totals row (`registrations.totalScope`), so the
 *   GOAL line here carries one too (`events.totalGoalScope`) - and it is the line
 *   that needs it most, because the public home page publishes a funding goal as
 *   well. On the seeded data that card reads $197,000 ("Current funding goal",
 *   `stats.activeGoal`) and this cell reads $300,000, and the two are not meant to
 *   be the same number: the card counts the goal of the events that have not
 *   finished, this cell counts the goal of every published event, including the
 *   ones that have (see totalGoal()). Neither computation is changed; each figure
 *   states its own scope in words.
 */
@Component({
  selector: 'admin-event-list',
  imports: [RouterLink, ReactiveFormsModule, TranslatePipe, FeedbackBanner, ConfirmDialog],
  styleUrl: './event-list.css',
  templateUrl: './event-list.html',
})
export class EventList {
  private readonly api = inject(ApiService);
  private readonly i18n = inject(TranslationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** The publish statuses, plus "all" - the filter offers every value the API does. */
  protected readonly statuses = PUBLISH_STATUSES;

  /**
   * The public site's root with a guaranteed trailing slash, so a row can link
   * straight to the event a staff member is editing. Normalised once here rather
   * than concatenated in the template, where a missing slash would silently turn
   * the link into a relative path inside /admin/.
   *
   * It is the OTHER site, so this is a plain href and not a routerLink: the router
   * only knows this application's routes.
   */
  protected readonly publicSiteBase = `${inject(OTHER_SITE_URL).replace(/\/+$/, '')}/`;

  /** The filter bar. A reactive form because the values are read as a group on Apply. */
  protected readonly filters = new FormGroup({
    publishStatus: new FormControl('all', { nonNullable: true }),
    state: new FormControl('all', { nonNullable: true }),
    keyword: new FormControl('', { nonNullable: true }),
  });

  /** The events matched by the filters, as the API returned them. */
  protected readonly events = signal<readonly CharityEvent[]>([]);

  /** True while a list request is in flight. */
  protected readonly loading = signal(true);

  /** The page-level message, or null when nothing has been reported. */
  protected readonly banner = signal<Banner | null>(null);

  /** How many events the API matched, which can exceed the rows returned. */
  protected readonly total = signal(0);

  /** The event awaiting confirmation, or null when no dialog is open. */
  protected readonly pendingDelete = signal<CharityEvent | null>(null);

  /** True while the DELETE is in flight, so the dialog's button cannot repeat it. */
  protected readonly deleting = signal(false);

  /**
   * Events whose delete the API refused, with the reason. Kept so the button in
   * the row can be disabled and labelled - the archived page did the same, and it
   * is what makes the rule visible at the point of the data.
   */
  protected readonly blocked = signal<ReadonlyMap<number, string>>(new Map<number, string>());

  /** Exposed to the template: the two formatters the table needs. */
  protected readonly formatCurrency = formatCurrency;
  protected readonly formatDateRange = formatDateRange;

  constructor() {
    usePageTitle('events.heading');

    /*
     * THE ADDRESS BAR IS FOLLOWED FOR AS LONG AS THE PAGE IS OPEN, not read once.
     *
     * The filters live in the URL so a filtered view can be refreshed or shared, and
     * this page also WRITES that URL whenever Apply or Clear runs. Reading it once, in
     * the constructor, therefore left the page describing a URL that had moved on: the
     * router reuses this component when only the query string changes, so a link from
     * anywhere to /events - or the menu's own "Events" entry, clicked while a filter
     * was applied - changed the address to /events and left the form and the list on
     * the previous filter. Measured: /events?publishStatus=suspended&keyword=gala
     * rendered zero rows with Status = suspended; clicking the menu's Events link put
     * "/events" in the address bar and left Status = suspended, Keyword = gala and the
     * same zero rows on screen. A refresh then showed every event, which is the one
     * thing a URL the page claims to be showing must not do.
     *
     * The subscription below re-applies the URL whenever it differs from the form, and
     * does nothing when it does not - that second half is what keeps this page's OWN
     * writes from re-triggering a load: syncUrl() runs after the form has already been
     * set, so the echo of our own navigation matches and stops there. The `first` flag
     * exists because the router's queryParamMap emits the current URL immediately: the
     * opening load must happen even when the URL carries no filter at all, which is
     * exactly the case where "nothing changed" is also true.
     */
    let first = true;
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const next = {
          publishStatus: params.get('publishStatus') ?? 'all',
          state: params.get('state') ?? 'all',
          keyword: params.get('keyword') ?? '',
        };

        const current = this.filters.getRawValue();
        const changed =
          next.publishStatus !== current.publishStatus ||
          next.state !== current.state ||
          next.keyword !== current.keyword;

        if (!first && !changed) return;
        first = false;

        if (changed) this.filters.setValue(next);
        this.load();
      });
  }

  /* ---------------------------------------------------------------- load ---- */

  /** Fetch the list with the filters currently applied. */
  private load(): void {
    const { publishStatus, state, keyword } = this.filters.getRawValue();
    this.loading.set(true);

    this.api
      .getAdminEvents({ limit: 100, publishStatus, state, keyword })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.events.set(page.items);
          this.total.set(page.meta.total);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.events.set([]);
          this.total.set(0);
          this.loading.set(false);
          this.banner.set(errorBanner(error, this.i18n.t, this.i18n.t('error.heading')));
        },
      });
  }

  /** Apply the filters, and keep the address bar in step so the view is shareable. */
  protected apply(domEvent: SubmitEvent): void {
    domEvent.preventDefault();
    const value = this.filters.getRawValue();
    this.syncUrl(value.publishStatus, value.state, value.keyword);
    this.load();
  }

  /** Back to every event, whatever its status. */
  protected clear(): void {
    this.filters.setValue({ publishStatus: 'all', state: 'all', keyword: '' });
    this.syncUrl('all', 'all', '');
    this.load();
  }

  /**
   * Mirror the filters into the URL.
   *
   * `state` is included: it is read back from the query string on load, but it used
   * to be omitted here while `queryParams` replaces the whole set - so arriving at
   * /events?state=past, changing the keyword and pressing Apply silently dropped the
   * Time filter from the address bar, and a refresh then showed every date. That
   * contradicted this page's own reason for keeping the filters in the URL.
   */
  private syncUrl(publishStatus: string, state: string, keyword: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      // replaceUrl: filtering should not fill the Back button with history.
      replaceUrl: true,
      queryParams: {
        publishStatus: publishStatus === 'all' ? null : publishStatus,
        state: state === 'all' ? null : state,
        keyword: keyword === '' ? null : keyword,
      },
    });
  }

  /* -------------------------------------------------------------- delete ---- */

  /** Open the confirmation dialog for one event. */
  protected askDelete(event: CharityEvent): void {
    this.pendingDelete.set(event);
  }

  /** Close the confirmation dialog without deleting anything. */
  protected cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  /**
   * DELETE the event and report the outcome.
   *
   * 204: gone - say so and reload, because the row disappears either way.
   * 409: refused. The API's own sentence names the event and the number of
   *      registrations, errorBanner adds the structured facts and the suggestion
   *      to suspend it instead, and the row's button becomes "Deletion blocked"
   *      so the reason stays visible after the banner is dismissed.
   */
  protected confirmDelete(): void {
    const target = this.pendingDelete();
    if (!target || this.deleting()) return;

    this.deleting.set(true);

    this.api
      .deleteEvent(target.eventId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.deleting.set(false);
          this.pendingDelete.set(null);
          this.banner.set(
            banner('success', target.eventName, this.i18n.t('delete.success', { name: target.eventName }))
          );
          this.clearBlocked(target.eventId);
          this.load();
        },
        error: (error: unknown) => {
          this.deleting.set(false);
          this.pendingDelete.set(null);
          this.banner.set(
            errorBanner(error, this.i18n.t, this.i18n.t('delete.blockedTitle'))
          );

          if (error instanceof ApiError && error.isConflict) {
            // The tooltip on the now-disabled button says WHY, using the count the
            // API reported, so the rule is still visible after the banner is gone.
            const facts = conflictFacts(error);
            const reason =
              facts.registrationCount === undefined
                ? this.i18n.t('delete.blockedTitle')
                : this.i18n.t('update.registrationsBlocked', { count: facts.registrationCount });

            const next = new Map(this.blocked());
            next.set(target.eventId, reason);
            this.blocked.set(next);
          }
        },
      });
  }

  /** Drop the remembered refusal for one event, once its delete has succeeded. */
  private clearBlocked(eventId: number): void {
    const next = new Map(this.blocked());
    next.delete(eventId);
    this.blocked.set(next);
  }

  /** The reason a row's delete is blocked, or an empty string. */
  protected blockedReason(eventId: number): string {
    return this.blocked().get(eventId) ?? '';
  }

  /* ------------------------------------------------------------- display ---- */

  /**
   * The badge class for a publishing status.
   *
   * Two of the three statuses borrow the public site's state vocabulary, so
   * "suspended" reads as the muted past-grey rather than as an error: it is a
   * staff decision, not a fault.
   *
   * ACTIVE USED TO BORROW UPCOMING'S CLASS, and that is what the review saw as
   * "ACTIVE and UPCOMING sit close together in hue": this method returned
   * 'badge badge--upcoming' for 'active', so a published event and an event that
   * has not started were one colour (#0f7b6c, the brand fill). The brand fill now
   * belongs to ACTIVE alone (`badge--active`, declared beside the other badges in
   * src/base.css), UPCOMING is neutral, and CANCELLED - which had no class at all
   * and so wore the same neutral pair UPCOMING now wears - gets the danger pair.
   * The two badges in a cell (see the template's .cell-badges) therefore differ by
   * fill as well as by word in every status/state combination.
   */
  protected statusClass(status: string | null | undefined): string {
    if (status === 'active') return 'badge badge--active';
    if (status === 'suspended') return 'badge badge--past';
    if (status === 'cancelled') return 'badge badge--cancelled';
    return 'badge';
  }

  /**
   * The label of the DERIVED time state (upcoming / ongoing / past).
   *
   * The admin dictionary names these events.state*, so the shared stateKey()
   * helper - which returns the client dictionary's state.* keys - is not used
   * here; a missing key would render as the raw key on the page.
   */
  protected stateKey(eventState: string | null | undefined): string {
    if (eventState === 'past') return 'events.statePast';
    if (eventState === 'ongoing') return 'events.stateOngoing';
    return 'events.stateUpcoming';
  }

  /** The badge class for the DERIVED time state (upcoming / ongoing / past). */
  protected stateClass(eventState: string | null | undefined): string {
    if (eventState === 'past') return 'badge badge--past';
    if (eventState === 'ongoing') return 'badge badge--ongoing';
    return 'badge badge--upcoming';
  }

  /** The capacity of an event as words, because null means "no limit". */
  protected capacityLabel(event: CharityEvent): string {
    return event.capacity === null || event.capacity === undefined
      ? this.i18n.t('ticket.unlimited')
      : String(event.capacity);
  }

  /* -------------------------------------------------------------- totals ---- */

  /**
   * Total registrations across the rows on screen.
   *
   * @returns The sum of the per-event registration counts the API returned.
   */
  protected totalRegistrations(): number {
    return this.events().reduce((sum, event) => sum + Number(event.registrationCount || 0), 0);
  }

  /**
   * Total tickets sold across the rows on screen.
   *
   * @returns The sum of the per-event ticket counts the API returned.
   */
  protected totalTickets(): number {
    return this.events().reduce((sum, event) => sum + Number(event.ticketsSold || 0), 0);
  }

  /**
   * Total raised across the rows the DASHBOARD counts as well.
   *
   * WHY THE ROWS ARE FILTERED BY STATUS
   *   The dashboard's "Total raised" tile is `stats.totalRaised`, which
   *   /api/stats reads from the PUBLIC view - fixed to `status = 'active'` - so
   *   a suspended event's money is not in that figure. Summing every row of this
   *   list instead would print $99,440 here against the dashboard's $99,290 for
   *   the same data, and two pages disagreeing about one number is worse than a
   *   summary that is deliberately narrower than the table above it. The
   *   suspended row and any cancelled row are therefore excluded from both money
   *   totals, which is the rule the class comment states as well.
   *
   *   The COUNT totals are not filtered, and that is the same decision: /api/stats
   *   counts registrations and tickets from the registrations table, which has no
   *   status filter, so those two agree with this page already.
   *
   * @returns The sum of the raised amounts of the published rows on screen.
   */
  protected totalRaised(): number {
    return this.publishedEvents().reduce((sum, event) => sum + Number(event.raisedAmount || 0), 0);
  }

  /**
   * Total fundraising goal across the same published rows.
   *
   * The scope matches totalRaised() so that the two lines of the summary's
   * RAISED / GOAL cell are read together, exactly as they are in the rows above.
   * The API's `stats.activeGoal` is deliberately NOT used: it counts only the
   * UPCOMING published events' goals, which is a third scope again, and the
   * dashboard does not display it, so there would be nothing for it to agree
   * with.
   *
   * WHICH SCOPES THE TWO GOAL FIGURES ARE, VERIFIED AGAINST THE RUNNING API
   *   On the seeded data the public home page's card shows $197,000 and this cell
   *   shows $300,000, and both are correct for what they measure:
   *
   *     Goal: $197,000   the events still to come. The six published events whose
   *                      state is `upcoming` - 60,000 + 35,000 + 45,000 + 12,000 +
   *                      15,000 + 30,000. It is `SUM(goal_amount) WHERE status =
   *                      'active' AND event_state <> 'past'` (repository.mysql.ts,
   *                      findStats), i.e. exactly what /api/stats reports as
   *                      activeGoal.
   *     Goal: $300,000   the eleven rows this table lists minus the suspended one:
   *                      the same six events, plus the four published events that
   *                      have already finished (25,000 + 18,000 + 50,000 + 10,000).
   *                      This cell is the sum of the goal of every `active` row,
   *                      and it is deliberately WIDER than the public card.
   *
   *   The suspended event (Midnight Desert Auction, $20,000) is in NEITHER total:
   *   the public view fixes `status = 'active'` before the state filter is applied,
   *   and publishedEvents() repeats that rule here - which is also why the table
   *   above this footer sums to $320,000 while the footer says $300,000. So the gap
   *   between the two figures is the four finished published events - 103,000 - and
   *   not a missing or double-counted amount. Since this cell sits below rows the
   *   public site hides, the note under it has to say which rows it covers; see the
   *   class comment.
   *
   * @returns The sum of the goal amounts of the published rows on screen.
   */
  protected totalGoal(): number {
    return this.publishedEvents().reduce((sum, event) => sum + Number(event.goalAmount || 0), 0);
  }

  /**
   * The rows the dashboard's money figures cover: everything the public website
   * would publish.
   *
   * This is the one place that decides which rows a money total includes, so the
   * raised and the goal totals cannot drift apart. It returns the `active` rows
   * in the order they are shown; a row whose status is missing is left out, since
   * only `active` is what the public view counts.
   */
  private publishedEvents(): readonly CharityEvent[] {
    return this.events().filter((event) => event.status === 'active');
  }
}
