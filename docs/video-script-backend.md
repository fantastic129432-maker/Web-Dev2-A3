# Demo video script — **server side** (the MySQL database and the TypeScript API)

PROG2002 Web Development II — **Assessment 3**

**This script is for:** the member responsible for the **server side** — the MySQL
schema and seed in `database/`, and the whole TypeScript API in `api/`: routes,
controllers, services, repositories, validators, middleware and the database
layer.

**Partner script:** `video-script-frontend.md` covers the two Angular applications
and the shared library. This script answers all three required questions from the
server half only; where the websites appear, they appear as the client that
consumes this API, never as Angular code.

> 【为什么是两份】A3 要求视频"focus on your own contribution"，并且**三个问题都要答**。
> 两份稿子都要完整回答 Q1/Q2/Q3，差别在于哪一块讲深。属于同伴的部分（Angular
> 组件、信号、CSS）在本稿里只出现到"我的 API 给它返回了什么、它拿它做了什么"，
> 不要替他讲前端实现 —— 面试被追问会答不上来。

## Timing plan (14:30, leaving 30 seconds of slack under the 15-minute limit)

| Time | Section | Question |
| --- | --- | --- |
| 0:00 - 0:45 | Introduction and my role | - |
| 0:45 - 3:15 | Q1: the new table and its six constraints | Q1 |
| 3:15 - 4:30 | Q1: the five views, and why a view rather than a generated column | Q1 |
| 4:30 - 5:30 | Q1: `event_db.ts` — one pool and one transaction helper | Q1 |
| 5:30 - 7:30 | Q1: the API's layering and the write endpoints | Q1 |
| 7:30 - 9:30 | Q1: the delete rule, live, both directions | Q1 |
| 9:30 - 11:45 | Q2: one registration, from HTTP to SQL and back | Q2 |
| 11:45 - 13:15 | Q3: the data my API puts on the pages | Q3 |
| 13:15 - 14:30 | Closing: what my half is | - |

Eight and three-quarter minutes of this is Q1 and over two is Q2, which is the shape
the brief asks for on this half. If you are running long, cut the two "if time
allows" answers first, then the partial-update step. Never cut the delete rule at
7:30 — it is the requirement the brief singles out.

---

## Before you record

Operational only; the words to say are below.

1. `npm start` from the project root, before OBS. It compiles `api/src` into
   `api/dist` and serves the API on 3000, the public site on 4200 and the admin
   site on 4300; without it Postman is hitting a stale build.
2. **Pin the demo date.** Put `DEMO_TODAY=2026-10-17` in `api/.env` and restart
   (it ships commented out, so otherwise the API follows the real clock). Every
   date and count below was checked with that pin: six public events upcoming,
   four past — events 1, 4, 9 and 10 — and the suspended event is *Midnight Desert
   Auction*.
3. **Reload the seed** with `database/charityevents_db.sql` (open it in Workbench
   and run it) before this take: every figure below is the seed's — 11 events, 7
   tables and 5 views, **20** registrations and **49** tickets sold. The
   demonstrations write only rows the demo itself removes again, so the seed
   survives the take.
4. Open: MySQL Workbench connected to `charityevents_db` with **Tables** and
   **Views** expanded, Postman with
   `docs/postman/PROG2002-A2-Charity-Events-API.postman_collection.json` imported
   and the **Assessment 3 - the write endpoints** folder expanded, VS Code with
   `api/src` open, and a terminal.
5. Rehearse once without recording, in the order of the table above: the
   collection's variables (`{{newEventId}}`, `{{newTicketTypeId}}`,
   `{{registrationId}}`) only have values after the request that saves them has
   run.

> 【录制前检查】**先 `npm start` 再开 OBS**，否则 Postman 打到的是一个没编译的 API。
> 变量 `{{newEventId}}` 只有在"创建"那条请求跑过之后才有值，**写接口那几步必须按顺序
> 走**，不能跳到中间演示 —— 提前演练一遍确认 id 串起来了。把 Workbench 的字体调大，
> 否则 SQL 结果在录像里看不清。**每次录制（含重拍）前重载一次**
> `database/charityevents_db.sql`，让种子回到稿子里的数字（20 条报名、49 张票、11 个活动）。

