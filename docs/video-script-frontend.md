# Demo video script — **client side** (the two Angular websites)

PROG2002 Web Development II — **Assessment 3**

**This script is for:** the member responsible for the **client side** — the public
Angular website in `clientside/`, the admin Angular website in `adminside/`, and
the shared TypeScript library both of them import from `shared/`: the API client,
the two dictionaries and their four languages, the theme service, the formatters,
the weather service and the shared components.

**Partner script:** `video-script-backend.md` covers the MySQL schema and the whole
TypeScript API. This script answers all three required questions from the client
half only, and treats the database and the API as a contract it depends on.

> 【为什么是两份】A3 要求视频"focus on your own contribution"，并且**三个问题都要答**。
> 所以这不是把 15 分钟对半切：两份都要完整回答 Q1/Q2/Q3，差别在于**哪一块讲深、哪一块
> 只讲"我需要它给我什么"**。属于同伴的部分（表设计、SQL、事务）在本稿里只出现到
> "它给我什么契约"为止，不要替他讲实现细节 —— 面试时被问到会答不上来。

## Timing plan (14:30, leaving 30 seconds of slack under the 15-minute limit)

| Time | Section | Question |
| --- | --- | --- |
| 0:00 - 0:50 | Introduction and my role | - |
| 0:50 - 3:20 | Q1: the API contract, and the client decisions built on it | Q1 |
| 3:20 - 6:50 | Q2: the registration page, from the route to the receipt | Q2 |
| 6:50 - 9:50 | Q3: the public website, live | Q3 |
| 9:50 - 11:50 | Q3: the admin website, live | Q3 |
| 11:50 - 13:20 | Q2/Q3: the shared layer both applications run on | Q2, Q3 |
| 13:20 - 14:30 | Closing: what my half is | - |

If you are running long, cut the **home page** tour first (it was the centre of the
A2 video). Never cut the registration page, the admin delete, the weather beat or
the combobox — those are the four things only this video shows.

---

## Before you record

Operational only; the words to say are below.

1. `npm start` from the project root, before OBS. It serves the public site on
   `http://localhost:4200/`, the admin site on `http://localhost:4300/` and the API
   on `http://localhost:3000/api`.
2. **Pin the demo date.** Put `DEMO_TODAY=2026-10-17` in `api/.env` and restart (it
   ships commented out, so otherwise the API follows the real clock). On that date
   six public events are upcoming and the gala on 24 October is the only public
   event inside Open-Meteo's sixteen-day window — which is what makes the weather
   beat possible.
3. **Reload the seed** with `database/charityevents_db.sql` (open it in Workbench
   and run it) before this take, and again before any re-take: the figures quoted
   below are the seed's plus the one registration you submit in section 2, and
   this take also deletes the seeded event 9, so only a freshly reloaded seed
   makes the counts and the eleven-row admin list true again.
4. Open `http://localhost:4200/`, `http://localhost:4300/`, VS Code, and a terminal.
5. In the browser, open DevTools → **Network** and leave it open; this video leans
   on it. Browser zoom 125%, and rehearse once without recording.

> 【录制前检查】**先把 `npm start` 跑起来再开 OBS**。DevTools 的 Network 面板要**提前
> 打开并清空**，否则第 3 步"提交表单"时你看不到那一条 POST。把浏览器缩放调到 125%，
> 否则代码字体在录像里看不清。**把 `DEMO_TODAY` 写进 `api/.env` 并重启**，否则天气那
> 一段会变成"每个页面都没有预报"，和稿子里写的四态对不上。**每次重拍前都要重载种子**，
> 否则报名总数会比稿子里多一条，管理员列表也会少一行（第 3 段会删掉种子里的活动 9）。

---

## 0:00 - 0:50 | Introduction and my role

**Show:** the public site, then the admin site's event list, for five seconds each.

> "Hello, my name is _[name]_, student number _[number]_. This is my Assessment 3
> submission for PROG2002 Web Development II.

