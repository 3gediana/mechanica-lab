// p9.mjs — Round 11 验收：当前任务徽标 / 目录搜索与最近使用 / 绳连接 / 弹簧题九步（简谐解释）
// 纪律：单浏览器 / 单 context / 单标签；总时长上限约 3 分钟。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
mkdirSync('shots', { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

  // ==== 1. 当前任务徽标状态机
  await page.click('#tabAgent');
  const stage0 = await page.textContent('#taskStage');
  check('任务徽标存在(初始未开始)', stage0.trim() === '未开始', stage0);
  await page.evaluate(() => window.MECH.loadFixture('incline'));
  await page.waitForTimeout(200);
  const stage1 = await page.textContent('#taskStage');
  check('任务徽标: 解析后待确认', stage1.trim() === '待确认', stage1);

  // ==== 2. 目录搜索 + 最近使用
  await page.click('#catalogSearch');
  await page.fill('#catalogSearch', '球');
  await page.waitForTimeout(200);
  const hitRows = await page.evaluate(() => document.querySelectorAll('#catalogList .comp-item').length);
  const hitHead = await page.textContent('#catalogList .cat-head');
  check('目录搜索过滤', hitRows >= 1 && hitHead.includes('搜索结果'), `hits=${hitRows} head=${hitHead.trim()}`);
  await page.fill('#catalogSearch', '');
  await page.waitForTimeout(200);
  await page.fill('#catalogSearch', '');
  await page.waitForTimeout(150);
  // 放置防穿模后默认槽位可能被拒（incline 高端槽位落在坡体内）——先开空场景保证槽位必空，
  // 测的是「添加→最近使用分组」这条链路本身
  await page.click('#btnNew');
  await page.waitForTimeout(250);
  await page.locator('.comp-item', { hasText: '球' }).first().click();   // 触发最近使用记录
  await page.waitForTimeout(250);
  await page.fill('#catalogSearch', '');
  await page.waitForTimeout(250);
  const hasRecent = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#catalogList .cat-head')].map((h) => h.textContent);
    return heads.some((x) => x.includes('最近使用'));
  });
  check('最近使用分组(添加后出现)', hasRecent);
  await page.screenshot({ path: 'shots/90-catalog-search.png' });

  // ==== 3. 绳连接（手动：选中两实体 → 添加绳）
  await page.evaluate(() => window.MECH.loadPreset('momentum'));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const a = window.MECH.entities().find((e) => e.name.includes('球 A'));
    const b = window.MECH.entities().find((e) => e.name.includes('球 B'));
    window.MECH.select(a.id);
    window.MECH.select(b.id, true);
  });
  await page.locator('.comp-item', { hasText: '绳' }).click();
  await page.waitForTimeout(300);
  const ropeDoc = await page.evaluate(() => window.MECH.doc().entities.find((e) => e.type === 'rope'));
  check('绳连接两实体(手动)', ropeDoc && Array.isArray(ropeDoc.attach) && ropeDoc.attach.length === 2,
    ropeDoc ? JSON.stringify({ attach: ropeDoc.attach, len: ropeDoc.params.length }) : 'null');

  // ==== 4. 弹簧题九步（fixture）
  await page.click('#tabAgent');
  const splan = await page.evaluate(() => window.MECH.loadFixture('spring'));
  check('弹簧 fixture 载入(kind=spring+attaches)', splan && splan.kind === 'spring' && splan.attaches.length === 1
    && splan.attaches[0].stiffness === 20, JSON.stringify({ kind: splan && splan.kind, at: splan && splan.attaches }));
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(300);
  const sdoc = await page.evaluate(() => window.MECH.doc());
  const springE = sdoc.entities.find((e) => e.type === 'spring');
  check('弹簧建场: 墙+球+弹簧(attaches 映射)', sdoc.entities.some((e) => e.type === 'spring')
    && sdoc.entities.some((e) => e.type === 'box' && e.name.includes('立柱'))
    && springE && Array.isArray(springE.attach) && springE.attach.length === 2
    && springE.params.stiffness === 20,
    JSON.stringify(sdoc.entities.map((e) => e.type)));

  // ==== 5. 运行 → spring 解释（简谐周期）
  await page.click('#tabAgent');
  await page.click('#btnRunExplain');
  await page.waitForFunction(() => {
    const b = document.getElementById('explainBody');
    return b && b.textContent.length > 80;
  }, null, { timeout: 25000 });
  const ex = await page.evaluate(() => window.MECH.explainState());
  check('spring 解释器: 结构化输出', ex && ex.supported && ex.kind === 'spring', ex ? `kind=${ex.kind}` : 'null');
  check('spring: 理论周期≈1.72s(2π√(m/k))', Math.abs(ex.theoretical.period - 1.721) < 0.01,
    `T=${ex.theoretical.period.toFixed(3)}`);
  check('spring: 实测周期偏差<8%', ex.pass && ex.errPct < 8,
    `T=${ex.measured.period != null ? ex.measured.period.toFixed(3) : '?'} err=${ex.errPct != null ? ex.errPct.toFixed(2) : '?'}%`);
  await page.screenshot({ path: 'shots/91-spring-explain.png' });

  // ==== 徽标终态
  const stageE = await page.textContent('#taskStage');
  check('任务徽标: 已解释', stageE.trim() === '已解释', stageE);

  await page.close();
  await context.close();
} finally {
  await browser.close();
}

console.log('\n== 汇总 ==');
const nFail = results.filter((r) => !r.ok).length;
console.log(`PASS ${results.length - nFail}/${results.length}`);
if (consoleErrors.length) {
  console.log('浏览器 console/page 错误:');
  for (const e of consoleErrors.slice(0, 12)) console.log('  ', e.slice(0, 300));
}
process.exit(nFail === 0 && consoleErrors.length === 0 ? 0 : 1);
