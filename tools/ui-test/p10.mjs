// p10.mjs — Round 12 验收：受力分解（N/f 分列+数值对照）/ 目录收藏 / 单位标尺读数
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

  // ==== A. 受力分解（斜面预置）
  await page.selectOption('#selPreset', 'incline');
  await page.waitForTimeout(300);
  await page.click('#btnForces');
  await page.click('#btnDecompose');
  await page.waitForTimeout(150);
  const decOn = await page.evaluate(() => window.MECH.forceState().decompose);
  check('分解模式开启', decOn === true);
  await page.click('#btnPlay');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'shots/95-decompose.png' });

  // 数值对照：选中球 forceDecompose —— N 实测 vs mg·cosθ（光滑斜面滑动，f≈0）
  await page.click('#btnPause');
  const fd = await page.evaluate(() => {
    const ball = window.MECH.entities().find((e) => e.type === 'sphere');
    return window.MECH.forceDecompose(ball.id);
  });
  check('受力分解: 结构化输出(N/f/θ)', fd && fd.N && fd.f && typeof fd.thetaDeg === 'number',
    JSON.stringify(fd));
  // 斜面 26.57°：N 理论 = mg·cosθ ≈ 1×9.81×0.894 ≈ 8.77 N（球质量 1kg）
  const nTheory = 1 * 9.81 * Math.cos(Math.atan2(0.8, 1.6));
  check('支持力 N ≈ mg·cosθ(±15%)', fd && Math.abs(fd.N.measured - nTheory) / nTheory < 0.15,
    `N=${fd.N.measured} th=${nTheory.toFixed(2)} θ=${fd.thetaDeg}`);
  check('摩擦力分解出且小于支持力', fd && fd.f.measured > 0.3 && fd.f.measured < fd.N.measured,
    `f=${fd.f.measured} N=${fd.N.measured} muEff=${fd.f.muEff}`);
  // 分解自洽：N⊥f，勾股和 = 合力模长（contactMag）
  const total = Math.hypot(fd.N.measured, fd.f.measured);
  check('分解自洽(√(N²+f²)=|contact| <1%)', Math.abs(total - fd.contactMag) / fd.contactMag < 0.01,
    `hypo=${total.toFixed(3)} contact=${fd.contactMag.toFixed(3)}`);
  await page.click('#btnReset');
  await page.click('#btnDecompose');   // 关分解
  await page.click('#btnForces');      // 关受力

  // ==== B. 目录收藏
  await page.locator('.comp-item', { hasText: '斜坡' }).locator('.fav').click();
  await page.waitForTimeout(250);
  const favHead = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#catalogList .cat-head')].map((h) => h.textContent);
    return { has: heads.some((x) => x.includes('收藏')), heads };
  });
  check('收藏分组出现', favHead.has, JSON.stringify(favHead.heads));
  const favPersist = await page.evaluate(() => localStorage.getItem('mechanica.favorites.components'));
  check('收藏持久化(localStorage)', favPersist && favPersist.includes('ramp'), favPersist);
  await page.screenshot({ path: 'shots/96-favorites.png' });

  // ==== C. 单位标尺读数
  const sr = await page.textContent('#scaleReadout');
  check('单位标尺读数', sr.includes('1 格 = 1 m') && sr.includes('视野宽'), sr.trim());
  await page.evaluate(() => {
    const r = window.MECH.entities().find((e) => e.type === 'ramp');
    window.MECH.select(r.id);
  });
  await page.click('#btnFocus');     // 聚焦斜面：相机距离显著变化
  await page.waitForTimeout(500);
  const sr2 = await page.textContent('#scaleReadout');
  check('标尺随相机更新', sr !== sr2, `${sr.trim()} → ${sr2.trim()}`);

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