---

## 0:00 - 0:45 | Introduction and my role

**Show:** the Postman collection on the left, MySQL Workbench on the right.

> "Hello, my name is _[name]_, student number _[number]_. This is my Assessment 3
> submission for PROG2002 Web Development II.

> My contribution is the **server side of the project**: the MySQL database, and
> the RESTful API built with NodeJS and Express and written entirely in
> TypeScript. My teammate built the two Angular websites, and the client half is
> covered by the other script; I will show you what they receive from this API.

> In Assessment 2 the API was read-only. For Assessment 3 I added the registration
> table, completed the C.R.U.D. cycle with the write endpoints, and moved the
> whole server to TypeScript — compiled by `tsc` into `api/dist`, which is what
> actually runs."

> 【旁注】开场就把分工说清楚："My contribution is the server side" + 一句提到同伴做
> 前端，并说明另一半由同伴那份稿子讲。不要花时间讲慈善机构背景。

---

## 0:45 - 3:15 | Q1: the new table and its six constraints

### 0:45 - 1:20 | Six constraints, one line each

**Show:** MySQL Workbench, `charityevents_db` expanded, **Tables** (seven) and
**Views** (five). Then `database/01_schema.sql`, section 7, `event_registrations`.

> "Assessment 3 asked for one new table, `event_registrations`, recording who
> registered for which event. Every constraint on it is either a rule from the
> brief or the mechanical guarantee that sits under one — and there are six.

> **One**, the primary key on `registration_id`: it is the identity of the row, and
> it is also the tie-breaker that makes the newest-first order stable.
> **Two**, the unique key on the pair `(event_id, attendee_email)`.
> **Three and four**, the two foreign keys: `event_id` to `events`, and the
> nullable `ticket_type_id` to `ticket_types`. **Five and six**, two CHECK
> constraints: the ticket count must be at least one, and the email must look like
> an email."

> 【旁注】这里要**数得清**：主键、唯一键、两个外键、两个 CHECK —— 说"六个"就必须
> 数到六个，别只说出五个。

### 1:20 - 2:20 | The pair rule, the two foreign keys, and the rule the database cannot hold

**Show:** the `UNIQUE KEY uq_registration_event_email` line, then the two
`CONSTRAINT fk_...` lines.

> "The pair rule is the one worth explaining. The brief says a user may register
> for multiple events but can only register for an event once. A unique key on the
> email alone would break the first half of that sentence — the same person could
> never register for a second event. On the pair, the same email twice for event
> one is a duplicate, and the same email for event one and event two is perfectly
> fine.

> `event_id` is `ON DELETE RESTRICT` — that is the database-level half of 'an event
> can only be deleted when it has not yet received any registrations', and I will
> demonstrate it in both directions in a moment. `ticket_type_id` is nullable, so
> 'general entry' is allowed, and its foreign key guarantees that the chosen tier
> actually exists.

> Now the honest part. The stronger design is a **composite** foreign key on
> `(event_id, ticket_type_id)`, which would prove in the database that the tier
> belongs to the *same* event as the registration. I tried it, and MySQL refuses it
> here for two separate reasons, both of which I found by loading the schema rather
> than by reading the manual:

> — **ERROR 6125**: a foreign key may not reference a unique key that shares its
> leading column with another unique index on that table, and `ticket_types` already
> has `PRIMARY KEY (ticket_type_id)` plus `UNIQUE (event_id, ticket_name)`.
> — **ERROR 3109**: the usual workaround — a generated column holding the pair — may
> not refer to an `AUTO_INCREMENT` column.

