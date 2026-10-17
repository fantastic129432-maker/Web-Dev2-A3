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

## Timing plan (13:30, computed from the words and the actions)

Every row is `spoken words ÷ 140 × 60 + action seconds`, with 15-25 seconds of
action time for each demonstrated step. The script carries **1,262 spoken words**:
9:00 of speech plus 4:30 of screen actions, so the total lands at 13:30 with 90
seconds of slack under the 15-minute limit.

| Time | Section | Words | Speak | Actions | Total | Question |
| --- | --- | --- | --- | --- | --- | --- |
| 0:00 - 0:43 | Introduction and my role | 66 | 0:28 | 0:15 | 0:43 | - |
| 0:43 - 1:18 | Q1: six constraints, one line each | 47 | 0:20 | 0:15 | 0:35 | Q1 |
| 1:18 - 2:36 | Q1: the pair rule, the foreign keys, and the rule the database cannot hold | 148 | 1:03 | 0:15 | 1:18 | Q1 |
| 2:36 - 3:30 | Q1: the two CHECKs, and what the deployed server enforces | 79 | 0:34 | 0:20 | 0:54 | Q1 |
| 3:30 - 4:19 | Q1: the five views, and why a view rather than a generated column | 80 | 0:34 | 0:15 | 0:49 | Q1 |
| 4:19 - 5:08 | Q1: `event_db.ts` — one pool and one transaction helper | 79 | 0:34 | 0:15 | 0:49 | Q1 |
| 5:08 - 5:50 | Q1: the API's layering and the write endpoints | 64 | 0:27 | 0:15 | 0:42 | Q1 |
| 5:50 - 6:26 | Q1: create, and the validation that collects every problem | 38 | 0:16 | 0:20 | 0:36 | Q1 |
| 6:26 - 7:20 | Q1: a partial update, and the check the schema cannot make | 80 | 0:34 | 0:20 | 0:54 | Q1 |
| 7:20 - 7:58 | Q1: the delete rule: the code behind it | 53 | 0:23 | 0:15 | 0:38 | Q1 |
| 7:58 - 8:30 | Q1: the delete rule: the blocked delete | 39 | 0:17 | 0:15 | 0:32 | Q1 |
| 8:30 - 9:09 | Q1: the delete rule: the successful delete and the second line of defence | 55 | 0:24 | 0:15 | 0:39 | Q1 |
| 9:09 - 10:08 | Q2: route, controller, service — and where the rules live | 79 | 0:34 | 0:25 | 0:59 | Q2 |
| 10:08 - 10:42 | Q2: SQL, and the check that runs inside the write | 80 | 0:34 | - | 0:34 | Q2 |
| 10:42 - 11:38 | Q2: the response, and the read path | 95 | 0:41 | 0:15 | 0:56 | Q2 |
| 11:38 - 12:28 | Q3: one database, two views, two audiences | 70 | 0:30 | 0:20 | 0:50 | Q3 |
| 12:28 - 13:11 | Q3: what the API hands the public pages | 66 | 0:28 | 0:15 | 0:43 | Q3 |
| 13:11 - 13:30 | Closing: what my half is | 44 | 0:19 | - | 0:19 | - |
| **Total** | | **1,262** | **9:00** | **4:30** | **13:30** | |

If you are running long, skip the beats marked **✂ skip if long** in the body.
Never skip the delete rule — it is the requirement the brief singles out.

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

## 0:00 - 0:43 | Introduction and my role

**Show:** the Postman collection on the left, MySQL Workbench on the right.

> "Hello, my name is _[name]_, student number _[number]_. This is my Assessment 3
> submission for PROG2002 Web Development II.

> My contribution is the **server side**: the MySQL database and the TypeScript API.
> My teammate built the Angular websites; the client half is the other script.

> For Assessment 3 I added the registration table, completed the C.R.U.D. cycle, and
> moved the server to TypeScript compiled into `api/dist`."

> 【旁注】开场就把分工说清楚："My contribution is the server side" + 一句提到同伴做
> 前端，并说明另一半由同伴那份稿子讲。不要花时间讲慈善机构背景。

---

## 0:43 - 3:30 | Q1: the new table and its six constraints

### 0:43 - 1:18 | Six constraints, one line each

**Show:** MySQL Workbench, `charityevents_db` expanded, **Tables** (seven) and
**Views** (five). Then `database/01_schema.sql`, section 7, `event_registrations`.

