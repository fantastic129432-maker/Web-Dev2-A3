/**
 * js/dom.js
 * ---------------------------------------------------------------------------
 * Every function that creates or updates a piece of the page lives here, so
 * the page scripts (home.js / search.js / event.js) contain only "what should
 * happen", not "which element gets which class".
 *
 * DOM techniques demonstrated in this file:
 *   document.createElement / createTextNode, append / appendChild,
 *   classList, setAttribute, textContent, innerHTML, dataset, insertAdjacentHTML,
 *   replaceChildren, and event listeners added with addEventListener.
 *
 * Security note: all values that come from the database pass through
 * textContent or escapeHtml() before they are inserted, so event names or
 * descriptions cannot inject markup into the page.
 */
import { IMAGE_BASE_URL, FALLBACK_IMAGE } from './config.js';
import { t } from './i18n.js';

/* =========================================================================
 * Small helpers
 * ========================================================================= */

/** Escape a value so it is safe to use inside a template string. */
export function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]
  );
}

/** Shorthand for document.querySelector. */
export function select(selector, scope = document) {
  return scope.querySelector(selector);
}

/** Shorthand for document.querySelectorAll that always returns an Array. */
export function selectAll(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

/** Create an element with optional class name and text. */
export function el(tagName, { className, text, html, attributes } = {}) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  if (html !== undefined) element.innerHTML = html;
  if (attributes) {
    Object.entries(attributes).forEach(([name, value]) => {
      if (value !== undefined && value !== null) element.setAttribute(name, value);
    });
  }
  return element;
}

/* =========================================================================
 * Formatting
 * ========================================================================= */

const currency = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

const currencyWithCents = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 25000 -> "$25,000" */
export function formatCurrency(amount) {
  return currency.format(Number(amount || 0));
}

/** 45 -> "$45.00" (used for ticket prices) */
export function formatPrice(amount) {
  return currencyWithCents.format(Number(amount || 0));
}