> So that rule is enforced in the API instead, and this is the design decision I
> would most expect to be asked about. I could have used a trigger, but a trigger
> is invisible to anyone reading the schema and would move a rule that already
> works, and is already tested, into a place the marker has to go looking for. The
> API rule is the documented behaviour; the single-column foreign key is the safety
> net. The reasoning is written as a comment beside the constraint in the schema
> file, so the next person to read it does not have to rediscover it."

> 【旁注】这一段有两个加分动作：**① 承认复合外键做不了，并说出两条 MySQL 错误号**；
> **② 说明为什么不用触发器**。落点句：**"The API rule is the documented behaviour;
> the single-column foreign key is the safety net."**

### 2:20 - 3:15 | The two CHECKs, and what the deployed server actually enforces

**Show:** the two `CHECK` constraints.

> "The two CHECK constraints are the ticket count — at least one — and the email
> shape, a percent-at-percent pattern that has to match. On MySQL 8, here in
> Workbench, they refuse a zero-ticket row and a malformed email whatever the
> client sends.

> The deployed host is different, and it is worth saying out loud: it runs MySQL
> **5.7.44**, and 5.7 parses a CHECK constraint and then **ignores** it. So on the
> public site those two constraints enforce nothing at all; the validators in the
> API do, on every write, and they are why the rule still holds. The CHECK is the
> belt on MySQL 8 and the API is the braces on 5.7 — which is also why the
> partial-update check I will show you later lives in code rather than being left
> to the schema.

> The remaining columns mirror what the brief says to store: the attendee's name,
> email and optional phone, the number of tickets purchased, when they registered,
> and a notes field. `idx_registrations_event` is on `(event_id, registered_at)`
> specifically, because that is the exact shape of the query behind the event
> page's registration list."

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

> 【旁注】执行那条 INSERT 时故意让它报错，报错信息就是你的证据。然后用两句话收：
> **8 上两条 CHECK 会拦，5.7.44 上只解析不执行，所以写入口的把关必须在 API 里。**

---

## 3:15 - 4:30 | Q1: the five views, and why a view rather than a generated column

**Show:** the five views in the SCHEMAS panel, then `vw_event_progress`.

> "There are five views. One of them exists for a MySQL limitation rather than a
> preference.

> `vw_event_progress` exposes the raised amount and the progress percentage.
> MySQL **cannot reference another table inside a generated column**, so a running
> total that depends on the donations table cannot be a stored computed column — it
> has to be a view. That is why the progress bar on the website is computed by the
> database and not by the browser. The percentage is `ROUND(..., 1)` and clamped at
> 100 with `LEAST`, so a goal that has been exceeded still reads one hundred per
> cent.

> The rounding is also where the two data sources used to disagree. The offline
> mirror used `toFixed(1)` on a binary double, so a donation that landed exactly on
> a half-way value answered 3.0 offline and 3.1 from MySQL. The mirror now computes
> in integer cents with exact half-up and clamps at 100, and a randomised
> comparison of **1,206** cases — 603 of them exact halves — found no mismatch
> against the database.

> `vw_event_columns` holds every event column joined to its lookups — organisation,
> category, venue — plus the derived `event_state`, `registration_count` and
> `tickets_sold`. It is the single column list that the other listings are defined
> from. `vw_public_events` is now literally one line: `SELECT * FROM
> vw_event_columns WHERE status = 'active'`. The public **status** rule has not
> changed — it is just expressed once and reused. `vw_all_events` is the same rows
> **without** the status filter, and only the admin website reads it. Because both
> listings share one column list, they cannot drift apart: adding a column in one
> place adds it to both.

> `vw_event_registrations` adds the ticket name, the price and a computed
> `total_amount` to each registration. The API's read queries select the same
> expression directly, so the view and the endpoint cannot disagree about the
> arithmetic — the view is the readable version of the row, not a second source of
> truth.

> The point of putting the joins in views is that the API then reads one thing. The
> event listings query a view, not five joined tables, so a change to the schema
> shows up in one place."

