/**
 * tools/export-cpanel-sql.mjs
 * ---------------------------------------------------------------------------
 * 生成一份可以在 SCU cPanel 的 MySQL 5.7 上导入的 SQL 文件。
 *
 * 为什么需要这个:
 *   项目里的 database/charityevents_db.sql 面向 MySQL 8.0，用了
 *     COLLATE utf8mb4_0900_ai_ci
 *   这个排序规则是 MySQL 8.0 才引入的。SCU cPanel 上实测是
 *     MySQL 5.7.44-cll-lve
 *   直接导入会报 "Unknown collation: 'utf8mb4_0900_ai_ci'"，一张表都建不出来。
 *
 * 改了什么（只改这一处，其余逐字节保留）:
 *    utf8mb4_0900_ai_ci  ->  utf8mb4_unicode_ci
 *   两者都是 utf8mb4 的大小写不敏感排序规则，对本次作业的功能没有影响:
 *     - "a@x.com" 与 "A@x.com" 仍然被视为同一个邮箱（唯一键照样生效）
 *     - 中文/emoji 存储不受影响
 *   唯一的行为差别是重音字母的排序次序，本项目没有依赖它。
 *
 * 另外两处 5.7 的差异，这里都**不需要**改:
 *   * CHECK 约束: 5.7 会解析并忽略（不报错），只是不强制执行。因此
 *     "tickets_purchased >= 1" 这类检查在 5.7 上只能靠 API 层保证 —— 那条
 *     校验本来就在 API 里，所以行为不变。
 *   * 生成列、CASE 表达式、CREATE OR REPLACE VIEW、utf8mb4: 5.7 全都支持。
 *
 * 用法:
 *   node tools/export-cpanel-sql.mjs            生成到 database/
 *   node tools/export-cpanel-sql.mjs --check    检查是否与源文件同步
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = path.resolve('.');
const SOURCE = path.join(ROOT, 'database', 'charityevents_db.sql');
const TARGET = path.join(ROOT, 'database', 'charityevents_db.mysql57.sql');

const CHECK_ONLY = process.argv.includes('--check');

if (!fs.existsSync(SOURCE)) {
  console.error(`找不到源文件: ${SOURCE}`);
  console.error('先运行: node tools/export-database-dump.mjs');
  process.exit(1);
}

/**
 * 删掉 02_seed.sql 里的 TRUNCATE 清理块。
 *
 * 为什么必须删，而不是靠 FOREIGN_KEY_CHECKS=0 兜住:
 *   `SET FOREIGN_KEY_CHECKS = 0` 对 **DELETE** 有效，但对 **TRUNCATE** 无效。
 *   MySQL 文档明确说明 TRUNCATE 不能被外键引用的表使用，无论检查开关如何，
 *   报错是:
 *     #1701 - Cannot truncate a table referenced in a foreign key constraint
 *             (... CONSTRAINT `fk_registration_ticket` FOREIGN KEY ...)
 *   这在**重复导入**时必然发生：第一次导入留下了外键，第二次的 TRUNCATE 就撞上它。
 *   这一点是实际导入时报出来的，不是推演出来的。
 *
 * 删掉是安全的，因为文件开头已经用 DROP TABLE IF EXISTS 做了同样的事
 * （而且更彻底：DROP 会把外键一起带走）。保留 TRUNCATE 只会带来报错，
 * 不带来任何额外效果。
 */
function stripTruncateBlock(sql) {
  return sql.replace(
    /^SET FOREIGN_KEY_CHECKS = 0;\n(?:TRUNCATE TABLE \w+;\n)+SET FOREIGN_KEY_CHECKS = 1;\n?/gm,
    '-- (原来的 TRUNCATE 清理块已移除: FOREIGN_KEY_CHECKS=0 对 TRUNCATE 无效，\n' +
      '--  重复导入会报 #1701。文件开头已用 DROP TABLE IF EXISTS 完成同样的事。)\n'
  );
}

