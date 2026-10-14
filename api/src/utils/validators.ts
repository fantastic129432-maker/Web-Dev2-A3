/**
 * src/utils/validators.ts
 * ---------------------------------------------------------------------------
 * Reusable parsing and validation helpers.
 *
 * A2 used these only for query strings. A3 adds a second group at the bottom
 * for JSON request bodies (creating and updating events, creating
 * registrations), because a write request has to check every field and report
 * all of the problems at once rather than stopping at the first one.
 *
 * Query values always arrive as strings (or arrays of strings), so every value
 * has to be parsed and checked before it reaches the database. These helpers
 * are used by the service layer, which turns a problem into an HttpError(400)
 * with a clear message the client can display next to the form field.
 *
 * Typing note
 *   The raw value a helper receives is `unknown`: it comes from a query string
 *   or a JSON body, so nothing may be assumed about it. Each helper narrows it
 *   (or records a ValidationIssue) and returns a precise type, so the service
 *   layer works with `string | undefined`, `number | undefined` and a typed
 *   `ValidationIssue[]` instead of untyped request data.
 */
'use strict';

import type { UntrustedInput, ValidationIssue } from '../types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

/** Read a query parameter that may legitimately appear more than once. */
function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Split repeated parameters and comma separated values into a clean list of
 * ids. This is what allows the client to send either
 *   ?category=1&category=2      (repeated)
 *   ?category=1,2               (comma separated)
 *   ?category[]=1&category[]=2  (PHP style brackets)
 */
export function parseIdList(
  value: unknown,
  fieldName: string,
  errors: ValidationIssue[]
): number[] {
  const raw = asArray(value)
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter((item) => item !== '');

  const ids: number[] = [];
  for (const item of raw) {
    const number = Number(item);
    if (!Number.isInteger(number) || number <= 0) {
      errors.push({
        field: fieldName,
        message: `"${item}" is not a valid ${fieldName} id.`,
      });
      continue;
    }
    if (!ids.includes(number)) ids.push(number);
  }
  return ids;
}

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-31). */
export function isValidDate(value: unknown): boolean {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidTime(value: unknown): boolean {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) return false;
  const [hours, minutes, seconds = '00'] = value.split(':');
  return Number(hours) < 24 && Number(minutes) < 60 && Number(seconds) < 60;
}

/** Parse a positive integer with a bounded range. */
export function parseInteger(
  value: unknown,
  fieldName: string,
  {
    min = 1,
    max = Number.MAX_SAFE_INTEGER,
    errors,
  }: { min?: number; max?: number; errors: ValidationIssue[] }
): number | undefined {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    errors.push({ field: fieldName, message: `"${value}" is not a whole number.` });
    return undefined;
  }
  if (number < min || number > max) {
    errors.push({
      field: fieldName,
      message: `Must be between ${min} and ${max}.`,
    });
    return undefined;
  }
  return number;
}

/** Read a single trimmed string, treating "" as absent. */
export function parseText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(Array.isArray(value) ? value[0] : value).trim();
  return text === '' ? undefined : text;
}

/* =====================================================================
 * Assessment 3 additions - validation of JSON request bodies
 * ---------------------------------------------------------------------
 * Query strings and JSON bodies arrive in different shapes, so these
 * helpers take a whole `body` object plus a shared `errors` array and
 * report every problem at once instead of failing on the first one. The
 * service layer turns the collected array into a single HTTP 400 with a
 * per-field list, which is what both websites display.
 * ===================================================================== */

/** Is `value` a real calendar date (YYYY-MM-DD)? */
export function requiredDate(
  body: UntrustedInput,
  field: string,
  errors: ValidationIssue[],
  { required = true }: { required?: boolean } = {}
): string | undefined {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) errors.push({ field, message: `${field} is required.` });
    return undefined;
  }
  const text = String(raw).trim();
  // Accept a full ISO timestamp and keep the date part, which is what an
  // <input type="date"> or a Postman timestamp sends.
  const candidate = text.length > 10 ? text.slice(0, 10) : text;
  if (!isValidDate(candidate)) {
    errors.push({ field, message: `${field} must be a date in YYYY-MM-DD format.` });
    return undefined;
  }
  return candidate;
}

