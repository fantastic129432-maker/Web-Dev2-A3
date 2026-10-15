/**
 * The event form as DATA: its controls, its validation rules, the payload it
 * produces and the "what actually changed?" comparison.
 *
 * @file The single definition of the admin event form.
 *
 * The contract mirrored here is the API's (see shared/src/models/event.model.ts):
 * required: organizationId, categoryId, locationId, eventName (3-180),
 * shortDescription (5-300), description (10-20000), purpose (3-300),
 * eventDate (YYYY-MM-DD), startTime/endTime (HH:MM);
 * optional: dateStart/dateEnd, goalAmount, isFree, capacity (null = no limit),
 * status, imageUrl, ticketTypes[].
 * Server-side cross-checks repeated here: dateEnd >= dateStart, endTime > startTime.
 *
 * WHICH DATE THE FORM ASKS FOR
 *   The API wants eventDate AND may want a dateStart/dateEnd window
 *   (validateEventBody derives a missing dateStart/dateEnd from eventDate, and
 *   writes both, so event_date, date_start and date_end are all stored). The form
 *   therefore asks for the EVENT DATE once, as "Start date" plus an optional "End
 *   date", and DERIVES eventDate from the start date when it builds the payload -
 *   see toEventInput(). A single-day event sends one date, a multi-day event sends
 *   the window, and neither can contradict the other. There is deliberately no
 *   second, independent "event date" box: it used to exist, and asking for the same
 *   fact twice is what the review objected to.
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
  /** The tier's name, as it appears on the public pages. */
  ticketName: string;
  /** The price per ticket, or null while the box is empty. */
  price: number | null;
  /** How many of this tier exist, or null for "no allocation published". */
  quantityAvailable: number | null;
  /** The optional line of extra detail shown beside the tier name. */
  description: string;
  /** The price to put back when "This is a free event" is cleared. */
  priceBeforeFree: number | null;
}

/**
 * One ticket-tier row as a reactive form group.
 *
 * Named here so a function signature can say "a group of tier controls" without
 * repeating the five-control shape, which is the only place that shape is written.
 */