/** '2026-10-11' -> 'Sunday 11 October 2026' */
export function formatDate(isoDate) {
  if (!isoDate) return '';
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** '2026-10-11' -> '11 Oct 2026' */
export function formatShortDate(isoDate) {
  if (!isoDate) return '';
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** '07:30:00' -> '7:30 am' */
export function formatTime(time) {
  if (!time) return '';
  const [hours, minutes] = time.split(':');
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return date
    .toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
    .toLowerCase();
}

/**
 * Turn the two stored dates into something a human can read, including
 * multi-day events such as the three-week art exhibition.
 */
export function formatDateRange(event) {
  const start = event.dateStart || event.eventDate;
  const end = event.dateEnd || start;
  if (!end || end === start) {
    return formatShortDate(start);
  }
  return `${formatShortDate(start)} - ${formatShortDate(end)}`;
}

/** A short, plain-English label for the derived event state. */
export function stateLabel(eventState) {
  const key = {
    upcoming: 'state.upcoming',
    ongoing: 'state.ongoing',
    past: 'state.past',
  }[eventState];
  return key ? t(key) : t('state.event');
}

/** Image URL for an event, falling back to a safe default. */
export function imageUrl(event) {
  const file = event && event.imageUrl ? event.imageUrl : FALLBACK_IMAGE;
  return `${IMAGE_BASE_URL}${file}`;
}

/* =========================================================================
 * Reusable pieces
 * ========================================================================= */

/** Upcoming / On now / Past badge. */
export function stateBadge(eventState) {
  return el('span', {
    className: `badge badge--${escapeHtml(eventState)}`,
    text: stateLabel(eventState),
  });
}

/** Category chip. */
export function categoryChip(categoryName, slug) {
  return el('span', {
    className: 'chip',
    text: categoryName || t('state.charityEvent'),
    attributes: slug ? { 'data-category': slug } : undefined,
  });
}

/** Price pill: "Free", "From $20.00" or "Tickets closed". */
export function pricePill(event) {
  if (event.eventState === 'past') {
    return el('span', { className: 'price price--closed', text: t('event.ticketsClosed') });
  }
  if (event.isFree) {
    return el('span', { className: 'price price--free', text: t('event.freeEntry') });
  }
  if (event.primaryPrice === null || event.primaryPrice === undefined) {
    return el('span', { className: 'price', text: t('event.seeEventPage') });
  }
  return el('span', {
    className: 'price',
    text: t('event.fromPrice', { price: formatPrice(event.primaryPrice) }),
  });
}

/**
 * Goal vs progress bar - used on the home cards and, larger, on the detail
 * page. `raisedAmount` comes from the SUM of the donations table.
 */
export function progressBar(event, { compact = false } = {}) {
  const percent = Math.max(0, Math.min(Number(event.progressPercent || 0), 100));
  const wrapper = el('div', {
    className: compact ? 'progress progress--compact' : 'progress',
  });

  const header = el('div', { className: 'progress__header' });
  header.append(
    el('span', { className: 'progress__label', text: t('event.raisedSoFar') }),
    el('span', {
      className: 'progress__percent',
      text: t('event.percentOfGoal', { percent: percent.toFixed(0) }),
    })
  );

  const track = el('div', {
    className: 'progress__track',
    attributes: {
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(percent),
      'aria-label': t('a11y.progressFor', { name: event.eventName }),
    },
  });
  const fill = el('div', { className: 'progress__fill' });
  fill.style.width = `${percent}%`;
  track.append(fill);

  const amounts = el('p', { className: 'progress__amounts' });
  // Assembled from the translated template. The amounts are formatted numbers,
  // but they are escaped anyway so the rule stays uniform.
  amounts.innerHTML = t('event.raisedOfGoal', {
    raised: `<strong>${escapeHtml(formatCurrency(event.raisedAmount))}</strong>`,
    goal: escapeHtml(formatCurrency(event.goalAmount)),
  });

  wrapper.append(header, track, amounts);

  if (!compact && event.donationCount) {
    wrapper.append(
      el('p', {
        className: 'progress__meta',
        text:
          event.donationCount === 1
            ? t('event.basedOnDonationsOne')
            : t('event.basedOnDonationsMany', { count: event.donationCount }),
      })
    );
  }

  return wrapper;
}

/**
 * One event card, used by both the home page and the search results.
 * Built with createElement so the click handler can be attached properly.
 */
export function eventCard(event) {
  const article = el('article', {
    className: `event-card event-card--${event.eventState}`,
    attributes: { 'data-event-id': String(event.eventId) },
  });

  const media = el('a', {
    className: 'event-card__media',
    attributes: {
      href: `event.html?id=${encodeURIComponent(event.eventId)}`,
      'aria-label': t('a11y.viewDetailsFor', { name: event.eventName }),
    },
  });
  const image = el('img', {
    attributes: {
      src: imageUrl(event),
      alt: t('a11y.eventIllustration', { name: event.eventName }),
      loading: 'lazy',
      width: '640',
      height: '360',
    },
  });
  media.append(image, stateBadge(event.eventState));

  const body = el('div', { className: 'event-card__body' });

  const meta = el('div', { className: 'event-card__meta' });
  meta.append(categoryChip(event.categoryName, event.categorySlug), pricePill(event));

  const title = el('h3', { className: 'event-card__title' });
  const titleLink = el('a', {
    text: event.eventName,
    attributes: { href: `event.html?id=${encodeURIComponent(event.eventId)}` },
  });
  title.append(titleLink);

  const summary = el('p', {
    className: 'event-card__summary',
    text: event.shortDescription,
  });

  const details = el('ul', { className: 'event-card__details' });
  [
    [
      t('card.when'),
      `${formatDateRange(event)}${event.startTime ? `, ${formatTime(event.startTime)}` : ''}`,
    ],
    [t('card.where'), `${event.venueName}, ${event.city} ${event.state || ''}`.trim()],
    [t('card.cause'), event.organizationName],
  ].forEach(([label, value]) => {
    const item = el('li');
    item.append(
      el('span', { className: 'event-card__label', text: label }),
      el('span', { className: 'event-card__value', text: value })
    );
    details.append(item);
  });

  const footer = el('div', { className: 'event-card__footer' });
  footer.append(
    progressBar(event, { compact: true }),
    (() => {
      /*
       * The button links to the event's own page. Registration deliberately does
       * NOT happen from a card: it is per event, so it starts from the event
       * page where the event is unambiguous.
       */
      return el('a', {
        className: 'button button--small',
        text: t('common.viewDetails'),
        attributes: {
          href: `event.html?id=${encodeURIComponent(event.eventId)}`,
          'aria-label': t('a11y.viewDetailsFor', { name: event.eventName }),
        },
      });
    })()
  );

  body.append(meta, title, summary, details, footer);
  article.append(media, body);

  return article;
}

/** Render a list of events into a container. */
export function renderEventList(container, events) {
  container.replaceChildren(...events.map((event) => eventCard(event)));
}

/* =========================================================================
 * Page feedback: loading, empty and error states
 * ========================================================================= */

/** Replace a container's content with a spinner and a message. */
export function showLoading(container, message = 'Loading events...') {
  const wrapper = el('div', { className: 'state state--loading' });
  wrapper.append(
    el('div', { className: 'spinner', attributes: { 'aria-hidden': 'true' } }),
    el('p', { text: message })
  );
  container.replaceChildren(wrapper);
}

/** Show "nothing matched" with an optional hint. */
export function showEmpty(container, title, hint) {
  const wrapper = el('div', { className: 'state state--empty' });
  wrapper.append(
    el('h3', { text: title }),
    hint ? el('p', { text: hint }) : null
  );
  container.replaceChildren(wrapper);
}

/**
 * Show an error message. Built with DOM methods so it can include the details
 * the API returned (for example, which query parameter was rejected).
 */
export function showError(container, message, details) {
  const wrapper = el('div', { className: 'state state--error', attributes: { role: 'alert' } });
  // t('error.title') rather than a literal: the key exists in all four
  // dictionaries and was simply never used, so the heading stayed English in
  // every language while the rest of the interface switched.
  wrapper.append(el('h3', { text: t('error.title') }), el('p', { text: message }));

  if (Array.isArray(details) && details.length > 0) {
    const list = el('ul', { className: 'state__details' });
    details.forEach((detail) => {
      const text =
        typeof detail === 'string'
          ? detail
          : `${detail.field ? `${detail.field}: ` : ''}${detail.message || ''}`;
      list.append(el('li', { text }));
    });
    wrapper.append(list);
  }

  container.replaceChildren(wrapper);
}

/** Small inline message used next to a form field. */
export function setFieldMessage(element, message, type = 'error') {
  if (!element) return;
  element.textContent = message || '';
  element.className = message ? `field-message field-message--${type}` : 'field-message';
}

/** Update the "N events found" style counter. */
export function setResultCount(element, count, total, noun = 'event') {
  if (!element) return;
  const shown = count === total ? `${total}` : `${count} of ${total}`;
  element.textContent = `${shown} ${noun}${total === 1 ? '' : 's'} found`;
}
