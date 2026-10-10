# 部署到 SCU cPanel

本文是 Assessment 3 第 5 部分（"Deploy both websites to the SCU cPanel so they can be
accessed publicly on the Internet"）的操作步骤。

两个网站都要上线，而且 API 也要能公网访问 —— 因为评分标准里 client-side 和
admin-side 两条都写了 "designs, develops, **and deploys**"。

---

## 0a. 这台 SCU cPanel 的实测情况

以下是在 `xliu67` 账号上**实际探测出来的**，不是通用假设。换成别的账号时这几项要重新确认。

| 项目 | 实测值 | 影响 |
| --- | --- | --- |
| cPanel 面板地址 | `https://24832481.it.scu.edu.au:2083/`（`http` 会 301 跳到 `manage.it.scu.edu.au:2083`） | — |
| 账号 / 家目录 | `xliu67` / `/home/xliu67` | — |
| 主域名 | `24832481.it.scu.edu.au` | 网站根地址 |
| 站点根目录 | `/home/xliu67/public_html`，**当前为空** | 不会覆盖任何已有文件 |
| **MySQL 版本** | **5.7.44-cll-lve** | ⚠ **不是 8.0**，必须用 5.7 兼容的 SQL，见下方 |
| MySQL 服务器 | `localhost`（cPanel 面板上显示的就是这个） | `DB_HOST=localhost` |
| 已有数据库 | `xliu67_Ass2_CaseStudy1`、`xliu67_DB1BigDatabase`、**`<cpanel用户名>_XuLiu_Ass3`** | A3 用 `<cpanel用户名>_XuLiu_Ass3` |
| 数据库用户 | 已创建 **`<cpanel用户名>_app`**，已授权到 `<cpanel用户名>_XuLiu_Ass3`（ALL PRIVILEGES） | API 的 `DB_USER` |
| 远程 MySQL (3306) | ✗ 被防火墙挡住 | 只能通过 phpMyAdmin 导入 SQL |
| SSH (22) | ✗ 被防火墙挡住 | 用 cPanel 的 **Terminal** 代替 |
| **Node.js 支持** | ✅ **有**，入口是 **Setup Node.js App** | API 可以部署在这里 |
| Node.js Selector 页面 | `lveversion/nodejs-selector.html.tt`（在 **Software** 分组里） | 创建应用的地方 |
| Application Manager | `passenger/index.html`（也在 Software 分组） | 备选入口 |
| Terminal | ✅ 有（Advanced 分组） | 可用来跑 npm 命令 |

> **⚠ MySQL 5.7 与本项目默认 SQL 的差异 —— 这一步不做会直接导入失败。**
>
> `database/charityevents_db.sql` 面向 MySQL 8.0，用了 `utf8mb4_0900_ai_ci`；
> 这个排序规则 5.7 不存在，导入会报 `Unknown collation`，**一张表都建不出来**。
>
> 所以上传到 cPanel 时用另一个文件：
>
> ```bash
> node tools/export-cpanel-sql.mjs      # 生成 database/charityevents_db.mysql57.sql
> ```
>
> 它只把 `utf8mb4_0900_ai_ci` 换成 `utf8mb4_unicode_ci`（两者都大小写不敏感，
> 唯一键的行为完全一致），表/视图/INSERT 的数量与源文件逐项校验相同。
> MySQL 8.0 上仍然用 `charityevents_db.sql`，两个文件并存。
>
> 另外 `CHECK` 约束在 5.7 上会被**解析但忽略**（不执行、不报错）。所以
> "tickets_purchased >= 1" 这类检查在 cPanel 上只由 API 层保证 —— 那层校验
> 本来就有，且已被 115 项自动化测试覆盖，所以行为不变。

---

## 0. 先准备好本地的三个包

```bash
# 1. 把 API 地址指向你的 cPanel 主机（只有这一个常量需要改）
node tools/configure-deployment.mjs --api https://24832481.it.scu.edu.au/charity-events-api

# 2. 生成 MySQL 5.7 兼容的数据库文件
node tools/export-cpanel-sql.mjs

# 3. 打包
node tools/make-submission-zips.mjs --username xliu67
```

第 3 步会在 `dist/` 生成：

