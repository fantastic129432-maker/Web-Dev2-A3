# Demo video script — **server side** (database, API and deployment)

PROG2002 Web Development II — **Assessment 3**

**This script is for:** the member responsible for the **server side** — the MySQL
schema, the NodeJS + Express API written in TypeScript (`api/`), and the deployment
of the API to the cPanel host.

**Partner script:** `video-script-frontend.md` covers the two Angular websites and
the shared library. Each script answers all three required questions, but this one
goes **deep on the database and the API** and treats the websites as the clients
that consume this API.

> 【为什么是两份】A3 要求视频"focus on your own contribution"，并且**三个问题都要答**。
> 所以两份稿子都要完整回答 Q1/Q2/Q3，差别在于哪一块讲深。属于同伴的部分（Angular
> 组件、信号、CSS）在本稿里只出现到"我的 API 给他们返回了什么、他们拿它做了什么"，
> 不要替他讲前端实现 —— 面试被追问会答不上来。

## Timing plan (14:30, leaving 30 seconds of slack under the 15-minute limit)

| Time | Section | Question | Depth |
| --- | --- | --- | --- |
| 0:00 - 0:50 | Introduction and my role | - | - |
| 0:50 - 3:00 | Q1: the new table and every constraint on it | Q1 | **deep** |
| 3:00 - 4:00 | Q1: the views, and why a view and not a generated column | Q1 | **deep** |
| 4:00 - 5:00 | Q1: `event_db.ts`, the connection pool and the transaction helper | Q1 | **deep** |
| 5:00 - 7:30 | Q1: the full C.R.U.D. cycle in Postman | Q1 | **deep** |
| 7:30 - 9:30 | Q1: the delete data-integrity rule, live, both directions | Q1 | **deep** |
| 9:30 - 11:00 | Q2: the request lifecycle, from HTTP to the database | Q2 | **deep** |
| 11:00 - 11:45 | Q3: the two websites running against this API | Q3 | brief |
| 11:45 - 13:30 | Testing, the TypeScript migration and code quality | - | **deep** |
| 13:30 - 14:30 | Deployment and closing | - | brief |

If you are running long, cut the registration-endpoint part of the Postman section
(step 5 and 6) — the delete rule in section 7:30 is the requirement the brief
singles out and must never be cut.

---

## Before you record

Mechanics (OBS, exact URLs, what to have open, how to silence the machine) are in
`video-recording-guide.md`. The short version:

1. `npm start` from the project root. It compiles the TypeScript API first and then
   serves it together with both websites. **Do not skip this** — the API that runs is
   the compiled `api/dist`, and `npm start` rebuilds it from `api/src` for you.
2. Open: MySQL Workbench with `charityevents_db` connected, Postman with the
   collection `docs/postman/PROG2002-A2-Charity-Events-API.postman_collection.json`
   imported, VS Code with `api/src` open, and a terminal.
3. In Postman, have the folder **Assessment 3 — the write endpoints** expanded and
   the **Collection Runner** closed. Nothing has to be typed during the recording.
4. Rehearse once without recording.

> 【录制前检查】**先 `npm start` 再开 OBS**，否则 Postman 打到的是一个没编译的 API。
> Postman 的 collection 变量 `{{newEventId}}` 只有在"创建"那条请求跑过之后才有值，
> **所以第 5 步必须按顺序走**，不能跳到中间演示 —— 提前演练一遍确认 id 串起来了。
> 把 Workbench 的字体调大，否则 SQL 结果在录像里看不清。

---

## 0:00 - 0:50 | Introduction and my role

**Show:** the Postman collection on the left, MySQL Workbench on the right.

> "Hello, my name is _[name]_, student number _[number]_. This is my Assessment 3
> submission for PROG2002 Web Development II.

> My contribution is the **server side of the project**: the MySQL database, the
> RESTful API built with NodeJS and Express and written entirely in TypeScript, and
> the deployment of that API. My teammate built the two Angular websites; I will
> show you exactly what they receive from my API and where our two halves meet.

