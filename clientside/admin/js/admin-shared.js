/**
 * admin/js/admin-shared.js
 * ---------------------------------------------------------------------------
 * The small amount of state the admin pages share: how an event is turned into
 * the plain object the API expects, and the pieces of an event form that both
 * the "add" and the "update" page need.
 *
 * Kept apart from event-editor.js so the shared rules (which fields exist, what
 * "changed" means) can be read without scrolling past the DOM building.
 */
import { fieldValue, fieldChecked } from './admin.js';
import { t } from './admin-i18n.js';

/**
 * The event fields the admin form manages, in the order they appear.
 *
 * `type` decides how the value is read from the form and what the API receives:
 *   text | number | date | time | boolean | select
 *
 * This list is the single description of an event form. The form is BUILT from
 * it and the payload is READ with it, so a field can never appear on screen but
 * be forgotten when the data is sent - which is the classic way an admin screen
 * silently drops a column.
 */
export const EVENT_FIELDS = [
  { name: 'eventName', type: 'text', required: true, column: 'eventName' },
  { name: 'organizationId', type: 'select', required: true, column: 'organizationId' },
  { name: 'categoryId', type: 'select', required: true, column: 'categoryId' },
  { name: 'locationId', type: 'select', required: true, column: 'locationId' },
  { name: 'shortDescription', type: 'text', required: true, column: 'shortDescription' },
  { name: 'description', type: 'textarea', required: true, column: 'description' },
  { name: 'purpose', type: 'text', required: true, column: 'purpose' },
  { name: 'eventDate', type: 'date', required: true, column: 'eventDate' },
  { name: 'dateStart', type: 'date', required: false, column: 'dateStart' },
  { name: 'dateEnd', type: 'date', required: false, column: 'dateEnd' },
  { name: 'startTime', type: 'time', required: true, column: 'startTime' },
  { name: 'endTime', type: 'time', required: true, column: 'endTime' },
  { name: 'goalAmount', type: 'number', required: false, column: 'goalAmount' },
  { name: 'capacity', type: 'number', required: false, column: 'capacity' },
  { name: 'isFree', type: 'boolean', required: false, column: 'isFree' },
  { name: 'status', type: 'select', required: false, column: 'status' },
  { name: 'imageUrl', type: 'select', required: false, column: 'imageUrl' },
];

/**
 * Read one complete payload out of a form element.
 *
 * @param {HTMLFormElement} form
 * @returns {object} the body to POST or PUT
 */
export function readEventForm(form) {
  const values = {};

  values.eventName = fieldValue(form, 'eventName');
  values.organizationId = Number(fieldValue(form, 'organizationId')) || undefined;
  values.categoryId = Number(fieldValue(form, 'categoryId')) || undefined;
  values.locationId = Number(fieldValue(form, 'locationId')) || undefined;
  values.shortDescription = fieldValue(form, 'shortDescription');
  values.description = fieldValue(form, 'description');
  values.purpose = fieldValue(form, 'purpose');
  values.eventDate = fieldValue(form, 'eventDate');
  values.startTime = fieldValue(form, 'startTime');
  values.endTime = fieldValue(form, 'endTime');
  values.isFree = fieldChecked(form, 'isFree');
  values.status = fieldValue(form, 'status') || 'active';

  // The multi-day window is optional: when both boxes are empty the API derives
  // both from eventDate, so a single-day event only needs one date typed.
  const dateStart = fieldValue(form, 'dateStart');
  const dateEnd = fieldValue(form, 'dateEnd');
  if (dateStart) values.dateStart = dateStart;
  if (dateEnd) values.dateEnd = dateEnd;

  // An empty money or capacity box is meaningful, so it is sent as a value
  // rather than dropped: goal 0 for "no target", capacity null for "no limit".
  const goal = fieldValue(form, 'goalAmount');
  values.goalAmount = goal === '' ? 0 : Number(goal);

  const capacity = fieldValue(form, 'capacity');
  values.capacity = capacity === '' ? null : Number(capacity);

  const image = fieldValue(form, 'imageUrl');
  if (image) values.imageUrl = image;

  // Ticket tiers are read from their own repeating block.
  const tickets = readTicketTypes(form);
  if (tickets.length > 0) values.ticketTypes = tickets;

  return values;
}