> My contribution is the **client side of the project**: two Angular 22
> applications — the public charity events website, and the separate admin website
> staff use — plus the shared TypeScript library that both of them import. My
> teammate built the database and the API, and the server half is covered by the
> other script.

> Both applications are written with HTML, TypeScript and CSS; there is no
> JavaScript framework other than Angular, and the whole project, front end and
> back end, is TypeScript."

> 【旁注】开场 20 秒内必须出现 "My contribution is the client side"，这是评分点。
> 不要花时间介绍慈善机构的背景，A2 视频已经讲过了。

---

## 0:50 - 3:20 | Q1: the API contract, and the client decisions built on it

**Question 1 asks about the database and API architecture.** That is my teammate's
part, so I will not re-explain the SQL. What I can answer is the part that is mine:
the contract I needed from that half, and the decisions I built on it.

### 0:50 - 1:40 | What the contract gives me, and what it does not

**Show:** Postman — `GET /events/2` for the `registrations` array, then the
collection's failing writes: a 400 that carries a `details` array and a blocked
delete that carries the structured facts.

> "Four things in the API's contract shaped my user interface, and it matters
> which half each one comes from. Two are constraints, and they reach me only as
> the API's answers: **a duplicate arrives as a 409 Conflict and a delete can be
> refused, and the API is the last layer the client depends on.** A 409 is not an
> error I can ignore — the visitor is standing in front of a form that looks
> correct and is being refused — so the front end had to turn it into a message
> on the email field, not a red box at the top of the page; and a refused delete
> has to be visible in the admin interface *before* staff click delete, not after.

> **The third is not a constraint at all: it belongs to the API.** The detail
> endpoint returns this event's registrations ordered by `registered_at`
> descending, newest purchase first. The brief asks for that order and the API owns
> it, which means my event page must **not** re-sort the list. If I sorted in the
> browser there would be two places responsible for one rule, and they would drift.

> And one projection is the thing I depend on most: **the public response carries a
> masked display name and no contact details.** The table stores the attendee's
> email and phone because the brief says to; `GET /api/events/:id` sends neither,
> and sends `attendeeDisplayName` instead — 'Grace T.' rather than 'Grace Tan'.
> That is a privacy decision made on the API side, and it decided what my
> registrations table could show.

> The shape matters as much as the content. Every endpoint answers with the same
> `{ success, meta, data }` envelope, a 400 carries a `details` array naming each
> invalid field, and a blocked delete carries the facts of the conflict —
> `eventId`, `eventName` and `registrationCount`. Those are not cosmetic:
> `details` is what lets my admin form paint each message next to its own control,
> and for the delete the page reads the name and the count from that object, maps
> the `suggestion` code to the advice in its **own** dictionary — with a generic
> fallback for a code it does not know — and offers a link to the registrations.
> The advice is my sentence, in the reader's language, not the server's."

> 【旁注】这一段的关键动作：**把 API 的响应当作"契约"来讲，而不是讲 SQL**。拿起
> Postman 指 `details` 数组、`suggestion` 字段、`attendeeDisplayName` 各两秒就够了。
> 如果被问"这个表为什么这样设计"，回答：**"That is my teammate's part — what I can
> tell you is what I needed from it and why"**，不要硬答列类型。注意口径：只说这两个
> 约束以 **409** 和被拒绝的删除到达我的界面，唯一键和外键的细节留给同伴；排序规则是
> **API 的**，别把 API 的规则说成数据库约束。

### 1:40 - 2:40 | One way to talk to the API, one shape to render

**Show:** `shared/src/api/api.service.ts` — `ApiService.send()` and
`normalise()`.

> "This is the file I would point at if you asked me what the two applications have
> in common. `ApiService` is the **only** place in either application that talks to
> the server. No component calls `fetch` and no component builds a URL.

> Three things live in this one place. It builds the URL from an **injected
> `API_BASE_URL` token** — that is how one shared library serves two applications
> with different API addresses, without a single `if`. It puts a **ten-second
> timeout** on every call, so a slow API can never leave a page spinning forever.
> And it normalises **every** failure into one `ApiError` type: a timeout, a 400
> with per-field details, a 409, a 5xx, or the API being unreachable. The
> components never see an envelope, never see a raw HTTP status, and never see an
> exception — there is exactly one error shape to render.