> "One new table, `event_registrations`, records who registered, with six
> constraints: the primary key on `registration_id`, the unique key on
> `(event_id, attendee_email)`, two foreign keys — `event_id` and the nullable
> `ticket_type_id` — and two CHECKs: at least one ticket, and a valid-looking
> email."

> 【旁注】这里要**数得清**：主键、唯一键、两个外键、两个 CHECK —— 说"六个"就必须
> 数到六个，别只说出五个。

### 1:18 - 2:36 | The pair rule, the two foreign keys, and the rule the database cannot hold

**Show:** the `UNIQUE KEY uq_registration_event_email` line, then the two
`CONSTRAINT fk_...` lines.

> "The pair rule: a user may register for multiple events but only once per event.
> A unique key on email alone would break the first half; on the pair, the same
> email twice for event one is a duplicate.

> `event_id` is `ON DELETE RESTRICT` — no deleting an event with registrations.
> `ticket_type_id` is nullable, and its foreign key guarantees the tier exists.

> A **composite** foreign key on `(event_id, ticket_type_id)` would prove the
> tier's event, but MySQL refuses it: **ERROR 6125**, the referenced unique
> key shares its leading column with another unique index, and **ERROR 3109**, a
> generated column may not refer to an `AUTO_INCREMENT` column. So the API enforces
> the rule; I could have used a trigger, but a trigger hides the rule from anyone
> reading the schema. The API rule is the documented behaviour, the single-column
> foreign key the safety net."

> 【旁注】这一段有两个加分动作：**① 承认复合外键做不了，并说出两条 MySQL 错误号**；
> **② 说明为什么不用触发器**。落点句：**"The API rule is the documented behaviour;
> the single-column foreign key is the safety net."**

### 2:36 - 3:30 | The two CHECKs, and what the deployed server actually enforces

**Show:** the two `CHECK` constraints.

> "The two CHECKs are the ticket count and the email shape. On MySQL 8 here they
> refuse a zero-ticket row and a malformed email; the deployed host runs MySQL
> **5.7.44**, which parses a CHECK and then **ignores** it. So there the API's
> validators are the guard on every write — the CHECK is the belt on 8, the API
> the braces on 5.7. `idx_registrations_event` is on `(event_id, registered_at)`,
> the shape of the event page's list query.

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

> 【旁注】执行那条 INSERT 时故意让它报错，报错信息就是你的证据。然后用两句话收：
> **8 上两条 CHECK 会拦，5.7.44 上只解析不执行，所以写入口的把关必须在 API 里。**

---

## 3:30 - 4:19 | Q1: the five views, and why a view rather than a generated column

**Show:** the five views in the SCHEMAS panel, then `vw_event_progress`.

> "`vw_event_progress` exists because MySQL **cannot
> reference another table in a generated column**, so a running total over
> donations has to be a view; its percentage is `ROUND(..., 1)` and clamped at 100
> with `LEAST`.

> `vw_event_columns` joins every event column to its lookups and adds
> `event_state`, `registration_count` and `tickets_sold`; `vw_public_events` is the
> same with `status = 'active'`, `vw_all_events` without it, and
> `vw_event_registrations` adds ticket name, price and `total_amount`."

**✂ skip if long:** the `vw_event_registrations` sentence; the generated-column
reason is the answer to "why a view".

> 【旁注】讲 `vw_event_progress` 时把"MySQL 不能在 GENERATED COLUMN 里引用别的表"
> 说清楚 —— 这是"为什么用视图"的硬理由，比"视图好看"有力得多。

---

## 4:19 - 5:08 | Q1: `event_db.ts` — one pool and one transaction helper

**Show:** `api/src/db/event_db.ts`.

> "`event_db.ts` is the required Node-to-MySQL file, in TypeScript. It holds a
> **pool** so requests do not queue.

> Assessment 3 added a **`transaction()` helper**: one connection inside `BEGIN`,
> commit if the callback returns, **rollback if it throws**, release in `finally`.
> Every multi-row write uses it: event plus tiers, tier replacement, both
> registration writes, and the delete rule.

> It applies `DEMO_TODAY` with `SET timestamp`, so `CURDATE()` reads the demo date,
> and its `ping()` reports whether the new table exists."

> 【旁注】`transaction()` 的 `finally` 里释放连接是加分细节（漏了会连接泄漏）。
> 健康检查里报告表是否存在也很实用，一句话带过即可。

---

