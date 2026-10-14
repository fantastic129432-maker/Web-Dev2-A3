/**
 * js/search.js
 * ---------------------------------------------------------------------------
 * Search events page controller.
 *
 * Required behaviour from the assessment brief, and where it happens here:
 *   * "intuitive filtering form ... date, location and event category"
 *        -> the controls live in search.html; loadFilterOptions() fills the
 *           category checkboxes and the city suggestions straight from
 *           GET /api/categories and GET /api/locations.
 *   * "allow web users to select one or multiple criteria"
 *        -> collectFilters() reads every control; categories are sent as a
 *           repeated query parameter, e.g. ?category=1&category=2
 *   * "include a Clear Filters button ... basic DOM manipulation"
 *        -> clearFilters() resets the inputs, removes the tick marks, empties
 *           the chip list and returns the results panel to its start state.
 *   * "upon submission the page must call your API endpoint"
 *        -> runSearch() -> getEvents(params) -> GET /api/events
 *   * "display the resulting list ... with a link to the detail page"
 *        -> dom.js eventCard() links every card to event.html?id=...
 *   * "display error messages to inform users using basic DOM manipulation"
 *        -> validateFilters() writes into #form-message, and api failures are
 *           rendered into the results panel with dom.js showError().
 */
import { getCategories, getLocations, getEvents } from './api.js';
import { initLayout } from './nav.js';
import {
  el,
  select,
  selectAll,
  renderEventList,
  showLoading,
  showEmpty,
  showError,
  setResultCount,
  setFieldMessage,
} from './dom.js';
import { t, onLanguageChange } from './i18n.js';

/** Kept so the chip list can show readable labels instead of raw ids. */
const lookup = {
  categories: new Map(),
  locations: new Map(),
};

/* ------------------------------------------------------------------ */
/* Startup                                                             */
/* ------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', async () => {
  initLayout();

  wireForm();
  wireSortControl();

  // Load the filter options first so the form is complete before the first
  // search runs, then honour any filters that arrived in the URL.
  await loadFilterOptions();
  applyFiltersFromUrl();
  updateActiveFilterChips();

  // The chips, the results and the messages are all built by this module, so
  // they are rebuilt when the language changes. The filter options are reloaded
  // because their count labels are generated too.
  onLanguageChange(async () => {
    await loadFilterOptions();
    updateActiveFilterChips();
    if (select('#results-list').querySelector('.event-card')) {
      runSearch();
    } else {
      select('#results-hint').textContent = t('search.resultsHint');
    }
  });
});

/* ------------------------------------------------------------------ */
/* Filter options from the API                                         */
/* ------------------------------------------------------------------ */
async function loadFilterOptions() {
  const categoryHost = select('#category-options');
  const cityList = select('#city-options');

  // Promise.all runs both requests at the same time instead of one after the
  // other, and both are awaited with a single await.
  const [categoryResult, locationResult] = await Promise.allSettled([
    getCategories(),
    getLocations(),
  ]);

  /* --- categories ------------------------------------------------- */
  if (categoryResult.status === 'fulfilled' && Array.isArray(categoryResult.value)) {
    const categories = categoryResult.value;
    categories.forEach((category) => {
      lookup.categories.set(String(category.categoryId), category.categoryName);
    });

    if (categories.length === 0) {
      categoryHost.replaceChildren(
        el('p', { className: 'field__hint', text: t('search.categoriesEmpty') })
      );
    } else {
      categoryHost.replaceChildren(
        ...categories.map((category) => {
          const label = el('label', { className: 'checkbox' });
          const checkbox = el('input', {
            attributes: {
              type: 'checkbox',
              name: 'category',
              value: String(category.categoryId),
              id: `category-${category.categoryId}`,
            },
          });
          checkbox.addEventListener('change', () => {
            updateActiveFilterChips();
            // Categories are live: toggling one re-runs the search.
            runSearch();
          });
          label.append(
            checkbox,
            el('span', { text: category.categoryName }),
            el('span', {
              className: 'checkbox__count',
              text: String(category.eventCount),
            })
          );
          return label;
        })
      );
    }
  } else {
    categoryHost.replaceChildren(
      el('p', { className: 'field__hint', text: t('search.categoriesFailed') })
    );
  }

  /* --- cities ----------------------------------------------------- */
  if (locationResult.status === 'fulfilled' && Array.isArray(locationResult.value)) {
    const cities = [...new Set(locationResult.value.map((location) => location.city))].sort();
    locationResult.value.forEach((location) => {
      lookup.locations.set(String(location.locationId), location.venueName);
    });
    cityList.replaceChildren(
      ...cities.map((city) => el('option', { attributes: { value: city } }))
    );
  }
}

