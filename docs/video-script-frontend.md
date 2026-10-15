# Demo video script — **client side** (the two Angular websites)

PROG2002 Web Development II — **Assessment 3**

**This script is for:** the member responsible for the **client side** — the public
Angular website, the admin Angular website, and the shared TypeScript library
(`clientside/`, `adminside/`, `shared/`).

**Partner script:** `video-script-backend.md` covers the database, the API and the
deployment. The two scripts are deliberately complementary: each answers all three
required questions, but this one goes **deep on the front end** and treats the
database and API as a contract it depends on.

> 【为什么是两份】A3 要求视频"focus on your own contribution"，并且**三个问题都要答**。
> 所以这不是把 15 分钟对半切：两份都要完整回答 Q1/Q2/Q3，差别在于**哪一块讲深、哪一块
> 只讲"我需要它给我什么"**。属于同伴的部分（表设计、SQL、事务）在本稿里只出现到
> "它给我什么契约"为止，不要替他讲实现细节 —— 面试时被问到会答不上来。

## Timing plan (14:30, leaving 30 seconds of slack under the 15-minute limit)

| Time | Section | Question | Depth |
| --- | --- | --- | --- |
| 0:00 - 0:50 | Introduction and my role | - | - |
| 0:50 - 2:20 | Q1: the contract I needed from the database and API | Q1 | brief |
| 2:20 - 5:30 | Q2: the registration page, end to end | Q2 | **deep** |
| 5:30 - 8:00 | Q2/Q3: one shared library, two applications | Q2, Q3 | **deep** |
| 8:00 - 11:00 | Q3: the public website | Q3 | **deep** |
| 11:00 - 12:30 | Q3: the admin website | Q3 | **deep** |
| 12:30 - 13:30 | A real bug the front end had, and how the tests caught it | - | **deep** |
| 13:30 - 14:30 | Tests, deployment and closing | - | brief |

If you are running long, cut the **search page** demonstration first (it was the
centre of the A2 video). Never cut the registration page, the admin delete, or the
bug section — those are the three things only this video shows.

---

## Before you record

Mechanics (OBS, exact URLs, what to have open, how to silence the machine) are in
`video-recording-guide.md`. The short version:

1. `npm start` from the project root. It compiles the API and serves all three
   parts. **Do not skip this**: if `dist/` holds a production build from a previous
   deployment, `npm start` rebuilds it for local use first, so you are always
   demoing the code in front of you.
2. Open: `http://localhost:4200/`, `http://localhost:4300/`, VS Code, MySQL
   Workbench, Postman, and a terminal.
3. In the browser, open DevTools → **Network** and leave it open; this video leans
   on it.
4. Rehearse once without recording.

> 【录制前检查】**先把 `npm start` 跑起来再开 OBS**。DevTools 的 Network 面板要**提前
> 打开并清空**，否则第 3 步"提交表单"时你看不到那一条 POST。把浏览器缩放调到 125%，
> 否则代码字体在录像里看不清。

---

## 0:00 - 0:50 | Introduction and my role

**Show:** the deployed public site, then the admin site, for five seconds each.

> "Hello, my name is _[name]_, student number _[number]_. This is my Assessment 3
> submission for PROG2002 Web Development II.

> My contribution is the **client side of the project**: two Angular 22
> applications — the public charity events website, and the separate admin website
> staff use — plus the shared TypeScript library that both of them import. My
> teammate built the database and the API, and I will show you where our two halves
> meet.

> Both applications are written with HTML, TypeScript and CSS; there is no
> JavaScript framework other than Angular, and the whole project, front end and
> back end, is TypeScript."

> 【旁注】开场 20 秒内必须出现 "My contribution is the client side"，这是评分点。
> 不要花时间介绍慈善机构的背景，A2 视频已经讲过了。

---

## 0:50 - 2:20 | Q1: the contract I needed from the database and API

**Question 1 asks about the database and API design.** It is my teammate's part, so
I will not re-explain his SQL. What I need to answer is the part that is genuinely
mine: the design decisions that **forced a specific behaviour in my user interface**.
Three of them did.

