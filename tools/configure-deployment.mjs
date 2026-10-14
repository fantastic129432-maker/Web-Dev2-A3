/**
 * tools/configure-deployment.mjs
 * ---------------------------------------------------------------------------
 * 把项目里的 API 地址指向你的 cPanel 主机，让上传后不用再手改任何文件。
 *
 * 架构迁移之后，需要改的地方是这三类（其他全部是相对路径，换域名不用动）:
 *
 *   clientside/src/environments/environment.production.ts
 *   adminside/src/environments/environment.production.ts
 *       apiBaseUrl      -> 部署后的 API 地址
 *       otherSiteUrl    -> 两个网站之间的互链（/admin/ 与站点根）
 *
 *   api/.env + api/.env.example
 *       CORS_ORIGIN     -> 允许调用 API 的网站来源
 *
 * 为什么必须改:
 *   * 两个 Angular 应用都用 shared/src/api/api.service.ts 发请求，而那个服务只从
 *     `environment.apiBaseUrl` 取值；production 构建会用 fileReplacements 把
 *     environment.ts 换成 environment.production.ts（见 angular.json），所以真正
 *     上线的是 environment.production.ts 里的常量。
 *     以前这个常量是 clientside/js/config.js 的 API_BASE_URL —— 那个文件已经随旧版
 *     前端一起归档到 legacy/clientside/ 了，改它不会有任何效果。
 *   * 后端的 CORS 白名单来自 api/.env，如果不同步，浏览器会拦掉所有请求
 *     （页面能打开，但数据一个都取不到 —— 这是最常见的部署失败症状）。
 *
 * 用法（在项目根目录执行）:
 *
 *   node tools/configure-deployment.mjs \
 *     --site  https://<你的主机> \
 *     --api   https://<你的主机>/charity-events-api
 *
 *   只想看会改什么、不真正写入:
 *   node tools/configure-deployment.mjs --site ... --api ... --dry-run
 *
 *   只检查配置是否已经就绪，不改文件（已就绪退出码 0，否则 1）:
 *   node tools/configure-deployment.mjs --api ... --check
 *
 *   改回本地开发:
 *   node tools/configure-deployment.mjs --local
 *
 * --site 也可以省略，默认取 --api 的上一级路径。
 *
 * 脚本是幂等的: 已经是目标值的文件不会被重写，所以重复执行没有副作用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 项目根目录（脚本在 tools/ 下，所以是它的上一级）。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ 参数 */

function parseArgs(argv) {
  const options = { dryRun: false, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--site') options.site = argv[++i];
    else if (arg === '--api') options.api = argv[++i];
    else if (arg === '--local') options.local = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      console.error(`未知参数: ${arg}`);
      process.exit(2);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

if (options.help || (!options.local && !options.api)) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, ''));
  process.exit(options.help ? 0 : 2);
}

if (options.check && options.dryRun) {
  console.error('--check 和 --dry-run 不能同时用: --check 本身就是"不写入、只报告"的开关。');
  process.exit(2);
}

/* ------------------------------------------------------------ 计算目标值 */

/** 去掉结尾的斜杠，避免拼出 https://host//api 这种地址。 */
function tidy(url) {
  return String(url).trim().replace(/\/+$/, '');
}

/** 保证结尾有一个斜杠，用于 otherSiteUrl（浏览器里 /admin 会被当成文件路径）。 */
function withSlash(url) {
  return `${tidy(url)}/`;
}

/** 本机开发时的两个前端地址，与 angular.json 里 serve 的端口一致。 */
const LOCAL = {
  clientSite: 'http://localhost:4200',
  adminSite: 'http://localhost:4300',
  origins: [
    'http://localhost:4200',
    'http://localhost:4300',
    'http://127.0.0.1:4200',
    'http://127.0.0.1:4300',
  ],
};

let apiBaseUrl;
/** 公开网站的地址（不带结尾斜杠）。 */
let siteUrl;
/** 管理后台的地址（不带结尾斜杠）。 */
let adminUrl;
/** CORS 里要放行的来源。 */
let origins;

if (options.local) {
  // 回到本机开发的状态: 两个 Angular 应用读 localhost:3000，CORS 放行 4200/4300。
  apiBaseUrl = 'http://localhost:3000/api';
  siteUrl = LOCAL.clientSite;
  adminUrl = LOCAL.adminSite;
  origins = LOCAL.origins;
} else {
  const api = tidy(options.api);
  // API 的地址会和 '/events' 这样的路径拼接，所以必须以 /api 结尾。
  // 如果用户给的是主机地址本身，这里补上; 已经带了就不重复加。
  apiBaseUrl = /\/api$/.test(api) ? api : `${api}/api`;

  // 网站默认是 API 的同级路径（把 -api 去掉），否则用用户显式给的 --site。
  siteUrl = options.site
    ? tidy(options.site)
    : api.replace(/-api$/, '').replace(/\/api$/, '');
  // 管理后台固定挂在 /admin/ 下（angular.json 里 adminside 的 baseHref）。
  adminUrl = `${siteUrl}/admin`;
  origins = [siteUrl, adminUrl, ...LOCAL.origins];
}

if (!/^https?:\/\//.test(apiBaseUrl)) {
  console.error(`API 地址必须带协议(http:// 或 https://): ${apiBaseUrl}`);
  process.exit(2);
}