| 文件 | 内容 | 部署到 |
| --- | --- | --- |
| `xliu67A3-clientside.zip` | 公开网站（首页、搜索、活动详情、报名页） | `public_html` 根目录 |
| `xliu67A3-adminside.zip` | 管理后台 + 它复用的共享模块 | 同一个根目录（会建出 `admin/`） |
| `xliu67A3-api.zip` | Node.js/Express API | Setup Node.js App 的应用目录 |

> **打包前必须先跑第 1 步。** 如果 `API_BASE_URL` 还是 `http://localhost:3000/api`，
> 那么上传后的网站会在**访客自己的电脑上**找 3000 端口，页面能打开但一个数据都没有。
> 这是部署后最常见的失败症状。

---

## 1. 确认 cPanel 提供什么

登录 cPanel 后先看两件事，后面的步骤取决于它们：

| 要看的东西 | 在哪找 | 为什么重要 |
| --- | --- | --- |
| **Setup Node.js App** | Software 分组 | API 是 Node 程序，必须有它才能跑起来。如果没有，见第 5 节的替代方案 |
| **MySQL Databases** + **phpMyAdmin** | Databases 分组 | 数据库要建在这里，并把 `charityevents_db.sql` 导进去 |

同时记下你的账号信息：

- **用户名**（cPanel 登录名，通常形如 `abc123`）
- **主域名或子域名**（形如 `<用户名>.scu.edu.au` 或学校给的域名）
- **MySQL 主机名** —— 在 cPanel 里**几乎不是 `localhost`**，通常是
  `localhost` 以外的形式，或者形如 `<用户名>.scu.edu.au`。**以 cPanel 页面上
  显示的为准。** 这一项填错会得到 `ECONNREFUSED` 或 `ENOTFOUND`。

---

## 2. 导入数据库

> 用 **`database/charityevents_db.mysql57.sql`**（第 0 步生成的），不是 `charityevents_db.sql`。
> 原因见 0a 节的说明。

你已经建好了 `<cpanel用户名>_XuLiu_Ass3` 并创建了用户 `<cpanel用户名>_app`（已授权）。所以只需要导入：

1. cPanel → **phpMyAdmin** → 左侧点选 **`<cpanel用户名>_XuLiu_Ass3`**（**一定要先选中库**，
   否则会在错误的库里建表）。
2. 顶部 **Import** 标签页 → **Choose File** → 选 `charityevents_db.mysql57.sql` → **Go**。

   > **这个文件里没有 `DROP DATABASE` / `CREATE DATABASE` / `TRUNCATE`。**
   > 这三样在 cPanel 上都会出问题，而且都是**实际导入时报出来的**，不是推演：
   >
   > | 语句 | 实际报错 | 处理 |
   > | --- | --- | --- |
   > | `DROP DATABASE` / `CREATE DATABASE` | 导入页顶部红框："已禁用「删除数据库」语句" | 已移除；数据库由 cPanel 的 MySQL Databases 界面创建 |
   > | `TRUNCATE TABLE` | `#1701 Cannot truncate a table referenced in a foreign key constraint` | 已移除 |
   > | 清理语句顺序错误 | `#1217 Cannot delete or update a parent row: a foreign key constraint fails` | 改为按外键依赖顺序删除，见下 |
   >
   > **关于 `TRUNCATE`：** `SET FOREIGN_KEY_CHECKS = 0` 对 `DELETE` 有效，
   > **对 `TRUNCATE` 无效**。MySQL 不允许 TRUNCATE 一张被外键引用的表，无论检查
   > 开关如何。所以第一次导入可能还行，**重复导入必然失败**。
   >
   > **关于删除顺序：** 清理语句必须"先删引用别人的表，再删被别人引用的表"。
   > `organizations` 是 `events` 的**父表**，如果它排在第一个删，就会报 `#1217` ——
   > 即使写了 `SET FOREIGN_KEY_CHECKS = 0` 也一样（实测如此）。所以顺序是写死的：
   > `event_registrations` → `donations` → `ticket_types` → `events` →
   > `organizations` → `categories` → `locations`。
   >
   > **这个文件已经过三轮重复导入的实测**（全新库 / 表已存在 / 再来一次），
   > 每轮都验证 7 表 5 视图以及 11 活动、20 报名、18 票种、42 捐款。
   > 因此：导入后**页面顶部不应出现任何红色错误**，并且可以**反复导入**。

