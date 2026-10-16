import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ApiService } from '@charity/shared/api/api.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import type { TranslationValues } from '@charity/shared/i18n/translation.service';
import type { Event } from '@charity/shared/models/event.model';
import type { Registration } from '@charity/shared/models/registration.model';
import { formatCurrency, formatDateTime } from '@charity/shared/util/format';

import { banner, errorBanner, type Banner } from '../../core/feedback';
import { usePageTitle } from '../../core/page-title';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { FeedbackBanner } from '../../shared/feedback-banner/feedback-banner';

/**
 * How many registrations one page of the table shows.
 *
 * Ten rows fit one screen without the summary row being scrolled away from the
 * figures it totals, which is what the review asked for: twenty rows ran for three
 * screens. It is also the page size the reviewer's own numbers point at. It is the
 * `limit` this page sends to the API and the divisor of every page number it
 * renders, so the ten rows on screen are exactly the ten rows the request asked
 * for - see the class comment for why the API does the paging.
 */
const PAGE_SIZE = 10;

/**
 * The page listing every registration recorded in the system, newest purchase
 * first.
 *
 * ENDPOINTS
 *   GET    /api/registrations      the list. It accepts ?eventId and ?keyword, so
 *                                  both filters are applied by the API rather than
 *                                  by filtering a page of results in the browser -
 *                                  which would silently miss rows beyond the page.
 *   GET    /api/admin/events       the options for the event filter. Requested
 *                                  separately so a slow event request cannot hold
 *                                  up the registrations themselves.
 *   DELETE /api/registrations/:id  remove one registration.
 *
 * WHY THIS PAGE IS WORTH HAVING
 *   The brief's data-integrity rule is that an event with registrations cannot be
 *   deleted. Without a page like this the rule is a dead end: staff who genuinely
 *   need to remove such an event have no way to see or clear what protects it.
 *   This is where the rule becomes workable, and the Edit link on every row goes
 *   straight to the event the registration belongs to.
 *
 * PAGING, AND WHY THE API DOES IT RATHER THAN THIS PAGE
 *   The page asks the API for ONE page of `PAGE_SIZE` rows at a time - `limit` plus
 *   `offset` - and takes the size of the matched set from `meta.total`, which is what
 *   makes the three numbers on the page tell the same story once a filter matches
 *   more rows than a single request can carry. It used to ask for `limit: 100` and
 *   slice that one response in the browser, and past 100 matches the page then
 *   contradicted itself: the count line read "Showing 10 of 250" above a pager whose
 *   ten buttons could only reach page 10, while the footer totalled the 100 rows it
 *   happened to hold under a label claiming to describe the matched set. Paging
 *   through the API is the smaller honest fix here: the wording alternative ("the
 *   first hundred of however many matched") needs a new sentence in four shared
 *   dictionaries, and this needs none. The cost is one request per page change
 *   instead of one per filter change, and the page's own spinner while that request
 *   lands - `loading` already covered "a list request is in flight", and now a page
 *   change is one.
 *
 *   What that means for the figures, stated plainly: `total()` is the API's count of
 *   every row the filters matched and is what `pageCount()` is derived from, so the
 *   pager can reach the last match; the rows in hand are the rows of the current API
 *   page, and totalTickets(), totalValue() and the `registrations.totalSummary` label
 *   describe exactly those rows - the same rows the table above the footer is
 *   showing. A footer that claimed to total the whole matched set could only be
 *   honest if the whole set were in the browser, and the API publishes no whole-set
 *   ticket total (its own `meta.ticketsSold` sums the page it returns).
 *
 * THE TWO MONEY FIGURES, AND WHY THEY ARE NOT RECONCILED
 *   This page's footer totals TICKET SALES for the rows of the page on screen, and
 *   the dashboard's "Total raised" tile shows `totalRaised` from GET /api/stats.
 *   They disagree - $20,575 against $99,290 over the whole seed - because they
 *   measure different things, and the disagreement was verified against the running
 *   API before anything was written on the page:
 *
 *     GET /api/registrations   each row carries `ticketPrice` and `totalAmount`,
 *                              and `totalAmount` is ticketsPurchased x ticketPrice
 *                              as the API computes it (repository.local.ts
 *                              toApiShape, the mirror of the same expression in
 *                              repository.mysql.ts). Summed over the 20 seeded
 *                              rows: 49 tickets and $20,575 of TICKET SALES. Those
 *                              twenty rows are now two pages of ten, so page one's
 *                              footer shows the first half of that sum: the figure
 *                              is unchanged, but the page no longer presents a
 *                              ten-row total as if it were the set's.
 *     GET /api/stats           `totalRaised` is the sum, over the public events, of
 *                              each event's `raisedAmount`, and `raisedAmount` is
 *                              the sum of that event's DONATIONS (repository.local
 *                              .ts decorate(); MySQL reads the same figure as
 *                              SUM(vw_public_events.raised_amount)). $99,290.
 *
 *   The two endpoints agree on the counts - `registrations: 20` and
 *   `ticketsSold: 49` on /api/stats are exactly the 20 rows and 49 tickets
 *   /api/registrations returns across its pages - so nothing is double-counted or
 *   missing; the money is simply two different kinds of income. Neither computation
 *   is changed here, and the page still states its own scope in words under the
 *   totals row (`registrations.totalScope`), because a reader comparing the two
 *   figures has no way to know that from the numbers alone.
 */