> The error mapping is the interesting half. A 400's `details` array becomes a
> field-to-message map, so a page paints each message on the control that produced
> it. A 409 keeps its structured facts, which is how the admin page can read the
> event name and the registration count. A timeout or an unreachable server carries
> no API wording at all, so the message is resolved **late**, when the page asks for
> it — which is why an error already on screen re-renders in the new language when
> the visitor switches. That is the whole error strategy in one type.

> It also unwraps the envelope in that one place, and a **204 resolves to `null`**
> rather than trying to parse an empty body — a delete has no body to parse."

### 2:40 - 3:20 | Form state and validation: the client's side of the contract

**Show:** `clientside/src/app/pages/register/register.ts`, the `RegistrationForm`
interface and `totalLine`.

> "The registration form is **one object held in an Angular signal**, and that is a
> design decision, not a style choice. Because it is one value, every derived
> figure on the screen is a `computed` over it rather than a variable somebody has
> to remember to update: the running total is computed from the selected tier and
> the quantity, so it **cannot go stale**, and the ceiling on the ticket count is
> computed from the event's own remaining tickets.

> Validation is the same story from the other side. The client checks what it can
> check without a round trip — required fields, an email shape, at least one
> ticket, and whether the chosen tier has that many left — and blocks the submit
> with nothing sent. But that is a courtesy to the visitor, not the guarantee. The
> API validates the same rules again on every write, so from where I sit there are
> **two layers — the page and the API — and the API is the last one**. A duplicate
> arrives as a 409 and a delete can be refused; what the constraints underneath
> are called is my teammate's half, and I meet them as statuses and shapes I can
> render."

> 【旁注】这一段的落点句是"**浏览器校验只是礼貌，最后一个把关的是 API**"——所以只说
> **两层：页面和 API，API 是最后一层**。不要替同伴讲数据库的约束细节（唯一键和两个外键
> 在他那份稿子里），这里只讲它们以 409 和被拒绝的删除的形式到达我的界面。

---

## 3:20 - 6:50 | Q2: the registration page, from the route to the receipt

**Question 2 is data flow: how a click in the browser becomes data in the
database.** This is the deepest part of my contribution, because the registration
page is the only place where the visitor, my code, the API and the database all
have a say.

**Show:** split screen — `clientside/src/app/pages/register/register.ts` on the
left, the browser on `http://localhost:4200/register/2` with the Network tab open
on the right.

> "Two files carry this page: the component `register.ts`, which owns the form and
> every screen state, and its template `register.html`. Everything that talks to
> the server goes through the one service I just showed you, and I will come back
> to it."

### 3:20 - 4:20 | Step 1: which event, and the form as one value

**Show:** `register.ts`, `loadEvent()` and the tier `<option>`.

> "Registration is per event, so the event id travels **in the route**:
> `/register/2`. The component reads it once from the route parameters and loads
> the event with `GET /api/events/2`, so the visitor sees the name, date, venue and
> price of what they are registering for before they type anything.

> There is deliberately no route for a bare `/register`. A form that cannot know
> what it is registering for is worse than an honest answer, so the catch-all route
> shows the friendly 404 page instead. The same rule runs the other way: try
> `/register/1`, a finished event, and you get the closed panel — 'this event
> finished on Sunday 11 October 2026' — instead of a form that could only refuse the
> submission.

> The form holds **six controls**, one for each field the visitor decides: name,
> email, phone, tier, number of tickets and notes. There is deliberately **no
> registration-date control** — the date is a column the API stores, but it is not
> a decision for the person booking, so the page does not send one and the API
> records the moment of submission.

