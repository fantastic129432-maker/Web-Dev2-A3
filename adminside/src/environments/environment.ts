import type { AppEnvironment } from '@charity/shared/config/environment.model';

/**
 * Development settings for the ADMIN-SIDE website.
 *
 * `ng serve adminside` runs this app on http://localhost:4300 and expects the
 * API on http://localhost:3000. The API's CORS middleware allows
 * http://localhost:4300 (see CORS_ORIGIN in api/.env).
 *
 * A production build replaces this file with environment.production.ts.
 */
export const environment: AppEnvironment = {
  production: false,
  apiBaseUrl: 'http://localhost:3000/api',
  otherSiteUrl: 'http://localhost:4200/',
};