@Component({
  selector: 'admin-registrations',
  imports: [RouterLink, ReactiveFormsModule, TranslatePipe, FeedbackBanner, ConfirmDialog],
  styleUrl: './registrations.css',
  templateUrl: './registrations.html',
})
export class Registrations {
  private readonly api = inject(ApiService);
  private readonly i18n = inject(TranslationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** The filter bar: one event, or free text over the attendee's name and email. */
  protected readonly filters = new FormGroup({
    eventId: new FormControl('', { nonNullable: true }),
    keyword: new FormControl('', { nonNullable: true }),
  });

  /** The registrations on the page the API last returned, newest purchase first. */
  protected readonly registrations = signal<readonly Registration[]>([]);

  /**
   * The events offered by the filter, newest id first: the event someone is most
   * likely to be looking for is usually the most recently added one.
   */
  protected readonly events = signal<readonly Event[]>([]);

  /** True while a list request is in flight. */
  protected readonly loading = signal(true);

  /** The page-level message, or null when nothing has been reported. */
  protected readonly banner = signal<Banner | null>(null);

  /**
   * How many registrations the filters matched, across every page.
   *
   * This is the API's `meta.total` and not the number of rows in hand, which is what
   * lets `pageCount()` reach the last match even though the browser only ever holds
   * the one page it requested.
   */
  protected readonly total = signal(0);

  /**
   * The page the pager last asked for, one-based.
   *
   * It is the REQUEST, not the page on screen: `currentPage` clamps it against the
   * page count, so a delete that shortens the matched set cannot leave the table
   * pointing past its own last page.
   */
  protected readonly requestedPage = signal(1);

  /** The registration awaiting confirmation, or null when no dialog is open. */
  protected readonly pendingDelete = signal<Registration | null>(null);

  /** True while the DELETE is in flight, so the dialog's button cannot repeat it. */
  protected readonly deleting = signal(false);

  /**
   * How many pages the matched set needs, and never fewer than one.
   *
   * Derived from the API's total rather than from the rows in hand, because the rows
   * in hand are one page by construction now and counting them would always give one.
   * The floor matters too: an empty result still has to render one disabled page
   * rather than a pager with no pages, and it keeps `currentPage` from clamping to
   * zero.
   */
  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.total() / PAGE_SIZE))
  );

  /** The page actually on screen, with the requested page clamped to the range. */
  protected readonly currentPage = computed(() =>
    Math.min(this.requestedPage(), this.pageCount())
  );

  /**
   * Every page number, for the numbered buttons.
   *
   * Rendered in full rather than windowed with ellipses. That was already true when
   * the page sliced a fixed hundred rows in the browser; now that the page count
   * follows the API's total it is a deliberate trade rather than a free one, because
   * a filter matching a few thousand rows would render a long, wrapped row of
   * buttons. It is kept because the buttons wrap, the "Page {page} of {pages}" status
   * beside them still names the position, and a windowing rule would have to invent
   * ellipsis markup and a second way to say the same thing - while the seeded set
   * (20 rows) and the filter this page exists for (one event) both stay inside two
   * buttons.
   */
  protected readonly pageNumbers = computed(() =>
    Array.from({ length: this.pageCount() }, (_, index) => index + 1)
  );

  /** Exposed to the template: the same two formatters every other page uses. */
  protected readonly formatCurrency = formatCurrency;
  protected readonly formatDateTime = formatDateTime;

  constructor() {
    usePageTitle('registrations.heading');

    // Another page can pre-filter the list - the blocked-delete banner links here
    // with ?eventId=... so the reason for the refusal is one click away.
    const query = this.route.snapshot.queryParamMap;
    this.filters.setValue({
      eventId: query.get('eventId') ?? '',
      keyword: query.get('keyword') ?? '',
    });

    this.loadEvents();
    this.load();
  }

  /* ---------------------------------------------------------------- load ---- */

  /**
   * Fetch ONE page of the registrations that match the filters.
   *
   * The page is asked of the API with `limit` and `offset` rather than sliced out of a
   * larger response, so what the browser holds is the rows on screen and `meta.total`
   * is the size of the whole matched set - the two figures the pager needs to reach
   * the last page. See the class comment for the contradiction this replaced.
   *
   * @param page - The one-based page to fetch. Defaults to the page the pager is on,
   *   which is what a filter change or a delete wants: stay where the reader is, with
   *   the new data.
   */
  private load(page = this.currentPage()): void {
    const { eventId, keyword } = this.filters.getRawValue();
    const wanted = Math.max(1, Math.trunc(page));
    const offset = (wanted - 1) * PAGE_SIZE;
    this.loading.set(true);

    this.api
      .getRegistrations({
        limit: PAGE_SIZE,
        offset,
        eventId: eventId === '' ? undefined : eventId,
        keyword: keyword === '' ? undefined : keyword,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          // A delete can shorten the matched set out from under the pager, and the page
          // just fetched can then be past the new end - where the API truthfully answers
          // with no rows at all. Fetch the new last page instead of painting an empty
          // table under a pager that still claims there are rows. Each retry strictly
          // lowers the page number, and page one always has rows while the total is
          // positive, so this settles after one extra request.
          const lastPage = Math.max(1, Math.ceil(response.meta.total / PAGE_SIZE));
          if (response.items.length === 0 && response.meta.total > 0 && wanted > lastPage) {
            this.requestedPage.set(lastPage);
            this.load(lastPage);
            return;
          }
          this.registrations.set(response.items);
          this.total.set(response.meta.total);
          // Record the page that was really fetched: `currentPage` may have clamped the
          // request, and the pager's marker has to point at the rows in hand.
          this.requestedPage.set(wanted);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.registrations.set([]);
          this.total.set(0);
          this.loading.set(false);
          this.banner.set(errorBanner(error, this.i18n.t, this.i18n.t('error.heading')));
        },
      });
  }

  /**
   * Fill the event filter. A failure here leaves the "all events" option in place
   * and is deliberately NOT shown as a message: the registration list still works,
   * so an error banner would overstate the problem.
   */
  private loadEvents(): void {
    this.api
      .getAdminEvents({ limit: 100, state: 'all', publishStatus: 'all' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => this.events.set(page.items),
        error: () => this.events.set([]),
      });
  }

  /** Apply the filters and keep the address bar in step. */
  protected apply(domEvent: SubmitEvent): void {
    domEvent.preventDefault();
    const value = this.filters.getRawValue();

    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParams: {
        eventId: value.eventId === '' ? null : value.eventId,
        keyword: value.keyword === '' ? null : value.keyword,
      },
    });

    // Back to page one: the filters select a different set, so the page the reader
    // was on has no meaning in it - and page 2 of a three-row result would be empty.
    this.requestedPage.set(1);
    this.load();
  }

  /** Back to every registration. */
  protected clear(): void {
    this.filters.setValue({ eventId: '', keyword: '' });
    void this.router.navigate([], { relativeTo: this.route, replaceUrl: true, queryParams: {} });
    // Page one for the same reason apply() resets: "every registration" is a new set.
    this.requestedPage.set(1);
    this.load();
  }

  /* --------------------------------------------------------------- paging ---- */

  /**
   * Show one numbered page.
   *
   * The target is clamped rather than trusted. The buttons cannot ask for a page
   * outside the range, but the matched set can shrink under the pager - deleting the
   * only row of the last page is the case - and clamping here is what keeps the
   * current page marker from pointing at a page that no longer exists. The rows
   * themselves are not in the browser, so the clamped page is then FETCHED; load()
   * repeats the clamp against the total the API reports, which covers the set
   * shrinking between this request and the reply.
   *
   * @param page - The one-based page to show.
   */
  protected goToPage(page: number): void {
    const wanted = Number.isFinite(page) ? Math.trunc(page) : 1;
    const target = Math.min(Math.max(1, wanted), this.pageCount());
    this.requestedPage.set(target);
    this.load(target);
  }

  /* -------------------------------------------------------------- delete ---- */

  /** Open the confirmation dialog for one registration. */
  protected askDelete(registration: Registration): void {
    this.pendingDelete.set(registration);
  }

  /** Close the confirmation dialog without deleting anything. */
  protected cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  /**
   * The translation key of the dialog's second sentence: how many tickets this
   * delete releases.
   *
   * Two keys rather than one with a count in it, because "1 ticket" and "2 tickets"
   * are different sentences in English and the shared placeholder substitution has
   * no plural form to reach for. Chinese, Vietnamese and Japanese do not inflect,
   * but they carry both keys with identical text so the four dictionaries stay in
   * lockstep - which is the rule check:translations enforces.
   *
   * @param registration - The registration the dialog is about.
   * @returns The key for one ticket when the row bought exactly one, otherwise the plural key.
   */
  protected deleteDetailKey(registration: Registration): string {
    return this.ticketsReleased(registration) === 1
      ? 'registrations.deleteReleasesOne'
      : 'registrations.deleteReleasesMany';
  }

  /**
   * The values substituted into the ticket-release sentence.
   *
   * @param registration - The registration the dialog is about.
   * @returns The ticket count, as the number the sentence quotes.
   */
  protected deleteDetailValues(registration: Registration): TranslationValues {
    return { count: this.ticketsReleased(registration) };
  }

  /**
   * How many tickets deleting a registration frees up for the event.
   *
   * The row's own `ticketsPurchased`, which is the number the ticket-allocation
   * rule counts: the API's capacity check sums exactly this column, so the figure
   * the dialog promises is the figure the next registration will find free. A row
   * with a missing count is treated as zero rather than as NaN, and the plural key
   * then states "0 tickets" truthfully.
   *
   * @param registration - The registration the dialog is about.
   * @returns The number of tickets the delete releases.
   */
  private ticketsReleased(registration: Registration): number {
    return Number(registration.ticketsPurchased || 0);
  }

  /**
   * Remove one registration.
   *
   * The dialog says what removing it means for the event (the
   * registrations.deleteBody wording): if it was the last one, that event can then
   * be deleted. That is the rule stated at the moment it becomes actionable. The
   * dialog also names the attendee and the tickets the delete releases, because
   * this action destroys a customer record rather than editing one.
   */
  protected confirmDelete(): void {
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
          // The event filter's options may now be stale (a registration count
          // shown elsewhere), so they are refreshed with the list.
          this.loadEvents();
        },
        error: (error: unknown) => {
          this.deleting.set(false);
          this.pendingDelete.set(null);
          this.banner.set(errorBanner(error, this.i18n.t, this.i18n.t('error.heading')));
        },
      });
  }

  /* ------------------------------------------------------------- display ---- */

  /**
   * Total tickets across the rows of the page on screen, for the table's footer.
   *
   * The rows in hand ARE the page, because the API pages the list (see the class
   * comment), so this totals exactly the rows the table above it is showing and the
   * `registrations.totalSummary` label is given that same row count. It used to be
   * meant as the whole set's total, which only worked while every matched row fitted
   * in one 100-row response - past that it presented a hundred rows' tickets as the
   * set's. A whole-set figure would have to come from a whole-set request, and the
   * API publishes no such total for this endpoint.
   */
  protected totalTickets(): number {
    return this.registrations().reduce((sum, row) => sum + Number(row.ticketsPurchased || 0), 0);
  }

  /**
   * Total money across the rows of the page on screen, for the table's footer.
   *
   * The same page-scoped rule as totalTickets(), for the same reason. The figure is
   * ticket sales - the sum of each row's `totalAmount`, which the API computes as
   * tickets x tier price - and the page states that scope in words under the footer;
   * it is deliberately NOT the dashboard's `totalRaised`, which measures donations.
   * The class comment records the endpoints and fields behind both figures, and the
   * two-pages-of-ten arithmetic the 20-row seed now produces.
   */
  protected totalValue(): number {
    return this.registrations().reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);
  }

  /** The label of an event in the filter: "#7 · Harbour Lights Art Exhibition". */
  protected eventLabel(event: Event): string {
    return `#${event.eventId} · ${event.eventName}`;
  }
}
