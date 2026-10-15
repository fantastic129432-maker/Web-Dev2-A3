/**
 * @file The supporting resources the two websites read.
 *
 * Categories, venues, the featured organisation, headline statistics and the API
 * health report.
 *
 * These are the "reference data" the admin event forms need for their dropdowns
 * (GET /api/admin/reference-data) and the numbers the home page and admin
 * dashboard display.
 */

/** An event category (Fun Run, Gala Dinner, ...) with its active event count. */
export interface Category {
  categoryId: number;
  categoryName: string;
  slug: string;
  description?: string | null;
  /** A short icon hint from the database, for example "run" or "gala". */
  icon?: string | null;
  /** How many active events use this category. Absent on the reference-data list. */
  eventCount?: number;
}

/**
 * A venue, carrying the coordinates the weather feature needs.
 *
 * The latitude/longitude pair is what makes the forecast possible: Open-Meteo is
 * asked for the weather at exactly these coordinates. "Online (Australia-wide)"
 * deliberately has none, and the event page then shows no forecast rather than a
 * wrong one.
 */
export interface Venue {
  locationId: number;
  venueName: string;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  postcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  eventCount?: number;
}

/** The charitable organisation featured on the home page. */
export interface Organization {
  organizationId: number;
  name: string;
  mission?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  city?: string | null;
  country?: string | null;
}

/** Headline counts for the home page and the admin dashboard. */
export interface EventStats {
  upcomingEvents: number;
  categories: number;
  organizations: number;
  totalRaised: number;
  activeGoal: number;
  /** Added in Assessment 3. */
  registrations: number;
  ticketsSold: number;
  defaultPageSize: number;
}

/** The three dropdown lists the admin event forms need, in one response. */
export interface ReferenceData {
  organizations: Organization[];
  categories: Category[];
  locations: Venue[];
}

/** The database half of the health report. */
export interface DatabaseHealth {
  connected: boolean | null;
  driver: string;
  database: string;
  serverVersion?: string;
  tableCount?: number;
  /** Proves the Assessment 3 registrations table exists. */
  registrationTable?: boolean;
  host?: string;
  user?: string;
  note?: string;
  /** The date the offline data source treats as "today", so demos are stable. */
  demoToday?: string;
  error?: { message: string };
}

/** GET /api/health - shown in the site footer and on the admin dashboard. */
export interface HealthReport {
  api: string;
  database: DatabaseHealth;
}
