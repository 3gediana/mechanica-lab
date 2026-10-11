// p42-liquid.mjs — 液体浮与沉端到端（U-LIQ）：sinkfloat 预置 → 木块漂浮/铁块沉底。
// 物理口径：木块 ρ=600 浮，平衡浸没 60% → 中心 y ≈ 液面(1.195) − 0.02；铁块 ρ=7800 沉底 → y ≈ 底板顶 0.06 + 半高 0.1。
// 判稳口径：0.6s 窗口 |Δy| < 0.03（液面静稳，不含拍打期）。
// 用法：MECH_BASE=http://127.0.0.1:8722 node p42-liquid.mjs
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const browser = await chromium.launch({ headless: true });

const results = [];
const ok = (name, cond, detail = '') => {
  results.push([cond ? 'PASS' : 'FAIL', name, detail]);
  if (!cond) process.exitCode = 1;
};

try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 820 } })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.evaluate(() => { window.MECH.perfHud(false); window.MECH.loadPreset('sinkfloat'); });
  await page.waitForTimeout(600);

  await page.evaluate(() => document.getElementById('btnPlay').click());
  // 等木块落水+稳定（≥4s 模拟时间）
  await page.waitForTimeout(4600);

  const sample = () => page.evaluate(() => {
    const ents = window.MECH.entities();
    const wood = ents.find((e) => e.name && e.name.includes('木块'));
    const iron = ents.find((e) => e.name && e.name.includes('铁块'));
    const wBind = wood && window.MECH.__vp._bindLookup(wood.id);
    const iBind = iron && window.MECH.__vp._bindLookup(iron.id);
    return {
      wy: wBind ? +wBind.mesh.position.y.toFixed(4) : null,
      iy: iBind ? +iBind.mesh.position.y.toFixed(4) : null,
      surf: 1.195, // 水槽 pos.y=0.6, sy=1.2 → 顶 1.2 − 5mm
    };
  });
  const s1 = await sample();
  await page.waitForTimeout(600);
  const s2 = await sample();
  await page.evaluate(() => window.MECH.pause());

  ok('木块存在且 y 有限', s1.wy != null && Number.isFinite(s1.wy), `wy=${s1.wy}`);
  ok('铁块存在且 y 有限', s1.iy != null && Number.isFinite(s1.iy), `iy=${s1.iy}`);
  // 漂浮平衡：液面 1.195，浸没 60% → 中心 = 液面 − (0.6·0.2 − 0.1) = 液面 − 0.02 ≈ 1.175
  ok('木块漂浮在液面附近（y∈[1.06,1.27]）', s2.wy >= 1.06 && s2.wy <= 1.27, `wy=${s2.wy} (理论 1.175)`);
  ok('木块未沉入深水（全程 y > 1.0）', s1.wy > 1.0, `wy@4.6s=${s1.wy}`);
  ok('木块已静稳（0.6s |Δy|<0.03）', Math.abs(s2.wy - s1.wy) < 0.03, `Δ=${(s2.wy - s1.wy).toFixed(4)}`);
  // 沉底：底板顶 y=0.06 + 半高 0.1 → 0.16
  ok('铁块沉底（y∈[0.08,0.30]）', s2.iy >= 0.08 && s2.iy <= 0.30, `iy=${s2.iy} (理论 0.16)`);
  ok('铁块已静稳（0.6s |Δy|<0.03）', Math.abs(s2.iy - s1.iy) < 0.03, `Δ=${(s2.iy - s1.iy).toFixed(4)}`);
  ok('无 console 错误', errors.length === 0, errors[0] || '');
} finally {
  await browser.close();
}

console.log('\n== 汇总 ==');
for (const [st, name, detail] of results) console.log(`${st}  ${name}${detail ? '  | ' + detail : ''}`);
const pass = results.filter((r) => r[0] === 'PASS').length;
console.log(`\nPASS ${pass}/${results.length}`);
if (pass !== results.length) process.exitCode = 1;
