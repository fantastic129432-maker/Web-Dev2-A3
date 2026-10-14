/**
 * shared/src/di/tokens.ts
 * ---------------------------------------------------------------------------
 * The values the shared library needs but must NOT hard-code, because they
 * differ per application and per build.
 *
 * Why injection tokens instead of importing an environment file directly? The
 * shared library is compiled into BOTH applications. If it imported
 * `clientside/src/environments/environment`, the admin application would pull
 * the client's settings in with it. A token inverts that: each application
 * declares the value once in its `app.config.ts` and the shared code just asks
 * for it. It also makes the shared services trivially testable - a test provides
 * a token and never has to touch an environment file.
 */
import { InjectionToken } from '@angular/core';

/**
 * The REST API root, without a trailing slash, for example
 * `http://localhost:3000/api`. Provided from `environment.apiBaseUrl`.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');

/**
 * Absolute URL of the OTHER website in this project: the admin site as seen
 * from the client site, and the client site as seen from the admin site.
 * Provided from `environment.otherSiteUrl`.
 */
export const OTHER_SITE_URL = new InjectionToken<string>('OTHER_SITE_URL');
