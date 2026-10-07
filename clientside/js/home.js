/**
 * js/home.js
 * ---------------------------------------------------------------------------
 * Home page controller.
 *
 * The page has four jobs:
 *   1. build the shared menu and footer                       (initLayout)
 *   2. load the next events and render the listing            (GET /api/events/upcoming)
 *   3. load the organisation details and impact figures       (GET /api/organization, GET /api/stats)
 *   4. let the visitor re-sort the listing without reloading  (GET /api/events?sort=...)
 *
 * Data flow, step by step (this is the flow to narrate in the demo video):
 *   page loads -> home.js runs -> api.js builds the URL -> fetch() returns a
 *   Promise -> the JSON envelope is unwrapped -> dom.js turns each event object
 *   into DOM nodes -> those nodes are inserted into #event-list.
 */
import { getUpcomingEvents, getStats, getOrganization } from './api.js';
import { initLayout } from './nav.js';
import {
  el,
  select,
  renderEventList,
  showLoading,
  showEmpty,
  showError,
  setResultCount,
  formatCurrency,
  formatShortDate,
  formatTime,
} from './dom.js';
import { HOME_EVENT_LIMIT } from './config.js';
import { t, onLanguageChange } from './i18n.js';

/* ------------------------------------------------------------------ */
/* 1. Startup                                                          */
/* ------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  // The menu and footer must exist before anything else is rendered.
  initLayout();

  loadEvents();
  loadOrganisation();
  loadStats();

  wireSortControl();

  // Charts, cards and counts are built by this module, so a language change has
  // to rebuild them: the static markup is re-translated by the i18n module, but
  // anything already rendered here would otherwise keep its old wording.
  onLanguageChange(() => {
    loadEvents();
    loadStats();
  });
});

/* ------------------------------------------------------------------ */
/* 2. Event listing                                                    */
/* ------------------------------------------------------------------ */

/** Read the sort dropdown and call the API accordingly. */
function currentSortParams() {
  const control = select('#home-sort');
  const [sort, direction] = (control ? control.value : 'date-asc').split('-');
  return { sort, direction };
}

async function loadEvents() {
  const container = select('#event-list');
  if (!container) return;

  showLoading(container, t('home.loadingEvents'));

  try {
    const { sort, direction } = currentSortParams();
    const events = await getUpcomingEvents({
      limit: HOME_EVENT_LIMIT,
      sort,
      direction,
    });

    if (!Array.isArray(events) || events.length === 0) {
      showEmpty(container, t('home.emptyTitle'), t('home.emptyHint'));
      setResultCount(select('#home-event-count'), 0, 0);
      renderHeroPanel([]);
      return;
    }

    renderEventList(container, events);
    setResultCount(select('#home-event-count'), events.length, events.length);
    renderHeroPanel(events.slice(0, 3));
  } catch (error) {
    showError(container, error.friendlyMessage || t('error.generic'), error.details);
    renderHeroPanel([]);
  }
}

/** The "Next events at a glance" panel in the hero. */
function renderHeroPanel(events) {
  const list = select('#hero-event-list');
  if (!list) return;

  if (events.length === 0) {
    list.replaceChildren(el('li', { text: t('home.panelEmpty') }));
    return;
  }

  list.replaceChildren(
    ...events.map((event) => {
      const item = el('li');
      const link = el('a', {
        text: event.eventName,
        attributes: { href: `event.html?id=${encodeURIComponent(event.eventId)}` },
      });
      link.style.color = '#ffffff';
      link.style.fontWeight = 'bold';

      const detail = el('div');
      detail.append(
        link,
        el('div', {
          text: `${formatShortDate(event.dateStart)} · ${formatTime(event.startTime)} · ${event.city}`,
        })
      );
      item.append(el('span', { text: '●', attributes: { 'aria-hidden': 'true' } }), detail);
      return item;
    })
  );
}

/** Allow the visitor to change the order of the listing. */
function wireSortControl() {
  const control = select('#home-sort');
  if (!control) return;
  control.addEventListener('change', loadEvents);
}

/* ------------------------------------------------------------------ */
/* 3. Organisation details                                             */
/* ------------------------------------------------------------------ */
async function loadOrganisation() {
  const mission = select('#about-mission');
  if (!mission) return;
  try {
    const organisation = await getOrganization();
    if (organisation && organisation.mission) {
      mission.textContent = organisation.mission;
    }
  } catch (error) {
    // The static mission statement already in the HTML stays visible, so the
    // page is still complete for the visitor if this call fails.
    console.warn('Organisation details could not be loaded:', error.message);
  }
}

/* ------------------------------------------------------------------ */
/* 4. Impact statistics                                                */
/* ------------------------------------------------------------------ */
async function loadStats() {
  const panel = select('#stats-panel');
  if (!panel) return;

  try {
    const stats = await getStats();

    const cards = [
      { value: String(stats.upcomingEvents), label: t('home.statUpcoming') },
      { value: String(stats.organizations), label: t('home.statPartners') },
      { value: formatCompactCurrency(stats.totalRaised), label: t('home.statRaised') },
      { value: formatCompactCurrency(stats.activeGoal), label: t('home.statGoal') },
    ];

    panel.replaceChildren(
      ...cards.map((card) => {
        const wrapper = el('div', { className: 'stat' });
        wrapper.append(
          el('div', { className: 'stat__value', text: card.value }),
          el('div', { className: 'stat__label', text: card.label })
        );
        return wrapper;
      })
    );
  } catch (error) {
    // The impact strip is a nice-to-have: if /api/stats fails the rest of the
    // page must still be usable, so the failure is reported in place.
    console.error('Statistics could not be loaded:', error);
    panel.replaceChildren(
      el('div', { className: 'stat', text: t('home.statUnavailable') })
    );
  }
}

/** Large amounts read better as "$99k" on a small statistic card. */
function formatCompactCurrency(amount) {
  const value = Number(amount || 0);
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }
  return formatCurrency(value);
}