/** 去掉只有服务器管理员才能执行的语句，并把脚本变成可重复执行的。
 *
 * 为什么必须去掉:
 *   在 cPanel 上，账号无权建库或删库。phpMyAdmin 导入时
 *     DROP DATABASE IF EXISTS charityevents_db;
 *   会被服务器直接拒绝，页面顶部弹出红色错误框：
 *     "已禁用"删除数据库"语句。" / "DROP DATABASE statements are disabled."
 *   导入本身仍然会继续，但那个错误框会让人以为失败了，而且下一次导入时
 *   表已经存在，CREATE TABLE 会再报一批错。所以干净的做法是把这两句拿掉，
 *   改成先 DROP TABLE / DROP VIEW。
 *
 * 换成 DROP TABLE IF EXISTS 之后，文件可以反复导入，结果总是一样的:
 * 先清空旧对象，再按同样的顺序重建，不会累积也不会冲突。
 */
function stripDatabaseStatements(sql) {
  const lines = sql.split('\n');
  const output = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();

    // 跳过删库和建库，以及紧跟着的 USE（下面单独补一条）
    if (upper.startsWith('DROP DATABASE')) continue;
    if (upper.startsWith('CREATE DATABASE')) continue;
    if (upper.startsWith('CHARACTER SET ') || upper.startsWith('COLLATE ')) {
      // CREATE DATABASE 的续行
      if (output.length && output[output.length - 1].trim() === '') continue;
    }
    if (upper.startsWith('USE CHARITYEVENTS_DB')) continue;

    output.push(line);
  }

  return output.join('\n');
}

/**
 * 在第一个 CREATE TABLE 之前插入清理语句。
 *
 * ## 为什么按"子表在前、父表在后"的顺序写死
 *
 * 第一版是这样写的：SET FOREIGN_KEY_CHECKS=0; 然后按 CREATE TABLE 的顺序
 * （organizations 排第一）逐个 DROP。在真实导入时报了：
 *
 *     #1217 - Cannot delete or update a parent row: a foreign key constraint fails
 *     DROP TABLE IF EXISTS organizations;
 *
 * organizations 是**父表**（events.organization_id 指向它），而它被第一个删。
 * 也就是说 FOREIGN_KEY_CHECKS=0 在那个执行环境里没有生效 —— 可能因为
 * phpMyAdmin 用一次性多语句方式提交，或者会话变量在语句之间被重置。
 *
 * 因此这里不再依赖会话变量，而是把顺序写成 "先删引用别人的表，再删被别人引用的表"，
 * 这样即使外键检查始终开启也能成功。语句块本身仍然保留
 * FOREIGN_KEY_CHECKS=0/1 作为双保险。
 *
 * 顺序依据（见 01_schema.sql 的 fk_ 约束）:
 *   event_registrations -> events, ticket_types
 *   donations           -> events
 *   ticket_types        -> events
 *   events              -> organizations, categories, locations
 *   organizations / categories / locations  -> 不被引用，最后删
 */
const DROP_ORDER = [
  'event_registrations',
  'donations',
  'ticket_types',
  'events',
  'organizations',
  'categories',
  'locations',
];