## 5:08 - 6:26 | Q1: the API's layering and the write endpoints

### 5:08 - 5:50 | Five layers, and the same controller mounted twice

**Show:** `api/src/routes/apiRoutes.ts`, then the folder tree of `api/src`.

> "The API is layered: routes, controllers, services, repositories, and
> `event_db.ts`. A layer knows only the layer below, which let me convert the tree
> to TypeScript without a behavioural change.

> Assessment 3 completes C.R.U.D. The write handlers are mounted **twice** —
> `/api/events` and `/api/admin/events` — calling the same controller. Neither
> mount is access-controlled: the brief allows that, so the prefix is a namespace,
> not a boundary."

### 5:50 - 6:26 | Create, and the validation that collects every problem

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

**Do:** run steps 1 to 3, pointing at the status codes, the `Location` header and
the `details` array.

> "Step 2: **201 Created** with a `Location` header, and the created event read
> back through the admin view. Step 3: **400**, collecting **every** problem into
> one `details` array, so a client fixes the whole form in one pass."

### 6:26 - 7:20 | A partial update, and the check the schema cannot make

**Do:** run step 4, then step 5 — the same `PUT` with its body replaced by
`{"dateStart": "2027-06-01"}`. Nothing else changes.

> "Step 4: the update is **partial**: only sent fields are validated and changed,
> so a stale value cannot overwrite someone else's change.

> Step 5: **400**, naming `dateEnd`. A partial update sends one field; the other is
> the stored value, so the old code could write a 2027 start beside a 2026 end. The
> CHECK is ignored on 5.7.44, so the service reads the row, overlays the fields,
> and checks the pair before writing; the same covers start and end time."

> 【旁注】第 3 步（400 + `details` 数组）和第 5 步（部分更新 400 命名 `dateEnd`）是
> "设计得好"的证据，各花 20 秒。`dateEnd` 那条的落点句：**数据库在 5.7 上不拦，所以
> 服务层必须把存好的行读出来、把请求字段盖上去、再检查合并后的那一对。**

---

## 7:20 - 9:09 | Q1: the delete data-integrity rule, live, both directions

This is the A3 requirement the brief singles out. Demonstrate it **both** ways.

### 7:20 - 7:58 | The code behind it

**Show:** `api/src/repositories/write.repository.mysql.ts`, `deleteEvent()`, then
`api/src/services/eventWriteService.ts`, `deleteEvent()`.

> "The rule: an event with registrations must not be deleted. One transaction:
> select the event `FOR UPDATE`, count, delete at zero.

> Without it, A counts zero, B inserts, A deletes, and B's registration is
> orphaned. When the count is not zero the service answers **409**, not 400: the
> state blocks a well-formed request."

### 7:58 - 8:30 | The blocked delete

**Do:** run step 6, then step 7 —
`DELETE /events/{{newEventId}}  (blocked while it has registrations)`.

> "The registration is **201**; the delete of that event is **409**, with
> `eventId`, `eventName`, `registrationCount` and
> `suggestion: "suspend-instead"` in `details`. The admin page maps it to its own
> translated sentence; the server sends facts, the client owns the words."

### 8:30 - 9:09 | The successful delete, and the second line of defence

**Do:** run step 8 (the registration is removed, 204), then step 9 — the **same**
delete endpoint on the **same** event.

> "Removing the registration lets the same delete answer **204 No Content**, so
> `X-Deleted-Event-Id` and `X-Deleted-Event-Name` repeat the outcome.

> Delete my check and MySQL still refuses through `ON DELETE RESTRICT`, but that
> driver error is not translated: the caller would get a 500, not a 409 with a
> count. The transaction and count give the advice."

> 【旁注】**这是全稿最重要的一段**。三句话必须说清楚：① `FOR UPDATE` 防的是什么并发
> 场景；② 为什么是 409 而不是 400；③ 把应用层检查删掉后 FK 仍然会拦住（但会变成 500）。
> 第三点最好用 "Suppose I deleted that check" 开头，表现出你验证过而不是猜的。

---

## 9:09 - 11:38 | Q2: one registration, from HTTP to SQL and back

**Question 2 is data flow.** The client-side script follows the same journey from
the page. From my side, one request is worth following through the layers, because
that is what my contribution actually is.

**Show:** a split screen — Postman's register request, and in VS Code
`api/src/routes/apiRoutes.ts` → `registrationController` → `registrationService` →
`registrationRepository`.

