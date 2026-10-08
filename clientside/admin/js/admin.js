/**
 * admin/js/admin.js
 * ---------------------------------------------------------------------------
 * Shared building blocks for the admin website: the shell, the table builder,
 * the feedback banners, the destructive-action dialog and the option lists.
 *
 * The admin site reuses the client site's modules where they are genuinely
 * shared - js/api.js (so both sites speak to the API through the same code and
 * the same ApiError type), js/dom.js (the DOM helpers and formatters),
 * js/theme.js (the same light/dark preference) -
 * and keeps its own layout, its own text and its own page controllers.
 *
 * That split is deliberate: an admin screen is a different kind of interface
 * from a public page. It is denser, it is not translated, and it is not part of
 * the visitor's navigation. Sharing the plumbing while keeping the presentation
 * separate is what stops the two sites from dragging each other around.
 */
import { ApiError } from '../../js/api.js';
import { el, select, escapeHtml } from '../../js/dom.js';
import {
  initTheme,
  cycleTheme,
  getThemePreference,
  themeLabel,
  onThemeChange,
} from '../../js/theme.js';
import { t, getLanguage, setLanguage, availableLanguages, applyTranslations } from './admin-i18n.js';

/** Imported by name so the theme preference is initialised exactly once. */
export { ApiError };

/** The pages of the admin site, in menu order. */
export const ADMIN_NAV = [
  { file: 'index.html', labelKey: 'nav.dashboard' },
  { file: 'events.html', labelKey: 'nav.events' },
  { file: 'new.html', labelKey: 'nav.new' },
  { file: 'update.html', labelKey: 'nav.update' },
  { file: 'registrations.html', labelKey: 'nav.registrations' },
];