3. 导入完成后确认左侧 `<cpanel用户名>_XuLiu_Ass3` 下有 **7 张表 + 5 个视图**：
   表 = `organizations`、`categories`、`locations`、`events`、`ticket_types`、
   `donations`、`event_registrations`；
   视图 = `vw_event_progress`、`vw_event_columns`、`vw_public_events`、
   `vw_all_events`、`vw_event_registrations`。
4. 快速核对数据量（在 phpMyAdmin 的 SQL 标签页执行）：

   ```sql
   SELECT
     (SELECT COUNT(*) FROM events)                AS events,          -- 期望 11
     (SELECT COUNT(*) FROM event_registrations)   AS registrations,   -- 期望 20
     (SELECT COUNT(*) FROM ticket_types)          AS tiers,           -- 期望 18
     (SELECT COUNT(*) FROM donations)             AS donations;       -- 期望 42
   ```

   四个数字都对上，才算导入完整。若 `event_registrations` 为 0，说明脚本在
   建表阶段就被中断了 —— 重新导入一次即可（现在是可重复执行的）。

---

## 3. 部署 API（Setup Node.js App）

**这台主机确实支持 Node.js。** 入口在 cPanel 的 **Software** 分组里，名字叫
**Setup Node.js App**（底层是 CloudLinux Node.js Selector）。

1. cPanel → **Software** → **Setup Node.js App** → **Create Application**。

   | 字段 | 填什么 |
   | --- | --- |
   | Node.js version | 选列表里**最高的**（18 或以上；本项目 `engines` 要求 >=18） |
   | Application mode | **Production** |
   | Application root | `charity-events-api`（相对于 `/home/xliu67`） |
   | Application URL | `24832481.it.scu.edu.au` + `/charity-events-api` |
   | Application startup file | `server.js` |

2. 用 **File Manager** 把 `xliu67A3-api.zip` 上传到 `/home/xliu67/charity-events-api`，
   然后 **Extract**。解压后该目录里应直接看到 `server.js`、`package.json`、`src/`。

   > **⚠ cPanel 会先放一个占位的 `server.js`。**
   > 创建应用时 cPanel 自动生成了 `server.js`（约 323 字节）和 `package.json`。
   > 上传我们的文件时，File Manager 会提示"文件已存在"，如果选择跳过，
   > **Passenger 跑的就是 cPanel 的模板而不是我们的 API** —— 症状是应用能启动，
   > 但访问任何接口都返回模板的内容。
   >
   > 正确做法：上传时覆盖这两个文件。判断是否覆盖成功，看 `server.js` 的大小 ——
   > 我们的版本是 **4.6 KB** 左右（4635 字节），cPanel 模板只有 323 字节。
   > 用 File Manager 右键 → **Edit** 打开看一眼，第一行应该是我们的注释头。

3. **安装依赖：优先用 Terminal，不要依赖 `Run NPM Install` 按钮。**

   > **这个按钮会误报失败。** 它的流程是"装依赖 → 然后访问一下应用做健康检查"。
   > 如果应用此刻因为依赖还没装好而返回 500，cPanel 就会判定整个操作失败并弹红框：
   >
   > > *"An error occured during installation of modules. The operation was
   > > performed, but check availability of application has failed. Web application
   > > responds, but its return code 500 Internal Server Error …"*
   >
   > 注意这句话本身就已经承认 **"The operation was performed"** ——
   > 依赖其实装上了，只是健康检查没过。所以不要被红框误导去反复点它。
   >
   > **可靠的替代方式**：cPanel → **Advanced** → **Terminal**，然后：
   >
   > ```bash
   > source /home/xliu67/nodevenv/charity-events-api/18/bin/activate
   > cd /home/xliu67/charity-events-api
   > npm install
   > ```
   >
   > 成功的输出形如 `audited 80 packages in 1s` / `found 0 vulnerabilities`。
   > 提示符变成 `[charity-events-api (18)]` 说明虚拟环境已激活。