> 【旁注】讲 `vw_event_progress` 时把"MySQL 不能在 GENERATED COLUMN 里引用别的表"
> 说清楚 —— 这是"为什么用视图"的硬理由，比"视图好看"有力得多。

---

## 4:30 - 5:30 | Q1: `event_db.ts` — one pool and one transaction helper

**Show:** `api/src/db/event_db.ts`.

> "`event_db.ts` is the required file that connects Node to MySQL, and it is
> TypeScript now. It holds a **connection pool**, not a single connection, so
> concurrent requests do not queue behind each other, and the pool is closed on
> `SIGINT` and `SIGTERM` so a restart does not leak connections.

> Assessment 3 added one thing to it: a **`transaction()` helper**. It takes a
> callback, hands it one connection inside `BEGIN`, commits if the callback
> returns, and **rolls back if it throws** — and the connection is released in a
> `finally`, so a failed transaction cannot leak it back into the pool in a bad
> state. Every write that touches more than one row uses it: creating an event with
> its ticket tiers, replacing those tiers, both registration writes — the insert and
> the update's seat check — and the delete rule. The same helper is what makes the
> update path's seat allocation safe.

> It also applies `DEMO_TODAY` to the MySQL session. The pin used to fix only the
> offline mirror's clock, so `CURDATE()` in the views still read the server's real
> day and the same seed could be 'upcoming' offline and 'past' against MySQL. The
> pool now runs `SET timestamp` once per connection, so the demo date means the
> same thing on both data sources.

> Its `ping()` also reports whether the `event_registrations` table exists, so
> `GET /api/health` answers 'was the new table created?' in a single request — the
> table count and a boolean. That is the first thing I check when a page is empty:
> it tells me whether the problem is configuration or code.

> The compiled JavaScript is what actually runs: `api/server.ts` and everything
> under `api/src/` are compiled by `tsc` into `api/dist/`, and `api/dist/server.js`
> is the entry point — locally and in production, because Node cannot execute
> TypeScript directly and a `ts-node` loader would ship a development dependency
> into the running server."

> 【旁注】`transaction()` 的 `finally` 里释放连接是加分细节（漏了会连接泄漏）。
> 健康检查里报告表是否存在也很实用，一句话带过即可。

---

## 5:30 - 7:30 | Q1: the API's layering and the write endpoints

### 5:30 - 6:00 | Five layers, and the same controller mounted twice

**Show:** `api/src/routes/apiRoutes.ts`, then the folder tree of `api/src`.

> "The API follows a layered structure: **routes** decide the URL, **controllers**
> deal with HTTP, **services** validate and hold the business rules,
> **repositories** hold the SQL, and `event_db.ts` talks to MySQL. A layer only
> knows the layer below it — that is what let me convert the whole `api/src` tree
> to TypeScript **without a single behavioural change**.

> Assessment 2 was read-only. Assessment 3 completes the C.R.U.D. cycle:
> `POST /api/events` to create, `PUT /api/events/:id` to update,
> `DELETE /api/events/:id` to delete, plus the registration endpoints.

> One decision worth explaining: the write handlers are mounted **twice** — under
> `/api/events` and under `/api/admin/events` — and both mounts call the same
> controller functions. So there is exactly one implementation of each rule and no
> chance of the two drifting apart. The `/api/admin` surface exists because the
> admin website needs reads the public routes cannot answer — a listing that
> includes suspended events alongside the past ones, a single event whatever its
> status, and the reference data its forms are built from — and mirroring the
> write handlers there keeps that surface complete rather than half of one.
> Neither mount is access-controlled: authentication is deliberately not
> implemented, as the brief allows, so the prefix is a namespace rather than a
> boundary. The shared implementation is what makes that safe to say."

### 6:00 - 6:45 | Create, and the validation that collects every problem

**Show:** Postman. Step 1 is the detail request from `Event detail`; the rest are
in **Assessment 3 - the write endpoints**.

