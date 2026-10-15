import { Component, computed, input } from '@angular/core';

import type { Banner } from '../../core/feedback';

/**
 * One message at the top of a page: the success confirmation after a save, the
 * warning that explains a refused delete, the list of fields the API rejected.
 *
 * WHY THIS IS A COMPONENT AND NOT A FEW LINES IN EACH PAGE
 *   Every page has to report the same three things - what happened, why, and what
 *   can be done about it - and each of them has a button or a link attached (open
 *   the new event, go to the registrations, suspend it instead). Those buttons
 *   differ per page and arrive here through <ng-content>, while the message and
 *   its explanatory list are described by the `Banner` data type
 *   (app/core/feedback.ts). The tone classes (.banner--success, --warning,
 *   --error, --info) come from the admin stylesheet.
 */
@Component({
  selector: 'admin-feedback-banner',
  styleUrl: './feedback-banner.css',
  templateUrl: './feedback-banner.html',
})
export class FeedbackBanner {
  /** The message to show. Required: a banner with nothing to say is not rendered. */
  readonly message = input.required<Banner>();

  /**
   * A failure is announced the moment it appears (role="alert"), while a success
   * is announced politely when the screen reader next pauses - the difference
   * between "you must know this now" and "here is a confirmation".
   */
  /** The ARIA role for the current tone: an error interrupts, anything else waits. */
  protected readonly role = computed(() => (this.message().tone === 'error' ? 'alert' : 'status'));

  /** The matching aria-live politeness, so the two announcements cannot disagree. */
  protected readonly live = computed(() => (this.message().tone === 'error' ? 'assertive' : 'polite'));
}
