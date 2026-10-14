/**
 * adminside/src/app/pages/event-edit/event-edit.ts
 * ---------------------------------------------------------------------------
 * "Update a charity event": the edit half of the write contract, reached from the
 * list's Edit link, from the dashboard and after a successful create.
 *
 * ENDPOINTS
 *   GET  /api/admin/events/:id       the event, whatever its publishing status
 *                                    (a suspended event must stay editable, and
 *                                    the PUBLIC endpoint hides those). This is
 *                                    also the endpoint that returns the event's
 *                                    registrations, which is the "associated
 *                                    registration data" the brief requires this
 *                                    interface to display.
 *   GET  /api/admin/reference-data   the three dropdown lists.
 *   PUT  /api/events/:id             a PARTIAL update: only the changed fields are
 *                                    sent, and 400 is answered to an empty body.
 *   DELETE /api/registrations/:id    used by the panel below, and the only way to
 *                                    unblock deleting an event that has
 *                                    registrations (the rule the list page reports).
 *
 * WHY ONLY THE CHANGED FIELDS ARE SENT
 *   A PUT that carried every field would overwrite a concurrent edit someone else
 *   made to a column this person never touched, and the endpoint was designed for
 *   the difference. changedFields() (core/event-form.ts) compares the form against
 *   the event the API returned, normalising the ways the two sides write the same
 *   instant ("18:30" vs "18:30:00") so that saving an untouched form is reported
 *   as "nothing changed" instead of sending a pointless request.
 */
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { ApiError } from '@charity/shared/api/api-error';
import { ApiService } from '@charity/shared/api/api.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import type { EventDetail, EventInput } from '@charity/shared/models/event.model';
import type { ReferenceData } from '@charity/shared/models/reference.model';
import type { Registration } from '@charity/shared/models/registration.model';
import { formatCurrency, formatDateTime } from '@charity/shared/util/format';

import { changedFields } from '../../core/event-form';
import { banner, errorBanner, type Banner } from '../../core/feedback';
import { usePageTitle } from '../../core/page-title';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { EventForm } from '../../shared/event-form/event-form';
import { FeedbackBanner } from '../../shared/feedback-banner/feedback-banner';

@Component({
  selector: 'admin-event-edit',
  imports: [RouterLink, TranslatePipe, FeedbackBanner, EventForm, ConfirmDialog],
  styleUrl: './event-edit.css',
  templateUrl: './event-edit.html',
})
export class EventEdit {
  private readonly api = inject(ApiService);
  private readonly i18n = inject(TranslationService);
  private readonly route = inject(ActivatedRoute);

  /**
   * The form, so it can be re-filled from the API's answer after a save.
   * viewChild is a signal, so the reference is simply null until the form exists.
   */
  private readonly formRef = viewChild(EventForm);

  protected readonly eventId = signal('');
  protected readonly event = signal<EventDetail | null>(null);
  protected readonly reference = signal<ReferenceData | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly banner = signal<Banner | null>(null);

  /** The API's per-field 400 messages, placed beside their own inputs by the form. */
  protected readonly serverErrors = signal<Readonly<Record<string, string>>>({});

  /** The registrations recorded against this event - the brief's "associated data". */
  protected readonly registrations = computed<readonly Registration[]>(
    () => this.event()?.registrations ?? []
  );

  protected readonly pendingDelete = signal<Registration | null>(null);
  protected readonly deleting = signal(false);

  /** Exposed to the template: money and timestamps are formatted everywhere the same. */
  protected readonly formatCurrency = formatCurrency;
  protected readonly formatDateTime = formatDateTime;