**Do:** run the create request once more (it saves a fresh `{{newEventId}}` and
`{{newTicketTypeId}}`), then
`POST /events/{{newEventId}}/registrations  (register, and save the id)`.

### 9:09 - 10:08 | Route, controller, service — and where the rules live

> "A route knows only the URL and method; the controller builds the response; the
> **service** owns the rules and validates the body; the repository owns the SQL.

> Four rules: one registration per email per event, case-insensitive and trimmed;
> the tier must belong to the event; the count must fit the remaining
> allocation; and the count must be at least one with a valid email. Every
> validator collects its problem, so the service returns **all** of them in one
> 400."

### 10:08 - 10:42 | SQL, and the check that runs inside the write

> "The pre-check gives a 400, but it can lose a race: two requests can both see the
> last ticket. So the repository repeats it **inside** the transaction, locks the
> tier `FOR UPDATE`, and recounts; one insert wins, the other is refused with the
> remaining count. One module, `ticket-allocation.ts`, keeps both in agreement.

> The insert returns the row with tier name, price and `totalAmount` from SQL. Last
> defence: the unique key, and the repository translates that error into
> the same **409**."

### 10:42 - 11:38 | The response, and the read path

> "Every success response uses one envelope: `{ success, meta, data }`; `meta.total` says
> how many matched. Errors use `{ success: false, error: { status, message,
> details } }`: status is machine-readable, details carries facts. So the front
> end needs one unwrapping function, not one per endpoint.

> Registrations are sorted in SQL by `registered_at` descending, id as tie-breaker.
> The public projection does not select email or phone and computes a masked
> display name — 'Grace T.' — in SQL, so they never leave the database; staff
> endpoints select them."

**Do:** to finish the journey, run the two `DELETE` requests once more — the
registration, then the event — so the row this section created is gone as well.

> "Both answers are **204**, so the demonstration leaves the database as it found
> it."

> 【旁注】这一段不要讲 Angular 怎么渲染（那是同伴的部分），只讲到"我返回了排好序的
> 数据、统一的信封、统一的错误形状"为止。落点句：**"one envelope and one error shape
> is why the front end needs one unwrapping function, not one per endpoint."** 末尾那
> 两条 DELETE 别忘了跑，否则种子会多出一条报名。

---

## 11:38 - 13:11 | Q3: the data my API puts on the pages

**Question 3 is website functionality, and the pages are my teammate's code. What I
can show is the part of every page that is my data.**

**Show:** `http://localhost:4300/events` (the admin list), then
`http://localhost:4200/events/2` (the public event page), then
`http://localhost:3000/api/events/2` in the browser.

### 11:38 - 12:28 | One database, two views, two audiences

> "All eleven events are in the admin list because it reads
> `GET /api/admin/events`, which uses `vw_all_events`; the public endpoint reads
> `vw_public_events`, keeping only `status = 'active'`, and excludes past events
> through the API's `excludePast` rule.

> The 'sold' column is `registration_count` and `tickets_sold` from
> `vw_event_columns`, so eleven events are **one** query. The refusal arrives as
> data: the 409's `details` carry the name and count."

### 12:28 - 13:11 | What the API hands the public pages

**Show:** the raw JSON of `GET /api/events/2`, the `registrations` array.

**✂ skip if long:** the weather paragraph at the end; the external API is the
client's optional feature.

> "This is the raw JSON of `GET /api/events/2`. Registrations arrive newest first;
> each carries `attendeeDisplayName` — 'Grace T.' — with no email or phone,
> because the public projection never selects them.

> The counts are the API's: **three** registrations and **fourteen** tickets.

> The weather is a client call, but only possible because the API puts the venue's
> latitude and longitude on the event, from two columns added for it."

> 【旁注】这一段的策略是：**只讲前端里"我设计的部分"露出来的地方**（两个视图、409 的
> details、视图里的聚合列、投影里的脱敏）。不要演示 Angular 表单怎么用 —— 那是同伴的
> 部分。

---

## 13:11 - 13:30 | Closing: what my half is

> "To summarise my half: the table enforces uniqueness and the API holds the rules
> it cannot; the delete rule runs in one transaction and answers 409; C.R.U.D. is
> complete with one envelope; the public projection masks names. The client half is
> the other script."

**Stop recording.**

> 【旁注】结尾只总结**服务端**（表约束、事务删除规则、CRUD、统一响应、编译后的 API）。
> 最后一句说完停两秒再停止录制。
