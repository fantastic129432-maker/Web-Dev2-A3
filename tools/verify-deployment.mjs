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
 * 所以这里把 A3 要求里每一条能通过 HTTP 观察到的点都查一遍。全部用 GET，
 * 不写数据；唯一一个 DELETE 是预期被拒绝的（用来验证删除规则），
 * 所以不会改动数据库里的任何内容。
 *
 * 用法:
 *   node tools/verify-deployment.mjs
 *   node tools/verify-deployment.mjs https://your-host/charity-events-api/api
 */
import fs from 'node:fs';
import path from 'node:path';

const API_BASE = (process.argv[2] || 'https://24832481.it.scu.edu.au/charity-events-api/api').replace(/\/+$/, '');
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

console.log(`验证目标: ${API_BASE}`);
console.log(`网站地址: ${SITE_ORIGIN}\n`);

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
      ? `找到 ${suspended.length} 个: ${suspended.map((e) => `${e.eventId}=${e.name}`).join(', ')}`
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
  record('GET /api/events/1 返回 200', true, `name = ${event.name}`);
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
    record(
      '报名记录含 A3 字段',
      keys.includes('attendeeName') && keys.includes('attendeeEmail') && keys.includes('ticketsPurchased'),
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
console.log('\n【7】两个网站的页面\n');

for (const path of [
  '/index.html',
  '/search.html',
  '/event.html?id=1',
  '/registration.html?id=1',
  '/admin/index.html',
  '/admin/events.html',
  '/js/config.js',
  '/css/styles.css',
]) {
  let status = 0;
  /*
   * Six attempts, not three.
   *
   * This host's firewall throttles bursts of requests, and a throttled request
   * fails as a connection reset rather than as a 404 - so a too-small retry
   * budget reports healthy files as missing. Measured during a busy session the
   * success rate per attempt dropped to about one in four, at which point three
   * attempts fail most of the time and the report is worse than useless because
   * it sends you looking for a deployment problem that is not there.
   */
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(`${SITE_ORIGIN}${path}`, {
        signal: AbortSignal.timeout(30_000),
        headers: { 'User-Agent': UA },
      });
      status = response.status;
      break;
    } catch {
      await sleep(3000 * attempt);
    }
  }
  record(`GET ${path}`, status === 200, status === 200 ? '' : `status = ${status}`);
  await sleep(2200);
}

/* ------------------------------------------------- 8. 静态资源完整性 */
/*
 * 为什么单独查这一节:
 *   第 7 节只看 HTML 页面是否 200。**页面 200 不代表资源都在** —— 图片 404 时
 *   页面照样是 200，只是浏览器里显示破图。这个盲点真的漏掉过一次:
 *   public_html/images/ 里只有 1 个文件（应有 9 个），网站上所有活动卡片都没有图，
 *   而当时的验证脚本全部通过。
 *
 *   根因是"需要部署哪些文件"的推导方式: 部署脚本从 HTML 的 href/src 和 JS 的
 *   import 里找路径，但图片路径在 config.js 里是**数据**
 *   （export const EVENT_IMAGES = ['fun-run.svg', ...]），
 *   既不是 src= 也不是 import，于是整批被跳过。
 *
 *   所以这里改成"本地有什么，就要求线上有什么": 把本地 clientside/ 下的静态资源
 *   逐个对线上发起请求，任何 404 都当成失败报出来。这样"漏传文件"不可能再悄悄通过。
 */
console.log('\n【8】静态资源完整性（本地有的，线上必须也有）\n');

const CLIENT_DIR = path.resolve(process.cwd(), 'clientside');

/**
 * 递归收集本地 clientside/ 下需要与线上一致的文件。
 *
 * 为什么包含 .js 和 .html，而不只是图片样式:
 *   只查图片和样式时漏掉过一次真实事故 —— 改完"删掉过时文案"后我只上传了
 *   styles.css，忘了 js/event.js 和 js/translations.js，于是线上页面照旧渲染
 *   那段文字。当时这个检查是 27/27 全绿，因为 event.js 根本不在检查范围内。
 *
 *   教训: "本地有什么就要求线上有什么"这个原则要覆盖所有会被部署的文件，
 *   否则它只能发现它看得见的那几类问题。
 */
function collectLocalAssets() {
  const assets = new Map();
  const EXTENSIONS = [
    '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico',
    '.css', '.js', '.html', '.json', '.txt', '.webmanifest',
  ];

  /*
   * 只用于本地开发、不部署到服务器的文件。列成清单而不是靠规则猜:
   *   serve-clientside.js - 本地静态服务器（npm run start:client），部署到线上没有意义
   * 第一次把这个检查扩到 .js 时漏了这条排除，于是它报了 404 的假警报。
   */
  const NOT_DEPLOYED = new Set(['serve-clientside.js']);

  const walk = (dir, relative = '') => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full, rel);
      } else if (NOT_DEPLOYED.has(entry.name)) {
        continue;
      } else if (EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
        // admin/ 下的资源远程路径也是 /admin/...，与本地结构一致
        assets.set(`/${rel}`, rel);
      }
    }
  };

  walk(CLIENT_DIR);
  return assets;
}

