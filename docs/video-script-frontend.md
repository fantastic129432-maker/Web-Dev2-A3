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

## Timing plan (13:34, computed from the words and the actions)

Every row is `spoken words ÷ 140 × 60 + action seconds`, with 15-25 seconds of
action time for each demonstrated step. The script carries about **1,267 spoken
words**: 9:03 of speech plus 4:31 of screen actions. That leaves about 86 seconds
of slack under the 15-minute limit, so a slow step cannot push the take over.

| Time | Section | Words | Speak | Actions | Total | Question |
| --- | --- | --- | --- | --- | --- | --- |
| 0:00 - 0:41 | Introduction and my role | 61 | 0:26 | 0:15 | 0:41 | - |
| 0:41 - 3:07 | Q1: the API contract, and the client decisions built on it | 223 | 1:36 | 0:50 | 2:26 | Q1 |
| 3:07 - 5:45 | Q2: the registration page, from the route to the receipt | 284 | 2:02 | 0:36 | 2:38 | Q2 |
| 5:45 - 8:53 | Q3: the public website, live | 276 | 1:58 | 1:10 | 3:08 | Q3 |
| 8:53 - 11:49 | Q3: the admin website, live | 247 | 1:46 | 1:10 | 2:56 | Q3 |
| 11:49 - 13:14 | Q2/Q3: the shared layer both applications run on | 129 | 0:55 | 0:30 | 1:25 | Q2, Q3 |
| 13:14 - 13:34 | Closing: what my half is | 47 | 0:20 | - | 0:20 | - |
| **Total** | | **1,267** | **9:03** | **4:31** | **13:34** | |

If you are running long, skip the beats marked **✂ skip if long** in the body.
Never skip the registration page, the admin delete, the forecast on the event page
or the combobox — those are the four things only this video shows.

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
> 打开并清空**，否则提交表单时看不到那一条 POST。把浏览器缩放调到 125%，否则代码字体
> 在录像里看不清。**把 `DEMO_TODAY` 写进 `api/.env` 并重启**，否则天气那一段会变成"每个
> 页面都没有预报"，和稿子里写的四态对不上。**每次重拍前都要重载种子**，否则报名总数会
> 比稿子里多一条，管理员列表也会少一行（删除那一段会删掉种子里的活动 9）。

---

## 0:00 - 0:41 | Introduction and my role

**Show:** the public site, then the admin site's event list, for five seconds each.

> "Hello, my name is _[name]_, student number _[number]_. This is my Assessment 3
> submission for PROG2002 Web Development II.

> My contribution is the **client side**: two Angular 22 applications — the public
> charity events website and the separate admin website — plus the shared TypeScript
> library both import. My teammate built the database and the API; the server half
> is the other script."

> 【旁注】开场 20 秒内必须出现 "My contribution is the client side"，这是评分点。
> 不要花时间介绍慈善机构的背景，A2 视频已经讲过了。

---

## 0:41 - 3:07 | Q1: the API contract, and the client decisions built on it

**Question 1 asks about the database and API architecture.** That is my teammate's
part, so I will not re-explain the SQL. What I can answer is the part that is mine:
the contract I needed from that half, and the decisions I built on it.

### 0:41 - 1:44 | What the contract gives me, and what it does not

**Show:** Postman — `GET /events/2` for the `registrations` array, then one failing
write: a 400 that carries a `details` array, and a blocked delete that carries the
structured facts.

> "A duplicate arrives as a **409 Conflict** and a delete can be refused: the 409
> goes on the email field; a refused delete is visible **before** staff click it.

> The detail endpoint owns the newest-first order, by `registered_at` descending, so
> my page must **not** re-sort. The public response carries a masked display name
> and no contact details.

> Every endpoint answers with `{ success, meta, data }`; a 400 carries a `details`
> array of invalid fields; a blocked delete carries `eventId`, `eventName` and
> `registrationCount`. `details` paints each message beside its control; the delete
> maps the `suggestion` code to my **own** translated sentence."