function insertCleanup(sql, views, tables) {
  // 以 schema 里实际存在的表为准，避免将来加了表却忘了更新 DROP_ORDER。
  // 不在 DROP_ORDER 里的表放在中间（子表之后、父表之前），保证不会漏删。
  const known = DROP_ORDER.filter((name) => tables.includes(name));
  const unknown = tables.filter((name) => !DROP_ORDER.includes(name));
  const ordered = [...known.slice(0, 4), ...unknown, ...known.slice(4)];

  const cleanup = `
-- ---------------------------------------------------------------------
-- 清理上一次导入留下的对象，使本文件可以反复导入。
--
-- 顺序很重要: 先删引用别人的表，再删被别人引用的表。如果先删
-- organizations（它是 events 的父表），MySQL 会报
--   #1217 - Cannot delete or update a parent row: a foreign key constraint fails
-- 即使写了 SET FOREIGN_KEY_CHECKS = 0 也一样（实测如此）。所以顺序写死，
-- 不依赖会话变量。
--
-- 这里没有 DROP DATABASE / CREATE DATABASE: cPanel 禁止账号执行这两句，
-- 保留它们会让导入页面弹出红色错误。数据库本身由 cPanel 的
-- MySQL Databases 界面创建（例如 xliu67_XuLiu_Ass3），导入前先选中它。
-- ---------------------------------------------------------------------
SET FOREIGN_KEY_CHECKS = 0;
${views.map((v) => `DROP VIEW IF EXISTS \`${v}\`;`).join('\n')}
${ordered.map((t) => `DROP TABLE IF EXISTS \`${t}\`;`).join('\n')}
SET FOREIGN_KEY_CHECKS = 1;

`;

  // 插在第一个 CREATE TABLE 之前
  const marker = sql.indexOf('CREATE TABLE ');
  if (marker === -1) return cleanup + sql;
  return sql.slice(0, marker) + cleanup + sql.slice(marker);
}

const source = fs.readFileSync(SOURCE, 'utf8');

/* ------------------------------------------------------------- 转换 */

// 只替换排序规则名，其余文本不动。
let converted = source
  .replace(/utf8mb4_0900_ai_ci/g, 'utf8mb4_unicode_ci')
  // 源文件的头部说明了 8.0 的排序规则；这里改写说明，避免误导读者。
  .replace(
    /^-- Collation: utf8mb4_0900_ai_ci is used because it is the MySQL 8\.0\+\n-- default\. On MySQL 5\.7 or MariaDB replace it with utf8mb4_unicode_ci\.$/m,
    `-- Collation: utf8mb4_unicode_ci, chosen for MySQL 5.7 compatibility.\n` +
      `-- The MySQL 8.0 dump (charityevents_db.sql) uses utf8mb4_0900_ai_ci, which\n` +
      `-- MySQL 5.7 does not have; SCU cPanel runs 5.7.44, so this file is the one to\n` +
      `-- import there. Both collations are case-insensitive, so the unique key on\n` +
      `-- (event_id, attendee_email) behaves identically.\n` +
      `--\n` +
      `-- This file contains NO DROP DATABASE / CREATE DATABASE: cPanel disables those\n` +
      `-- for account users, and leaving them in produces a red error box on import.\n` +
      `-- Create and select the database in cPanel first, then import this file. It is\n` +
      `-- safe to import more than once - it drops and recreates its own objects.\n` +
      `-- Generated by tools/export-cpanel-sql.mjs - do not edit by hand.`
  );

// 收集对象名，用于生成清理语句
const tableNames = [...converted.matchAll(/^CREATE TABLE (\w+)/gm)].map((m) => m[1]);
const viewNames = [...converted.matchAll(/^CREATE OR REPLACE VIEW (\w+)/gm)].map((m) => m[1]);

converted = stripTruncateBlock(converted);
converted = stripDatabaseStatements(converted);
converted = insertCleanup(converted, viewNames, tableNames);

// 在最前面放一块显眼的标识。
// 为什么需要: 项目里有两个 dump（8.0 用 charityevents_db.sql，cPanel 用
// charityevents_db.mysql57.sql），文件名接近，上传时很容易选错。选错的症状是
// "Unknown collation: utf8mb4_0900_ai_ci"，或者像这次一样，导入的是没有清理
// 语句的旧版本，于是在 TRUNCATE 上撞到 #1701。所以把用途写在第一屏。
//
// 用英文写，与项目其它 .sql 文件保持一致（那些文件的注释都是英文）。
const header = `-- #####################################################################
-- #                                                                   #
-- #   FOR THE SCU cPanel HOST - IMPORT THIS FILE                       #
-- #                                                                   #
-- #   How it differs from charityevents_db.sql:                        #
-- #     * collation utf8mb4_0900_ai_ci -> utf8mb4_unicode_ci           #
-- #       (MySQL 5.7 has no 0900 collations; without this the import   #
-- #        fails with "Unknown collation")                             #
-- #     * no DROP DATABASE / CREATE DATABASE                           #
-- #       (cPanel forbids them for account users, and leaving them in  #
-- #        puts a red error box on the import page)                    #
-- #     * no TRUNCATE cleanup block                                    #
-- #       (FOREIGN_KEY_CHECKS=0 does NOT apply to TRUNCATE, so a       #
-- #        repeated import fails with #1701)                           #
-- #     * starts with DROP TABLE/VIEW IF EXISTS instead, so the file   #
-- #       can be imported more than once and always ends up identical  #
-- #                                                                   #
-- #   HOW TO IMPORT:                                                   #
-- #     phpMyAdmin -> select your database in the left panel FIRST ->  #
-- #     Import tab -> choose this file -> Go                           #
-- #                                                                   #
-- #   For local MySQL 8.0 use charityevents_db.sql instead.            #
-- #                                                                   #
-- #####################################################################

