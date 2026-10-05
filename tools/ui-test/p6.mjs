// p6.mjs — Round 8 验收：能量条 / 碰撞时刻标记 / 框选多选 / 大纲重命名锁定 / 天体题解析+解释
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

  // ==== A+B. 动量预置：能量条 + 碰撞时刻标记
  await page.evaluate(() => {   // 批量负载下 selectOption 偶发丢 change（一轮 p8 教训）：显式派发
    const s = document.querySelector('#selPreset');
    s.value = 'momentum';
    s.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(() => {
    const eb = document.getElementById('ebFill'), pct = document.getElementById('ebPct');
    return !!(eb && pct && eb.offsetWidth > 0 && pct.offsetWidth > 0);
  }, null, { timeout: 15000 });
  check('守恒量条含能量保持率', await page.isVisible('#ebFill') && await page.isVisible('#ebPct'));
  await page.click('#btnPlay');
  await page.waitForFunction(() => window.MECH.consState().reports.some((r) => r.t > 0.5), null, { timeout: 15000 });
  await page.waitForTimeout(400);
  const imp = await page.evaluate(() => window.MECH.impactCount());
  check('碰撞时刻标记环出现', imp >= 1, `markers=${imp}`);
  const eb = await page.textContent('#ebPct');
  check('能量条读数(%)', eb.includes('%') && parseFloat(eb) > 0, `eb=${eb}`);
  await page.screenshot({ path: 'shots/60-impact-energy.png' });
  await page.waitForTimeout(2000);
  check('标记环 1.5s 后淡出', await page.evaluate(() => window.MECH.impactCount()) === 0);
  await page.click('#btnReset');

  // ==== C+D. spin 预置：大纲重命名/锁定 → 框选多选 → 多选删除
  await page.selectOption('#selPreset', 'spin');
  await page.waitForTimeout(400);

  // 重命名（双击大纲行）
  const rowNm = page.locator('#outline .ol-row', { hasText: '转台' }).locator('.nm');
  await rowNm.dblclick();
  const rnInput = page.locator('#outline input');
  await rnInput.fill('旋转平台');
  await rnInput.press('Enter');
  await page.waitForTimeout(250);
  const docNm = await page.evaluate(() => window.MECH.doc().entities.find((e) => e.name.includes('旋转平台')));
  check('大纲重命名(双击)', !!docNm, docNm ? docNm.name : 'null');

  // 锁定滑块
  const lockBtn = page.locator('#outline .ol-row', { hasText: '滑块' }).locator('.lock');
  await lockBtn.click();
  await page.waitForTimeout(250);
  const lockedDoc = await page.evaluate(() => window.MECH.doc().entities.find((e) => e.name === '滑块'));
  check('锁定写入文档', lockedDoc && lockedDoc.locked === true, `locked=${lockedDoc && lockedDoc.locked}`);

  // 框选多选：锁定者不可入选
  await page.click('#btnBoxSel');
  const cv = await page.locator('#stage canvas').boundingBox();
  const cx = cv.x + cv.width / 2, cy = cv.y + cv.height / 2;
  await page.mouse.move(cx - 320, cy - 200);
  await page.mouse.down();
  await page.mouse.move(cx + 200, cy + 120, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const sel = await page.evaluate(() => window.MECH.selectionState());
  const pickedLocked = lockedDoc && sel.ids.includes(lockedDoc.id);
  check('框选多选(>=2, 锁定者除外)', sel.ids.length >= 2 && !pickedLocked,
    `ids=${sel.ids.length} pickedLocked=${pickedLocked}`);
  await page.screenshot({ path: 'shots/61-box-select.png' });

  // 多选删除（删掉框选中的全部）
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  const cnt = await page.evaluate(() => window.MECH.state().count);
  check('多选删除(仅剩锁定者)', cnt === 1, `count=${cnt}`);
  await page.screenshot({ path: 'shots/62-rename-lock.png' });

  // ==== E. 天体题 fixture → 建场 → astro 解释
  await page.click('#tabAgent');
  const cplan = await page.evaluate(() => window.MECH.loadFixture('celestial'));
  check('天体 fixture 载入', cplan && cplan.entities.length === 2 && cplan.entities.every((e) => e.type === 'celestial'),
    JSON.stringify(cplan && cplan.entities.map((e) => e.type)));
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(300);
  const cdoc = await page.evaluate(() => window.MECH.doc());
  check('天体建场(2 celestial, gravitating)', cdoc.entities.length === 2 && cdoc.entities.every((e) => e.physics.gravitating === true),
    JSON.stringify(cdoc.entities.map((e) => ({ t: e.type, g: e.physics.gravitating }))));

  await page.click('#tabAgent');
  await page.click('#btnRunExplain');
  await page.waitForFunction(() => {
    const b = document.getElementById('explainBody');
    return b && b.textContent.length > 80;
  }, null, { timeout: 25000 });
  const ex = await page.evaluate(() => window.MECH.explainState());
  check('astro 解释器: 结构化输出', ex && ex.supported && ex.kind === 'astro', ex ? `kind=${ex.kind}` : 'null');
  check('astro: E/L 漂移<2%', ex.driftE < 2 && ex.driftL < 2, `dE=${ex.driftE.toExponential(1)} dL=${ex.driftL.toExponential(1)}`);
  check('astro: 周期≈理论(5%)', ex.pass && ex.measured.period != null
    && Math.abs(ex.measured.period - ex.theoretical.period) / ex.theoretical.period * 100 < 5,
    `T=${ex.measured.period != null ? ex.measured.period.toFixed(2) : '?'} th=${ex.theoretical.period.toFixed(2)}`);
  await page.screenshot({ path: 'shots/63-astro-explain.png' });

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