> In Assessment 2 the API was read-only and written in JavaScript. For Assessment 3
> I added the registration table, completed the C.R.U.D. cycle with the write
> endpoints, and moved the whole server to TypeScript — compiled by `tsc` into
> `api/dist`, which is what actually runs."

> 【旁注】开场就把分工说清楚："My contribution is the server side" + 一句提到同伴做前端。
> 不要花时间讲慈善机构背景。

---

## 0:50 - 3:00 | Q1: the new table and every constraint on it

**Show:** MySQL Workbench, `charityevents_db` expanded, **Tables** (seven) and
**Views** (five). Then `database/01_schema.sql`, section 7, `event_registrations`.

> "Assessment 3 asked for one new table, `event_registrations`, recording who
> registered for which event. Every constraint on it is a rule from the brief
> expressed as a database constraint rather than as code — and there are six of
> them.

**Show:** the `UNIQUE KEY uq_registration_event_email` line.

> "**First, the uniqueness rule.** The unique key is on the **pair**
> `(event_id, attendee_email)`, not on the email alone. The brief says a user may
> register for multiple events but can only register for an event once. A unique key
> on the email alone would break the first half of that sentence — the same person
> could never register for a second event. On the pair, the same email twice for
> event one is a duplicate, and the same email for event one and event two is
> perfectly fine.

**Show:** the two `CONSTRAINT fk_...` lines.

> "**Second and third, the two foreign keys.** `event_id` points at `events` and is
> `ON DELETE RESTRICT` — that is the database-level half of 'an event can only be
> deleted when it has not yet received any registrations', and I will demonstrate it
> in both directions in a moment.

> `ticket_type_id` is **nullable** and points at `ticket_types`, which guarantees the
> chosen tier actually exists, and that a registration with no tier — general entry —
> is still allowed.

> Now, the honest part. The obvious stronger design is a **composite** foreign key on
> `(event_id, ticket_type_id)`, which would prove in the database that the tier
> belongs to the *same* event as the registration. I tried it, and MySQL refuses it
> here for two separate reasons, both of which I found by loading the schema rather
> than by reading the manual:

> — **ERROR 6125**: a foreign key may not reference a unique key that shares its
> leading column with another unique index on that table, and `ticket_types` already
> has `PRIMARY KEY (ticket_type_id)` plus `UNIQUE (event_id, ticket_name)`.
> — **ERROR 3109**: the usual workaround — a generated column holding the pair — may
> not refer to an `AUTO_INCREMENT` column.

> So that particular rule is enforced in the API instead, and this is the design
> decision I would most expect to be asked about. I could have enforced it with a
> trigger, but a trigger is invisible to anyone reading the schema and would move a
> rule that already works, and is already tested, into a place the marker has to go
> looking for. The API rule is the documented behaviour; the single-column foreign
> key is the safety net. The reasoning is written as a comment beside the constraint
> in the schema file, so the next person to read it does not have to rediscover it.

**Show:** the two `CHECK` constraints.

> "**Fifth and sixth, two CHECK constraints**: the number of tickets purchased must
> be at least one, and the email must look like an email — a percent-at-percent
> pattern that has to match. Those mean a registration can never be stored with zero
> tickets or with an empty email, whatever the client sends.

> The remaining columns mirror what the brief says to store: the attendee's name,
> email and optional phone, the number of tickets purchased, when they registered,
> and a notes field. `idx_registrations_event` is on `(event_id, registered_at)`
> specifically, because that is the exact shape of the query behind the event page's
> registration list."

**Do:** in Workbench, run:

```sql
USE charityevents_db;

-- the table exists and holds the seeded rows
SELECT COUNT(*) AS registrations FROM event_registrations;               -- 20
SELECT SUM(tickets_purchased) AS tickets_sold FROM event_registrations;  -- 49

-- the unique key IS the rule from the brief: this must fail
INSERT INTO event_registrations (event_id, attendee_name, attendee_email, tickets_purchased)
VALUES (1, 'Duplicate Tester', 'amelia.hartley@example.com', 1);
```

