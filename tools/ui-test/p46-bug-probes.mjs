// p46-bug-probes.mjs — 用户实锤四 bug 回归探针：
// 1) 弹簧端点对齐（B1：螺旋几何居中后，端点=attach 实体中心，偏差 <1cm）
// 2) 静息钳制（B2：地面静球 3s 后速率 <0.01，不再 0.06 微漂）
// 3) 里程读数（B3：滑行累计>0.2m 且单调不减；停球不涨）
// 4) momentum2d 碰撞间距测量（B4 定性：接触时刻中心距应≈0.30=半径和）
// 用法：MECH_BASE=http://127.0.0.1:8722 node p46-bug-probes.mjs
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

  // ---- 1. 弹簧端点对齐（springSHM：墙—弹簧—球） ----
  await page.evaluate(() => { window.MECH.perfHud(false); window.MECH.loadPreset('springSHM'); });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.MECH.play());
  await page.waitForTimeout(800);
  const spring = await page.evaluate(() => {
    const M = window.MECH, vp = M.__vp;
    const spDoc = M.doc().entities.find((e) => e.type === 'spring');
    if (!spDoc) return null;
    const mesh = vp._bindLookup(spDoc.id).mesh;
    const a = vp._bindLookup(spDoc.attach[0]).mesh.position;
    const c = vp._bindLookup(spDoc.attach[1]).mesh.position;
    const dir = new (mesh.position.constructor)(0, 0.5 * mesh.scale.y, 0).applyQuaternion(mesh.quaternion);
    const p1 = mesh.position.clone().add(dir);
    const p2 = mesh.position.clone().sub(dir);
    // 端点-中心配对误差：两种指派取小（p1↔a&p2↔c 或 p1↔c&p2↔a），各取两端最大偏差
    const err = Math.min(
      Math.max(p1.distanceTo(a), p2.distanceTo(c)),
      Math.max(p1.distanceTo(c), p2.distanceTo(a)));
    return { err: +err.toFixed(4), len: +mesh.scale.y.toFixed(3) };
  });
  ok('弹簧 mesh 存在', !!spring, JSON.stringify(spring || {}));
  if (spring) ok('弹簧端点贴合实体中心（<1cm）', spring.err < 0.01, `err=${spring.err}m len=${spring.len}`);

  // ---- 2. 静息钳制（地面静球） ----
  await page.evaluate(() => {
    const M = window.MECH;
    M.loadPreset('empty');
    M.addComponent('ground');
    M.addComponent('sphere', { transform: { pos: [0, 0.15, 0] }, physics: { mass: 1, friction: 0.5, restitution: 0.1 } });
    M.play();
  });
  await page.waitForTimeout(3200);
  const rest = await page.evaluate(() => {
    const M = window.MECH;
    const ball = M.doc().entities.filter((e) => e.type === 'sphere').pop();
    const t = M.telemetry(ball.id);
    return { sp: +t.speed.toFixed(4), dist: +t.dist.toFixed(4), h: +t.height.toFixed(3) };
  });
  ok('静球 3.2s 后速率 <0.01（钳制生效）', rest.sp < 0.01, `v=${rest.sp} h=${rest.h}`);
  // 出生下落 4cm+触地是真实路程（计入里程是正确语义）；判稳看后段不涨
  await page.waitForTimeout(600);
  const rest2 = await page.evaluate(() => {
    const M = window.MECH;
    const ball = M.doc().entities.filter((e) => e.type === 'sphere').pop();
    const t = M.telemetry(ball.id);
    return { sp: +t.speed.toFixed(4), dist: +t.dist.toFixed(4) };
  });
  ok('静球后段里程不涨（|Δ|<5mm）', Math.abs(rest2.dist - rest.dist) < 0.005, `dist ${rest.dist} → ${rest2.dist}`);

  // ---- 3. 里程：滑行球累计+停后不涨 ----
  await page.evaluate(() => {
    const M = window.MECH;
    M.resetSim();
    M.addComponent('sphere', { transform: { pos: [-1.2, 0.15, 0] }, physics: { mass: 1, friction: 0.2, restitution: 0.05, linvel: [1.4, 0, 0] } });
    M.play();
  });
  await page.waitForTimeout(1100);
  const s1 = await page.evaluate(() => {
    const M = window.MECH;
    const ball = M.doc().entities.filter((e) => e.type === 'sphere' && !e.physics.body || (e.physics && e.physics.linvel && (e.physics.linvel[0] === 1.4))).pop()
      || M.doc().entities.filter((e) => e.type === 'sphere').pop();
    const t = M.telemetry(ball.id);
    return { dist: +t.dist.toFixed(4), speed: +t.speed.toFixed(3) };
  });
  await page.waitForTimeout(2600);
  const s2 = await page.evaluate(() => {
    const M = window.MECH;
    const ball = M.doc().entities.filter((e) => e.type === 'sphere').pop();
    const t = M.telemetry(ball.id);
    return { dist: +t.dist.toFixed(4), speed: +t.speed.toFixed(3) };
  });
  ok('滑行球里程累计 >0.2m', s1.dist > 0.2, `dist=${s1.dist} v=${s1.speed}`);
  ok('里程单调不减且停球后不涨（|Δ|<1cm）', s2.dist >= s1.dist - 1e-6 && (s2.speed > 0.05 || Math.abs(s2.dist - s1.dist) < 0.01),
    `dist ${s1.dist} → ${s2.dist} v=${s2.speed}`);

  // ---- 4. momentum2d 碰撞间距（B4 定性） ----
  await page.evaluate(() => { window.MECH.loadPreset('momentum2d'); });
  await page.waitForTimeout(500);
  const bounce = await page.evaluate(() => {
    const M = window.MECH;
    const A = M.doc().entities.find((e) => e.name && e.name.includes('球 A'));
    const B = M.doc().entities.find((e) => e.name && e.name.includes('球 B'));
    const ba = M.__vp._bindLookup(A.id), bb = M.__vp._bindLookup(B.id);
    let minD = 1e9, vA = null, vB = null;
    for (let i = 0; i < 360; i++) {   // 3s @1/120
      M.stepOnce();
      const pa = ba.mesh.position, pb = bb.mesh.position;
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
      if (d < minD) {
        minD = d;
        const va = ba.body.linvel(), vb = bb.body.linvel();
        vA = va.x; vB = vb.x;
      }
    }
    return { minD: +minD.toFixed(4), vA: +vA.toFixed(2), vB: +vB.toFixed(2) };
  });
  ok('momentum2d 接触间距≈半径和(0.30±0.02)', bounce.minD > 0.28 && bounce.minD < 0.32,
    `minD=${bounce.minD} 碰时 vA=${bounce.vA} vB=${bounce.vB}`);

  ok('无 console 错误', errors.length === 0, errors[0] || '');
} finally {
  await browser.close();
}

console.log('\n== 汇总 ==');
for (const [st, name, detail] of results) console.log(`${st}  ${name}${detail ? '  | ' + detail : ''}`);
const pass = results.filter((r) => r[0] === 'PASS').length;
console.log(`\nPASS ${pass}/${results.length}`);
if (pass !== results.length) process.exitCode = 1;
