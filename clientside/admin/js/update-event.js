/**
 * admin/js/update-event.js
 * ---------------------------------------------------------------------------
 * The "update an existing event" page.
 *
 * Flow
 *   1. Load the dropdown lists AND the event list, in parallel.
 *   2. An event can be chosen from the picker, or arrive already chosen through
 *      ?id=7 (which is what the Edit link on the events page and the "see the
 *      registrations" link both use).
 *   3. Load the chosen event from GET /api/admin/events/:id, which is the
 *      endpoint that also returns its registrations - the "associated
 *      registration data" the brief asks this interface to display.
 *   4. On submit: send only the fields that changed to PUT /api/events/:id.
 */
import {
  getReferenceData,
  getAdminEvents,
  getAdminEventById,
  updateEvent,
  deleteRegistration,
  ApiError,
} from '../../js/api.js';
import { el } from '../../js/dom.js';
import { t } from './admin-i18n.js';
import {
  initAdminLayout,
  showBanner,
  showApiError,
  showTableLoading,
  fillSelect,
  queryParam,
  setQueryParam,
} from './admin.js';
import { buildEventForm, buildRegistrationsPanel } from './event-editor.js';
import { changedFields } from './admin-shared.js';

/** Everything the page has loaded, so a re-render does not re-fetch. */
const state = {
  reference: null,
  eventList: [],
  /** The event as the API returned it: what "changed" is compared against. */
  original: null,
};

document.addEventListener('DOMContentLoaded', () => {
  initAdminLayout({ title: t('form.editHeading'), lead: t('form.editLead') });
  load();
});

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */
async function load() {
  const formHost = document.querySelector('#event-form-root');

  showTableLoading(formHost, 'Loading the events...');

  try {
    [state.reference, state.eventList] = await Promise.all([
      getReferenceData(),
      getAdminEvents({ limit: 100, state: 'all', publishStatus: 'all' }),
    ]);
  } catch (error) {
    showApiError(formHost, error, { title: t('error.heading') });
    return;
  }

  const picker = document.querySelector('#event-picker');
  if (picker) {
    // Newest first is the most useful order here: the event someone is most
    // likely to be editing is usually the most recent one.
    const sorted = (state.eventList || [])
      .slice()
      .sort((a, b) => b.eventId - a.eventId);

    fillSelect(picker, sorted, {
      value: (item) => item.eventId,
      /*
       * "#7 · Name · 进行中 · 已有 3 人报名"
       *
       * The status comes from status.* so it reads in the chosen language; the
       * event name and id stay as they are, because they are data.
       */
      label: (item) =>
        `#${item.eventId} · ${item.eventName} · ${t(`status.${item.status}`)}${
          item.registrationCount
            ? ` · ${t('event.summaryRegistered', { count: item.registrationCount })}`
            : ''
        }`,
      placeholder: t('form.selectEventPlaceholder'),
      selected: queryParam('id') || '',
    });

    picker.addEventListener('change', () => {
      setQueryParam('id', picker.value);
      if (picker.value) loadEvent(picker.value);
      else showNothingChosen();
    });
  }

  const requested = queryParam('id');
  if (requested) {
    await loadEvent(requested);
  } else {
    showNothingChosen();
  }
}

/** The "pick one first" state. */
function showNothingChosen() {
  const host = document.querySelector('#event-form-root');
  const empty = el('div', { className: 'state state--empty' });
  empty.append(
    el('h3', { text: t('update.emptyHeading') }),
    el('p', { text: t('update.emptyHint') })
  );
  host.replaceChildren(empty);
}

/* ------------------------------------------------------------------ */
/* One event                                                           */
/* ------------------------------------------------------------------ */
/**
 * Reload one event into the form and the registrations panel.
 *
 * @param {string|number} eventId
 * @param {{clearFeedback?: boolean}} [options]
 *        clearFeedback defaults to true, because moving to a different event
 *        must not leave the previous event's message on screen. save() passes
 *        false so the success banner it just showed survives the reload - an
 *        earlier revision cleared it here, which meant the confirmation flashed
 *        up and vanished before anyone could read it.
 */
