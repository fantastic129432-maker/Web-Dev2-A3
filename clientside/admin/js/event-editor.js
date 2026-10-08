/**
 * admin/js/event-editor.js
 * ---------------------------------------------------------------------------
 * The event form, built once and used by both the "add event" page and the
 * "update event" page.
 *
 * The brief asks for three separate things that all live here:
 *   * New feature   - "an intuitive form that allows staff to create and submit
 *                     new charity events to the database", with validation.
 *   * Update feature - "an intuitive form that allows staff to select and update
 *                     the details of an existing event", which must also
 *                     "retrieve and display any associated registration data for
 *                     that specific event, providing the staff member with
 *                     useful information".
 *
 * Building ONE form means the two pages cannot drift apart: adding a field to
 * the create form adds it to the edit form, and the validation rules are
 * literally the same function. The two pages differ only in what they do with
 * the submitted result.
 */
import { el, select } from '../../js/dom.js';
import { EVENT_IMAGES } from '../../js/config.js';
import { t } from './admin-i18n.js';
import {
  buildTable,
  fillSelect,
  fillImageSelect,
  stackedCell,
  showBanner,
  confirmAction,
} from './admin.js';
import {
  EVENT_FIELDS,
  readEventForm,
  validateEventForm,
  paintProblems,
  readTicketTypes,
} from './admin-shared.js';

/** The publishing statuses, in the order the events.status column declares. */
const STATUSES = ['active', 'suspended', 'cancelled'];

/**
 * Build the whole form.
 *
 * @param {{reference: object, event?: object, submitLabel: string,
 *          onSubmit: (payload:object, form:HTMLFormElement)=>Promise<void>}} spec
 * @returns {HTMLFormElement}
 */
