/**
 * admin/js/events.js
 * ---------------------------------------------------------------------------
 * The main admin listing: every event, whatever its status, with the three
 * actions the brief requires.
 *
 *   List feature   - "displays a complete list of all registered events,
 *                    regardless of their status (Active, Past, Suspended). This
 *                    data must be retrieved by calling the appropriate API
 *                    endpoint."
 *                      -> GET /api/admin/events
 *   Update feature - the Edit link opens update.html?id=... with the event
 *                    already loaded.
 *   Delete feature - "Implement a 'Delete' button or link next to each event in
 *                    the main listing. Ensure this button triggers the call to
 *                    the endpoint created in Part 2. Provide clear user
 *                    feedback, especially if the deletion is blocked due to
 *                    existing registrations."
 *                      -> DELETE /api/events/:id, and a 409 is reported with the
 *                         reason and a link to the registrations.
 */
import { getAdminEvents, deleteEvent, ApiError } from '../../js/api.js';
import { el, formatShortDate } from '../../js/dom.js';
import { t } from './admin-i18n.js';
import {
  initAdminLayout,
  buildTable,
  stackedCell,
  statusBadge,
  stateBadge,
  actionGroup,
  showBanner,
  showApiError,
  showTableLoading,
  confirmAction,
  queryParam,
  setQueryParam,
} from './admin.js';

/** The filters currently applied, kept so a delete can reload the same view. */
const filters = {
  publishStatus: 'all',
  state: 'all',
  keyword: '',
};

document.addEventListener('DOMContentLoaded', () => {
  initAdminLayout({ title: t('events.heading'), lead: t('events.lead') });

  // A link from another page (for example "see the registrations") can preselect
  // a filter through the query string.
  const status = queryParam('publishStatus');
  if (status) filters.publishStatus = status;
  const keyword = queryParam('keyword');
  if (keyword) filters.keyword = keyword;

  wireFilters();
  load();
});

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */
function wireFilters() {
  const form = document.querySelector('#events-filters');
  if (!form) return;

  const statusSelect = form.querySelector('#filter-status');
  const stateSelect = form.querySelector('#filter-state');
  const keywordInput = form.querySelector('#filter-keyword');

  statusSelect.value = filters.publishStatus;
  stateSelect.value = filters.state;
  keywordInput.value = filters.keyword;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    filters.publishStatus = statusSelect.value;
    filters.state = stateSelect.value;
    filters.keyword = keywordInput.value.trim();
    syncUrl();
    load();
  });

  form.querySelector('#events-clear').addEventListener('click', () => {
    filters.publishStatus = 'all';
    filters.state = 'all';
    filters.keyword = '';
    statusSelect.value = 'all';
    stateSelect.value = 'all';
    keywordInput.value = '';
    syncUrl();
    load();
  });
}