| Step | Request | Expect |
| --- | --- | --- |
| 1 | `Event detail` → `/events/{{eventId}}  (full detail)` | 200 |
| 2 | `Events` → `POST /events  (create, and save the id)` | 201 + `Location` |
| 3 | `Events` → `POST /events  (missing required fields)  -> 400` | 400 |
| 4 | `Events` → `PUT /events/{{newEventId}}  (partial update, two fields)` | 200 |
| 5 | the same `PUT`, body replaced with `{"dateStart": "2027-06-01"}` | 400 naming `dateEnd` |
| 6 | `Registrations` → `POST /events/{{newEventId}}/registrations  (register, and save the id)` | 201 |
| 7 | `Registrations` → `DELETE /events/{{newEventId}}  (blocked while it has registrations)` | 409 |
| 8 | `Registrations` → `DELETE /registrations/{{registrationId}}  (204, unblock the event)` | 204 |
| 9 | `Registrations` → `DELETE /events/{{newEventId}}  (204, the event that was created)` | 204 |

> "Step 1: 200, the full detail. Notice this response also carries the event's
> registrations, ordered by `registered_at` descending — the brief asks for 'sorted
> by the latest date when the tickets were purchased' — with `ticketName`,
> `ticketPrice` and a computed `totalAmount`. The registration id is the
> tie-breaker, so two registrations made in the same second still order predictably.

> Step 2: **201 Created** with a `Location` header pointing at the new resource —
> `/api/events/` plus the id it just assigned — which is the RESTful way to say 'it
> exists and here is where'. The body is the created event read back through the
> admin view, so a create response looks exactly like a later read of the same
> event. That id, and the id of the first tier, are saved into collection variables
> by this request's test script, which is why no URL has to be edited between
> steps.

> Step 3: **400**, and this is the part I would point a marker at. The validation
> collects **every** problem and returns one response with a `details` array — the
> field name and the message for each one. A client can paint each message next to
> its own control and the user fixes the form in one pass, instead of playing
> whack-a-mole one error at a time."

**Do:** run steps 1 to 3, pointing at the status codes, the `Location` header and
the `details` array.

### 6:45 - 7:30 | A partial update, and the check the schema cannot make

**Do:** run step 4, then step 5 — the same `PUT` with its body replaced by
`{"dateStart": "2027-06-01"}`. Nothing else changes.

> "Step 4: an update is **partial**. Only the fields present in the body are
> validated and changed; here just the goal and the capacity, with the dates,
> venue, description and ticket tiers untouched. The admin update page uses exactly
> this — it sends only the fields the user edited, so there is no way for a stale
> value to overwrite a change somebody else made.

> Step 5: **400**, and the detail names `dateEnd`: the end date cannot be earlier
> than the start date. This is the newest rule in the write path, and it exists
> because the database cannot be the guard. A partial update sends **one** field;
> the other half of the pair is whatever the row already holds, so the two halves
> are never in the body together. The old code compared them only when both
> arrived, so this request used to write the 2027 start date and leave the event's
> 2026 end date in place — an impossible row. The schema declares `CHECK (date_end
> >= date_start)`, but the host runs MySQL 5.7.44, which parses that CHECK and then
> ignores it. So the service now reads the stored row, lays the sent fields over
> it, and checks the pair it is about to leave behind, before writing anything. The
> same check covers `startTime` and `endTime`.

> Step 5 wrote nothing, so the event still has the dates the create gave it — which
> is why step 6 can register against it."

**If time allows, two more answers worth knowing:**

- **Both enum filters are refused, not defaulted.** Put
  `?publishStatus=past` on the Admin view request: **400**, with
  `details[0].field = publishStatus` and the message listing
  `active, suspended, cancelled, all`. `?audience=publicly` on `/events` does the
  same, naming `public, admin`. `publishStatus` already behaved that way;
  `audience` did not — a value outside the list was silently replaced by the
  default, so a typo answered 200 with the **public** view and the caller could not
  tell it from a correct answer. That was a real bug.
