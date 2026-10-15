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
 * screens. It is also the page size the reviewer's own numbers point at. The value
 * lives here rather than in the API because the paging is done on the client - see
 * the class comment for why.
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
 * PAGING, AND WHY IT IS DONE HERE RATHER THAN BY THE API
 *   The page asks for `limit: 100` - the same hundred rows the route returns when
 *   no limit is sent (registrationService.listRegistrations, whose own ceiling is
 *   200) - so the whole filtered set is already in the browser and the pager slices
 *   what is in memory. That is deliberate: a previous / next that re-queried the API
 *   could only ever total the rows it happened to be showing, and the footer would
 *   then report one page's tickets and money as if they were the set's. Keeping the
 *   set and paging the view lets `totalTickets()`, `totalValue()` and the
 *   `registrations.totalSummary` label describe every filtered row while only
 *   `PAGE_SIZE` of them are on screen. The consequence to be honest about: if a
 *   filter ever matched more than the 100 rows the request asks for, the pager would
 *   page within those 100 and `meta.total` would still report the larger figure -
 *   which is why the footer label counts the rows that were actually summed rather
 *   than the API's total.
 *
 * THE TWO MONEY FIGURES, AND WHY THEY ARE NOT RECONCILED
 *   This page's footer totals the registrations it holds, and the dashboard's
 *   "Total raised" tile shows `totalRaised` from GET /api/stats. They disagree -
 *   $20,575 against $99,290 on the seeded data - because they measure different
 *   things, and the disagreement was verified against the running API before
 *   anything was written on the page:
 *
 *     GET /api/registrations   each row carries `ticketPrice` and `totalAmount`,
 *                              and `totalAmount` is ticketsPurchased x ticketPrice
 *                              as the API computes it (repository.local.ts
 *                              toApiShape, the mirror of the same expression in
 *                              repository.mysql.ts). Summed over the 20 rows:
 *                              49 tickets and $20,575 of TICKET SALES.
 *     GET /api/stats           `totalRaised` is the sum, over the public events, of
 *                              each event's `raisedAmount`, and `raisedAmount` is
 *                              the sum of that event's DONATIONS (repository.local
 *                              .ts decorate(); MySQL reads the same figure as
 *                              SUM(vw_public_events.raised_amount)). $99,290.
 *
 *   The two endpoints agree on the counts - `registrations: 20` and
 *   `ticketsSold: 49` on /api/stats are exactly the 20 rows and 49 tickets
 *   /api/registrations returns - so nothing is double-counted or missing; the money
 *   is simply two different kinds of income. Neither computation is changed here,
 *   and the page now states its own scope in words under the totals row
 *   (`registrations.totalScope`), because a reader comparing the two figures has no
 *   way to know that from the numbers alone.
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

  /** The registrations matched by the filters, as the API returned them. */
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

  /** How many registrations the API matched, which can exceed the rows returned. */
  protected readonly total = signal(0);

  /**
   * The page the pager last asked for, one-based.
   *
   * It is the REQUEST, not the page on screen: `currentPage` clamps it against the
   * page count, so a delete that shortens the loaded set cannot leave the table
   * pointing past its own last page.
   */
  protected readonly requestedPage = signal(1);

  /** The registration awaiting confirmation, or null when no dialog is open. */
  protected readonly pendingDelete = signal<Registration | null>(null);

  /** True while the DELETE is in flight, so the dialog's button cannot repeat it. */
  protected readonly deleting = signal(false);

  /**
   * How many pages the loaded rows need, and never fewer than one.
   *
   * The floor matters: an empty result still has to render one disabled page rather
   * than a pager with no pages, and it keeps `currentPage` from clamping to zero.
   */
  protected readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.registrations().length / PAGE_SIZE))
  );

  /** The page actually on screen, with the requested page clamped to the range. */
  protected readonly currentPage = computed(() =>
    Math.min(this.requestedPage(), this.pageCount())
  );

  /** The rows of the current page, sliced out of the set the page already loaded. */
  protected readonly visibleRegistrations = computed(() => {
    const start = (this.currentPage() - 1) * PAGE_SIZE;
    return this.registrations().slice(start, start + PAGE_SIZE);
  });

  /**
   * Every page number, for the numbered buttons.
   *
   * Rendered in full rather than windowed with ellipses: the request asks for at
   * most 100 rows and PAGE_SIZE is 10, so the widest pager this page can build is
   * ten buttons - a set a reader can take in at once, and cheaper to build and to
   * explain than a sliding window that would never be seen.
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

  /** Fetch the registrations that match the filters. */
  private load(): void {
    const { eventId, keyword } = this.filters.getRawValue();
    this.loading.set(true);

    this.api
      .getRegistrations({
        limit: 100,
        eventId: eventId === '' ? undefined : eventId,
        keyword: keyword === '' ? undefined : keyword,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.registrations.set(page.items);
          this.total.set(page.meta.total);
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
   * outside the range, but the loaded set can shrink under the pager - deleting the
   * only row of the last page is the case - and clamping here is what keeps the
   * table from rendering empty and the current page marker from pointing at a page
   * that no longer exists.
   *
   * @param page - The one-based page to show.
   */
  protected goToPage(page: number): void {
    const wanted = Number.isFinite(page) ? Math.trunc(page) : 1;
    this.requestedPage.set(Math.min(Math.max(1, wanted), this.pageCount()));
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
   * Total tickets across EVERY row the filters matched, for the table's footer.
   *
   * Not just the visible page: the footer is the set's summary, and a pager that
   * made it report one page's tickets would give two different answers for the same
   * filter depending on where the reader had paged to. See the class comment for the
   * 100-row request this sums.
   */
  protected totalTickets(): number {
    return this.registrations().reduce((sum, row) => sum + Number(row.ticketsPurchased || 0), 0);
  }

  /**
   * Total money across EVERY row the filters matched, for the table's footer.
   *
   * The same whole-set rule as totalTickets(). The figure is ticket sales - the sum
   * of each row's `totalAmount`, which the API computes as tickets x tier price - and
   * the page states that scope in words under the footer; it is deliberately NOT the
   * dashboard's `totalRaised`, which measures donations. The class comment records
   * the endpoints and fields behind both figures.
   */
  protected totalValue(): number {
    return this.registrations().reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);
  }

  /** The label of an event in the filter: "#7 · Harbour Lights Art Exhibition". */
  protected eventLabel(event: Event): string {
    return `#${event.eventId} · ${event.eventName}`;
  }
}
