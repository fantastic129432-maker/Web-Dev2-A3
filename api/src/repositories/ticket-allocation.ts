/**
 * @file The ticket-allocation rule, implemented once for every caller.
 *
 * Booking a ticket tier has to answer the same question in three places: the
 * event service's pre-check before a create, its check on an update, and - the
 * one that actually closes the race - the count taken inside the transaction
 * that writes the row (registration.repository.mysql.ts), where the tier row is
 * locked first. Keeping the arithmetic and the 400 in one module is what stops
 * those three answers drifting apart: the message, the status and the per-field
 * detail are byte-for-byte the same whichever path refused the request.
 *
 * The rule itself: a tier whose `quantity_available` is NULL is unlimited, which
 * is how the virtual challenge tiers are seeded, and the tickets sold are
 * derived from the event_registrations rows rather than from a stored counter,
 * so the figure can never drift away from the list the event page displays.
 *
 * The module deliberately imports nothing but the error type and the data-layer
 * type alias, so both the service layer and both repository implementations can
 * use it without creating an import cycle.
 */
'use strict';

import type { DataRecord } from '../types';
import { HttpError } from '../utils/errors';

/** One tier's allocation, as the check needs to see it. */
export interface TicketAllocation {
  /** The tier's display name, used in the message the client shows. */
  ticketName: string;
  /** How many the tier publishes, or `null` when it is unlimited. */
  quantityAvailable: number | null;
  /** How many tickets are already recorded for the tier, not counting the row being changed. */
  sold: number;
  /** How many tickets the caller is asking for. */
  requested: number;
}

/**
 * Refuse a request that would sell more tickets than the tier has left.
 *
 * Only a tier that publishes a quantity is limited, so an unlimited tier returns
 * immediately. The remaining figure is reported in the message and in the
 * field detail, because the client displays both: the sentence tells the user
 * what happened and the detail lets the form correct the quantity box.
 *
 * @param allocation - The tier, its published quantity, the tickets already sold and the number requested.
 * @throws HttpError with status 400 when the request exceeds the remaining allocation, carrying the tier name and the remaining count for the client.
 */
export function assertTicketsRemain(allocation: TicketAllocation): void {
  const { ticketName, quantityAvailable, sold, requested } = allocation;
  if (quantityAvailable === null || quantityAvailable === undefined) return;

  const remaining = Number(quantityAvailable) - Number(sold);
  if (requested <= remaining) return;

  throw HttpError.badRequest(
    remaining <= 0
      ? `"${ticketName}" is sold out.`
      : `Only ${remaining} ${remaining === 1 ? 'ticket' : 'tickets'} of "${ticketName}" remain, but ${requested} were requested.`,
    [
      {
        field: 'ticketsPurchased',
        message: `Choose ${Math.max(remaining, 0)} or fewer.`,
        remaining,
        ticketName,
      },
    ]
  );
}

/**
 * Sum the tickets a set of registrations has taken from one tier.
 *
 * The rows are the API shape both repositories publish (`ticketTypeId` and
 * `ticketsPurchased`), which is the only shape a caller outside the data layer
 * has to hand; the SQL halves count the same figure with SUM(tickets_purchased).
 * `excludeRegistrationId` is what makes this usable for an update: the row being
 * changed already accounts for its own tickets, so counting them again would
 * refuse a legitimate edit, and ignoring them is exactly the "as if this row
 * were not here" figure the check needs.
 *
 * @param rows - The registrations to sum, as either repository returns them. May be omitted, in which case nothing has been sold.
 * @param ticketTypeId - The tier to count, compared numerically because one data source stores numbers and the other strings.
 * @param excludeRegistrationId - The registration whose own tickets must not be counted. May be omitted, in which case every matching row counts.
 * @returns The number of tickets recorded against that tier.
 */
export function soldForTier(
  rows: DataRecord[] = [],
  ticketTypeId: number,
  excludeRegistrationId?: number
): number {
  return rows
    .filter((row) => Number(row.ticketTypeId) === Number(ticketTypeId))
    .filter(
      (row) =>
        excludeRegistrationId === undefined ||
        Number(row.registrationId) !== Number(excludeRegistrationId)
    )
    .reduce((sum, row) => sum + Number(row.ticketsPurchased || 0), 0);
}
