// p13.mjs — Round 15 验收：绳张力箭头（专门箭池）+ ghost 跟随鼠标
// 纪律：单浏览器 / 单 context / 单标签；总时长上限约 2 分钟。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8721';
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

  // ==== A. 张力箭头（绳连接两球，受力开 → 张力箭可见）
  await page.selectOption('#selPreset', 'atwood');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const a = window.MECH.entities().find((e) => e.name.includes('左'));
    const b = window.MECH.entities().find((e) => e.name.includes('右'));
    window.MECH.select(a.id);
    window.MECH.select(b.id, true);
  });
  await page.locator('.comp-item', { hasText: '绳' }).click();
  await page.waitForTimeout(300);
  await page.click('#btnForces');
  await page.click('#btnPlay');       // 张力箭头需演化数据（差分反推）
  await page.waitForTimeout(800);
  const ts = await page.evaluate(() => window.MECH.tensionState ? window.MECH.tensionState() : null) ||
    await page.evaluate(() => {
      // 张力箭池状态经 viewport——MECH 没直接暴露，用 forceState + DOM 无。此处通过截图目检。
      return window.MECH.forceState();
    });
  check('受力开启(张力随动)', ts.on === true, JSON.stringify(ts));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shots/120-tension-arrows.png' });

  // 张力池断言：经 arrowStats 之外的独立通道——p13 用 MECH.tensionState（本轮新增）
  const tstate = await page.evaluate(() => window.MECH.tensionState ? window.MECH.tensionState() : { total: -1 });
  check('张力箭池建立(2 箭/绳)', tstate.total >= 2, JSON.stringify(tstate));

  // ==== B. ghost 跟随鼠标
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.waitForTimeout(300);
  // hover 「球」行（最近使用区可能置顶绳/弹簧等 isLink 项——它们无单体 ghost 是正确语义）
  const ballItem = page.locator('.comp-item', { hasText: '球' }).first();
  await ballItem.hover();
  await page.waitForTimeout(200);
  // hover 后 ghost 出现在视口中央偏上；移动鼠标 ghost 应跟随
  await page.mouse.move(700, 300);
  await page.waitForTimeout(300);
  await page.mouse.move(900, 500);
  await page.waitForTimeout(300);
  await ballItem.hover();          // 再入球行确保 ghost 存在（sticky 下不必须，防状态漂移）
  await page.waitForTimeout(150);
  // Round 27 起 ghost 真实显示（修复死代码）+ sticky 跟随：断言状态与位置变化
  const g1 = await page.evaluate(() => window.MECH.ghostState());
  await page.mouse.move(600, 400);
  await page.waitForTimeout(250);
  const g2 = await page.evaluate(() => window.MECH.ghostState());
  check('ghost 显示且跟随(sticky)', g1.visible && g2.visible, JSON.stringify({ g1: g1.visible, g2: g2.visible }));
  check('ghost 位置随鼠标变化', JSON.stringify(g1.pos) !== JSON.stringify(g2.pos),
    `${JSON.stringify(g1.pos)} → ${JSON.stringify(g2.pos)}`);
  await page.screenshot({ path: 'shots/121-ghost-follow.png' });

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
