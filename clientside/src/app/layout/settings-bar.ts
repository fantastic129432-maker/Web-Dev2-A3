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
 * take far more room than the header has. It is drawn as a single round icon
 * button - a sun while the resolved theme is light, a moon while it is dark - and
 * its `aria-label` spells out which preference is stored, which matters because
 * "System" and "Light" look identical when the operating system is light and no
 * two-state picture can tell them apart. See the markup for the full argument
 * (review item C2: it used to be an icon plus the words "Theme: Light", 130.80px
 * of the header's prime space, and it is now about 34px).
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

  /**
   * The visible label, e.g. "Theme: Dark".
   *
   * STILL NEEDED, AND NO LONGER DRAWN. Since review item C2 the button shows an
   * icon only, so nothing on screen reads this string - but the accessible name
   * below is built from it, and that name is now the ONLY description of the
   * control a screen reader gets. It stays a computed value rather than moving
   * into the template so the colon and spacing are still not part of a
   * translation string: only the two words that need translating are.
   *
   * The glyph itself is no longer produced here. It used to be an `icon` computed
   * returning an emoji, which could only pick between the two resolved themes and
   * could not be styled; the sun and moon are inline SVG in the template now, so
   * the choice that remains in TypeScript is the one the SVG cannot make for
   * itself - which label to announce. See the markup for the full reasoning.
   */
  protected readonly themeLabel = computed(
    () => `${this.i18n.t('settings.theme')}: ${this.i18n.t(this.theme.labelKey())}`
  );

  /**
   * The accessible name, and since review item C2 the button's ONLY name: the
   * label above is no longer drawn, so this string is what a screen reader reads
   * (and what a voice-control user has to say) instead of "Theme: Light". It
   * additionally names the System preference the icon cannot show, because the
   * sun and the moon have only two pictures between them for three states:
   * "Theme: Light (System = Light)".
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
