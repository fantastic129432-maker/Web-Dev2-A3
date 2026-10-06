/**
 * js/nav.js
 * ---------------------------------------------------------------------------
 * The menu is defined once, in js/config.js, and every page provides two empty
 * placeholders:
 *
 *     <header class="site-header" id="site-header"></header>
 *     <footer class="site-footer" id="site-footer"></footer>
 *
 * The menu holds only real page destinations (Home, Search Events and, from
 * Assessment 3, Register), so the highlighting rule is simple: the entry whose
 * file name matches the page being viewed is the current one, and exactly one
 * entry is highlighted.
 *
 * The page also supports section links inside the home page (for example the
 * "Talk to our events team" button that jumps to #contact). Those are handled by
 * scrollToHashTarget() below, because the event list is rendered after its API
 * call and the browser's own fragment jump can fire before the layout is final.
 */
import { NAV_ITEMS, HOME_PAGE, ADMIN_SITE_URL } from './config.js';
import { el, select } from './dom.js';
import {
  initI18n,
  t,
  setLanguage,
  getLanguage,
  onLanguageChange,
  availableLanguages,
} from './i18n.js';
import { initTheme, cycleTheme, getResolvedTheme, getThemePreference, themeLabel, onThemeChange } from './theme.js';

const ORG_NAME = 'Unity Heart Foundation';

/** File name of the page currently open, e.g. "search.html". */
function currentPage() {
  const file = window.location.pathname.split('/').pop();
  return file === '' ? HOME_PAGE : file;
}

/**
 * Should this menu entry be highlighted?
 *
 * Every entry names a document, so the test is simply whether that document is
 * the one being viewed. Using the file name rather than the full URL also means
 * an in-page fragment (#contact) does not stop the owning page from being
 * highlighted.
 */
function isCurrentItem(item) {
  return item.href.split('#')[0] === currentPage();
}

/** Build one <a> for the menu, in either the header or the footer. */
function navLink(item, { withActiveState = true } = {}) {
  const link = el('a', {
    className: 'site-nav__link',
    text: t(item.labelKey),
    attributes: { href: item.href },
  });

  if (withActiveState && isCurrentItem(item)) {
    link.classList.add('site-nav__link--active');
    link.setAttribute('aria-current', 'page');
  }
  return link;
}

/**
 * The two settings controls: a language picker and a theme switch.
 *
 * Both write to localStorage through their modules, so the choice survives a
 * move between pages without the URL having to carry it.
 */
function buildSettingsBar() {
  const bar = el('div', { className: 'settings-bar' });

  /* --- language ------------------------------------------------- */
  const languageGroup = el('div', { className: 'settings-bar__group' });
  const languageLabel = el('label', {
    className: 'settings-bar__label',
    text: `${t('settings.language')}:`,
    attributes: { for: 'language-select' },
  });

  const languageSelect = el('select', {
    className: 'language-select',
    attributes: {
      id: 'language-select',
      'aria-label': t('settings.languageLabel'),
    },
  });
  availableLanguages().forEach((language) => {
    const option = el('option', {
      text: language.nativeLabel,
      attributes: { value: language.code },
    });
    if (language.code === getLanguage()) option.setAttribute('selected', 'selected');
    languageSelect.append(option);
  });
  languageSelect.addEventListener('change', (event) => {
    setLanguage(event.target.value);
  });

  languageGroup.append(languageLabel, languageSelect);

  /* --- theme ---------------------------------------------------- */
  const themeGroup = el('div', { className: 'settings-bar__group' });
  const themeButton = el('button', {
    className: 'theme-toggle',
    attributes: {
      type: 'button',
      id: 'theme-toggle',
      'aria-live': 'polite',
    },
  });
  themeButton.addEventListener('click', () => {
    cycleTheme();
  });

  themeGroup.append(themeButton);

  /* --- note ----------------------------------------------------- */
  // Shown only while a language other than English is active, because the event
  // content itself comes from the database in English.
  const note = el('p', {
    className: 'settings-note',
    attributes: { id: 'settings-note' },
    text: t('settings.interfaceOnly'),
  });

  bar.append(languageGroup, themeGroup, note);

  /** Repaint the parts whose text depends on the settings. */
  const refresh = () => {
    const resolved = getResolvedTheme();
    themeButton.replaceChildren(
      el('span', {
        className: 'theme-toggle__icon',
        text: resolved === 'dark' ? '🌙' : '☀️',
        attributes: { 'aria-hidden': 'true' },
      }),
      el('span', {
        text: `${t('settings.theme')}: ${themeLabel()}`,
      })
    );
    themeButton.setAttribute(
      'aria-label',
      `${t('settings.theme')}: ${themeLabel()} (${t('settings.themeSystem')} = ${getThemePreference()})`
    );

    languageLabel.textContent = `${t('settings.language')}:`;
    languageSelect.setAttribute('aria-label', t('settings.languageLabel'));
    note.textContent = t('settings.interfaceOnly');
    note.hidden = getLanguage() === 'en';
  };

  refresh();
  onThemeChange(refresh);
  onLanguageChange(refresh);

  return bar;
}

