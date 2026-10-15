/**
 * @file Light and dark appearance, shared by both Angular applications.
 *
 * Three states, not two - carried over from the vanilla js/theme.js:
 *   'light'  always light
 *   'dark'   always dark
 *   'system' follow the operating system, and keep following it if the user
 *            changes their mind while the page is open
 *
 * "System" is the default, because a visitor who has set their computer to dark
 * mode expects a website to respect that without being asked.
 *
 * How it reaches the CSS
 *   The resolved theme is written to `<html data-theme="dark">` plus
 *   `color-scheme`, and styles.css swaps a set of custom properties in one rule.
 *   A theme change therefore costs one attribute write and never touches a
 *   component's styles.
 *
 * The white-flash problem
 *   A theme applied by Angular only after bootstrap means a dark-mode visitor
 *   sees a white flash first. Both index.html files therefore run a tiny inline
 *   script in <head>, before the first paint, reading the SAME localStorage key
 *   and writing the SAME attributes. EARLY_THEME_SNIPPET below is the source of
 *   that script, kept next to the code it mirrors so the two cannot drift apart.
 */
import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config/app-config';

/** The three selectable values, in the order a cycling button walks them. */
export const THEMES = ['light', 'dark', 'system'] as const;

/** One of the three values the theme control can store. */
export type ThemePreference = (typeof THEMES)[number];

/** What is actually shown once 'system' has been resolved. */
export type ResolvedTheme = 'light' | 'dark';

/**
 * Narrow an unknown stored or requested value to a theme preference.
 *
 * Written as a type guard so a value read back from localStorage can be checked
 * and narrowed in one step, instead of being cast to the union and trusted.
 */
function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/**
 * Resolve the visitor's light or dark preference and keep the document in step.
 *
 * The preference is stored, the resolved theme is written to the `<html>`
 * element, and 'system' keeps following the operating system, so a visitor who
 * changes their mind mid-session sees the page follow without a reload.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** The document whose attributes carry the resolved theme. */
  private readonly document = inject(DOCUMENT);

  /** The operating system's preference, or null where matchMedia is unavailable. */
  private readonly darkQuery: MediaQueryList | null =
    this.document.defaultView?.matchMedia?.('(prefers-color-scheme: dark)') ?? null;

  /** Live copy of the OS preference, so 'system' keeps following it. */
  private readonly systemPrefersDark = signal(this.darkQuery?.matches ?? false);

  /** The stored preference. */
  private readonly preference = signal<ThemePreference>(this.readStoredPreference());

  /** The stored preference, for a three-way control's selected option. */
  readonly theme = this.preference.asReadonly();

  /**
   * Which theme is actually shown, resolving 'system'.
   *
   * The preference is read into a local first so TypeScript can narrow away
   * 'system' and know the remaining branches are 'light' | 'dark'.
   *
   * A preference of 'system' is what "following the operating system" means
   * here: the visitor has chosen neither light nor dark, so the theme on screen
   * is the OS's current preference, and it keeps following the OS for as long as
   * the page is open because `systemPrefersDark` changes with it. This resolved
   * value is what the effect writes to the document, so a caller that only wants
   * to know which theme is showing reads it here.
   */
  readonly resolved = computed<ResolvedTheme>(() => {
    const preference = this.preference();
    if (preference === 'system') {
      return this.systemPrefersDark() ? 'dark' : 'light';
    }
    return preference;
  });

  /**
   * Start following the operating system, and paint the current theme.
   *
   * The listener keeps 'system' live; the effect repaints whenever the RESOLVED
   * theme changes, which is what subscribes it to both the stored preference and
   * the OS.
   */
  constructor() {
    // Keep following the OS while 'system' is selected.
    this.darkQuery?.addEventListener?.('change', (event) => {
      this.systemPrefersDark.set(event.matches);
    });

    // Reading `resolved()` here is what subscribes this effect to both sources.
    effect(() => {
      const resolved = this.resolved();
      const root = this.document.documentElement;
      root.setAttribute('data-theme', resolved);
      root.setAttribute('data-theme-preference', this.preference());
      // Lets the browser style its own controls (scrollbars, form fields).
      root.style.colorScheme = resolved;
    });
  }

  /**
   * Change the preference, and remember it for the next visit.
   *
   * An unsupported value is warned about and ignored rather than stored, so the
   * signal and localStorage can never disagree about what is allowed.
   *
   * @param value - One of 'light', 'dark' or 'system', straight from a control.
   */
  set(value: string): void {
    if (!isThemePreference(value)) {
      console.warn(`[theme] unsupported value: ${value}`);
      return;
    }
    this.preference.set(value);
    this.persist(value);
  }

  /**
   * Step the preference on by one, wrapping system back to light.
   *
   * A separate method from `set` because a compact single-button control needs
   * the next value rather than a value the visitor already chose.
   *
   * @returns The preference that is now active, so a button can label itself.
   */
  cycle(): ThemePreference {
    const order: ThemePreference[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(this.preference()) + 1) % order.length];
    this.set(next);
    return next;
  }

  /**
   * The translation key describing a preference.
   *
   * A key, not translated text, so the caller renders it in the active language
   * and the label follows the language switcher.
   *
   * @param value - Preference to describe. May be omitted, in which case the active
   *   preference is described.
   * @returns The i18n key for that preference, never the text itself.
   */
  labelKey(value: ThemePreference = this.preference()): string {
    if (value === 'dark') return 'settings.themeDark';
    if (value === 'light') return 'settings.themeLight';
    return 'settings.themeSystem';
  }

  /**
   * The preference stored by a previous visit, or 'system'.
   *
   * System is the fallback because a visitor who has set their computer to dark
   * mode expects the site to respect that, and because it is what the inline
   * <head> script already assumed before Angular loaded.
   */
  private readStoredPreference(): ThemePreference {
    try {
      const stored = globalThis.localStorage?.getItem(APP_CONFIG.storageKeys.theme);
      if (isThemePreference(stored)) return stored;
    } catch {
      // Storage unavailable: fall through to the system preference.
    }
    return 'system';
  }

  /** Remember the choice under the theme key both websites share. */
  private persist(value: ThemePreference): void {
    try {
      globalThis.localStorage?.setItem(APP_CONFIG.storageKeys.theme, value);
    } catch {
      // Not fatal.
    }
  }
}

/**
 * The inline <head> script that applies the stored theme before the first paint.
 *
 * Pasted into clientside/src/index.html and adminside/src/index.html.
 * tools/check-angular-architecture.mjs verifies that both pages still carry it,
 * so a change to the storage key or the attribute name cannot be made in only
 * one place.
 */
export const EARLY_THEME_SNIPPET =
  "(function(){try{var p=localStorage.getItem('charity-events:theme')||'system';" +
  "var d=p==='dark'||(p==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);" +
  "document.documentElement.setAttribute('data-theme',d?'dark':'light');" +
  "document.documentElement.setAttribute('data-theme-preference',p);" +
  "document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();";