> "That insert fails with a duplicate entry for key
> `uq_registration_event_email`. That error is the brief's rule, enforced by the
> database itself — not by the website and not by my API code."

> 【旁注】这一段有两个加分动作：**① 承认复合外键做不了，并说出两条 MySQL 错误号**；
> **② 说明为什么不用触发器**。这是"理解概念"的直接证据，不要跳。执行那条 INSERT 时
> 故意让它报错，报错信息就是你的证据。

---

## 3:00 - 4:00 | Q1: the views, and why a view and not a generated column

**Show:** the five views in the SCHEMAS panel.

> "There are five views. Assessment 2 had two; Assessment 3 adds three, and the
> reason one of them exists is worth a sentence because it is a MySQL limitation
> rather than a preference.

> `vw_event_progress` exposes the raised amount and the progress percentage.
> MySQL **cannot reference another table inside a generated column**, so a running
> total that depends on the donations table cannot be a stored computed column — it
> has to be a view. That is why the progress bar on the website is computed by the
> database and not by the browser.

> `vw_event_columns` holds every event column joined to its lookups — organisation,
> category, venue — plus `registration_count` and `tickets_sold`. It is the single
> column list that the other listings are defined from.

> `vw_public_events` is now literally one line: `SELECT * FROM vw_event_columns
> WHERE status = 'active'`. The public rule has not changed since A2 — it is just
> expressed once and reused. `vw_all_events` is the same rows **without** the status
> filter, and only the admin website reads it. Because both listings share one column
> list, they cannot drift apart: adding a column in one place adds it to both.

> `vw_event_registrations` adds the ticket name, the price and a computed
> `total_amount` to each registration, which is where the `totalAmount` in the API's
> response comes from.

> The point of putting the joins in views is that the API then reads one thing. The
> repositories query a view, not five joined tables, so a change to the schema shows
> up in one place."

> 【旁注】讲 `vw_event_progress` 时把"MySQL 不能在 GENERATED COLUMN 里引用别的表"说清楚 ——
> 这是"为什么用视图"的硬理由，比"视图好看"有力得多。

---

## 4:00 - 5:00 | Q1: `event_db.ts`, the connection pool and the transaction helper

**Show:** `api/src/db/event_db.ts`.

> "`event_db.ts` is the required file that connects Node to MySQL, and it is
> TypeScript now. It holds a **connection pool**, not a single connection, so
> concurrent requests do not queue behind each other, and the pool is closed on
> `SIGINT` and `SIGTERM` so a restart does not leak connections.

> Assessment 3 added one thing to it: a **`transaction()` helper**. It takes a
> callback, hands it one connection inside `BEGIN`, commits if the callback
> returns, and **rolls back if it throws** — and the connection is released in a
> `finally`, so a failed transaction cannot leak it back into the pool in a bad
> state. Exactly two operations need that, and the delete rule is one of them.

> Its `ping()` also reports whether the `event_registrations` table exists, so
> `GET /api/health` answers 'was the new table created?' in a single request. That
> is what I check first on the deployed server, and it is how I can tell a
> configuration problem from a code problem."

**Show:** `api/dist/server.js` in the file tree next to `api/server.ts`.

> "The compiled JavaScript is what actually runs. `api/server.ts` and everything
> under `api/src/` are compiled by `tsc` into `api/dist/`, and `api/dist/server.js`
> is the entry point — locally **and** on the cPanel, whose Node version cannot run
> TypeScript directly. A `ts-node` loader would mean shipping a development
> dependency into the deployment, so compiling ahead of time is the honest option."

> 【旁注】`transaction()` 的 `finally` 里释放连接是加分细节（漏了会连接泄漏）。健康检查
> 里报告表是否存在也很实用，一句话带过即可。

---

## 5:00 - 7:30 | Q1: the full C.R.U.D. cycle in Postman

