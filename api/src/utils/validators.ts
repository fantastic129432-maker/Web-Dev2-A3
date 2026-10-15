/**
 * @file Reusable parsing and validation helpers.
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

/**
 * Read a query parameter that may legitimately appear more than once.
 *
 * Express gives a single value for one occurrence and an array for several, so
 * normalising here means every caller below can treat the result as a list and
 * never has to test which shape arrived.
 *
 * @param value - The raw value from `req.query`, which may be undefined, a single value or an array.
 * @returns A list, empty when the parameter was absent.
 */
function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Split repeated and comma separated parameters into a clean list of ids.
 *
 * This is what allows the client to send either
 *   ?category=1&category=2      (repeated)
 *   ?category=1,2               (comma separated)
 *   ?category[]=1&category[]=2  (PHP style brackets)
 * and is the single reason the three forms behave identically. Duplicates are
 * collapsed and anything that is not a positive whole number is reported as a
 * problem rather than silently dropped, so a typo in a filter never widens the
 * result set.
 *
 * @param value - The raw query value in any of the three accepted forms.
 * @param fieldName - The query parameter name, used in the error message the client displays.
 * @param errors - The shared problem list that this helper appends to.
 * @returns The distinct valid ids, in the order first seen; empty when none were usable.
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

/**
 * Test whether a value is a real calendar date in `YYYY-MM-DD` form.
 *
 * The regular expression alone would accept 2026-02-31, so the value is also
 * parsed and formatted back: only a date that survives the round trip is real,
 * which is what stops an impossible date reaching the database.
 *
 * @param value - The value to test, normally a string from a query or a body.
 * @returns `true` when the value is a genuine date, `false` for anything else.
 */
export function isValidDate(value: unknown): boolean {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Test whether a value is a real clock time in `HH:MM` or `HH:MM:SS` form.
 *
 * The pattern is checked first and each component is then range checked, so
 * `25:00` is rejected where a pattern alone would let it through.
 *
 * @param value - The value to test, normally a string from a request body.
 * @returns `true` when the value is a genuine time, `false` for anything else.
 */
function isValidTime(value: unknown): boolean {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) return false;
  const [hours, minutes, seconds = '00'] = value.split(':');
  return Number(hours) < 24 && Number(minutes) < 60 && Number(seconds) < 60;
}

/**
 * Parse a positive integer and check it against a bounded range.
 *
 * The options object carries `min` (default 1), `max` (default
 * `Number.MAX_SAFE_INTEGER`) and the shared `errors` array; a value outside the
 * range is reported and `undefined` comes back so the caller can fall back to
 * its default. Fractions and non-numeric text are refused here rather than
 * being rounded, because `LIMIT 2.5` and `LIMIT 'abc'` would otherwise reach the
 * query builder.
 *
 * @param value - The raw value from a query string.
 * @param fieldName - The query parameter name, used in the error message.
 * @returns The number when it is a whole number inside the range, otherwise `undefined`.
 */
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

/**
 * Read a single trimmed string, treating an empty string as absent.
 *
 * An empty value is treated as absent rather than as a value, so a cleared
 * search box means "no keyword" instead of "keyword is empty".
 *
 * @param value - The raw value, which may be a list if the parameter was repeated.
 * @returns The trimmed text, or `undefined` when there was nothing to read.
 */
export function parseText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(Array.isArray(value) ? value[0] : value).trim();
  return text === '' ? undefined : text;
}

/**
 * Read a real calendar date out of a request body.
 *
 * This begins the Assessment 3 group of body helpers. Query strings and JSON
 * bodies arrive in different shapes, so every helper below takes the whole
 * `body` plus a shared `errors` array and reports every problem at once instead
 * of failing on the first one; the service layer turns the collected array into a
 * single HTTP 400 with a per-field list, which is what both websites display. A
 * full ISO timestamp is accepted and reduced to its date part, which is what an
 * `<input type="date">` or a Postman timestamp sends, and the options object
 * controls whether the field is mandatory (`required`, default `true`).
 *
 * @param body - The untrusted request body being validated.
 * @param field - The body field name, used in the message and as the error's field.
 * @param errors - The shared problem list that this helper appends to.
 * @returns The date in `YYYY-MM-DD` form, or `undefined` when it is absent or invalid.
 */
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

/**
 * Read a clock time out of a request body.
 *
 * A bare `HH:MM` is widened to `HH:MM:SS` because the `TIME` columns carry
 * seconds, so storing the value the client typed keeps the column's own format.
 * The options object controls whether the field is mandatory (`required`,
 * default `true`).
 *
 * @param body - The untrusted request body being validated.
 * @param field - The body field name, used in the message and as the error's field.
 * @param errors - The shared problem list that this helper appends to.
 * @returns The time in `HH:MM:SS` form, or `undefined` when it is absent or invalid.
 */
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

