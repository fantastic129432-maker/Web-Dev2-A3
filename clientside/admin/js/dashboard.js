/**
 * admin/js/dashboard.js
 * ---------------------------------------------------------------------------
 * The admin landing page: the state of the event programme at a glance, plus
 * the most recent registrations.
 *
 * Everything here is derived from two API calls:
 *   GET /api/admin/events       every event, any status
 *   GET /api/registrations      every registration, newest first
 *
 * The counts are calculated in the browser from those two lists rather than
 * from a new "admin stats" endpoint, because the events list is needed on the
 * page anyway: a third request to count rows the page is already holding would
 * be wasted work, and the arithmetic is trivial.
 */
import { getAdminEvents, getRegistrations } from '../../js/api.js';
import { formatCurrency, formatShortDate } from '../../js/dom.js';
import { t } from './admin-i18n.js';
import {
  initAdminLayout,
  buildTable,
  stackedCell,
  statusBadge,
  stateBadge,
  showApiError,
  showTableLoading,
} from './admin.js';

document.addEventListener('DOMContentLoaded', () => {
  initAdminLayout({ title: t('dash.heading'), lead: t('dash.lead') });
  load();
});

async function load() {
  const statsHost = document.querySelector('#dashboard-stats');
  const recentHost = document.querySelector('#dashboard-recent');

  showTableLoading(statsHost);

  let events;
  let registrations;
  try {
    // Both lists are needed before anything can be drawn, so they are requested
    // together rather than one after the other.
    [events, registrations] = await Promise.all([
      getAdminEvents({ limit: 100, state: 'all', publishStatus: 'all' }),
      getRegistrations({ limit: 10 }),
    ]);
  } catch (error) {
    showApiError(statsHost, error, { title: t('error.heading') });
    recentHost.replaceChildren();
    return;
  }

  renderStats(statsHost, events);
  renderRecent(recentHost, registrations);
}

/** The statistic tiles. */
function renderStats(host, events) {
  const list = Array.isArray(events) ? events : [];

  const byStatus = (status) => list.filter((event) => event.status === status).length;
  const byState = (state) => list.filter((event) => event.eventState === state).length;
  const registrations = list.reduce((sum, event) => sum + Number(event.registrationCount || 0), 0);
  const tickets = list.reduce((sum, event) => sum + Number(event.ticketsSold || 0), 0);

  // The value of the tickets sold is derived from the cheapest tier, which is
  // the only price the list endpoint carries. It is labelled as an estimate so
  // nobody mistakes it for an accounting figure.
  const estimatedValue = list.reduce(
    (sum, event) => sum + Number(event.ticketsSold || 0) * Number(event.primaryPrice || 0),
    0
  );

  const grid = document.createElement('div');
  grid.className = 'admin-stats';

  [
    { value: list.length, label: t('dash.total'), tone: 'brand' },
    { value: byStatus('active'), label: t('dash.active'), tone: 'ok' },
    { value: byStatus('suspended'), label: t('dash.suspended'), tone: 'warn' },
    { value: byStatus('cancelled'), label: t('dash.cancelled'), tone: 'muted' },
  ].forEach((tile) => grid.append(statTile(tile)));

  const grid2 = document.createElement('div');
  grid2.className = 'admin-stats admin-stats--secondary';

  [
    { value: byState('upcoming') + byState('ongoing'), label: t('dash.upcoming') },
    { value: byState('past'), label: t('dash.past') },
    { value: registrations, label: t('dash.registrations') },
    { value: tickets, label: t('dash.ticketsSold') },
    { value: formatCurrency(estimatedValue), label: t('dash.ticketValue'), note: 'estimate' },
  ].forEach((tile) => grid2.append(statTile(tile)));

  const wrapper = document.createElement('div');
  wrapper.append(grid, grid2);
  host.replaceChildren(wrapper);
}

function statTile({ value, label, tone = 'plain', note }) {
  const tile = document.createElement('div');
  tile.className = `admin-stat admin-stat--${tone}`;

  const valueNode = document.createElement('span');
  valueNode.className = 'admin-stat__value';
  valueNode.textContent = String(value);

  const labelNode = document.createElement('span');
  labelNode.className = 'admin-stat__label';
  labelNode.textContent = label;

  tile.append(valueNode, labelNode);

  if (note) {
    const noteNode = document.createElement('span');
    noteNode.className = 'admin-stat__note';
    noteNode.textContent = note;
    tile.append(noteNode);
  }

  return tile;
}

/** The ten most recent registrations. */
function renderRecent(host, registrations) {
  const section = document.createElement('section');
  section.className = 'panel';

  const heading = document.createElement('h2');
  heading.textContent = t('dash.recent');
  section.append(heading);

  const list = Array.isArray(registrations) ? registrations : [];

  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = t('dash.recentEmpty');
    section.append(empty);
    host.replaceChildren(section);
    return;
  }

  section.append(
    buildTable({
      caption: t('dash.recent'),
      columns: [
        { label: t('registrations.colAttendee') },
        { label: t('registrations.colEvent') },
        { label: t('registrations.colTickets'), numeric: true },
        { label: t('registrations.colValue'), numeric: true },
        { label: t('registrations.colWhen') },
      ],
      rows: list.map((registration) => [
        stackedCell(registration.attendeeName, registration.attendeeEmail),
        registration.eventName || String(registration.eventId),
        String(registration.ticketsPurchased),
        formatCurrency(registration.totalAmount),
        formatShortDate(String(registration.registeredAt).slice(0, 10)),
      ]),
    })
  );

  host.replaceChildren(section);
}

export { statusBadge, stateBadge };
