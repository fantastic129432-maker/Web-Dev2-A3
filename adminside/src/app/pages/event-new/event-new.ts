import { Component, computed, inject, signal } from '@angular/core';
import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';

import { ApiError } from '@charity/shared/api/api-error';
import { ApiService } from '@charity/shared/api/api.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import type { EventInput } from '@charity/shared/models/event.model';
import type { ReferenceData } from '@charity/shared/models/reference.model';

import { errorBanner, type Banner } from '../../core/feedback';
import { usePageTitle } from '../../core/page-title';
import { EventForm } from '../../shared/event-form/event-form';
import { FeedbackBanner } from '../../shared/feedback-banner/feedback-banner';

/**
 * The "Add a charity event" page, which is the create half of the write contract.
 *
 * ENDPOINTS
 *   GET  /api/admin/reference-data   organisations, categories and venues for the
 *                                    three dropdowns. The form is rendered only
 *                                    once these arrive, which is what makes the
 *                                    dropdowns real lists rather than text boxes
 *                                    that invite a foreign-key error.
 *   POST /api/events                 the create. Answers 201 with the new event,
 *                                    or 400 with one entry per rejected field.
 *
 * WHAT HAPPENS ON SUCCESS
 *   The page navigates to the new event's own edit page with ?created=<id>, and
 *   THAT page shows the confirmation. This is the one flow where the brief allows
 *   either "show a confirmation" or "navigate", and doing both is more useful than
 *   either: the staff member gets an unambiguous success message and lands on the
 *   event they just created, ready to add its tiers or fix a typo.
 *
 * A 400 is handled twice, on purpose: the banner lists every rejected field (so
 * nothing is missed) and the same messages are placed beside their own inputs by
 * EventForm.serverErrors (so the fix is where the person is looking).
 */
@Component({
  selector: 'admin-event-new',
  imports: [RouterLink, TranslatePipe, FeedbackBanner, EventForm],
  styleUrl: './event-new.css',
  templateUrl: './event-new.html',
})
export class EventNew {
  private readonly api = inject(ApiService);
  private readonly i18n = inject(TranslationService);
  private readonly router = inject(Router);

  /**
   * Held so every subscription made OUTSIDE the constructor can still be tied to
   * this component's lifetime; see the note in create().
   */
  private readonly destroyRef = inject(DestroyRef);

  /** The organisations, categories and venues the three dropdowns offer. */
  protected readonly reference = signal<ReferenceData | null>(null);

  /** True while the reference data is being fetched. */
  protected readonly loading = signal(true);

  /** True while the POST is in flight, so the form's Save button can say so. */
  protected readonly saving = signal(false);

  /** The page-level message, or null when nothing has been reported. */
  protected readonly banner = signal<Banner | null>(null);

  /** The API's per-field 400 messages, handed to the form to place by each input. */
  protected readonly serverErrors = signal<Readonly<Record<string, string>>>({});

  /**
   * A brand-new event needs an organisation, a category and a venue. An empty
   * list means the database has not been seeded, and saying so is far more useful
   * than rendering three selects with nothing in them.
   */
  protected readonly ready = computed(() => {
    const data = this.reference();
    if (!data) return false;
    return (
      (data.organizations?.length ?? 0) > 0 &&
      (data.categories?.length ?? 0) > 0 &&
      (data.locations?.length ?? 0) > 0
    );
  });

  constructor() {
    usePageTitle('form.newHeading');

    this.api
      .getReferenceData()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (data) => {
          this.reference.set(data);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.banner.set(errorBanner(error, this.i18n.t, this.i18n.t('error.heading')));
        },
      });
  }

  /**
   * POST the validated payload, then move to the event that was created.
   *
   * THE GUARD IS HERE RATHER THAN ONLY IN THE FORM, and the difference is one change
   * detection. `EventForm.onSubmit()` also returns early while `saving()` is true, but
   * `saving` reaches the form as an INPUT binding, which Angular updates when it next
   * checks the view - not while this handler is still running. Two clicks dispatched
   * in the same JavaScript task therefore both get past the form's guard, and measured
   * against this build (a click on Save, then a second click before any change
   * detection, with the PUT paused at the network layer) TWO `PUT /api/events/2`
   * requests left the browser. A real pointer cannot produce that - two physical clicks
   * are two tasks, and change detection runs between them - but a script, a synthetic
   * click, or a browser that coalesces them can, and the second request is a second
   * write of the same payload.
   *
   * This signal, unlike the input, IS up to date: it is set synchronously by this very
   * method, so the second call reads true and returns. The form's own guard stays as
   * well - it is what stops the button being pressed again while the page is busy.
   *
   * @param input - The validated payload the form emitted.
   */
  protected create(input: EventInput): void {
    if (this.saving()) return;

    this.saving.set(true);
    this.serverErrors.set({});

    this.api
      .createEvent(input)
      // takeUntilDestroyed is passed the DestroyRef explicitly: this method runs
      // from a click, which is NOT an injection context, and the no-argument form
      // throws NG0203 there - leaving the Save button disabled forever.
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.saving.set(false);
          void this.router.navigate(['/events', created.eventId, 'edit'], {
            queryParams: { created: created.eventId },
          });
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
}