/**
 * Read a non-empty piece of text out of a request body.
 *
 * The options object carries `required` (default `true`), `min` (default 1) and
 * `max` (default 5000). The upper bound matches the widest `VARCHAR` in the
 * schema, so a value that would be silently truncated by the database is
 * refused here with a message the form can display.
 *
 * @param body - The untrusted request body being validated.
 * @param field - The body field name, used in the message and as the error's field.
 * @param errors - The shared problem list that this helper appends to.
 * @returns The trimmed text, or `undefined` when it is absent, blank or out of range.
 */
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

/**
 * Read a number out of a request body.
 *
 * The options object carries `required` (default `true`), `min` (default 0),
 * `max` (default `Number.MAX_SAFE_INTEGER`) and `integer` (default `true`). The
 * distinction between a whole number and a decimal exists because the schema
 * mixes `INT` columns with the decimal price columns, so one helper serves
 * both; the range check mirrors the column's own range where the caller passes
 * one.
 *
 * @param body - The untrusted request body being validated.
 * @param field - The body field name, used in the message and as the error's field.
 * @param errors - The shared problem list that this helper appends to.
 * @returns The number when it is inside the range, otherwise `undefined`.
 */
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

/**
 * Read a boolean out of a request body.
 *
 * A JSON body carries a real boolean, but an HTML form or a Postman form posts
 * the strings `true`, `false`, `1`, `0`, `yes` and `no`, so all of them are
 * accepted rather than forcing every caller to normalise first. The options
 * object carries `required` (default `false`) and `fallback`, which is returned
 * when the field is absent - the flag columns are optional, so the fallback is
 * usually the schema default.
 *
 * @param body - The untrusted request body being validated.
 * @param field - The body field name, used in the message and as the error's field.
 * @param errors - The shared problem list that this helper appends to.
 * @returns The boolean when the value was understood, the fallback when it was absent, otherwise `undefined`.
 */
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

/**
 * Read a value from a fixed list out of a request body.
 *
 * The comparison is case-insensitive and the accepted spelling is returned in
 * lower case, so `Published` from a hand-written request and the `ENUM` value in
 * the schema agree; the error message lists the allowed values, which is what the
 * admin form shows beside the field. The options object carries `required`
 * (default `true`) and `fallback`, returned when the field is absent.
 *
 * @param body - The untrusted request body being validated.
 * @param field - The body field name, used in the message and as the error's field.
 * @param allowed - The permitted values, in the order they should be listed in an error.
 * @param errors - The shared problem list that this helper appends to.
 * @returns The matching value in lower case, the fallback when absent, otherwise `undefined`.
 */
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

/**
 * Read a referential id out of a request body.
 *
 * This is `requiredNumber` with the range pinned to a positive whole number, so
 * a foreign key of 0 or a negative id is refused before the database has to
 * reject it; whether the row exists is the repository's business, checked when
 * the insert or update runs. The options object controls whether the field is
 * mandatory (`required`, default `true`).
 *
 * @param body - The untrusted request body being validated.
 * @param field - The body field name, used in the message and as the error's field.
 * @param errors - The shared problem list that this helper appends to.
 * @returns The id when it is a positive whole number, otherwise `undefined`.
 */
export function requiredId(
  body: UntrustedInput,
  field: string,
  errors: ValidationIssue[],
  { required = true }: { required?: boolean } = {}
): number | undefined {
  return requiredNumber(body, field, errors, { required, min: 1, integer: true });
}

/**
 * Read an email address out of a request body.
 *
 * The length is capped at 150 characters, matching the column and the database
 * `CHECK` constraint, and the pattern is deliberately the pragmatic
 * `something@something.something` test: it accepts every address a real user
 * types while rejecting the obvious mistakes, which is the check the form can
 * act on. The options object controls whether the field is mandatory
 * (`required`, default `true`).
 *
 * @param body - The untrusted request body being validated.
 * @param field - The body field name, used in the message and as the error's field.
 * @param errors - The shared problem list that this helper appends to.
 * @returns The address in its trimmed form, or `undefined` when it is absent or malformed.
 */
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

/**
 * Throw a single HTTP 400 carrying every collected field error.
 *
 * This is the point where the collect-then-report helpers above become a
 * response: one 400 with a per-field list, rather than the first problem only.
 * The require of `./errors` is lazy because `errors.ts` does not import this
 * module, so the cycle is avoided by loading it at throw time.
 *
 * @param errors - The collected problems; an empty list means the request was valid.
 * @param message - The summary returned alongside the field list. May be
 *   omitted, in which case a generic invalid-fields message is used.
 * @throws HttpError with status 400 when `errors` is not empty, carrying the list as `details`.
 */
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