/** Keep the address bar in step, so a filtered view can be shared or reloaded. */
function syncUrl() {
  setQueryParam('publishStatus', filters.publishStatus === 'all' ? '' : filters.publishStatus);
  setQueryParam('keyword', filters.keyword);
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */
async function load() {
  const tableHost = document.querySelector('#events-table');
  const countHost = document.querySelector('#events-count');

  showTableLoading(tableHost);

  let events;
  try {
    events = await getAdminEvents({
      limit: 100,
      state: filters.state,
      publishStatus: filters.publishStatus,
      keyword: filters.keyword,
    });
  } catch (error) {
    showApiError(tableHost, error, { title: t('error.heading') });
    countHost.textContent = '';
    return;
  }

  const list = Array.isArray(events) ? events : [];
  renderCount(countHost, list);
  renderTable(tableHost, list);
}

function renderCount(host, list) {
  host.textContent = t('events.count', { count: list.length, total: list.length });
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */
function renderTable(host, events) {
  if (events.length === 0) {
    const empty = el('div', { className: 'state state--empty' });
    empty.append(el('h3', { text: t('events.empty') }));
    host.replaceChildren(empty);
    return;
  }

  const rows = events.map((event) => {
    // Every row is deletable as far as the interface is concerned; the API is
    // what refuses, and its refusal is explained. Hiding the button would make
    // the rule invisible, which is worse for the member of staff than a clear
    // "this one is protected because ..." message.
    const del = el('button', {
      className: 'button button--small button--danger',
      text: t('events.delete'),
      attributes: { type: 'button', 'data-delete-event': String(event.eventId) },
    });
    del.addEventListener('click', () => remove(event));

    return [
      String(event.eventId),
      stackedCell(
        event.eventName,
        [event.categoryName, event.organizationName].filter(Boolean).join(' · ')
      ),
      statusPill(event),
      stackedCell(
        formatShortDate(event.dateStart),
        event.dateEnd && event.dateEnd !== event.dateStart
          ? `to ${formatShortDate(event.dateEnd)}`
          : '',
      ),
      stackedCell(event.venueName, `${event.city} ${event.state || ''}`.trim()),
      stackedCell(String(event.registrationCount || 0), `of ${event.capacity || '∞'} places`),
      String(event.ticketsSold || 0),
      actionGroup([
        el('a', {
          className: 'button button--small button--ghost',
          text: t('events.view'),
          attributes: {
            href: `../event.html?id=${encodeURIComponent(event.eventId)}`,
            target: '_blank',
            rel: 'noopener',
          },
        }),
        el('a', {
          className: 'button button--small button--outline',
          text: t('events.edit'),
          attributes: { href: `update.html?id=${encodeURIComponent(event.eventId)}` },
        }),
        del,
      ]),
    ];
  });

  const totalRegistrations = events.reduce(
    (sum, event) => sum + Number(event.registrationCount || 0),
    0
  );
  const totalTickets = events.reduce((sum, event) => sum + Number(event.ticketsSold || 0), 0);

  host.replaceChildren(
    buildTable({
      caption: t('events.heading'),
      columns: [
        { label: t('events.colId'), numeric: true },
        { label: t('events.colName') },
        { label: t('events.colStatus') },
        { label: t('events.colWhen') },
        { label: t('events.colVenue') },
        { label: t('events.colRegistrations'), numeric: true },
        { label: t('events.colTickets'), numeric: true },
        { label: t('events.colActions'), rowHeader: false },
      ],
      rows,
      // A totals row for the columns where a sum means something.
      footer: [
        t('events.heading'),
        '',
        '',
        '',
        '',
        String(totalRegistrations),
        String(totalTickets),
        '',
      ],
    })
  );
}

/** The publishing status plus the derived time state, side by side. */
function statusPill(event) {
  const wrapper = el('span', { className: 'cell-badges' });
  wrapper.append(statusBadge(event.status));
  wrapper.append(stateBadge(event.eventState));
  return wrapper;
}

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */
async function remove(event) {
  const feedback = document.querySelector('#events-feedback');

  const confirmed = await confirmAction({
    title: t('delete.title'),
    body: t('delete.body', { name: event.eventName }),
    confirmLabel: t('delete.confirm'),
  });
  if (!confirmed) return;

  try {
    await deleteEvent(event.eventId);

    // 204 means it is gone. A success banner with a link back to the list is
    // clearer than silently refreshing, because the row disappears either way.
    showBanner(feedback, t('delete.success', { name: event.eventName }), 'success');
    await load();
  } catch (error) {
    // The interesting case: a 409 because the event has registrations. The
    // message from the API names the event and the count, and conflictActions()
    // in admin.js adds the links that let staff act on it.
    showApiError(feedback, error, { title: t('delete.blockedTitle') });

    // Make the situation visible in the row itself too, so the person can see
    // which event the banner is about without scrolling back up.
    if (error instanceof ApiError && error.status === 409) {
      const button = document.querySelector(`[data-delete-event="${event.eventId}"]`);
      if (button) {
        button.disabled = true;
        button.setAttribute('title', error.message);
        button.textContent = t('delete.blockedTitle');
      }
    }

    feedback.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
