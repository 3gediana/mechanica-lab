// p28.mjs — Round 31 验收：力传感器（isSensor 绑定 + 接触合力读数 + 阻尼修正失重）
// 纪律：单浏览器 / 单 context / 单标签；总时长上限约 3 分钟。
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

  // ==== A. 放置语义（isSensor 第三种放置模式的拒绝路径） ====
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.waitForTimeout(250);
  const rej1 = await page.evaluate(() => {
    window.MECH.deselect && window.MECH.deselect();
    return window.MECH.addComponent('forceSensor', {});
  });
  check('无选中拒绝放置', rej1 === null);
  // 斜面预置：斜坡是 fixed，选它应被拒
  await page.evaluate(() => window.MECH.loadPreset('incline'));
  await page.waitForTimeout(250);
  const rej2 = await page.evaluate(() => {
    const ramp = window.MECH.doc().entities.find((e) => e.type === 'ramp');
    window.MECH.select(ramp.id);
    return window.MECH.addComponent('forceSensor', {});
  });
  check('固定体拒绝绑定', rej2 === null);

  // ==== B. 动态体绑定成功 ====
  const fid = await page.evaluate(() => {
    const ball = window.MECH.doc().entities.find((e) => e.type === 'sphere');
    window.MECH.select(ball.id);
    return window.MECH.addComponent('forceSensor', {});
  });
  await page.waitForTimeout(250);
  const bound = await page.evaluate((fid) => {
    const e = window.MECH.doc().entities.find((x) => x.id === fid);
    const ball = window.MECH.doc().entities.find((x) => x.type === 'sphere');
    return e && e.attach && e.attach[0] === ball.id && e.name.includes('力传感器');
  }, fid);
  check('绑定动态球(attach+命名)', bound === true, `fid=${fid}`);
  await page.screenshot({ path: 'shots/280-force-place.png' });

  // ==== C. 静止称重：地面 1kg 球静止 → |F| ≈ mg = 9.81 N ====
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.waitForTimeout(250);
  const wIds = await page.evaluate(() => {
    const gid = window.MECH.addComponent('ground', { name: '称重台', transform: { pos: [0, -0.05, 0] }, params: { sx: 4, sy: 0.1, sz: 4 } });
    const sid = window.MECH.addComponent('sphere', { name: '砝码球', transform: { pos: [0, 0.2, 0] }, params: { radius: 0.15 }, physics: { mass: 1, friction: 0.4, restitution: 0, linvel: [0, 0, 0] } });
    window.MECH.select(sid);
    const fid2 = window.MECH.addComponent('forceSensor', {});
    return { gid, sid, fid: fid2 };
  });
  await page.waitForTimeout(250);
  await page.click('#btnPlay');
  await page.waitForTimeout(1800);
  await page.click('#btnPause');
  await page.waitForTimeout(200);
  const weigh = await page.evaluate((ids) => window.MECH.sensorState(ids.fid), wIds);
  check('静止称重读数存在', weigh && weigh.fmag != null, weigh && `|F|=${weigh.fmag.toFixed(3)} N`);
  check('静止称重 |F|≈mg(9.81±0.3)', weigh && Math.abs(weigh.fmag - 9.81) < 0.3,
    weigh && `|F|=${weigh.fmag.toFixed(3)} N 偏差=${((weigh.fmag - 9.81) / 9.81 * 100).toFixed(2)}%`);
  check('静止时合力竖直(Fx/Fz≈0, Fy=mg)', weigh && Math.abs(weigh.f[0]) < 0.3 && Math.abs(weigh.f[2]) < 0.3 && Math.abs(weigh.fy - 9.81) < 0.3,
    weigh && `F=(${weigh.f[0].toFixed(2)}, ${weigh.f[1].toFixed(2)}, ${weigh.f[2].toFixed(2)})`);
  await page.screenshot({ path: 'shots/281-weigh.png' });

  // ==== D. 失重演示：悬浮球(gravityScale=0)带初速滑行 → 阻尼修正后 |F|≈0 ====
  // （无接触 + 无重力 → 表观差分只剩阻尼力 −m·d·v，修正后应精确归 0）
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.waitForTimeout(250);
  const fIds = await page.evaluate(() => {
    const sid = window.MECH.addComponent('sphere', {
      name: '悬浮滑块',
      transform: { pos: [0, 0.5, 0] },
      params: { radius: 0.15 },
      physics: { mass: 1, friction: 0, restitution: 0, linvel: [2, 0, 0], gravityScale: 0 },
    });
    window.MECH.select(sid);
    return { sid, fid: window.MECH.addComponent('forceSensor', {}) };
  });
  await page.waitForTimeout(250);
  await page.click('#btnPlay');
  await page.waitForTimeout(1200);
  await page.click('#btnPause');
  const float1 = await page.evaluate((ids) => window.MECH.sensorState(ids.fid), fIds);
  check('滑行中失重读数 |F|<0.05 N（阻尼修正生效）', float1 && float1.fmag < 0.05,
    float1 && `|F|=${float1.fmag.toFixed(4)} N`);
  await page.screenshot({ path: 'shots/282-weightless.png' });

  // ==== E. 斜面下滑：接触合力存在且小于重力（部分失重） ====
  // 真实时钟播放球会滚到坡底平地（F 回到 mg），故用单步推进 40 步（0.33s）保证球仍在斜面上
  await page.evaluate(() => window.MECH.loadPreset('incline'));
  await page.waitForTimeout(250);
  const iFid = await page.evaluate(() => {
    const ball = window.MECH.doc().entities.find((e) => e.type === 'sphere');
    window.MECH.select(ball.id);
    return window.MECH.addComponent('forceSensor', {});
  });
  await page.waitForTimeout(250);
  await page.click('#btnStep');
  await page.evaluate(() => { for (let i = 0; i < 39; i++) document.getElementById('btnStep').click(); });
  await page.waitForTimeout(200);
  const incl = await page.evaluate((id) => window.MECH.sensorState(id), iFid);
  const ballX = await page.evaluate(() => {
    const b = window.MECH.doc().entities.find((e) => e.type === 'sphere');
    return window.MECH.telemetry(b.id).pos[0];
  });
  check('步进后球仍在斜面段(x<0.3)', ballX < 0.3, `x=${ballX.toFixed(3)}`);
  check('斜面下滑读数 |F|<mg（部分失重）', incl && incl.fmag > 0.5 && incl.fmag < 9.6,
    incl && `|F|=${incl.fmag.toFixed(3)} N`);
  check('读数带 simT 时间戳', incl && incl.simT > 0, incl && `simT=${incl.simT.toFixed(2)}`);
  await page.screenshot({ path: 'shots/283-incline-force.png' });

  // ==== F. 检查器 UI + 序列化边界 ====
  await page.evaluate((id) => window.MECH.select(id), iFid);
  await page.waitForTimeout(200);
  const insp = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('#inspBody span')].map((s) => s.textContent);
    return spans.includes('目标接触合力') && spans.includes('竖直分量 Fy');
  });
  check('检查器显示「目标接触合力/竖直分量 Fy」', insp === true);
  const ser = await page.evaluate(() => {
    const s = JSON.stringify(window.MECH.doc());
    return s.includes('"attach"') && !s.includes('sensorReadings') && !s.includes('"fmag"');
  });
  check('attach 进文档、读数不进文档', ser === true);

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