**Show:** `api/src/routes/apiRoutes.ts`, then the layering.

> "The API follows a layered structure: **routes** decide the URL, **controllers**
> deal with HTTP, **services** validate and hold the business rules,
> **repositories** hold the SQL, and `event_db.ts` talks to MySQL. A layer only
> knows the layer below it — that is what let me convert the whole `api/src` tree to
> TypeScript **without a single behavioural change**.

> Assessment 2 was read-only. Assessment 3 completes the C.R.U.D. cycle:
> `POST /api/events` to create, `PUT /api/events/:id` to update,
> `DELETE /api/events/:id` to delete, plus the registration endpoints.

> One decision worth explaining: the write handlers are mounted **twice** — under
> `/api/events` and under `/api/admin/events` — and both mounts call the same
> controller functions. So there is exactly one implementation of each rule and no
> chance of the two drifting apart. The admin mount exists because the admin list
> must include suspended events, and hiding that behind `/api/admin` means a public
> caller cannot reach it by accident."

**Show:** Postman. Every request below already exists in the collection, so nothing
has to be built by hand. Two things make that possible: the requests use
**collection variables** rather than literal ids — `{{newEventId}}` is saved by the
create request's test script — and the **order matters**, so the folder is run from
its first request onwards.

| Step | Folder and request | Expect |
| --- | --- | --- |
| 1 | `Event detail` → `/events/{{eventId}}  (full detail)` | 200 |
| 2 | `Assessment 3 - the write endpoints` → `Events` → `POST /events  (create, and save the id)` | 201 |
| 3 | `Events` → `POST /events  (missing required fields)  -> 400` | 400 |
| 4 | `Events` → `PUT /events/{{newEventId}}  (partial update, two fields)` | 200 |
| 5 | `Registrations` → `POST /events/{{newEventId}}/registrations  (register, and save the id)` | 201 |
| 6 | `Registrations` → same request, sent again unchanged | 409 |
| 7 | `Registrations` → `DELETE /events/{{newEventId}}  (blocked while it has registrations)` | 409 |
| 8 | `Registrations` → `DELETE /registrations/{{registrationId}}  (204, unblock the event)` | 204 |
| 9 | `Registrations` → `DELETE /events/{{newEventId}}  (204, the event that was created)` | 204 |

**Do:** run steps 1 to 4, pointing at the status codes and headers as you go.

> "Step 1: 200, the full detail. Notice this response also carries the event's
> registrations, ordered by `registered_at` descending — the brief asks for 'sorted
> by the latest date when the tickets were purchased' — with `ticketName`,
> `ticketPrice` and a computed `totalAmount`. The registration id is the tie-breaker,
> so two registrations made in the same second still order predictably.

> Step 2: **201 Created** with a `Location` header pointing at the new resource —
> `/api/events/12` — which is the RESTful way to say 'it exists and here is where'.
> The body is the created event read back through the admin view, so a create
> response looks exactly like a later read of the same event. That id is saved into
> the `{{newEventId}}` variable by this request's test script, which is why no URL
> has to be edited between steps.

> Step 3: **400**, and this is the part I would point a marker at. The validation
> collects **every** problem and returns one response with a `details` array — the
> field name and the message for each one. A client can paint each message next to
> its own control and the user fixes the form in one pass, instead of playing
> whack-a-mole one error at a time.

> Step 4: an update is **partial**. Only the fields present in the body are validated
> and changed; here just the goal and the capacity, with the dates, venue,
> description and ticket tiers untouched. The admin update page uses exactly this —
> it sends only the fields the user edited, so there is no way for a stale value to
> overwrite a change somebody else made."

**Do:** run steps 5 and 6 (the registration endpoints).