**Show:** MySQL Workbench with `charityevents_db`, the **Tables** and **Views**
panels expanded, then `database/01_schema.sql` section 7, `event_registrations`.

> "The new table is `event_registrations`. Three of its constraints are rules from
> the brief written into the schema, and each one changed what I had to build.

> **First, the unique key is on the pair `(event_id, attendee_email)`.** That is
> what makes 'a user may register for multiple events but only once per event'
> true. For me it means a duplicate registration arrives as a **409 Conflict**, and
> a 409 is not an error I can ignore — the visitor is standing in front of a form
> that looks correct and is being refused. So the front end had to turn that into a
> message on the email field, not a red box at the top of the page.

> **Second, `event_id` is `ON DELETE RESTRICT`** — the database half of 'an event
> can only be deleted when it has no registrations'. That is the rule the admin
> interface has to make visible *before* staff click delete, not after.

> **Third, the detail endpoint returns this event's registrations ordered by
> `registered_at` descending**, newest purchase first. The brief asks for that
> order, and the API owns it — which means my event page must **not** re-sort the
> list. If I sorted in the browser there would be two places responsible for one
> rule, and they would drift."

**Show:** `.env`-free view of the response shape — Postman, `GET /events/1`, the
`registrations` array, and the `totalAmount` field.

> "The other thing I depend on is the **shape of the response**: every endpoint
> answers with the same `{ success, meta, data }` envelope, a 400 carries a
> `details` array naming each invalid field, and a blocked delete carries
> `details.suggestion = suspend-instead`. Those are not cosmetic. The `details`
> array is what lets my admin form paint each message next to its own control, and
> `suggestion` is what lets the admin page offer 'suspend it instead' as a **link**
> rather than as a sentence the user has to retype.

> I wrote that contract down — `docs/api-documentation.md` — and both of us worked
> against it, which is why the two halves plugged together without a rewrite."

> 【旁注】这一段的关键动作：**把 API 的响应当作"契约"来讲，而不是讲 SQL**。拿起
> Postman 指 `details` 数组和 `suggestion` 字段各两秒就够了。如果被问"这个表为什么
> 这样设计"，回答：**"That is my teammate's part — what I can tell you is what I
> needed from it and why"**，然后讲上面三点，不要硬答列类型。

---

## 2:20 - 5:30 | Q2: the registration page, end to end

**Question 2 is data flow: how a click in the browser becomes data in the database.**
This is the deepest part of my contribution, because the registration page is the
only place where the visitor, my code, the API and the database all have a say.

**Show:** split screen — `clientside/src/app/pages/register/register.ts` on the
left, the browser on `http://localhost:4200/register/2` with the Network tab open on
the right.

> "Two files carry this page: the component `register.ts`, which owns the form and
> every screen state, and its template `register.html`. Everything that talks to
> the server goes through one shared service, and I will come back to that."

### 2:20 - 3:10 | Step 1: which event, and the form as one value

**Show:** `register.ts`, the `loadEvent()` method and the `RegistrationForm`
interface.

> "Registration is per event, so the event id travels **in the route**:
> `/register/2`. The component reads it once from the route parameters and loads
> the event with `GET /api/events/2`, so the visitor sees the name, date, venue and
> price of what they are registering for before they type anything.

> There is deliberately no route for a bare `/register`. A form that cannot know
> what it is registering for is worse than an honest answer, so the catch-all route
> shows the friendly 404 page instead.

> The form itself is **one object held in an Angular signal** — name, email, phone,
> date of registration, ticket tier, number of tickets and notes, one control per
> stored column. Because it is one value, saving and restoring a draft is one write,
> and clearing the form is one write; there is no loop over the DOM anywhere.

> The two derived values on this screen are `computed` signals over that form: the
> running total is computed from the selected tier and the quantity, so it **cannot
> go stale** — there is no 'update the total' function to forget to call. The tier
> dropdown is built from **this event's** tiers only."

### 3:10 - 3:50 | Step 2: client-side validation happens first

