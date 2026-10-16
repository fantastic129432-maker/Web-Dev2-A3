import { Component, DestroyRef, DOCUMENT, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, ReactiveFormsModule, ValidationErrors } from '@angular/forms';
import { Subscription, startWith } from 'rxjs';

import { APP_CONFIG, EVENT_IMAGES, PUBLISH_STATUSES } from '@charity/shared/config/app-config';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import { TranslationService } from '@charity/shared/i18n/translation.service';
import type { EventDetail, EventInput } from '@charity/shared/models/event.model';
import type { ReferenceData, Venue } from '@charity/shared/models/reference.model';
import { formatPrice } from '@charity/shared/util/format';
import type { WeatherTarget } from '@charity/shared/weather/weather.model';

import {
  FIELD_LABEL_KEYS,
  REQUIRED_MESSAGE_KEYS,
  createEventForm,
  createTicketTier,
  isRowInUse,
  resetEventForm,
  toEventInput,
  type EventFormGroup,
  type EventFormValue,
  type TicketTierGroup,
} from '../../core/event-form';
import { WeatherPreview } from '../weather-preview/weather-preview';

/**
 * The event form itself: the ONE form used by both "Add a charity event" and
 * "Update a charity event", rendered once and driven by the definition in
 * app/core/event-form.ts.
 *
 * WHY ONE COMPONENT FOR BOTH PAGES
 *   This is the same decision the archived admin site made with
 *   admin/js/event-editor.js, and for the same reason: adding a field to the
 *   create form must add it to the edit form, and the validation rules must
 *   literally be the same code. The two pages differ only in what they do with
 *   the submitted payload (POST vs PUT) and in a handful of labels, which is what
 *   the `mode` input decides.
 *
 * WHAT IT DOES
 *   * paints every field of the write contract with its own message slot,
 *   * validates continuously and BLOCKS submission while anything is missing - the
 *     brief asks for this explicitly ("the form must not submit until all required
 *     fields are filled"). Blocking happens in onSubmit(), not by disabling the
 *     button: a disabled button cannot explain itself, while this one marks every
 *     field, prints the reason under each of them and scrolls to the first one,
 *   * shows the API's own per-field 400 messages next to the fields they name
 *     (the `serverErrors` input carries fieldErrorMap from ApiError),
 *   * embeds the live Open-Meteo forecast preview for the chosen venue and date.
 *
 * It never calls the API itself: it emits an EventInput and the page decides
 * whether that becomes a POST or a PUT. That is what keeps the same component
 * usable for two different endpoints.
 */
