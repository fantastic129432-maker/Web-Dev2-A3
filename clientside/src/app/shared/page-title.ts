import { Injector, inject, runInInjectionContext } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';

import { TranslationService } from '@charity/shared/i18n/translation.service';

/**
 * Set the browser tab title from a route's `data.titleKey`, in the active
 * language.
 *
 * @file The shared public-site page-title helper.
 *
 * WHY NOT THE ROUTE'S OWN `title:` STRING
 *   The router evaluates `title:` once, without the TranslationService, so a site
 *   that offers four languages would keep an English tab title after the visitor
 *   switched to Chinese or Vietnamese. Instead every route carries a translation
 *   KEY in `data.titleKey` and each page calls this once:
 *
 *       readonly title = useDocumentTitle();      // field initialiser
 *       constructor() { this.title.set(); }       // from data.titleKey
 *       ...
 *       next: (event) => this.title.set('event.detailTitle', { name: event.eventName })
 *
 *   An impure `TranslatePipe` cannot help here, because document.title is not part
 *   of any template.
 *
 * WHY THIS IS A FACTORY THAT CAPTURES AN INJECTOR RATHER THAN A PLAIN FUNCTION
 *   `inject()` only works inside an injection context - a field initialiser, a
 *   constructor body or a factory. A page has to set its title at least twice: once
 *   when it is created (from the route data) and once when the API answers, from
 *   inside an RxJS `next` callback, which is NOT an injection context. A plain
 *   function calling `inject()` therefore works the first time and throws NG0203
 *   the second.
 *
 *   `useDocumentTitle()` is called from a component field initialiser - a real
 *   injection context - so the Injector it captures is that COMPONENT's injector.
 *   `runInInjectionContext` then re-enters it for every later call, which means
 *   `inject(ActivatedRoute)` resolves to the route the component belongs to rather
 *   than to nothing. That is the whole reason the injector is captured instead of
 *   the three services: resolving ActivatedRoute eagerly at module scope would look
 *   for it in the root injector, where it does not exist.
 *
 * `snapshot` is used rather than the `data` observable because a page sets its
 * title once per state; when the route changes the router destroys and recreates
 * the component, and a fresh instance calls this again.
 */
export interface DocumentTitle {
  /**
   * Set the document title.
   *
   * @param key - Overrides `data.titleKey` when the page needs a richer key, as
   *   the event detail page does when it names the event itself. May be omitted,
   *   in which case the route's own `data.titleKey` is used.
   * @param values - Placeholders substituted into the translated title. May be
   *   omitted when the title has none.
   */
  set(key?: string, values?: Record<string, string | number>): void;
}

/**
 * Create a title setter bound to the calling component's injector.
 *
 * @returns The setter the calling page calls from its constructor and again
 *   whenever the page's own title changes.
 */
export function useDocumentTitle(): DocumentTitle {
  const injector = inject(Injector);

  return {
    set(key?: string, values?: Record<string, string | number>): void {
      runInInjectionContext(injector, () => {
        const route = inject(ActivatedRoute);
        const i18n = inject(TranslationService);
        const title = inject(Title);

        const dataKey = route.snapshot.data['titleKey'];
        const resolvedKey = key ?? (typeof dataKey === 'string' ? dataKey : '');
        if (!resolvedKey) return;

        title.setTitle(values ? i18n.t(resolvedKey, values) : i18n.t(resolvedKey));
      });
    },
  };
}
