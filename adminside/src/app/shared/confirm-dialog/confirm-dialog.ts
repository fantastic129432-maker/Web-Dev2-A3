import {
  Component,
  DestroyRef,
  DOCUMENT,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

import { TranslatePipe } from '@charity/shared/i18n/translate.pipe';
import type { TranslationValues } from '@charity/shared/i18n/translation.service';

/**
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
 * stray Enter cannot delete anything, Tab is kept inside the panel (aria-modal is a
 * claim that the page behind is covered, and onKeydown is what makes it true), and
 * clicking the backdrop cancels. The element that opened the dialog gets the focus
 * back when it closes, so a cancelled delete leaves the keyboard where it was.
 */
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
    // Tab is trapped at the DOCUMENT, not on the backdrop. A keydown only bubbles
    // through its own ancestors, so a backdrop listener could not see a Tab pressed
    // once the focus had already escaped to the body - which is exactly the state
    // that has to be recovered from. onKeydown ignores every key but Tab.
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class ConfirmDialog {
  /** Translation keys, not text: the dialog must re-render on a language change. */
  readonly titleKey = input.required<string>();

  /** Translation key of the body sentence, which explains what is about to happen. */
  readonly bodyKey = input.required<string>();

  /** Placeholders substituted into the body sentence, for example the event name. */
  readonly bodyValues = input<TranslationValues>({});

  /**
   * Translation key of an OPTIONAL second sentence, shown under the body.
   *
   * It exists for a consequence the body sentence cannot carry on its own: the
   * registrations page has to say how many tickets the delete releases, and that
   * number changes the wording ("1 ticket" against "2 tickets"), so folding it
   * into the shared body key would either break the dashboard's use of that key
   * or render a sentence that is wrong for one of the two numbers. An empty
   * string - the default - renders nothing, so a caller that has no extra
   * consequence to state uses the dialog exactly as before.
   */
  readonly detailKey = input<string>('');

  /** Placeholders substituted into the detail sentence, for example the ticket count. */
  readonly detailValues = input<TranslationValues>({});

  /** Translation key of the label on the destructive button. */
  readonly confirmLabelKey = input.required<string>();

  /** Translation key of the label on the safe button. */
  readonly cancelLabelKey = input<string>('delete.cancel');

  /** True while the delete is in flight, so the button cannot be pressed twice. */
  readonly busy = input(false);

  /** Emitted when the staff member confirms the destructive action. */
  readonly confirmed = output<void>();

  /** Emitted when the dialog is dismissed without acting. */
  readonly cancelled = output<void>();

  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');

  /**
   * The dialog panel itself, so the Tab trap below can list the controls that are
   * really inside it and can tell whether the focus has already escaped.
   */
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** The page, for the element that opened the dialog and for the focus it holds. */
  private readonly document = inject(DOCUMENT);

  /**
   * The element that opened the dialog, so the focus can go back to it when the
   * dialog closes.
   *
   * Measured before the fix: opening the dialog from a row's Delete button and
   * pressing Escape left the focus on whatever the tab order reached next - the
   * header's "view the public website" link - so a keyboard user who cancelled a
   * delete was dropped near the top of the page and had to tab back through the
   * whole table to return to the row they were working on.
   */
  private returnFocusTo: HTMLElement | null = null;

  constructor() {
    // Captured BEFORE the dialog exists, so it is the trigger and not one of the
    // dialog's own buttons.
    this.returnFocusTo =
      this.document.activeElement instanceof HTMLElement ? this.document.activeElement : null;

    // afterNextRender, not ngOnInit: the button only exists once the view is in
    // the DOM, and focusing a detached element does nothing.
    afterNextRender(() => this.cancelButton()?.nativeElement.focus());

    // The dialog is destroyed by its parent the moment it closes, so returning the
    // focus is a destroy-time job. A destroyed element cannot hold focus, so this
    // runs before the browser is left with focus on the body.
    inject(DestroyRef).onDestroy(() => {
      const target = this.returnFocusTo;
      if (target && target.isConnected) target.focus();
    });
  }

  /** A click on the backdrop (but not inside the panel) cancels. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.cancelled.emit();
  }

  /**
   * Keep Tab inside the panel.
   *
   * `aria-modal="true"` is a claim that the rest of the page is inert, and without
   * this the claim was false: TAB from the destructive button moved the focus to
   * the page behind the dialog (measured - the next stop was the brand link in the
   * header), so a keyboard user could reach controls the modal is supposed to be
   * covering. The panel has two buttons and no other focusable content, but the
   * cycle is built from the focusable elements actually present rather than from
   * "first and last", so adding a link or a third button later cannot open a hole
   * in the trap.
   *
   * @param event - The keydown, inspected only for Tab.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;

    const panel = this.panel()?.nativeElement;
    if (!panel) return;

    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.offsetParent !== null || element === this.document.activeElement);

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = this.document.activeElement;

    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }
}