@Component({
  selector: 'admin-event-form',
  imports: [ReactiveFormsModule, TranslatePipe, WeatherPreview],
  styleUrl: './event-form.css',
  templateUrl: './event-form.html',
})
export class EventForm implements OnInit {
  private readonly i18n = inject(TranslationService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  /** 'create' posts a new event; 'edit' updates an existing one. */
  readonly mode = input.required<'create' | 'edit'>();

  /** The organisation / category / venue lists for the three dropdowns. */
  readonly reference = input.required<ReferenceData>();

  /** The event being edited, or null on the create page. */
  readonly event = input<EventDetail | null>(null);

  /**
   * Per-field messages the API returned on a 400 (ApiError.fieldErrorMap). They
   * take precedence over the client-side message for the same field, because the
   * server's wording is the authoritative one.
   */
  readonly serverErrors = input<Readonly<Record<string, string>>>({});

  /** True while the page's POST/PUT is in flight. */
  readonly saving = input(false);

  /** The validated payload, ready for createEvent() or updateEvent(). */
  readonly submitted = output<EventInput>();

  /** The two constant option lists, straight from the shared configuration. */
  protected readonly images = EVENT_IMAGES;
  protected readonly statuses = PUBLISH_STATUSES;

  /** Artwork preview: the same base URL the public pages resolve images with. */
  protected readonly imageBaseUrl = APP_CONFIG.imageBaseUrl;

  /** Set once a submit has been refused, so every message is shown at once. */
  protected readonly showAllErrors = signal(false);

  /**
   * The form is BUILT LAZILY, on the first read.
   *
   * An Angular component's field initialisers run BEFORE its inputs are set, so
   * `createEventForm(this.event())` at the top of the class would always produce
   * an empty form - the edit page would open with no event in it, which is
   * exactly the bug this getter avoids. The first read happens while rendering,
   * by which point `event()` holds the loaded event.
   */
  private built: EventFormGroup | null = null;
  protected get form(): EventFormGroup {
    return (this.built ??= createEventForm(this.event()));
  }

  /** The raw form value as a signal, so the weather preview can react to it. */
  private readonly formValue = signal<EventFormValue | null>(null);

  /**
   * The live subscription to the "this is a free event" box.
   *
   * Held so it can be dropped for the moment a reset writes that box: a reset must
   * put the money fields back to the values the event was built with, not to the
   * ones a previous tick left behind.
   */
  private freeChanges: Subscription | null = null;

  /**
   * The three dropdown lists. Copied out of the reference data with a defensive
   * default so the template can iterate them without a null check per option -
   * the page renders this form only once the lists have arrived.
   */
  protected readonly organizations = computed(() => this.reference().organizations ?? []);
  protected readonly categories = computed(() => this.reference().categories ?? []);

  /** The venue list, so a chosen locationId can be turned into coordinates. */
  protected readonly venues = computed<readonly Venue[]>(() => this.reference().locations ?? []);

  /** The repeating ticket-tier block, for formArrayName / @for. */
  protected get tiers(): FormArray<TicketTierGroup> {
    return this.form.controls.ticketTypes;
  }

  /** "Save event" / "Save changes", or the in-flight wording while the page saves. */
  protected readonly submitLabelKey = computed(() => {
    const creating = this.mode() === 'create';
    if (this.saving()) return creating ? 'form.creating' : 'form.updating';
    return creating ? 'form.save' : 'form.saveChanges';
  });

  /**
   * The artwork preview. Resolved against the same base URL the public pages use,
   * so what the administrator picks here is what a visitor will see.
   */
  protected readonly imagePreview = computed(() => {
    const chosen = this.formValue()?.imageUrl;
    return `${this.imageBaseUrl}${chosen ? chosen : APP_CONFIG.fallbackImage}`;
  });

  /**
   * Where and when the forecast is asked for.
   *
   * This is what makes the weather panel possible BEFORE the event is saved: the
   * coordinates come from the selected venue (GET /api/admin/reference-data
   * returns latitude/longitude per venue) and the date from the form, so no event
   * row has to exist yet.
   *
   * The date read here is `dateStart`, which is the form's single source for the
   * event's date; `eventDate` is derived from it when the payload is built, so the
   * forecast and the saved event cannot disagree about the day.
   */
  protected readonly weatherTarget = computed<WeatherTarget | null>(() => {
    const value = this.formValue();
    if (!value) return null;

    const locationId =
      value.locationId === null || value.locationId === undefined ? null : Number(value.locationId);
    const venue = locationId === null ? null : (this.venues().find((v) => v.locationId === locationId) ?? null);

    return {
      latitude: venue?.latitude ?? null,
      longitude: venue?.longitude ?? null,
      eventDate: value.dateStart ?? '',
      venueName: venue?.venueName ?? '',
      city: venue?.city ?? '',
    };
  });

  /**
   * The "single-day event" switch.
   *
   * Ticked means one day: the end date is not asked for and is kept equal to the
   * start date, so the payload (and the API, which derives date_end from
   * event_date) cannot describe a two-day event that the administrator thought
   * was one day. It is read OFF for a stored event whose dates differ - see
   * isStoredSingleDay() in core/event-form.ts - which is what stops an untouched
   * multi-day event from being collapsed by a save.
   *
   * A getter, not a field: it hands the template the control itself so the checkbox
   * can bind to it with formControlName, the same way every other field does.
   */
  protected get singleDay(): EventFormGroup['controls']['singleDay'] {
    return this.form.controls.singleDay;
  }

  /** True while "This is a free event" is ticked, so the price fields can be locked. */
  protected readonly isFree = computed(() => this.formValue()?.isFree === true);

  /**
   * Are the ticket tiers editable on this page?
   *
   * On the create page always. On the edit page only while the event has no tiers
   * yet, because PUT /api/events/:id adds tiers to an event that has none and
   * ignores them otherwise - so an editable box on an event that already has
   * tiers would be a lie about what Save does. The stored tiers are shown as a
   * read-only table instead, with the form.ticketTypesExistingHint note.
   */
  protected readonly tiersEditable = computed(() => {
    if (this.mode() === 'create') return true;
    return (this.event()?.ticketTypes?.length ?? 0) === 0;
  });

  /** The tier rows the event already has, for the read-only table. */
  protected readonly existingTiers = computed(() => this.event()?.ticketTypes ?? []);

  ngOnInit(): void {
    // A brand-new event needs at least one price to show on the public pages, so
    // the create form opens with two blank rows - the archived form did the same.
    // An existing event that has no tiers yet gets one, because the update
    // endpoint CAN add tiers to such an event and that is the only place to do it.
    if (this.form.controls.ticketTypes.length === 0 && this.tiersEditable()) {
      this.addTier();
      if (this.mode() === 'create') this.addTier();
    }

    /*
     * THE EVENT DATE IS DERIVED FROM THE START DATE, IN THE FORM.
     *
     * `eventDate` is a required field of the API's contract but the form no longer
     * shows a second box for it: the administrator states the event's first day
     * once, and this writes it into the control the payload builder reads. Keeping
     * the control in step here means the form's own value never contradicts itself
     * (a validation message on the hidden control, a stale date shown nowhere),
     * and toEventInput() makes the same derivation for the request body.
     *
     * It runs on a separate subscription so a change to the start date does not
     * re-enter the mirror below.
     */
    this.form.controls.dateStart.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((date) => this.form.controls.eventDate.setValue(date, { emitEvent: false }));

    /*
     * A FREE EVENT HAS NO PRICES.
     *
     * The API validates `isFree` as a boolean and each ticket price on its own
     * range (minimum 0), but it never compares the two: it happily stores
     * isFree: true beside a priced tier, which is exactly the contradictory state
     * the review found ("nothing stops an administrator ticking it and then
     * filling in a price"). The form closes that gap itself. Ticking the box
     * disables the price controls AND sets them to 0, and toEventInput() forces a
     * free event's prices to 0 as well, so a value the disabled input still held
     * can never be submitted. 0 is inside the API's own accepted range, so nothing
     * here can produce a value the API rejects.
     *
     * The value each row had is stashed in `priceBeforeFree` (form-only state, not
     * a column) so clearing the box puts a usable price back rather than leaving
     * the row at 0.
     */
    this.freeChanges = this.watchFreeToggle();

    if (this.form.controls.isFree.value === true) this.applyFreeState(true);

    // Mirror the form's value into a signal so the weather preview can react to
    // the venue and the date without the template having to poll the form.
    this.form.valueChanges
      .pipe(startWith(this.form.getRawValue()), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        // Every route into the start date - typing, the picker, "Clear the form" -
        // ends here, so the mirror is written from the subscribed value rather than
        // from a second event listener.
        this.form.controls.eventDate.setValue(value.dateStart ?? '', { emitEvent: false });
        this.formValue.set(value);
      });
  }