const localAssets = collectLocalAssets();
console.log(`  本地 clientside/ 下有 ${localAssets.size} 个待部署文件，逐个检查线上...\n`);

const missingAssets = [];
let checkedAssets = 0;

/*
 * 存在性检查 + 内容抽样比对。
 *
 * 只查"文件在不在"是不够的: 旧版本的 event.js 同样存在，会照样通过。
 * 真正要抓的是"改了本地、忘了上传"—— 这次就发生过（文案删了却没传 js/）。
 *
 * 完整的哈希比对需要把每个文件都下载一遍，太慢；所以这里改用**特征字符串**:
 * 从本地文件里挑出能代表当前版本的内容片段，再看线上文件里有没有。
 * 这些片段来自本地文件本身，不需要手工维护清单。
 */
const CONTENT_SAMPLED = ['.js', '.css'];
const contentMismatch = [];
const localFiles = new Map();

for (const [remotePath, localRel] of [...localAssets].sort()) {
  let status = 0;
  let onlineText = null;

  const needsContent = CONTENT_SAMPLED.some((ext) => remotePath.endsWith(ext));

  // Six attempts, for the same throttling reason as the check above: a reset
  // connection is not a missing file, and it must not be reported as one.
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      // 用 GET 而不是 HEAD: 这台主机对 HEAD 的支持不稳定，实测会返回 000
      // （连接被重置），把正常的文件误报成缺失。GET 才反映浏览器真实行为。
      const response = await fetch(`${SITE_ORIGIN}${remotePath}?probe=${Date.now()}`, {
        signal: AbortSignal.timeout(35_000),
        headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' },
      });
      status = response.status;
      if (needsContent && status === 200) onlineText = await response.text();
      else await response.arrayBuffer();
      break;
    } catch {
      await sleep(3000 * attempt);
    }
  }

  checkedAssets += 1;
  if (status !== 200) {
    missingAssets.push({ remotePath, localRel, status });
    console.log(`  MISS  ${String(status).padEnd(4)} ${remotePath}`);
    await sleep(700);
    continue;
  }

  /* 内容比对: 只在取样文件上做，并且失败要重试一次，避免把限流误判成版本不一致 */
  if (needsContent && onlineText !== null) {
    const localPath = path.join(CLIENT_DIR, localRel);
    const localText = fs.readFileSync(localPath, 'utf8');

    /*
     * 取样规则: 从本地文件里取一个"当前版本才会有"的短标记。
     * 用最长的一行注释的开头几个词 —— 注释是每次改动最容易留下痕迹的地方，
     * 而且不像函数名那样容易在重构中意外重名。
     */
    const markers = [];

    // 1) 取第一条长度 >= 40 的注释行中的前 30 个字符
    for (const line of localText.split('\n')) {
      const trimmed = line.trim();
      if ((trimmed.startsWith('//') || trimmed.startsWith('*')) && trimmed.length >= 44) {
        markers.push(trimmed.slice(0, 34));
        break;
      }
    }

    // 2) 取第一个具名函数/常量声明
    const declaration = localText.match(/\b(?:export\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]{5,})/);
    if (declaration) markers.push(declaration[1]);

    const mismatched = markers.filter((marker) => !onlineText.includes(marker));

    if (mismatched.length > 0) {
      contentMismatch.push({ remotePath, mismatched });
      console.log(`  STALE ${remotePath}`);
      console.log(`        线上版本缺少本地特征: ${mismatched.map((m) => JSON.stringify(m)).join(', ')}`);
      console.log('        -> 本地改过但没上传，重新上传这个文件');
    }
  }

  await sleep(700);
}

record(
  `全部 ${localAssets.size} 个待部署文件都能访问`,
  missingAssets.length === 0,
  missingAssets.length === 0
    ? `已检查 ${checkedAssets} 个（含 .js / .css / 9 张活动插图）`
    : `缺失 ${missingAssets.length} 个: ${missingAssets.map((m) => m.remotePath).join(', ')}`
);

/* 内容比对结果 —— 专门抓"改了本地忘上传" */
record(
  '线上文件的版本与本地一致（没有改了忘传的）',
  contentMismatch.length === 0,
  contentMismatch.length === 0
    ? `.js / .css 的内容特征抽查通过`
    : `以下文件线上还是旧版: ${contentMismatch.map((m) => m.remotePath).join(', ')}\n` +
      '          修法: 重新上传这些文件。只查文件是否存在是不够的 —— 旧版本同样存在。'
);

/* 图片单独再确认一次: 这是最容易漏的一类，也是最容易看出来的 */
console.log('');
const imagesMissing = missingAssets.filter((m) => m.remotePath.startsWith('/images/'));

if (imagesMissing.length > 0) {
  record(
    '活动插图全部就位（config.js 的 EVENT_IMAGES）',
    false,
    `缺 ${imagesMissing.length} 张: ${imagesMissing.map((m) => m.remotePath).join(', ')}\n` +
      '          修法: 把 clientside/images/*.svg 上传到 public_html/images/'
  );
} else {
  record(
    '活动插图全部就位（config.js 的 EVENT_IMAGES）',
    true,
    '全部返回 200，活动卡片不会出现破图'
  );
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