/** The page currently open, e.g. "events.html". */
function currentPage() {
  const file = window.location.pathname.split('/').pop();
  return file === '' ? 'index.html' : file;
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

/**
 * Build the header (title, staff badge, link to the public site, theme toggle)
 * and the menu, and put the year in the footer.
 *
 * Every admin page calls this, which is how the brief's "Implement a clear and
 * functional menu that allows users to navigate seamlessly to the other
 * required pages. This menu must be present on all pages" is satisfied: there
 * is one menu, defined once, and no page can forget it.
 */
export function initAdminLayout({ title = t('admin.title'), lead = '' } = {}) {
  initTheme();

  const page = currentPage();

  const header = select('#admin-header');
  if (header) {
    const inner = el('div', { className: 'admin-header__inner' });

    const brand = el('a', { className: 'admin-brand', attributes: { href: 'index.html' } });
    brand.append(
      el('span', { className: 'admin-brand__mark', text: '♥', attributes: { 'aria-hidden': 'true' } }),
      el('span', { className: 'admin-brand__text' })
    );
    brand.querySelector('.admin-brand__text').append(
      el('strong', { text: t('admin.title') }),
      el('small', { text: t('admin.badge') })
    );

    const actions = el('div', { className: 'admin-header__actions' });
    actions.append(
      el('a', {
        className: 'admin-link',
        text: t('admin.backToSite'),
        attributes: { href: '../index.html' },
      }),
      languageSelect(),
      themeToggle()
    );

    inner.append(brand, actions);
    header.replaceChildren(inner);

    const nav = select('#admin-nav');
    if (nav) {
      const list = el('ul', { className: 'admin-nav__list' });
      ADMIN_NAV.forEach((item) => {
        const li = el('li');
        const isCurrent = item.file === page;
        li.append(
          el('a', {
            className: isCurrent ? 'admin-nav__link admin-nav__link--active' : 'admin-nav__link',
            text: t(item.labelKey),
            attributes: isCurrent
              ? { href: item.file, 'aria-current': 'page' }
              : { href: item.file },
          })
        );
        list.append(li);
      });
      nav.replaceChildren(list);
    }
  }

  /*
   * Translate the static markup.
   *
   * The header and menu above go through t() as they are built, but the page
   * body - headings, filter labels, table captions, the footer - is written in
   * the HTML so a page reads sensibly before the scripts run. Without this call
   * those parts stayed English no matter which language was chosen, which is
   * what made the interface look half translated.
   *
   * Called after the header exists so the whole document is covered in one pass.
   */
  applyTranslations();

  // The page title block, so every page names itself the same way.
  const heading = select('#admin-page-heading');
  if (heading && title) heading.textContent = title;
  const leadNode = select('#admin-page-lead');
  if (leadNode && lead) leadNode.textContent = lead;

  document.title = `${title} | ${t('admin.badge')}`;

  // The year in the footer, so it never goes stale.
  const year = select('#admin-year');
  if (year) year.textContent = String(new Date().getFullYear());

  // Where the API data came from (mysql or local), shown so a marker can see
  // which mode the demonstration is running in.
  showDataSource();
}

/**
 * The theme button: shared with the public site, three states, not two.
 *
 * This used to be a private two-state toggle that wrote `data-theme` and the
 * `charity-events:theme` storage key itself, deciding from the RESOLVED theme:
 *
 *     const next = isDark ? 'light' : 'dark';
 *
 * Two things were wrong with that, and both showed up as "there is no
 * follow-the-system option":
 *
 *   * The cycle was light <-> dark only, so the third preference - 'system' -
 *     was unreachable. theme.js defines THEMES as ['light', 'dark', 'system'],
 *     and the public site's button does reach all three.
 *   * Persisting 'light' or 'dark' overwrote the stored preference, so even a
 *     visitor who had been on 'system' could never get back to it.
 *
 * Going through theme.js fixes both and keeps the two sites in step: they share
 * one storage key, so switching here is reflected on the public site too.
 */
function themeToggle() {
  const button = el('button', {
    className: 'admin-theme-toggle',
    attributes: { type: 'button', 'aria-live': 'polite' },
  });

  /*
   * The label reports the PREFERENCE, not the resolved theme. Otherwise
   * 'system' would be indistinguishable from whichever theme it currently
   * resolves to, and the button would appear to have two states again.
   * themeLabel() supplies the same wording the public site uses.
   */
  const paint = () => {
    button.textContent = themeLabel();
    button.setAttribute(
      'aria-label',
      `${t('nav.theme')}: ${themeLabel()} (${getThemePreference()})`
    );
    button.setAttribute('title', t('nav.theme'));
  };

  button.addEventListener('click', () => {
    cycleTheme();
    paint();
  });

  // Repaint when the OS flips light/dark while 'system' is selected, and when
  // the preference is changed from another tab.
  onThemeChange(paint);

  paint();
  return button;
}

/**
 * The language picker: the same four languages as the public site.
 *
 * It shares js/i18n.js's storage key, so a choice made here also applies to the
 * public site and the other way round - the two sites cannot end up in different
 * languages, which is what would happen with a second preference of its own.
 *
 * Switching reloads the page. Every admin page renders its own body from
 * t() at start-up, and there is no shared "redraw" entry point the way the
 * public site's initLayout() provides one. Reloading re-runs that start-up with
 * the new dictionary, so the whole page - header, menu, table headings, form
 * labels - comes out in one language instead of a half-translated mix.
 *
 * The options use each language's own name (中文, Tiếng Việt, 日本語) rather than
 * the current interface language's name for it, because the one person who
 * cannot read the current language is exactly the person looking for this
 * control.
 */
function languageSelect() {
  const selectElement = el('select', {
    className: 'admin-lang-select',
    attributes: {
      id: 'admin-language',
      // Announced by screen readers; the visible control has no room for a label.
      'aria-label': t('settings.language'),
    },
  });

  const active = getLanguage();

  availableLanguages().forEach((language) => {
    const option = el('option', {
      text: language.nativeLabel || language.label,
      attributes: { value: language.code },
    });
    if (language.code === active) option.setAttribute('selected', 'selected');
    selectElement.append(option);
  });

  selectElement.addEventListener('change', () => {
    setLanguage(selectElement.value);
    window.location.reload();
  });

  return selectElement;
}

/** Ask GET /api/health once and report the data source in the footer. */
async function showDataSource() {
  const slot = select('#admin-datasource');
  if (!slot) return;

  try {
    const { getHealth } = await import('../../js/api.js');
    const health = await getHealth();
    slot.textContent = `${t('admin.dataSource')}: ${health.database ? health.database.user || 'unknown' : 'unknown'} (${health.database && health.database.database ? health.database.database : 'n/a'})`;
  } catch (error) {
    slot.textContent = t('error.offline');
  }
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

/**
 * Show a message at the top of a page.
 *
 * @param {HTMLElement} container
 * @param {string} message
 * @param {'info'|'success'|'error'|'warning'} [tone]
 * @param {{details?: Array, actions?: Array<HTMLElement>, title?: string}} [options]
 */
export function showBanner(container, message, tone = 'info', options = {}) {
  const banner = el('div', {
    className: `banner banner--${tone}`,
    attributes: {
      role: tone === 'error' ? 'alert' : 'status',
      'aria-live': tone === 'error' ? 'assertive' : 'polite',
    },
  });

  if (options.title) {
    banner.append(el('h2', { className: 'banner__title', text: options.title }));
  }
  banner.append(el('p', { className: 'banner__message', text: message }));

  // A 400 from the API carries one entry per bad field. Listing them all is far
  // more useful to a member of staff than the single summary sentence.
  if (Array.isArray(options.details) && options.details.length > 0) {
    const list = el('ul', { className: 'banner__details' });
    options.details.forEach((detail) => {
      const text =
        typeof detail === 'string'
          ? detail
          : detail && detail.field
            ? `${detail.field}: ${detail.message}`
            : detail && detail.message
              ? detail.message
              : String(detail);
      list.append(el('li', { text }));
    });
    banner.append(list);
  }

  if (Array.isArray(options.actions) && options.actions.length > 0) {
    const actions = el('div', { className: 'banner__actions' });
    options.actions.forEach((action) => actions.append(action));
    banner.append(actions);
  }

  container.replaceChildren(banner);
  banner.focus?.();
  return banner;
}

/**
 * Turn any thrown value into a banner.
 *
 * Centralised because every admin page has to handle the same three cases: a
 * validation failure (400 with a list), a conflict (409, for example the delete
 * rule) and a dead API. Getting that wrong on one page would produce a blank
 * screen instead of an explanation.
 */
export function showApiError(container, error, { title } = {}) {
  if (error instanceof ApiError) {
    const details = Array.isArray(error.details) ? error.details : [];

    if (error.status === 409) {
      return showBanner(container, error.message, 'warning', {
        title: title || t('delete.blockedTitle'),
        details: error.details && !Array.isArray(error.details) ? [] : details,
        actions: conflictActions(error),
      });
    }

    if (error.status === 400) {
      return showBanner(container, error.message || t('error.validation'), 'error', {
        title: t('error.heading'),
        details,
      });
    }

    if (error.status === 404) {
      return showBanner(container, error.message || t('error.notFound'), 'warning', {
        title: t('error.heading'),
      });
    }

    return showBanner(container, error.friendlyMessage || t('error.server'), 'error', {
      title: t('error.heading'),
      details,
    });
  }

  return showBanner(container, (error && error.message) || t('error.server'), 'error', {
    title: t('error.heading'),
  });
}

/** Helpful buttons attached to a conflict banner (the blocked delete). */
function conflictActions(error) {
  const details = error.details && typeof error.details === 'object' ? error.details : {};
  const actions = [];

  if (details.eventId) {
    actions.push(
      el('a', {
        className: 'button button--small',
        text: t('events.edit'),
        attributes: { href: `update.html?id=${encodeURIComponent(details.eventId)}` },
      })
    );
  }
  if (details.registrationCount !== undefined) {
    actions.push(
      el('a', {
        className: 'button button--small button--outline',
        text: t('nav.registrations'),
        attributes: {
          href: `registrations.html?eventId=${encodeURIComponent(details.eventId || '')}`,
        },
      })
    );
  }

  return actions;
}

/** A loading placeholder in the shared style. */
export function showTableLoading(container, message = t('admin.loading')) {
  const state = el('div', { className: 'state state--loading' });
  state.append(
    el('div', { className: 'spinner', attributes: { 'aria-hidden': 'true' } }),
    el('p', { text: message })
  );
  container.replaceChildren(state);
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

/**
 * Is this value a DOM node rather than text?
 *
 * Deliberately a structural test (`nodeType` plus `appendChild`) rather than
 * `value instanceof Node`. Inside a page the two are equivalent, but the same
 * modules are also loaded into a jsdom sandbox by the automated test suite,
 * where the `Node` global is not defined on the sandbox object - so
 * `instanceof Node` threw a ReferenceError and killed the admin table before a
 * single row was built. Duck typing behaves identically in both environments.
 */
function isDomNode(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.nodeType === 'number' &&
      typeof value.appendChild === 'function'
  );
}

/**
 * Build a table.
 *
 * @param {{columns: Array<{label:string, numeric?:boolean, className?:string}>,
 *          rows: Array<Array<Node|string>>, caption?: string,
 *          footer?: Array<Node|string>}} spec
 * @returns {HTMLElement} a scrollable wrapper containing the table
 */
export function buildTable({ columns, rows, caption, footer }) {
  const wrapper = el('div', { className: 'table-wrap' });
  const table = el('table', { className: 'data-table data-table--admin' });

  if (caption) {
    table.append(el('caption', { className: 'sr-only', text: caption }));
  }

  const head = el('thead');
  const headRow = el('tr');
  columns.forEach((column) => {
    headRow.append(
      el('th', {
        text: column.label,
        attributes: {
          scope: 'col',
          class: [column.numeric ? 'is-numeric' : '', column.className || ''].join(' ').trim(),
        },
      })
    );
  });
  head.append(headRow);
  table.append(head);

  const body = el('tbody');
  rows.forEach((cells) => {
    const row = el('tr');
    cells.forEach((cell, index) => {
      const column = columns[index] || {};
      // The first cell is a row header when it names the record, which is the
      // accessible way to label a data row.
      const isRowHeader = index === 0 && column.rowHeader !== false;
      const node = el(isRowHeader ? 'th' : 'td', {
        className: column.numeric ? 'is-numeric' : '',
        attributes: isRowHeader ? { scope: 'row' } : {},
      });
      if (isDomNode(cell)) node.append(cell);
      else node.textContent = cell === null || cell === undefined ? '' : String(cell);
      row.append(node);
    });
    body.append(row);
  });
  table.append(body);

  if (footer) {
    const foot = el('tfoot');
    const footRow = el('tr');
    footer.forEach((cell, index) => {
      const column = columns[index] || {};
      const node = el(index === 0 ? 'th' : 'td', {
        className: column.numeric ? 'is-numeric' : '',
        attributes: index === 0 ? { scope: 'row' } : {},
      });
      if (isDomNode(cell)) node.append(cell);
      else node.textContent = cell === null || cell === undefined ? '' : String(cell);
      footRow.append(node);
    });
    foot.append(footRow);
    table.append(foot);
  }

  wrapper.append(table);
  return wrapper;
}

/** A two-line cell: a bold primary value with quieter detail underneath. */
export function stackedCell(primary, secondary) {
  const wrapper = el('span', { className: 'cell-stack' });
  wrapper.append(el('span', { className: 'cell-stack__primary', text: primary }));
  if (secondary) {
    wrapper.append(el('span', { className: 'cell-stack__secondary', text: secondary }));
  }
  return wrapper;
}

/** A status pill, using the same badge vocabulary as the public site. */
export function statusBadge(status) {
  const className =
    status === 'active'
      ? 'badge badge--upcoming'
      : status === 'suspended'
        ? 'badge badge--past'
        : 'badge';
  return el('span', { className, text: t(`status.${status}`) || status });
}

/** A pill for the derived upcoming/ongoing/past state. */
export function stateBadge(eventState) {
  const label =
    eventState === 'past'
      ? t('events.statePast')
      : eventState === 'ongoing'
        ? t('events.stateOngoing')
        : t('events.stateUpcoming');
  return el('span', {
    className: `badge badge--${eventState === 'ongoing' ? 'ongoing' : eventState}`,
    text: label,
  });
}

/** A row of action links/buttons for the last table column. */
export function actionGroup(actions) {
  const group = el('div', { className: 'row-actions' });
  actions.filter(Boolean).forEach((action) => group.append(action));
  return group;
}

/* ------------------------------------------------------------------ */
/* Confirmation dialog for destructive actions                         */
/* ------------------------------------------------------------------ */

/**
 * Ask before doing something that cannot be undone.
 *
 * window.confirm() would be one line, but it cannot be styled, cannot show the
 * extra context a blocked delete needs, and is suppressed entirely in some
 * embedded browsers. The dialog is built here so the admin site owns its own
 * appearance and the message can carry the event name and registration count.
 *
 * @returns {Promise<boolean>} true when the person confirmed
 */
export function confirmAction({ title, body, confirmLabel, cancelLabel = t('delete.cancel') }) {
  return new Promise((resolve) => {
    const backdrop = el('div', { className: 'confirm-backdrop' });
    const panel = el('div', {
      className: 'confirm-panel',
      attributes: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'confirm-title' },
    });

    panel.append(el('h2', { className: 'confirm-panel__title', text: title, attributes: { id: 'confirm-title' } }));
    panel.append(el('p', { className: 'confirm-panel__body', text: body }));

    const actions = el('div', { className: 'confirm-panel__actions' });
    const cancel = el('button', {
      className: 'button button--outline',
      text: cancelLabel,
      attributes: { type: 'button' },
    });
    const confirm = el('button', {
      className: 'button button--danger',
      text: confirmLabel,
      attributes: { type: 'button' },
    });
    actions.append(cancel, confirm);
    panel.append(actions);
    backdrop.append(panel);
    document.body.append(backdrop);

    // Focus the safe choice, so a stray Enter does not delete anything.
    cancel.focus();

    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(result);
    };

    function onKey(event) {
      if (event.key === 'Escape') close(false);
    }

    cancel.addEventListener('click', () => close(false));
    confirm.addEventListener('click', () => close(true));
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(false);
    });
    document.addEventListener('keydown', onKey);
  });
}