  /* ---------------------------------------------------- free / paid state ---- */

  /**
   * Listen for the "this is a free event" box being ticked or cleared.
   *
   * A factory rather than an inline subscription because the listener is re-made
   * after a reset (see resetTo), and one description of what it does is what keeps
   * the two places from drifting apart.
   *
   * @returns The live subscription, so the caller can drop it before a reset.
   */
  private watchFreeToggle(): Subscription {
    return this.form.controls.isFree.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((free) => this.applyFreeState(free === true));
  }

  /**
   * Apply the "this is a free event" state to the money fields.
   *
   * Ticking the box disables the goal and every ticket price and forces them to
   * zero; clearing it restores the ticket prices that were stashed on the way in.
   * The goal is deliberately NOT restored from a stash: a free event's fundraising
   * target is a decision the administrator makes again, and leaving a stale figure
   * in a box that was just re-enabled is the kind of guess this form avoids.
   *
   * ZEROING A CONTROL IS A WRITE, SO THE STATE THE EVENT ARRIVED IN IS EITHER
   * RESTORED OR REMEMBERED FIRST
   *   resetEventForm() rebuilds every control from the event, and a zero written
   *   over one of those values is a real edit as far as toEventInput() and
   *   changedFields() are concerned: the form holds a number the event does not,
   *   so the next save carries it. That is what `preserveCurrentValues` is for.
   *   It is set by resetTo() - the path that just loaded the API's own values,
   *   which include a goal and tier prices a free event really does store - and it
   *   means "the value already in the control came from the database, so keep it
   *   and remember it" rather than "zero whatever is there".
   *
   * @param free - `true` when the event is free, `false` to unlock the money fields.
   * @param preserveCurrentValues - `true` while applying the state of an event just
   *   loaded, whose goal and tier prices must be neither zeroed nor lost.
   */
  private applyFreeState(free: boolean, preserveCurrentValues = false): void {
    const goal = this.form.controls.goalAmount;

    if (free) {
      if (preserveCurrentValues) {
        // The stored target is put back as the value the form holds, so what the
        // disabled box shows is what a save will send.
        const storedGoal = goal.value;
        const target = storedGoal === null ? 0 : Number(storedGoal);
        if (goal.value !== target) goal.setValue(target, { emitEvent: false });
      } else {
        goal.setValue(0, { emitEvent: true });
      }
      goal.disable({ emitEvent: false });
    } else {
      goal.enable({ emitEvent: false });
    }

    for (const tier of this.form.controls.ticketTypes.controls) {
      const price = tier.controls.price;

      if (free) {
        // An untouched row is left alone: writing 0 into its price would make it a
        // half-filled row (a price with no name) and the API would reject the whole
        // request over a tier nobody created. The row stays blank, and a blank row
        // is dropped from the payload anyway.
        if (!isRowInUse(tier.getRawValue())) continue;

        if (preserveCurrentValues) {
          // The just-loaded path: the value in the control came from the event, so
          // it IS the price to put back when the box is cleared. Storing it even
          // when it is 0 keeps the remembered price and the stored one the same
          // number, so clearing the box can never leave the row on a guess.
          tier.controls.priceBeforeFree.setValue(
            price.value === null ? 0 : Number(price.value),
            { emitEvent: false }
          );
        } else if (price.value !== null && price.value !== 0 && tier.controls.priceBeforeFree.value === null) {
          // Never overwrite a stash that is already waiting: a second pass through
          // here must not replace the remembered price with the zero this method
          // itself wrote.
          tier.controls.priceBeforeFree.setValue(price.value, { emitEvent: false });
        }
        price.setValue(0, { emitEvent: false });
        price.disable({ emitEvent: false });
      } else {
        price.enable({ emitEvent: false });
        const remembered = tier.controls.priceBeforeFree.value;
        if (remembered !== null) {
          price.setValue(remembered, { emitEvent: false });
          tier.controls.priceBeforeFree.setValue(null, { emitEvent: false });
        }
      }
    }

    // Publish the state deliberately rather than relying on the form's own
    // notification: the writes above are silent by design (they must not be read
    // back as an edit), and the template's `isFree()` tells it whether to paint the
    // price boxes as locked. The value pushed is the one the payload builder will
    // read, so what the panel says and what is sent cannot disagree.
    this.formValue.set(this.form.getRawValue());
  }

