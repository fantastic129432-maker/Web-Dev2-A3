/**
 * shared/src/config/environment.model.ts
 * ---------------------------------------------------------------------------
 * The shape of an Angular environment file.
 *
 * Each application owns two files that implement this interface:
 *
 *   clientside/src/environments/environment.ts              development
 *   clientside/src/environments/environment.production.ts   built output
 *
 * `angular.json` swaps the second one in for a production build through a
 * `fileReplacements` entry, which is the standard Angular mechanism. Keeping the
 * interface here means both applications agree on what an environment contains,
 * and a missing property is a compile error rather than a runtime surprise.
 */
export interface AppEnvironment {
  /** True for a production build. Lets the UI hide developer-only hints. */
  readonly production: boolean;

  /**
   * The REST API root, WITHOUT a trailing slash. Every call in ApiService is
   * built from this one value, so pointing the site at a different API (a local
   * one, or the SCU cPanel deployment) is a change to one line.
   */
  readonly apiBaseUrl: string;

  /**
   * Absolute URL of the OTHER website in this project - the admin site as seen
   * from the client side, and the client site as seen from the admin side.
   *
   * In development the two Angular dev servers run on different ports, so this
   * is a full URL such as http://localhost:4300/ . In production both sites live
   * on the same host, so a site-absolute path such as /admin/ is correct and
   * survives any deployment path change.
   */
  readonly otherSiteUrl: string;
}