4. 建 `/home/xliu67/charity-events-api/.env`（File Manager 里新建文件）：

   ```ini
   NODE_ENV=production
   PORT=3000
   DATA_SOURCE=mysql

   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=<cpanel用户名>_app
   DB_PASSWORD=<你的数据库密码>
   DB_NAME=<cpanel用户名>_XuLiu_Ass3
   DB_CONNECTION_LIMIT=10

   # 网站的实际地址
   CORS_ORIGIN=https://24832481.it.scu.edu.au

   RATE_LIMIT_WINDOW_MS=60000
   RATE_LIMIT_MAX=300
   DEFAULT_PAGE_SIZE=20
   MAX_PAGE_SIZE=100
   ```

   > `DB_HOST` 用 `localhost`：cPanel 面板上显示的就是 `localhost`，
   > 而且这是在**同一台服务器内部**连接，不需要走公网。
   >
   > `PORT` 填 3000 即可；Node.js Selector 会通过自己的代理转发到你的进程，
   > 对外端口由它处理。如果面板上给了指定的端口号，就填那个。

5. **重启应用**，然后浏览器打开健康检查地址。

   点 Setup Node.js App 页面上的 **RESTART** 按钮。它做的事等于在 Terminal 里执行：

   ```bash
   touch ~/charity-events-api/tmp/restart.txt
   ```

   （`~/charity-events-api/tmp/restart.txt` 是 Passenger 的重启信号文件，
   改它的时间戳就会让应用重新加载。用 Terminal 改配置后，这样重启比翻界面更快。）

   > **重启是必须的**：新装的 `node_modules` 和新建的 `.env` 都要等进程重启才会生效。
   > 只改 `.env` 而不重启，应用仍然用旧值运行。

   然后打开：

   ```
   https://24832481.it.scu.edu.au/charity-events-api/api/health
   ```

   期望看到 `"connected": true` 和 `"registrationTable": true`（以及
   `"dataSource": "mysql"`）。

   | 症状 | 原因 | 处理 |
   | --- | --- | --- |
   | `dataSource: "local"` | `.env` 没被读到，掉进了离线镜像 | 确认 `.env` 在 `charity-events-api/` 根下（不是 `src/` 里），然后重启 |
   | `connected: false` | 连不上 MySQL | 看下面的具体错误码 |
   | `registrationTable: false` | 第 2 步的 SQL 没导全 | 重新导入 `charityevents_db.mysql57.sql` |
   | `ECONNREFUSED` / `ENOTFOUND` | `DB_HOST` 填错 | cPanel 上应填 `localhost` |
   | `ER_ACCESS_DENIED_ERROR` | 密码错，或用户没绑到库上 | 在 MySQL Databases 里确认 `<cpanel用户名>_app` 已 Add 到 `<cpanel用户名>_XuLiu_Ass3` |
   | 页面显示 cPanel 模板文字 | 占位 `server.js` 没被覆盖 | 见第 2 步的警告，`server.js` 应是 4.6 KB |

   ### 5a. Passenger 环境下的两个必需改动

   这个项目的 `api/server.js` 里有两处专门为 Passenger 写的代码。它们不是可选的 ——
   缺任何一处都会让应用在 cPanel 上**完全不可用**，而且症状具有误导性，所以记在这里。

   **改动 1：启动守卫要覆盖 `PASSENGER_BASE_URI`**

   ```js
   const IS_PASSENGER = Boolean(process.env.PASSENGER_BASE_URI);
   if (require.main === module || IS_PASSENGER) { start()... }
   ```

   **为什么必须改：** Passenger 不是"执行"启动文件，而是 `require()` 它，然后期望应用
   自己开始监听端口。在 Passenger 下 `require.main` 是 Passenger 自己的加载器，
   所以 `require.main === module` 永远是 `false`。只用这个守卫的后果是
   **`start()` 从不被调用、应用从不监听**，浏览器看到 Passenger 的通用错误页：

   > *500 — We're sorry, but something went wrong: Web application could not be started*

   这个错误极具误导性：所有文件都对、79 个依赖都装好了、`.env` 也正确，看起来像是
   环境问题，实际上只是启动守卫没进去。

   **改动 2：剥掉 `PASSENGER_BASE_URI` 前缀**

   ```js
   const baseUri = (process.env.PASSENGER_BASE_URI || '').replace(/\/+$/, '');
   if (baseUri) {
     app.use((req, res, next) => {
       if (req.url === baseUri) req.url = '/';
       else if (req.url.startsWith(`${baseUri}/`)) req.url = req.url.slice(baseUri.length);
       next();
     });
   }
   ```

   **为什么必须改：** Passenger **不会**替应用剥掉挂载点前缀，它把完整 URL 传进来。
   应用挂在 `/charity-events-api` 时，请求 `/charity-events-api/api/health` 到达代码时
   `req.url` 仍是 `/charity-events-api/api/health`，而路由挂在 `/api` 上，于是
   **每一个接口都返回 404**，同时应用本身看起来"运行正常"。因为前缀在代码里是硬编码
   的，所以本地怎么测都是好的，只有部署后才暴露。

   > **排查提示：** 如果改动 1 做了、页面能打开但每个接口都 404，看 404 响应里的
   > `hint` 字段 —— 我们的 notFound 处理器会说 "See GET /api for the list of
   > available endpoints"，说明路由挂在 `/api`，那么请求 URL 里多出来的那段就是
   > base URI 前缀，对应改动 2。

   > **排查应用起不来时的第一手信息**来自日志。Terminal 里运行：
   >
   > ```bash
   > tail -40 ~/logs/passenger.log 2>/dev/null; ls -la ~/charity-events-api/tmp/
   > ```

