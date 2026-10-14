/**
 * adminside/src/app/core/event-form.ts
 * ---------------------------------------------------------------------------
 * The event form as DATA: its controls, its validation rules, the payload it
 * produces and the "what actually changed?" comparison.
 *
 * WHY THE FORM IS DESCRIBED HERE AND NOT INSIDE A COMPONENT
 *   The archived admin site built ONE form and used it on both the "add event"
 *   page and the "update event" page (admin/js/event-editor.js + admin-shared.js),
 *   for a reason that still holds: two hand-written forms drift apart, and the
 *   day they do, a field exists on one page and is silently dropped by the other.
 *
 *   `EventForm` (app/shared/event-form) is the template that paints this
 *   definition; this module is the definition. Keeping them apart means the
 *   rules - the length limits the API enforces, the cross-field checks the
 *   database's CHECK constraints would reject, the exact payload shape - can be
 *   read without scrolling past markup, and can be unit-tested without a DOM.
 *
 * The contract mirrored here is the API's (see shared/src/models/event.model.ts):
 * required: organizationId, categoryId, locationId, eventName (3-180),
 * shortDescription (5-300), description (10-20000), purpose (3-300),
 * eventDate (YYYY-MM-DD), startTime/endTime (HH:MM);
 * optional: dateStart/dateEnd, goalAmount, isFree, capacity (null = no limit),
 * status, imageUrl, ticketTypes[].
 * Server-side cross-checks repeated here: dateEnd >= dateStart, endTime > startTime.
 */
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';

import { EVENT_IMAGES, PUBLISH_STATUSES } from '@charity/shared/config/app-config';
import type { EventDetail, EventInput, TicketType, TicketTypeInput } from '@charity/shared/models/event.model';

/** The default publishing status, and the one the database column declares. */
const DEFAULT_STATUS = PUBLISH_STATUSES[0];

/**
 * Is this value "not filled in"?
 *
 * A date input answers '', a cleared number input answers null, and a missing
 * JSON property is undefined - and the API treats all three the same way. One
 * helper keeps that decision in one place instead of scattering
 * `v === null || v === undefined || v === ''` through every comparison.
 */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/** Text of an optional API field as a form value. */