**Do:** submit the form empty; then type an invalid email and a bad phone number.

> "Nothing was sent — the Network tab is still empty, and it will stay empty until
> the form is valid. Each problem is written next to its own field, a summary with
> `role="alert"` appears and takes focus, and the first problem is scrolled into
> view. That is the accessibility pattern on purpose: a screen reader announces the
> summary, and moving the focus takes the user to the message instead of leaving
> them to hunt for it.

> Validating in the browser is a courtesy to the visitor. The server never trusts
> it — the API validates the same rules again, and the database validates them a
> third time. Three layers, one set of rules."

### 3:50 - 4:40 | Step 3: the request through the shared service

**Show:** `shared/src/api/api.service.ts` — `ApiService.send()`, then
`createRegistration()`.

> "This is the file I would point at if you asked me what the two applications have
> in common. `ApiService` is the **only** place in either application that talks to
> the server. No component calls `fetch` and no component builds a URL.

> Three things live in this one place. It builds the URL from an **injected
> `API_BASE_URL` token** — that is how one shared library serves two applications
> and a local build and a deployed build, without a single `if`. It puts a
> **ten-second timeout** on every call, so a slow API can never leave a page
> spinning forever. And it normalises **every** failure into one `ApiError` type: a
> timeout, a 400 with per-field details, a 409, or the API being unreachable. The
> components never see an envelope, never see a raw HTTP status, and never see an
> exception — there is exactly one error shape to render.

> It also unwraps the `{ success, meta, data }` envelope in that one place, and a
> **204 resolves to `null`** rather than trying to parse an empty body — a delete
> has no body to parse."

**Do:** submit the valid form and point at the `POST .../registrations` row in the
Network tab: status **201**, the `Location` response header, the JSON body.

> "Here is the request: **201 Created**, a `Location` header, and the stored row
> coming back — including the id the database assigned and the `totalAmount` the
> API computed from the tier price. Underneath, `HttpClient` returns an Observable
> and the component subscribes to it; that is a normal XMLHttpRequest, which is
> what the Network tab is showing you."

### 4:40 - 5:30 | Step 4: the confirmation is built from the response

**Show:** the confirmation card on the page.

> "The form is replaced by a confirmation card that is built from the **API
> response**, not from what the form thought it sent. Every line of that receipt is
> computed from the registration the API returned. That is what lets me say the
> write really happened: the receipt on screen is the record the database holds.

> A failure takes the other branch, and the error handling is worth one sentence
> because it is where the 409 from the schema turns into something a person can
> act on. `ApiError` carries the status and the `details` array; a map puts each
> message onto the control that produced it; and a **409 — this email has already
> registered for this event — is shown next to the email field using our own
> translated sentence**, so a visitor reading the site in Chinese, Vietnamese or
> Japanese gets that message in their language rather than an English sentence from
> the server.

> The read path is the same shape in reverse, and Assessment 2 already demonstrated
> it: the search page turns its filter form into the API's query parameters, and
> **one** shared component, `event-card.ts`, turns each returned event into the card
> that the home page and the search page both use. One renderer, two pages, no
> duplicated markup."

> 【旁注】第 4 步是 Q2 的收尾，务必把"回执来自响应而不是来自表单"这句说清楚 —— 这是
> 面试常问点。提到 409 时，**先说"这是表上的唯一键决定的"**，把功劳指回同伴的设计，
> 再讲"我把它变成了邮件字段旁的一句本地化提示"。

---

## 5:30 - 8:00 | Q2/Q3: one shared library, two applications

**Show:** the folder tree — `clientside/`, `adminside/`, `shared/` — then
`shared/src/` expanded, then `angular.json`'s `paths` entry for `@charity/shared`.

> "Both websites are separate Angular applications with separate routing, separate
> layouts and separate translation dictionaries — and they share one folder of
> TypeScript instead of a built library. That was a deliberate decision and it is
> the piece of architecture I am most likely to be asked about.

