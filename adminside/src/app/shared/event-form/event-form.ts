/**
 * adminside/src/app/shared/event-form/event-form.ts
 * ---------------------------------------------------------------------------
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
import { Component, DestroyRef, DOCUMENT, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, ReactiveFormsModule, ValidationErrors } from '@angular/forms';
import { startWith } from 'rxjs';

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
  resetEventForm,
  toEventInput,
  type EventFormGroup,
  type EventFormValue,
  type TicketTierGroup,
} from '../../core/event-form';
import { WeatherPreview } from '../weather-preview/weather-preview';

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
      eventDate: value.eventDate ?? '',
      venueName: venue?.venueName ?? '',
      city: venue?.city ?? '',
    };
  });

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

    // Mirror the form's value into a signal so the weather preview can react to
    // the venue and the date without the template having to poll the form.
    this.form.valueChanges
      .pipe(startWith(this.form.getRawValue()), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.formValue.set(value));
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
    resetEventForm(this.form, this.event());
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
    resetEventForm(this.form, initial);
    this.showAllErrors.set(false);
  }

  /** Bring the first problem into view, so a long form never hides its own reason. */
  private scrollToFirstProblem(): void {
    const invalid = this.document.querySelector('admin-event-form [aria-invalid="true"]');
    invalid?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }
}