### 5b. 最后确认 CORS（否则浏览器什么都加载不出来）

服务器端接口全通并不代表网站能用 —— **浏览器还会检查 CORS 响应头**。
`CORS_ORIGIN` 与实际网站地址不一致时，控制台报：

> *Access to fetch at '…/api/events' from origin '…' has been blocked by CORS policy*

网页看起来是"空的、一直在加载"，但所有服务器侧检查都是通过的。验证方法：

```bash
curl -s -D - -o /dev/null -H "Origin: https://24832481.it.scu.edu.au" \
  https://24832481.it.scu.edu.au/charity-events-api/api/events?limit=1 | grep -i access-control
```

期望看到：

```
access-control-allow-origin: https://24832481.it.scu.edu.au
access-control-expose-headers: X-RateLimit-Limit, …, Location, X-Deleted-Event-Id, …
```

再验证预检（写操作 POST/PUT/DELETE 之前浏览器会先发 OPTIONS）：

```bash
curl -s -D - -o /dev/null -X OPTIONS \
  -H "Origin: https://24832481.it.scu.edu.au" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" \
  https://24832481.it.scu.edu.au/charity-events-api/api/events/1/registrations | grep -i access-control
```

期望：`access-control-allow-methods: GET,POST,PUT,DELETE,OPTIONS`，HTTP 204。

> `CORS_ORIGIN` 支持逗号分隔的多个来源，所以本地开发地址可以和线上地址并存：
> `CORS_ORIGIN=https://24832481.it.scu.edu.au,http://localhost:5500`
> 改完 `.env` **必须重启**（见第 5 步）。

### 5c. 一条命令验证整个部署

`tools/verify-deployment.mjs` 把上面所有检查跑一遍（25 项）：

```bash
node tools/verify-deployment.mjs
# 或指定其他主机
node tools/verify-deployment.mjs https://your-host/charity-events-api/api
```

它验证的内容正好对应 A3 的要求，任何一项失败都会指出是哪一条：

| 检查 | 对应要求 |
| --- | --- |
| health 报告 `dataSource: mysql` 且 `connected: true` | 真的在用数据库，而不是掉进离线镜像 |
| 公开接口返回 10 个活动、无 suspended | 公开站只显示已发布活动 |
| 管理接口返回 11 个活动、含 suspended | admin 站"regardless of status" |
| 报名记录按购买日期倒序 | "sorted by the latest ticket purchase date" |
| DELETE 有报名的活动返回 409 且活动仍在 | 删除规则 |
| 超量报名 / 缺字段返回 400 且列出字段 | 服务端校验 |
| 两个网站的 8 个页面与资源全 200 | 两个网站都已部署 |
   >
   > 也可以在 File Manager 里给应用目录放一个**零依赖的诊断文件**来判断问题范围：
   > 如果它都跑不起来，问题在 Passenger/Node 环境；如果它能跑而 `server.js` 不行，
   > 问题就在依赖或 `.env`。把 `Application startup file` 临时改过去即可，
   > 验证完记得改回来。