/** Read every row of the repeating ticket-tier block. */
export function readTicketTypes(form) {
  const rows = Array.from(form.querySelectorAll('[data-ticket-row]'));

  return rows
    .map((row) => {
      const name = row.querySelector('[data-ticket-name]').value.trim();
      const price = row.querySelector('[data-ticket-price]').value;
      const quantity = row.querySelector('[data-ticket-quantity]').value;

      // A half-filled row is ignored rather than sent: the brief asks for
      // validation before submission, and a tier with no name is not a tier.
      if (name === '') return null;

      return {
        ticketName: name,
        price: price === '' ? 0 : Number(price),
        quantityAvailable: quantity === '' ? null : Number(quantity),
      };
    })
    .filter(Boolean);
}

/**
 * Keep only the fields that actually changed.
 *
 * The brief says a "Save" button must call the update endpoint. Sending only
 * the changed fields means a concurrent edit to a different column is not
 * silently overwritten, and it is what the PUT endpoint was designed for.
 *
 * @param {object} next     payload read from the form
 * @param {object} original the event as the API returned it
 * @returns {object} the changed subset
 */
export function changedFields(next, original) {
  const changes = {};

  /**
   * Compare two values as the database would.
   *
   * Both sides need normalising, because the form and MySQL disagree about how
   * to write the same instant:
   *   date  "2026-10-24"          vs  "2026-10-24"      (equal)
   *   time  "18:30"               vs  "18:30:00"        (equal, but not as text)
   *   money "8000"                vs  8000              (equal, but not as text)
   *   empty ""                    vs  null              (equal: both mean "not set")
   *
   * Without the time rule every save looked like a change, so the
   * "nothing changed" guard never fired and a PUT was sent on every click.
   */
  const normalise = (value) => {
    if (value === null || value === undefined || value === '') return '';
    const text = String(value).trim();

    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.slice(0, 10);       // ISO timestamp
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);        // date + optional time
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) return text.slice(0, 5);   // HH:MM[:SS]

    return text;
  };

  for (const [key, value] of Object.entries(next)) {
    // Ticket tiers have their own endpoint behaviour, so they are compared
    // separately rather than field by field here.
    if (key === 'ticketTypes') continue;

    const before = original[key];

    // Numeric or empty on either side: compare as numbers so "8000" and 8000,
    // and "" and null, are recognised as the same value.
    const numericPair =
      typeof value === 'number' ||
      typeof before === 'number' ||
      value === null ||
      before === null ||
      value === '';

    if (numericPair) {
      const left = value === null || value === undefined || value === '' ? null : Number(value);
      const right =
        before === null || before === undefined || before === '' ? null : Number(before);

      if (Number.isFinite(left) && Number.isFinite(right)) {
        if (left !== right) changes[key] = value;
        continue;
      }
    }

    if (normalise(value) !== normalise(before)) changes[key] = value;
  }

  return changes;
}

/**
 * Client-side validation, run before anything is sent.
 *
 * The API validates the same rules and answers with the same kind of per-field
 * list, so this is not the only guard - it simply saves a round trip and puts
 * the message next to the field the moment the person can act on it.
 *
 * @returns {Array<{field:string, message:string}>} empty when the form is valid
 */
