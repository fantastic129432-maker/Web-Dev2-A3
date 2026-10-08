/**
 * admin/js/new-event.js
 * ---------------------------------------------------------------------------
 * The "add a new charity event" page.
 *
 * Flow
 *   1. Load the dropdown lists from GET /api/admin/reference-data (organisations,
 *      categories, venues). Building the form only after they arrive is what
 *      makes the three selects real lists instead of text boxes that invite a
 *      foreign key error.
 *   2. Build the shared event form (admin/js/event-editor.js).
 *   3. On submit: validate in the browser, then POST /api/events. The API
 *      validates the same rules again and answers 201 with the created event.
 *   4. On success: show the new event's id with links to open it or add another.
 */
import { getReferenceData, createEvent, ApiError } from '../../js/api.js';
import { el } from '../../js/dom.js';
import { t } from './admin-i18n.js';
import { initAdminLayout, showBanner, showApiError, showTableLoading } from './admin.js';
import { buildEventForm } from './event-editor.js';

document.addEventListener('DOMContentLoaded', () => {
  initAdminLayout({ title: t('form.newHeading'), lead: t('form.newLead') });
  load();
});

async function load() {
  const host = document.querySelector('#event-form-root');
  showTableLoading(host, 'Loading the form...');

  let reference;
  try {
    reference = await getReferenceData();
  } catch (error) {
    showApiError(host, error, { title: t('error.heading') });
    return;
  }

  // A brand-new event needs a venue and an organisation, so an empty list means
  // the database has not been loaded yet. Saying so is far more useful than a
  // select with no options.
  if (
    !reference ||
    (reference.organizations || []).length === 0 ||
    (reference.categories || []).length === 0 ||
    (reference.locations || []).length === 0
  ) {
    showBanner(
      host,
      'The organisation, category or venue list is empty. Load database/charityevents_db.sql first.',
      'warning',
      { title: t('error.heading') }
    );
    return;
  }

  const form = buildEventForm({
    reference,
    submitLabel: t('form.save'),
    onSubmit: (payload) => submit(payload),
  });

  host.replaceChildren(form);
  form.querySelector('#eventName')?.focus();
}

/** POST the payload and report the outcome. */
async function submit(payload) {
  const host = document.querySelector('#event-form-root');

  try {
    const created = await createEvent(payload);

    showBanner(host, t('form.created', { id: created.eventId }), 'success', {
      title: created.eventName,
      actions: [
        el('a', {
          className: 'button button--small',
          text: t('form.viewCreated'),
          attributes: { href: `update.html?id=${encodeURIComponent(created.eventId)}` },
        }),
        el('a', {
          className: 'button button--small button--outline',
          text: t('form.createAnother'),
          attributes: { href: 'new.html' },
        }),
        el('a', {
          className: 'button button--small button--ghost',
          text: t('events.view'),
          attributes: {
            href: `../event.html?id=${encodeURIComponent(created.eventId)}`,
            target: '_blank',
            rel: 'noopener',
          },
        }),
      ],
    });

    // The form stays on the page below the banner, so "add another" is a
    // deliberate click rather than something that happens by accident.
  } catch (error) {
    // A 400 carries one entry per bad field; showApiError renders them all.
    if (error instanceof ApiError && error.status === 400) {
      showApiError(host, error, { title: t('error.validation') });
      return;
    }
    showApiError(host, error, { title: t('error.heading') });
  }
}
