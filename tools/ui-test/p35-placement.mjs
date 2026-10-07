// p35-placement.mjs — 放置防穿模（用户需求）：按真实碰撞箱阻挡 + ghost 骑面「指哪放哪」。
// 验收：①ghost 瞄贴停 occupied 位=红色警示、移开解除 ②ghost 瞄坡面=骑面贴停放置（球贴坡，
// 指哪放哪）③瞄已有球顶=骑球面叠放（贴面合法物理位） ④授权式放置 trusted 不拦
// ⑤鼠标拖球撞坡趾=实时钳制停在切点、提交不弹回（自由摆放全程有碰撞体积）⑥无 console 错误。
// 用法：MECH_BASE=http://127.0.0.1:8722 node p35-placement.mjs
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

// 斜面几何（parse-schema 口径）：坡顶 -x → 坡趾 +x；n=面法线（上外）、t=沿面下行单位向量
function slopeGeom(rampPos, params) {
  const base = params.length, h = params.height;
  const th = Math.atan2(h, base);
  const nl = Math.hypot(1, h / base);
  return {
    base, h, th,
    n: [(h / base) / nl, 1 / nl, 0],
    t: [Math.cos(th), -Math.sin(th), 0],
    surfY: (wx) => {
      const xl = wx - rampPos[0];
      if (xl < -base / 2 || xl > base / 2) return null;
      return rampPos[1] + h * (1 - (xl + base / 2) / base);
    },
  };
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

  const waitPose = () => page.waitForFunction(() => {
    const vp = window.MECH.__vp;
    return vp._poseAnim == null && vp._focusAnim == null && vp._zoomTarget == null;
  }, null, { timeout: 8000, polling: 200 });
  const hoverBallRow = async () => {
    await page.evaluate(() => {
      [...document.querySelectorAll('.comp-item .nm')].find((n) => n.textContent.trim() === '球')
        ?.closest('.comp-item').dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    });
    await page.waitForFunction(() => window.MECH.ghostState().visible, null, { timeout: 5000 });
  };
  const slope = await page.evaluate(() => {
    const ramp = window.MECH.doc().entities.find((e) => e.type === 'ramp');
    const ball = window.MECH.doc().entities.find((e) => e.type === 'sphere');
    return { rampPos: ramp.transform.pos, params: ramp.params, ballPos: ball.transform.pos, r: ball.params.radius };
  });
  const G = slopeGeom(slope.rampPos, slope.params);
  const ballC = slope.ballPos;

  // ==== A. 警示态随占位开关：瞄「贴着预设球」的坡面点=红（骑面位与球深叠），移到空地=解除 ====
  await page.evaluate(() => window.MECH.loadPreset('incline'));
  await waitPose();
  // 瞄点 = 预设球在坡面上的落点沿面下行 0.15m（骑面位距球心 <0.25 → 与球深叠）
  const contactA = [
    ballC[0] - G.n[0] * (slope.r + 0.02) + G.t[0] * 0.15,
    ballC[1] - G.n[1] * (slope.r + 0.02) + G.t[1] * 0.15,
    0,
  ];
  const redPt = await page.evaluate((p) => window.MECH.__vp.screenPosOf(p[0], p[1], p[2]), contactA);
  await hoverBallRow();
  await page.mouse.move(redPt[0], redPt[1]);
  const ovRamp = await page.waitForFunction(() => window.MECH.ghostState().overlap === true, null, { timeout: 5000, polling: 150 })
    .then(() => true).catch(() => false);
  check('ghost 瞄贴停位（球旁坡面）=红色警示态', ovRamp);
  // 空地点要在屏内（远空地投影可能屏外——鼠标 no-op，警示不解除）
  const emptyPt = await page.evaluate(() => {
    const cands = [[2.6, 0, 1.2], [2.2, 0, -1.4], [0, 0, 2.2], [-2.2, 0, 1.2]];
    for (const [x, y, z] of cands) {
      const [sx, sy] = window.MECH.__vp.screenPosOf(x, y, z);
      if (sx > 60 && sx < 1380 && sy > 90 && sy < 850) return [sx, sy];
    }
    return [720, 800];
  });
  await page.mouse.move(emptyPt[0], emptyPt[1]);
  const ovEmpty = await page.waitForFunction(() => window.MECH.ghostState().overlap === false, null, { timeout: 5000, polling: 150 })
    .then(() => true).catch(() => false);
  check('ghost 移到空地=警示解除', ovEmpty);

  // ==== B. ghost 瞄坡面中部=骑面贴停放置（球贴坡法线，指哪放哪） ====
  const entityN0 = await page.evaluate(() => window.MECH.doc().entities.length);
  const facePt = await page.evaluate(() => {
    const ramp = window.MECH.doc().entities.find((e) => e.type === 'ramp');
    const wx = ramp.transform.pos[0] - ramp.params.length * 0.15;
    const surf = ramp.transform.pos[1] + ramp.params.height * (1 - ((wx - ramp.transform.pos[0]) + ramp.params.length / 2) / ramp.params.length);
    return window.MECH.__vp.screenPosOf(wx, surf, 0);
  });
  await page.mouse.move(facePt[0], facePt[1]);
  await page.waitForTimeout(350);
  const rideG = await page.evaluate(() => window.MECH.ghostState());
  check('ghost 瞄坡面=骑面绿放置态', rideG.visible && rideG.overlap === false, JSON.stringify(rideG.pos));
  await page.mouse.click(facePt[0], facePt[1]);
  await page.waitForTimeout(500);
  const placed = await page.evaluate((n0) => {
    const d = window.MECH.doc();
    const e = d.entities[d.entities.length - 1];
    return { n0, n1: d.entities.length, pos: e ? e.transform.pos : null };
  }, entityN0);
  // 贴停断言：球心相对坡面的竖直间隙 ≈ r/cosθ（沿法线贴停的解析值），且不陷入面下
  const tangent = placed.pos ? await page.evaluate(({ pos, r }) => {
    const ramp = window.MECH.doc().entities.find((e) => e.type === 'ramp');
    const base = ramp.params.length, h = ramp.params.height;
    const th = Math.atan2(h, base);
    const surf = ramp.transform.pos[1] + h * (1 - ((pos[0] - ramp.transform.pos[0]) + base / 2) / base);
    return { surf: +surf.toFixed(3), gap: +(pos[1] - surf).toFixed(3), expect: +(r / Math.cos(th)).toFixed(3) };
  }, { pos: placed.pos, r: slope.r }) : null;
  check('坡面点击放置成功（实体 +1，落在骑面位）',
    placed.n1 === placed.n0 + 1 && placed.pos !== null,
    `n ${placed.n0}→${placed.n1} pos=[${placed.pos}]`);
  check('球贴坡面（竖直间隙 ≈ r/cosθ，不陷入）',
    !!tangent && Math.abs(tangent.gap - tangent.expect) < 0.025 && tangent.gap > 0,
    JSON.stringify(tangent));

  // ==== B2. 授权式放置（显式 transform，解析/预设/测试同款）trusted 不拦 ====
  const shallow = await page.evaluate(() => {
    const id = window.MECH.addComponent('box', { transform: { pos: [2.5, 0.11, 1.2] } });   // sy=0.3 底面嵌地 4cm
    const e = id != null ? window.MECH.doc().entities.find((x) => x.id === id) : null;
    return e ? { placed: true, pos: e.transform.pos } : { placed: false };
  });
  check('授权式放置 trusted 不拦（贴地出生等合法摆位语义保持）', shallow.placed === true, JSON.stringify(shallow));

  // ==== C. 瞄已有球=骑球面叠放（贴面合法物理位，摞球） ====
  await page.evaluate(() => window.MECH.loadPreset('incline'));
  await waitPose();
  const ballPt = await page.evaluate(() => {
    const e = window.MECH.doc().entities.find((x) => x.type === 'sphere');
    return window.MECH.__vp.screenPosOf(e.transform.pos[0], e.transform.pos[1], e.transform.pos[2]);
  });
  await hoverBallRow();
  await page.mouse.move(ballPt[0], ballPt[1]);
  await page.waitForTimeout(350);
  const stackG = await page.evaluate(() => window.MECH.ghostState());
  check('ghost 瞄球体=骑球面绿放置态', stackG.visible && stackG.overlap === false, JSON.stringify(stackG.pos));
  const nBefore = await page.evaluate(() => window.MECH.doc().entities.length);
  await page.mouse.click(ballPt[0], ballPt[1]);
  await page.waitForTimeout(500);
  const stack = await page.evaluate((n0) => {
    const d = window.MECH.doc();
    const balls = d.entities.filter((x) => x.type === 'sphere');
    const last = balls[balls.length - 1], first = balls[0];
    return { added: d.entities.length - n0, d: (last && first && last !== first)
      ? +Math.hypot(last.transform.pos[0] - first.transform.pos[0], last.transform.pos[1] - first.transform.pos[1], last.transform.pos[2] - first.transform.pos[2]).toFixed(3)
      : null };
  }, nBefore);
  check('叠放成功（球心距 ≈ 2r=0.30，贴面相切）',
    stack.added === 1 && stack.d !== null && Math.abs(stack.d - 0.3) < 0.045,
    JSON.stringify(stack));

  // ==== D. API 通路（显式 transform）trusted 不拦 ====
  await page.evaluate(() => { window.MECH.loadPreset('incline'); });
  await waitPose();
  const forced = await page.evaluate(() => {
    const sphere = window.MECH.doc().entities.find((e) => e.type === 'sphere');
    const id = window.MECH.addComponent('box', { transform: { pos: [...sphere.transform.pos] } });
    return id != null ? { trusted: true } : { trusted: false };
  });
  check('API 通路（显式 transform）trusted 不拦', forced.trusted === true, JSON.stringify(forced));

  // ==== F. 挪动防穿模：鼠标拖球撞坡趾=实时钳制停在切点（自由摆放全程有碰撞体积） ====
  await page.evaluate(() => window.MECH.loadPreset('incline'));
  await waitPose();
  const probe = await page.evaluate(() => {
    const ball = window.MECH.doc().entities.find((e) => e.type === 'sphere');
    window.MECH.select(ball.id);
    return { id: ball.id, belly: window.MECH.poseBlocked(ball.id, [0, 0.4, 0]), air: window.MECH.poseBlocked(ball.id, [-0.3, 2.5, 0]) };
  });
  check('F 挪动探针：坡腹体内挡/高空自由', probe.belly > 0 && probe.air === 0, JSON.stringify(probe));   // 值=嵌入方向数
  // E2E：坡趾右缘放球 → 鼠标沿 X 轴往坡体拖 → 实时钳制停在切点 → 释放提交成功（不弹回）
  const toePt = await page.evaluate(() => window.MECH.__vp.screenPosOf(1.35, 0, 0));
  await hoverBallRow();
  await page.mouse.move(toePt[0], toePt[1]);
  await page.waitForTimeout(250);
  await page.mouse.click(toePt[0], toePt[1]);
  await page.waitForTimeout(400);
  const toeBall = await page.evaluate(() => {
    const balls = window.MECH.doc().entities.filter((e) => e.type === 'sphere');
    const last = balls[balls.length - 1];
    window.MECH.select(last.id);
    return last ? { id: last.id, pos: last.transform.pos.map((v) => +v.toFixed(2)) } : null;
  });
  check('F-E2E ghost 坡趾右缘放球（骑地面实体，指哪放哪）', toeBall && Math.abs(toeBall.pos[0] - 1.35) < 0.1, JSON.stringify(toeBall));
  // X 轴拖拽：箭头端点 = 球心屏幕位 + 0.9×(世界 +0.4m 的屏幕偏移)
  const cx0 = await page.evaluate((p) => window.MECH.__vp.screenPosOf(p[0], p[1], p[2]), toeBall.pos);
  const cx1 = await page.evaluate((p) => window.MECH.__vp.screenPosOf(p[0] + 0.4, p[1], p[2]), toeBall.pos);
  const ax = [cx0[0] + (cx1[0] - cx0[0]) * 0.9, cx0[1] + (cx1[1] - cx0[1]) * 0.9];
  const tx = await page.evaluate((p) => window.MECH.__vp.screenPosOf(0, p[1], p[2]), toeBall.pos);
  await page.mouse.move(ax[0], ax[1]);
  await page.mouse.down();
  await page.mouse.move(tx[0], tx[1], { steps: 14 });
  const midDrag = await page.evaluate((id) => {
    const bind = window.MECH.__vp._bindLookup(id);
    return bind ? bind.mesh.position.toArray().map((v) => +v.toFixed(2)) : null;
  }, toeBall.id);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate((id) => {
    const e = window.MECH.doc().entities.find((x) => x.id === id);
    return { pos: e.transform.pos.map((v) => +v.toFixed(2)), depth: +window.MECH.poseDepth(e.id, e.transform.pos).toFixed(3) };
  }, toeBall.id);
  check('F-E2E 拖拽实时钳制：拖中/终位停在切点（x∈[0.85,1.05]，不深入坡体）',
    !!midDrag && midDrag[0] >= 0.85 && midDrag[0] <= 1.05 && after.pos[0] >= 0.85 && after.pos[0] <= 1.05,
    `mid=[${midDrag}] final=[${after.pos}]`);
  check('F-E2E 提交成功不弹回（钳制位=提交位，深度 ≤ 12mm）', after.depth <= 0.012 && Math.abs(after.pos[0] - midDrag[0]) < 0.02,
    JSON.stringify(after));

  // ==== E. 无 console 错误 ====
  check('全程无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await page.close();
  await context.close();
} finally {
  await browser.close();
}

console.log('\n== 汇总 ==');
const nFail = results.filter((r) => !r.ok).length;
console.log(`PASS ${results.length - nFail}/${results.length}`);
process.exit(nFail === 0 && consoleErrors.length === 0 ? 0 : 1);
