// p24.mjs — Round 27 验收：ghost 吸附细化（档位联动+琥珀标记）+ 滚阻模型细化（法向力/转动惯量耦合）
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

  // ==== A. ghost 吸附联动：surface 档贴合实体顶面 + 标记显示 ====
  await page.evaluate(() => {
    window.MECH.loadPreset('empty');
    window.MECH.addComponent('box', { name: '台座', transform: { pos: [1.0, 0.4, 0] },
      params: { sx: 0.8, sy: 0.8, sz: 0.8 }, physics: { body: 'fixed' } });
  });
  await page.waitForTimeout(300);
  await page.click('#btnSnap');
  await page.click('#btnSnap');   // 初始 grid→endpoint→surface
  const snapLabel = await page.textContent('#btnSnap');
  check('吸附循环到 surface', snapLabel.includes('表面'), snapLabel);
  await page.hover('.comp-item', { hasText: '球' }).catch(() => {});
  const firstItem = page.locator('.comp-item').first();
  await firstItem.hover();
  await page.waitForTimeout(200);
  // 把鼠标移到台座上方（世界 [1, ?, 0] 附近的屏幕位置：用中心偏右区域扫两处）
  await page.mouse.move(700, 300);
  await page.waitForTimeout(250);
  // 投影精确命中：台座顶面中心世界坐标 → 屏幕像素
  const aim = await page.evaluate(() => {
    const box = window.MECH.doc().entities.find((e) => e.name === '台座');
    const vp = window.MECH.__vp;
    const world = new (vp.camera.position.constructor.prototype.setFromMatrixPosition ? Object : Object)();
    void world;
    // 手动投影：用 viewport 相机把 [1, 0.8, 0] 投到屏幕
    // 瞄准台座前方地面点（x/z 落在台座 bbox 投影内 → surface/center 吸附触发；
    // 直接瞄顶面 y=0.8 的屏幕点会使射线近地平线打飞）
    const pt = { x: 1.0, y: 0, z: 0.3 };
    const cam = vp.camera;
    const v = new (cam.position.constructor)(pt.x, pt.y, pt.z).project(cam);
    const r = vp.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  });
  let surfaceHit = null;
  await page.mouse.move(aim.x, aim.y);
  await page.waitForTimeout(250);
  const gsAim = await page.evaluate(() => window.MECH.ghostState());
  if (gsAim.snapped && gsAim.marker) surfaceHit = gsAim;
  check('surface 档: ghost 吸附到台座顶面+标记显示', !!surfaceHit,
    JSON.stringify(surfaceHit || '未命中（扫点未覆盖）'));
  if (surfaceHit) {
    check('吸附位贴合顶面(y≈0.8+球半径)', Math.abs(surfaceHit.pos[1] - (0.8 + 0.12 + 0.01)) < 0.06,
      `y=${surfaceHit.pos[1]}`);
  }
  await page.screenshot({ path: 'shots/240-ghost-snap.png' });

  // 移到空地：吸附解除、标记隐藏
  await page.mouse.move(500, 550);
  await page.waitForTimeout(200);
  const gsOff = await page.evaluate(() => window.MECH.ghostState());
  check('离开实体: 吸附解除+标记隐藏', gsOff.snapped === false && gsOff.marker === false,
    JSON.stringify(gsOff));

  // center 档：x/z 吸到台座中心（同一投影点）
  await page.click('#btnSnap');   // surface→center
  await page.mouse.move(aim.x, aim.y);
  await page.waitForTimeout(250);
  const gsC = await page.evaluate(() => window.MECH.ghostState());
  check('center 档: x 吸到台座中心(x≈1.0)', gsC.snapped && Math.abs(gsC.pos[0] - 1.0) < 0.05,
    JSON.stringify(gsC));

  // ==== B. 滚阻模型：解析对照 a=μr·g/I_factor（实心球 2.5μr·g）+ 无滚阻对照 ====
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const M = window.MECH;
    // 地面摩擦 0：隔离 Rapier Average 摩擦组合（球0×地0.6→有效0.3 的滚动耦合衰减）
    M.addComponent('ground', { name: '地面', physics: { body: 'fixed', friction: 0, restitution: 0 } });
    // 两球贴地出生（y=半径，无弹跳）、friction=0 隔离 rollResist 单变量
    M.addComponent('sphere', { name: '滚阻球', transform: { pos: [-1.5, 0.15, 0] },
      params: { radius: 0.15, rollResist: 0.03 },
      physics: { mass: 1, friction: 0, restitution: 0, linvel: [2, 0, 0], linDamping: 0, angDamping: 0 } });
    M.addComponent('sphere', { name: '无滚阻球', transform: { pos: [-1.5, 0.15, 0.8] },
      params: { radius: 0.15 },
      physics: { mass: 1, friction: 0, restitution: 0, linvel: [2, 0, 0], linDamping: 0, angDamping: 0 } });
  });
  // 数值断言用 MECH.step 手动精确步进（确定性；真实时帧循环在 headless 掉帧时
  // 背压丢步，simT 与物理步数不一致，不能用 ΔsimT 断言）
  await page.waitForTimeout(300);
  const rollNum = await page.evaluate(() => {
    const vid = (name) => window.MECH.doc().entities.find((e) => e.name === name).id;
    for (let i = 0; i < 120; i++) window.MECH.step();    // 1s：触地瞬态彻底过去
    const vx = (name) => window.MECH.telemetry(vid(name)).vel[0];   // 纯 x 分量（运动沿 x）
    const rr0 = vx('滚阻球');
    const fr0 = vx('无滚阻球');
    for (let i = 0; i < 120; i++) window.MECH.step();    // 精确 1.0s 模拟
    const rr1 = vx('滚阻球');
    const fr1 = vx('无滚阻球');
    return { dvRR: rr0 - rr1, dvFR: fr0 - fr1 };
  });
  // 解析：实心球 I=0.4mr² → a = μr·g/0.4 = 2.5·μr·g（μr=0.03 → 0.736 m/s²）
  const dvTheo = 2.5 * 0.03 * 9.81 * 1.0;
  check('滚阻 Δv 命中解析(±2%)', Math.abs(rollNum.dvRR - dvTheo) / dvTheo < 0.02,
    `Δv=${rollNum.dvRR.toFixed(4)} 理论=${dvTheo.toFixed(4)}`);
  check('无滚阻球零衰减(|Δv|<1e-3 数值噪声级)', Math.abs(rollNum.dvFR) < 1e-3, `Δv=${rollNum.dvFR.toExponential(2)}`);
  // UI 层回归：真实时帧播放 1.2s 不炸且滚阻球更慢
  await page.click('#btnPlay');
  await page.waitForTimeout(1200);
  await page.click('#btnPause');
  const uiTel = await page.evaluate(() => {
    const balls = window.MECH.doc().entities.filter((e) => e.type === 'sphere');
    return Object.fromEntries(balls.map((b) => [b.name, window.MECH.telemetry(b.id).speed]));
  });
  check('UI 播放: 滚阻球慢于无滚阻球', uiTel['滚阻球'] < uiTel['无滚阻球'],
    `v滚阻=${uiTel['滚阻球'].toFixed(2)} v无=${uiTel['无滚阻球'].toFixed(2)}`);
  await page.screenshot({ path: 'shots/241-rollresist.png' });

  // ==== C. 斜面耦合回归：N=mg·cosθ（滚阻在斜面仍减位移，p12 语义保持） ====
  await page.selectOption('#selPreset', 'incline');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const M = window.MECH;
    M.addComponent('sphere', { name: '滚阻对照球', transform: { pos: [-0.45, 0.86, 0.6] },
      params: { radius: 0.15, rollResist: 0.08 },
      physics: { mass: 1, friction: 0.3, restitution: 0.1, linvel: [0, 0, 0] } });
  });
  await page.waitForTimeout(250);
  await page.click('#btnPlay');
  await page.waitForTimeout(2200);
  await page.click('#btnPause');
  const cmp = await page.evaluate(() => {
    const balls = window.MECH.doc().entities.filter((e) => e.type === 'sphere');
    return balls.map((b) => ({ name: b.name, x: window.MECH.telemetry(b.id).pos[0] }));
  });
  const rrBall = cmp.find((c) => c.name.includes('滚阻'));
  const normalBall = cmp.find((c) => c.name !== rrBall?.name);
  check('斜面: 滚阻球位移更短(N 耦合语义保持)', rrBall && normalBall && rrBall.x < normalBall.x,
    JSON.stringify(cmp.map((c) => +c.x.toFixed(2))));

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