> The ticket count is a **stepper** — one value between a minus and a plus button —
> rather than a number box, because the two legal answers are 'one more' and 'one
> fewer'. The tier dropdown is built from **this event's** tiers only, and it opens
> on a tier a visitor can actually buy: on this event **Single Seat — $185.00, 196
> available**, with the total already reading *Total: 1 x $185.00 = $185*, while
> the second tier, Table of Ten, is labelled **Sold out** — it can still be
> selected, and choosing it is refused when the form is submitted, with that
> sold-out message beside the field.

> That dropdown was a real bug, and it is worth thirty seconds. It displayed a
> different tier from the one it was going to book: the select's value was bound
> with `[value]`, and its `<option>` elements are created by a loop, so on the first
> render Angular wrote the value *before* the options existed, discarded the write,
> and the browser selected the first option it had. The fix is to mark the option
> itself as selected as well as binding the select's value. Once I understood the
> cause I found the same pattern in the **language switcher** in both applications —
> and the search page's venue control, which has since become the combobox you will
> see later, so that trap cannot come back there. The switcher fix is held in place
> by a check that asserts an invariant rather than a language: the picker's value
> must be a prefix of the `<html lang>` attribute the translation service
> maintains, which holds in any language on any machine."

### 4:20 - 4:55 | Step 2: client-side validation happens first

**Do:** submit the form empty; then type an invalid email and a bad phone number.

> "Nothing was sent — the Network tab is still empty, and it will stay empty until
> the form is valid. Each problem is written next to its own field; a summary with
> `role="alert"` is announced, focus moves to the first problem, and that field is
> scrolled into view. That is the accessibility pattern on purpose: a screen reader
> announces the summary, and the focus movement takes the user to the control that
> needs fixing instead of leaving them to hunt for it. The message itself is linked
> to its input with `aria-describedby`, so the reason is read out with the field."

### 4:55 - 5:50 | Step 3: the request through the shared service

**Show:** `shared/src/api/api.service.ts`, `createRegistration()`.

> "The component calls one method — `createRegistration()` — and never builds
> `POST /events/2/registrations` itself. The service adds the base URL, the
> JSON content type, the timeout and the envelope unwrapping, so the component
> receives either the stored registration or an `ApiError`.

**Do:** submit the valid form and point at the `POST .../registrations` row in the
Network tab: status **201**, the `Location` response header, the JSON body.

> "Here is the request: **201 Created**, a `Location` header, and the stored row
> coming back — including the id the database assigned and the `totalAmount` the
> API computed from the tier price. Underneath, `HttpClient` returns an Observable
> and the component subscribes to it; that is a normal XMLHttpRequest, which is
> what the Network tab is showing you."

### 5:50 - 6:50 | Step 4: the confirmation is built from the response

**Show:** the confirmation card on the page.

> "The form is replaced by a confirmation card that is built from the **API
> response**, not from what the form thought it sent. Every line of that receipt —
> the registration id, the name, the email, the date, the tier, the quantity and
> the total — is computed from the registration the API returned. That is what lets
> me say the write really happened: the receipt on screen is the record the
> database holds. The page then re-reads the event so the 'places left' figure
> includes the booking just made.

> A failure takes the other branch, and the error handling is worth one sentence
> because it is where the 409 from the schema's unique key turns into something a
> person can act on. `ApiError` carries the status and the `details` array; a map
> puts each message onto the control that produced it; and a **409 — this email has
> already registered for this event — is shown next to the email field using our own
> translated sentence**, so a visitor reading the site in Chinese, Vietnamese or
> Japanese gets that message in their language rather than an English sentence from
> the server.

> The read path is the same shape in reverse: the search page turns its filter form
> into the API's query parameters and calls the same service, and **one** shared
> component, `event-card.ts`, turns each returned event into the card that the home
> page and the search page both use. One renderer, two pages, no duplicated
> markup."

> 【旁注】第 4 步是 Q2 的收尾，务必把"回执来自响应而不是来自表单"这句说清楚 —— 这是
> 面试常问点。提到 409 时，**先说"这是表上的唯一键决定的"**，把功劳指回同伴的设计，
> 再讲"我把它变成了邮件字段旁的一句本地化提示"。如果时间紧，第 1 步最后那段 bug 可以
> 压到 15 秒，但别整段删掉。

