/**
 * js/registration.js
 * ---------------------------------------------------------------------------
 * The Assessment 3 registration page: the new page the brief asks for, where a
 * web user registers for a selected event.
 *
 * Required behaviour from the brief, and where it happens here:
 *   * "Create a user-friendly form that collects the necessary details from the
 *      user to submit a new registration record (e.g., the user details, the
 *      date of registration, contact details, the number of tickets purchased,
 *      following your database schema)"
 *        -> buildForm() creates one field per column of event_registrations:
 *           attendee_name, attendee_email, attendee_phone, registered_at,
 *           tickets_purchased, ticket_type_id and notes.
 *   * "Display the event information about the selected charity event on this
 *      page (using your APIs) so the user is clear about the event they are
 *      registering for"
 *        -> loadEvent() calls GET /api/events/:id and buildEventSummary()
 *           renders the name, date, venue, price and the places still available.
 *   * "Implement a button that finalise the registration"
 *      - "Validates the user input. If validation fails, provide an appropriate
 *         client-side alert."
 *           -> validate() returns one message per bad field; each is written
 *              next to its field, the page is scrolled to the first problem, and
 *              the summary alert is focused so a screen reader announces it.
 *      - "Calls the necessary API endpoint created in Part 2 to insert the new
 *         registration record into the database."
 *           -> createRegistration() in api.js posts to
 *              /api/events/:id/registrations.
 *      - "Upon successful submission, display a confirmation message to the
 *         user and handle the following navigation."
 *           -> renderConfirmation() replaces the form with a confirmation card
 *              and two onward links (back to the event, or browse more events).
 *   * "You may utilise appropriate methods (e.g., URL Query Strings or Local
 *      Storage) to pass the event ID between pages"
 *        -> readEventId() reads ?id= and falls back to the same localStorage key
 *           the event page writes.
 */
import { getEventById, createRegistration, ApiError } from './api.js';
import { initLayout } from './nav.js';
import {
  el,
  select,
  imageUrl,
  stateBadge,
  formatDate,
  formatTime,
  formatPrice,
  formatCurrency,
  showError,
  setFieldMessage,
} from './dom.js';
import { LAST_EVENT_KEY, REGISTRATION_PAGE } from './config.js';
import { t, onLanguageChange } from './i18n.js';

/** The largest number of tickets one person may book, matching the API. */
const MAX_TICKETS = 20;

/* ------------------------------------------------------------------ */
/* Startup                                                             */
/* ------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  initLayout();

  const eventId = readEventId();

  if (!eventId) {
    /*
     * No event named. Registration is per event and the menu no longer carries a
     * global Register link, so this is what someone gets by typing the URL: a
     * neutral note saying an event has to be chosen first, plus the way in.
     */
    renderNoEventChosen();
    return;
  }

  loadEvent(eventId);

  // Everything on this page is generated, so a language change rebuilds it from
  // the data already in memory. Nothing is re-fetched and a half-typed form is
  // deliberately NOT rebuilt, because that would throw away the visitor's input.
  onLanguageChange(() => {
    if (state.view === 'confirmation' && state.event) {
      renderConfirmation(state.event, state.registration);
    } else if (state.view === 'form' && state.event) {
      document.title = t('form.title');
    }
  });
});

/**
 * Everything the page needs to remember between renders.
 *
 * `view` is what lets a language change redraw the right screen instead of
 * guessing. Its values are:
 *   'loading'      - the event is being fetched
 *   'form'         - the event loaded, the registration form is shown
 *   'confirmation' - a registration was accepted, the receipt is shown
 *   'problem'      - something failed and an error panel is shown
 */
const state = {
  view: 'loading',
  event: null,
  registration: null,
};

/* ------------------------------------------------------------------ */
/* Reading the event id                                                */
/* ------------------------------------------------------------------ */

/**
 * The event id, from the query string first.
 *
 * The event detail page writes the id it displayed into localStorage, so a
 * visitor who opens registration.html directly (or reloads after the query
 * string was lost) still lands on the event they were looking at. The query
 * string wins because it is the explicit instruction.
 */