export function buildEventForm({ reference, event = null, submitLabel, onSubmit }) {
  const form = el('form', {
    className: 'admin-form',
    attributes: { id: 'event-form', novalidate: 'novalidate' },
  });

  const summary = el('p', {
    className: 'field-message',
    attributes: { id: 'form-summary', role: 'alert', 'aria-live': 'assertive', tabindex: '-1' },
  });
  form.append(summary);

  /* ---------------------------------------------------------- basics --- */
  form.append(sectionHeading(t('form.sectionBasics')));

  form.append(
    field('eventName', {
      label: t('field.eventName'),
      required: true,
      control: textInput('eventName', event ? event.eventName : '', { maxlength: 180 }),
    })
  );

  const row1 = el('div', { className: 'form-row' });
  row1.append(
    field('organizationId', {
      label: t('field.organizationId'),
      required: true,
      control: selectControl(
        'organizationId',
        reference.organizations,
        (item) => item.organizationId,
        (item) => `${item.name} (${item.city})`,
        event ? event.organizationId : ''
      ),
    }),
    field('categoryId', {
      label: t('field.categoryId'),
      required: true,
      control: selectControl(
        'categoryId',
        reference.categories,
        (item) => item.categoryId,
        (item) => item.categoryName,
        event ? event.categoryId : ''
      ),
    })
  );
  form.append(row1);

  form.append(
    field('locationId', {
      label: t('field.locationId'),
      required: true,
      control: selectControl(
        'locationId',
        reference.locations,
        (item) => item.locationId,
        (item) => `${item.venueName} - ${item.city}, ${item.state}`,
        event ? event.locationId : ''
      ),
      hint: t('field.locationHint'),
    })
  );

  form.append(
    field('shortDescription', {
      label: t('field.shortDescription'),
      required: true,
      hint: t('field.shortDescriptionHint'),
      control: textInput('shortDescription', event ? event.shortDescription : '', {
        maxlength: 300,
      }),
    })
  );

  form.append(
    field('description', {
      label: t('field.description'),
      required: true,
      hint: t('field.descriptionHint'),
      control: textarea('description', event ? event.description : '', { rows: 6 }),
    })
  );

  form.append(
    field('purpose', {
      label: t('field.purpose'),
      required: true,
      control: textInput('purpose', event ? event.purpose : '', { maxlength: 300 }),
    })
  );

  /* ------------------------------------------------------------ when --- */
  form.append(sectionHeading(t('form.sectionWhen')));

  form.append(
    field('eventDate', {
      label: t('field.eventDate'),
      required: true,
      hint: t('field.eventDateHint'),
      control: dateInput('eventDate', event ? event.eventDate : ''),
    })
  );

  const row2 = el('div', { className: 'form-row' });
  row2.append(
    field('dateStart', {
      label: t('field.dateStart'),
      control: dateInput('dateStart', event ? event.dateStart : ''),
    }),
    field('dateEnd', {
      label: t('field.dateEnd'),
      control: dateInput('dateEnd', event ? event.dateEnd : ''),
    })
  );
  form.append(row2);

  const row3 = el('div', { className: 'form-row' });
  row3.append(
    field('startTime', {
      label: t('field.startTime'),
      required: true,
      control: timeInput('startTime', event ? event.startTime : ''),
    }),
    field('endTime', {
      label: t('field.endTime'),
      required: true,
      control: timeInput('endTime', event ? event.endTime : ''),
    })
  );
  form.append(row3);

  /* ----------------------------------------------------- money/capacity --- */
  form.append(sectionHeading(t('form.sectionMoney')));

  const row4 = el('div', { className: 'form-row' });
  row4.append(
    field('goalAmount', {
      label: t('field.goalAmount'),
      control: numberInput('goalAmount', event ? event.goalAmount : 0, { min: 0, step: '0.01' }),
    }),
    field('capacity', {
      label: t('field.capacity'),
      hint: t('field.capacityHint'),
      control: numberInput('capacity', event && event.capacity !== null ? event.capacity : '', {
        min: 1,
        step: '1',
      }),
    })
  );
  form.append(row4);

  const row5 = el('div', { className: 'form-row' });
  row5.append(
    field('status', {
      label: t('field.status'),
      hint: t('field.statusHint'),
      control: selectControl(
        'status',
        STATUSES,
        (item) => item,
        (item) => t(`status.${item}`),
        event ? event.status : 'active'
      ),
    }),
    field('imageUrl', {
      label: t('field.imageUrl'),
      control: imageControl(event ? event.imageUrl : EVENT_IMAGES[0]),
    })
  );
  form.append(row5);

  form.append(
    field('isFree', {
      label: t('field.isFree'),
      control: checkbox('isFree', event ? event.isFree : false),
      inline: true,
    })
  );

  /* --------------------------------------------------------- tickets --- */
  form.append(sectionHeading(t('form.sectionTickets')));
  form.append(el('p', { className: 'field__hint', text: t('form.sectionTicketsHint') }));

  const ticketsHost = el('div', { className: 'ticket-rows', attributes: { id: 'ticket-rows' } });
  form.append(ticketsHost);

  // On the create form a new event needs at least one price to show on the
  // home page, so two blank rows are offered. On the update form the existing
  // tiers are shown read-only, because the API only writes tiers for an event
  // that has none yet - showing editable boxes that would be ignored would be a
  // lie about what the Save button does.
  if (event) {
    form.append(buildExistingTiers(event));
  } else {
    addTicketRow(ticketsHost);
    addTicketRow(ticketsHost);

    form.append(
      el('button', {
        className: 'button button--small button--outline',
        text: t('field.addTier'),
        attributes: { type: 'button', id: 'add-tier' },
      })
    );
    form.querySelector('#add-tier').addEventListener('click', () => addTicketRow(ticketsHost));
  }

  /* ---------------------------------------------------------- submit --- */
  const actions = el('div', { className: 'admin-form__actions' });
  const submit = el('button', {
    className: 'button',
    text: submitLabel,
    attributes: { type: 'submit', id: 'event-submit' },
  });
  const reset = el('button', {
    className: 'button button--outline',
    text: t('form.reset'),
    attributes: { type: 'reset', id: 'event-reset' },
  });
  actions.append(submit, reset);
  form.append(actions);

  reset.addEventListener('click', () => {
    // A reset restores the values the form was built with, which is exactly
    // "undo my edits" on the update page and "clear" on the create page.
    summary.textContent = '';
    summary.className = 'field-message';
    form.querySelectorAll('.field-message').forEach((node) => {
      if (node.id === 'form-summary') return;
      node.textContent = '';
      node.className = 'field-message';
    });
  });

  form.addEventListener('submit', async (domEvent) => {
    domEvent.preventDefault();

    const problems = validateEventForm(form);
    if (problems.length > 0) {
      paintProblems(form, problems, summary);
      return;
    }

    paintProblems(form, [], summary);

    const payload = readEventForm(form);

    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = submitLabel.includes('Update') ? t('form.updating') : t('form.creating');

    try {
      await onSubmit(payload, form);
    } finally {
      // Always restore the button, even when onSubmit swallows the error and
      // renders a banner instead: a permanently disabled Save button would make
      // the page unusable.
      submit.disabled = false;
      submit.textContent = original;
    }
  });

  // Keep the derived date window in step while the person types, so a
  // single-day event needs only the event date filled in.
  const eventDateInput = form.elements.namedItem('eventDate');
  eventDateInput.addEventListener('change', () => {
    const start = form.elements.namedItem('dateStart');
    const end = form.elements.namedItem('dateEnd');
    if (start.value === '') start.value = eventDateInput.value;
    if (end.value === '') end.value = eventDateInput.value;
  });

  return form;
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function sectionHeading(text) {
  return el('h2', { className: 'admin-form__heading', text });
}

/** A labelled field wrapper with a message slot. */
function field(name, { label, control, hint, required = false, inline = false }) {
  const wrapper = el('div', { className: inline ? 'field field--inline' : 'field' });

  const labelNode = el('label', {
    text: required ? `${label} *` : label,
    attributes: { for: control.id },
  });
  wrapper.append(labelNode, control);

  if (hint) wrapper.append(el('p', { className: 'field__hint', text: hint }));

  wrapper.append(
    el('p', {
      className: 'field-message',
      attributes: { id: `${name}-message`, role: 'status', 'aria-live': 'polite' },
    })
  );

  return wrapper;
}

function textInput(name, value, { maxlength } = {}) {
  const input = el('input', {
    attributes: { type: 'text', id: name, name, autocomplete: 'off' },
  });
  if (maxlength) input.setAttribute('maxlength', String(maxlength));
  input.value = value === null || value === undefined ? '' : String(value);
  return input;
}

function textarea(name, value, { rows = 4 } = {}) {
  const node = el('textarea', { attributes: { id: name, name, rows: String(rows) } });
  node.value = value === null || value === undefined ? '' : String(value);
  return node;
}

function dateInput(name, value) {
  const input = el('input', { attributes: { type: 'date', id: name, name } });
  input.value = value ? String(value).slice(0, 10) : '';
  return input;
}

function timeInput(name, value) {
  const input = el('input', { attributes: { type: 'time', id: name, name } });
  // MySQL returns "07:30:00"; an <input type="time"> wants "07:30".
  input.value = value ? String(value).slice(0, 5) : '';
  return input;
}

function numberInput(name, value, { min, step = '1' } = {}) {
  const input = el('input', {
    attributes: { type: 'number', id: name, name, step, min: String(min) },
  });
  input.value = value === null || value === undefined ? '' : String(value);
  return input;
}

function checkbox(name, checked) {
  const input = el('input', { attributes: { type: 'checkbox', id: name, name } });
  input.checked = Boolean(checked);
  return input;
}

function selectControl(name, items, valueOf, labelOf, selected) {
  const node = el('select', { attributes: { id: name, name } });
  fillSelect(node, items, {
    value: valueOf,
    label: labelOf,
    placeholder: t('form.choosePlaceholder'),
    selected,
  });
  return node;
}

function imageControl(selected) {
  const node = el('select', { attributes: { id: 'imageUrl', name: 'imageUrl' } });
  fillImageSelect(node, EVENT_IMAGES, selected);
  return node;
}

/** One editable ticket-tier row. */
function addTicketRow(host) {
  const index = host.childElementCount;

  const row = el('div', { className: 'ticket-row', attributes: { 'data-ticket-row': '' } });

  const name = el('input', {
    attributes: {
      type: 'text',
      placeholder: t('field.ticketName'),
      'data-ticket-name': '',
      'aria-label': `${t('field.ticketName')} ${index + 1}`,
      maxlength: '100',
    },
  });
  const price = el('input', {
    attributes: {
      type: 'number',
      min: '0',
      step: '0.01',
      placeholder: t('field.ticketPrice'),
      'data-ticket-price': '',
      'aria-label': `${t('field.ticketPrice')} ${index + 1}`,
    },
  });
  const quantity = el('input', {
    attributes: {
      type: 'number',
      min: '0',
      step: '1',
      placeholder: t('field.ticketQuantity'),
      'data-ticket-quantity': '',
      'aria-label': `${t('field.ticketQuantity')} ${index + 1}`,
    },
  });

  const remove = el('button', {
    className: 'button button--small button--ghost',
    text: t('field.removeTier'),
    attributes: { type: 'button' },
  });
  remove.addEventListener('click', () => {
    row.remove();
    // Leave at least one row so the block is never empty on screen.
    if (host.childElementCount === 0) addTicketRow(host);
  });

  row.append(name, price, quantity, remove);
  host.append(row);

  // The message slots for a dynamic row have to be created with it, because
  // paintProblems() looks them up by the id it is given.
  row.append(
    el('p', {
      className: 'field-message',
      attributes: { id: `ticketName-${index}-message`, role: 'status' },
    })
  );

  return row;
}

/** A read-only summary of the tiers the event already has. */
function buildExistingTiers(event) {
  const wrapper = el('div');
  const tickets = event.ticketTypes || [];

  if (tickets.length === 0) {
    wrapper.append(el('p', { className: 'field__hint', text: t('form.noTicketTypes') }));
    return wrapper;
  }

  const rows = tickets.map((ticket) => [
    ticket.ticketName,
    ticket.price === 0 ? t('ticket.free') : `$${Number(ticket.price).toFixed(2)}`,
    ticket.quantityAvailable === null || ticket.quantityAvailable === undefined
      ? t('ticket.unlimited')
      : String(ticket.quantityAvailable),
  ]);

  wrapper.append(
    buildTable({
      caption: t('event.ticketTypesHeading', { name: event.eventName }),
      columns: [
        { label: t('field.ticketName') },
        { label: t('field.ticketPrice'), numeric: true },
        { label: t('field.ticketQuantity'), numeric: true },
      ],
      rows,
    })
  );
  wrapper.append(
    el('p', {
      className: 'field__hint',
      text: t('form.ticketTypesExistingHint'),
    })
  );

  return wrapper;
}

/* ------------------------------------------------------------------ */
/* Registrations panel (update page)                                   */
/* ------------------------------------------------------------------ */

/**
 * The registrations recorded against one event.
 *
 * The brief requires the update interface to "also retrieve and display any
 * associated registration data for that specific event, providing the staff
 * member with useful information". The data comes from the same endpoint the
 * public event page uses, so what staff see is exactly what a visitor sees.
 *
 * @param {object} event
 * @param {(registrationId:number)=>Promise<void>} onDelete
 * @returns {HTMLElement}
 */
export function buildRegistrationsPanel(event, onDelete) {
  const panel = el('section', {
    className: 'panel admin-form__heading-spaced',
    attributes: { 'aria-labelledby': 'update-registrations-heading' },
  });

  const registrations = event.registrations || [];

  panel.append(
    el('h2', {
      text: t('update.registrationsHeading'),
      attributes: { id: 'update-registrations-heading' },
    })
  );

  if (registrations.length === 0) {
    panel.append(el('p', { text: t('update.registrationsEmpty') }));
    return panel;
  }

  // A missing delete permission is worth stating plainly: the number here is
  // exactly why the Delete button on the events page will refuse.
  panel.append(
    el('p', {
      className: 'banner banner--warning banner--inline',
      text: t('update.registrationsBlocked', { count: registrations.length }),
    })
  );

  const rows = registrations.map((registration) => {
    const remove = el('button', {
      className: 'button button--small button--danger',
      text: t('registrations.delete'),
      attributes: { type: 'button' },
    });
    remove.addEventListener('click', async () => {
      const confirmed = await confirmAction({
        title: t('registrations.deleteTitle'),
        body: t('registrations.deleteBody', { name: registration.attendeeName }),
        confirmLabel: t('registrations.delete'),
      });
      if (confirmed) await onDelete(registration.registrationId);
    });

    return [
      stackedCell(registration.attendeeName, registration.attendeeEmail),
      registration.ticketName || '-',
      String(registration.ticketsPurchased),
      `$${Number(registration.totalAmount || 0).toFixed(2)}`,
      String(registration.registeredAt),
      remove,
    ];
  });

  panel.append(
    buildTable({
      caption: t('event.registrationsHeading', { name: event.eventName }),
      columns: [
        { label: t('registrations.colAttendee') },
        { label: t('registrations.colTier') },
        { label: t('registrations.colTickets'), numeric: true },
        { label: t('registrations.colValue'), numeric: true },
        { label: t('registrations.colWhen') },
        { label: t('registrations.colActions'), rowHeader: false },
      ],
      rows,
    })
  );

  return panel;
}

export { readTicketTypes, showBanner };
