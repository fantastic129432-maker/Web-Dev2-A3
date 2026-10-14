/**
 * shared/src/i18n/translation.service.ts
 * ---------------------------------------------------------------------------
 * Language switching for the interface, shared by both Angular applications.
 *
 * Behaviour carried over exactly from the vanilla js/i18n.js, because it is
 * already marked and it works:
 *
 *   1. The chosen language is remembered in localStorage under ONE key that both
 *      websites share, so picking Chinese on the public site means the admin site
 *      opens in Chinese.
 *   2. A `?lang=` query parameter wins over the browser preference, so a language
 *      can be linked to directly (useful when demonstrating).
 *   3. With nothing stored, the browser's own preference is used when it names one
 *      of the four supported languages.
 *   4. A missing key falls back to English and warns in the console rather than
 *      rendering a blank label.
 *
 * What is DIFFERENT from the vanilla version
 *   The dictionary is injected through the APP_DICTIONARIES token instead of being
 *   imported. The client site and the admin site have separate dictionaries, and
 *   this service is compiled into both, so it must not assume either one. Each
 *   application provides its own in app.config.ts.
 *
 *   The active language is a signal. In Angular a signal read inside a template
 *   registers a dependency, so every `{{ i18n.t('...') }}` on the page re-renders
 *   when the language changes - no manual re-render pass, and no listeners to
 *   unsubscribe.
 */
import { DOCUMENT } from '@angular/common';
import { InjectionToken, Injectable, computed, effect, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config/app-config';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_CODES,
  SUPPORTED_LANGUAGES,
  type LanguageCode,
} from './languages';
import type { Dictionaries } from './language.model';

/**
 * The dictionary for the application being built. Provided in each app's
 * app.config.ts:
 *
 *   clientside -> provideTranslations(CLIENT_DICTIONARIES)
 *   adminside  -> provideTranslations(ADMIN_DICTIONARIES)
 */
export const APP_DICTIONARIES = new InjectionToken<Dictionaries<LanguageCode>>('APP_DICTIONARIES');

/** Values substituted into {placeholders} in a translated string. */
export type TranslationValues = Readonly<Record<string, string | number>>;

/** Quick membership test for a stored or requested code. */
function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && (LANGUAGE_CODES as readonly string[]).includes(value);
}

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly dictionaries = inject(APP_DICTIONARIES);
  private readonly document = inject(DOCUMENT);

  /** The active language. Private writable signal; `language` below is read-only. */
  private readonly current = signal<LanguageCode>(this.detectInitialLanguage());

  /** The active language code, for a switcher's selected option. */
  readonly language = this.current.asReadonly();

  /** The record describing the active language (label, htmlLang). */
  readonly languageInfo = computed(
    () => SUPPORTED_LANGUAGES.find((entry) => entry.code === this.current()) ?? SUPPORTED_LANGUAGES[0]
  );

  /** The four options, for building the switcher. */
  readonly languages = SUPPORTED_LANGUAGES;

  constructor() {
    // Keep <html lang> honest, which screen readers and the browser's own
    // hyphenation both use, and which the CSS :lang() rules can key off.
    effect(() => {
      this.document.documentElement.setAttribute('lang', this.languageInfo().htmlLang);
    });
  }

  /* ------------------------------------------------------------------ reads */

  /**
   * Translate a key for the active language.
   *
   * Declared as an arrow property for two reasons: reading `this.current()` here
   * is what makes a template update when the language changes, and the function
   * can be passed around (for example to ApiError.friendlyMessage) without losing
   * its `this`.
   */
  readonly t = (key: string, values?: TranslationValues): string => {
    return this.translate(this.current(), key, values);
  };

  /** Translate for an explicit language, ignoring the active one. */
  translate(language: LanguageCode, key: string, values?: TranslationValues): string {
    const dictionary = this.dictionaries[language] ?? {};
    let text = dictionary[key];

    if (text === undefined) {
      // English is the reference language: every key should exist there.
      text = this.dictionaries[DEFAULT_LANGUAGE]?.[key];
      if (text === undefined) {
        console.warn(`[i18n] missing key: ${key}`);
        return key;
      }
    }

    if (!values) return text;

    return text.replace(/\{(\w+)\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
    );
  }

  /* ----------------------------------------------------------------- writes */

  /**
   * Switch language: remember it and update the signal, which re-renders every
   * template that reads a translation.
   */
  set(language: string): void {
    if (!isLanguageCode(language)) {
      console.warn(`[i18n] unsupported language: ${language}`);
      return;
    }
    this.current.set(language);
    this.persist(language);
  }

  /* -------------------------------------------------------------- internals */

  /**
   * Decide the opening language: stored choice, then ?lang=, then the browser's
   * preference, then English.
   */
  private detectInitialLanguage(): LanguageCode {
    try {
      const stored = globalThis.localStorage?.getItem(APP_CONFIG.storageKeys.language);
      if (isLanguageCode(stored)) return stored;
    } catch {
      // Private browsing can block localStorage; English is a safe default.
    }

    try {
      const fromQuery = new URLSearchParams(globalThis.location?.search ?? '').get('lang');
      if (isLanguageCode(fromQuery)) return fromQuery;
    } catch {
      // No location object (a unit test): fall through to the default.
    }

    const navigatorObject = globalThis.navigator;
    const tags = navigatorObject
      ? [navigatorObject.language, ...(navigatorObject.languages ?? [])]
      : [];

    for (const tag of tags) {
      if (!tag) continue;
      const base = String(tag).toLowerCase().split('-')[0];
      if (isLanguageCode(base)) return base;
    }

    return DEFAULT_LANGUAGE;
  }

  private persist(language: LanguageCode): void {
    try {
      globalThis.localStorage?.setItem(APP_CONFIG.storageKeys.language, language);
    } catch {
      // Not fatal: the choice simply does not survive a reload.
    }
  }
}
