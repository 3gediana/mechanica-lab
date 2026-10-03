// p14.mjs — Round 16 验收：抛体拍题九步（射程/高度解释）+ 阿特伍德张力面板 + 标尺增强
// 纪律：单浏览器 / 单 context / 单标签；总时长上限约 3 分钟。
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

  // ==== A. 抛体预置：运行 2.5s → projectile 解释
  await page.selectOption('#selPreset', 'projectile');
  await page.waitForTimeout(400);
  check('抛体预置: 球+地面', (await page.evaluate(() => window.MECH.entities())).length === 2);
  await page.click('#btnPlay');
  await page.waitForTimeout(2600);
  await page.click('#btnPause');
  await page.screenshot({ path: 'shots/130-projectile.png' });

  // 拍题九步（fixture）
  await page.click('#tabAgent');
  const plan = await page.evaluate(() => window.MECH.loadFixture('projectile'));
  check('抛体 fixture 载入', plan && plan.entities.length === 1 && plan.entities[0].given.velocity[0] === 4,
    JSON.stringify(plan && plan.entities));
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(300);
  const pd = await page.evaluate(() => window.MECH.doc());
  check('抛体建场: 球+地面', pd.entities.length === 2 && pd.entities.some((e) => e.type === 'ground'),
    JSON.stringify(pd.entities.map((e) => e.type)));
  await page.click('#tabAgent');
  await page.click('#btnRunExplain');
  await page.waitForFunction(() => {
    const b = document.getElementById('explainBody');
    return b && b.textContent.length > 80;
  }, null, { timeout: 25000 });
  const ex = await page.evaluate(() => window.MECH.explainState());
  check('projectile 解释器: 结构化输出', ex && ex.supported && ex.kind === 'projectile', ex ? `kind=${ex.kind}` : 'null');
  check('projectile: 射程偏差<8%', ex.pass && ex.errPct < 8,
    `R 实测=${ex.measured.range.toFixed(2)} 理论=${ex.theoretical.range.toFixed(2)} err=${ex.errPct.toFixed(2)}%`);
  check('projectile: 判定通过', ex.pass === true);
  await page.screenshot({ path: 'shots/131-projectile-explain.png' });

  // ==== B. 阿特伍德张力面板
  await page.selectOption('#selPreset', 'atwood');
  await page.waitForTimeout(300);
  await page.click('#btnPlay');
  await page.waitForTimeout(2200);
  const cw = await page.evaluate(() => ({
    M: document.getElementById('cwM').textContent,
    T: document.getElementById('cwT').textContent,
    aT: document.getElementById('cwAT').textContent,
    aM: document.getElementById('cwAM').textContent,
    err: document.getElementById('cwErr').textContent,
  }));
  check('阿特伍德张力面板读数', cw.M.includes('1.2') && cw.T.includes('N') && cw.err.includes('%'),
    JSON.stringify(cw));
  check('面板加速度偏差<10%', parseFloat(cw.err) < 10, `err=${cw.err}`);
  await page.screenshot({ path: 'shots/132-atwood-panel.png' });

  // ==== C. 标尺增强读数
  const sr = await page.textContent('#scaleReadout');
  check('标尺含格数换算', sr.includes('格'), sr.trim());

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