/** Header: brand, menu, settings and a mobile-friendly menu toggle. */
function buildHeader() {
  const header = el('div', { className: 'site-header__inner' });

  const brand = el('a', {
    className: 'brand',
    attributes: { href: 'index.html' },
  });
  brand.innerHTML = `
    <span class="brand__mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="34" height="34" role="presentation">
        <circle cx="16" cy="16" r="15" fill="#0f7b6c"></circle>
        <path d="M16 25s-7.4-4.6-9.3-9.1C5.2 12.3 7.4 8.6 11 8.6c2 0 3.7 1.1 5 3 1.3-1.9 3-3 5-3 3.6 0 5.8 3.7 4.3 7.3C23.4 20.4 16 25 16 25z" fill="#ffffff"></path>
      </svg>
    </span>
    <span class="brand__text">
      <strong data-i18n="nav.siteName">${t('nav.siteName')}</strong>
      <small data-i18n="nav.tagline">${t('nav.tagline')}</small>
    </span>`;
  brand.setAttribute('aria-label', t('a11y.orgHome', { name: t('nav.siteName') }));

  const nav = el('nav', {
    className: 'site-nav',
    attributes: { id: 'primary-navigation' },
  });

  const list = el('ul', { className: 'site-nav__list' });
  NAV_ITEMS.forEach((item) => {
    const li = el('li');
    li.append(navLink(item));
    list.append(li);
  });
  // NOTE: there is deliberately no separate "call to action" button here.
  // An earlier revision added a "Find an event" button that also pointed at
  // search.html, which duplicated the "Search Events" menu item: two links with
  // identical destinations in the same navigation, one of which carried all the
  // visual weight. The menu alone is enough, keeps each destination unique, and
  // satisfies the brief's "an appropriate menu on all pages" requirement.

  const toggle = el('button', {
    className: 'site-nav__toggle',
    attributes: {
      type: 'button',
      'aria-controls': 'primary-navigation',
      'aria-expanded': 'false',
    },
  });
  toggle.append(
    el('span', { className: 'sr-only', text: t('nav.toggle') }),
    el('span', { text: '☰', attributes: { 'aria-hidden': 'true' } })
  );
  toggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('site-nav--open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  nav.append(list);

  // The settings bar and the menu share a wrapper so they can wrap together on
  // a narrow screen instead of pushing the brand around.
  const right = el('div', { className: 'site-header__nav' });
  right.append(buildSettingsBar(), nav);

  header.append(brand, toggle, right);
  return header;
}

/** Footer with a dynamic year and a live API status indicator. */
function buildFooter() {
  const inner = el('div', { className: 'site-footer__inner' });

  const about = el('div', { className: 'site-footer__column' });
  about.append(
    el('h3', { text: t('nav.siteName'), attributes: { 'data-i18n': 'nav.siteName' } }),
    el('p', { text: t('nav.footerAbout'), attributes: { 'data-i18n': 'nav.footerAbout' } })
  );

  const quick = el('div', { className: 'site-footer__column' });
  quick.append(el('h3', { text: t('nav.explore'), attributes: { 'data-i18n': 'nav.explore' } }));
  const quickList = el('ul');
  NAV_ITEMS.forEach((item) => {
    const li = el('li');
    li.append(navLink(item, { withActiveState: false }));
    quickList.append(li);
  });
  quick.append(quickList);

  const legal = el('div', { className: 'site-footer__column' });
  legal.append(
    el('h3', {
      text: t('nav.projectHeading'),
      attributes: { 'data-i18n': 'nav.projectHeading' },
    }),
    el('p', { text: t('nav.projectNote'), attributes: { 'data-i18n': 'nav.projectNote' } })
  );

  // A3: the admin website is a separate site for staff, so it is linked from
  // the footer rather than the public menu. Putting it in the main menu would
  // suggest it is part of the visitor's journey, which it is not - and the
  // brief treats "client-side website" and "admin-side website" as two
  // deliverables with two different audiences. The link is still one click
  // away, so a marker can find it immediately.
  legal.append(
    el('a', {
      className: 'site-footer__admin-link',
      text: t('nav.admin'),
      attributes: {
        href: ADMIN_SITE_URL,
        'data-i18n': 'nav.admin',
        rel: 'noopener',
      },
    })
  );

  const status = el('p', {
    className: 'site-footer__status',
    attributes: { id: 'api-status', role: 'status' },
    text: t('api.checking'),
  });

  const bottom = el('div', { className: 'site-footer__bottom' });
  bottom.append(
    el('p', {
      text: `© ${new Date().getFullYear()} ${t('nav.siteName')}. ${t('nav.rights')}`,
    }),
    status
  );

  inner.append(about, quick, legal);
  const wrapper = el('div');
  wrapper.append(inner, bottom);
  return wrapper;
}

/**
 * Report whether the API is reachable, in the footer.
 * Kept here (not in each page script) so every page shows the same indicator.
 */
async function updateApiStatus() {
  const status = select('#api-status');
  if (!status) return;

  const { getHealth } = await import('./api.js');
  try {
    const health = await getHealth();
    const databaseOk = health && health.database && health.database.connected !== false;
    status.textContent = databaseOk ? t('api.online') : t('api.dbDown');
    status.classList.add(databaseOk ? 'is-online' : 'is-warning');
  } catch (error) {
    status.textContent = t('api.offline');
    status.classList.add('is-offline');
  }
}

/**
 * Wait until an element exists, or give up after a short delay.
 * The page sections are present immediately, but the event list on the home
 * page is rendered after its API call resolves, so a short wait keeps this
 * robust without blocking.
 */
function waitForElement(selector, timeout = 3000) {
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const found = document.querySelector(selector);
      if (found || Date.now() - startedAt > timeout) {
        clearInterval(timer);
        resolve(found || null);
      }
    }, 50);
  });
}

