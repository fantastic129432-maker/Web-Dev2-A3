import { Component, computed, inject } from '@angular/core';

import { TranslationService } from '@charity/shared/i18n/translation.service';
import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import { ThemeService } from '@charity/shared/theme/theme.service';

/**
 * The two settings controls that appear in the header on every page: the
 * language picker and the theme switch.
 *
 * Why a component rather than markup copied into the header?
 *   Both controls read and write a service from the shared library
 *   (TranslationService, ThemeService), so keeping them together means the
 *   header template contains navigation only and there is one place that decides
 *   how a language or theme is chosen.
 *
 * Language picker: all four supported languages, labelled with `nativeLabel`
 * ("English", "中文", "Tiếng Việt", "日本語"). A visitor who cannot read the
 * current interface language can still recognise their own, which an
 * English-only label list would not allow. A native `<select>` is used because it
 * is keyboard accessible and works on a phone without extra code.
 *
 * Theme switch: one button that CYCLES light -> dark -> system. Three states
 * cannot be expressed by a two-state switch, and a three-way radio group would
 * take far more room than the header has. The button's own text is the current
 * setting ("Theme: Dark"), so it doubles as a status indicator, and its
 * `aria-label` spells out which preference is stored - important because
 * "System" and "Light" look identical when the operating system is light.
 *
 * NO @angular/forms HERE ON PURPOSE
 *   The select writes straight through to the service with a `change` handler
 *   instead of [(ngModel)]. There is no form to submit and no validation, so a
 *   two-way binding would add a dependency for nothing.
 */
@Component({
  selector: 'app-settings-bar',
  imports: [TranslatePipe],
  templateUrl: './settings-bar.html',
  styleUrl: './settings-bar.css',
})
export class SettingsBarComponent {
  private readonly theme = inject(ThemeService);
  protected readonly i18n = inject(TranslationService);

  /** The four languages, straight from the shared language list. */
  protected readonly languages = this.i18n.languages;

  /** The active language code, so the select renders the right option. */
  protected readonly language = this.i18n.language;

  /** The stored preference ('light' | 'dark' | 'system'). */
  protected readonly preference = this.theme.theme;

  /** What is actually shown, with 'system' already resolved. */
  protected readonly resolved = this.theme.resolved;

  /** The glyph for the resolved theme: the button reads at a glance in a header. */
  protected readonly icon = computed(() => (this.resolved() === 'dark' ? '\u{1F319}' : '\u2600\uFE0F'));

  /**
   * The visible label, e.g. "Theme: Dark".
   *
   * Built here rather than in the template so the colon and spacing are not part
   * of a translation string: only the two words that need translating are.
   */
  protected readonly themeLabel = computed(
    () => `${this.i18n.t('settings.theme')}: ${this.i18n.t(this.theme.labelKey())}`
  );

  /**
   * The accessible name, which additionally names the System preference the
   * visible label cannot show: "Theme: Light (System = system)".
   */
  protected readonly themeAriaLabel = computed(
    () =>
      `${this.themeLabel()} (${this.i18n.t('settings.themeSystem')} = ` +
      `${this.i18n.t(this.theme.labelKey(this.preference()))})`
  );

  /** Switch language. Called with the <select>'s value. */
  protected setLanguage(code: string): void {
    this.i18n.set(code);
  }

  /** Advance the theme preference one step. */
  protected cycleTheme(): void {
    this.theme.cycle();
  }

  /** Exposed so the template's @if can hide the note in English. */
  protected get isEnglish(): boolean {
    return this.language() === 'en';
  }
}