/** A clock time in HH:MM or HH:MM:SS form. */
export function requiredTime(
  body: UntrustedInput,
  field: string,
  errors: ValidationIssue[],
  { required = true }: { required?: boolean } = {}
): string | undefined {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) errors.push({ field, message: `${field} is required.` });
    return undefined;
  }
  const text = String(raw).trim();
  const candidate = text.length === 5 ? `${text}:00` : text;
  if (!isValidTime(candidate)) {
    errors.push({ field, message: `${field} must be a time such as 09:30 or 09:30:00.` });
    return undefined;
  }
  return candidate;
}

/** A non-empty piece of text, optionally bounded in length. */
export function requiredText(
  body: UntrustedInput,
  field: string,
  errors: ValidationIssue[],
  {
    required = true,
    min = 1,
    max = 5000,
  }: { required?: boolean; min?: number; max?: number } = {}
): string | undefined {
  const raw = body[field];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    if (required) errors.push({ field, message: `${field} is required.` });
    return undefined;
  }
  const text = String(raw).trim();
  if (text.length < min) {
    errors.push({ field, message: `${field} must be at least ${min} characters.` });
    return undefined;
  }
  if (text.length > max) {
    errors.push({ field, message: `${field} must be ${max} characters or fewer.` });
    return undefined;
  }
  return text;
}

/** A whole number, optionally within a range. */
export function requiredNumber(
  body: UntrustedInput,
  field: string,
  errors: ValidationIssue[],
  {
    required = true,
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
    integer = true,
  }: { required?: boolean; min?: number; max?: number; integer?: boolean } = {}
): number | undefined {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) errors.push({ field, message: `${field} is required.` });
    return undefined;
  }
  const number = Number(raw);
  if (!Number.isFinite(number) || (integer && !Number.isInteger(number))) {
    errors.push({
      field,
      message: `${field} must be ${integer ? 'a whole number' : 'a number'}.`,
    });
    return undefined;
  }
  if (number < min || number > max) {
    errors.push({ field, message: `${field} must be between ${min} and ${max}.` });
    return undefined;
  }
  return number;
}

/** A boolean that also accepts "true"/"false"/1/0, as HTML forms send them. */
export function requiredBoolean(
  body: UntrustedInput,
  field: string,
  errors: ValidationIssue[],
  {
    required = false,
    fallback = undefined,
  }: { required?: boolean; fallback?: boolean } = {}
): boolean | undefined {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) errors.push({ field, message: `${field} is required.` });
    return fallback;
  }
  if (typeof raw === 'boolean') return raw;
  const text = String(raw).trim().toLowerCase();
  if (text === 'true' || text === '1' || text === 'yes') return true;
  if (text === 'false' || text === '0' || text === 'no') return false;
  errors.push({ field, message: `${field} must be true or false.` });
  return undefined;
}

/** A value from a fixed list, compared case-insensitively. */
export function requiredEnum(
  body: UntrustedInput,
  field: string,
  allowed: string[],
  errors: ValidationIssue[],
  {
    required = true,
    fallback = undefined,
  }: { required?: boolean; fallback?: string } = {}
): string | undefined {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) {
      errors.push({ field, message: `${field} is required.` });
      return undefined;
    }
    return fallback;
  }
  const text = String(raw).trim().toLowerCase();
  if (!allowed.includes(text)) {
    errors.push({
      field,
      message: `${field} must be one of: ${allowed.join(', ')}.`,
    });
    return undefined;
  }
  return text;
}

/** A referential id: a positive whole number that must exist in its table. */
export function requiredId(
  body: UntrustedInput,
  field: string,
  errors: ValidationIssue[],
  { required = true }: { required?: boolean } = {}
): number | undefined {
  return requiredNumber(body, field, errors, { required, min: 1, integer: true });
}

/** An email address that also satisfies the database CHECK constraint. */
export function requiredEmail(
  body: UntrustedInput,
  field: string,
  errors: ValidationIssue[],
  { required = true }: { required?: boolean } = {}
): string | undefined {
  const text = requiredText(body, field, errors, { required, max: 150 });
  if (text === undefined) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    errors.push({ field, message: `${field} must be a valid email address.` });
    return undefined;
  }
  return text;
}

/** Throw a single HTTP 400 carrying every field error, or return the values. */
export function throwIfInvalid(
  errors: ValidationIssue[],
  message = 'One or more fields are invalid.'
): void {
  if (errors.length > 0) {
    // Lazy require: errors.ts does not import this module, so there is no cycle.
    const { HttpError } = require('./errors') as typeof import('./errors');
    throw HttpError.badRequest(message, errors);
  }
}
