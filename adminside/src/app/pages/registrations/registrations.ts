import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ApiService } from '@charity/shared/api/api.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import type { Event } from '@charity/shared/models/event.model';
import type { Registration } from '@charity/shared/models/registration.model';
import { formatCurrency, formatDateTime } from '@charity/shared/util/format';

import { banner, errorBanner, type Banner } from '../../core/feedback';
import { usePageTitle } from '../../core/page-title';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { FeedbackBanner } from '../../shared/feedback-banner/feedback-banner';

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

  /** The registration awaiting confirmation, or null when no dialog is open. */
  protected readonly pendingDelete = signal<Registration | null>(null);

  /** True while the DELETE is in flight, so the dialog's button cannot repeat it. */
  protected readonly deleting = signal(false);

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

    this.load();
  }

  /** Back to every registration. */
  protected clear(): void {
    this.filters.setValue({ eventId: '', keyword: '' });
    void this.router.navigate([], { relativeTo: this.route, replaceUrl: true, queryParams: {} });
    this.load();
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
   * Remove one registration.
   *
   * The dialog says what removing it means for the event (the
   * registrations.deleteBody wording): if it was the last one, that event can then
   * be deleted. That is the rule stated at the moment it becomes actionable.
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

  /** Total tickets on the rows currently shown, for the table's footer. */
  protected totalTickets(): number {
    return this.registrations().reduce((sum, row) => sum + Number(row.ticketsPurchased || 0), 0);
  }

  /** Total money on the rows currently shown. */
  protected totalValue(): number {
    return this.registrations().reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);
  }

  /** The label of an event in the filter: "#7 · Harbour Lights Art Exhibition". */
  protected eventLabel(event: Event): string {
    return `#${event.eventId} · ${event.eventName}`;
  }
}