/* ------------------------------------------------------------------ */
/* Reading the form                                                    */
/* ------------------------------------------------------------------ */

/**
 * Turn the current state of the form into API query parameters.
 * This is the function to walk through in the demo video: it shows which HTML
 * control feeds which API parameter.
 */
function collectFilters() {
  const from = select('#filter-from').value;
  const to = select('#filter-to').value;
  const city = select('#filter-city').value.trim();
  const keyword = select('#filter-keyword').value.trim();
  const onlyFree = select('#filter-free').checked;
  const includePast = select('#filter-include-past').checked;
  const categories = selectAll('#category-options input[name="category"]:checked').map(
    (input) => input.value
  );
  const { sort, direction } = currentSort();

  const params = {
    category: categories,
    city: city || undefined,
    from: from || undefined,
    to: to || undefined,
    keyword: keyword || undefined,
    isFree: onlyFree ? 'true' : undefined,
    state: includePast ? 'all' : 'upcoming',
    sort,
    direction,
    // A generous page size keeps the whole result set on one screen for the demo.
    limit: 60,
  };

  return params;
}

/** Read the sort dropdown, e.g. "progress-desc" -> { sort, direction }. */
function currentSort() {
  const control = select('#results-sort');
  const [sort, direction] = (control ? control.value : 'date-asc').split('-');
  return { sort, direction };
}

/* ------------------------------------------------------------------ */
/* Validation (client side, before the API is called)                  */
/* ------------------------------------------------------------------ */

/**
 * Rules the client should catch before asking the server:
 *   * both dates must be real calendar dates (the date input can be typed in),
 *   * the "to" date cannot be before the "from" date,
 *   * at least the intent of a search must exist (checked by the caller).
 * The same rules are enforced again by the API, which is the important point:
 * client-side validation improves the experience, server-side validation
 * protects the data.
 */
function validateFilters() {
  let valid = true;
  const message = select('#form-message');
  const fromField = select('#filter-from');
  const toField = select('#filter-to');

  fromField.removeAttribute('aria-invalid');
  toField.removeAttribute('aria-invalid');
  setFieldMessage(message, '');

  const from = fromField.value;
  const to = toField.value;

  const isIsoDate = (value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value);

  if (!isIsoDate(from)) {
    setFieldMessage(message, t('search.invalidFrom'));
    fromField.setAttribute('aria-invalid', 'true');
    valid = false;
  } else if (!isIsoDate(to)) {
    setFieldMessage(message, t('search.invalidTo'));
    toField.setAttribute('aria-invalid', 'true');
    valid = false;
  } else if (from && to && to < from) {
    setFieldMessage(message, t('search.reversedRange'));
    toField.setAttribute('aria-invalid', 'true');
    valid = false;
  }

  if (valid) {
    setFieldMessage(message, t('search.searching'), 'info');
  }
  return valid;
}

