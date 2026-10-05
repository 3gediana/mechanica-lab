// p3.mjs — P2 天体运动预置 + 轨迹线验收：真实 UI 载入 → 运行两圈 → 轨迹/守恒量断言
// 纪律：单浏览器 / 单 context / 单标签；总时长上限约 2 分钟。
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

  // ---- 载入天体运动预置
  await page.selectOption('#selPreset', 'celestial');
  await page.waitForTimeout(300);
  const ents = await page.evaluate(() => window.MECH.entities());
  check('预置载入: 恒星+卫星', ents.length === 2 && ents.every((e) => e.type === 'celestial'),
    JSON.stringify(ents.map((e) => e.type)));
  check('叠加层自动开启(轨迹+守恒)', await page.evaluate(() => window.MECH.trailState().on) === true
    && await page.isVisible('#consbar'), JSON.stringify(await page.evaluate(() => window.MECH.trailState())));

  // ---- 真实 UI 运行两圈多（理论周期 T=2πr/v = 5.03s）
  await page.click('#btnPlay');
  await page.waitForTimeout(12000);
  await page.screenshot({ path: 'shots/30-celestial-orbit.png' });
  await page.click('#btnPause');
  const st = await page.evaluate(() => ({ s: window.MECH.state(), a: window.MECH.astroState(), t: window.MECH.trailState() }));
  check('运行时长>=10s(2圈)', st.s.simT > 10, `simT=${st.s.simT.toFixed(1)}s`);
  check('引力动力学: 卫星在绕行(轨迹采样)', st.t.lines >= 2 && Math.min(...st.t.points) > 500,
    `lines=${st.t.lines} points=${JSON.stringify(st.t.points)}`);
  check('能量漂移<2%', st.a && st.a.driftE < 2, `dE=${st.a.driftE.toFixed(3)}%`);
  check('角动量漂移<2%', st.a && st.a.driftL < 2, `dL=${st.a.driftL.toFixed(3)}%`);
  check('近圆轨道 e<0.05', st.a.ecc != null && st.a.ecc < 0.05, `e=${st.a.ecc != null ? st.a.ecc.toFixed(4) : 'null'}`);
  check('周期≈5.0s(理论2πr/v)', st.a.period != null && st.a.period > 4.5 && st.a.period < 5.6,
    st.a.period != null ? `T=${st.a.period.toFixed(2)}s` : 'null');
  const { caE, caL, caEcc, caT } = await page.evaluate(() => ({
    caE: document.getElementById('caE').textContent,
    caL: document.getElementById('caL').textContent,
    caEcc: document.getElementById('caEcc').textContent,
    caT: document.getElementById('caT').textContent,
  }));
  check('守恒量条 astro 模式读出', caE.includes('J') && caL.includes('kg') && caEcc !== '--' && caT.includes('s'),
    JSON.stringify({ caE, caL, caEcc, caT }));

  // ---- 检查器可编辑：卫星质量 1→2（圆轨道速度与卫星质量无关，轨道应保持）
  await page.click('#btnReset');
  await page.evaluate(() => {
    const sat = window.MECH.entities().find((e) => e.name === '卫星');
    window.MECH.select(sat.id);
  });
  await page.waitForTimeout(200);
  const massInput = page.locator('#inspBody .frow', { has: page.locator('label', { hasText: '质量' }) }).locator('input');
  await massInput.fill('2');
  await massInput.press('Enter');
  await page.waitForTimeout(250);
  await page.click('#btnPlay');
  await page.waitForTimeout(11000);
  await page.click('#btnPause');
  const a2 = await page.evaluate(() => window.MECH.astroState());
  check('卫星质量可编辑且轨道仍稳定(漂移<2%)', a2 && a2.driftE < 2 && a2.driftL < 2,
    `dE=${a2.driftE.toFixed(3)}% dL=${a2.driftL.toFixed(3)}%`);
  await page.screenshot({ path: 'shots/31-celestial-mass2.png' });

  // ---- 通用控制（暂停/单步/重置）
  await page.click('#btnReset');
  await page.click('#btnStep');
  await page.waitForTimeout(150);
  const stR = await page.evaluate(() => window.MECH.state());
  check('重置+单步可用', stR.mode === 'run' && stR.paused && stR.simT > 0, `mode=${stR.mode} t=${stR.simT.toFixed(4)}`);

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