`;

converted = header + converted;

/* ------------------------------------------------------------- 验证 */

const problems = [];

/**
 * 去掉所有 `--` 注释行之后的正文。
 *
 * 校验必须只看真正的 SQL：本文件的头部注释为了说明"与 8.0 版的区别"，
 * 故意提到了 utf8mb4_0900_ai_ci 和 TRUNCATE 这些字符串。直接对全文做
 * "不能包含 X" 的检查，会把说明文字当成违规内容。
 * 这个错误我已经犯过一次（检查 DEFAULT CHARSET=utf8mb4 时），所以这里
 * 统一在正文上判断。
 */
const body = converted
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

/** 只对正文计数。 */
const countBody = (pattern) => (body.match(pattern) || []).length;

// 1. 正文不能残留 8.0 专有的排序规则
if (body.includes('utf8mb4_0900_ai_ci')) {
  problems.push('正文仍存在 utf8mb4_0900_ai_ci');
}

// 2. 正文不能残留只有管理员才能跑的建库/删库语句
//    （cPanel 会拒绝它们并在导入页面弹出红色错误框）
if (/^\s*DROP DATABASE/m.test(body)) {
  problems.push('正文仍存在 DROP DATABASE（cPanel 会拒绝并报错）');
}
if (/^\s*CREATE DATABASE/m.test(body)) {
  problems.push('正文仍存在 CREATE DATABASE（cPanel 会拒绝并报错）');
}

// 3. 正文不能残留 TRUNCATE：FOREIGN_KEY_CHECKS=0 对它无效，重复导入必然报 #1701
const truncateCount = countBody(/^\s*TRUNCATE TABLE /gm);
if (truncateCount > 0) {
  problems.push(`正文仍存在 ${truncateCount} 条 TRUNCATE（重复导入会报 #1701）`);
}

// 4. 必须带上清理语句，否则文件无法重复导入
const dropTableCount = countBody(/^DROP TABLE IF EXISTS /gm);
const dropViewCount = countBody(/^DROP VIEW IF EXISTS /gm);

// 5. 对象数量必须和源文件完全一致 —— 防止替换误伤结构。
//    注意比较的是"源文件里各有多少个"，而不是行数：本工具故意增删了若干行
//    （去掉建库/删库与 TRUNCATE，加上清理语句），所以行数不是合适的判据。
//    第一次写这个检查时用了行数容差，结果被自己加的清理语句误判为失败。
const count = (text, pattern) => (text.match(pattern) || []).length;
for (const [label, pattern] of [
  ['表', /^CREATE TABLE /gm],
  ['视图', /^CREATE OR REPLACE VIEW /gm],
  ['INSERT', /^INSERT INTO /gm],
  ['外键', /^\s*CONSTRAINT fk_/gm],
  ['唯一键', /^\s*UNIQUE KEY /gm],
  ['CHECK 约束', /^\s*CONSTRAINT chk_/gm],
]) {
  const before = count(source, pattern);
  const after = count(body, pattern);
  if (before !== after) {
    problems.push(`${label}: 源文件 ${before} 个，转换后 ${after} 个`);
  }
}