> `shared/` is mapped with one path alias, `@charity/shared/*`. There is no second
> build product, so there is no stale-library failure mode where the app is running
> against last week's types. The cost is that the shared code is type-checked as
> part of whichever app imports it, so I added `npm run check:shared` to type-check
> it on its own — the one real benefit a library build would have given me, without
> the library build.

> What is actually in there is everything that must behave **identically** on both
> sides:

> — the API layer, so there is one timeout and one error shape;
> — the models, so both apps agree on what an event is;
> — the translation service and the four dictionaries;
> — the theme service;
> — the formatters for dates, money and event state;
> — and the Open-Meteo weather service.

> Two of those are worth showing because they are the kind of detail that shows up
> in use but not in a file listing."

**Show:** the language switcher in the header, switching to 中文, then the theme
button, then reload the page.

> "The language service is **signal-based**, so switching language re-renders every
> translated string with no reload and no subscription to unsubscribe. The choice is
> written to `localStorage` under one shared key, which is why the public site and
> the admin site agree. On a first visit it is detected in a deliberate order:
> a stored choice, then a `?lang=` query parameter — so a shareable link can force a
> language — then the **browser's own preference**, then English.

> The theme is light, dark or system, and it is written onto the `<html>` element as
> a `data-theme` attribute. There is also a small inline script in both
> `index.html` files that applies the stored theme **before** Angular loads. Without
> it, a dark-theme user gets a white flash on every page load — a one-line fix for a
> defect that is invisible until you record a video of it."

> 【旁注】这一段是"架构决策"得分点，务必说出**代价**（没有独立类型检查 → 用
> check:shared 补上）。只讲好处会被追问。主题闪烁那段很适合现场演示：切到 dark，
> 按 F5，说明为什么不会白闪。

---

## 8:00 - 11:00 | Q3: the public website

**Question 3 is website functionality.** This is where I show what a visitor
actually gets.

### 8:00 - 8:40 | Home and search, briefly

**Show:** `http://localhost:4200/`, then `/search` with Lismore + Fun Run.

> "The home page mixes static organisation content with a dynamic listing from
> `GET /api/events/upcoming`: name, category, date, venue, price and a live progress
> bar. No past event and no suspended event appears, because the public endpoints
> read the view that fixes `status = 'active'` — the API's rule, honoured here by
> rendering whatever it sends.

> The search page filters by date, location and category, singly or combined, with
> removable chips and a Clear Filters button. The whole filter form is one value in
> a signal, so clearing it is a single write. The filters are also written into the
> **URL**, so a search can be refreshed, bookmarked or sent to someone else — and
> that is also why opening a shared link restores the filters *and* the results."

### 8:40 - 9:50 | The event page: registrations and the registration link

**Show:** `http://localhost:4200/events/2`, scrolled to the registrations panel.

> "The Register button is a real router link carrying this event's id. In
> Assessment 2 it opened an 'under construction' dialog; it does not any more,
> because the feature exists. A **past** event shows a disabled button instead of a
> link that would only fail — the interface should not offer an action the API will
> refuse.

> Below the tickets is the registrations panel: a real `<table>` with a caption for
> screen readers and `scope` on the column headings. Each row is one registration —
> attendee and email, ticket type, how many tickets, what they are worth and when
> they were bought — newest purchase first, with a totals footer. The hero also
> reports how many tickets have been sold so far.

> That list is **not sorted in the browser**. The API returns it in
> `registered_at` descending order and this page renders it in the order it
> arrived."

**Do:** run in MySQL Workbench:

```sql
SELECT registration_id, attendee_name, registered_at
  FROM event_registrations WHERE event_id = 1
 ORDER BY registered_at DESC, registration_id DESC;
```

> "Same order as the page, because it is the same rule — `registered_at`
> descending, with the registration id breaking ties. I am running the query to
> show you that the page is not inventing an order; the database and the screen
> agree."

### 9:50 - 10:30 | The optional external API

**Show:** the weather panel on the same page.

> "The brief allows an optional external API, so the event page shows the forecast
> for the event day from Open-Meteo. It needs no key and no registration, which
> matters: nothing secret has to be sent to the marker.

