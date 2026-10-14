/**
 * adminside/src/app/pages/event-list/event-list.ts
 * ---------------------------------------------------------------------------
 * The main admin listing: EVERY event, whatever its status, with the three
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
 */
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

  protected readonly events = signal<readonly CharityEvent[]>([]);
  protected readonly loading = signal(true);
  protected readonly banner = signal<Banner | null>(null);

  /** How many events the API matched, which can exceed the rows returned. */
  protected readonly total = signal(0);

  /** The event awaiting confirmation, or null when no dialog is open. */
  protected readonly pendingDelete = signal<CharityEvent | null>(null);
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

    // A link from another page may preselect a filter through the query string.
    const query = this.route.snapshot.queryParamMap;
    this.filters.setValue({
      publishStatus: query.get('publishStatus') ?? 'all',
      state: query.get('state') ?? 'all',
      keyword: query.get('keyword') ?? '',
    });

    this.load();
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
    this.syncUrl(value.publishStatus, value.keyword);
    this.load();
  }

  /** Back to every event, whatever its status. */
  protected clear(): void {
    this.filters.setValue({ publishStatus: 'all', state: 'all', keyword: '' });
    this.syncUrl('all', '');
    this.load();
  }

  private syncUrl(publishStatus: string, keyword: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      // replaceUrl: filtering should not fill the Back button with history.
      replaceUrl: true,
      queryParams: {
        publishStatus: publishStatus === 'all' ? null : publishStatus,
        keyword: keyword === '' ? null : keyword,
      },
    });
  }

  /* -------------------------------------------------------------- delete ---- */

  /** Open the confirmation dialog for one event. */
  protected askDelete(event: CharityEvent): void {
    this.pendingDelete.set(event);
  }

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
   * Deliberately the same vocabulary the public site uses for an event's state,
   * so "suspended" reads as the muted past-grey rather than as an error: it is a
   * staff decision, not a fault.
   */
  protected statusClass(status: string | null | undefined): string {
    if (status === 'active') return 'badge badge--upcoming';
    if (status === 'suspended') return 'badge badge--past';
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

  /** Total registrations across the rows on screen. */
  protected totalRegistrations(): number {
    return this.events().reduce((sum, event) => sum + Number(event.registrationCount || 0), 0);
  }

  /** Total tickets sold across the rows on screen. */
  protected totalTickets(): number {
    return this.events().reduce((sum, event) => sum + Number(event.ticketsSold || 0), 0);
  }
}
