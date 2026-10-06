/**
 * js/theme.js
 * ---------------------------------------------------------------------------
 * Light and dark appearance.
 *
 * Three states are offered rather than two:
 *   'light'  always light
 *   'dark'   always dark
 *   'system' follow the operating system, and keep following it if the user
 *            changes their mind while the page is open
 *
 * "System" is the default, because a visitor who has set their computer to dark
 * mode expects a website to respect that without having to ask for it.
 *
 * Implementation notes
 *   * The choice is stored in localStorage under one key. As with the language
 *     setting, the assessment brief lists localStorage as an accepted way to
 *     carry state, and everything degrades to the system preference if storage
 *     is unavailable.
 *   * The resolved theme is written to <html data-theme="dark"> and the CSS
 *     swaps a set of custom properties in one rule, so a theme change does not
 *     require touching any component style.
 *   * applyStoredThemeEarly() is called from a tiny inline script in each page's
 *     <head>, before the first paint, so a dark user never sees a white flash.
 *     The value it reads has exactly the same shape as the one written here.
 */
import { t } from './i18n.js';

const STORAGE_KEY = 'charity-events:theme';

/** The three selectable values. */
export const THEMES = ['light', 'dark', 'system'];

/** The active preference, one of THEMES. */
let preference = 'system';

/** Callbacks invoked after a change, so controls can update their labels. */
const listeners = new Set();

const darkQuery =
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

/* ------------------------------------------------------------------ */
/* Reading and writing                                                 */
/* ------------------------------------------------------------------ */

function readStoredPreference() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.includes(stored)) return stored;
  } catch (error) {
    // Storage unavailable: fall through to the system preference.
  }
  return 'system';
}

function persist(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch (error) {
    // Not fatal.
  }
}

/** Which theme is actually shown, resolving 'system'. */
export function getResolvedTheme() {
  if (preference === 'system') {
    return darkQuery && darkQuery.matches ? 'dark' : 'light';
  }
  return preference;
}

/** The stored preference: 'light', 'dark' or 'system'. */
export function getThemePreference() {
  return preference;
}

/** Write the resolved theme to the document. */
function paint() {
  const resolved = getResolvedTheme();
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-theme-preference', preference);

  // Lets the CSS style the browser's own controls (scrollbars, form fields).
  document.documentElement.style.colorScheme = resolved;
}

/** Run a callback whenever the theme changes. Returns an unsubscribe function. */
export function onThemeChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Change the preference and repaint.
 * @param {'light'|'dark'|'system'} value
 */
export function setTheme(value) {
  if (!THEMES.includes(value)) {
    console.warn(`[theme] unsupported value: ${value}`);
    return;
  }

  preference = value;
  persist(value);
  paint();

  listeners.forEach((callback) => {
    try {
      callback(value);
    } catch (error) {
      console.error('[theme] a theme change listener failed:', error);
    }
  });
}

/** Cycle light -> dark -> system, used by a compact single button. */
export function cycleTheme() {
  const order = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(preference) + 1) % order.length];
  setTheme(next);
  return next;
}

/** A translated label for the current preference. */
export function themeLabel(value = preference) {
  if (value === 'dark') return t('settings.themeDark');
  if (value === 'light') return t('settings.themeLight');
  return t('settings.themeSystem');
}

/**
 * Called by every page during start-up.
 * The stored preference is applied here as well as in the inline head script,
 * so the two cannot drift apart.
 */
export function initTheme() {
  preference = readStoredPreference();
  paint();

  // Follow the operating system while 'system' is selected.
  if (darkQuery) {
    const handleSystemChange = () => {
      if (preference === 'system') paint();
    };
    if (typeof darkQuery.addEventListener === 'function') {
      darkQuery.addEventListener('change', handleSystemChange);
    } else if (typeof darkQuery.addListener === 'function') {
      // Older Safari.
      darkQuery.addListener(handleSystemChange);
    }
  }

  return preference;
}

/**
 * The source of the inline script that prevents a white flash on load.
 *
 * Kept here, next to the code it mirrors, so a change to the storage key or the
 * attribute name cannot be made in only one place. tools/sync-theme-snippet.mjs
 * copies it into the three pages.
 */
export const EARLY_THEME_SNIPPET =
  "(function(){try{var p=localStorage.getItem('charity-events:theme')||'system';" +
  "var d=p==='dark'||(p==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);" +
  "document.documentElement.setAttribute('data-theme',d?'dark':'light');" +
  "document.documentElement.setAttribute('data-theme-preference',p);" +
  "document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();";