function text(value: string | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * MySQL returns "18:30:00"; an <input type="time"> only accepts "18:30".
 * Without this the edit form opens with an empty start time even though the
 * database holds one.
 */
function shortTime(value: string | null | undefined): string {
  const raw = text(value);
  return /^\d{1,2}:\d{2}/.test(raw) ? raw.slice(0, 5) : raw;
}

/** An optional numeric column as a form value (null, never NaN). */
function optionalNumber(value: number | null | undefined): number | null {
  if (isBlank(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/* ==========================================================================
   Ticket tiers
   ========================================================================== */

/** The value of one ticket-tier row. */
export interface TicketTierValue {
  ticketName: string;
  price: number | null;
  quantityAvailable: number | null;
  description: string;
}

export type TicketTierGroup = FormGroup<{
  ticketName: FormControl<string>;
  price: FormControl<number | null>;
  quantityAvailable: FormControl<number | null>;
  description: FormControl<string>;
}>;

/**
 * Validate one tier, on the row rather than field by field.
 *
 * A tier is all-or-nothing: a row the administrator has not touched at all is
 * ignored (the payload builder drops it), but the moment a name is typed the
 * rest of the row has to be coherent. Validating the ROW is what lets the price
 * rule know the row is in use, which a per-control validator could not.
 */
const ticketTierValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const row = control.value as TicketTierValue;
  const name = text(row.ticketName).trim();
  const description = text(row.description).trim();

  // An untouched, completely empty row is not an error - it is simply not a tier.
  if (name === '' && isBlank(row.price) && isBlank(row.quantityAvailable) && description === '') {
    return null;
  }

  const errors: Record<string, true> = {};
  if (name === '') errors['nameRequired'] = true;
  else if (name.length < 2) errors['nameTooShort'] = true;
  if (!isBlank(row.price) && (Number.isNaN(Number(row.price)) || Number(row.price) < 0)) {
    errors['priceInvalid'] = true;
  }
  if (!isBlank(row.quantityAvailable)) {
    const quantity = Number(row.quantityAvailable);
    if (!Number.isInteger(quantity) || quantity < 0) errors['quantityInvalid'] = true;
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

/** One ticket-tier row, optionally pre-filled from an event being edited. */
export function createTicketTier(initial?: TicketType | null): TicketTierGroup {
  return new FormGroup(
    {
      ticketName: new FormControl(text(initial?.ticketName), {
        nonNullable: true,
        validators: [Validators.maxLength(100)],
      }),
      price: new FormControl<number | null>(optionalNumber(initial?.price), {
        validators: [Validators.min(0)],
      }),
      quantityAvailable: new FormControl<number | null>(optionalNumber(initial?.quantityAvailable), {
        validators: [Validators.min(0), integerValidator],
      }),
      description: new FormControl(text(initial?.description), { nonNullable: true }),
    },
    { validators: ticketTierValidator }
  );
}

/* ==========================================================================
   Validators the API and the database also enforce
   ========================================================================== */

/** Whole numbers only (capacity and ticket quantities are INT columns). */
const integerValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  if (isBlank(control.value)) return null;
  const number = Number(control.value);
  return Number.isFinite(number) && Number.isInteger(number) ? null : { integer: true };
};

/**
 * The two window rules, attached to the GROUP rather than to a control.
 *
 * `dateEnd >= dateStart` and `endTime > startTime` are relations between two
 * controls, so they cannot be decided by either one alone. Putting them on the
 * group also gives them one honest meaning: the form as a whole is invalid, which
 * is exactly what blocks the Save button. The template renders each message
 * beside the field that has to change by asking `form.hasError('dateOrder')`,
 * which keeps the message where the person is looking without a validator that
 * reaches into its siblings.
 */
const eventWindowValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value as {
    eventDate: string;
    dateStart: string;
    dateEnd: string;
    startTime: string;
    endTime: string;
  };

  const errors: Record<string, true> = {};

  // A single-day event leaves both boxes empty; the API then derives the window
  // from eventDate, so the same derivation is used here.
  const startDate = text(value.dateStart) || text(value.eventDate);
  const endDate = text(value.dateEnd) || text(value.eventDate);
  if (startDate !== '' && endDate !== '' && endDate < startDate) errors['dateOrder'] = true;

  const startTime = text(value.startTime);
  const endTime = text(value.endTime);
  if (startTime !== '' && endTime !== '' && endTime <= startTime) errors['timeOrder'] = true;

  return Object.keys(errors).length > 0 ? errors : null;
};

/* ==========================================================================
   The event form
   ========================================================================== */

/**
 * Build the whole event form.
 *
 * @param initial the event being updated, or null/undefined for a new one. The
 *        same function serves both pages, so "add" is simply the edit form with
 *        nothing in it - the archived admin site made the same choice.
 */
export function createEventForm(initial?: EventDetail | null) {
  return new FormGroup(
    {
      eventName: new FormControl(text(initial?.eventName), {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(3), Validators.maxLength(180)],
      }),
      // Nullable, because "nothing chosen yet" is a real state and 0 is not a
      // valid foreign key. Validators.required rejects null and '' alike.
      organizationId: new FormControl<number | null>(optionalNumber(initial?.organizationId), {
        validators: [Validators.required],
      }),
      categoryId: new FormControl<number | null>(optionalNumber(initial?.categoryId), {
        validators: [Validators.required],
      }),
      locationId: new FormControl<number | null>(optionalNumber(initial?.locationId), {
        validators: [Validators.required],
      }),
      shortDescription: new FormControl(text(initial?.shortDescription), {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(5), Validators.maxLength(300)],
      }),
      description: new FormControl(text(initial?.description), {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(10), Validators.maxLength(20000)],
      }),
      purpose: new FormControl(text(initial?.purpose), {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(3), Validators.maxLength(300)],
      }),
      eventDate: new FormControl(text(initial?.eventDate).slice(0, 10), {
        nonNullable: true,
        validators: [Validators.required],
      }),
      // The multi-day window is optional in both directions.
      dateStart: new FormControl(text(initial?.dateStart).slice(0, 10), { nonNullable: true }),
      dateEnd: new FormControl(text(initial?.dateEnd).slice(0, 10), { nonNullable: true }),
      startTime: new FormControl(shortTime(initial?.startTime), {
        nonNullable: true,
        validators: [Validators.required],
      }),
      endTime: new FormControl(shortTime(initial?.endTime), {
        nonNullable: true,
        validators: [Validators.required],
      }),
      // An empty box means "no target" (0) for the goal, and "no limit"
      // (null) for the capacity - two different meanings, which is why the
      // payload builder treats them differently.
      goalAmount: new FormControl<number | null>(optionalNumber(initial?.goalAmount), {
        validators: [Validators.min(0)],
      }),
      capacity: new FormControl<number | null>(optionalNumber(initial?.capacity), {
        validators: [Validators.min(1), integerValidator],
      }),
      status: new FormControl(text(initial?.status) || DEFAULT_STATUS, {
        nonNullable: true,
        validators: [Validators.required],
      }),
      imageUrl: new FormControl(text(initial?.imageUrl) || EVENT_IMAGES[0], { nonNullable: true }),
      isFree: new FormControl(initial?.isFree === true, { nonNullable: true }),
      ticketTypes: new FormArray<TicketTierGroup>(
        (initial?.ticketTypes ?? []).map((tier) => createTicketTier(tier))
      ),
    },
    { validators: eventWindowValidator }
  );
}

