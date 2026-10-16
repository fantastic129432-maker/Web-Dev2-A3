import type { AppEnvironment } from '@charity/shared/config/environment.model';

/**
 * Production settings for the CLIENT-SIDE website.
 *
 * Deployment on the SCU cPanel (see docs/deployment-cpanel.md):
 *   client site  https://24832481.it.scu.edu.au/                       (public_html root)
 *   admin site   https://24832481.it.scu.edu.au/admin/                 (public_html/admin)
 *   API          https://24832481.it.scu.edu.au/charity-events-api/api (Passenger app)
 *
 * The admin link is a site-absolute PATH rather than a full URL, so it keeps
 * working if the site is ever moved to a different host or subfolder.
 */
export const environment: AppEnvironment = {
  apiBaseUrl: 'https://24832481.it.scu.edu.au/charity-events-api/api',
  otherSiteUrl: '/admin/',
};