async function loadEvent(eventId, { clearFeedback = true } = {}) {
  const host = document.querySelector('#event-form-root');
  const feedback = document.querySelector('#events-feedback');

  if (clearFeedback) feedback.replaceChildren();
  showTableLoading(host, 'Loading the event...');

  let event;
  try {
    // The admin endpoint, not the public one: a suspended event must be
    // editable, and the public endpoint hides those.
    event = await getAdminEventById(eventId);
  } catch (error) {
    showApiError(host, error, { title: t('error.heading') });
    return;
  }

  state.original = event;

  const wrapper = el('div', { className: 'admin-edit' });

  // el() takes a single attributes object, so a panel with a child is built in
  // two steps rather than by passing an array of children.
  const summaryPanel = el('section', { className: 'panel' });
  summaryPanel.append(buildFormHeader(event));
  wrapper.append(summaryPanel);

  const form = buildEventForm({
    reference: state.reference,
    event,
    submitLabel: t('form.saveChanges'),
    onSubmit: (payload) => save(event, payload),
  });
  wrapper.append(form);

  // The brief: "This interface should also retrieve and display any associated
  // registration data for that specific event, providing the staff member with
  // useful information." The data arrived with the event.
  wrapper.append(
    buildRegistrationsPanel(event, async (registrationId) => {
      await removeRegistration(event, registrationId);
    })
  );

  host.replaceChildren(wrapper);
}

/** A short summary banner above the form, so it is obvious what is being edited. */
function buildFormHeader(event) {
  const header = el('div', { className: 'admin-edit__header' });
  header.append(
    el('h2', { text: `#${event.eventId} · ${event.eventName}` }),
    el('p', {
      text: `${event.organizationName || ''} · ${event.venueName || ''} · ${event.city || ''} · ${t(
        `status.${event.status}`
      )}${
        event.registrationCount
          ? ` · ${t('event.summaryRegistered', { count: event.registrationCount })}`
          : ''
      }`,
    })
  );
  return header;
}

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */
async function save(event, payload) {
  const feedback = document.querySelector('#events-feedback');
  const host = document.querySelector('#event-form-root');

  // Send only what changed. A PUT that carried every field would overwrite a
  // concurrent edit someone else made to a column this person never touched.
  const changes = changedFields(payload, state.original);

  if (Object.keys(changes).length === 0) {
    showBanner(feedback, t('form.noChanges'), 'info', { title: event.eventName });
    return;
  }

  try {
    const updated = await updateEvent(event.eventId, changes);

    state.original = updated;
    showBanner(feedback, t('form.updated', { name: updated.eventName }), 'success', {
      title: Object.keys(changes).join(', '),
      actions: [
        el('a', {
          className: 'button button--small button--ghost',
          text: t('events.view'),
          attributes: {
            href: `../event.html?id=${encodeURIComponent(updated.eventId)}`,
            target: '_blank',
            rel: 'noopener',
          },
        }),
        el('a', {
          className: 'button button--small button--outline',
          text: t('nav.events'),
          attributes: { href: 'events.html' },
        }),
      ],
    });

    // Rebuild from the API's own answer rather than from the form, so what is
    // on screen is what the database now holds - including updated_at effects
    // such as a recomputed event state. clearFeedback:false keeps the success
    // banner above the refreshed form.
    await loadEvent(updated.eventId, { clearFeedback: false });
  } catch (error) {
    showApiError(host, error, { title: t('error.heading') });
  }
}

/* ------------------------------------------------------------------ */
/* Removing a registration                                             */
/* ------------------------------------------------------------------ */
/**
 * Delete one registration from the event being edited.
 *
 * This is the escape hatch the brief's data-integrity rule implies: an event
 * with registrations cannot be deleted, so the way to remove such an event is
 * to remove its registrations first. Rather than hiding that, the panel shows
 * the registrations and lets staff remove one - and says plainly that doing so
 * is what unblocks the delete.
 */
async function removeRegistration(event, registrationId) {
  const feedback = document.querySelector('#events-feedback');
  const formHost = document.querySelector('#event-form-root');

  try {
    await deleteRegistration(registrationId);
    showBanner(feedback, t('registrations.deleted'), 'success', { title: event.eventName });

    // Reload the event so the registration list and the count are accurate, and
    // so the events page will now allow the delete if this was the last one.
    await loadEvent(event.eventId);
    await refreshEventList();
  } catch (error) {
    showApiError(formHost, error, { title: t('error.heading') });
  }
}

/** Keep the picker's registration counts honest after a delete. */
async function refreshEventList() {
  try {
    state.eventList = await getAdminEvents({ limit: 100, state: 'all', publishStatus: 'all' });
    const picker = document.querySelector('#event-picker');
    if (!picker) return;
    const current = picker.value;
    fillSelect(picker, state.eventList.slice().sort((a, b) => b.eventId - a.eventId), {
      value: (item) => item.eventId,
      label: (item) =>
        `#${item.eventId} · ${item.eventName} · ${t(`status.${item.status}`)}${
          item.registrationCount
            ? ` · ${t('event.summaryRegistered', { count: item.registrationCount })}`
            : ''
        }`,
      placeholder: t('form.selectEventPlaceholder'),
      selected: current,
    });
  } catch (error) {
    // A failure here does not affect the edit form, so it is reported quietly.
    console.warn('[admin] could not refresh the event list:', error.message);
  }
}

export { ApiError };