export type TicketTierGroup = FormGroup<{
  ticketName: FormControl<string>;
  price: FormControl<number | null>;
  quantityAvailable: FormControl<number | null>;
  description: FormControl<string>;
  priceBeforeFree: FormControl<number | null>;
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

/**
 * One ticket-tier row, optionally pre-filled from an event being edited.
 *
 * `priceBeforeFree` is FORM-ONLY state and never reaches the API: it remembers the
 * price a row had before "This is a free event" forced it to zero, so clearing that
 * box puts the row back to something usable instead of leaving a price of 0 behind.
 * toEventInput() builds each tier from its named fields rather than spreading the
 * row, which is what keeps this helper out of the request body.
 *
 * @param initial - The stored tier to fill the row from, or null/undefined for a
 *   blank row.
 * @returns The new row's form group, validated as a whole by `ticketTierValidator`.
 */
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
      priceBeforeFree: new FormControl<number | null>(null),
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
 *
 * The date rule compares the two boxes the administrator can actually see. There
 * used to be a third, independent "event date" box that the rule fell back to;
 * that box is gone, and both dates now have exactly one source, so a comparison
 * here cannot disagree with what the form shows.
 */
const eventWindowValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = control.value as {
    dateStart: string;
    dateEnd: string;
    startTime: string;
    endTime: string;
  };

  const errors: Record<string, true> = {};

  // Only a filled end date can be out of order: an empty one means the event runs
  // for a single day, and the payload derives it from the start date.
  const startDate = text(value.dateStart);
  const endDate = text(value.dateEnd);
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
 * Does a stored event run for a single day?
 *
 * The database stores the window as well as the event date, and the two are equal
 * for an event that lasts one day (write.repository's toRow keeps them in step).
 * An event with no window at all is also single-day, because the API derives
 * date_start and date_end from event_date. Reading it from the STORED dates rather
 * than from a flag is what makes the "single-day event" box correct the moment a
 * multi-day event is opened for editing: the box reads off, and Save cannot
 * collapse the event to one day while the box stays untouched.
 *
 * @param initial - The event being edited, or null/undefined for a new one.
 * @returns `true` when the first and last days are the same (or there is no window), which is the state a new event starts in.
 */
function isStoredSingleDay(initial?: EventDetail | null): boolean {
  // A brand-new event opens as a single-day one: it is the common case, and it is
  // what the removed "event date" box used to say before the administrator said
  // anything else.
  if (!initial) return true;

  const firstDay = text(initial.dateStart || initial.eventDate).slice(0, 10);
  const lastDay = text(initial.dateEnd || initial.eventDate).slice(0, 10);

  return firstDay === lastDay;
}

/**
 * Build the whole event form.
 *
 * The same function serves both pages, so "add" is simply the edit form with
 * nothing in it - the archived admin site made the same choice.
 *
 * @param initial - The event being updated, or null/undefined for a new one.
 * @returns The empty or pre-filled form group, with the cross-field window rule
 *   attached to the group itself.
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
      // The event date is no longer asked for separately: the form asks for the
      // START date below and derives this control from it, keeping it only because
      // eventDate is a required field of the API's write contract. It stays
      // non-required here so the one visible date field carries the asterisk and
      // the one message - see toEventInput().
      eventDate: new FormControl(text(initial?.eventDate).slice(0, 10), { nonNullable: true }),
      // The two visible dates. `dateStart` is required - it IS the event date - and
      // a blank `dateEnd` means a single-day event, whose end is derived from the
      // start. `dateStart` falls back to a stored event_date so an event that predates
      // this shape still opens with its date filled in.
      dateStart: new FormControl(
        text(initial?.dateStart).slice(0, 10) || text(initial?.eventDate).slice(0, 10),
        { nonNullable: true, validators: [Validators.required] }
      ),
      dateEnd: new FormControl(text(initial?.dateEnd).slice(0, 10), { nonNullable: true }),
      // A single-day event is the DEFAULT for a new event (the common case) and is
      // read OFF when the stored first and last days differ, so opening a multi-day
      // event can never quietly collapse it into one day.
      singleDay: new FormControl(isStoredSingleDay(initial), { nonNullable: true }),
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

/**
 * Put the form back to the values it was built with ("Clear the form").
 *
 * The tier rows are replaced rather than reset, because they are controls and not
 * values: a fresh row also starts untouched, with no stale error message.
 *
 * @param form - The form group to reset in place.
 * @param initial - The event to reset to, or null/undefined to reset to a blank
 *   form.
 */
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

/**
 * Is this tier row actually being used?
 *
 * A row the administrator has not touched at all is not a tier: `ticketTierInputs`
 * drops it and `ticketTierValidator` ignores it. The free-event lock needs the same
 * test, because writing a price of 0 into an untouched row would turn it into a
 * half-filled one - a price with no name - which the API refuses with a 400 naming
 * a tier the administrator never created.
 *
 * @param row - One row's value.
 * @returns `true` when any field of the row holds something.
 */
export function isRowInUse(row: TicketTierValue): boolean {
  return (
    text(row.ticketName).trim() !== '' ||
    !isBlank(row.price) ||
    !isBlank(row.quantityAvailable) ||
    text(row.description).trim() !== ''
  );
}

/**
 * The tier rows that are actually filled in, in the API's shape.
 *
 * Each row is read field by field rather than spread, so the form-only
 * `priceBeforeFree` helper can never ride along into the request body.
 *
 * @param tiers - The repeating form array of tier rows.
 * @param isFree - Whether "This is a free event" is ticked, in which case every
 *   price is sent as 0.
 * @returns The tiers to send, with the unused rows dropped.
 */
function ticketTierInputs(tiers: FormArray<TicketTierGroup>, isFree: boolean): TicketTypeInput[] {
  const payload: TicketTypeInput[] = [];

  for (const group of tiers.controls) {
    const row = group.getRawValue();
    const name = text(row.ticketName).trim();
    const description = text(row.description).trim();

    // An untouched row is not a tier, exactly as the legacy form decided: a tier
    // with no name is not a tier, and the API would reject it. The same test is
    // what keeps the free-event lock from waking a blank row up.
    if (!isRowInUse(row)) continue;

    payload.push({
      ticketName: name,
      // A free event has no priced tiers, so the price is forced to 0 here as well
      // as in the disabled input: a stale value that the control still held could
      // otherwise be submitted, which is exactly the trap the disabled field would
      // create. 0 is inside the API's own range for a price (min 0).
      price: isFree || isBlank(row.price) ? 0 : Number(row.price),
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
 *
 * THE DATES
 *   The API requires `eventDate` and derives a missing `dateStart`/`dateEnd` from
 *   it (validateEventBody: `values.dateStart = dateStart || eventDate`). The form
 *   asks for the event's first and last day only, so `eventDate` is DERIVED from
 *   `dateStart` here and the window is sent alongside it:
 *
 *     single-day (the box is ticked)  eventDate = dateStart, and the window is
 *                                     omitted, which is exactly the shape the API
 *                                     documents for a one-day event;
 *     multi-day  (the box is clear)   eventDate = dateStart, dateStart and dateEnd
 *                                     both sent, so the stored window cannot drift
 *                                     from the payload that produced it.
 *
 * @param form - The complete form group to read.
 * @returns The request body for POST /api/events or a full PUT, with an empty
 *   goal sent as 0, an empty capacity sent as null, the event date derived from
 *   the start date and the end date omitted for a single-day event.
 */
export function toEventInput(form: EventFormGroup): EventInput {
  const value = form.getRawValue();

  // One date, stated once: every date field in the payload comes from the start
  // date, which is the only date box the form still shows.
  const startDate = value.dateStart;

  // The window is sent only for a multi-day event. A single day omits it, and the
  // API then derives date_start and date_end from the event date it was given -
  // the shape validateEventBody documents. An end date a stored event loaded stays
  // on the form but is deliberately not what makes the event multi-day, so opening
  // a three-day event, ticking the switch and saving collapses it (singleDayDates
  // below makes sure that shows up as a change) while opening it and changing
  // nothing else does not.
  const multiDay = !value.singleDay && value.dateEnd !== '';

  const input: EventInput = {
    organizationId: Number(value.organizationId),
    categoryId: Number(value.categoryId),
    locationId: Number(value.locationId),
    eventName: value.eventName.trim(),
    shortDescription: value.shortDescription.trim(),
    description: value.description.trim(),
    purpose: value.purpose.trim(),
    eventDate: startDate,
    startTime: value.startTime,
    endTime: value.endTime,
    goalAmount: isBlank(value.goalAmount) ? 0 : Number(value.goalAmount),
    isFree: value.isFree,
    capacity: isBlank(value.capacity) ? null : Number(value.capacity),
    status: value.status,
    imageUrl: value.imageUrl,
    ticketTypes: ticketTierInputs(form.controls.ticketTypes, value.isFree),
  };

  // Both ends are sent for a multi-day event, whichever of them was moved.
  if (multiDay) {
    input.dateStart = startDate;
    input.dateEnd = value.dateEnd;
  }

  return input;
}

/**
 * The pair of dates the API will hold once a payload has been saved.
 *
 * This exists so "what changed?" can compare like with like. With the window
 * omitted the API derives date_start and date_end from the event date; with the
 * window present it stores what it was given. Comparing the FORM's end date
 * instead would miss the one change that matters: ticking "single-day event" on a
 * stored three-day event omits the window, so the row's end date becomes
 * event_date - which `storedDates` reports here, and which the old comparison
 * could not see.
 *
 * The event date itself is not compared. Three seeded events store an `event_date`
 * that is not their first day (event 3 is event_date 2026-11-07, date_start
 * 2026-11-05, date_end 2026-11-07), and the derived event date is always the start
 * date, so comparing it would report a change that is not one - a PUT whose only
 * field was the date, which the API answered by collapsing the three days into
 * one. Only the two days the administrator can see are compared.
 *
 * @param next - The payload built by toEventInput.
 * @returns The first and last day the API will hold.
 */
function storedDates(next: EventInput): { start: string; end: string } {
  return {
    start: text(next.dateStart || next.eventDate),
    end: text(next.dateEnd === undefined ? next.eventDate : next.dateEnd),
  };
}

/**
 * The pair of dates a stored event reports, for the same comparison.
 *
 * An event with no window at all is a single day, and the API derives both ends
 * from its event date - the same rule `storedDates` applies to a payload.
 *
 * @param original - The event as the API returned it, or null.
 * @returns The first and last day, or null when there is nothing to compare.
 */
function originalDates(original: EventDetail | null): { start: string; end: string } | null {
  if (!original) return null;
  const before = original as unknown as Record<string, unknown>;

  return {
    start: text((before['dateStart'] as string) || (before['eventDate'] as string)),
    end: text((before['dateEnd'] as string) || (before['eventDate'] as string)),
  };
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
 * THE DATES ARE COMPARED AS THE TWO DAYS THE ADMINISTRATOR SEES
 *   `eventDate` is derived from `dateStart` (see toEventInput), and the API derives
 *   date_start and date_end from event_date when the window is omitted - as it is
 *   for a single-day event. So the date fields are removed from the loop below and
 *   decided as one pair, from `storedDates` against `originalDates`. Comparing the
 *   raw fields instead broke in both directions: a stored event whose event_date is
 *   not its first day looked as if the date had changed, and a PUT carrying only
 *   that date made the API collapse a three-day window into one; and ticking
 *   "single-day event" on a stored three-day event looked like no change at all,
 *   so the window could never be collapsed deliberately.
 *
 * Ticket tiers are included only when the event has none yet: the API adds tiers
 * to an event that has no tiers and ignores them otherwise (the update form says
 * so in words), so claiming a tier change was saved would be a lie.
 *
 * @param next - The full payload built from the form.
 * @param original - The event as the API returned it, or null when there is no
 *   stored event to compare against.
 * @returns Only the fields that differ, ready to PUT; an empty object when
 *   nothing changed.
 */
export function changedFields(next: EventInput, original: EventDetail | null): Partial<EventInput> {
  const changes: Record<string, unknown> = {};
  const before = original as unknown as Record<string, unknown> | null;

  for (const [key, value] of Object.entries(next)) {
    if (key === 'ticketTypes' || key === 'eventDate' || key === 'dateStart' || key === 'dateEnd') {
      continue;
    }
    if (!isSameValue(value, before ? before[key] : undefined)) changes[key] = value;
  }

  const was = originalDates(original);
  if (was) {
    const now = storedDates(next);
    // Both ends are sent together, because the API derives them from the event
    // date whenever only one of them would be sent.
    if (now.start !== was.start || now.end !== was.end) {
      changes['eventDate'] = next.eventDate;
      changes['dateStart'] = now.start;
      changes['dateEnd'] = now.end;
    }
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
 *
 * `eventDate` stays in the map even though the form no longer paints that control:
 * the API names the column `eventDate` in its own 400 details and names the hidden
 * control too, so both lookups still need a label.
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
 *
 * `dateStart` is the field that carries the required marker now, so its message
 * names the event date in words ("The event date is required.") rather than
 * saying "Start date is required", which would describe a box the form no longer
 * asks for on its own.
 */
export const REQUIRED_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  organizationId: 'validation.chooseOrganisation',
  categoryId: 'validation.chooseCategory',
  locationId: 'validation.chooseVenue',
  shortDescription: 'validation.shortDescriptionRequired',
  description: 'validation.descriptionRequired',
  purpose: 'validation.purposeRequired',
  dateStart: 'validation.eventDateRequired',
  startTime: 'validation.startTimeRequired',
  endTime: 'validation.endTimeRequired',
};
