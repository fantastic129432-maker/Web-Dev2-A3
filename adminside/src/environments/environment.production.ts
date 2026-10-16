import type { AppEnvironment } from '@charity/shared/config/environment.model';

/**
 * Production settings for the ADMIN-SIDE website.
 *
 * The admin site is built with `baseHref: /admin/` (see angular.json), so it is
 * served from https://24832481.it.scu.edu.au/admin/ and its own assets resolve
 * under that path. The link back to the public website is therefore the site
 * root.
 */
export const environment: AppEnvironment = {
  apiBaseUrl: 'https://24832481.it.scu.edu.au/charity-events-api/api',
  otherSiteUrl: '/',
};