> It lives in `shared/src/weather/weather.service.ts`. It takes the venue's
> latitude and longitude and the event date, and asks for one day in the Sydney
> timezone — the weather code, the temperature range, the rain chance and the wind.
> The WMO weather codes are mapped to **translation keys**, so the panel follows the
> language switcher like everything else.

> It is a bonus feature, so it is not allowed to break the page. If the venue has no
> coordinates, or the date is outside the sixteen-day forecast window, or the event
> is in the past, the panel is simply **not shown**. And if the panel is shown but
> the request fails, it says so in one line rather than claiming to be loading
> forever — the service resolves `null` instead of raising, and the panel
> distinguishes 'still loading' from 'there is nothing to show'."

**Do:** open `/events/9` (a past event) and `/events/8` (the online venue, which has
no coordinates).

> "No panel, no error, and the page is complete without it. The same service is used
> on the admin side as a live preview on the event form."

> 【旁注】这里演示"优雅降级"时，**先说"这个功能本来可以不显示任何东西"**，再演示两个
> 不会出现面板的场景。注意 `/events/9` 和 `/events/8` 的 id 要以你本机数据为准，录制
> 前先点一遍确认。

---

## 11:00 - 12:30 | Q3: the admin website

**Show:** `http://localhost:4300/`.

> "Assessment 3 also asks for an admin-side website. It is a **separate Angular
> application** on its own port — there is no second command and no second API. It
> is separate because its audience and its view of the data are different, not
> because its code is: it imports the same library, so the API layer, the models,
> the four languages, the theme and the formatters are literally the same code.

> The menu is defined once in the application shell, so no page can forget it, and
> the header carries the same language and theme controls as the public site."

### 11:00 - 11:30 | The list: every event, regardless of status

**Show:** `http://localhost:4300/events`.

> "This is the requirement the public API cannot satisfy: **every** event regardless
> of status. It reads `GET /api/admin/events`, which uses the admin view, so the
> suspended event and the past events are all here. Each row shows the id, the event
> with its category and organisation, the publishing status and the derived
> upcoming-or-past state, the dates, the venue, registrations against capacity, and
> tickets sold. The filters narrow by status, time and keyword, and they go into the
> URL, so a filtered view can be refreshed or shared.

> The 'sold' column comes from `registration_count` and `tickets_sold` in the view,
> so listing eleven events is still **one** query rather than eleven."

### 11:30 - 12:00 | Create and update

**Show:** `http://localhost:4300/events/new`.

> "The create form is not handwritten markup per field: the reactive form is built
> once by `createEventForm()`, and **one** shared `event-form` component renders it,
> so the create page and the update page cannot drift apart. The dropdowns are
> filled from `GET /api/admin/reference-data` — organisations, categories and venues
> in one request — and the form is only drawn once those lists arrive, which is what
> stops a typo becoming a foreign-key error.

> Ticket-tier rows can be added and removed, the same client-side validation runs
> before anything is sent, and the artwork picker offers the nine illustrations the
> project ships with, with a live preview, so staff can see what the card will look
> like.

> Below the fields is a live weather preview for the chosen venue and date — the
> same service, used **before the event exists in the database**. That is the point
> of it: staff can see the beach fun run is forecast to be wet and move it while it
> is still a draft."

**Do:** change one field on `/events/2/edit` and submit, with the Network tab open.

> "Look at the request body: **only the field I changed**. The component compares the
> form against the event it loaded and sends a partial update, so there is no chance
> of a stale value silently overwriting a change someone else made. Submitting with
> nothing changed is refused with a message instead of sending a pointless request."

### 12:00 - 12:30 | The delete, blocked with a clear message

**Do:** on `/events`, click **Delete** on event 1, then confirm. Then delete event 9.

> "The confirmation dialog is my own component, not the browser's `confirm()`, so it
> can explain what is about to happen. It calls `DELETE /api/events/1` and the API
> answers **409** — that is the `ON DELETE RESTRICT` rule from the schema arriving
> in the interface.

