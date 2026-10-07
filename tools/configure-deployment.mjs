/**
 * tools/configure-deployment.mjs
 * ---------------------------------------------------------------------------
 * 把项目里的 API 地址指向你的 cPanel 主机，让上传后不用再手改任何文件。
 *
 * 需要改的地方只有两处（其他全部是相对路径，换域名不用动）:
 *
 *   clientside/js/config.js   API_BASE_URL   -> 部署后的 API 地址
 *   api/.env(.example)        CORS_ORIGIN     -> 部署后的网站地址
 *
 * 为什么必须改:
 *   * 前端所有 fetch 都走 js/api.js，而 api.js 只从 config.js 读 API_BASE_URL，
 *     所以换域名只改这一个常量。
 *   * 后端的 CORS 白名单来自 api/.env，如果不同步，浏览器会拦掉所有请求
 *     （页面能打开，但数据一个都取不到 —— 这是最常见的部署失败症状）。
 *
 * 用法（在项目根目录执行）:
 *
 *   node tools/configure-deployment.mjs \
 *     --site  https://<你的主机>/charity-events \
 *     --api   https://<你的主机>/charity-events-api
 *
 *   只想看会改什么、不真正写入:
 *   node tools/configure-deployment.mjs --site ... --api ... --dry-run
 *
 *   改回本地开发:
 *   node tools/configure-deployment.mjs --local
 *
 * --site 也可以省略，默认取 --api 的上一级路径。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');

/* ------------------------------------------------------------------ 参数 */

function parseArgs(argv) {
  const options = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--site') options.site = argv[++i];
    else if (arg === '--api') options.api = argv[++i];
    else if (arg === '--local') options.local = true;
    else if (arg === '--dry-run') options.dryRun = true;
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

/* ------------------------------------------------------------ 计算目标值 */

/** 去掉结尾的斜杠，避免拼出 https://host//api 这种地址。 */
function tidy(url) {
  return String(url).trim().replace(/\/+$/, '');
}

let apiBaseUrl;
let siteUrl;

if (options.local) {
  // 回到本机开发的状态: 客户端读 localhost:3000，CORS 放行 5500。
  apiBaseUrl = 'http://localhost:3000/api';
  siteUrl = 'http://localhost:5500';
} else {
  const api = tidy(options.api);
  // API 的地址在 api.js 里会和 '/events' 这样的路径拼接，所以必须以 /api 结尾。
  // 如果用户给的是主机地址本身，这里补上; 已经带了就不重复加。
  apiBaseUrl = /\/api$/.test(api) ? api : `${api}/api`;

  // 网站默认是 API 的同级路径（把 -api 去掉），否则用用户显式给的 --site。
  siteUrl = options.site
    ? tidy(options.site)
    : api.replace(/-api$/, '').replace(/\/api$/, '');
}

if (!/^https?:\/\//.test(apiBaseUrl)) {
  console.error(`API 地址必须带协议(http:// 或 https://): ${apiBaseUrl}`);
  process.exit(2);
}

/* --------------------------------------------------------------- 改文件 */

const changes = [];

/* 1. clientside/js/config.js - API_BASE_URL ------------------------------- */
{
  const file = path.join(ROOT, 'clientside', 'js', 'config.js');
  const original = fs.readFileSync(file, 'utf8');

  const pattern = /(export const API_BASE_URL = ')([^']*)(';)/;
  const match = original.match(pattern);

  if (!match) {
    console.error(`在 ${file} 里找不到 API_BASE_URL，请检查文件是否被改动过。`);
    process.exit(1);
  }

  if (match[2] === apiBaseUrl) {
    console.log(`  clientside/js/config.js      已经是 ${apiBaseUrl}`);
  } else {
    changes.push({
      file,
      label: 'clientside/js/config.js',
      from: match[2],
      to: apiBaseUrl,
      text: original.replace(pattern, `$1${apiBaseUrl}$3`),
    });
  }
}

/* 2. api/.env 和 api/.env.example - CORS_ORIGIN --------------------------- */
// 两个文件都要改: .env 是本机实际生效的，.env.example 是提交给 marker 的模板，
// 两者不一致的话 marker 照模板配就会踩 CORS 的坑。
for (const name of ['api/.env', 'api/.env.example']) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) {
    console.log(`  ${name.padEnd(28)} 不存在，跳过`);
    continue;
  }

  const original = fs.readFileSync(file, 'utf8');
  const pattern = /^CORS_ORIGIN=(.*)$/m;
  const match = original.match(pattern);

  if (!match) {
    console.log(`  ${name.padEnd(28)} 没有 CORS_ORIGIN 行，跳过`);
    continue;
  }

  // 本地地址始终保留: 部署之后你仍然会想在本机跑一遍验证。
  const origins = new Set([siteUrl, 'http://localhost:5500', 'http://127.0.0.1:5500']);
  const value = [...origins].join(',');

  if (match[1] === value) {
    console.log(`  ${name.padEnd(28)} 已经是 ${value}`);
    continue;
  }

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

if (options.dryRun) {
  console.log('\n(--dry-run: 以上改动没有写入)');
  process.exit(0);
}

for (const change of changes) {
  fs.writeFileSync(change.file, change.text, 'utf8');
}

console.log(`\n已写入 ${changes.length} 个文件。`);
console.log('\n下一步:');
console.log('  1. 打三个 zip:  node tools/make-submission-zips.mjs --username <你的用户名>');
console.log('  2. 上传到 cPanel（步骤见 docs/deployment-cpanel.md）');
if (!options.local) {
  console.log('  3. 上传后重新跑一遍本机测试，确认没有改坏本地开发:');
  console.log('     node tools/configure-deployment.mjs --local && node tests/run-tests.js');
}
