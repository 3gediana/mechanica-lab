// p45-fly-material.mjs — U-MAT 材质物理 + U-FLY 自由漫游交互探针。
// A. 换材质自动套用：橡胶→μ0.9/e0.85/m=ρV 重算；冰→μ0.03；fixed 体不重算质量。
// B. 漫游：按钮切换热态、W 前进位移沿视线、拖拽转头 yaw 变化、Esc 退出回轨道。
// 用法：MECH_BASE=http://127.0.0.1:8722 node p45-fly-material.mjs
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

  // ==== A. 材质→物理 ====
  const mat = await page.evaluate(() => {
    const M = window.MECH;
    M.loadPreset('empty');
    M.addComponent('ground');
    const sid = M.addComponent('sphere', { transform: { pos: [0, 0.5, 0] }, physics: { mass: 1, friction: 0.3, restitution: 0.1 } });
    M.select(sid);
    // 直走 UI 路径：检查器材质 select
    const msel = document.querySelector('#inspector select[data-role="material"], .grp select');
    return { sid, mselFound: !!msel };
  });
  ok('检查器材质 select 存在', mat.mselFound);

  // 模拟 inspector onchange：改 select 值并触发 change
  const applyMat = (key) => page.evaluate((k) => {
    const msel = [...document.querySelectorAll('#right select')]
      .find((s) => [...s.options].some((o) => o.value === k));
    if (!msel) return null;
    msel.value = k;
    msel.dispatchEvent(new Event('change', { bubbles: true }));
    const e = window.MECH.doc().entities.find((en) => en.id === window.MECH.selectionState().main);
    return { mu: e.physics.friction, e: e.physics.restitution, m: e.physics.mass };
  }, key);
  const r1 = await applyMat('rubber');
  const vol = (4 / 3) * Math.PI * Math.pow(0.15, 3);
  ok('橡胶套用 μ=0.9', r1 && Math.abs(r1.mu - 0.9) < 1e-9, `mu=${r1 && r1.mu}`);
  ok('橡胶套用 e=0.85', r1 && Math.abs(r1.e - 0.85) < 1e-9, `e=${r1 && r1.e}`);
  ok('橡胶 m=ρV 重算(1100·V)', r1 && Math.abs(r1.m - 1100 * vol) < 0.01, `m=${r1 && r1.m} 期望 ${(1100 * vol).toFixed(3)}`);
  const r2 = await applyMat('ice');
  ok('冰套用 μ=0.03（冰面近无摩擦）', r2 && Math.abs(r2.mu - 0.03) < 1e-9, `mu=${r2 && r2.mu}`);
  ok('冰套用 m=917·V', r2 && Math.abs(r2.m - 917 * vol) < 0.01, `m=${r2 && r2.m}`);

  // ==== B. 自由漫游 ====
  await page.evaluate(() => {
    window.MECH.loadPreset('empty');
    window.MECH.perfHud(false);
  });
  await page.waitForTimeout(300);
  await page.click('#btnFly');
  await page.waitForTimeout(200);
  const flyOn = await page.evaluate(() => window.MECH.__vp._fly && window.MECH.__vp._fly.on
    && !window.MECH.__vp.controls.enabled && document.getElementById('btnFly').classList.contains('hot'));
  ok('漫游开启：fly 态+controls 挂起+按钮热态', !!flyOn);

  const p0 = await page.evaluate(() => window.MECH.__vp.camera.position.toArray());
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  const p1 = await page.evaluate(() => window.MECH.__vp.camera.position.toArray());
  const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  ok('W 前进位移 >0.8m', moved > 0.8, `Δ=${moved.toFixed(3)}m`);

  // 拖拽转视角（在画布上横向拖）
  const yaw0 = await page.evaluate(() => window.MECH.__vp._fly.yaw);
  const bb = await page.evaluate(() => {
    const r = window.MECH.__vp.renderer.domElement.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(bb.x, bb.y);
  await page.mouse.down();
  await page.mouse.move(bb.x + 160, bb.y, { steps: 8 });
  await page.mouse.up();
  const yaw1 = await page.evaluate(() => window.MECH.__vp._fly.yaw);
  ok('拖拽转头 yaw 变化', Math.abs(yaw1 - yaw0) > 0.2, `Δyaw=${(yaw1 - yaw0).toFixed(3)}`);

  // E 升降
  const y0 = await page.evaluate(() => window.MECH.__vp.camera.position.y);
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyE');
  const y1 = await page.evaluate(() => window.MECH.__vp.camera.position.y);
  ok('E 上升', y1 - y0 > 0.3, `Δy=${(y1 - y0).toFixed(3)}`);

  // Esc 退出回轨道
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const flyOff = await page.evaluate(() => !window.MECH.__vp._fly.on
    && window.MECH.__vp.controls.enabled && !document.getElementById('btnFly').classList.contains('hot'));
  ok('Esc 退出：回轨道+按钮复平', !!flyOff);

  ok('无 console 错误', errors.length === 0, errors[0] || '');
} finally {
  await browser.close();
}

console.log('\n== 汇总 ==');
for (const [st, name, detail] of results) console.log(`${st}  ${name}${detail ? '  | ' + detail : ''}`);
const pass = results.filter((r) => r[0] === 'PASS').length;
console.log(`\nPASS ${pass}/${results.length}`);
if (pass !== results.length) process.exitCode = 1;