> The banner renders the API's own message, naming the event and the number of
> registrations, and then turns the structured part of that response into
> **actions**: it offers the `suggestion` the API sent — suspend the event instead —
> links straight to the registrations, and disables and relabels that row's Delete
> button so the rule stays visible next to the data after the banner is dismissed.

> And here is the other half: an event with no registrations deletes cleanly, a
> success banner appears, and the list reloads without it. Blocked and allowed, from
> the user's side."

> 【旁注】这一段的落点句是：**"结构化的 details 让我能把一个 409 变成两个可点的操作，
> 而不是印一句话。"** 这是前后端配合最好的例子，也顺便解释了同伴为什么这样设计
> 响应体。

---

## 12:30 - 13:30 | A real bug the front end had, and how the tests caught it

This section exists because A3 asks what **you** did. This is the most concrete
thing I can show: a defect that was in the code, what caused it, and the check that
stops it coming back.

**Show:** `/register/2` with the ticket-tier dropdown, then
`clientside/src/app/pages/register/register.html` around the tier `<option>`.

> "On the registration page the tier dropdown is **pre-selected to the cheapest paid
> tier**, and the running total underneath is computed from that same value. A
> visitor who changes nothing books that tier.

> But the dropdown was displaying a **different** tier from the one it was going to
> book. On an event whose first tier is a free one, the page showed 'Free Community
> Entry' in the dropdown while the total underneath read '1 × $45.00 = $45' and the
> POST sent the paid tier. The dropdown also fired no change event when you picked
> the tier it was already displaying, so choosing the free tier appeared to do
> nothing.

> The cause was an Angular detail I had got wrong in three places at once. The
> dropdown's value was bound with `[value]`, and its `<option>` elements are created
> by a loop. On the **first** render Angular writes the value *before* the loop has
> created any options, so the write is discarded — and the browser then selects the
> first option it does have. Because the bound value never changes again, Angular
> never writes it a second time, so it stays wrong until the user touches the
> control.

> The fix is to mark the option itself as selected as well as binding the select's
> value. Once I understood the cause I went looking for the same pattern, and found
> it in two more places: the **language switcher** in both applications — where a
> Chinese visitor saw a Chinese interface with the dropdown reading 'English' — and
> the **venue filter** on the search page, which filtered the results while the
> picker showed nothing selected.

> Three symptoms, one cause, and none of them was visible in a screenshot: the
> interface was in the right state, only the control disagreed."

**Show:** `tests/angular-e2e.mjs`, the language-picker check, then run
`npm run test:e2e` and let the summary print.

> "So I added a regression check rather than just fixing it. The check does not
> assert a particular language — it asserts an **invariant**: the picker's value must
> be a prefix of the `<html lang>` attribute the translation service maintains. That
> works in any language, on any machine, and it fails if the two ever disagree
> again. The end-to-end suite is up to thirty-eight checks and drives both
> applications in a real browser against the compiled API."

> 【旁注】**这一段是你整份稿子里最有说服力的部分，一定要留足 1 分钟讲慢一点。**
> 顺序：现象（显示免费、实收付费）→ 原因（`[value]` 先于 `@for` 创建 option）→
> 影响范围（三处）→ 修复（给 option 加 `[selected]`）→ 回归测试（不测具体语言，测
> 不变量）。如果时间紧，宁可砍掉首页/搜索演示，也要保住这段。

---

## 13:30 - 14:30 | Tests, deployment and closing

### 13:30 - 13:55 | Tests

**Show:** a terminal running `npm test`, then `npm run test:e2e`.

> "The project has four layers of automated checks. `npm test` runs **116** checks:
> the HTTP contract against the real Express API endpoint by endpoint, plus a jsdom
> regression suite that loads the **archived** Assessment 2 frontend, which is kept
> under `legacy/` as the behavioural reference for the pages I rewrote.

> The front end is covered by `npm run test:e2e` — **40** checks that drive a
> headless browser through both websites against the compiled API, including the
> check I just showed you — and by `npm run check:angular`, **16** checks that fail
> if the required architecture changes: no NgModule anywhere, zoneless, every
> component with an HTML template and a doc comment, both applications importing the
> shared library, and both `index.html` files still carrying the early-theme script.