  constructor() {
    usePageTitle('form.editHeading');

    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.eventId.set(id);

    // The dropdown lists and the event are both needed before the form can be
    // drawn, so they are requested together.
    forkJoin({
      reference: this.api.getReferenceData(),
      event: this.api.getAdminEventById(id),
    })
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: ({ reference, event }) => {
          this.reference.set(reference);
          this.event.set(event);
          this.loading.set(false);
          this.announceCreation(event);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.banner.set(errorBanner(error, this.i18n.t, this.i18n.t('error.heading')));
        },
      });
  }

  /**
   * The create page navigates here with ?created=<id> after a successful POST.
   * The confirmation is shown HERE, next to the event it is about, rather than on
   * a page the staff member has already left.
   */
  private announceCreation(detail: EventDetail): void {
    if (this.route.snapshot.queryParamMap.get('created') === null) return;
    this.banner.set(
      banner('success', detail.eventName, this.i18n.t('form.created', { id: detail.eventId }))
    );
  }

  /* ----------------------------------------------------------------- save ---- */

  /** PUT the changed fields and report the outcome. */
  protected save(input: EventInput): void {
    const original = this.event();
    const changes = changedFields(input, original);
    const changed = Object.keys(changes);

    // Nothing changed: say so rather than sending a PUT the API would reject with
    // 400 ("No fields were supplied").
    if (changed.length === 0) {
      this.banner.set(banner('info', original?.eventName ?? '', this.i18n.t('form.noChanges')));
      return;
    }

    this.saving.set(true);
    this.serverErrors.set({});

    this.api
      .updateEvent(this.eventId(), changes)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (updated) => {
          this.saving.set(false);
          this.banner.set(
            banner(
              'success',
              // The list of what changed doubles as the banner's title, which is
              // far more informative than "Saved" alone.
              changed.join(', '),
              this.i18n.t('form.updated', { name: updated.eventName })
            )
          );
          this.reload();
        },
        error: (error: unknown) => {
          this.saving.set(false);

          if (error instanceof ApiError && error.isValidation) {
            this.serverErrors.set(error.fieldErrorMap);
            this.banner.set(errorBanner(error, this.i18n.t, this.i18n.t('error.validation')));
            return;
          }

          this.banner.set(errorBanner(error, this.i18n.t, this.i18n.t('error.heading')));
        },
      });
  }

  /**
   * Re-read the event and rebuild the form from it.
   *
   * The API's answer is the truth: it may have recomputed the derived event state
   * or the goal progress, and the registration list has to stay accurate after a
   * registration is deleted. The success banner is deliberately NOT cleared - an
   * earlier revision cleared it here, which meant the confirmation flashed up and
   * vanished before it could be read.
   */
  private reload(): void {
    this.api
      .getAdminEventById(this.eventId())
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (detail) => {
          this.event.set(detail);
          this.formRef()?.reset(detail);
        },
        error: (error: unknown) => {
          this.banner.set(errorBanner(error, this.i18n.t, this.i18n.t('error.heading')));
        },
      });
  }

  /* -------------------------------------------------- registrations panel ---- */

  /** The sentence that explains what the registration count means for deletion. */
  protected readonly blockedMessage = computed(() => {
    const count = this.registrations().length;
    return count === 0
      ? this.i18n.t('update.registrationsEmpty')
      : this.i18n.t('update.registrationsBlocked', { count });
  });

  protected askDeleteRegistration(registration: Registration): void {
    this.pendingDelete.set(registration);
  }

  protected cancelDeleteRegistration(): void {
    this.pendingDelete.set(null);
  }

  /**
   * Remove one registration.
   *
   * This is the escape hatch the data-integrity rule implies: an event with
   * registrations cannot be deleted, so staff who genuinely need to remove one must
   * be able to see and manage the registrations first. The panel says so plainly
   * instead of hiding the rule.
   */
  protected confirmDeleteRegistration(): void {
    const target = this.pendingDelete();
    if (!target || this.deleting()) return;

    this.deleting.set(true);

    this.api
      .deleteRegistration(target.registrationId)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: () => {
          this.deleting.set(false);
          this.pendingDelete.set(null);
          this.banner.set(
            banner('success', target.attendeeName, this.i18n.t('registrations.deleted'))
          );
          // Reload so the count - and therefore what the list page will allow -
          // is accurate.
          this.reload();
        },
        error: (error: unknown) => {
          this.deleting.set(false);
          this.pendingDelete.set(null);
          this.banner.set(errorBanner(error, this.i18n.t, this.i18n.t('error.heading')));
        },
      });
  }
}