---

## 6:50 - 9:50 | Q3: the public website, live

**Question 3 is website functionality.** This is where I show what a visitor
actually gets.

### 6:50 - 7:40 | Home and search, and the location box that is now a real combobox

**Show:** `http://localhost:4200/`, then `/search`.

> "The home page mixes static organisation content with a dynamic listing from
> `GET /api/events/upcoming`: name, category, date, venue, price and a live
> progress bar. Six events are on it today. No suspended event appears, because
> the public view keeps only `status = 'active'`; and no past event appears,
> because this endpoint pins the listing to `upcoming` and the API applies the
> past exclusion itself — not the view. I render whatever it sends.

> The search page filters by date, location and category, singly or combined, with
> removable chips and a Clear Filters button. The whole filter form is one value in
> a signal, so clearing it is a single write — and the filters are also written
> into the **URL**, so a search can be refreshed, bookmarked or sent to someone
> else."

**Do:** click the **City** field. The suggestion panel opens **downward** under the
field, headed **Cities** and then **Venues**. Type `Lis`: three suggestions remain
— Lismore, Lismore City Hall, Lismore Riverside Park. Press Enter.

> "This is the control I rebuilt this round. It was a native `<select>`, and the
> popup of a native select is drawn by the browser: near the bottom of the window
> it opens **upward**, over its own label and the date fields. That is not a CSS
> bug I could fix — the honest way to own the direction was to own the list. It
> also had a placeholder that said 'Start typing, e.g. Lis' on a control nobody
> could type into.

> Now typing filters the list, the list is grouped into cities and venues, and it
> opens downward because the page draws it. Picking Lismore applies at once — the
> chip appears above the results, one event matches, and the URL carries
> `city=Lismore`. Typing on its own applies nothing: a half-typed word is not a
> filter the visitor has chosen.

> One honest detail about the two date fields beside it: they are native
> `<input type="date">` controls, and the placeholder inside them is painted by the
> **browser** — `mm/dd/yyyy` or `yyyy/mm/日` depending on the browser's own locale,
> not on the language picked in the header. No attribute changes that, so the field
> shows a valid example underneath instead. The value it submits is always
> `yyyy-mm-dd`."

### 7:40 - 8:40 | The event page: registrations, privacy, and no re-sorting

**Show:** `http://localhost:4200/events/2`, scrolled to the registrations panel.

> "The Register button is a real router link carrying this event's id. A **past**
> event shows a disabled button instead of a link to a form that could only
> refuse the submission: the API does not check the date — it would accept the
> insert — so closing a finished event is a page rule, and the page says why.

> Below the tickets is the registrations panel: a real `<table>` with a caption for
> screen readers and `scope` on the column headings. Each row is one registration —
> the backer, the ticket type, how many tickets, what they are worth and when they
> were bought — newest purchase first, with a totals footer. **Four** registrations
> have taken **fifteen** tickets, worth seventeen thousand four hundred and
> twenty-five dollars, and the hero reports both counts by name: '4 registrations ·
> 15 tickets sold'. One of the four is the booking I submitted a couple of
> minutes ago, which is why the figures are one higher than the seeded three.

> The names are masked, and that is the newest thing on this page. The row reads
> **Grace T.** — the database holds 'Grace Tan' — and there is no email address and
> no phone number anywhere in the table, because the public response does not carry
> them: the API sends `attendeeDisplayName` and omits the contact columns entirely.
> The sentence under the heading says so, in the visitor's language. The visitor
> who booked can still recognise their own row from the ticket count and the date
> beside it; nobody else's identity is published on a page anyone can open.

> That list is **not sorted in the browser**: the API sends it newest first —
> `registered_at` descending, with the registration id breaking ties — and this
> page renders that order as it arrives, it does not re-sort."

### 8:40 - 9:50 | The optional external API, in its four states

**Show:** the weather module on `http://localhost:4200/events/2`.