/* ------------------------------------------------------------------ */
/* Running the search                                                  */
/* ------------------------------------------------------------------ */
async function runSearch() {
  const container = select('#results-list');
  const countLabel = select('#results-count');
  const formMessage = select('#form-message');

  if (!validateFilters()) {
    showEmpty(container, t('search.fixFiltersTitle'), t('search.fixFiltersHint'));
    return;
  }

  const params = collectFilters();
  updateUrl(params);
  updateActiveFilterChips();

  showLoading(container, t('search.loading'));
  setResultCount(countLabel, 0, 0, 'event');
  countLabel.textContent = '';

  try {
    const events = await getEvents(params);

    if (!Array.isArray(events) || events.length === 0) {
      showEmpty(container, t('search.noResultsTitle'), t('search.noResultsHint'));
      setResultCount(countLabel, 0, 0);
      setFieldMessage(formMessage, t('search.noResultsMessage'), 'info');
      return;
    }

    renderEventList(container, events);
    setResultCount(countLabel, events.length, events.length);
    setFieldMessage(
      formMessage,
      events.length === 1
        ? t('search.eventCountOne', { count: events.length })
        : t('search.eventCountMany', { count: events.length }),
      'success'
    );
    select('#results-hint').textContent = t('search.resultsHintDone');
  } catch (error) {
    // Any failure from api.js arrives here as an ApiError, so one block of DOM
    // code can report every kind of problem.
    showError(container, error.friendlyMessage || t('error.searchFailed'), error.details);
    setFieldMessage(formMessage, error.friendlyMessage || t('error.searchFailed'), 'error');
    setResultCount(countLabel, 0, 0);
  }
}

/* ------------------------------------------------------------------ */
/* Clear Filters                                                       */
/* ------------------------------------------------------------------ */

/**
 * Reset every control in the form and return the results panel to its start
 * state. Written with direct DOM calls (not form.reset() alone) so the
 * un-ticking of each checkbox, the clearing of the chips and the reset of the
 * message are all explicit.
 */
function clearFilters() {
  selectAll('#search-form input[type="checkbox"]').forEach((input) => {
    input.checked = false;
  });
  selectAll('#search-form input[type="text"], #search-form input[type="search"], #search-form input[type="date"]').forEach(
    (input) => {
      input.value = '';
      input.removeAttribute('aria-invalid');
    }
  );
  select('#results-sort').value = 'date-asc';

  setFieldMessage(select('#form-message'), t('search.clearedTitle'), 'info');
  select('#results-count').textContent = '';
  select('#results-hint').textContent = t('search.resultsHint');

  updateActiveFilterChips();
  updateUrl({});

  // Put the results panel back to its neutral "nothing searched yet" state.
  select('#results-list').replaceChildren(emptyState());

  select('#filter-city').focus();
}

/** The neutral panel shown before the first search. */
function emptyState() {
  const wrapper = el('div', { className: 'state state--empty' });
  wrapper.append(el('h3', { text: t('search.clearedTitle') }), el('p', { text: t('search.clearedHint') }));
  return wrapper;
}

/* ------------------------------------------------------------------ */
/* Active filter chips                                                 */
/* ------------------------------------------------------------------ */
function updateActiveFilterChips() {
  const host = select('#active-filters');
  if (!host) return;

  const chips = [];

  // The dates are read from the form controls rather than from the URL, because
  // a date input only exposes a value in its own format and the URL is updated
  // as a side effect of searching.
  const from = select('#filter-from').value;
  const to = select('#filter-to').value;
  if (from || to) {
    chips.push({
      label: `${t('search.filterDates')}: ${from || '-'} - ${to || '-'}`,
      clear: () => {
        select('#filter-from').value = '';
        select('#filter-to').value = '';
      },
    });
  }

  const city = select('#filter-city').value.trim();
  if (city) {
    chips.push({
      label: `${t('search.filterLocation')}: ${city}`,
      clear: () => {
        select('#filter-city').value = '';
      },
    });
  }

  selectAll('#category-options input[name="category"]:checked').forEach((input) => {
    chips.push({
      label: `${t('search.filterCategory')}: ${lookup.categories.get(input.value) || input.value}`,
      clear: () => {
        input.checked = false;
      },
    });
  });

  if (select('#filter-free').checked) {
    chips.push({
      label: t('search.filterFree'),
      clear: () => {
        select('#filter-free').checked = false;
      },
    });
  }
  if (select('#filter-include-past').checked) {
    chips.push({
      label: t('search.filterPast'),
      clear: () => {
        select('#filter-include-past').checked = false;
      },
    });
  }
  const keyword = select('#filter-keyword').value.trim();
  if (keyword) {
    chips.push({
      label: `${t('search.filterKeyword')}: ${keyword}`,
      clear: () => {
        select('#filter-keyword').value = '';
      },
    });
  }

  if (chips.length === 0) {
    host.replaceChildren();
    return;
  }

  const label = el('span', { className: 'chip-list__label', text: t('search.activeFilters') });
  const buttons = chips.map((chip) => {
    const button = el('button', {
      className: 'filter-chip',
      attributes: { type: 'button', title: t('a11y.removeFilter', { filter: chip.label }) },
    });
    button.append(
      el('span', { text: chip.label }),
      el('span', { text: '×', attributes: { 'aria-hidden': 'true' } })
    );
    button.addEventListener('click', () => {
      chip.clear();
      updateActiveFilterChips();
      runSearch();
    });
    return button;
  });

  host.replaceChildren(label, ...buttons);
}