- **The ticket allocation is checked twice, and the second check is inside the
  write.** The `Validation of the ticket allocation` folder creates a one-seat tier
  and asks for twenty: **400**, *Only 1 ticket of "Last place" remain, but 20 were
  requested.*, with `remaining: 1` in `details[0]`. The pre-check gives that
  answer; the same check runs again inside the transaction with the tier row
  locked. The create path always did that; the **update** path did not. Two
  concurrent updates used to sell **12** tickets on a **10**-seat tier. Now they
  lock and recount, one succeeds, and the other is refused with the **four**
  remaining seats.

> 【旁注】第 3 步（400 + `details` 数组）和第 5 步（部分更新 400 命名 `dateEnd`）是
> "设计得好"的证据，各花 20 秒。`dateEnd` 那条的落点句：**数据库在 5.7 上不拦，所以
> 服务层必须把存好的行读出来、把请求字段盖上去、再检查合并后的那一对。**

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

**Do:** run step 6, then step 7 —
`DELETE /events/{{newEventId}}  (blocked while it has registrations)`.

> "First the registration: **201** with a `Location`, and its id saved into
> `{{registrationId}}`. Now the delete of that same event: **409 Conflict.** The
> message names the event and the number of registrations, and it tells the user
> what to do instead: set the status to suspended. There is also a machine-readable
> part — `details` carries `eventId`, `eventName`, `registrationCount` and
> `suggestion: "suspend-instead"` — and a client reads the name and the count from
> that object instead of parsing my sentence. The `suggestion` is a stable code for
> the advice rather than the wording of it: the admin page maps the code to its own
> translated dictionary sentence and falls back to a generic sentence for a code it
> does not recognise, so the server sends the facts and the client owns the words.
> Structured details rather than a sentence is what lets a client act on the
> failure."

### 8:50 - 9:30 | The successful delete, and the second line of defence

**Do:** run step 8 (the registration is removed, 204), then step 9 — the **same**
delete endpoint on the **same** event.

> "The first request removes the registration that was blocking the delete; the
> second is the same endpoint that answered 409 a moment ago. Nothing else changed
> — that is the whole point of the pair.

> **204 No Content** is the RESTful answer to 'it is gone'. A 204 carries no body,
> so the outcome is repeated in headers the client can read: `X-Deleted-Event-Id`
> and `X-Deleted-Event-Name`. Those headers are listed in
> `Access-Control-Expose-Headers`, because a browser hides custom headers from
> JavaScript otherwise, and a header the client cannot read is not an API.

> Both directions use an event this demo created, and the successful delete removes
> that same event once its registration is gone, so the seed is left exactly as it
> was found — which is also what lets the collection be run top to bottom
> repeatedly.

> Finally, the second line of defence. Suppose I deleted that check from my code.
> MySQL would still refuse the delete, because the foreign key is
> `ON DELETE RESTRICT` — those registration rows point at the event, so the event
> cannot disappear. But notice what that proves, and what it does not. The database
> keeps the **data** correct; it is not the API's error contract. That driver error,
> `ER_ROW_IS_REFERENCED_2`, is not translated on the delete path, so with the check
> removed the caller would get a server error, not a 409 with a registration count.
> The transaction and the count are what turn a state conflict into advice a member
> of staff can act on; the foreign key is the last resort underneath them."

> 【旁注】**这是全稿最重要的一段**。三句话必须说清楚：① `FOR UPDATE` 防的是什么并发
> 场景；② 为什么是 409 而不是 400；③ 把应用层检查删掉后 FK 仍然会拦住（但会变成 500）。
> 第三点最好用 "Suppose I deleted that check" 开头，表现出你验证过而不是猜的。

---

## 9:30 - 11:45 | Q2: one registration, from HTTP to SQL and back

**Question 2 is data flow.** The client-side script follows the same journey from
the page. From my side, one request is worth following through the layers, because
that is what my contribution actually is.

**Show:** a split screen — Postman's register request, and in VS Code
`api/src/routes/apiRoutes.ts` → `registrationController` → `registrationService` →
`registrationRepository`.