  /* ------------------------------------------------------------- tiers ---- */

  /** Add a blank ticket-tier row. */
  protected addTier(): void {
    this.form.controls.ticketTypes.push(createTicketTier());
  }

  /** Remove one row, leaving at least one behind so the block is never empty. */
  protected removeTier(index: number): void {
    const tiers = this.form.controls.ticketTypes;
    tiers.removeAt(index);
    if (tiers.length === 0) tiers.push(createTicketTier());
  }

  /** The price of an existing tier, rendered for the read-only table. */
  protected priceLabel(price: number | null | undefined): string {
    return price === null || price === undefined || price === 0
      ? this.i18n.t('ticket.free')
      : formatPrice(price);
  }

  /* -------------------------------------------------------- validation ---- */

  /**
   * The message to show under one field, or an empty string.
   *
   * A field stays quiet until it has been touched (or until a submit was refused
   * and showAllErrors is set), so the form does not open covered in red - but a
   * refused submit shows everything at once, which is the point of blocking it.
   */
  protected messageFor(name: string): string {
    const control = this.form.get(name);
    if (!control) return '';

    const show = this.showAllErrors() || control.touched || control.dirty;
    if (!show) return '';

    // The API's own message wins: it is the authoritative answer for this field.
    const fromServer = this.serverErrors()[name];
    if (fromServer) return fromServer;

    return control.errors ? this.translateError(name, control.errors) : '';
  }

  /** The message for a cross-field rule, shown beside the field that must change. */
  protected windowMessage(key: 'dateOrder' | 'timeOrder'): string {
    const show = this.showAllErrors() || this.form.touched;
    if (!show || !this.form.hasError(key)) return '';
    return this.i18n.t(key === 'dateOrder' ? 'validation.dateOrder' : 'validation.timeOrder');
  }

