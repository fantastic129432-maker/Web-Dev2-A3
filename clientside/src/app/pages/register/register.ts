import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ApiError } from '@charity/shared/api/api-error';
import { ApiService } from '@charity/shared/api/api.service';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import type { EventDetail, TicketType } from '@charity/shared/models/event.model';
import type { Registration, RegistrationInput } from '@charity/shared/models/registration.model';
import {
  formatCurrency,
  formatDate,
  formatPrice,
  formatTimeRange,
  imageUrl,
  stateKey,
} from '@charity/shared/util/format';
import { todayIso } from '@charity/shared/weather/weather.model';

import { useDocumentTitle } from '../../shared/page-title';

/** The largest number of tickets one person may book, matching the API. */
const MAX_TICKETS = 20;

/**
 * Which screen the page is showing.
 *
 * A single value rather than several booleans, because exactly one of these is
 * true at any moment: the page is loading the event, showing the form, showing
 * the receipt, or showing a problem. Several booleans would allow impossible
 * combinations such as "form and confirmation".
 */
type View = 'loading' | 'form' | 'confirmation' | 'problem' | 'no-event';

/** The registration form as one value. */
interface RegistrationForm {
  attendeeName: string;
  attendeeEmail: string;
  attendeePhone: string;
  registeredAt: string;
  ticketTypeId: string;
  ticketsPurchased: number;
  notes: string;
}

/** Per-field messages, keyed by the form field name (not the DOM id). */
type FieldErrors = Partial<Record<keyof RegistrationForm, string>>;

/**
 * The registration page.
 *
 * ENDPOINTS USED
 *   `GET  /api/events/:id`                 the event being registered for
 *   `POST /api/events/:id/registrations`   the new registration record
 *   `GET  /api/events/:id`                 again after a success, to refresh
 *                                          the "places left" figure
 *
 * WHY THE EVENT IS FETCHED AGAIN RATHER THAN PASSED IN
 *   Registration is per event and the visitor can arrive here by URL, so the event
 *   object has to be loaded from the id in the route. The brief is explicit that
 *   the page must make it "clear about the event they are registering for", so
 *   the summary panel repeats the name, date, venue and price rather than relying
 *   on the visitor remembering the previous page.
 *
 * WHY THE TICKET TIERS COME FROM THE EVENT
 *   `event.ticketTypes` is the authoritative list and `event.registrations` (which
 *   the same response carries) says how many of each tier are already sold, so the
 *   "sold out" and "N available" labels on this form agree with the registrations
 *   table on the event page without a second request.
 *
 * THE THREE FAILURE PATHS, AND WHY THEY DIFFER
 *   409 Conflict - this email address is already registered for this event. It is
 *                  reported against the EMAIL FIELD, because that is what the
 *                  visitor has to change (or recognise as "I already booked").
 *   400 Bad request - the API returns one entry per rejected field, so each is
 *                  mapped onto the control that produced it through
 *                  `ApiError.fieldErrorMap`.
 *   anything else - one summary message from `ApiError.friendlyMessage`, which
 *                  already picks a sentence appropriate to the status (timeout,
 *                  offline, 5xx) in the active language.
 *
 * Client-side validation runs first for everything that can be checked locally
 * (required fields, an email shape, at least one ticket, and whether the chosen
 * tier has that many left). That is an improvement to the experience only: the API
 * applies the same rules again, which is what actually protects the data.
 */
