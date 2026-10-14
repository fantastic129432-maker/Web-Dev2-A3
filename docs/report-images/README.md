# Report images

> **Assessment 3 status.** The six images in this folder were captured for the
> **Assessment 2** report, and they are still accurate for everything A2 covered:
> the home page, the search page, the goal-versus-progress figures and the two
> API responses are unchanged by A3.
>
> Two captions below are now **out of date** and must be corrected when the report
> is updated for A3:
>
> * **Figure 4** (`06-er-diagram.png`) says "six tables and five relationships".
>   The A3 schema has **eight tables and seven relationships** (the new
>   `event_registrations` table adds two: to `events` and to `ticket_types`), so
>   the diagram has to be **re-rendered** from `docs/database-design.md`, not just
>   re-captioned.
> * **Figure 3** (`03-event-detail.png`) shows the A2 event page, which ended with
>   the Register button opening the "under construction" dialog. In A3 the button
>   links to the registration page and the page also lists the registrations for
>   the event, so this capture should be replaced.
>
> Still missing for A3: the registration page, the confirmation screen, the admin
> event list, the admin update page showing registrations, and the blocked-delete
> message. Those are listed as outstanding in
> `docs/submission-checklist.md`.

These images were captured from the running system (MySQL on 3306, API on 3000,
website on 5500) on 27 September 2026, in **light theme** and **English**, because
the report is printed on white paper and read by an English-speaking marker.

The site normally follows the operating system theme, and this machine is in dark
mode, so the captures were taken with `prefers-color-scheme: light` emulated.
No application code was changed to produce them.

## What each image is, and where it goes in the report

The section names below are the bold titles already in
`PROG2002 A2 Report - completed.docx`.

**These images are already inserted in the report**, with the captions below and
the figure numbers shown. The numbers follow the order the figures appear in the
document, not the order of the file names.

| # | File | Report section | Page | Caption in the report |
| --- | --- | --- | --- | --- |
| 1 | `01-home-page.png` | **Home page** | 5 | Figure 1. The home page: headline, next events, live impact figures and the upcoming event cards. |
| 2 | `02-search-results.png` | **Search page** | 6 | Figure 2. The search page with all three criteria applied (Lismore, Fun Run, 2026) and the one event that matches. |
| 3 | `03-event-detail.png` | **Event detail page** | 8 | Figure 3. The event detail page: description, venue, times, goal against progress, ticket tiers and Register. |
| 4 | `06-er-diagram.png` | **Data Schema** | 10 | Figure 4. Entity relationship diagram for `charityevents_db`. **A2 capture: six tables and five relationships. A3 needs a re-render showing eight tables and seven relationships.** |
| 5 | `04-api-success-200.png` | **One endpoint in detail: GET /api/events** | 15 | Figure 5. `GET /api/events` with the three filters combined, returning HTTP 200 and the JSON envelope. |
| 6 | `05-api-error-400.png` | **Errors** | 16 | Figure 6. A reversed date range is rejected with HTTP 400 and the offending field named in `details`. |

The ER diagram is rendered from the Mermaid source in
`docs/database-design.md`, so it always matches the written design. If you
prefer the MySQL Workbench version, use **Database > Reverse Engineer** and
export that instead. For A3 either route must be re-run: the current file shows
the A2 six-table schema, and the submitted schema has eight tables (the new
`event_registrations` table, which relates to both `events` and
`ticket_types`).

The page numbers are what Word reports for the current text. They will shift if
you add or remove paragraphs, so treat them as a guide rather than a contract.
Each picture is centred, sized to the text width (or to 7 inches tall for the
two tall ones), and followed by its caption. Every picture also carries the
caption text as its alt text, so a screen reader reads the description rather
than "image".

## What the images show

* **Home page** - 8 upcoming events, 6 partner charities, $99k raised against a
  $240k goal. Those numbers come from `/api/stats`, so the image is also
  evidence that the page reads the database rather than hard-coded values.
* **Search results** - the three filter chips are visible (date range, location,
  category), which is the "combine all three criteria" case the brief asks for.
* **Event detail** - the goal against progress bar shows $7,720 of $25,000
  (30.9%), which is computed by `vw_event_progress` from the `donations` table.
* **API 200** - note `"dataSource": "mysql"` in the response, proving the API is
  reading MySQL and not the offline mirror.
* **API 400** - the response names `to` as the offending field, which is the
  `details` array described under **Errors**.
* **ER diagram** - the A2 capture shows six tables with primary and foreign keys
  and the five relationships between them. The A3 schema has eight tables and
  seven relationships.

## Honest note about the two API images

Images 4 and 5 are captures of the **live API response**, showing the request
line, the real status code and the real body. They are not Postman
screenshots.

The submission checklist asks for "Postman success and Postman 400". If your
marker expects to see the Postman window itself, take those two screenshots in
Postman while you record the video - the collection
`docs/postman/PROG2002-A2-Charity-Events-API.postman_collection.json` is already
imported, so open **Search page > GET /events (three criteria at once)** and
**Validation and error handling > GET /events (invalid date range) -> 400** and
capture those two tabs. Both are named in `docs/video-recording-guide.md` under
the Question 1 shot list.

## Regenerating these images

The pages must be running first:

```bash
node tools/start-all.mjs
```

Then re-run the capture with the site in light theme. The capture script is not
committed (it is a one-off), so the manual route is: set **Theme: Light** in the
settings bar, set **Language: English**, and use `Win`+`Shift`+`S` to snip each
page. The URLs to open are in `docs/video-recording-guide.md`.

For the ER diagram, render the Mermaid block in `docs/database-design.md` at
<https://mermaid.live> and export it as PNG, or reverse engineer from Workbench.