---

## 4. 部署两个网站

两个网站都是纯静态文件，用 File Manager 上传解压即可。

### 4.1 公开网站（网站根目录）

1. 如果根目录已有 `index.html`（学校放的占位页），先改名备份，别直接覆盖。
2. 上传 `<用户名>A3-clientside.zip` 到 `public_html`（或你的站点根目录），**Extract**。
3. 确认根目录下直接能看到：`index.html`、`search.html`、`event.html`、
   `registration.html`、`css/`、`js/`、`images/`。

   > 注意是**压缩包里的内容**放到根目录，不要多套一层文件夹。多套一层的话
   > 访问 `https://主机/` 会看到目录列表或 404。

### 4.2 管理后台（根目录下的 admin/）

1. 上传 `<用户名>A3-adminside.zip` 到站点根目录，**Extract**。
2. 确认出现了 `admin/` 目录，里面有 `index.html`、`css/`、`js/`。
   同时压缩包里还带了它复用的 `js/`、`css/`、`images/` —— 这些和 4.1 的内容相同，
   覆盖没有影响。

### 4.3 验证这两个地址

```
https://24832481.it.scu.edu.au/                     公开网站首页
https://24832481.it.scu.edu.au/event.html?id=1      活动详情（应显示报名记录表和天气预报）
https://24832481.it.scu.edu.au/registration.html?id=1   报名页
https://24832481.it.scu.edu.au/admin/index.html     管理后台仪表盘
```

### 4.4 用命令行脚本部署（可选，比手工拖动可靠）

`tools/` 里没有内置部署脚本 —— 文件上传走的是 cPanel 自己的 API，仅供本次部署使用，
所以相关脚本留在项目之外。但这次部署踩到的几个坑值得记下来，因为它们都会
**静默地**把文件放错位置：

| 坑 | 症状 | 正确做法 |
| --- | --- | --- |
| **zip 解压多一层目录** | 访问站点根看到目录列表；`/index.html` 返回 404 | 必须把**压缩包的内容**直接放到 `public_html/` 下，不能保留 `xliu67A3-clientside/` 这一层 |
| **`upload_files` 的 `dir` 参数位置** | 所有文件都落在目标目录的根下，子目录全空 | `dir` 必须是 **URL 查询参数**：`/execute/Fileman/upload_files?dir=/public_html/js`。放进 multipart 表单字段会被忽略 |
| **`filename` 带路径** | 同上，路径部分被剥掉 | `filename` 只给**纯文件名**，目录靠 `dir` 指定 |
| **不知道删除文件用哪个 API** | `trash_files` / `delete_files` 都报"函数不存在" | 删除不在 UAPI 里。用 SCRIPT API：`/json-api/cpanel?cpanel_jsonapi_module=Fileman&cpanel_jsonapi_func=fileop&op=trash&sourcefiles-1=/public_html/<名字>&destdir=/public_html` |
| **`Fileman::mkdir` 不存在** | 报"函数不存在"，但子目录仍然建出来了 | `upload_files` 会**自动创建**目标目录，不需要预先 mkdir |
| **漏 `api.version=1`** | 报"could not find the function"，看起来像函数名错 | 所有 `/execute/` 调用都要带 `?api.version=1`，否则**任何**函数都"找不到" |
| **请求太密触发防火墙** | `2083` 端口整段超时（curl 返回 `000`） | 请求之间留 300–500 ms；被限流后等 1–2 分钟自然恢复 |

> 部署完成后建议核对一遍最终结构，这是判断"放对位置"的唯一可靠依据：
>
> ```
> public_html/
> ├── index.html  event.html  search.html  registration.html
> ├── js/      12 个 .js
> ├── css/     styles.css
> ├── images/  9 个 .svg
> └── admin/
>     ├── index.html  events.html  new.html  update.html  registrations.html
>     ├── js/  9 个 .js
>     └── css/ admin.css
> ```

---

## 5. 如果 cPanel 没有 Node.js