> "A registration is created **inside** the event it belongs to, which is why the
> URL is `/events/{{newEventId}}/registrations` rather than a verb. The first attempt
> is a 201 with a `Location` and saves the new id into `{{registrationId}}`. The
> second attempt, sent unchanged, is a **409 Conflict** — that email has already
> registered for this event. Note the API checks this **before** the insert, so the
> caller gets a readable message naming the event instead of a raw duplicate-key
> error from the driver. The same email against a *different* event would be
> allowed: that is the pair rule from the schema."

> 【旁注】第 3 步（400 + `details` 数组）和第 4 步（部分更新）是"设计得好"的证据，各花
> 20 秒。第 6 步的 409 要和第 7 步的 409 区分开：**一个是重复报名，一个是删除被阻止**，
> 说清楚是两回事。

---

## 7:30 - 9:30 | Q1: the delete data-integrity rule, live, both directions

This is the A3 requirement the brief singles out. Demonstrate it **both** ways.

### 7:30 - 8:10 | The code behind it

**Show:** `api/src/repositories/write.repository.mysql.ts`, `deleteEvent()`, then
`api/src/services/eventWriteService.ts`, `deleteEvent()`.

> "The rule is: an event that has received registrations must not be deleted. The
> check and the delete run inside **one transaction**. I select the event row
> `FOR UPDATE`, which locks it, then count the registrations, and delete only when
> the count is zero.

> The lock is the important part, and it is the answer to 'why not just check the
> count?'. Without it, two requests could interleave: request A counts zero
> registrations, request B inserts one, request A deletes the event — and the
> registration B just created is orphaned. Locking the row first means the count
> cannot go stale between the check and the delete.

> When the count is not zero, nothing was written, so the transaction simply ends
> and the service answers **409 Conflict**. 409 rather than 400 on purpose: the
> request is perfectly well formed and the event exists — it is the current **state
> of the data** that prevents it. A 400 would tell the client to fix its request,
> which is the wrong advice."

### 8:10 - 8:50 | The blocked delete

**Do:** in `Registrations`, send
`DELETE /events/{{newEventId}}  (blocked while it has registrations)`.

> "**409 Conflict.** The message names the event and the number of registrations,
> and it tells the user what to do instead: set the status to suspended. There is
> also a machine-readable part — `details.suggestion` is `suspend-instead` — and
> that field is the reason the admin page can offer the alternative as a **link**
> rather than printing a sentence. Structured details rather than a sentence is what
> lets a client act on the failure."

### 8:50 - 9:30 | The successful delete, and the second line of defence

**Do:** send `DELETE /registrations/{{registrationId}}  (204, unblock the event)`,
then `DELETE /events/{{newEventId}}  (204, the event that was created)`.

> "The first request removes the registration that was blocking the delete; the
> second is the **same endpoint that answered 409 a moment ago**, on the same event.
> Nothing else changed — that is the whole point of the pair.

> **204 No Content** is the RESTful answer to 'it is gone'. A 204 carries no body,
> so the outcome is repeated in headers the client can read: `X-Deleted-Event-Id`
> and `X-Deleted-Event-Name`. Those headers are listed in
> `Access-Control-Expose-Headers`, because a browser hides custom headers from
> JavaScript otherwise, and a header the client cannot read is not an API.

> Both directions use an event this demo created, and the successful delete removes
> that same event once its registration is gone, so the seeded data is left exactly
> as it was found — which is also what lets the whole collection be run top to
> bottom repeatedly.

> Finally, the second line of defence. Suppose I deleted the whole check from my
> code. MySQL would still refuse the delete, because the foreign key is
> `ON DELETE RESTRICT`: those registration rows point at the event, so the event
> cannot disappear. The driver error `ER_ROW_IS_REFERENCED_2` is translated into
> **exactly the same 409**, so a caller cannot tell which defence stopped it — and
> does not need to. One rule, two layers, one observable behaviour."

> 【旁注】**这是全稿最重要的一段**。三句话必须说清楚：① `FOR UPDATE` 防的是什么并发
> 场景；② 为什么是 409 而不是 400；③ 把应用层检查删掉后 FK 仍然会拦住。第三点最好
> 用"Suppose I deleted that check"开头，表现出你验证过而不是猜的。