@Component({
  selector: 'app-register-page',
  imports: [RouterLink, TranslatePipe],
  templateUrl: './register.html',
})
export class RegisterPage {
  private readonly api = inject(ApiService);
  private readonly i18n = inject(TranslationService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  /** Tab title: 'form.title' while registering, 'form.successHeading' after. */
  private readonly title = useDocumentTitle();

  /** The ticket ceiling the API enforces; also shown in the quantity hint. */
  protected readonly maxTickets = MAX_TICKETS;

  /** Which screen is showing. */
  protected readonly view = signal<View>('loading');

  /** The event being registered for. */
  protected readonly event = signal<EventDetail | null>(null);

  /** A page-level problem message (a failed load, or an unmapped API failure). */
  protected readonly problem = signal<string | null>(null);

  /** Extra lines under a problem message. */
  protected readonly problemDetails = signal<string[]>([]);

  /** The accepted registration, once the API has stored it. */
  protected readonly registration = signal<Registration | null>(null);

  /** True while the POST is in flight, so the button can say so and not repeat. */
  protected readonly submitting = signal(false);

  /**
   * The form. `registeredAt` defaults to today, because a visitor registering now
   * is recording today's purchase; the field exists because the API accepts an
   * explicit date for entering an existing record.
   */
  protected readonly form = signal<RegistrationForm>({
    attendeeName: '',
    attendeeEmail: '',
    attendeePhone: '',
    registeredAt: todayIso(),
    ticketTypeId: '',
    // 1 rather than 0: the field is "how many", so an empty-looking 0 would be a
    // validation error before the visitor had touched anything.
    ticketsPurchased: 1,
    notes: '',
  });

  /** Per-field messages, written by validation or by an API failure. */
  protected readonly fieldErrors = signal<FieldErrors>({});

  /** A summary message at the top of the form, announced as an alert. */
  protected readonly summaryMessage = signal<string | null>(null);

  /** The event's route param, read once. */
  private readonly eventId = this.route.snapshot.paramMap.get('id') ?? '';

  constructor() {
    this.title.set();
    this.loadEvent();
  }

  /* ==================================================================
   * Loading the event
   * ================================================================== */

  /**
   * `GET /api/events/:id`.
   *
   * Two outcomes are separated deliberately: a missing id (the visitor typed
   * /register with nothing after it) is NOT an error - nobody made a mistake, the
   * page simply needs an event - so it gets a neutral note with the way in, not a
   * red "Something went wrong" panel.
   */
  private loadEvent(): void {
    if (!this.eventId) {
      this.view.set('no-event');
      return;
    }

    this.api
      .getEventById(this.eventId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          this.event.set(event);

          // A past event cannot be registered for. The API would accept the
          // insert, so the rule belongs here as well as in the database - and the
          // visitor is told why rather than being shown a form that cannot work.
          if (event.eventState === 'past') {
            this.problem.set(this.i18n.t('event.registerClosed'));
            this.problemDetails.set([this.i18n.t('event.statusPast', { date: formatDate(event.dateEnd) })]);
            this.view.set('problem');
            return;
          }

          this.form.update((current) => ({
            ...current,
            ticketTypeId: String(this.preferredTier(event)?.ticketTypeId ?? ''),
          }));
          this.view.set('form');
        },
        error: (error: unknown) => {
          const isNotFound = error instanceof ApiError && error.isNotFound;
          this.problem.set(
            error instanceof ApiError
              ? error.friendlyMessage((key) => this.i18n.t(key))
              : this.i18n.t('error.eventLoadFailed')
          );
          this.problemDetails.set(isNotFound ? [this.i18n.t('error.eventSuspendedHint')] : []);
          this.view.set('problem');
        },
      });
  }

  /* ==================================================================
   * Derived form values
   * ================================================================== */

  /** The ticket tiers the event offers. */
  protected readonly tiers = computed<TicketType[]>(() => this.event()?.ticketTypes ?? []);

  /** The tier the visitor has chosen, or null for "general entry". */
  protected readonly selectedTier = computed<TicketType | null>(() => {
    const chosen = this.form().ticketTypeId;
    if (chosen === '') return null;
    return this.tiers().find((tier) => String(tier.ticketTypeId) === chosen) ?? null;
  });

  /**
   * How many of the chosen tier are still available, or null when the tier
   * publishes no allocation.
   *
   * Sold counts come from `event.registrations`, which the same event response
   * already carries, so this needs no extra request - and it is what makes the
   * "sold out" label here agree with the registrations table on the event page.
   */
  protected readonly remainingForTier = computed<number | null>(() => {
    const tier = this.selectedTier();
    if (!tier) return null;
    if (tier.quantityAvailable === null || tier.quantityAvailable === undefined) return null;

    const sold = (this.event()?.registrations ?? [])
      .filter((row) => Number(row.ticketTypeId) === Number(tier.ticketTypeId))
      .reduce((sum, row) => sum + Number(row.ticketsPurchased ?? 0), 0);

    return Math.max(Number(tier.quantityAvailable) - sold, 0);
  });

  /**
   * The largest number of tickets this visitor may ask for: the API's own limit,
   * or what is left of the chosen tier, whichever is smaller.
   */
  protected readonly quantityCeiling = computed(() => {
    const remaining = this.remainingForTier();
    if (remaining === null) return MAX_TICKETS;
    return Math.max(Math.min(MAX_TICKETS, remaining), 1);
  });

  /**
   * The ceiling actually shown on the number input.
   *
   * `max="0"` would make the browser refuse every value for a sold-out tier, which
   * hides the real message ("Sold out") behind a spinner that will not move. The
   * sold-out case is reported by validation instead, so the attribute is floored at
   * 1 and never blocks the field from being used.
   */
  protected readonly quantityMax = computed(() => Math.max(this.quantityCeiling(), 1));

  /**
   * The running total, e.g. "Total: 2 x $185.00 = $370.00".
   *
   * Recalculated from the signals on every change, which is why there is no
   * "updateTotal" call sprinkled through the event handlers as there was in the
   * legacy version: the template reads this computed value, so it cannot go stale.
   * A free tier says "Free" rather than "$0.00", which reads like a fault.
   */
  protected readonly totalLine = computed(() => {
    const tier = this.selectedTier();
    const quantity = this.form().ticketsPurchased;
    if (!tier || !Number.isFinite(quantity) || quantity < 1) return '';

    const price = Number(tier.price);
    if (price === 0) return `${this.i18n.t('form.totalLabel')}: ${this.i18n.t('event.free')}`;

    return `${this.i18n.t('form.totalLabel')}: ${this.i18n.t('form.estimatedTotal', {
      quantity,
      price: formatPrice(price),
      total: formatCurrency(price * quantity),
    })}`;
  });

  /**
   * The cheapest tier a visitor can actually buy.
   *
   * Every seeded event lists its free or concession tier first, and selecting that
   * by default meant the form opened on "Free Community Entry" for a paid fun run:
   * technically valid, but not what most people are there to do, and the live total
   * read "Free" before the visitor had touched anything. Falls back to the first
   * tier that is not sold out, then to the first tier at all, which is the correct
   * default for an event where every tier is free.
   */
  private preferredTier(event: EventDetail): TicketType | null {
    const tiers = event.ticketTypes ?? [];
    if (tiers.length === 0) return null;

    const soldFor = (tier: TicketType): number =>
      (event.registrations ?? [])
        .filter((row) => Number(row.ticketTypeId) === Number(tier.ticketTypeId))
        .reduce((sum, row) => sum + Number(row.ticketsPurchased ?? 0), 0);

    const available = tiers.filter(
      (tier) =>
        tier.quantityAvailable === null ||
        tier.quantityAvailable === undefined ||
        Number(tier.quantityAvailable) - soldFor(tier) > 0
    );

    return (
      available.find((tier) => Number(tier.price) > 0) ?? available[0] ?? tiers[0]
    );
  }

  /* ==================================================================
   * Event summary helpers (shown above the form)
   * ================================================================== */

  protected readonly image = computed(() => {
    const event = this.event();
    return event ? imageUrl(event) : '';
  });

  protected readonly badgeClass = computed(
    () => `badge badge--${this.event()?.eventState ?? 'upcoming'}`
  );

  protected readonly stateLabelKey = computed(() => stateKey(this.event()?.eventState));

  protected readonly fullDate = computed(() => formatDate(this.event()?.dateStart));

  protected readonly timeRange = computed(() => {
    const event = this.event();
    return event ? formatTimeRange(event) : '';
  });

  protected readonly locationLine = computed(() => {
    const event = this.event();
    if (!event) return '';
    return `${event.city ?? ''} ${event.state ?? ''}`.trim();
  });

  /**
   * "12 of 300 places left", or an empty string when the event publishes no
   * capacity. Places left is only meaningful against a published capacity.
   */
  protected readonly seatsRemaining = computed(() => {
    const event = this.event();
    if (!event || !event.capacity) return '';
    const registered = Number(event.registrationCount ?? 0);
    return this.i18n.t('event.seatsRemaining', {
      count: Math.max(Number(event.capacity) - registered, 0),
      capacity: Number(event.capacity),
    });
  });

  /** "12 available" / "Sold out", shown next to the chosen tier in the dropdown. */
  protected tierLabel(tier: TicketType): string {
    const price = Number(tier.price) === 0 ? this.i18n.t('event.free') : formatPrice(tier.price);
    const parts = [`${tier.ticketName} - ${price}`];

    if (tier.quantityAvailable !== null && tier.quantityAvailable !== undefined) {
      const sold = (this.event()?.registrations ?? [])
        .filter((row) => Number(row.ticketTypeId) === Number(tier.ticketTypeId))
        .reduce((sum, row) => sum + Number(row.ticketsPurchased ?? 0), 0);
      const remaining = Math.max(Number(tier.quantityAvailable) - sold, 0);
      parts.push(
        remaining > 0
          ? this.i18n.t('event.availableCount', { count: remaining })
          : this.i18n.t('event.soldOut')
      );
    }

    return parts.join(' \u00B7 ');
  }

  /* ==================================================================
   * Form field handlers
   * ================================================================== */

  /**
   * Update one text field.
   *
   * The per-field error is cleared as soon as the visitor edits that field, so a
   * corrected field stops showing the message that prompted the correction -
   * without waiting for the next submit.
   */
  protected setField(
    field: 'attendeeName' | 'attendeeEmail' | 'attendeePhone' | 'registeredAt' | 'notes',
    value: string
  ): void {
    this.form.update((current) => ({ ...current, [field]: value }));
    this.clearFieldError(field);
  }

  /** The ticket tier dropdown. */
  protected setTier(value: string): void {
    this.form.update((current) => ({ ...current, ticketTypeId: value }));
    this.clearFieldError('ticketTypeId');

    // Choosing a different tier can lower the ceiling, so a quantity that is now
    // too high is brought back into range rather than left to fail validation.
    this.form.update((current) => ({
      ...current,
      ticketsPurchased: Math.min(Math.max(current.ticketsPurchased, 1), this.quantityCeiling()),
    }));
    this.clearFieldError('ticketsPurchased');
  }

  /**
   * The number of tickets.
   *
   * A non-numeric value (an emptied field) is stored as 0 rather than ignored, so
   * validation can tell the visitor that at least one ticket is needed instead of
   * silently keeping the previous number while the box looks empty.
   */
  protected setQuantity(value: string): void {
    const parsed = Number(value);
    this.form.update((current) => ({
      ...current,
      ticketsPurchased: Number.isFinite(parsed) ? Math.trunc(parsed) : 0,
    }));
    this.clearFieldError('ticketsPurchased');
  }

  private clearFieldError(field: keyof RegistrationForm): void {
    this.fieldErrors.update((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  /** The message to show under one field, or null. */
  protected errorFor(field: keyof RegistrationForm): string | null {
    return this.fieldErrors()[field] ?? null;
  }

  /**
   * The DOM id of the message paragraph for a field.
   *
   * `aria-describedby` has to name an element, and the ids are derived from the
   * field name rather than written out twice, so the input and its message cannot
   * drift apart.
   */
  protected messageId(field: keyof RegistrationForm): string {
    return `reg-${field}-message`;
  }

  /* ==================================================================
   * Validation
   * ================================================================== */

  /**
   * The client-side rules, as a field -> message map.
   *
   * Runs before every submit. The email pattern is the same one the API applies,
   * so the two agree on what a valid address is and the visitor is told before a
   * round trip is made. The phone number is optional, but a wrong one is worse
   * than a missing one, so a bad shape is rejected rather than stripped.
   */
  private validate(): FieldErrors {
    const current = this.form();
    const errors: FieldErrors = {};

    const name = current.attendeeName.trim();
    if (name.length < 2 || name.length > 120) {
      errors.attendeeName = this.i18n.t('event.validationName');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(current.attendeeEmail.trim())) {
      errors.attendeeEmail = this.i18n.t('event.validationEmail');
    }

    const phone = current.attendeePhone.trim();
    if (phone !== '' && !/^[+()\d][\d\s\-().]{5,29}$/.test(phone)) {
      errors.attendeePhone = this.i18n.t('event.validationPhone');
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(current.registeredAt)) {
      errors.registeredAt = this.i18n.t('event.validationDate');
    }

    const quantity = current.ticketsPurchased;
    if (!Number.isInteger(quantity) || quantity < 1) {
      errors.ticketsPurchased = this.i18n.t('event.validationQuantity');
    } else if (quantity > MAX_TICKETS) {
      errors.ticketsPurchased = this.i18n.t('event.validationQuantityMax', { max: MAX_TICKETS });
    } else {
      // How many of the chosen tier are left? Checked here as well as in the API
      // so the visitor is not sent on a round trip that is certain to fail.
      const remaining = this.remainingForTier();
      if (remaining !== null) {
        if (remaining <= 0) {
          errors.ticketTypeId = this.i18n.t('event.soldOut');
        } else if (quantity > remaining) {
          errors.ticketsPurchased = this.i18n.t('event.availableCount', { count: remaining });
        }
      }
    }

    return errors;
  }

  /* ==================================================================
   * Submission
   * ================================================================== */

  /**
   * Validate, then POST the registration.
   *
   * See the class comment for how the three failure shapes are handled
   * differently; the important part is that a 409 names the email field, because
   * "this address is already registered" is only actionable next to the address.
   */
  protected submit(): void {
    if (this.submitting()) return;

    const errors = this.validate();
    if (Object.keys(errors).length > 0) {
      this.fieldErrors.set(errors);
      this.summaryMessage.set(this.i18n.t('form.requiredNotice'));
      this.focusFirstProblem(errors);
      return;
    }

    const event = this.event();
    if (!event) return;

    this.fieldErrors.set({});
    this.summaryMessage.set(null);
    this.submitting.set(true);

    const current = this.form();
    const input: RegistrationInput = {
      attendeeName: current.attendeeName.trim(),
      // Lower-cased to match the API and the UNIQUE (event_id, attendee_email)
      // key, so the visitor's "Alex@Example.com" is recognised as the same person.
      attendeeEmail: current.attendeeEmail.trim().toLowerCase(),
      attendeePhone: current.attendeePhone.trim() === '' ? null : current.attendeePhone.trim(),
      registeredAt: current.registeredAt,
      ticketsPurchased: current.ticketsPurchased,
      ticketTypeId: current.ticketTypeId === '' ? null : Number(current.ticketTypeId),
      notes: current.notes.trim() === '' ? null : current.notes.trim(),
    };

    this.api
      .createRegistration(event.eventId, input)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (registration) => {
          this.registration.set(registration);
          this.submitting.set(false);
          this.view.set('confirmation');
          this.title.set('form.successHeading');

          // Re-read the event so the receipt and the "places left" figure reflect
          // the registration that was just made. A failure here must NOT hide the
          // success, so the copy already in memory is kept.
          this.api
            .getEventById(event.eventId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (refreshed) => this.event.set(refreshed),
              error: () => undefined,
            });
        },
        error: (error: unknown) => {
          this.submitting.set(false);

          if (error instanceof ApiError && error.isConflict) {
            /*
             * 409: this email address is already registered for this event.
             *
             * The TRANSLATED sentence is used, not the API's own wording. This API
             * always sends an English message for this conflict, so preferring it
             * meant a Chinese, Vietnamese or Japanese visitor read English in the
             * most common failure this form has - while `error.alreadyRegistered`
             * sat unused in all four dictionaries, added for exactly this case.
             */
            const message = this.i18n.t('error.alreadyRegistered');
            this.fieldErrors.set({ attendeeEmail: message });
            this.summaryMessage.set(message);
            this.focusFirstProblem({ attendeeEmail: 'x' });
            return;
          }

          if (error instanceof ApiError && error.isValidation) {
            // 400: one entry per rejected field, mapped onto the controls.
            const map = error.fieldErrorMap;
            const mapped: FieldErrors = {};
            const fields: Array<keyof RegistrationForm> = [
              'attendeeName',
              'attendeeEmail',
              'attendeePhone',
              'registeredAt',
              'ticketsPurchased',
              'ticketTypeId',
              'notes',
            ];
            for (const field of fields) {
              const message = map[field];
              if (message) mapped[field] = message;
            }

            if (Object.keys(mapped).length > 0) {
              this.fieldErrors.set(mapped);
              this.summaryMessage.set(this.i18n.t('form.requiredNotice'));
              this.focusFirstProblem(mapped);
              return;
            }
          }

          // Anything else: one translated sentence appropriate to the status
          // (timeout, offline, 5xx, rate limited).
          this.summaryMessage.set(
            error instanceof ApiError
              ? error.friendlyMessage((key) => this.i18n.t(key))
              : this.i18n.t('error.server')
          );
        },
      });
  }

  /**
   * Move the view to the first problem.
   *
   * The form lives inside a scrolling page, so on a phone the offending field can
   * be off screen; scrolling it into view and focusing it puts the cursor where the
   * work is. The browser is asked for the element by id rather than Angular being
   * asked for a reference, because the ids are already the contract between an
   * input and its message.
   *
   * A `requestAnimationFrame` hop is used because the messages are written into
   * signals in the same tick: the elements exist, but their messages have not
   * painted yet, so focusing immediately would land on the field before the reason
   * is visible.
   */
  private focusFirstProblem(errors: FieldErrors): void {
    const order: Array<keyof RegistrationForm> = [
      'attendeeName',
      'attendeeEmail',
      'attendeePhone',
      'registeredAt',
      'ticketTypeId',
      'ticketsPurchased',
      'notes',
    ];
    const first = order.find((field) => field in errors);
    if (!first) return;

    requestAnimationFrame(() => {
      const element = document.getElementById(`reg-${first}`);
      if (!element) return;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.focus({ preventScroll: true });
    });
  }

  /* ==================================================================
   * Confirmation
   * ================================================================== */

  /** The receipt's rows, read back from the API response rather than the form. */
  protected readonly receiptRows = computed<Array<{ labelKey: string; value: string }>>(() => {
    const registration = this.registration();
    if (!registration) return [];

    return [
      { labelKey: 'event.registrationsLogin', value: `#${registration.registrationId}` },
      { labelKey: 'form.name', value: registration.attendeeName },
      /*
       * `attendeeEmail` is optional on the Registration type because the PUBLIC
       * event detail endpoint does not send it (an anonymous visitor must not be
       * shown anybody's address - see shared/src/models/registration.model.ts).
       * This is the visitor's OWN receipt, printed from the POST response, which
       * always carries the address that was just submitted; the empty-string
       * fallback is therefore only here to satisfy the type, and an empty receipt
       * line would be a visible symptom rather than a silent wrong value.
       */
      { labelKey: 'form.email', value: registration.attendeeEmail ?? '' },
      { labelKey: 'form.date', value: formatDate(String(registration.registeredAt).slice(0, 10)) },
      {
        labelKey: 'form.ticketType',
        value: registration.ticketName ?? this.i18n.t('form.ticketNone'),
      },
      { labelKey: 'form.quantity', value: String(registration.ticketsPurchased) },
      {
        labelKey: 'form.totalLabel',
        value:
          Number(registration.totalAmount ?? 0) > 0
            ? formatCurrency(registration.totalAmount)
            : this.i18n.t('event.free'),
      },
    ];
  });

  /**
   * The confirmation's opening line, e.g.
   * "Thank you, Alex Nguyen. Your registration for Coastal Stars Gala Dinner is
   * confirmed."
   */
  protected readonly successLead = computed(() => {
    const registration = this.registration();
    const event = this.event();
    if (!registration) return '';
    return this.i18n.t('form.successLead', {
      name: registration.attendeeName,
      event: event?.eventName ?? '',
    });
  });

  /** "A confirmation has been recorded for alex@example.com." */
  protected readonly successEmail = computed(() => {
    const registration = this.registration();
    return registration
      ? this.i18n.t('form.successEmail', { email: registration.attendeeEmail ?? '' })
      : '';
  });
}