有些 cPanel 只给 PHP + 静态文件。那样 API 就跑不起来，但仍然有办法拿分，
按优先级排序：

1. **问 UA / 看课程公告**，确认 SCU cPanel 是否支持 Node.js，以及是否有指定做法。
   简报里说 "There will be a video to guide you on how to upload your website to the
   server" —— 先看那个视频，它才是权威步骤。
2. **API 放别处，网站放 cPanel**：把 API 部署到免费 Node 托管
   （Render、Railway、Cyclic 等），然后用
   `node tools/configure-deployment.mjs --api https://<你的API地址>` 把网站指向它，
   再重新打包上传。这样两个网站仍然在 SCU cPanel 上，符合 "deploy both websites
   to the SCU cPanel" 的字面要求。
3. **演示用离线数据**：把 API 的 `DATA_SOURCE` 设为 `local`，它就不需要 MySQL，
   但**仍然需要 Node 进程**。所以这一条只在能跑 Node、只是没有 MySQL 时有用。

无论走哪条路，**在报告和视频里如实说明你做了什么、为什么**，比假装部署成功安全得多。

---

## 6. 上传后必须做的三项检查

1. **浏览器 Console 没有红色报错**，尤其不能有 CORS 相关的
   `has been blocked by CORS policy`。
   出现的话就是 `api/.env` 的 `CORS_ORIGIN` 和网站实际地址不一致 ——
   注意 `https` 与 `http`、有没有 `www`、结尾有没有斜杠，都算不同来源。
2. **在管理后台真的删一次**：找一个没有报名的活动（比如已结束的 9 或 10 号），
   确认返回成功的绿色提示；再找一个有报名的（7 号），确认出现 "Deletion blocked"
   的黄色提示和 409。这同时验证了前端、API、数据库三层都通了。
3. **真的提交一次报名**：打开 `registration.html?id=1`，用你自己的邮箱提交，
   确认出现确认页，然后回到活动详情页能看到这条记录排在最前面。

---

## 7. 常见故障对照表

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 页面能开，但活动列表一直转圈 / 空 | `API_BASE_URL` 还是 `localhost` | 跑第 0 步的配置脚本，重新打包上传 |
| Console 报 CORS policy 拦截 | `CORS_ORIGIN` 和网站地址不一致 | 改 `api/.env` 的 `CORS_ORIGIN`，重启 Node 应用 |
| `/api/health` 返回 404 | 应用 URL 或 startup file 配错 | 确认启动文件是 `server.js`，且应用 URL 与访问路径一致 |
| `/api/health` 显示 `registrationTable: false` | SQL 没导全 | 重新导入 `charityevents_db.sql`，确认 7 表 5 视图 |
| `ECONNREFUSED` / `ENOTFOUND` | `DB_HOST` 填了 `localhost` | 改成 cPanel 上显示的主机名 |
| `ER_ACCESS_DENIED_ERROR` | 用户/密码错，或用户没加到库 | 在 MySQL Databases 页面把用户 Add to Database |
| 写操作返回 500，读正常 | 数据库用户权限不足 | 授予 ALL PRIVILEGES |
| 访问根目录看到文件列表 | zip 解压多套了一层文件夹 | 把内容移到根目录 |
| 管理后台样式全丢 | `admin/` 与 `css/` 不在同一层 | 确认 `css/styles.css` 和 `admin/` 同级 |
| 天气面板不显示 | 该场地没有经纬度，或活动日期超出 16 天预报窗口 | 这是**预期行为**，不是故障（见 `docs/api-documentation.md`） |

---

## 8. 提交前别忘了

- [ ] 两个网站都在公网可访问，且**数据是真的从 API 来的**（不是硬编码）
- [ ] `/api/health` 公网可访问
- [ ] 三个 zip 上传到 Blackboard
- [ ] GitHub 仓库链接（注意设为私有并邀请 marker，见 `docs/submission-checklist.md`）
- [ ] 视频链接（不超过 15 分钟，用 `docs/video-script.md` 的时间表）
- [ ] 同学互评表已单独发给 tutor（不是发给 UA）

> **每个学生都要在自己的 cPanel 上部署一份。** 简报写明 "Each student must deploy
> your app and APIs to your own SCU cPanel"，并且不能共享账号密码。