> "The brief allows an optional external API, so every event page carries a weather
> module for the day of the event, from Open-Meteo. It needs no key and no
> registration, which matters: nothing secret has to be sent to the marker.

> It lives in `shared/src/weather/weather.service.ts`. It takes the venue's
> latitude and longitude and the event date, and asks for one day in the Sydney
> timezone — the weather code, the temperature range, the rain chance and the wind.
> The WMO weather codes are mapped to **translation keys**, so the panel follows the
> language switcher like everything else.

> This is the only page that can show a forecast today, because this is the only
> public event inside Open-Meteo's sixteen-day window: partly cloudy, a high of
> twenty-seven and a low of sixteen, a sixty-seven per cent chance of rain and
> twenty-two kilometres an hour of wind when I checked. The figures move with the
> real forecast; the module does not.

> The module is **on every event** now — that is the change this round. It used to
> be wrapped in a condition, so nine of the ten public event pages had no weather
> module at all, and a visitor could not tell 'this event is too far ahead' from
> 'this page is broken'. It now names the case instead of hiding: let me show you
> the other three."

**Do:** open `/events/1` (finished), `/events/3` (more than sixteen days away) and
`/events/8` (the online venue, which has no coordinates).

> "`/events/1` has already happened, so it says *this event has already finished, so
> there is no forecast to show*. `/events/3` is more than sixteen days away, and it
> says so with the number in it — that number comes from the same configuration
> value the rule uses, so it cannot drift from four translated copies of itself.
> `/events/8` is the online venue, which has no map coordinates, so it says that.
> And if you catch a page while its request is in flight it says 'loading the
> forecast', not nothing.

> No error panel anywhere, because it is a bonus feature and not allowed to break
> the page. The service resolves `null` instead of raising for every failure — no
> coordinates, too far ahead, a past date, or Open-Meteo itself being unreachable —
> and the page distinguishes 'still loading' from 'there is nothing to show'. The
> same service is used on the admin side as a live preview on the event form."

> 【旁注】这里演示"优雅降级+说明原因"时，**先说"这个模块以前会整个消失"**，再依次
> 打开四个页面：有预报、已结束、超出 16 天、无坐标。**注意 `/events/1`、`/events/3`、
> `/events/8` 的 id 和日期要以你本机数据为准，录制前先点一遍确认**；日期没按稿子钉住
> 的话，`/events/3` 可能变成"已结束"，说的话就对不上了。页面上那几个数字是"种子 3 条
> 14 张，再加上你刚提交的 1 条 1 张"（共 4 条 15 张），重拍前先重载种子。

---

## 9:50 - 11:50 | Q3: the admin website, live

**Show:** the admin website's header and menu, on `http://localhost:4300/events`.

> "Assessment 3 also asks for an admin-side website. It is a **separate Angular
> application** on its own port — there is no second command and no second API. It
> is separate because its audience and its view of the data are different, not
> because its code is: it imports the same library, so the API layer, the models,
> the two dictionaries of four languages, the theme and the formatters are literally
> the same code.

> The menu is defined once in the application shell, so no page can forget it, and
> the header carries the same language and theme controls as the public site. The
> menu also **pins** now: scroll this table and the header goes up while the menu
> stays at the top. It did not before — it was a sticky element whose containing
> block was its own wrapper, so `top: 0` never took effect."

### 9:50 - 10:25 | The list: every event, regardless of status

**Show:** `http://localhost:4300/events`.

> "This is the requirement the public API cannot satisfy: **every** event regardless
> of status. It reads `GET /api/admin/events`, which uses the admin view, so the
> suspended event and the past events are all here — eleven of eleven. Each row
> shows the id, the event with its category and organisation, the publishing status
> and the derived upcoming-or-past state, the dates, the venue, registrations
> against capacity, and tickets sold. The filters narrow by status, time and
> keyword, and they go into the URL, so a filtered view can be refreshed or shared.

> The 'sold' column comes from `registration_count` and `tickets_sold` in the view,
> so listing eleven events is still **one** query rather than eleven."