---

## 9:30 - 11:00 | Q2: the request lifecycle, from HTTP to the database

**Question 2 is data flow.** The front end's own script follows one registration
from the browser. From my side, the same request is worth following through the
layers, because that is what my contribution actually is.

**Show:** a split screen — Postman's `POST /events/{{newEventId}}/registrations`
request, and `api/src/routes/apiRoutes.ts` → `registrationController` →
`registrationService` → `registrationRepository` open in VS Code.

> "A request arrives at a route, which knows only the URL and the HTTP method. The
> controller reads the parameters and builds the response — status code, headers,
> body — and does nothing else. The **service** owns the rules: it validates the
> body, checks that the ticket tier belongs to this event and that enough tickets
> remain, and decides which repository call to make. The repository owns the SQL and
> knows nothing about HTTP. No layer skips a layer.

> Validation is the part a client feels most. Every validator collects its problem
> into one array instead of throwing on the first one, and the service returns
> **all** of them in a single 400. That is why the admin form can mark every bad
> field in one pass.

> Every response then goes out in the same envelope: `{ success, meta, data }`. The
> `meta` block describes the resource and the pagination, the `data` block is the
> payload — and for a list, `meta` carries the total so the client can show 'showing
> 6 of 11' without a second request. One envelope for every endpoint means the
> client needs one unwrapping function, not one per endpoint.

> Errors go out in the same shape too: a stable machine-readable `code`, a message
> for a human, and a `details` array when a field is at fault. That consistency is
> the single most useful thing I built for my teammate, because it is why the front
> end has exactly one error type to render."

**Show:** `GET /events/2` and point at the registrations array.

> "The read path is the other half. The event detail response includes this event's
> registrations, sorted in SQL by `registered_at` descending with the id as a
> tie-breaker. The client renders them in the order it receives them — deliberately
> **not** re-sorting in the browser, so exactly one place owns that rule and the
> screen can never disagree with the database."

> 【旁注】这一段不要讲 Angular 怎么渲染（那是同伴的部分），只讲到"我返回了排好序的
> 数据、统一的信封、统一的错误形状"为止。落点句：**"one envelope and one error shape
> is why the front end needs one unwrapping function, not one per endpoint."**

---

## 11:00 - 11:45 | Q3: the two websites running against this API

**Show:** `http://localhost:4300/events` (the admin list), then
`http://localhost:4200/events/2` (the public event page).

> "Question 3 is website functionality, and the websites are my teammate's part, so
> I will show just the interface between us — the three places where my design is
> visible in what the user sees.

> **First**, the admin list includes an event with the status suspended. That is
> only possible because it reads `GET /api/admin/events`, which uses
> `vw_all_events`; the public endpoint reads `vw_public_events` and cannot return
> that row at all. One database, two views, two audiences.

> **Second**, the delete button on a row that has registrations is disabled and
> labelled 'Deletion blocked' — and when staff confirm a delete that the API refuses,
> the banner shows my event name, my registration count and my `suggestion` field as
> a working link. The `details` array from my 409 is what makes that possible instead
> of a red box that only says 'conflict'.

> **Third**, the 'sold' column on the admin list comes from `registration_count` and
> `tickets_sold` in `vw_event_columns`, so listing eleven events with their
> registration totals is **one** query, not eleven. Aggregate in the database and
> send the answer, rather than sending the rows and counting in the browser."

**Show:** `https://24832481.it.scu.edu.au/charity-events-api/api/health`.

> "And this is the deployed API answering its own health check: the data source, the
> environment, and a database block naming the schema, the server version, the table
> count and whether the registration table exists. One request tells me whether a
> problem is my configuration or my code."

> 【旁注】这一段的策略是：**只讲前端里"我设计的部分"露出来的地方**（两个视图、409 的
> details、视图里的聚合列）。不要演示 Angular 表单怎么用 —— 那是同伴的部分。

---