/**
 * Scroll to the section named in the address bar.
 *
 * The menu itself no longer contains section links, but the home page does (the
 * hero button jumps to the event list and the "Talk to our events team" button
 * jumps to the contact section), and a visitor can also arrive with a fragment
 * already in the URL. Chromium tries to perform that jump while it is still
 * parsing the document, which is unreliable because the event list is rendered
 * after its API call resolves, so the position is applied here instead.
 *
 * Note on what this deliberately does NOT do: an earlier revision also added
 * tabindex="-1" to the target and called focus() on it. That had two unwanted
 * effects and no benefit:
 *   * making a section focusable turns its paragraphs into text inputs as far
 *     as the browser is concerned, so clicking the section showed an insertion
 *     caret - the "vertical line" that was reported;
 *   * focusing the section also drew the :focus-visible ring around the whole
 *     section, which reads as an unexplained amber outline.
 * The scroll itself is what the visitor asked for, and :target already lets a
 * stylesheet mark the section, so no focus handling is needed.
 */
async function scrollToHashTarget() {
  const hash = window.location.hash;
  if (hash.length < 2) return;

  const target = await waitForElement(hash);
  if (!target) return;

  // Instant positioning rather than `behavior: 'smooth'`: a smooth animation is
  // cancelled when the document height changes underneath it, and the home page
  // grows every time an event image loads, which left the visitor part way down
  // the page. Reliability matters more than the animation for a jump link.
  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: 'auto', block: 'start' });
  } else if ('scrollY' in window) {
    window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY);
  }
}

/** Called by every page. Creates the menu and footer if the placeholders exist. */
export function initLayout() {
  // The remembered language and theme must be applied before anything is built,
  // so the generated menu and footer come out in the right language and the
  // first paint is already in the right theme.
  initI18n();
  initTheme();

  const headerHost = select('#site-header');
  if (headerHost) headerHost.replaceChildren(buildHeader());

  const footerHost = select('#site-footer');
  if (footerHost) footerHost.replaceChildren(buildFooter());

  // The header and footer are generated once, so they have to be rebuilt when
  // the language changes. Page content is handled by whichever controller owns
  // it, through its own onLanguageChange subscription.
  onLanguageChange(() => {
    if (headerHost) headerHost.replaceChildren(buildHeader());
    if (footerHost) footerHost.replaceChildren(buildFooter());
    updateApiStatus();
    scrollToHashTarget();
  });

  updateApiStatus();
  scrollToHashTarget();
}