/** The form as a whole, so a function's signature can name it. */
export type EventFormGroup = ReturnType<typeof createEventForm>;

/**
 * The form's value. Typed from the form rather than written out by hand, so it
 * cannot drift away from the controls above - which is the whole reason the form
 * is described in one place.
 */
export type EventFormValue = EventFormGroup['value'];

/** Put the form back to the values it was built with ("Clear the form"). */
export function resetEventForm(form: EventFormGroup, initial?: EventDetail | null): void {
  const fresh = createEventForm(initial);

  for (const name of Object.keys(fresh.controls)) {
    if (name === 'ticketTypes') continue;
    form.get(name)?.reset(fresh.get(name)?.value);
  }

  // The tier rows are controls, not values, so they are replaced rather than
  // reset - a fresh row also starts untouched, with no stale error message.
  const tiers = form.controls.ticketTypes;
  tiers.clear();
  for (const tier of fresh.controls.ticketTypes.controls) tiers.push(tier);
}

/* ==========================================================================
   The payload
   ========================================================================== */

/** The tier rows that are actually filled in, in the API's shape. */
function ticketTierInputs(tiers: FormArray<TicketTierGroup>): TicketTypeInput[] {
  const payload: TicketTypeInput[] = [];

  for (const group of tiers.controls) {
    const row = group.getRawValue();
    const name = text(row.ticketName).trim();
    const description = text(row.description).trim();

    // A half-filled row is dropped rather than sent, exactly as the legacy form
    // did: a tier with no name is not a tier, and the API would reject it.
    if (name === '' && isBlank(row.price) && isBlank(row.quantityAvailable) && description === '') {
      continue;
    }

    payload.push({
      ticketName: name,
      price: isBlank(row.price) ? 0 : Number(row.price),
      quantityAvailable: isBlank(row.quantityAvailable) ? null : Number(row.quantityAvailable),
      description: description === '' ? null : description,
    });
  }

  return payload;
}

/**
 * Read the complete body of POST /api/events (or of a full PUT) out of the form.
 *
 * The two "empty is meaningful" cases are handled explicitly: an empty goal box
 * is sent as 0 ("no target") and an empty capacity box as null ("no limit").
 * Omitting them would make the API apply its own default and quietly disagree
 * with what the administrator sees on screen.
 */
export function toEventInput(form: EventFormGroup): EventInput {
  const value = form.getRawValue();

  const input: EventInput = {
    organizationId: Number(value.organizationId),
    categoryId: Number(value.categoryId),
    locationId: Number(value.locationId),
    eventName: value.eventName.trim(),
    shortDescription: value.shortDescription.trim(),
    description: value.description.trim(),
    purpose: value.purpose.trim(),
    eventDate: value.eventDate,
    startTime: value.startTime,
    endTime: value.endTime,
    goalAmount: isBlank(value.goalAmount) ? 0 : Number(value.goalAmount),
    isFree: value.isFree,
    capacity: isBlank(value.capacity) ? null : Number(value.capacity),
    status: value.status,
    imageUrl: value.imageUrl,
    ticketTypes: ticketTierInputs(form.controls.ticketTypes),
  };

  // Only sent when the administrator filled them in, so the API keeps deriving
  // both from eventDate for a single-day event.
  if (!isBlank(value.dateStart)) input.dateStart = value.dateStart;
  if (!isBlank(value.dateEnd)) input.dateEnd = value.dateEnd;

  return input;
}

/* ==========================================================================
   "What actually changed?"
   ========================================================================== */