/* ------------------------------------------------------------------ */
/* URL synchronisation (shareable searches + browser back button)      */
/* ------------------------------------------------------------------ */
function updateUrl(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item));
      return;
    }
    query.append(key, value);
  });

  const search = query.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ''}`;
  window.history.replaceState({}, '', url);
}

/** Restore the form from the query string, then search if anything was set. */
function applyFiltersFromUrl() {
  const query = new URLSearchParams(window.location.search);
  let hasFilter = false;

  const from = query.get('from');
  if (from) {
    select('#filter-from').value = from;
    hasFilter = true;
  }
  const to = query.get('to');
  if (to) {
    select('#filter-to').value = to;
    hasFilter = true;
  }
  const city = query.get('city');
  if (city) {
    select('#filter-city').value = city;
    hasFilter = true;
  }
  const keyword = query.get('keyword');
  if (keyword) {
    select('#filter-keyword').value = keyword;
    hasFilter = true;
  }
  if (query.get('isFree') === 'true') {
    select('#filter-free').checked = true;
    hasFilter = true;
  }
  if (query.get('includePast') === 'true' || query.get('state') === 'all') {
    select('#filter-include-past').checked = true;
    hasFilter = true;
  }
  const categories = query.getAll('category');
  categories.forEach((id) => {
    const checkbox = select(`#category-options input[value="${CSS.escape(id)}"]`);
    if (checkbox) {
      checkbox.checked = true;
      hasFilter = true;
    }
  });
  const sort = query.get('sort');
  const direction = query.get('direction');
  if (sort && direction) {
    const option = `${sort}-${direction}`;
    const control = select('#results-sort');
    if (Array.from(control.options).some((o) => o.value === option)) {
      control.value = option;
    }
  }

  if (hasFilter) {
    runSearch();
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */
function wireForm() {
  const form = select('#search-form');

  form.addEventListener('submit', (event) => {
    // The form must not reload the page: the results are rendered with DOM
    // manipulation after the fetch resolves.
    event.preventDefault();
    runSearch();
  });

  select('#clear-filters').addEventListener('click', clearFilters);

  // Update the chip list while the visitor types.
  ['#filter-from', '#filter-to', '#filter-city', '#filter-keyword'].forEach((selector) => {
    select(selector).addEventListener('change', updateActiveFilterChips);
  });
  ['#filter-free', '#filter-include-past'].forEach((selector) => {
    select(selector).addEventListener('change', updateActiveFilterChips);
  });
}

function wireSortControl() {
  const control = select('#results-sort');
  if (!control) return;
  control.addEventListener('change', () => {
    // Only re-run when a search has already produced results.
    if (select('#results-list').querySelector('.event-card')) {
      runSearch();
    }
  });
}