## 11:45 - 13:30 | Testing, the TypeScript migration and code quality

### 11:45 - 12:45 | The tests

**Show:** a terminal running `npm test`.

> "I extended the automated test suite, and there are four layers.

> `npm test` runs **116** checks: the HTTP contract against the real Express API,
> endpoint by endpoint, plus a jsdom regression suite that loads the **archived**
> Assessment 2 frontend — kept under `legacy/` as the behavioural reference for the
> pages that were rewritten. It starts its own API instance on a free port, so it
> never disturbs a running server and needs no MySQL.

> The delete rule is checked from **both** sides: an event with registrations is
> refused with a 409, then the registrations are removed and the same event deletes
> successfully. Checking it both ways is what proves the block is caused by the
> registrations and not by something else that happens to be broken.

> `npm run test:mysql` runs the identical checks against the **real** MySQL
> database. That is how the offline repository and the MySQL repository are shown to
> behave the same — and since the API ships both, the offline one is what lets a
> marker run the whole suite without installing MySQL."

**Show:** `api/src/repositories/` — both `*.local.ts` and `*.mysql.ts` side by side.

> "That is what the `.local` and `.mysql` pairs are: two implementations of one
> interface. `DATA_SOURCE` in `.env` chooses between them, and the services and
> routes are identical either way — the deployment runs MySQL, the test suite runs
> offline, and the contract is the same."

### 12:45 - 13:30 | The migration and the guard rails

**Show:** `api/server.ts` in TypeScript, then `api/dist/server.js`, then
`npm run check:angular`.

> "The migration itself was the largest single piece of work: the whole `api/src`
> tree moved from JavaScript to TypeScript, with types shared with the front end
> through the same models. It was done behind a test suite that was already green
> and stayed green, which is how I can claim there was **no behavioural change** —
> the only differences are types and the removal of code nothing called.

> There are also architecture checks that fail the build if a requirement is broken:
> `npm run check:angular`, **16** checks, verifies there is no NgModule anywhere,
> that both applications are zoneless, and that the API source is TypeScript with no
> `.js` files left behind. `npm run check:translations` checks the front end's four
> language dictionaries have identical key sets.

> And `npm run check:no-secrets` refuses to let the repository be published while it
> still contains a real credential — it reads the files git actually tracks, and I
> fixed it during this assessment because it was reading the **staged** copy, so an
> unstaged password was reported as safe. That is the kind of bug a checker must not
> have."

> 【旁注】`check:no-secrets` 那个"读暂存区而不是工作区"的修复是很亮眼的"我验证过自己的
> 工具"。如果时间紧，这句可以砍，但"两套仓储 + test:mysql 证明行为一致"必须留。

---

## 13:30 - 14:30 | Deployment and closing

**Show:** the cPanel file manager (or the deployment doc), then
`https://24832481.it.scu.edu.au/charity-events-api/api/events?limit=3`.

> "The API is deployed to the SCU cPanel host as a NodeJS application behind
> Passenger. Three details matter.

> **First, what is uploaded is the compiled output**: `api/dist` plus
> `api/package.json`, because the host's Node version cannot execute TypeScript.
> `server.js` is the entry point, exactly as it is locally.

> **Second, the configuration is not in the code.** `.env` carries the database
> credentials, the data source and the allowed CORS origins, and it is **never**
> committed — the repository ships `.env.example` instead, and `check:no-secrets`
> enforces that. CORS is restricted to the deployed site's origin rather than
> `*`, so another website cannot call this API from a browser.

> **Third, the deployment is verifiable without a browser.** `npm run deploy:verify`
> fetches the deployed pages, the nine illustrations, the API endpoints and the
> deep-link behaviour, and fails loudly if any of them is wrong. The most useful
> check in it is one I added after being misled: a dropped connection now reports
> as 'unconfirmed' rather than as a missing file, because it used to tell me to
> re-upload a file that was actually there.