> 【旁注】这一段的关键动作：**把 API 的响应当作"契约"来讲，而不是讲 SQL**。拿起
> Postman 指 `details` 数组、`suggestion` 字段、`attendeeDisplayName` 各两秒就够了。
> 如果被问"这个表为什么这样设计"，回答：**"That is my teammate's part — what I can
> tell you is what I needed from it and why"**，不要硬答列类型。注意口径：只说这两个
> 约束以 **409** 和被拒绝的删除到达我的界面，唯一键和外键的细节留给同伴；排序规则是
> **API 的**，别把 API 的规则说成数据库约束。

### 1:44 - 2:31 | One way to talk to the API, one shape to render

**Show:** `shared/src/api/api.service.ts` — `ApiService.send()` and
`normalise()`.

> "`ApiService` is the **only** place either application talks to the server; no
> component calls `fetch` or builds a URL. It builds the URL from an injected
> `API_BASE_URL` token, puts a **ten-second timeout** on every call, and normalises
> every failure into one `ApiError`.

> A 400's `details` becomes a field-to-message map, and a 409 keeps its structured
> facts. It unwraps the envelope, and a **204 resolves to `null`**, because a delete
> has no body to parse."

### 2:31 - 3:07 | Form state and validation: the client's side of the contract

**Show:** `clientside/src/app/pages/register/register.ts`, the `RegistrationForm`
interface and `totalLine`.

> "The form is **one object in a signal**, so the running total is `computed` and
> cannot go stale. Client validation is a courtesy: the API validates the same rules
> again, so there are **two layers — the page and the API — and the API is the last
> one**."

> 【旁注】这一段的落点句是"**浏览器校验只是礼貌，最后一个把关的是 API**"——所以只说
> **两层：页面和 API，API 是最后一层**。不要替同伴讲数据库的约束细节（唯一键和两个外键
> 在他那份稿子里），这里只讲它们以 409 和被拒绝的删除的形式到达我的界面。

---

## 3:07 - 5:45 | Q2: the registration page, from the route to the receipt

**Question 2 is data flow: how a click in the browser becomes data in the
database.** This is the deepest part of my contribution, because the registration
page is the only place where the visitor, my code, the API and the database all
have a say.

**Show:** split screen — `clientside/src/app/pages/register/register.ts` on the
left, the browser on `http://localhost:4200/register/2` with the Network tab open
on the right.

> "Two files carry this page: the component `register.ts` and its template.
> Everything that talks to the server goes through that one service."

### 3:07 - 4:01 | Step 1: which event, and the form as one value

**Show:** `register.ts`, `loadEvent()` and the tier `<option>`.

> "Registration is per event, so the id travels **in the route**: `/register/2`.
> The component reads it once and loads the event with `GET /api/events/2`. No bare
> `/register`: the catch-all shows the 404 page.

> The form has **six controls** and deliberately **no date control** — the API
> records the moment of submission. The ticket count is a **stepper**; the tier
> dropdown is built from **this event's** tiers: Single Seat, $185.00, and Table of
> Ten labelled **Sold out**.

> That dropdown was a real bug: `[value]` was written before the loop created the
> options, so the browser selected the first option; the fix marks the option
> selected too."

**✂ skip if long:** the two-sentence tier-dropdown bug story at the end of step 1.

### 4:01 - 4:35 | Step 2: client-side validation happens first

**Do:** submit the form empty; then type an invalid email and a bad phone number.

> "Nothing was sent — the Network tab is still empty. Each problem is written next
> to its own field; a summary with `role="alert"` is announced, focus moves to the
> first problem, and `aria-describedby` links the message to its input."

### 4:35 - 5:13 | Step 3: the request through the shared service

**Show:** `shared/src/api/api.service.ts`, `createRegistration()`.

> "The component calls one method, `createRegistration()`, and never builds the URL;
> the service adds the base URL, the JSON type, the timeout and the unwrapping. The
> response is **201 Created** with a `Location` header and the stored row — the id
> and the `totalAmount` the API computed."

**Do:** submit the valid form and point at the `POST .../registrations` row in the
Network tab: status **201**, the `Location` response header, the JSON body.

### 5:13 - 5:45 | Step 4: the confirmation is built from the response

**Show:** the confirmation card on the page.

> "The confirmation card is built from the **API response**, not from what the form
> sent: every line — id, name, email, date, tier, quantity, total — comes from the
> returned registration: the receipt is the record the database holds.