  /** Turn Angular's error object into the sentence the dictionary already has. */
  private translateError(name: string, errors: ValidationErrors): string {
    const label = this.i18n.t(FIELD_LABEL_KEYS[name] ?? name);

    // Two fields have a message that says more than the generic rule.
    if (name === 'capacity' && (errors['min'] !== undefined || errors['integer'] !== undefined)) {
      return this.i18n.t('validation.capacity');
    }
    if (name === 'goalAmount' && (errors['min'] !== undefined || errors['number'] !== undefined)) {
      return this.i18n.t('validation.goalAmount');
    }

    if (errors['required'] !== undefined) {
      const specific = REQUIRED_MESSAGE_KEYS[name];
      return specific ? this.i18n.t(specific) : this.i18n.t('validation.required', { field: label });
    }

    const minLength = errors['minlength'] as { requiredLength?: number } | undefined;
    if (typeof minLength?.requiredLength === 'number') {
      return this.i18n.t('validation.minLength', { field: label, min: minLength.requiredLength });
    }

    const maxLength = errors['maxlength'] as { requiredLength?: number } | undefined;
    if (typeof maxLength?.requiredLength === 'number') {
      return this.i18n.t('validation.maxLength', { field: label, max: maxLength.requiredLength });
    }

    if (errors['min'] !== undefined) return this.i18n.t('validation.positive', { field: label });
    if (errors['integer'] !== undefined) return this.i18n.t('validation.integer', { field: label });
    if (errors['number'] !== undefined) return this.i18n.t('validation.number', { field: label });

    return '';
  }

  /** The message for one ticket-tier row, keyed by the row's own validator. */
  protected tierMessage(index: number): string {
    const tier = this.form.controls.ticketTypes.at(index);
    if (!tier) return '';
    if (!this.showAllErrors() && !tier.touched && !tier.dirty) return '';

    const errors = tier.errors;
    if (!errors) return '';

    const number = index + 1;
    if (errors['nameRequired'] !== undefined || errors['nameTooShort'] !== undefined) {
      return this.i18n.t('validation.ticketName', { number });
    }
    if (errors['priceInvalid'] !== undefined) return this.i18n.t('validation.ticketPrice', { number });
    if (errors['quantityInvalid'] !== undefined) return this.i18n.t('validation.ticketQuantity', { number });
    return '';
  }

  /* ------------------------------------------------------------ submit ---- */

  /**
   * Submit the form, if it is complete.
   *
   * THIS is where "the form must not submit until all required fields are filled"
   * is enforced: an invalid form never reaches `submitted.emit`, so no request is
   * ever sent. Marking every control touched and setting showAllErrors is what
   * makes the refusal visible instead of silent.
   */
  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (this.saving()) return;

    if (this.form.invalid) {
      this.showAllErrors.set(true);
      this.form.markAllAsTouched();
      this.scrollToFirstProblem();
      return;
    }

    this.showAllErrors.set(false);
    this.submitted.emit(toEventInput(this.form));
  }

  /** "Clear the form": back to the values this form was built with. */
  protected onReset(): void {
    this.resetTo(this.event());
    this.showAllErrors.set(false);
  }

  /**
   * Rebuild the form from a fresh event.
   *
   * Used after a successful save: the page reloads the event from the API and
   * hands it back here, so what is on screen is what the database now holds -
   * including anything the API recomputed, such as the derived event state.
   */
  reset(initial: EventDetail | null): void {
    this.resetTo(initial);
    this.showAllErrors.set(false);
  }

  /**
   * Put every control back to the value a freshly built form would hold.
   *
   * The "free event" listener is dropped for the length of the reset: resetting
   * the box would otherwise run the tick's own handler over the rows that were
   * just rebuilt, and the money fields would end up reflecting the last tick
   * instead of the event that was loaded. The handler is re-attached afterwards,
   * so the box keeps working from the next click.
   *
   * The re-application of the free state is given `preserveCurrentValues`, because
   * resetEventForm() has just written the API's own values into the controls and
   * locking the prices must not zero them: see applyFreeState(). Without it, every
   * reset silently replaced a stored goal and every stored tier price with 0 - the
   * form held a figure the event does not, and the next save sent it.
   *
   * @param initial - The event to reset to, or null to reset to a blank form.
   */
  private resetTo(initial: EventDetail | null): void {
    this.freeChanges?.unsubscribe();

    resetEventForm(this.form, initial);

    // A stored free event opens with its prices locked: the price boxes read 0
    // (that is what the form's free-event rule means) while the goal box keeps the
    // stored target, and neither write destroys a figure the event holds.
    // "The state the database holds" is why the loaded values are preserved: a free
    // event can have been stored with a goal and a non-zero tier price, and a form
    // that shows 0 for them is a form that will save 0 over them.
    this.applyFreeState(this.form.controls.isFree.value === true, true);

    this.freeChanges = this.watchFreeToggle();
  }

  /** Bring the first problem into view, so a long form never hides its own reason. */
  private scrollToFirstProblem(): void {
    const invalid = this.document.querySelector('admin-event-form [aria-invalid="true"]');
    invalid?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }
}