/* --------------------------------------------------------------- 改文件 */

const changes = [];

/**
 * 修改一个 environment.production.ts 里的一个常量。
 *
 * 只改 production 文件: environment.ts 是本地开发用的（npm start / ng serve），
 * 部署脚本不应该动它，否则本机开发会被指向线上 API。
 */
function editEnvironment(appDir, key, value) {
  const file = path.join(ROOT, appDir, 'src', 'environments', 'environment.production.ts');
  const label = `${appDir}/src/environments/environment.production.ts`;
  const original = fs.readFileSync(file, 'utf8');

  // 属性写成 `key: '...'`，冒号后面的引号可能是单引号也可能是双引号。
  const pattern = new RegExp(`(${key}:\\s*)(['"])([^'"]*)\\2`);
  const match = original.match(pattern);

  if (!match) {
    console.error(`在 ${label} 里找不到 ${key}，请检查文件是否被改动过。`);
    process.exit(1);
  }

  if (match[3] === value) {
    console.log(`  ${label.padEnd(54)} ${key} 已经是 ${value}`);
    return;
  }

  changes.push({
    file,
    label: `${label}  (${key})`,
    from: match[3],
    to: value,
    text: original.replace(pattern, `$1'${value}'`),
  });
}

/* 1. 两个 Angular 应用的 production environment -------------------------- */
editEnvironment('clientside', 'apiBaseUrl', apiBaseUrl);
editEnvironment('adminside', 'apiBaseUrl', apiBaseUrl);

/*
 * 跨站链接（导航栏和页脚上的"另一个网站"）:
 *   * 线上公开网站用相对路径 /admin/ —— 换成别的域名或子目录都不用重建。
 *   * 线上管理后台用绝对地址指回站点根: 它自己的 baseHref 是 /admin/，
 *     写 '/' 会被解析成 /admin/。
 *   * 本机开发时两个应用端口不同，必须都用绝对地址。
 */
editEnvironment('clientside', 'otherSiteUrl', options.local ? withSlash(adminUrl) : '/admin/');
editEnvironment('adminside', 'otherSiteUrl', withSlash(options.local ? siteUrl : '/'));

/* 2. api/.env 和 api/.env.example - CORS_ORIGIN --------------------------- */
// 两个文件都要改: .env 是本机实际生效的，.env.example 是提交给 marker 的模板，
// 两者不一致的话 marker 照模板配就会踩 CORS 的坑。
for (const name of ['api/.env', 'api/.env.example']) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) {
    console.log(`  ${name.padEnd(54)} 不存在，跳过`);
    continue;
  }

  const original = fs.readFileSync(file, 'utf8');
  const pattern = /^CORS_ORIGIN=(.*)$/m;
  const match = original.match(pattern);

  if (!match) {
    console.log(`  ${name.padEnd(54)} 没有 CORS_ORIGIN 行，跳过`);
    continue;
  }

  /*
   * 本地地址始终保留: 部署之后你仍然会想在本机跑一遍验证。
   * 5500 是旧版静态前端（legacy/clientside）的端口，保留它不会有任何问题，
   * 所以这里只做并集，不删除已有的来源。
   *
   * 已存在的值也要并进来: 目标值里没有、但别人已经配好的来源（例如另一台主机），
   * 删掉只会制造一个不明显的故障。因此 --check 只要求"目标里的来源都在"，
   * 多出来的来源不算问题 —— 否则一个正确的部署会被这个检查判成失败。
   */
  const existing = String(match[1])
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const missing = origins.filter((origin) => !existing.includes(origin));

  if (missing.length === 0) {
    console.log(`  ${name.padEnd(54)} 已经包含本次需要的来源`);
    continue;
  }

  const value = [...new Set([...existing, ...missing])].join(',');
  changes.push({
    file,
    label: name,
    from: match[1],
    to: value,
    text: original.replace(pattern, `CORS_ORIGIN=${value}`),
  });
}

/* ------------------------------------------------------------- 写 + 报告 */

if (changes.length === 0) {
  console.log('\n没有任何需要改动的地方，配置已经是对的。');
  process.exit(0);
}

console.log('');
for (const change of changes) {
  console.log(`${change.label}`);
  console.log(`    ${change.from}`);
  console.log(` -> ${change.to}`);
}

if (options.check) {
  console.log(`\n--check: 有 ${changes.length} 个文件还不是目标值（本次没有写入）。`);
  console.log('       去掉 --check 再跑一次就会写入。');
  process.exit(1);
}

if (options.dryRun) {
  console.log('\n(--dry-run: 以上改动没有写入)');
  process.exit(0);
}

for (const change of changes) {
  fs.writeFileSync(change.file, change.text, 'utf8');
}

console.log(`\n已写入 ${changes.length} 个文件。`);
console.log('\n下一步:');
console.log('  1. 重新构建 —— API 地址是被编译进 bundle 的，改完必须重建:');
console.log('     npm run build:client && npm run build:admin');
console.log('  2. 打三个 zip:  node tools/make-submission-zips.mjs --username <你的用户名>');
console.log('  3. 上传到 cPanel（步骤见 docs/deployment-cpanel.md）');
if (!options.local) {
  console.log('  4. 上传后改回本地开发，确认没有改坏本机环境:');
  console.log('     node tools/configure-deployment.mjs --local && npm run build:local');
}