### 10:25 - 11:10 | Create and update: the form I rebuilt

**Show:** `http://localhost:4300/events/new`.

> "The create form is not handwritten markup per field: the reactive form is built
> once by `createEventForm()`, and **one** shared `event-form` component renders it,
> so the create page and the update page cannot drift apart. The dropdowns are
> filled from `GET /api/admin/reference-data` — organisations, categories and venues
> in one request — and the form is only drawn once those lists arrive, which is what
> stops a typo becoming a foreign-key error.

> The layout is the part I reworked this round, and everything I am about to say is
> visible on this screen. The page title 'Add a charity event' and the form start on
> the **same left edge**. The form is two columns whose **first controls line up** —
> Event name on the left, 'Artwork and publishing' status on the right. The ticket
> rows run the **full width** beneath both columns. The right-hand column **follows
> the scroll** and carries the save button, so Save is on screen at every scroll
> position instead of about sixteen hundred pixels down the page. And there is no
> 'Clear the form' button any more: one misclick destroyed everything typed.

> Three smaller changes are worth pointing at. 'This is a free event' now sits
> directly above the ticket types it governs, and ticking it locks and zeroes every
> price below it — it used to live three sections away under the fundraising goal.
> The description box resizes vertically only. And the weather card in the right
> column opens with a short prompt, *choose a venue and a date to see the
> forecast*, instead of the grey 'no forecast available' paragraph it used to show
> on a form where nothing had been chosen yet.

> Ticket-tier rows can be added and removed, the same client-side validation runs
> before anything is sent, and the artwork picker offers the nine illustrations the
> project ships with, with a live preview.

> Choose a venue and a date and that card becomes the live forecast for them — the
> same service, used **before the event exists in the database**. That is the point
> of it: staff can see the beach fun run is forecast to be wet and move it while it
> is still a draft."

**Do:** change one field on `/events/2/edit` and submit, with the Network tab open.

> "Look at the request body: **only the field I changed**. The component compares the
> form against the event it loaded and sends a partial update, so there is no chance
> of a stale value silently overwriting a change someone else made. Submitting with
> nothing changed is refused with a message instead of sending a pointless request.

> Further down the same page is this event's registration list, read-only, with a
> delete on each row and a standing warning: registrations block the event delete.
> That is the rule made visible in the interface rather than only in the API."

### 11:10 - 11:50 | The delete, blocked with a clear message

**Do:** on `/events`, click **Delete** on event 1, then confirm. Then delete event
9.

> "The confirmation dialog is my own component, not the browser's `confirm()`, so it
> can explain what is about to happen. It calls `DELETE /api/events/1`, the API
> refuses it with **409 Conflict**, and that refusal is what the interface consumes:
> a warning banner whose sentence is the API's own — it names the event and the
> number of registrations — with the same name and count listed underneath from the
> structured facts, and the advice added from my **own** dictionary. The row's
> Delete button becomes **Deletion blocked** and stays disabled, so the reason is
> still visible next to the data after the banner is dismissed.

> How the server reaches that 409 is the other script's half; what mine has to do
> is receive the refusal and show why. The banner carries one link, the generic
> link to the registrations, and that is deliberate: the API sends a `suggestion`
> code, which the page maps to its own translated sentence (falling back to a
> generic refusal-and-check-the-registrations sentence for a code it does not
> recognise), so the sentence a member of staff reads is mine, in the language
> they chose. The structured facts are what I take from the response; the words
> are the client's.

> And here is the other half: an event with no registrations deletes cleanly, a
> success banner appears — 'Winter Lights Gala 2026 was deleted' — and the list
> reloads without it. Blocked and allowed, from the user's side."

> 【旁注】这一段的落点句是：**"409 的 details 给我名字和数量，界面把它变成一句可读的
> 拒绝和一行禁用的 Delete。"** 这是前后端配合最好的例子：API 给事实，界面给措辞。
> 注意不要替同伴讲事务和行锁；删活动 9 会改种子，重拍前记得重载。

---