/**
 * Compare two values as the database would.
 *
 * Both sides need normalising, because the form and MySQL disagree about how to
 * write the same instant:
 *   date   "2026-10-24"        vs "2026-10-24"   (equal)
 *   time   "18:30"             vs "18:30:00"     (equal, but not as text)
 *   money  "8000"              vs 8000           (equal, but not as text)
 *   empty  ""                  vs null           (equal: both mean "not set")
 *
 * Without the time rule every save looked like a change, so the "nothing
 * changed" guard never fired and a PUT was sent on every click.
 */
function normalise(value: unknown): string | number | null {
  if (isBlank(value)) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;

  const asText = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(asText)) return asText.slice(0, 10); // ISO timestamp
  if (/^\d{4}-\d{2}-\d{2}/.test(asText)) return asText.slice(0, 10); // date (+ optional time)
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(asText)) return asText.slice(0, 5); // HH:MM[:SS]

  return asText;
}

/** True when the two values mean the same thing to the database. */
function isSameValue(left: unknown, right: unknown): boolean {
  const a = normalise(left);
  const b = normalise(right);

  if (a === null || b === null) return a === b;
  if (typeof a === 'number' || typeof b === 'number') {
    const numbers = [Number(a), Number(b)];
    return numbers.every(Number.isFinite) ? numbers[0] === numbers[1] : String(a) === String(b);
  }

  return a === b;
}

/**
 * Keep only the fields that actually changed.
 *
 * PUT /api/events/:id is a PARTIAL update and answers 400 to an empty body, and
 * sending every field would overwrite a concurrent edit to a column this person
 * never touched. Both are reasons to send the difference rather than the form.
 *
 * Ticket tiers are included only when the event has none yet: the API adds tiers
 * to an event that has no tiers and ignores them otherwise (the update form says
 * so in words), so claiming a tier change was saved would be a lie.
 */
export function changedFields(next: EventInput, original: EventDetail | null): Partial<EventInput> {
  const changes: Record<string, unknown> = {};
  const before = original as unknown as Record<string, unknown> | null;

  for (const [key, value] of Object.entries(next)) {
    if (key === 'ticketTypes') continue;
    if (!isSameValue(value, before ? before[key] : undefined)) changes[key] = value;
  }

  const existingTiers = original?.ticketTypes?.length ?? 0;
  if (existingTiers === 0 && next.ticketTypes && next.ticketTypes.length > 0) {
    changes['ticketTypes'] = next.ticketTypes;
  }

  // Every value in `changes` came out of `next`, so the shape is already right;
  // the cast only re-narrows the Record the loop needed in order to iterate.
  return changes as Partial<EventInput>;
}

/* ==========================================================================
   Labels
   ========================================================================== */

/**
 * The translation key naming each field.
 *
 * Used in two places: the generic validation messages ("{field} is required")
 * and the API's per-field 400 details, which name the column rather than the
 * label. One map means the two cannot disagree about what a field is called.
 */
export const FIELD_LABEL_KEYS: Readonly<Record<string, string>> = {
  eventName: 'field.eventName',
  organizationId: 'field.organizationId',
  categoryId: 'field.categoryId',
  locationId: 'field.locationId',
  shortDescription: 'field.shortDescription',
  description: 'field.description',
  purpose: 'field.purpose',
  eventDate: 'field.eventDate',
  dateStart: 'field.dateStart',
  dateEnd: 'field.dateEnd',
  startTime: 'field.startTime',
  endTime: 'field.endTime',
  goalAmount: 'field.goalAmount',
  capacity: 'field.capacity',
  status: 'field.status',
  imageUrl: 'field.imageUrl',
  isFree: 'field.isFree',
  ticketTypes: 'form.sectionTickets',
  ticketName: 'field.ticketName',
  price: 'field.ticketPrice',
  quantityAvailable: 'field.ticketQuantity',
};

/**
 * The message for a required field, when the dictionary has a sentence that
 * says more than "{field} is required" ("Choose a category.", "Say what the
 * money funds."). Those keys already existed for the archived admin site, and
 * using them keeps the wording staff are used to.
 */
export const REQUIRED_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  organizationId: 'validation.chooseOrganisation',
  categoryId: 'validation.chooseCategory',
  locationId: 'validation.chooseVenue',
  shortDescription: 'validation.shortDescriptionRequired',
  description: 'validation.descriptionRequired',
  purpose: 'validation.purposeRequired',
  eventDate: 'validation.eventDateRequired',
  startTime: 'validation.startTimeRequired',
  endTime: 'validation.endTimeRequired',
};
