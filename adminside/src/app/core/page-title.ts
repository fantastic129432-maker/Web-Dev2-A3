import { effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';

import { TranslationService } from '@charity/shared/i18n/translation.service';

/**
 * Set the browser tab title for an admin route, in the active language.
 *
 * WHY AN EFFECT AND NOT THE ROUTER'S OWN `title` PROPERTY
 *   A route can carry a static `title`, and that is the simplest thing that
 *   works - in one language. This application has a language switcher, so a
 *   title set once at navigation would stay English after the staff member
 *   switched to Chinese, while every other string on the page changed. Reading
 *   `i18n.t` inside an effect subscribes the title to the language signal, so
 *   both the heading and the tab title move together.
 *
 * Must be called from an injection context (a component's constructor or a field
 * initialiser); `inject` and `effect` both require one, and failing loudly there
 * is better than a title that silently never updates.
 *
 * @param headingKey - Translation key of the page heading, for example
 *   'events.heading'.
 */
export function usePageTitle(headingKey: string): void {
  const title = inject(Title);
  const i18n = inject(TranslationService);

  effect(() => {
    // "All events | Charity Events administration", the same order the archived
    // admin pages used ("<page> | Charity Events administration").
    title.setTitle(`${i18n.t(headingKey)} | ${i18n.t('admin.title')}`);
  });
}