**Do:** run the create request once more (it saves a fresh `{{newEventId}}` and
`{{newTicketTypeId}}`), then
`POST /events/{{newEventId}}/registrations  (register, and save the id)`.

### 9:30 - 10:15 | Route, controller, service — and where the rules live

> "A request arrives at a route, which knows only the URL and the HTTP method. The
> controller reads the parameters and builds the response — status code, headers,
> body — and does nothing else. The **service** owns the rules: it validates the
> body, normalises the email, checks that the ticket tier belongs to this event and
> that enough tickets remain, and decides which repository call to make. The
> repository owns the SQL and knows nothing about HTTP. No layer skips a layer.

> Four rules live in that service, and they are the four the brief implies:
> one registration per email per event — compared case-insensitively and trimmed,
> so `Ann@Example.com ` is the same person as `ann@example.com`, which is what makes
> the unique key do its job; the ticket tier must belong to the event the
> registration is being created in; the requested count must fit the tier's
> remaining allocation; and the ticket count must be at least one, with an email
> that looks like an email.

> Validation is the part a client feels most. Every validator collects its problem
> into one array instead of throwing on the first one, and the service returns
> **all** of them in a single 400, so a client can paint every bad field in one
> pass instead of discovering them one at a time."

### 10:15 - 11:00 | SQL, and the check that runs inside the write

> "The service's pre-check gives a readable 400 with `details` — the field, the
> message and the number remaining. But a check outside the write can lose a race:
> two requests can both see the last ticket. So the repository repeats the same
> check **inside** the transaction that inserts the row, with the tier row locked
> `FOR UPDATE`, and recounts the tickets already sold for that tier. One insert
> wins; the other is refused with the remaining count. The arithmetic lives in one
> shared module, `ticket-allocation.ts`, because the service and the repository must
> answer 'how many are left' identically.

> The repository then inserts the row and returns it read back, with the tier name,
> the tier price and `totalAmount = tickets × price` computed in SQL, so the
> response carries the stored amount rather than the request echoed back.

> The last defence is the unique key on `(event_id, attendee_email)`. If two
> requests pass the service check together, the database refuses the second one, and
> the repository translates that driver error into the same **409** the service
> would have produced — rather than letting a raw duplicate-key error escape as a
> 500."

### 11:00 - 11:45 | The response, and the read path

> "Every JSON response goes out in the same envelope: `{ success, meta, data }`.
> The `meta` block describes the resource and the pagination, the `data` block is
> the payload — and for a list, `meta.total` says how many matched, so a client can
> say how many of how many it is showing without a second request. One envelope for
> every endpoint means a client needs one unwrapping function, not one per
> endpoint.

> Errors go out in the same shape too: `{ success: false, error: { status, message,
> details } }`. The status is the stable machine-readable part, the message is for
> a human, and `details` carries the facts a client can act on — an array of
> `{ field, message }` when the validators reject fields, and an object for the 409
> that names the event, how many registrations block it, and the `suspend-instead`
> suggestion. One shape is why a client has exactly one error type to render.

> The read path is the other half. The event detail response includes this event's
> registrations, sorted in SQL by `registered_at` descending with the id as a
> tie-breaker, so the order is decided in SQL and nowhere else.

> And the shape of that list is a server-side decision. The public projection does
> not select the attendee's email or phone at all, and it computes a masked display
> name — "Grace T." — in the query. Those two contact columns never leave the
> database on this route, so no template, client or future export can put them back
> on the page. The staff endpoints ask for both explicitly, which is why the admin
> screens still show them. That is data minimisation under the Australian Privacy
> Principles, enforced in SQL rather than hidden with CSS."

**Do:** to finish the journey, run the two `DELETE` requests once more — the
registration, then the event — so the row this section created is gone as well.

> "Both answers are **204**: the registration is removed, then the event it belonged
> to, so the demonstration leaves the database exactly as it found it."