## 11:50 - 13:20 | Q2/Q3: the shared layer both applications run on

**Show:** the folder tree — `clientside/`, `adminside/`, `shared/` — then
`shared/src/` expanded, then `angular.json`'s `paths` entry for `@charity/shared`.

> "Both websites are separate Angular applications with separate routing, separate
> layouts and separate translation dictionaries — and they share one folder of
> TypeScript instead of a built library. That was a deliberate decision.

> `shared/` is mapped with one path alias, `@charity/shared/*`. There is no second
> build product, so there is no stale-library failure mode where an app is running
> against last week's types. The cost is that the shared code is type-checked as
> part of whichever app imports it, so `npm run check:shared` type-checks it on its
> own — the one real benefit a library build would have given me, without the
> library build.

> What is actually in there is everything that must behave **identically** on both
> sides: the API layer, so there is one timeout and one error shape; the models, so
> both apps agree on what an event is; the translation service and the **two**
> dictionaries — 298 keys for the public site and 252 for the admin site, the same
> keys in all **four** languages of each; the theme service; the formatters for
> dates, money and event state; and the weather service, which the public event page
> and the admin live preview both use."

**Show:** the language switcher in the header, switching to 中文, then the theme
button, then reload the page.

> "The language service is **signal-based**, so switching language re-renders every
> translated string with no reload and no subscription to unsubscribe. The choice is
> written to `localStorage` under one shared key, which is why the public site and
> the admin site agree. On a first visit it is detected in a deliberate order: a
> stored choice, then a `?lang=` query parameter — so a shareable link can force a
> language — then the **browser's own preference**, then English.

> Watch the header while I do it, because that was a defect this round. The labels
> never wrap, the header is **65 pixels tall in all four languages**, and the
> language picker and the theme button stay exactly where they are. It used to
> move: a sentence about the switcher lived inside the header, only appeared when
> the interface was not English, and made the header up to **twenty-four pixels**
> taller. That sentence now sits in its own band **below** the header, where it can
> grow without touching anything: *'Interface language only; event details stay in
> English.'*

> And that sentence is the honest limit of the translation. All the **interface**
> text is translated — 298 keys on this site, 252 on the admin site, the same keys
> in all four languages, down to each page's browser tab title — and a checker that
> fails if an English word is left inside a Chinese, Vietnamese or Japanese value.
> The **content** — event names, descriptions, venues, organisers — is English by
> design, because it comes from the database and the brief defines that data in
> English. The band under the header says so, rather than pretending otherwise.

> The theme is light, dark or system, and it is written onto the `<html>` element as
> a `data-theme` attribute. There is also a small inline script in both
> `index.html` files that applies the stored theme **before** Angular loads.
> Without it, a dark-theme user gets a white flash on every page load — a one-line
> fix for a defect that is invisible until you record a video of it."

> 【旁注】这一段是"架构决策"得分点，务必说出**代价**（没有独立类型检查 → 用
> check:shared 补上）。只讲好处会被追问。主题闪烁那段很适合现场演示：切到 dark，
> 按 F5，说明为什么不会白闪。**语言切换那一下要盯着页头看**：四个语言页头一样高、
> 控件不动，切换说明的那句话在页头**下面**。同时要把"内容仍是英文"说清楚，别把
> "界面翻译"说成"整站翻译"。

---

## 13:20 - 14:30 | Closing: what my half is

> "To summarise my half: the public site takes a registration from the form to the
> database and shows the receipt the API returned; it lists who is coming without
> publishing anyone's contact details; it explains its own weather module in four
> languages instead of hiding it; the admin site manages events with the same shared
> library, and turns the schema's uniqueness and delete rules into messages and
> actions a member of staff can act on. Both applications are one shared TypeScript
> library and two Angular shells. The server half is covered by the other script.
> Thank you for watching."

**Stop recording.**

> 【旁注】最后一句总结只讲**你的**部分（前端），不要替同伴总结后端。结尾
> "Thank you for watching" 说完停两秒再停止录制，方便剪辑。
