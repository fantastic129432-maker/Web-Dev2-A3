/**
 * admin/js/registrations.js
 * ---------------------------------------------------------------------------
 * The registration list: who registered, for which event, how many tickets, and
 * when.
 *
 * The brief says endpoints for registration are optional, so this page is
 * optional too. It earns its place for a practical reason: it is where the
 * data-integrity rule becomes workable. An event with registrations cannot be
 * deleted, so staff who genuinely need to remove one have to be able to see and
 * manage the registrations first - otherwise the rule is a dead end rather than
 * a safeguard.
 *
 * Data comes from GET /api/registrations, which supports ?eventId, ?email,
 * ?keyword, ?limit and ?offset, plus GET /api/admin/events for the filter list.
 */
import { getRegistrations, getAdminEvents, deleteRegistration } from '../../js/api.js';
import { el, formatCurrency } from '../../js/dom.js';
import { t } from './admin-i18n.js';
import {
  initAdminLayout,
  buildTable,
  stackedCell,
  actionGroup,
  showBanner,
  showApiError,
  showTableLoading,
  fillSelect,
  confirmAction,
  queryParam,
  setQueryParam,
} from './admin.js';

const filters = {
  eventId: '',
  keyword: '',
};

document.addEventListener('DOMContentLoaded', () => {
  initAdminLayout({ title: t('registrations.heading'), lead: t('registrations.lead') });

  // Another page can pre-filter the list, for example the blocked-delete banner.
  const eventId = queryParam('eventId');
  if (eventId) filters.eventId = eventId;

  wireFilters();
  load();
});

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */
async function wireFilters() {
  const form = document.querySelector('#registrations-filters');
  if (!form) return;

  const eventSelect = form.querySelector('#filter-event');
  const keywordInput = form.querySelector('#filter-keyword');
  keywordInput.value = filters.keyword;

  // The event filter needs the event list, which is fetched separately so a slow
  // event request cannot hold up the registrations themselves.
  try {
    const events = await getAdminEvents({ limit: 100, state: 'all', publishStatus: 'all' });
    fillSelect(eventSelect, (events || []).slice().sort((a, b) => b.eventId - a.eventId), {
      value: (item) => item.eventId,
      label: (item) => `#${item.eventId} · ${item.eventName}`,
      placeholder: t('registrations.filterAll'),
      selected: filters.eventId,
    });
  } catch (error) {
    // Leave the placeholder option in place; the list below still works.
    console.warn('[admin] could not load the event filter list:', error.message);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    filters.eventId = eventSelect.value;
    filters.keyword = keywordInput.value.trim();
    syncUrl();
    load();
  });

  form.querySelector('#registrations-clear').addEventListener('click', () => {
    filters.eventId = '';
    filters.keyword = '';
    eventSelect.value = '';
    keywordInput.value = '';
    syncUrl();
    load();
  });
}

function syncUrl() {
  setQueryParam('eventId', filters.eventId);
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */
async function load() {
  const tableHost = document.querySelector('#registrations-table');
  const countHost = document.querySelector('#registrations-count');

  showTableLoading(tableHost);

  let result;
  try {
    result = await getRegistrations({
      limit: 100,
      eventId: filters.eventId || undefined,
      keyword: filters.keyword || undefined,
    });
  } catch (error) {
    showApiError(tableHost, error, { title: t('error.heading') });
    countHost.textContent = '';
    return;
  }

  const list = Array.isArray(result) ? result : [];
  countHost.textContent = t('registrations.count', { count: list.length, total: list.length });
  renderTable(tableHost, list);
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */
function renderTable(host, registrations) {
  if (registrations.length === 0) {
    const empty = el('div', { className: 'state state--empty' });
    empty.append(el('h3', { text: t('registrations.empty') }));
    host.replaceChildren(empty);
    return;
  }

  const rows = registrations.map((registration) => {
    const remove = el('button', {
      className: 'button button--small button--danger',
      text: t('registrations.delete'),
      attributes: { type: 'button' },
    });
    remove.addEventListener('click', () => removeOne(registration));

    return [
      String(registration.registrationId),
      stackedCell(
        registration.attendeeName,
        [registration.attendeeEmail, registration.attendeePhone].filter(Boolean).join(' · ')
      ),
      stackedCell(
        registration.eventName || `#${registration.eventId}`,
        registration.ticketName || '-'
      ),
      String(registration.ticketsPurchased),
      formatCurrency(registration.totalAmount),
      String(registration.registeredAt),
      actionGroup([
        el('a', {
          className: 'button button--small button--outline',
          text: t('events.edit'),
          attributes: { href: `update.html?id=${encodeURIComponent(registration.eventId)}` },
        }),
        remove,
      ]),
    ];
  });

  const totalTickets = registrations.reduce(
    (sum, row) => sum + Number(row.ticketsPurchased || 0),
    0
  );
  const totalValue = registrations.reduce(
    (sum, row) => sum + Number(row.totalAmount || 0),
    0
  );

  host.replaceChildren(
    buildTable({
      caption: t('registrations.heading'),
      columns: [
        { label: t('registrations.colId'), numeric: true },
        { label: t('registrations.colAttendee') },
        { label: t('registrations.colEvent') },
        { label: t('registrations.colTickets'), numeric: true },
        { label: t('registrations.colValue'), numeric: true },
        { label: t('registrations.colWhen') },
        { label: t('registrations.colActions'), rowHeader: false },
      ],
      rows,
      footer: [
        t('registrations.totalTickets'),
        '',
        '',
        String(totalTickets),
        formatCurrency(totalValue),
        '',
        '',
      ],
    })
  );
}

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */
async function removeOne(registration) {
  const feedback = document.querySelector('#registrations-feedback');

  const confirmed = await confirmAction({
    title: t('registrations.deleteTitle'),
    body: t('registrations.deleteBody', { name: registration.attendeeName }),
    confirmLabel: t('registrations.delete'),
  });
  if (!confirmed) return;

  try {
    await deleteRegistration(registration.registrationId);
    showBanner(feedback, t('registrations.deleted'), 'success', {
      title: `${registration.attendeeName} · ${registration.eventName || registration.eventId}`,
    });
    await load();
  } catch (error) {
    showApiError(feedback, error, { title: t('error.heading') });
  }
}
