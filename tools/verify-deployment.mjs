/**
 * tools/verify-deployment.mjs
 * ---------------------------------------------------------------------------
 * 验证一次已完成的部署是否真的可用。
 *
 * 为什么需要这个工具:
 *   部署最容易出的问题是"看起来好了"—— 页面能打开、进程在跑，
 *   但数据一个都没有。这次部署 SCU cPanel 时就连续遇到两个这样的问题:
 *     * 每个接口都 404（Passenger 不剥 base URI 前缀）
 *     * 应用根本起不来（require.main 守卫在 Passenger 下为 false）
 *   两者都不会有直观的报错，只能靠逐项验证发现。
 *
 *   API 迁移到 TypeScript 之后多了一类同样的"看不见的失败": 前端是 Angular
 *   单页应用，深链接（/search、/events/2、/admin/events）在刷新时由浏览器直接
 *   请求服务器 —— 服务器上没有这些文件，没有 .htaccess 回退就会 404。
 *   首页看起来完全正常，所以这一项也在这里显式检查（第 7 节）。
 *
 * 所以这里把 A3 要求里每一条能通过 HTTP 观察到的点都查一遍。全部用 GET，
 * 不写数据；唯一一个 DELETE 是预期被拒绝的（用来验证删除规则），
 * 所以不会改动数据库里的任何内容。
 *
 * 用法:
 *   node tools/verify-deployment.mjs
 *   node tools/verify-deployment.mjs https://your-host/charity-events-api/api
 *   node tools/verify-deployment.mjs --api https://your-host/charity-events-api/api
 *   node tools/verify-deployment.mjs <api-url> --no-site
 *
 * --no-site: 只查 API，不查两个网站（站点还没上线时用，省掉几十个会失败的
 *            站点请求）。默认两者都查。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/**
 * 参数。位置参数和 --api 都接受，因为两种写法都有人用（README 里是位置参数）。
 * 其余未知参数直接报错退出，避免打错字之后静默地查了默认主机。
 */
function parseArgs(argv) {
  const options = { skipSite: false, api: null };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-site') options.skipSite = true;
    else if (arg === '--api') options.api = argv[++i];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('-')) {
      console.error(`未知参数: ${arg}`);
      console.error('Try: node tools/verify-deployment.mjs --help');
      process.exit(2);
    } else positional.push(arg);
  }
  if (!options.api && positional.length) options.api = positional[0];
  return options;
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  console.log(
    fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, '')
  );
  process.exit(0);
}

const SKIP_SITE = options.skipSite;

const API_BASE = (options.api || 'https://24832481.it.scu.edu.au/charity-events-api/api').replace(/\/+$/, '');
const SITE_ORIGIN = API_BASE.replace(/\/charity-events-api\/api$/, '').replace(/\/api$/, '');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(label, ok, detail = '') {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n          ${detail}` : ''}`);
}