> A failure takes the other branch: `ApiError` carries `details`, and a **409 — the
> table's unique key at work — means this email has already registered; the message
> appears next to the email field in our own translated sentence**."

> 【旁注】第 4 步是 Q2 的收尾，务必把"回执来自响应而不是来自表单"这句说清楚 —— 这是
> 面试常问点。提到 409 时，**先说"这是表上的唯一键决定的"**，把功劳指回同伴的设计，
> 再讲"我把它变成了邮件字段旁的一句本地化提示"。如果时间紧，第 1 步最后那段 bug 可以
> 按 ✂ 标记跳过，但别整段删掉。

---

## 5:45 - 8:53 | Q3: the public website, live

**Question 3 is website functionality.** This is where I show what a visitor
actually gets.

### 5:45 - 6:53 | Home and search, and the location box that is now a real combobox

**Show:** `http://localhost:4200/`, then `/search`.

> "The home page mixes static content with `GET /api/events/upcoming`: six events.
> No suspended event appears — the public view keeps only
> `status = 'active'`; no past event, because the endpoint pins the listing to
> `upcoming` and the API excludes the past itself.

> Search filters by date, location and category; the form is one signal, and the
> filters go into the **URL**.

**Do:** click the **City** field. The suggestion panel opens **downward** under the
field, headed **Cities** and then **Venues**. Type `Lis`: three suggestions remain
— Lismore, Lismore City Hall, Lismore Riverside Park. Press Enter.

> "The city field is a **combobox** I rebuilt: a native select's popup opens
> **upward** near the window's bottom. Typing filters it; picking Lismore writes
> `city=Lismore`; typing alone applies nothing."

**✂ skip if long:** the two date fields are native inputs, so their placeholder is
painted by the browser's locale; the value they submit is always `yyyy-mm-dd`.

### 6:53 - 7:45 | The event page: registrations, privacy, and no re-sorting

**Show:** `http://localhost:4200/events/2`, scrolled to the registrations panel.

> "The Register button is a real router link. A **past** event shows a disabled
> button, because the API does not check the date, so closing it is a page rule.

> The registrations panel is a real `<table>`: each row is one registration, newest
> first. **Four** registrations have taken **fifteen** tickets worth **$17,425**.

> Names are masked — **Grace T.** — with no email or phone, because the public
> response sends `attendeeDisplayName` and omits the contact columns. The list is
> **not sorted in the browser**: the API sends newest first."

### 7:45 - 8:53 | The optional external API, in its four states

**Show:** the weather module on `http://localhost:4200/events/2`.

> "The optional external API is Open-Meteo: no key, no registration. The shared
> service takes the venue's latitude and longitude and the event date, asks for one
> day in the Sydney timezone, and maps the WMO codes to **translation keys**.

> This is the only page with a forecast today, because it is the only public event
> inside the sixteen-day window.

> It is **on every event** now; it used to be hidden by a condition, so nine of ten
> pages showed nothing. It names the finished, too-far, no-coordinate and loading
> cases, and resolves `null` for every failure, so the bonus cannot break the page."

**✂ skip if long:** opening `/events/1`, `/events/3` and `/events/8`; keep the
forecast on this page and the one-sentence summary of the other states.

> 【旁注】这里演示"优雅降级+说明原因"时，**先说"这个模块以前会整个消失"**，再依次
> 打开四个页面：有预报、已结束、超出 16 天、无坐标。**注意 `/events/1`、`/events/3`、
> `/events/8` 的 id 和日期要以你本机数据为准，录制前先点一遍确认**；日期没按稿子钉住
> 的话，`/events/3` 可能变成"已结束"，说的话就对不上了。页面上那几个数字是"种子 3 条
> 14 张，再加上你刚提交的 1 条 1 张"（共 4 条 15 张），重拍前先重载种子。

---

## 8:53 - 11:49 | Q3: the admin website, live

**Show:** the admin website's header and menu, on `http://localhost:4300/events`.

> "The admin site is a **separate Angular application** on its own port, with no
> second API. It imports the same shared library, and the menu, defined once in the
> shell, now pins while the table scrolls."

