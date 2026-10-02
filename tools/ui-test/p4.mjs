// p4.mjs — P2 角动量守恒预置验收：转台+径向滑块，真实 UI 载入 → 运行 → I/ω/L/守恒误差断言
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

  // ---- 载入角动量守恒预置
  await page.selectOption('#selPreset', 'spin');
  await page.waitForTimeout(300);
  const ents = await page.evaluate(() => window.MECH.entities());
  check('预置载入: 底座+转台+滑块', ents.length === 3, JSON.stringify(ents.map((e) => e.type)));
  check('叠加层自动开启(矢量/轨迹/守恒)', await page.evaluate(() => window.MECH.vectorState().on)
    && await page.evaluate(() => window.MECH.trailState().on) === true && await page.isVisible('#consbar'));

  // 初始态基准（编辑态：ω0=3, I0≈6.50, L0≈19.485, r0=0.7）
  const s0 = await page.evaluate(() => window.MECH.rotationState());
  check('初始: ω0=3', Math.abs(s0.omega - 3) < 0.01, `ω=${s0.omega.toFixed(3)}`);
  check('初始: I0≈6.50', Math.abs(s0.I - 6.4999) < 0.05, `I=${s0.I.toFixed(3)}`);
  check('初始: L0≈19.49', Math.abs(s0.L - 19.485) < 0.05, `L=${s0.L.toFixed(3)}`);
  await page.screenshot({ path: 'shots/40-spin-edit.png' });

  // ---- 运行 4s：滑块惯性外滑（r 0.7→1.05 槽限位），I 增 ω 减，L 守恒
  await page.click('#btnPlay');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'shots/41-spin-running.png' });
  await page.click('#btnPause');
  const s1 = await page.evaluate(() => window.MECH.rotationState());
  check('滑块外滑(r>0.9)', s1.sliderR != null && s1.sliderR > 0.9, `r=${s1.sliderR != null ? s1.sliderR.toFixed(3) : 'null'}`);
  check('转动惯量增大(I>I0)', s1.I > s0.I + 0.3, `I=${s1.I.toFixed(3)} (Δ=${(s1.I - s0.I).toFixed(3)})`);
  check('角速度减小(ω<3×0.97)', s1.omega < 2.91 && s1.omega > 2.0, `ω=${s1.omega.toFixed(3)}`);
  check('角动量守恒误差<1%', s1.driftL < 1, `dL=${s1.driftL.toFixed(3)}%`);
  check('动能显示且>0', s1.KE > 0, `KE=${s1.KE.toFixed(3)} J`);
  check('外力矩=0', s1.torque === 0);

  // ---- 守恒量条 UI 读出与状态一致
  const cr = await page.evaluate(() => ({
    omega: document.getElementById('crOmega').textContent,
    I: document.getElementById('crI').textContent,
    drift: document.getElementById('crLdrift').textContent,
  }));
  check('守恒量条 rotation 模式读出', cr.omega.includes('rad/s') && cr.I.includes('kg') && cr.drift.includes('%'),
    JSON.stringify(cr));

  // ---- 检查器可编辑：转台初始 ω 3→5（重置后运行，I-ω 反比关系更陡）
  await page.click('#btnReset');
  await page.evaluate(() => {
    const t = window.MECH.entities().find((e) => e.name === '转台');
    window.MECH.select(t.id);
  });
  await page.waitForTimeout(200);
  // angvel 是 tri 输入（初角速度），改 y 分量
  const angRow = page.locator('#inspBody .frow', { has: page.locator('label', { hasText: '初角速度' }) }).locator('input');
  await angRow.nth(1).fill('5');
  await angRow.nth(1).press('Enter');
  await page.waitForTimeout(250);
  const s2 = await page.evaluate(() => window.MECH.rotationState());
  check('初角速度可编辑(3→5)', Math.abs(s2.omega - 5) < 0.01, `ω=${s2.omega.toFixed(3)}`);

  await page.click('#btnPlay');
  await page.waitForTimeout(4000);
  await page.click('#btnPause');
  const s3 = await page.evaluate(() => window.MECH.rotationState());
  check('ω=5 时 L 仍守恒(<1%)', s3.driftL < 1, `dL=${s3.driftL.toFixed(3)}%`);
  check('ω=5 时滑块外滑+ω 减小', s3.sliderR > 0.9 && s3.omega < 5, `r=${s3.sliderR.toFixed(3)} ω=${s3.omega.toFixed(3)}`);
  await page.screenshot({ path: 'shots/42-spin-omega5.png' });

  // ---- 重置/单步通用控制
  await page.click('#btnReset');
  await page.click('#btnStep');
  await page.waitForTimeout(150);
  const stR = await page.evaluate(() => window.MECH.state());
  check('重置+单步可用', stR.mode === 'run' && stR.paused && stR.simT > 0, `t=${stR.simT.toFixed(4)}`);

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