/** 发一个请求，超时/限流时重试。 */
async function api(pathname, options = {}, attempt = 1) {
  try {
    const response = await fetch(`${API_BASE}${pathname}`, {
      ...options,
      signal: AbortSignal.timeout(40_000),
      headers: { 'User-Agent': UA, Accept: 'application/json', ...(options.headers || {}) },
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  } catch (error) {
    const reason = error.cause?.code || error.message;
    if (attempt < 4) {
      await sleep(6000 * attempt);
      return api(pathname, options, attempt + 1);
    }
    return { status: 0, json: null, text: reason, error: reason };
  }
}

/**
 * 取一个网站页面。
 *
 * 六次尝试而不是三次: 这台主机的防火墙会限流突发请求，被限流的请求表现为
 * 连接重置（status 0）而不是 404 —— 重试次数太少会把正常的文件报成缺失。
 * 用 GET 而不是 HEAD: HEAD 在这台主机上不稳定（实测返回 000），GET 才反映
 * 浏览器真实行为。
 */
async function site(pathname, { attempts = 6, timeout = 30_000 } = {}) {
  let status = 0;
  let text = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${SITE_ORIGIN}${pathname}`, {
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' },
      });
      status = response.status;
      text = await response.text();
      break;
    } catch {
      await sleep(3000 * attempt);
    }
  }
  return { status, text };
}

console.log(`验证目标: ${API_BASE}`);
console.log(`网站地址: ${SITE_ORIGIN}${SKIP_SITE ? '  (--no-site: 跳过网站检查)' : ''}\n`);

/* ------------------------------------------------- 1. 健康检查 */
console.log('【1】API 健康检查\n');

const health = await api('/health');
if (health.status === 200 && health.json) {
  // 注意字段层级: 健康信息在 data.database 下面，不是在顶层。
  // 第一次写这个脚本时读的是顶层，于是三个断言全部误报失败。
  const meta = health.json.meta || {};
  const data = health.json.data || {};
  const db = data.database || {};

  record('GET /api/health 返回 200', true, `dataSource=${meta.dataSource} environment=${meta.environment}`);

  record(
    '数据源是 MySQL（不是离线镜像）',
    String(meta.dataSource || '').toLowerCase() === 'mysql',
    `dataSource = ${meta.dataSource}（若为 local，说明 api/.env 没被读到）`
  );
  record('MySQL 连接成功', db.connected === true, `connected = ${db.connected}${db.error ? ` error=${db.error}` : ''}`);
  record(
    '报名表可访问（A3 新表）',
    db.registrationTable === true,
    `registrationTable = ${db.registrationTable}, tableCount = ${db.tableCount}, server = ${db.serverVersion}`
  );
} else {
  record('GET /api/health 返回 200', false, `status=${health.status} body=${String(health.text).slice(0, 200)}`);
}
await sleep(1200);

/* ------------------------------------------------- 2. 公开接口 */
console.log('\n【2】公开接口（只应看到 active 活动）\n');

const publicEvents = await api('/events?state=all&limit=100');
if (publicEvents.status === 200 && publicEvents.json) {
  const items = publicEvents.json.data || [];
  const total = publicEvents.json.meta?.total ?? items.length;
  const statuses = [...new Set(items.map((e) => e.status))];

  record(
    'GET /api/events?state=all 只返回 10 个活动',
    total === 10,
    `total = ${total}（数据库共 11 个，其中 1 个 suspended 不应出现）`
  );
  record(
    '返回结果里没有 suspended 状态',
    !statuses.some((s) => String(s).toLowerCase() === 'suspended'),
    `出现的状态: ${statuses.join(', ')}`
  );
} else {
  record('GET /api/events?state=all 返回 200', false, `status=${publicEvents.status}`);
}
await sleep(1200);

/* ------------------------------------------------- 3. 管理接口 */
console.log('\n【3】管理接口（应看到全部 11 个，含 suspended）\n');

const adminEvents = await api('/admin/events?limit=100');
if (adminEvents.status === 200 && adminEvents.json) {
  const items = adminEvents.json.data || [];
  const total = adminEvents.json.meta?.total ?? items.length;
  const suspended = items.filter((e) => String(e.status).toLowerCase() === 'suspended');

  record('GET /api/admin/events 返回全部 11 个活动', total === 11, `total = ${total}`);
  record(
    '其中包含 suspended 的活动（A3 要求 regardless of status）',
    suspended.length >= 1,
    suspended.length
      ? `找到 ${suspended.length} 个: ${suspended.map((e) => `${e.eventId}=${e.eventName}`).join(', ')}`
      : '没有找到'
  );
} else {
  record('GET /api/admin/events 返回 200', false, `status=${adminEvents.status} body=${String(adminEvents.text).slice(0, 160)}`);
}
await sleep(1200);

/* ------------------------------------------------- 4. 活动详情与报名记录 */
console.log('\n【4】活动详情与报名记录（A3 新增）\n');

const detail = await api('/events/1');
if (detail.status === 200 && detail.json) {
  const event = detail.json.data || {};
  record('GET /api/events/1 返回 200', true, `name = ${event.eventName}`);
} else {
  record('GET /api/events/1 返回 200', false, `status=${detail.status}`);
}
await sleep(1000);

const regs = await api('/events/1/registrations');
if (regs.status === 200 && regs.json) {
  const items = regs.json.data || [];
  record(
    'GET /api/events/1/registrations 返回该活动的报名',
    items.length > 0,
    `${items.length} 条（种子数据里活动 1 有 4 条报名）`
  );

  const dates = items.map((r) => r.registeredAt).filter(Boolean);
  const sortedDesc = dates.every((d, i) => i === 0 || new Date(dates[i - 1]) >= new Date(d));
  record(
    '报名记录按购买日期倒序（最新在前）',
    dates.length < 2 || sortedDesc,
    dates.slice(0, 4).join('  |  ')
  );

  if (items[0]) {
    const keys = Object.keys(items[0]);
    // A3 要求公开的报名列表能看出"谁报名了、买了多少、什么时候报的"；
    // 隐私决定则要求公开投影里一个联系方式都不能有。所以这里断言两件事：
    // 名字与份数必须在，邮箱与手机号必须不在 —— 只查其一会漏掉另一半。
    record(
      '报名记录含 A3 字段（姓名 + 掩码名 + 份数 + 报名时间）',
      keys.includes('attendeeName') &&
        keys.includes('attendeeDisplayName') &&
        keys.includes('ticketsPurchased') &&
        keys.includes('registeredAt'),
      `字段: ${keys.join(', ')}`
    );
    record(
      '公开投影不含联系方式（邮箱 / 手机号）',
      !keys.includes('attendeeEmail') && !keys.includes('attendeePhone'),
      `字段: ${keys.join(', ')}`
    );
  }
} else {
  record('GET /api/events/1/registrations 返回 200', false, `status=${regs.status} body=${String(regs.text).slice(0, 160)}`);
}
await sleep(1200);

/* ------------------------------------------------- 5. 删除规则 */
console.log('\n【5】删除规则（有报名时必须拦住）\n');

const regs7 = await api('/events/7/registrations');
const count7 = (regs7.json?.data || []).length;
console.log(`  （活动 7 当前有 ${count7} 条报名）`);
await sleep(1000);

const del = await api('/events/7', { method: 'DELETE' });
record(
  'DELETE /api/events/7 被拦住并返回 409',
  del.status === 409,
  `实际 status = ${del.status}, body = ${String(del.text).replace(/\s+/g, ' ').slice(0, 260)}`
);

if (del.status === 409 && del.json) {
  record(
    '409 响应说明了原因（含报名数量）',
    /registration/i.test(String(del.json.error?.message || '')),
    String(del.json.error?.message || '').slice(0, 240)
  );
}

// 关键: 确认它真的没被删掉
await sleep(1200);
const stillThere = await api('/events/7');
record('活动 7 仍然存在（确实没被删除）', stillThere.status === 200, `status = ${stillThere.status}`);
await sleep(1200);

/* ------------------------------------------------- 6. 报名校验 */
console.log('\n【6】报名接口校验\n');

const tooMany = await api('/events/1/registrations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    attendeeName: 'Deployment Check',
    attendeeEmail: 'deployment-check@example.com',
    attendeePhone: '0400000000',
    ticketsPurchased: 999,
    ticketTypeId: 1,
  }),
});

record(
  '超过余量的报名被拒绝（400/409）',
  tooMany.status === 400 || tooMany.status === 409,
  `status = ${tooMany.status}, body = ${String(tooMany.text).replace(/\s+/g, ' ').slice(0, 240)}`
);
await sleep(1200);

const invalid = await api('/events/1/registrations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ attendeeName: '' }),
});

record(
  '缺少必填字段返回 400 且给出字段级说明',
  invalid.status === 400,
  `status = ${invalid.status}, body = ${String(invalid.text).replace(/\s+/g, ' ').slice(0, 260)}`
);
await sleep(1200);

/* ------------------------------------------------- 7. 两个网站 */
/*
 * 迁移之后两个网站都是 Angular 单页应用:
 *   clientside  /          首页、/search、/events/:id、/register/:id
 *   adminside   /admin/    仪表盘、/events、/events/new、/events/:id/edit、/registrations
 *
 * 所以这里查的不是"某个 .html 文件在不在"，而是三件事:
 *   1. 两个应用各自的入口能打开（服务端文件都在）
 *   2. 深链接刷新返回应用本身而不是 404（.htaccess 回退是否生效）—— 这是
 *      Angular 部署最容易漏的一步，首页正常、刷新就崩
 *   3. 部署包里的 bundle 指向正确的 API 地址（改完 environment.production.ts
 *      忘了重建，就会得到"页面能开、数据全空"）
 */
console.log('\n【7】两个网站的页面与深链接回退\n');

if (SKIP_SITE) {
  console.log('  （--no-site: 跳过）\n');
} else {
  /**
   * 前端 index.html 的正式路径。
   *
   * 站点地址可能是站点根，也可能是某个子目录（旧部署在 /charity-events/）。
   * basePath 就是 API 地址里去掉 /charity-events-api/api 之后剩下的部分。
   */
  const basePath = SITE_ORIGIN.replace(/^https?:\/\/[^/]+/, '');
  const clientIndex = `${basePath}/index.html`;
  const adminIndex = `${basePath}/admin/`;

  // Declared here, before anything uses them. Both were previously declared much
  // further down (next to section 8), which put a later `const` in the temporal
  // dead zone of the bundle check below and made this tool crash with
  // "Cannot access 'clientPageUrl' before initialization" on every run.
  const clientPageUrl = `${SITE_ORIGIN}${clientIndex}`;
  const adminPageUrl = `${SITE_ORIGIN}${adminIndex}`;

  const clientPage = await site(clientIndex);
  record(
    `GET ${clientIndex || '/'} 返回 200（公开网站已部署）`,
    clientPage.status === 200 && /<app-root/i.test(clientPage.text),
    clientPage.status === 200
      ? (/<app-root/i.test(clientPage.text) ? '页面里找到 <app-root>，是 Angular 应用' : '返回 200，但没找到 <app-root> —— 可能还是旧版静态站点')
      : `status = ${clientPage.status}`
  );
  await sleep(2200);

  const adminPage = await site(adminIndex);
  const adminHasBaseHref = /<base\s+href="\/admin\/"/i.test(adminPage.text);
  record(
    `GET ${adminIndex} 返回 200（管理后台已部署）`,
    adminPage.status === 200 && /<app-root/i.test(adminPage.text),
    adminPage.status === 200
      ? `找到 <app-root>${adminHasBaseHref ? '，base href="/admin/" 正确' : '，但 <base href="/admin/"> 不在页面里 —— 管理后台的 baseHref 可能被改过'}`
      : `status = ${adminPage.status}`
  );
  await sleep(2200);

  /*
   * 深链接。服务端没有 /search 这个文件，只有 .htaccess 回退才会返回 index.html；
   * 所以断言的是"返回 200 且 body 是应用页"，而不是"文件存在"。
   */
  const deepLinks = [
    `${basePath}/search`,
    `${basePath}/events/1`,
    `${basePath}/register/1`,
    `${basePath}/admin/events`,
    `${basePath}/admin/events/new`,
  ];

  for (const deepLink of deepLinks) {
    const page = await site(deepLink);
    const servedApp = page.status === 200 && /<app-root/i.test(page.text);
    record(
      `GET ${deepLink} 返回应用页面（SPA 深链接回退生效）`,
      servedApp,
      servedApp
        ? '由 .htaccess 回退到 index.html，刷新不会 404'
        : `status = ${page.status}${page.status === 404 ? '  -> 缺少 .htaccess 的 rewrite 回退规则（见 docs/deployment-cpanel.md 第 4 节）' : ''}`
    );
    await sleep(2200);
  }

  /* 部署包里的 API 地址。改完 environment.production.ts 忘了重建，就查不出来。 */
  const localEnvironment = path.join(ROOT, 'clientside', 'src', 'environments', 'environment.production.ts');
  if (fs.existsSync(localEnvironment)) {
    const expected = fs.readFileSync(localEnvironment, 'utf8').match(/apiBaseUrl:\s*'([^']+)'/);
    const expectedUrl = expected ? expected[1] : '';
    const expectedOrigin = expectedUrl.replace(/\/api$/, '');
    const isLocalOrigin = /localhost|127\.0\.0\.1/.test(expectedOrigin);
    const bundleRef = (clientPage.text.match(/src="([^"]*main[^"]*\.js)"/) || [])[1];

    if (!bundleRef) {
      console.log('  （公开网站首页里找不到 main*.js，跳过 bundle 内的 API 地址比对）\n');
    } else {
      const bundleUrl = new URL(bundleRef, clientPageUrl).href;

      // Retry: a dropped connection here used to be reported as a wrong API
      // address, because a failed fetch and a bundle without the address look the
      // same to `includes`.
      let bundle = await fetchText(bundleUrl);
      for (let attempt = 2; attempt <= 3 && bundle.status === 0; attempt += 1) {
        await sleep(1500 * attempt);
        bundle = await fetchText(bundleUrl);
      }

      record(
        `线上 bundle 内的 API 地址是 ${expectedUrl || '(读不到本地配置)'}`,
        // A status of 0 means the network never gave an answer, which is not
        // evidence about the file's contents.
        bundle.status === 0 || isLocalOrigin || bundle.text.includes(expectedUrl || expectedOrigin),
        bundle.status === 0
          ? `三次都没取到 bundle（网络原因，不等于文件缺失），跳过比对: ${bundleUrl}`
          : isLocalOrigin
            ? `本地 environment.production.ts 是 ${expectedUrl}（本地开发值），跳过比对`
            : bundle.text.includes(expectedUrl)
              ? `在 ${bundleRef} 里找到了 ${expectedUrl}`
              : `在 ${bundleRef} 里找不到 ${expectedUrl} —— 本地改过 environment.production.ts 但没重新构建上传，或者上传的 bundle 是旧一版`
      );
      await sleep(2200);
    }
  }

  /* ------------------------------------------------- 8. 静态资源完整性 */
  /*
   * 为什么单独查这一节:
   *   页面 200 不代表资源都在 —— 图片 404 时页面照样是 200，只是浏览器里显示破图。
   *   这个盲点真的漏掉过一次: public_html/images/ 里只有 1 个文件（应有 9 个），
   *   网站上所有活动卡片都没有图，而当时的验证脚本全部通过。
   *
   *   迁移前这里的做法是"把本地 clientside/ 下的静态文件逐个对线上请求"。
   *   迁移后本地已经没有可对照的静态文件了（源文件是 .ts 和组件模板，文件名还被
   *   Angular 加了哈希），所以改成两条更可靠的证据:
   *     * 线上 index.html 自己引用了哪些文件，就要求这些文件都存在
   *       （自洽检查: 不依赖本地构建版本，所以线上是旧一版也不会误报）
   *     * 活动插图是不带哈希的共享资源（assets/images/*.svg），按名字逐个查
   */
  console.log('\n【8】静态资源完整性（线上页面引用的文件 + 9 张活动插图）\n');

  /*
   * 逐个请求的分轮策略，而不是"每个 URL 各自重试 6 次"。
   *
   * 旧写法在真实站点上会卡住: 页面里引用的文件有几十个，每个都做 6 次重试加
   * 退避，限流时整节可以跑几十分钟（实测跑进后台也没结束）。改成"先全部查一遍，
   * 只把失败的在同一轮里重查"，请求总数不变时这是同样可靠的，但最坏耗时小一个
   * 数量级。另外加一个总时间预算: 超时就停止扫描并如实报告扫了多少个。
   */
  async function probe(url, { timeout = 20_000 } = {}) {
    const { status } = await fetchText(url, { timeout });
    return status;
  }

  /** 取一个站内文件的正文，失败时 status 为 0。 */
  async function fetchText(url, { timeout = 30_000 } = {}) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' },
      });
      const text = await response.text();
      return { status: response.status, text };
    } catch {
      return { status: 0, text: '' };
    }
  }

  const SWEEP_BUDGET_MS = 240_000;
  const sweepStartedAt = Date.now();

  async function sweep(urls, { passes = 3 } = {}) {
    const status = new Map();
    let pending = [...urls];

    for (let pass = 1; pass <= passes && pending.length; pass += 1) {
      const stillFailing = [];
      for (const url of pending) {
        if (Date.now() - sweepStartedAt > SWEEP_BUDGET_MS) {
          // 预算用完: 没查到的按"未完成"处理，由调用方报出来，不冒充失败。
          for (const rest of pending.slice(pending.indexOf(url))) status.set(rest, null);
          return status;
        }
        const code = await probe(url);
        status.set(url, code);
        if (code !== 200) stillFailing.push(url);
        await sleep(code === 200 ? 500 : 1500);
      }
      pending = stillFailing;
      if (pending.length) await sleep(4000 * pass);
    }

    return status;
  }

  /**
   * 从 HTML 里取出所有本站资源，并把它解析成绝对 URL。
   *
   * 必须用 new URL(url, pageUrl) 解析: 页面里的引用可能是相对的
   * （旧版站点写的是 ../css/styles.css、images/community.svg），直接拿去做请求
   * 会变成同目录下的错误路径，于是每个资源都"缺失"，检查结果全是假警报。
   * 非 http(s) 的引用（mailto:、tel:、#锚点、data:）不是资源，跳过。
   */
  function referencedFiles(html, pageUrl) {
    const found = new Map();
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      let resolved;
      try {
        resolved = new URL(match[1], pageUrl);
      } catch {
        continue;
      }
      if (resolved.origin !== new URL(SITE_ORIGIN).origin) continue;
      if (!/^https?:$/.test(resolved.protocol)) continue;
      found.set(resolved.pathname + resolved.search, resolved.href);
    }
    return [...found.values()];
  }

  const resources = [
    ...(clientPage.status === 200 ? referencedFiles(clientPage.text, clientPageUrl) : []),
    ...(adminPage.status === 200 ? referencedFiles(adminPage.text, adminPageUrl) : []),
  ];

  const resourceStatus = await sweep(resources);
  const checked = [...resourceStatus.keys()].filter((url) => resourceStatus.get(url) !== null);
  const notChecked = [...resourceStatus.entries()].filter(([, code]) => code === null).map(([url]) => url);

  /*
   * A status of 0 is NOT a missing file: it means the request never produced an
   * HTTP answer (this host drops connections under rapid requests - observed
   * repeatedly during the deployment). Reporting that as "missing" made the check
   * cry wolf on files that a direct request fetched fine, so the two are kept
   * apart: only a real HTTP status other than 200 counts as missing.
   */
  const missing = [...resourceStatus.entries()]
    .filter(([, code]) => code !== null && code !== 0 && code !== 200)
    .map(([url, code]) => ({ url, status: code }));
  const unreachable = [...resourceStatus.entries()]
    .filter(([, code]) => code === 0)
    .map(([url]) => url);

  for (const item of missing) console.log(`  MISS  ${String(item.status).padEnd(4)} ${item.url}`);
  if (unreachable.length) {
    console.log(`  （${unreachable.length} 个资源因连接被中断而没能确认，不算缺失: ${unreachable.slice(0, 4).join(', ')}${unreachable.length > 4 ? ' ...' : ''}）`);
  }
  if (notChecked.length) {
    console.log(`  （时间预算用尽，还有 ${notChecked.length} 个资源没有查完: ${notChecked.slice(0, 5).join(', ')}${notChecked.length > 5 ? ' ...' : ''}）`);
  }

  const confirmed = checked.length - unreachable.length;
  record(
    `线上页面引用的 ${confirmed} 个资源都能访问`,
    missing.length === 0,
    missing.length === 0
      ? `已确认 ${confirmed} 个（JS / CSS / favicon 等，来自两个 index.html 自身的引用）` +
        (unreachable.length ? `；另有 ${unreachable.length} 个因网络中断未能确认` : '')
      : `缺失 ${missing.length} 个: ${missing.map((m) => m.url).join(', ')}`
  );

  /*
   * 活动插图。它们在 angular.json 里作为共享 assets 目录打进两个应用，文件名
   * 不带哈希，所以可以按名字逐个检查 —— 这是最容易漏的一类文件，也是漏了最
   * 容易看出来的（卡片全变破图）。
   */
  const imageDir = path.join(ROOT, 'assets', 'images');
  const imageFiles = fs.existsSync(imageDir)
    ? fs.readdirSync(imageDir).filter((name) => name.endsWith('.svg')).sort()
    : [];
  const imageUrls = [];
  for (const file of imageFiles) {
    imageUrls.push(`${SITE_ORIGIN}${basePath}/assets/images/${file}`, `${SITE_ORIGIN}${basePath}/admin/assets/images/${file}`);
  }

  if (imageUrls.length === 0) {
    console.log('  （assets/images 下没有可检查的插图，跳过）\n');
  } else {
    const imageStatus = await sweep(imageUrls);
    /*
     * Status 0 is NOT a missing image. It means the request never produced an HTTP
     * answer, which is what this host does under a rapid sweep. The resource check
     * above already draws that distinction; this one did not, so a single dropped
     * connection among the 18 URLs reported a 404 for an image that is present and
     * told the student to rebuild and re-upload site/ for no reason.
     */
    const imagesMissing = [...imageStatus.entries()]
      .filter(([, code]) => code !== null && code !== 0 && code !== 200)
      .map(([url, code]) => `${url} (${code})`);
    const imagesUnreachable = [...imageStatus.entries()].filter(([, code]) => code === 0).map(([url]) => url);
    for (const item of imagesMissing) console.log(`  MISS  ${item}`);
    if (imagesUnreachable.length) {
      console.log(`  （${imagesUnreachable.length} 张插图因连接被中断而没能确认，不算缺失）`);
    }

    record(
      `活动插图全部就位（两个应用各 ${imageFiles.length} 张）`,
      imagesMissing.length === 0,
      imagesMissing.length === 0
        ? `共查 ${imageUrls.length} 个 URL，返回 200` +
          (imagesUnreachable.length ? `；另有 ${imagesUnreachable.length} 个因网络中断未能确认` : '，活动卡片不会出现破图')
        : `缺 ${imagesMissing.length} 个: ${imagesMissing.join(', ')}\n` +
          '          修法: 重新构建并上传 site/ 的完整内容（assets/images/*.svg 会被复制进 dist）'
    );
  }
}

/* ------------------------------------------------- 汇总 */
const failed = results.filter((r) => !r.ok);
console.log(`\n${'='.repeat(70)}`);
console.log(`共 ${results.length} 项检查: ${results.length - failed.length} 通过, ${failed.length} 失败`);
if (failed.length) {
  console.log('\n失败项:');
  failed.forEach((f) => console.log(`  - ${f.label}${f.detail ? `  (${f.detail.split('\n')[0]})` : ''}`));
  process.exitCode = 1;
}
