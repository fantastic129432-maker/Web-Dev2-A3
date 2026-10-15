/**
 * @file The `t` pipe: `{{ 'nav.home' | t }}` in a template.
 *
 * WHY THE PIPE IS IMPURE
 *   A pipe marked `pure: true` (the default) is only re-evaluated when its
 *   INPUTS change. Here the input is the key, which does not change when the
 *   visitor switches language - so a pure pipe would keep rendering the old
 *   language. Marking it impure makes Angular re-run it whenever the view is
 *   checked, and because TranslationService.t reads the `language` signal, the
 *   view is checked exactly when the language changes.
 *
 *   Components may equally call `i18n.t('key')` directly from the template; both
 *   forms are reactive, and both are used in this project.
 */
import { Pipe, PipeTransform, inject } from '@angular/core';

import { TranslationService, type TranslationValues } from './translation.service';

/**
 * Render an interface string in the active language, from a template.
 *
 * The pipe exists so a template can ask for a string without reaching for the
 * service, and it is impure for the reason given in the file block above: the
 * key does not change when the language does.
 */
@Pipe({
  name: 't',
  pure: false,
})
export class TranslatePipe implements PipeTransform {
  /** The service that holds the active language and the dictionaries. */
  private readonly i18n = inject(TranslationService);

  /**
   * Translate one key for the template that renders it.
   *
   * @param key - Dictionary key, for example `nav.home`.
   * @param values - Values substituted into `{placeholders}`. May be omitted, in which case
   *   the string is returned with its placeholders untouched.
   * @returns The translation for the active language, or the key itself when no dictionary
   *   defines it.
   */
  transform(key: string, values?: TranslationValues): string {
    return this.i18n.t(key, values);
  }
}