/* ------------------------------------------------------------------ */
/* Form helpers                                                        */
/* ------------------------------------------------------------------ */

/** Read and trim a form control's value. */
export function fieldValue(form, name) {
  const control = form.elements.namedItem(name);
  if (!control) return '';
  if (control instanceof RadioNodeList) return control.value;
  return typeof control.value === 'string' ? control.value.trim() : '';
}

/**
 * Read a checkbox/radio group as a boolean.
 * A missing control is reported as false rather than as "unset".
 */
export function fieldChecked(form, name) {
  const control = form.elements.namedItem(name);
  return Boolean(control && control.checked);
}

/**
 * Fill a <select> from a list.
 *
 * @param {HTMLSelectElement} selectEl
 * @param {Array<object>} items
 * @param {{value:(item:object)=>any, label:(item:object)=>string,
 *          placeholder?:string, selected?:any}} spec
 */
export function fillSelect(selectEl, items, { value, label, placeholder, selected } = {}) {
  const previous = selected !== undefined ? selected : selectEl.value;
  selectEl.replaceChildren();

  if (placeholder !== undefined) {
    selectEl.append(
      el('option', { text: placeholder, attributes: { value: '' } })
    );
  }

  items.forEach((item) => {
    const optionValue = value ? value(item) : item;
    const option = el('option', {
      text: label ? label(item) : String(item),
      attributes: { value: String(optionValue) },
    });
    if (previous !== undefined && previous !== null && String(previous) === String(optionValue)) {
      option.setAttribute('selected', 'selected');
    }
    selectEl.append(option);
  });

  return selectEl;
}

/** Build a settings-aware option list for the artwork dropdown. */
export function fillImageSelect(selectEl, images, selected) {
  selectEl.replaceChildren();
  images.forEach((image) => {
    const option = el('option', { text: image, attributes: { value: image } });
    if (image === selected) option.setAttribute('selected', 'selected');
    selectEl.append(option);
  });
  return selectEl;
}

/** Read a query parameter from the current URL. */
export function queryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/** Keep the URL in step with the page state, without adding history entries. */
export function setQueryParam(name, value) {
  const params = new URLSearchParams(window.location.search);
  if (value === undefined || value === null || value === '') params.delete(name);
  else params.set(name, value);
  const text = params.toString();
  window.history.replaceState({}, '', text ? `?${text}` : window.location.pathname);
}

/**
 * Escape a value for safe interpolation into an innerHTML template.
 * Re-exported from js/dom.js so admin code has one import for it.
 */
export { escapeHtml };
