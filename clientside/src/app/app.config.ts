import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { API_BASE_URL, OTHER_SITE_URL } from '@charity/shared/di/tokens';
import { CLIENT_DICTIONARIES } from '@charity/shared/i18n/client-translations';
import { APP_DICTIONARIES } from '@charity/shared/i18n/translation.service';

import { environment } from '../environments/environment';
import { routes } from './app.routes';

/**
 * The application-wide providers, and the three values that differ from the admin
 * site.
 *
 * @file Application configuration for the CLIENT-SIDE website.
 *
 * Each application has its own app.config.ts, which is where the two sites
 * genuinely differ:
 *
 *   * which environment file supplies the API address (swapped per build by
 *     angular.json's fileReplacements),
 *   * which dictionary TranslationService translates with,
 *   * which cross-site link the header shows.
 *
 * Everything else - ApiService, WeatherService, ThemeService, the router - comes
 * from the shared library and is tree-shaken into both bundles from one source.
 *
 * Note there is no `provideZoneChangeDetection`: Angular 22 is zoneless, so
 * change detection is driven by signals (and by the router). That is also why
 * `polyfills` is empty in angular.json - zone.js is not part of the bundle.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),

    // The public site is a multi-page experience: restoring the scroll position
    // on navigation matches what a visitor expects from a normal website.
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' })),

    provideHttpClient(),

    // ---- values that differ between the two applications -------------------
    { provide: API_BASE_URL, useValue: environment.apiBaseUrl },
    { provide: OTHER_SITE_URL, useValue: environment.otherSiteUrl },
    { provide: APP_DICTIONARIES, useValue: CLIENT_DICTIONARIES },
  ],
};