export function validateEventForm(form) {
  const problems = [];
  const require = (name, message) => {
    if (fieldValue(form, name) === '') problems.push({ field: name, message });
  };

  /*
   * Messages go through t() so the form speaks the same language as the rest of
   * the interface. The field NAME comes from the existing field.* keys, so a
   * message is assembled rather than duplicated per field - one
   * "X is required" pattern covers every required field.
   */
  const field = (name) => t(`field.${name}`);

  require('eventName', t('validation.required', { field: field('eventName') }));
  require('organizationId', t('validation.chooseOrganisation'));
  require('categoryId', t('validation.chooseCategory'));
  require('locationId', t('validation.chooseVenue'));
  require('shortDescription', t('validation.shortDescriptionRequired'));
  require('description', t('validation.descriptionRequired'));
  require('purpose', t('validation.purposeRequired'));
  require('eventDate', t('validation.eventDateRequired'));
  require('startTime', t('validation.startTimeRequired'));
  require('endTime', t('validation.endTimeRequired'));

  const eventName = fieldValue(form, 'eventName');
  if (eventName !== '' && eventName.length < 3) {
    problems.push({
      field: 'eventName',
      message: t('validation.minLength', { field: field('eventName'), min: 3 }),
    });
  }

  const shortDescription = fieldValue(form, 'shortDescription');
  if (shortDescription !== '' && shortDescription.length < 5) {
    problems.push({
      field: 'shortDescription',
      message: t('validation.minLength', { field: field('shortDescription'), min: 5 }),
    });
  }

  const description = fieldValue(form, 'description');
  if (description !== '' && description.length < 10) {
    problems.push({
      field: 'description',
      message: t('validation.minLength', { field: field('description'), min: 10 }),
    });
  }

  // Date window: an end before a start would be rejected by the database CHECK
  // constraint, so it is caught here with a message that says which box to fix.
  const eventDate = fieldValue(form, 'eventDate');
  const dateStart = fieldValue(form, 'dateStart') || eventDate;
  const dateEnd = fieldValue(form, 'dateEnd') || eventDate;
  if (dateStart && dateEnd && dateEnd < dateStart) {
    problems.push({
      field: 'dateEnd',
      message: t('validation.dateOrder'),
    });
  }

  const startTime = fieldValue(form, 'startTime');
  const endTime = fieldValue(form, 'endTime');
  if (startTime && endTime && endTime <= startTime) {
    problems.push({ field: 'endTime', message: t('validation.timeOrder') });
  }

  const goal = fieldValue(form, 'goalAmount');
  if (goal !== '' && (Number.isNaN(Number(goal)) || Number(goal) < 0)) {
    problems.push({ field: 'goalAmount', message: t('validation.goalAmount') });
  }

  const capacity = fieldValue(form, 'capacity');
  if (capacity !== '') {
    const value = Number(capacity);
    if (!Number.isInteger(value) || value < 1) {
      problems.push({
        field: 'capacity',
        message: t('validation.capacity'),
      });
    }
  }

  // Ticket tiers.
  Array.from(form.querySelectorAll('[data-ticket-row]')).forEach((row, index) => {
    const name = row.querySelector('[data-ticket-name]').value.trim();
    const price = row.querySelector('[data-ticket-price]').value;
    const quantity = row.querySelector('[data-ticket-quantity]').value;

    // An entirely empty row is simply ignored.
    if (name === '' && price === '' && quantity === '') return;

    if (name === '') {
      problems.push({
        field: `ticketName-${index}`,
        message: t('validation.ticketName', { number: index + 1 }),
      });
    }
    if (price !== '' && (Number.isNaN(Number(price)) || Number(price) < 0)) {
      problems.push({
        field: `ticketPrice-${index}`,
        message: t('validation.ticketPrice', { number: index + 1 }),
      });
    }
    if (quantity !== '' && (!Number.isInteger(Number(quantity)) || Number(quantity) < 0)) {
      problems.push({
        field: `ticketQuantity-${index}`,
        message: t('validation.ticketQuantity', { number: index + 1 }),
      });
    }
  });

  return problems;
}

/** Write the problems onto the form, next to the fields they belong to. */
export function paintProblems(form, problems, summary) {
  form.querySelectorAll('.field-message').forEach((node) => {
    node.textContent = '';
    node.className = 'field-message';
  });
  form.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));

  problems.forEach((problem) => {
    const slot = form.querySelector(`#${cssEscape(problem.field)}-message`);
    if (slot) {
      slot.textContent = problem.message;
      slot.className = 'field-message field-message--error';
    }
    const control =
      form.querySelector(`#${cssEscape(problem.field)}`) ||
      form.querySelector(`[name="${problem.field}"]`);
    if (control) control.setAttribute('aria-invalid', 'true');
  });

  if (summary) {
    summary.textContent =
      problems.length === 1
        ? 'One field needs attention before this can be saved.'
        : `${problems.length} fields need attention before this can be saved.`;
    summary.className = 'field-message field-message--error';
    summary.focus?.();
  }

  const first = problems[0];
  if (first) {
    const control = form.querySelector(`#${cssEscape(first.field)}`);
    control?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }
}

/** Minimal CSS.escape, for the ids the form generates. */
function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
