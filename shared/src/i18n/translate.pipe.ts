/**
 * shared/src/i18n/translate.pipe.ts
 * ---------------------------------------------------------------------------
 * `{{ 'nav.home' | t }}` in a template.
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

@Pipe({
  name: 't',
  pure: false,
})
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(TranslationService);

  transform(key: string, values?: TranslationValues): string {
    return this.i18n.t(key, values);
  }
}
