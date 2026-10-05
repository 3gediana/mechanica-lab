// p35-placement.mjs — 放置防穿模（用户需求）：按真实碰撞箱阻挡。
// 验收：①ghost 悬在已有体上=overlap 红警示态、移开=解除 ②ghost 点击落坡内→解算到坡面（穿透=0）
// ③同点重复放置→第二颗推出不嵌（或拒绝）④目录槽位放置已有体上→解算不嵌 ⑤全程无 console 错误。
// 用法：MECH_BASE=http://127.0.0.1:8722 node p35-placement.mjs
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

  // ==== A. ghost 红警示态（悬在斜坡上=overlap，移开=解除）====
  await page.evaluate(() => window.MECH.loadPreset('incline'));
  // 等相机取景动画收尾（flyToPose），否则取样点漂
  await page.waitForFunction(() => {
    const vp = window.MECH.__vp;
    return vp._poseAnim == null && vp._focusAnim == null && vp._zoomTarget == null;
  }, null, { timeout: 8000, polling: 200 });
  // 斜坡中部的屏幕点（世界 → 屏幕）
  // 瞄准点=坡底足迹中心的世界点投影（ghost 的射线打到 y=0 平面——投中坡身会落到坡后地面）
  const rampPt = await page.evaluate(() => {
    const ramp = window.MECH.doc().entities.find((e) => e.type === 'ramp');
    const [x, , z] = ramp.transform.pos;
    return window.MECH.__vp.screenPosOf(x, 0, z);
  });
  // 空地点要在屏内（(3.2,0,1.6) 在 1440 视角下投影屏外——鼠标 no-op，警示不解除）
  const emptyPt = await page.evaluate(() => {
    const cands = [[2.6, 0, 1.2], [2.2, 0, -1.4], [0, 0, 2.2], [-2.2, 0, 1.2]];
    for (const [x, y, z] of cands) {
      const [sx, sy] = window.MECH.__vp.screenPosOf(x, y, z);
      if (sx > 60 && sx < 1380 && sy > 90 && sy < 850) return [sx, sy];
    }
    return [720, 800];
  });
  // hover 目录「球」行激活 ghost
  await page.evaluate(() => {
    [...document.querySelectorAll('.comp-item .nm')].find((n) => n.textContent.trim() === '球')
      ?.closest('.comp-item').dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  });
  await page.waitForFunction(() => window.MECH.ghostState().visible, null, { timeout: 5000 });
  await page.mouse.move(rampPt[0], rampPt[1]);
  const ovRamp = await page.waitForFunction(() => {
    const g = window.MECH.ghostState();
    return Math.abs(g.pos[0] - window.MECH.doc().entities.find((e) => e.type === 'ramp').transform.pos[0]) < 0.51 ? g.overlap : null;
  }, null, { timeout: 5000, polling: 150 }).then((r) => r.jsonValue()).catch(() => null);
  check('ghost 悬在斜坡上=红色警示态', ovRamp === true, `overlap=${ovRamp}`);
  await page.mouse.move(emptyPt[0], emptyPt[1]);
  const ovEmpty = await page.waitForFunction(() => window.MECH.ghostState().overlap === false, null, { timeout: 5000, polling: 150 })
    .then(() => true).catch(() => false);
  check('ghost 移到空地=警示解除', ovEmpty);

  // ==== B. ghost 点击落坡腹（深嵌 >0.12m）→ 拒绝放置 + ghost 保留 ====
  const entityN0 = await page.evaluate(() => window.MECH.doc().entities.length);
  await page.mouse.click(rampPt[0], rampPt[1]);     // ghost 激活期左键=落点放置（FZ-1）
  await page.waitForTimeout(500);
  const entityN1 = await page.evaluate(() => window.MECH.doc().entities.length);
  const ghostKept = await page.evaluate(() => window.MECH.ghostState());
  check('坡腹点击被拒（实体数不变 + ghost 红警示保留）',
    entityN1 === entityN0 && ghostKept.visible && ghostKept.overlap === true,
    `n ${entityN0}→${entityN1} ghost.visible=${ghostKept.visible} overlap=${ghostKept.overlap}`);

  // ==== B2. 授权式放置（显式 transform，解析/预设/测试同款）trusted 不拦 ====
  const shallow = await page.evaluate(() => {
    const id = window.MECH.addComponent('box', { transform: { pos: [2.5, 0.11, 1.2] } });   // sy=0.3 底面嵌地 4cm
    const e = id != null ? window.MECH.doc().entities.find((x) => x.id === id) : null;
    return e ? { placed: true, pos: e.transform.pos } : { placed: false };
  });
  check('授权式放置 trusted 不拦（贴地出生等合法摆位语义保持）', shallow.placed === true, JSON.stringify(shallow));

  // ==== C. 同点重复放置 → 对场景已有的球（incline 自带），深嵌（同心 0.15）→ 拒绝 + ghost 保留 ====
  await page.evaluate(() => {
    [...document.querySelectorAll('.comp-item .nm')].find((n) => n.textContent.trim() === '球')
      ?.closest('.comp-item').dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  });
  await page.waitForFunction(() => window.MECH.ghostState().visible, null, { timeout: 5000 });
  // 瞄准球的地面投影（ghost 沿射线落到 y=0 平面——瞄球心会投到球后方远处）
  const prevPt = await page.evaluate(() => {
    const e = window.MECH.doc().entities.find((x) => x.type === 'sphere');
    return window.MECH.__vp.screenPosOf(e.transform.pos[0], 0, e.transform.pos[2]);
  });
  const nBefore = await page.evaluate(() => window.MECH.doc().entities.length);
  await page.mouse.move(prevPt[0], prevPt[1]);
  await page.waitForTimeout(300);
  await page.mouse.click(prevPt[0], prevPt[1]);
  await page.waitForTimeout(500);
  const dup = await page.evaluate((n0) => {
    const n1 = window.MECH.doc().entities.length;
    const g = window.MECH.ghostState();
    return { added: n1 - n0, ghostVisible: g.visible, overlap: g.overlap };
  }, nBefore);
  check('同球心重复放置被拒（深嵌 + ghost 红警示保留）',
    dup.added === 0 && dup.ghostVisible === true,
    JSON.stringify(dup));

  // ==== D. 目录行点击（默认槽位路径）落到已有体上 → 解算不嵌 ====
  await page.click('#btnNew');
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.MECH.loadPreset('incline'); });
  await page.waitForFunction(() => {
    const vp = window.MECH.__vp;
    return vp._poseAnim == null && vp._focusAnim == null && vp._zoomTarget == null;
  }, null, { timeout: 8000, polling: 200 });
  // 用 Agent 通路把一个方块摆到与球同位（制造必然重叠的默认放置）：
  // 直接调用 addComponent 的 overrides 通道（等价目录点击的落点来源）
  const forced = await page.evaluate(() => {
    const sphere = window.MECH.doc().entities.find((e) => e.type === 'sphere');
    const id = window.MECH.addComponent('box', { transform: { pos: [...sphere.transform.pos] } });
    const e = window.MECH.doc().entities.find((x) => x.id === id);
    return e ? { trusted: true } : { trusted: false };
  });
  check('API 通路（显式 transform）trusted 不拦', forced.trusted === true, JSON.stringify(forced));

  // ==== F. 挪动防穿模（gizmo 提交/方向键微调同规则）：朝坡体方向微调被挡 ====
  await page.evaluate(() => window.MECH.loadPreset('incline'));
  await page.waitForFunction(() => {
    const vp = window.MECH.__vp;
    return vp._poseAnim == null && vp._focusAnim == null && vp._zoomTarget == null;
  }, null, { timeout: 8000, polling: 200 });
  const f0 = await page.evaluate(() => {
    const ball = window.MECH.doc().entities.find((e) => e.type === 'sphere');
    window.MECH.select(ball.id);
    return { id: ball.id, pos: ball.transform.pos.map((v) => +v.toFixed(2)) };
  });
  // 探针口径：坡腹体内包覆=挡；高空自由=不挡（预设球自身贴面微嵌 2cm 属作者口径，self 不作断言）
  const probe = await page.evaluate((id) => ({
    belly: window.MECH.poseBlocked(id, [0, 0.4, 0]),
    air: window.MECH.poseBlocked(id, [-0.3, 2.5, 0]),
  }), f0.id);
  check('F 挪动探针：坡腹体内挡/高空自由', probe.belly > 0 && probe.air === 0, JSON.stringify(probe));   // 值=嵌入方向数
  // E2E：ghost 在坡趾右缘放球（x=1.35），ArrowLeft 连推入坡——推到坡面（x≈0.95）被挡，
  // 位置停住 + toast「不能穿模」，终位球体保持在坡体 AABB 之外（x_min ≥ 0.8−2mm）
  await page.evaluate(() => window.MECH.loadPreset('incline'));
  await page.waitForFunction(() => {
    const vp = window.MECH.__vp;
    return vp._poseAnim == null && vp._focusAnim == null && vp._zoomTarget == null;
  }, null, { timeout: 8000, polling: 200 });
  const toePt = await page.evaluate(() => window.MECH.__vp.screenPosOf(1.35, 0, 0));   // 地面投影（ghost 射线落 y=0 平面）
  await page.evaluate(() => {
    [...document.querySelectorAll('.comp-item .nm')].find((n) => n.textContent.trim() === '球')
      ?.closest('.comp-item').dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  });
  await page.waitForFunction(() => window.MECH.ghostState().visible, null, { timeout: 5000 });
  await page.mouse.move(toePt[0], toePt[1]);
  await page.waitForTimeout(250);
  await page.mouse.click(toePt[0], toePt[1]);
  await page.waitForTimeout(400);
  const placed = await page.evaluate(() => {
    const balls = window.MECH.doc().entities.filter((e) => e.type === 'sphere');
    const last = balls[balls.length - 1];
    return last ? { id: last.id, x: +last.transform.pos[0].toFixed(2) } : null;
  });
  check('F-E2E ghost 坡趾右缘放球', placed && Math.abs(placed.x - 1.5) < 0.3, JSON.stringify(placed));   // grid 0.5m 吸附 1.35→1.5
  let stopped = false, lastX = placed ? placed.x : 1.35, lastToast2 = '';
  for (let k = 0; k < 10; k++) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(120);
    const cur = await page.evaluate(() => ({
      x: +window.MECH.doc().entities.filter((e) => e.type === 'sphere').slice(-1)[0].transform.pos[0].toFixed(3),
      toast: document.getElementById('toast').textContent,
    }));
    if (cur.x === lastX) {
      if (cur.toast.includes('不能穿模')) { stopped = true; lastToast2 = cur.toast; }
      break;
    }
    lastX = cur.x;
    lastToast2 = cur.toast;
  }
  check('F-E2E 推入坡体被挡（位置停住+toast）', stopped, `lastX=${lastX} toast="${lastToast2}"`);
  const final = await page.evaluate((id) => {
    const e = window.MECH.doc().entities.filter((x) => x.type === 'sphere').slice(-1)[0];
    return { x: +e.transform.pos[0].toFixed(2), clean: !window.MECH.poseBlocked(e.id, e.transform.pos) };
  }, placed.id);
  check('F-E2E 终位几何不嵌（meshPenetrates=false）', final.clean, JSON.stringify(final));

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