> `npm run check:translations` then checks the data: four languages per dictionary,
> identical key sets, and every key the templates ask for actually existing. That
> check is why the translated 409 message I mentioned earlier can be trusted to
> exist in all four languages."

### 13:55 - 14:30 | Deployment and closing

**Show:** the deployed public site and the deployed admin site, then
`https://24832481.it.scu.edu.au/` refreshing on a deep link such as `/events/2`.

> "Both websites are deployed to the SCU cPanel host — the public site at the site
> root and the admin site in the `admin` folder — and both point at the deployed
> API. They are built for production, so the API address is compiled in rather than
> guessed at run time, and the deep links work because of two small `.htaccess`
> rules: a real path like `/events/2` is handed to the application shell, and a path
> that looks like a missing file returns an honest 404 instead of the shell.

> To summarise my half: the public site can take a registration from the form to the
> database and show the receipt the API returned; the admin site manages events with
> the same shared library, and turns the schema's uniqueness and delete rules into
> messages and actions a member of staff can act on; and thirty-eight end-to-end
> checks exercise both of them in a real browser. Thank you for watching."

**Stop recording.**

> 【旁注】最后一句总结只讲**你的**部分（前端），不要替同伴总结后端。结尾"Thank you
> for watching"说完停两秒再停止录制，方便剪辑。

---

## After recording

- [ ] Watch it back with sound on and check all three questions are clearly answered
- [ ] Confirm the total length is **at most 15 minutes**
- [ ] Confirm the registration page is shown end to end: validation, submission, and
      the confirmation **read back from the API**
- [ ] Confirm the admin list visibly contains the suspended event
- [ ] Confirm the blocked delete (**409**) and a successful delete (**204**) are both shown
- [ ] Confirm the tier-dropdown bug section is intact — it is the strongest evidence
      of your own contribution
- [ ] Confirm you never explain the SQL design as if it were yours; say whose it is
- [ ] Upload to SCU OneDrive, set sharing so the marker can view it, and test the
      link in a private browser window

## Likely interview questions for this role

1. Why does the `shared/` folder exist instead of a built Angular library, and what
   did you give up? (One path alias, no stale-library failure mode; the cost is no
   independent type-check, which `npm run check:shared` covers.)
2. How does one shared library serve two applications with different API addresses?
   (An injected `API_BASE_URL` token provided in each app's configuration.)
3. What happens on the home page if the API is offline? (`ApiError` with a readable
   message and a retry path; the page never hangs, because every call has a
   10-second timeout.)
4. Why is a 204 handled differently from a 200? (It has no body, so the service
   resolves `null` instead of parsing JSON.)
5. How does the event id reach the registration page? (Route parameter →
   `GET /api/events/:id` → the form is built from that event's tiers.)
6. Why is the registrations list not sorted in the browser? (The API owns the
   `registered_at` descending rule; sorting twice means two places can drift.)
7. How is the running total kept correct? (A `computed` signal over the form — it
   cannot go stale because nothing has to update it.)
8. **What was the `[value]` versus `[selected]` bug, and why did it happen?** (The
   select's value is written before a loop-created option exists, so the first write
   is discarded and the browser shows the first option; fixed by marking the option
   selected, with an invariant-based end-to-end check.)
9. What happens to the weather panel when Open-Meteo is unreachable? (The section
   only appears when a forecast is possible; if the request fails it says so in one
   line rather than loading forever, because the service resolves `null` instead of
   throwing.)
10. How does the admin delete turn a 409 into something usable? (The response's
    `details` and `suggestion` fields drive a banner, a link to the registrations,
    and a disabled row button — structured data, not a sentence.)
11. Where would authentication go if it were added? (In front of the
    `/api/admin/...` routes on the server, plus an HTTP interceptor in each Angular
    application.)
12. Which files would you change to add a new search filter? (The `FilterForm`
    value and `buildQuery()` in `search.ts`, the API's accepted query parameters,
    and the template — the shared API service does not change.)
