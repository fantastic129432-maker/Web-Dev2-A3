/**
 * shared/src/theme/theme.service.ts
 * ---------------------------------------------------------------------------
 * Light and dark appearance, shared by both Angular applications.
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

/** The three selectable values. */
export const THEMES = ['light', 'dark', 'system'] as const;

export type ThemePreference = (typeof THEMES)[number];

/** What is actually shown once 'system' has been resolved. */
export type ResolvedTheme = 'light' | 'dark';

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
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
   */
  readonly resolved = computed<ResolvedTheme>(() => {
    const preference = this.preference();
    if (preference === 'system') {
      return this.systemPrefersDark() ? 'dark' : 'light';
    }
    return preference;
  });

  /** True when the user is following the operating system. */
  readonly followsSystem = computed(() => this.preference() === 'system');

  constructor() {
    // Keep following the OS while 'system' is selected.
    this.darkQuery?.addEventListener?.('change', (event) => {
      this.systemPrefersDark.set(event.matches);
    });

    // Paint whenever the RESOLVED theme changes. Reading `resolved()` here is
    // what subscribes this effect to both the stored preference and the OS.
    effect(() => {
      const resolved = this.resolved();
      const root = this.document.documentElement;
      root.setAttribute('data-theme', resolved);
      root.setAttribute('data-theme-preference', this.preference());
      // Lets the browser style its own controls (scrollbars, form fields).
      root.style.colorScheme = resolved;
    });
  }

  /** Change the preference; the effect above repaints the document. */
  set(value: string): void {
    if (!isThemePreference(value)) {
      console.warn(`[theme] unsupported value: ${value}`);
      return;
    }
    this.preference.set(value);
    this.persist(value);
  }

  /** Cycle light -> dark -> system, for a compact single button. */
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
   */
  labelKey(value: ThemePreference = this.preference()): string {
    if (value === 'dark') return 'settings.themeDark';
    if (value === 'light') return 'settings.themeLight';
    return 'settings.themeSystem';
  }

  private readStoredPreference(): ThemePreference {
    try {
      const stored = globalThis.localStorage?.getItem(APP_CONFIG.storageKeys.theme);
      if (isThemePreference(stored)) return stored;
    } catch {
      // Storage unavailable: fall through to the system preference.
    }
    return 'system';
  }

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
