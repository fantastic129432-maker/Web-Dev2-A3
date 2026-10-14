/**
 * js/i18n.js
 * ---------------------------------------------------------------------------
 * Language switching for the interface.
 *
 * How markup is marked for translation
 *
 *   <h1 data-i18n="search.title">Search charity events</h1>
 *      -> the element's text is replaced with the translation.
 *
 *   <input data-i18n-attr="placeholder:search.cityPlaceholder">
 *      -> the named attribute is replaced. Several pairs may be listed,
 *         separated by commas:  "placeholder:a,aria-label:b"
 *
 * The English text stays in the HTML on purpose: the page is readable while
 * JavaScript loads, it is what search engines and screen readers see if the
 * script fails, and it is the fallback whenever a key is missing.
 *
 * The choice is remembered in localStorage, which the assessment brief lists as
 * an accepted technique for carrying state between pages. The whole scheme
 * degrades safely: with localStorage blocked the page simply falls back to
 * English on the next load.
 */
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  translate,
} from './translations.js';

const STORAGE_KEY = 'charity-events:language';

/** Language codes only, for quick membership tests. */
const CODES = SUPPORTED_LANGUAGES.map((language) => language.code);

/** The active language code. */
let currentLanguage = DEFAULT_LANGUAGE;

/** Callbacks invoked after a language change, so pages can re-render. */
const listeners = new Set();

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

/** Read the stored choice, falling back to the browser preference. */
function detectInitialLanguage() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && CODES.includes(stored)) return stored;
  } catch (error) {
    // Private browsing can block localStorage; English is a safe default.
  }

  // A URL parameter wins over the browser preference so a language can be
  // linked to directly, which is handy for demonstrating the feature.
  const fromQuery = new URLSearchParams(window.location.search).get('lang');
  if (fromQuery && CODES.includes(fromQuery)) return fromQuery;

  // navigator is read through window because that is the only place it is
  // guaranteed to exist: scripted environments (the test harness, for example)
  // provide window but not a global navigator.
  const navigatorObject = window.navigator;
  const browserLanguages = navigatorObject
    ? [navigatorObject.language, ...(navigatorObject.languages || [])]
    : [];

  for (const tag of browserLanguages) {
    if (!tag) continue;
    const base = String(tag).toLowerCase().split('-')[0];
    if (CODES.includes(base)) return base;
  }

  return DEFAULT_LANGUAGE;
}

function persist(language) {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch (error) {
    // Not fatal: the choice just will not survive a reload.
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** The active language code, for example "ja". */
export function getLanguage() {
  return currentLanguage;
}

/** The record describing the active language. */
export function getLanguageInfo() {
  return (
    SUPPORTED_LANGUAGES.find((language) => language.code === currentLanguage) ||
    SUPPORTED_LANGUAGES[0]
  );
}

/**
 * Translate a key for the active language.
 * @param {string} key
 * @param {object} [values] values for {placeholders}
 */
export function t(key, values) {
  return translate({ language: currentLanguage, key, values });
}

/** Run a callback whenever the language changes. Returns an unsubscribe function. */
export function onLanguageChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/* ------------------------------------------------------------------ */
/* Applying a language to the document                                 */
/* ------------------------------------------------------------------ */

/**
 * Replace every marked string in a scope.
 * @param {ParentNode} [scope] defaults to the whole document
 */
export function applyTranslations(scope = document) {
  // Plain text content.
  scope.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });

  // Attributes such as placeholder, title, aria-label and alt.
  scope.querySelectorAll('[data-i18n-attr]').forEach((element) => {
    element.dataset.i18nAttr.split(',').forEach((pair) => {
      const [attribute, key] = pair.split(':').map((part) => part.trim());
      if (attribute && key) element.setAttribute(attribute, t(key));
    });
  });

  // The <html lang> attribute matters for screen readers and for hyphenation,
  // and it is also what a browser uses when deciding how to present text.
  document.documentElement.setAttribute('lang', getLanguageInfo().htmlLang);
}

/**
 * Switch language: store it, translate the page and tell the page controllers
 * so anything they rendered themselves (event cards, results, the modal) can be
 * rebuilt.
 *
 * @param {string} language
 */
export function setLanguage(language) {
  if (!CODES.includes(language)) {
    console.warn(`[i18n] unsupported language: ${language}`);
    return;
  }

  currentLanguage = language;
  persist(language);
  applyTranslations();

  listeners.forEach((callback) => {
    try {
      callback(language);
    } catch (error) {
      console.error('[i18n] a language change listener failed:', error);
    }
  });
}

/**
 * Called by every page during start-up. Reads the remembered language, applies
 * it, and returns the code so the page can render in the right language.
 */
export function initI18n() {
  currentLanguage = detectInitialLanguage();
  applyTranslations();
  return currentLanguage;
}

/** The four options, for building the switcher. */
export function availableLanguages() {
  return SUPPORTED_LANGUAGES;
}