> 【旁注】这一段不要讲 Angular 怎么渲染（那是同伴的部分），只讲到"我返回了排好序的
> 数据、统一的信封、统一的错误形状"为止。落点句：**"one envelope and one error shape
> is why the front end needs one unwrapping function, not one per endpoint."** 末尾那
> 两条 DELETE 别忘了跑，否则种子会多出一条报名。

---

## 11:45 - 13:15 | Q3: the data my API puts on the pages

**Question 3 is website functionality, and the pages are my teammate's code. What I
can show is the part of every page that is my data.**

**Show:** `http://localhost:4300/events` (the admin list), then
`http://localhost:4200/events/2` (the public event page), then
`http://localhost:3000/api/events/2` in the browser.

### 11:45 - 12:20 | One database, two views, two audiences

> "The admin list includes the suspended event and the past events — eleven rows of
> eleven — because the page reads `GET /api/admin/events`, which uses
> `vw_all_events`. The public endpoint reads `vw_public_events`, which keeps only
> `status = 'active'`, so the suspended event cannot appear there; the past events
> are excluded separately, by the API's own `excludePast` rule — the home listing
> pins the state to `upcoming` — not by the view. One database, two views, two
> audiences.

> The 'sold' column is `registration_count` and `tickets_sold` from
> `vw_event_columns`, so listing eleven events with their registration totals is
> **one** query, not eleven. Aggregate in the database and send the answer, rather
> than sending the rows and counting in the browser.

> Every row offers Delete, including a row the API will refuse — hiding the control
> would hide the rule. When staff confirm that delete, the 409's `details` give the
> client the event name and the count; what the page does with them — the banner,
> the advice, the disabled row — is the client's half, and the client script shows
> it. What is mine is that the refusal arrives as data and not only as a sentence."

### 12:20 - 13:15 | What the API hands the public pages

**Show:** the raw JSON of `GET /api/events/2`, the `registrations` array.

> "This is the same data the public event page renders, and it shows two
> server-side decisions. The registrations arrive newest first, ordered by
> `registered_at` with the id breaking ties. And each row carries
> `attendeeDisplayName` — 'Grace T.' — with no `attendeeEmail` and no
> `attendeePhone` key anywhere, because the public projection never selects them.
> `GET /api/admin/events/2` asks for both explicitly, which is why the staff screens
> still have them.

> The counts on the page are the API's own: `registrationCount` and `ticketsSold`
> from the view, not something the page derived. On this event that is **three**
> registrations and **fourteen** tickets sold — the registration count is in the
> hero line above the table, and the ticket total is in the table's totals row
> beneath the individual rows.

> Finally, the weather: the optional external API is a client-side call to
> Open-Meteo, but it is only possible because the API puts the venue's latitude and
> longitude on the event, and the database stores them on `locations` — two columns
> added in Assessment 3 for exactly that purpose. The client asks; the data is
> mine."

> 【旁注】这一段的策略是：**只讲前端里"我设计的部分"露出来的地方**（两个视图、409 的
> details、视图里的聚合列、投影里的脱敏）。不要演示 Angular 表单怎么用 —— 那是同伴的
> 部分。

---

## 13:15 - 14:30 | Closing: what my half is

> "To summarise my half: the new table enforces the brief's uniqueness rule in the
> schema, and the rules it cannot hold live in one validated API layer; the delete
> rule runs in one transaction with the foreign key underneath it, and answers 409
> in a shape a client can act on; every write that touches more than one row goes
> through the same transaction helper; the C.R.U.D. cycle is complete with one
> response envelope and one error shape; the public projection publishes a masked
> name and no contact details; and the whole server is TypeScript compiled ahead of
> time. The client half — both Angular websites and the shared library — is covered
> by the other script. Thank you for watching."

**Stop recording.**

> 【旁注】结尾只总结**服务端**（表约束、事务删除规则、CRUD、统一响应、编译后的 API）。
> "Thank you for watching" 后停两秒再停止录制。
