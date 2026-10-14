/**
 * adminside/src/app/shared/confirm-dialog/confirm-dialog.ts
 * ---------------------------------------------------------------------------
 * The "are you sure?" step in front of anything that cannot be undone: deleting
 * an event, deleting a registration.
 *
 * WHY NOT window.confirm()
 *   It is one line, but it cannot be styled, it cannot show the extra context a
 *   blocked delete needs (the event's name, how many registrations protect it),
 *   and some embedded browsers suppress it entirely. The archived admin site
 *   built its own dialog for exactly these reasons; this is that dialog expressed
 *   as a component.
 *
 * The dialog is CONTROLLED BY ITS PARENT: the page renders it only while there is
 * something to confirm, and listens to the two outputs. That keeps the
 * destructive action and the thing it destroys in one place, which is easier to
 * follow than a promise-returning helper.
 *
 * Access: role="dialog" + aria-modal, Escape cancels, focus starts on Cancel so a
 * stray Enter cannot delete anything, and clicking the backdrop cancels.
 */
import { Component, ElementRef, afterNextRender, input, output, viewChild } from '@angular/core';

import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import type { TranslationValues } from '@charity/shared/i18n/translation.service';

@Component({
  selector: 'admin-confirm-dialog',
  imports: [TranslatePipe],
  styleUrl: './confirm-dialog.css',
  templateUrl: './confirm-dialog.html',
  host: {
    // Escape closes the dialog with the safe answer. A host listener is used
    // rather than a document listener added by hand so Angular removes it with
    // the component.
    '(document:keydown.escape)': 'cancelled.emit()',
  },
})
export class ConfirmDialog {
  /** Translation keys, not text: the dialog must re-render on a language change. */
  readonly titleKey = input.required<string>();
  readonly bodyKey = input.required<string>();
  readonly bodyValues = input<TranslationValues>({});
  readonly confirmLabelKey = input.required<string>();
  readonly cancelLabelKey = input<string>('delete.cancel');

  /** True while the delete is in flight, so the button cannot be pressed twice. */
  readonly busy = input(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');

  constructor() {
    // afterNextRender, not ngOnInit: the button only exists once the view is in
    // the DOM, and focusing a detached element does nothing.
    afterNextRender(() => this.cancelButton()?.nativeElement.focus());
  }

  /** A click on the backdrop (but not inside the panel) cancels. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.cancelled.emit();
  }
}
