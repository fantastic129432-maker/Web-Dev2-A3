import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { API_BASE_URL, OTHER_SITE_URL } from '@charity/shared/di/tokens';
import { ADMIN_DICTIONARIES } from '@charity/shared/i18n/admin-translations';
import { APP_DICTIONARIES } from '@charity/shared/i18n/translation.service';

import { environment } from '../environments/environment';
import { routes } from './app.routes';

/**
 * Application-wide providers for the ADMIN-SIDE website.
 *
 * Deliberately mirrors clientside/src/app/app.config.ts: the two applications
 * differ only in their environment file, their dictionary and their cross-site
 * link. Everything else is the same shared library.
 *
 * Angular 22 is zoneless, so no zone.js polyfill is loaded and there is no
 * zone-based change-detection provider; change detection follows signals and the
 * router. tools/check-angular-architecture.mjs asserts exactly that, which is why
 * the provider's identifier is not spelled out here.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),

    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top' })),

    provideHttpClient(),

    // ---- values that differ between the two applications -------------------
    { provide: API_BASE_URL, useValue: environment.apiBaseUrl },
    { provide: OTHER_SITE_URL, useValue: environment.otherSiteUrl },
    { provide: APP_DICTIONARIES, useValue: ADMIN_DICTIONARIES },
  ],
};