function readEventId() {
  const fromQuery = new URLSearchParams(window.location.search).get('id');
  if (fromQuery !== null && fromQuery !== '') return fromQuery;

  try {
    const stored = window.localStorage.getItem(LAST_EVENT_KEY);
    if (stored) {
      // Reflect it in the address bar so the URL stays shareable and a reload
      // does not depend on localStorage again.
      window.history.replaceState({}, '', `?id=${encodeURIComponent(stored)}`);
      return stored;
    }
  } catch (error) {
    // Private browsing can block localStorage; the query string still works.
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */
async function loadEvent(eventId) {
  const root = select('#registration-root');

  let event;
  try {
    event = await getEventById(eventId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      renderProblem(error.message, [t('error.eventSuspendedHint')]);
    } else {
      renderProblem(
        error.friendlyMessage || t('error.eventLoadFailed'),
        Array.isArray(error.details) ? error.details : []
      );
    }
    return;
  }

  state.event = event;

  // A past event cannot be registered for. The API would accept the insert, so
  // the rule belongs here rather than only in the database.
  if (event.eventState === 'past') {
    renderProblem(t('event.registerClosed'), [t('event.statusPast', { date: formatDate(event.dateEnd) })]);
    return;
  }

  document.title = t('form.title');
  const breadcrumb = select('#breadcrumb-event');
  if (breadcrumb) {
    breadcrumb.textContent = event.eventName;
    breadcrumb.setAttribute('href', `event.html?id=${encodeURIComponent(event.eventId)}`);
  }

  state.view = 'form';
  root.replaceChildren(buildPage(event));
  focusFirstField();
}

/** An error page with a way back. */
function renderProblem(message, details = []) {
  const root = select('#registration-root');
  state.view = 'problem';
  showError(root, message, details);
  appendBackLink(root);
}

/**
 * The page for "no event named", with a way to go and find one.
 *
 * This is NOT an error and deliberately does not use showError(): that always
 * prints the heading "Something went wrong", which is wrong here. Nobody made a
 * mistake - this page is simply reached by typing its URL, and registration
 * needs an event to attach to. So the heading states the situation and the body
 * says how to get in, using the plain `.state` styling rather than the red
 * error variant.
 */
function renderNoEventChosen() {
  const root = select('#registration-root');
  state.view = 'problem';

  const wrapper = el('div', { className: 'state' });
  wrapper.append(
    el('h3', { text: t('event.noIdTitle') }),
    el('p', { text: t('event.noIdHint') })
  );

  root.replaceChildren(wrapper);
  appendBackLink(root);
}

/* ------------------------------------------------------------------ */
/* The form page                                                       */
/* ------------------------------------------------------------------ */
function buildPage(event) {
  const container = el('div', { className: 'container section' });

  const layout = el('div', { className: 'registration-layout' });

  // The summary comes first in the reading order on a phone, and the grid puts
  // the form on the wide side from 1000px up.
  layout.append(buildEventSummary(event), buildFormCard(event));

  container.append(buildPageHeader(), layout);
  return container;
}

function buildPageHeader() {
  const header = el('header', { className: 'page-header' });
  header.append(el('p', { className: 'section__eyebrow', text: t('form.eyebrow') }));
  header.append(el('h1', { text: t('form.title') }));
  header.append(el('p', { className: 'section__lead', text: t('form.lead') }));
  return header;
}

/**
 * The event being registered for, built from GET /api/events/:id.
 *
 * The brief is explicit that the page must make it "clear about the event they
 * are registering for", so this repeats the essentials rather than relying on
 * the visitor remembering the previous page.
 */
function buildEventSummary(event) {
  const panel = el('aside', { className: 'panel panel--brand registration-summary' });

  // The panel's own heading is the event name, which is the most useful thing to
  // say at the top of the summary. An earlier revision put the label "You are
  // registering for" here and the event name in an h3 below the image, which
  // read as two competing titles.
  panel.append(el('h2', { className: 'registration-summary__title', text: event.eventName }));

  const media = el('div', { className: 'registration-summary__media' });
  media.append(
    el('img', {
      attributes: {
        src: imageUrl(event),
        alt: t('a11y.eventIllustration', { name: event.eventName }),
        width: '480',
        height: '300',
      },
    })
  );
  panel.append(media);

  const meta = el('div', { className: 'registration-summary__meta' });
  meta.append(stateBadge(event.eventState));
  if (event.categoryName) {
    meta.append(el('span', { className: 'chip', text: event.categoryName }));
  }
  panel.append(meta);

  panel.append(el('p', { text: event.shortDescription }));

  const facts = el('ul', { className: 'fact-list' });
  const rows = [
    [t('event.detailDate'), formatDate(event.dateStart)],
    [t('event.detailTime'), `${formatTime(event.startTime)} - ${formatTime(event.endTime)}`],
    [t('event.detailVenue'), event.venueName],
    [t('event.detailLocation'), `${event.city} ${event.state || ''}`.trim()],
  ];

  // Places left is only meaningful when the event publishes a capacity.
  if (event.capacity) {
    const registered = Number(event.registrationCount || 0);
    rows.push([
      t('event.detailCapacity'),
      t('event.seatsRemaining', {
        count: Math.max(event.capacity - registered, 0),
        capacity: event.capacity,
      }),
    ]);
  }

  rows.forEach(([label, value]) => {
    const item = el('li');
    item.append(
      el('span', { className: 'fact-list__label', text: label }),
      el('span', { className: 'fact-list__value', text: value })
    );
    facts.append(item);
  });
  panel.append(facts);

  panel.append(
    el('a', {
      className: 'button button--small button--outline',
      text: t('common.viewDetails'),
      attributes: { href: `event.html?id=${encodeURIComponent(event.eventId)}` },
    })
  );

  return panel;
}

/**
 * The registration form: one control per column the API stores.
 *
 * Every field carries a <label for>, and the message paragraph is linked with
 * aria-describedby so the reason a field was rejected is announced with it.
 */
function buildFormCard(event) {
  const card = el('section', { className: 'panel registration-form-card' });
  // The page heading already says "Register for an event", and the summary panel
  // beside this one already says who the event is. The card only needs to name
  // itself, so the panel title is the form's own title rather than a repeat of
  // the section heading below it.
  card.append(el('h2', { text: t('form.title') }));

  const form = el('form', {
    attributes: { id: 'registration-form', novalidate: 'novalidate' },
  });

  // A summary alert at the top of the form. role="alert" makes a screen reader
  // announce it as soon as the text is set, which is the accessible equivalent
  // of the "client-side alert" the brief asks for.
  const alert = el('p', {
    className: 'field-message',
    attributes: {
      id: 'form-alert',
      role: 'alert',
      'aria-live': 'assertive',
      tabindex: '-1',
    },
  });
  form.append(alert);

  /* --- who is registering ---------------------------------------- */
  form.append(el('h3', { text: t('form.detailsHeading') }));

  const row = el('div', { className: 'form-row' });
  row.append(
    textField({
      id: 'reg-name',
      name: 'attendeeName',
      labelKey: 'form.name',
      placeholderKey: 'form.namePlaceholder',
      autocomplete: 'name',
      required: true,
      maxlength: 120,
    }),
    textField({
      id: 'reg-email',
      name: 'attendeeEmail',
      labelKey: 'form.email',
      placeholderKey: 'form.emailPlaceholder',
      hintKey: 'form.emailHint',
      autocomplete: 'email',
      type: 'email',
      required: true,
      maxlength: 150,
    })
  );
  form.append(row);

  const contactRow = el('div', { className: 'form-row' });
  contactRow.append(
    textField({
      id: 'reg-phone',
      name: 'attendeePhone',
      labelKey: 'form.phone',
      placeholderKey: 'form.phonePlaceholder',
      hintKey: 'form.phoneHint',
      autocomplete: 'tel',
      type: 'tel',
      required: false,
      maxlength: 30,
    }),
    dateField()
  );
  form.append(contactRow);

  /* --- what they are buying -------------------------------------- */
  form.append(el('h3', { text: t('form.bookingHeading') }));
  form.append(buildTicketField(event));
  form.append(buildQuantityField(event));
  form.append(buildTotalLine(event));
  form.append(notesField());

  /* --- submit ----------------------------------------------------- */
  const submit = el('button', {
    className: 'button button--block',
    text: t('form.submit'),
    attributes: { type: 'submit', id: 'registration-submit' },
  });
  form.append(submit);

  form.append(
    el('p', { className: 'field__hint', text: t('form.requiredNotice') })
  );

  form.addEventListener('submit', (domEvent) => {
    domEvent.preventDefault();
    submitRegistration(event, form, alert, submit);
  });

  // Recalculate the running total as soon as either input changes.
  form.addEventListener('change', () => updateTotal(event, form));
  form.addEventListener('input', () => updateTotal(event, form));

  card.append(form);
  return card;
}

/** A labelled text/email/tel input with an optional hint. */
function textField({
  id,
  name,
  labelKey,
  placeholderKey,
  hintKey,
  autocomplete,
  type = 'text',
  required = false,
  maxlength,
}) {
  const field = el('div', { className: 'field' });

  const label = el('label', {
    text: required ? `${t(labelKey)} *` : t(labelKey),
    attributes: { for: id },
  });
  field.append(label);

  const input = el('input', {
    attributes: {
      type,
      id,
      name,
      autocomplete,
      'aria-describedby': `${id}-message${hintKey ? ` ${id}-hint` : ''}`,
      maxlength: String(maxlength),
    },
  });
  if (placeholderKey) input.setAttribute('placeholder', t(placeholderKey));
  if (required) input.setAttribute('required', 'required');
  field.append(input);

  if (hintKey) {
    field.append(el('p', { className: 'field__hint', text: t(hintKey), attributes: { id: `${id}-hint` } }));
  }
  field.append(fieldMessage(id));
  return field;
}

/** The date of registration, defaulted to today. */
function dateField() {
  const field = el('div', { className: 'field' });
  field.append(
    el('label', {
      text: `${t('form.date')} *`,
      attributes: { for: 'reg-date' },
    })
  );

  const input = el('input', {
    attributes: {
      type: 'date',
      id: 'reg-date',
      name: 'registeredAt',
      required: 'required',
      'aria-describedby': 'reg-date-message reg-date-hint',
    },
  });
  input.value = todayIso();
  field.append(input);
  field.append(el('p', { className: 'field__hint', text: t('form.dateHint'), attributes: { id: 'reg-date-hint' } }));
  field.append(fieldMessage('reg-date'));
  return field;
}

/** The notes field, for access or dietary requirements. */
function notesField() {
  const field = el('div', { className: 'field' });
  field.append(el('label', { text: t('form.notes'), attributes: { for: 'reg-notes' } }));

  const textarea = el('textarea', {
    attributes: {
      id: 'reg-notes',
      name: 'notes',
      rows: '3',
      maxlength: '300',
      'aria-describedby': 'reg-notes-message',
    },
  });
  textarea.setAttribute('placeholder', t('form.notesPlaceholder'));
  field.append(textarea);
  field.append(fieldMessage('reg-notes'));
  return field;
}

/**
 * The ticket type dropdown.
 *
 * The option text includes the price and, when the tier publishes an
 * allocation, how many are left - so the visitor can see what they are choosing
 * without leaving the page. `data-price` and `data-remaining` carry the machine
 * readable values used by updateTotal() and validate().
 */
function buildTicketField(event) {
  const field = el('div', { className: 'field' });
  field.append(
    el('label', { text: t('form.ticketType'), attributes: { for: 'reg-ticket' } })
  );

  const selectEl = el('select', {
    attributes: {
      id: 'reg-ticket',
      name: 'ticketTypeId',
      'aria-describedby': 'reg-ticket-message',
    },
  });

  const tickets = event.ticketTypes || [];

  if (tickets.length === 0) {
    // An event with no tiers yet can still be registered for: the tier column
    // is nullable, which is exactly what "general entry" means here.
    selectEl.append(
      el('option', {
        text: t('form.ticketNone'),
        attributes: { value: '', 'data-price': '0', 'data-remaining': '' },
      })
    );
    field.append(selectEl);
    field.append(fieldMessage('reg-ticket'));
    return field;
  }

  tickets.forEach((ticket, index) => {
    const sold = soldForTier(event, ticket.ticketTypeId);
    const remaining =
      ticket.quantityAvailable === null || ticket.quantityAvailable === undefined
        ? null
        : Math.max(Number(ticket.quantityAvailable) - sold, 0);

    const parts = [
      ticket.price === 0 ? `${ticket.ticketName} - ${t('event.free')}` : `${ticket.ticketName} - ${formatPrice(ticket.price)}`,
    ];
    if (remaining !== null) {
      parts.push(remaining > 0 ? t('event.availableCount', { count: remaining }) : t('event.soldOut'));
    }

    const option = el('option', {
      text: parts.join(' · '),
      attributes: {
        value: String(ticket.ticketTypeId),
        'data-price': String(ticket.price),
        'data-remaining': remaining === null ? '' : String(remaining),
      },
    });
    selectEl.append(option);
  });

  /*
   * Which tier opens selected?
   *
   * The cheapest tier a visitor can actually buy. Every seeded event lists its
   * free or concession tier first (it is the cheapest), and selecting that by
   * default meant the form opened on "Free Community Entry" for a paid fun run -
   * technically valid, but not what most people are there to do, and it made the
   * live total read "Free" before the visitor had touched anything.
   *
   * Falls back to the first tier when every tier is free, which is the correct
   * default for an event like the food drive.
   */
  const options = Array.from(selectEl.options);
  const available = options.filter((option) => {
    const remaining = option.getAttribute('data-remaining');
    return remaining === '' || Number(remaining) > 0;
  });
  const cheapestPaid = available.find((option) => Number(option.getAttribute('data-price')) > 0);
  const preferred = cheapestPaid || available[0];

  if (preferred) {
    options.forEach((option) => option.removeAttribute('selected'));
    preferred.setAttribute('selected', 'selected');
  }

  field.append(selectEl);
  field.append(fieldMessage('reg-ticket'));
  return field;
}

/**
 * How many tickets of one tier are already sold.
 *
 * Taken from the registrations the event endpoint already returned, so this
 * needs no extra request. It is what makes "sold out" and the remaining count
 * on the form agree with the list on the event page.
 */
function soldForTier(event, ticketTypeId) {
  return (event.registrations || [])
    .filter((row) => Number(row.ticketTypeId) === Number(ticketTypeId))
    .reduce((sum, row) => sum + Number(row.ticketsPurchased || 0), 0);
}

/** The number of tickets, with the maximum the chosen tier allows. */
function buildQuantityField(event) {
  const field = el('div', { className: 'field' });
  field.append(
    el('label', { text: `${t('form.quantity')} *`, attributes: { for: 'reg-quantity' } })
  );

  // The hard ceiling is the API limit; the per-tier limit is applied by
  // validate() and by the input's max attribute when a tier is chosen.
  const input = el('input', {
    attributes: {
      type: 'number',
      id: 'reg-quantity',
      name: 'ticketsPurchased',
      min: '1',
      max: String(MAX_TICKETS),
      step: '1',
      value: '1',
      required: 'required',
      'aria-describedby': 'reg-quantity-message reg-quantity-hint',
    },
  });
  field.append(input);
  field.append(
    el('p', {
      className: 'field__hint',
      text: t('form.quantityHint', { max: MAX_TICKETS }),
      attributes: { id: 'reg-quantity-hint' },
    })
  );
  field.append(fieldMessage('reg-quantity'));
  return field;
}

/** The live "3 x $20.00 = $60.00" line under the quantity. */
function buildTotalLine(event) {
  const line = el('p', {
    className: 'registration-total',
    attributes: { id: 'reg-total', 'aria-live': 'polite' },
  });
  line.dataset.eventId = String(event.eventId);
  return line;
}

/** One message slot per field. */
function fieldMessage(fieldId) {
  return el('p', {
    className: 'field-message',
    attributes: { id: `${fieldId}-message`, role: 'status', 'aria-live': 'polite' },
  });
}

/* ------------------------------------------------------------------ */
/* Live total                                                          */
/* ------------------------------------------------------------------ */
function updateTotal(event, form) {
  const line = form.querySelector('#reg-total');
  const selectEl = form.querySelector('#reg-ticket');
  const quantityInput = form.querySelector('#reg-quantity');
  if (!line || !selectEl || !quantityInput) return;

  const option = selectEl.selectedOptions[0];
  const price = option ? Number(option.getAttribute('data-price') || 0) : 0;
  const remainingAttr = option ? option.getAttribute('data-remaining') : '';
  const remaining = remainingAttr === '' ? null : Number(remainingAttr);
  const quantity = Number(quantityInput.value);

  // Keep the input's max in step with the chosen tier, so the browser's own
  // spinner cannot go past what is left.
  const ceiling = remaining === null ? MAX_TICKETS : Math.min(MAX_TICKETS, remaining);
  quantityInput.setAttribute('max', String(Math.max(ceiling, 1)));

  if (!Number.isFinite(quantity) || quantity < 1) {
    line.textContent = '';
    return;
  }

  if (price === 0) {
    // A free tier is worth saying explicitly: "$0.00" reads like a fault.
    line.textContent = `${t('form.totalLabel')}: ${t('event.free')}`;
    return;
  }

  line.textContent = `${t('form.totalLabel')}: ${t('form.estimatedTotal', {
    quantity,
    price: formatPrice(price),
    total: formatCurrency(price * quantity),
  })}`;
}

/* ------------------------------------------------------------------ */
/* Validation and submission                                           */
/* ------------------------------------------------------------------ */
function validate(event, form) {
  /** @type {Array<{field:string, message:string}>} */
  const problems = [];

  const name = form.querySelector('#reg-name').value.trim();
  const email = form.querySelector('#reg-email').value.trim();
  const phone = form.querySelector('#reg-phone').value.trim();
  const date = form.querySelector('#reg-date').value;
  const notes = form.querySelector('#reg-notes').value.trim();
  const selectEl = form.querySelector('#reg-ticket');
  const quantityRaw = form.querySelector('#reg-quantity').value;
  const quantity = Number(quantityRaw);

  if (name.length < 2) {
    problems.push({ field: 'reg-name', message: t('event.validationName') });
  } else if (name.length > 120) {
    problems.push({ field: 'reg-name', message: t('event.validationName') });
  }

  // The same pattern the API applies, so the two agree on what a valid address
  // is and the visitor is told before a round trip is made.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    problems.push({ field: 'reg-email', message: t('event.validationEmail') });
  }

  // The phone number is optional, but a wrong one is worse than a missing one.
  if (phone !== '' && !/^[+()\d][\d\s\-().]{5,29}$/.test(phone)) {
    problems.push({ field: 'reg-phone', message: t('event.validationPhone') });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    problems.push({ field: 'reg-date', message: t('event.validationDate') });
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    problems.push({ field: 'reg-quantity', message: t('event.validationQuantity') });
  } else if (quantity > MAX_TICKETS) {
    problems.push({
      field: 'reg-quantity',
      message: t('form.quantityHint', { max: MAX_TICKETS }),
    });
  } else {
    // How many are left of the chosen tier? Checked here as well as in the API
    // so the visitor is not sent on a round trip that is certain to fail.
    const option = selectEl.selectedOptions[0];
    const remainingAttr = option ? option.getAttribute('data-remaining') : '';
    if (remainingAttr !== '') {
      const remaining = Number(remainingAttr);
      if (remaining <= 0) {
        problems.push({ field: 'reg-ticket', message: t('event.soldOut') });
      } else if (quantity > remaining) {
        problems.push({
          field: 'reg-quantity',
          message: t('event.availableCount', { count: remaining }),
        });
      }
    }
  }

  if (problems.length > 0) return { problems };

  const selectedTier = selectEl.value === '' ? null : Number(selectEl.value);

  return {
    problems: [],
    values: {
      attendeeName: name,
      // Lower-cased to match the API and the unique key, so the visitor's
      // "Alex@Example.com" is recognised as the same person next time.
      attendeeEmail: email.toLowerCase(),
      attendeePhone: phone === '' ? undefined : phone,
      registeredAt: date,
      ticketsPurchased: quantity,
      ticketTypeId: selectedTier,
      notes: notes === '' ? undefined : notes,
    },
  };
}

/** Write the collected problems onto the page. */
function showProblems(form, alert, problems) {
  // Clear every previous message first, so a fixed field stops showing an error.
  form.querySelectorAll('.field-message').forEach((node) => setFieldMessage(node, ''));

  problems.forEach((problem) => {
    const slot = form.querySelector(`#${problem.field}-message`);
    if (slot) setFieldMessage(slot, problem.message, 'error');
    const input = form.querySelector(`#${problem.field}`);
    if (input) input.setAttribute('aria-invalid', 'true');
  });

  alert.textContent = t('form.requiredNotice');
  alert.className = 'field-message field-message--error';
  alert.focus();

  // Bring the first problem into view: on a phone the field can be off screen.
  const first = form.querySelector(`#${problems[0].field}`);
  if (first && typeof first.scrollIntoView === 'function') {
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/** POST the registration and, on success, show the confirmation. */
async function submitRegistration(event, form, alert, submitButton) {
  const { problems, values } = validate(event, form);

  if (problems.length > 0) {
    showProblems(form, alert, problems);
    return;
  }

  // Guard against a double click creating two registrations. The API would
  // reject the second one with a 409 anyway, but the button should not invite it.
  submitButton.disabled = true;
  const originalLabel = submitButton.textContent;
  submitButton.textContent = t('form.submitting');
  alert.textContent = '';
  alert.className = 'field-message';

  try {
    const registration = await createRegistration(event.eventId, values);

    state.view = 'confirmation';
    state.registration = registration;

    // Re-read the event so the confirmation and the "places left" figure reflect
    // the registration that was just made. A failure here must not hide the
    // success, so it falls back to the copy already in memory.
    let refreshed = event;
    try {
      refreshed = await getEventById(event.eventId);
      state.event = refreshed;
    } catch (error) {
      // Keep the previous copy; the confirmation is still valid.
    }

    renderConfirmation(refreshed, registration);
  } catch (error) {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;

    if (error instanceof ApiError) {
      // 409: this email is already registered for this event. Point at the field
      // rather than only showing a page-level message.
      if (error.status === 409) {
        const emailSlot = form.querySelector('#reg-email-message');
        if (emailSlot) {
          setFieldMessage(emailSlot, error.message || t('error.alreadyRegistered'), 'error');
        }
        form.querySelector('#reg-email').setAttribute('aria-invalid', 'true');
        alert.textContent = error.message || t('error.alreadyRegistered');
        alert.className = 'field-message field-message--error';
        alert.focus();
        return;
      }

      // 400: the API returned one entry per bad field, so show them in place.
      if (error.status === 400 && error.fieldErrors.length > 0) {
        const mapped = error.fieldErrors.map((item) => ({
          field: fieldIdForApiField(item.field),
          message: item.message,
        }));
        showProblems(form, alert, mapped.filter((item) => item.field));
        return;
      }

      alert.textContent = error.friendlyMessage || t('error.server');
    } else {
      alert.textContent = t('error.server');
    }
    alert.className = 'field-message field-message--error';
    alert.focus();
  }
}

/** Map an API field name onto the id of the input that produced it. */
function fieldIdForApiField(apiField) {
  const map = {
    attendeeName: 'reg-name',
    attendeeEmail: 'reg-email',
    attendeePhone: 'reg-phone',
    registeredAt: 'reg-date',
    ticketsPurchased: 'reg-quantity',
    ticketTypeId: 'reg-ticket',
    notes: 'reg-notes',
  };
  return map[apiField] || '';
}

/* ------------------------------------------------------------------ */
/* Confirmation                                                        */
/* ------------------------------------------------------------------ */
function renderConfirmation(event, registration) {
  const root = select('#registration-root');
  const container = el('div', { className: 'container section' });

  const card = el('section', {
    className: 'panel confirmation',
    attributes: { role: 'status', 'aria-live': 'polite' },
  });

  card.append(el('p', { className: 'confirmation__glyph', text: '✓', attributes: { 'aria-hidden': 'true' } }));
  card.append(el('h1', { text: t('form.successHeading') }));
  card.append(
    el('p', {
      className: 'confirmation__lead',
      text: t('form.successLead', {
        name: registration.attendeeName,
        event: event ? event.eventName : '',
      }),
    })
  );
  card.append(
    el('p', {
      text: t('form.successEmail', { email: registration.attendeeEmail }),
    })
  );

  // A receipt: everything that was stored, read back from the API response
  // rather than from the form, so what is shown is what the database holds.
  const list = el('ul', { className: 'contact-list confirmation__receipt' });
  const rows = [
    [t('event.registrationsLogin'), `#${registration.registrationId}`],
    [t('form.name'), registration.attendeeName],
    [t('form.email'), registration.attendeeEmail],
    [t('form.date'), formatDate(String(registration.registeredAt).slice(0, 10))],
    [t('form.ticketType'), registration.ticketName || t('form.ticketNone')],
    [t('form.quantity'), String(registration.ticketsPurchased)],
    [
      t('form.totalLabel'),
      registration.totalAmount > 0 ? formatCurrency(registration.totalAmount) : t('event.free'),
    ],
  ];
  rows.forEach(([label, value]) => {
    const item = el('li');
    item.append(el('span', { text: label }), el('span', { text: value }));
    list.append(item);
  });
  card.append(list);

  const actions = el('p', { className: 'confirmation__actions' });
  actions.append(
    el('a', {
      className: 'button',
      text: t('form.viewEvent'),
      attributes: { href: `event.html?id=${encodeURIComponent(registration.eventId)}` },
    }),
    el('a', {
      className: 'button button--outline',
      text: t('form.browseMore'),
      attributes: { href: 'search.html' },
    })
  );
  card.append(actions);

  container.append(card);
  root.replaceChildren(container);

  document.title = t('form.successHeading');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function appendBackLink(root) {
  const container = root.querySelector('.container') || root;
  const paragraph = el('p');
  paragraph.style.textAlign = 'center';
  paragraph.append(
    el('a', {
      className: 'button button--outline',
      text: t('error.backHome'),
      attributes: { href: 'index.html' },
    }),
    el('a', {
      className: 'button button--ghost',
      text: t('error.searchForEvent'),
      attributes: { href: 'search.html' },
    })
  );
  container.append(paragraph);
}

/** Today as YYYY-MM-DD in the visitor's own timezone, for the date input. */
function todayIso() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Put the cursor in the first field once the form is on screen. */
function focusFirstField() {
  const first = select('#reg-name');
  if (!first) return;
  // Wait a frame so the browser has laid the form out; focusing a display:none
  // node does nothing.
  window.requestAnimationFrame(() => {
    first.focus({ preventScroll: true });
    updateTotal(state.event, select('#registration-form'));
  });
}

// Exported for the automated test suite, which loads this module in a DOM and
// needs to exercise the validation rules without driving the whole page.
export { validate, soldForTier, fieldIdForApiField, REGISTRATION_PAGE };