### 9:23 - 9:39 | The list: every event, regardless of status

**Show:** `http://localhost:4300/events`.

> "**Every** event regardless of status: this reads `GET /api/admin/events`, the
> admin view, so the suspended and past events are here — eleven of eleven. The
> 'sold' column comes from the view, so eleven events are still **one** query."

### 9:39 - 11:01 | Create and update: the form I rebuilt

**Show:** `http://localhost:4300/events/new`.

> "The create form is built once by `createEventForm()` and rendered by **one**
> shared `event-form`, so create and update cannot drift; its dropdowns load once
> from `reference-data`.

> The layout is what I reworked: title and form share a **left edge**, and the right
> column follows the scroll and carries Save, so Save is always on screen.

> On update, the body contains **only the field I changed**, so a stale value
> cannot overwrite someone else's change, and a no-change submit is refused."

**Do:** change one field on `/events/2/edit` and submit, with the Network tab open.

> "That is the partial update: one field in the body, and the event's registration
> list further down is read-only, with a standing warning that registrations block
> the delete."

### 11:01 - 11:49 | The delete, blocked with a clear message

**Do:** on `/events`, click **Delete** on event 1, then confirm. Then delete event
9.

> "The confirmation dialog is my own component. `DELETE /api/events/1` is refused
> with **409 Conflict**: the banner names the event and the registration count, and
> the advice is my **own** translated sentence. The row's Delete becomes **Deletion
> blocked**. How the server reaches that 409 is the other script's half; mine
> receives the refusal and shows why.

> An event with no registrations deletes cleanly and the list reloads."

> 【旁注】这一段的落点句是：**"409 的 details 给我名字和数量，界面把它变成一句可读的
> 拒绝和一行禁用的 Delete。"** 这是前后端配合最好的例子：API 给事实，界面给措辞。
> 注意不要替同伴讲事务和行锁；删活动 9 会改种子，重拍前记得重载。

---

## 11:49 - 13:14 | Q2/Q3: the shared layer both applications run on

**Show:** the folder tree — `clientside/`, `adminside/`, `shared/` — then
`shared/src/` expanded, then `angular.json`'s `paths` entry for `@charity/shared`.

> "Both websites are separate Angular applications and share one folder of
> TypeScript instead of a built library: one alias, no second build product, no
> stale-library failure. The cost: the shared code is type-checked with whichever app
> imports it, so `npm run check:shared` checks it.

> It holds what must behave **identically**: the API layer, the models, two
> dictionaries — 298 keys for the public site, 252 for the admin site, the same keys
> in all **four** languages — the theme, the formatters and the weather service.

> The language service is **signal-based**, so switching re-renders every string
> with no reload, and the choice goes to `localStorage`. The header is **65 pixels
> tall in all four languages**, and the switcher sentence sits below it. The
> interface is translated; the **content** stays English by design."

**Show:** the language switcher in the header, switching to 中文, then the theme
button.

**✂ skip if long:** the theme demonstration. The theme is light, dark or system,
written onto `<html>` as `data-theme`, and a small inline script in both
`index.html` files applies the stored theme before Angular loads, which is what
prevents a white flash on a dark-theme reload.

> 【旁注】这一段是"架构决策"得分点，务必说出**代价**（没有独立类型检查 → 用
> check:shared 补上）。只讲好处会被追问。主题闪烁那段很适合现场演示：切到 dark，
> 按 F5，说明为什么不会白闪（时间紧就按 ✂ 跳过）。**语言切换那一下要盯着页头看**：
> 四个语言页头一样高、控件不动，切换说明的那句话在页头**下面**。同时要把"内容仍是
> 英文"说清楚，别把"界面翻译"说成"整站翻译"。

---

## 13:14 - 13:34 | Closing: what my half is

> "To summarise my half: the public site takes a registration and shows the receipt
> the API returned; it lists attendees without contact details; it explains its
> weather; the admin site turns the schema's rules into messages staff can act on.
> The server half is the other script."

**Stop recording.**

> 【旁注】最后一句总结只讲**你的**部分（前端），不要替同伴总结后端。最后一句说完
> 停两秒再停止录制，方便剪辑。
