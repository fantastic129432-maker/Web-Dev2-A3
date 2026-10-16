import type { AppEnvironment } from '@charity/shared/config/environment.model';

/**
 * Development settings for the CLIENT-SIDE website.
 *
 * `ng serve clientside` runs this app on http://localhost:4200 and expects the
 * API on http://localhost:3000, so the two are separate origins in development.
 * The API's CORS middleware allows http://localhost:4200 for exactly this
 * reason (see CORS_ORIGIN in api/.env).
 *
 * A production build replaces this file with environment.production.ts.
 */
export const environment: AppEnvironment = {
  apiBaseUrl: 'http://localhost:3000/api',
  otherSiteUrl: 'http://localhost:4300/',
};
