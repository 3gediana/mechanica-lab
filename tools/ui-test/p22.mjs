// p22.mjs — Round 25 验收：能量堆叠曲线（运动/能量双模式：动能KE/势能PE/总E 对照）
// 三场景三教学点：斜面（摩擦耗散 E1<E0 + PE↔KE 交换）、动量（无耗散 E 守恒）、
// 弹簧（弹性势能入账后 E 守恒）。
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

  // ==== A. 斜面（有摩擦）：PE↔KE 交换 + E 单调不增（耗散教学点） ====
  await page.selectOption('#selPreset', 'incline');
  await page.waitForTimeout(400);
  await page.click('#btnCurves');
  await page.click('#curveTabEnergy');
  await page.click('#btnPlay');
  await page.waitForTimeout(2500);
  await page.click('#btnPause');
  const cs = await page.evaluate(() => window.MECH.curveState());
  check('能量模式采样中', cs.mode === 'energy' && cs.samples >= 10, JSON.stringify({ mode: cs.mode, n: cs.samples }));
  check('图例含 动能KE/势能PE/总能量E', await page.evaluate(() => {
    const t = [...document.querySelectorAll('#curveLegend span')].map((s) => s.textContent);
    return t.length === 3 && t.includes('动能KE') && t.includes('势能PE') && t.includes('总能量E');
  }), '');
  check('能量交换(末帧 KE>PE)', cs.energy.ke > cs.energy.pe, `末帧 KE=${cs.energy.ke} PE=${cs.energy.pe}`);
  check('摩擦耗散(E1 < E0)', cs.energy.e1 < cs.energy.e0,
    `E0=${cs.energy.e0} E1=${cs.energy.e1} 损耗=${((1 - cs.energy.e1 / cs.energy.e0) * 100).toFixed(1)}%`);
  await page.screenshot({ path: 'shots/220-energy-curves.png' });

  // ==== B. 动量预置改完全弹性（restitution→1，走检查器同款 updateEntity）：E 守恒 ====
  await page.selectOption('#selPreset', 'momentum');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    for (const e of window.MECH.doc().entities) {
      if (e.type === 'sphere') window.MECH.updateEntity(e.id, { physics: { ...e.physics, restitution: 1 } }, '改完全弹性');
    }
  });
  await page.waitForTimeout(300);
  await page.click('#btnReset');
  await page.waitForTimeout(300);
  await page.click('#btnPlay');
  await page.waitForTimeout(2200);
  await page.click('#btnPause');
  const me = await page.evaluate(() => window.MECH.curveState().energy);
  check('无耗散场景 E 守恒(<2%)', Math.abs(me.e1 - me.e0) / Math.max(Math.abs(me.e0), 1e-9) < 0.02,
    `E0=${me.e0} E1=${me.e1}`);

  // ==== C. 弹簧场景：弹性势能入账 → E 守恒（damping=0 fixture）====
  await page.click('#tabAgent');
  await page.evaluate(() => window.MECH.loadFixture('spring'));
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(400);
  await page.click('#btnPlay');
  await page.waitForTimeout(2500);
  await page.click('#btnPause');
  const se = await page.evaluate(() => window.MECH.curveState().energy);
  check('弹簧 E 守恒(弹性势能入账, <5%)', Math.abs(se.e1 - se.e0) / Math.max(Math.abs(se.e0), 1e-9) < 0.05,
    `E0=${se.e0} E1=${se.e1}`);
  await page.screenshot({ path: 'shots/221-spring-energy.png' });

  // ==== D. 运动模式回归：切回后速率/高度照常 ====
  await page.click('#curveTabMotion');
  // 固定 300ms 在负载下可能只采到 1 个样（采样节流 0.15s）：等待重采到位
  await page.waitForFunction(() => window.MECH.curveState().samples >= 2, null, { timeout: 5000 });
  const cm = await page.evaluate(() => window.MECH.curveState());
  check('切回运动模式重采', cm.mode === 'motion' && cm.samples >= 2, `mode=${cm.mode} n=${cm.samples}`);
  check('运动图例恢复(含速率/高度)', await page.evaluate(() => {
    const t = [...document.querySelectorAll('#curveLegend span')].map((s) => s.textContent);
    return t.some((x) => x.includes('速率')) && t.some((x) => x.includes('高度'));
  }), '');

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
