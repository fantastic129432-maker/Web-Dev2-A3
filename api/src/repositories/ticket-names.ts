/**
 * @file The ticket-tier naming rule, shared by both data sources.
 *
 * `uq_ticket_event_name` is UNIQUE (event_id, ticket_name), and the column's
 * collation is accent-insensitive as well as case-insensitive: on this machine
 * `utf8mb4_0900_ai_ci`, and on the MySQL 5.7 cPanel hosts the
 * `utf8mb4_unicode_ci` their dump documents. The database therefore treats
 * "Café" and "Cafe" as the same tier name, and refuses the second one with
 * ER_DUP_ENTRY.
 *
 * The offline twin has no unique key, so it has to state the rule itself. It
 * used to compare `name.toLowerCase()`, which folds case but not accents: a
 * create carrying both "Café" and "Cafe" succeeded offline and was rejected by
 * MySQL, so the same submission had two different answers depending on
 * DATA_SOURCE. The check now folds a name the way the collation does before it
 * compares, and it lives here so the MySQL write path can run the identical
 * check BEFORE the INSERT. Running it on both sides is what makes the 409 the
 * caller sees the same object either way - field, offending tier name and hint -
 * instead of relying on the driver's `sqlMessage` naming the index.
 *
 * WHY THE FOLD IS NOT A FULL COLLATION IMPLEMENTATION
 *   The fold applies Unicode canonical decomposition (NFD), drops the combining
 *   marks and lower-cases the result: é -> e, ñ -> n, ü -> u, ç -> c, and the
 *   case-only pair General/general -> general. It also expands the two
 *   ligatures both collations agree on (ß -> ss and œ -> oe). It deliberately
 *   does NOT fold the letters where the two collations disagree: MySQL 8.0's
 *   utf8mb4_0900_ai_ci equates ø/o, ł/l, đ/d, æ/ae and ð/d, while the 5.7 hosts'
 *   utf8mb4_unicode_ci does not. Folding those here would reject a submission
 *   the live 5.7 database accepts, which is the wrong direction to be wrong in;
 *   leaving them unfolded means the 8.0 database remains the final authority for
 *   those letters and answers its own 409 through translateMysqlError. The
 *   comparison this module makes is therefore exactly the part both collations
 *   share, and the residual difference is recorded rather than hidden.
 */
'use strict';

import type { DataRecord } from '../types';
import { HttpError } from '../utils/errors';

/**
 * Fold one tier name to the form the collation compares.
 *
 * @param name - The tier name as submitted, already trimmed by the validator.
 * @returns The case- and accent-folded key two names are compared by.
 */
export function comparableTicketName(name: unknown): string {
  return String(name)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/œ/g, 'oe');
}

/**
 * Refuse two ticket tiers of one event that share a name.
 *
 * The comparison is `comparableTicketName`, so the pair the database's
 * accent-insensitive collation would refuse is refused here first, with the
 * same field-level detail the caller gets when the database is the one that
 * notices. The name reported is the one that clashed (the later of the two),
 * because that is the one a form can highlight.
 *
 * @param ticketTypes - The validated tiers about to be written. May be omitted, in which case there is nothing to check.
 * @throws HttpError with status 409 when two tiers share a name under the collation's rules.
 */
export function assertUniqueTicketTypeNames(ticketTypes?: DataRecord[]): void {
  if (!Array.isArray(ticketTypes)) return;

  const seen = new Set<string>();

  for (const ticket of ticketTypes) {
    const name = String(ticket.ticketName);
    const key = comparableTicketName(name);
    if (seen.has(key)) {
      throw HttpError.conflict('A record with these details already exists.', {
        field: 'ticketTypes',
        ticketName: name,
        hint: 'Two ticket types of one event cannot share a name; rename one of them.',
      });
    }
    seen.add(key);
  }
}