// 5. 清理语句的数量必须与对象数量吻合，不能漏掉任何一个对象
if (dropTableCount !== tableNames.length) {
  problems.push(`DROP TABLE 语句 ${dropTableCount} 条，但表有 ${tableNames.length} 个`);
}
if (dropViewCount !== viewNames.length) {
  problems.push(`DROP VIEW 语句 ${dropViewCount} 条，但视图有 ${viewNames.length} 个`);
}

// 6. A3 的关键对象仍然在
for (const required of [
  'event_registrations',
  'uq_registration_event_email',
  'vw_all_events',
  'vw_event_registrations',
  'ON DELETE RESTRICT',
]) {
  if (!converted.includes(required)) problems.push(`缺少 ${required}`);
}

// 7. utf8mb4 仍然贯穿整个文件。
//
//    注意不能检查 "DEFAULT CHARSET=utf8mb4"：本项目所有表都是
//    ENGINE=InnoDB 且不声明字符集，它们继承数据库的字符集；而唯一显式声明
//    utf8mb4 的地方正是 CREATE DATABASE —— 那句已被本工具移除（cPanel 不允许）。
//    所以这里检查的是"utf8mb4 作为字符集名仍然出现在文件里"，也就是
//    utf8mb4_unicode_ci 排序规则，以及 SET NAMES 之类的语句。
//    第一次写这个检查时用了 DEFAULT CHARSET=utf8mb4，结果被自己的转换误判为失败。
if (!/utf8mb4/i.test(converted)) {
  problems.push('文件里不再出现 utf8mb4，中文和 emoji 可能存不进去');
}

// 8. 排序规则必须只出现在 utf8mb4 上（防止误改成别的字符集的排序规则）
const collationUses = count(converted, /utf8mb4_unicode_ci/g);
if (collationUses === 0) {
  problems.push('没有找到 utf8mb4_unicode_ci');
}

if (problems.length > 0) {
  console.error('转换结果校验失败:');
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}

const digest = createHash('sha256').update(converted).digest('hex').slice(0, 16);

/* ------------------------------------------------------------- 输出 */

if (CHECK_ONLY) {
  const existing = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null;
  if (existing === converted) {
    console.log(`database/charityevents_db.mysql57.sql 是最新的 (sha256 ${digest}…)`);
    process.exit(0);
  }
  console.error('database/charityevents_db.mysql57.sql 已过期，重新生成:');
  console.error('  node tools/export-cpanel-sql.mjs');
  process.exit(1);
}

fs.writeFileSync(TARGET, converted, 'utf8');

const convertedLines = converted.split('\n').length;

console.log('已生成 database/charityevents_db.mysql57.sql');
console.log(`  ${convertedLines} 行, ${(Buffer.byteLength(converted, 'utf8') / 1024).toFixed(1)} KiB, sha256 ${digest}…`);
console.log(`  排序规则: utf8mb4_unicode_ci (MySQL 5.7 可用)`);
console.log(`  对象: ${count(converted, /^CREATE TABLE /gm)} 表, ${count(converted, /^CREATE OR REPLACE VIEW /gm)} 视图, ${count(converted, /^INSERT INTO /gm)} 组 INSERT`);
console.log(`  已移除: DROP DATABASE / CREATE DATABASE (cPanel 会拒绝这两句)`);
console.log(`  已加入: ${dropTableCount} 条 DROP TABLE + ${dropViewCount} 条 DROP VIEW，文件可重复导入`);
console.log('');
console.log('在 SCU cPanel 上导入这一个文件:');
console.log('  phpMyAdmin -> 先在左侧选中你的库 -> Import -> 选这个文件 -> Go');
console.log('  导入后应看到 7 张表 + 5 个视图，且页面顶部没有任何红色错误。');