> To summarise my half: the new table enforces the brief's uniqueness rule in the
> schema, the delete rule is enforced twice — in one transaction and by the foreign
> key — the C.R.U.D. cycle is complete with a consistent response envelope, and the
> whole server is TypeScript compiled ahead of time to run on the host. Thank you for
> watching."

**Stop recording.**

> 【旁注】结尾只总结**服务端**（表约束、事务删除规则、CRUD、统一响应、编译部署）。
> "Thank you for watching" 后停两秒再停止录制。

---

## After recording

- [ ] Watch it back with sound on and check all three questions are clearly answered
- [ ] Confirm the total length is **at most 15 minutes**
- [ ] Confirm the video shows the blocked delete (**409**) **and** a successful
      delete (**204**), from the same endpoint
- [ ] Confirm the duplicate-registration 409 and the blocked-delete 409 are clearly
      distinguished as two different rules
- [ ] Confirm the `details` array on a 400 is visible at least once
- [ ] Confirm you say which parts are yours and name your teammate's part when the
      websites appear
- [ ] Upload to SCU OneDrive, set sharing so the marker can view it, and test the
      link in a private browser window

## Likely interview questions for this role

1. **Why is the unique key on `(event_id, attendee_email)` rather than on the email
   alone?** (Any other choice breaks 'a user may register for multiple events'.)
2. **Why is the ticket tier not a composite foreign key, when that would enforce the
   same-event rule in the database?** (MySQL refuses it here: `ERROR 6125` — a
   foreign key may not reference a unique key sharing its leading column with another
   unique index, and `ticket_types` has both `PRIMARY KEY (ticket_type_id)` and
   `UNIQUE (event_id, ticket_name)`; and `ERROR 3109` blocks the usual derived-key
   workaround because a generated column may not refer to an `AUTO_INCREMENT` column.
   The rule is enforced by the API instead, and the single-column foreign key still
   guarantees the tier exists.)
3. **What does the transaction add to the delete rule, and what would still stop a
   bad delete if the check were removed?** (`FOR UPDATE` prevents a registration
   arriving between the count and the delete; `ON DELETE RESTRICT` refuses it at the
   database level.)
4. **Why 409 and not 400 for a blocked delete?** (The request is well formed and the
   event exists; the *state of the data* is what prevents it.)
5. **Why a view for the public events instead of a stored status column?** (MySQL
   cannot reference another table inside a generated column, and one shared column
   list is what stops the public and admin listings drifting apart.)
6. **How does your search avoid SQL injection?** (Every value is a bound parameter;
   the only thing concatenated is the sort column, and that is whitelisted.)
7. **What is the difference between `vw_public_events` and `vw_all_events`, and who
   reads each?** (The status filter; the public endpoints and the admin endpoints
   respectively.)
8. **Why is `limit` capped at 100?** (A single request cannot ask the database for
   an unbounded result set; pagination is explicit.)
9. **Why does the API exist in both a `.local` and a `.mysql` implementation?**
   (One interface, two sources; the suite runs offline, the deployment runs MySQL,
   and `test:mysql` proves they behave identically.)
10. **Why is the API compiled to `dist` instead of run through `ts-node`?** (The
    host's Node cannot execute TypeScript, and a loader would ship a development
    dependency into production.)
11. **Why are the write routes mounted under both `/api/events` and
    `/api/admin/events`?** (The same controller, so one implementation per rule; the
    admin mount exists so a public caller cannot reach suspended events by accident.)
12. **What happens if a delete request arrives at the same moment as a
    registration?** (`SELECT ... FOR UPDATE` locks the event row, so the count cannot
    go stale; and if the check were bypassed, `ON DELETE RESTRICT` still refuses.)
13. **How would authentication be added?** (In front of the `/api/admin/...` routes
    and the write methods, which are already grouped for that purpose, plus an HTTP
    interceptor in each Angular application.)
14. **What does your health endpoint tell you?** (The data source, the environment,
    and whether the database is connected, which schema it connected to, the server
    version, the table count and whether the registration table exists.)
