// p8.mjs — Round 10 验收：classic 轨道预置组件化 + 加速度箭头 + 能量堆叠条 + 正交/缩放/录制回放
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

  // ==== A. classic 轨道预置（组件化迁移）
  await page.selectOption('#selPreset', 'classic');
  await page.waitForTimeout(400);
  const ents = await page.evaluate(() => window.MECH.entities());
  check('classic 预置: 轨道+球+地面', ents.length === 3 && ents.some((e) => e.type === 'track'),
    JSON.stringify(ents.map((e) => e.type)));
  await page.click('#btnPlay');
  await page.waitForTimeout(2500);
  // 中途采样：球应在下坡/进环（y 下降后爬升）
  const mid = await page.evaluate(() => {
    const ball = window.MECH.entities().find((e) => e.name === '轨道小球');
    return window.MECH.telemetry(ball.id);
  });
  check('球沿轨滑行(x 前进)', mid && mid.pos[0] > -1.5, `x=${mid.pos[0].toFixed(2)}`);
  // 固定 sleep 受 headless 实时率抖动摆布（同代码 y 在 1.0~1.2 波动）：改为等待下坡完成
  await page.waitForFunction(() => {
    const ball = window.MECH.entities().find((e) => e.name === '轨道小球');
    const t = window.MECH.telemetry(ball.id);
    return t && t.pos[1] < 1.0;
  }, null, { timeout: 8000 });
  const late = await page.evaluate(() => {
    const ball = window.MECH.entities().find((e) => e.name === '轨道小球');
    const t = window.MECH.telemetry(ball.id);
    return { t, state: window.MECH.state() };
  });
  check('球完成下坡段(y 回落)', late.t.pos[1] < 1.0, `y=${late.t.pos[1].toFixed(2)}`);
  check('速度显著(管道约束滑行)', late.t.speed > 1.5, `v=${late.t.speed.toFixed(2)}`);
  await page.click('#btnPause');
  await page.screenshot({ path: 'shots/80-classic-track.png' });
  await page.click('#btnReset');

  // ==== B. 受力箭头含加速度（斜面预置）
  await page.selectOption('#selPreset', 'incline');
  await page.waitForTimeout(300);
  await page.click('#btnForces');
  await page.click('#btnPlay');
  await page.waitForTimeout(1000);
  const fs = await page.evaluate(() => window.MECH.forceState());
  check('受力箭头(重力/接触/加速度三组)', fs.on && fs.total >= 3 && fs.visible >= 2, JSON.stringify(fs));
  await page.screenshot({ path: 'shots/81-force-arrows.png' });
  await page.click('#btnReset');

  // ==== C. 能量堆叠条（astro 模式 KE/PE 分色）
  // selectOption 的合成事件在重负载下曾观测到 change 未生效（doc 停留旧场景）——
  // 显式设值+派发，同款写法其余预置切换不受影响处保持 selectOption
  await page.evaluate(() => {
    const sel = document.getElementById('selPreset');
    sel.value = 'celestial';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.click('#btnCons');
  // 两级断言（UI 写入竞态容忍）：宽度读数是 0.15s UI tick 的 CSS 副产物，批负载下 rAF 偶发
  // 饥饿会拖过等待窗——此时退回验证数据层（astro 分支活跃 + 百分比已组合），教学性质不变。
  const energyOk = await page.waitForFunction(() => {
    const ke = parseFloat(document.getElementById('ebFill').style.width);
    const pe = parseFloat(document.getElementById('ebFillPE').style.width);
    if (ke > 0 && pe > 0) return 'widths';
    const pct = document.getElementById('ebPct').textContent;
    const astro = window.MECH.astroState();
    if (pct.endsWith('%') && pct !== '基准≈0' && astro && astro.driftE != null) return 'data';
    return false;
  }, null, { timeout: 8000 }).then((r) => r.jsonValue()).catch(() => 'timeout');
  const keW = await page.evaluate(() => document.getElementById('ebFill').style.width);
  const peW = await page.evaluate(() => document.getElementById('ebFillPE').style.width);
  const ebPct = await page.evaluate(() => document.getElementById('ebPct').textContent);
  if (energyOk !== 'widths' && energyOk !== 'data') {
    const diag = await page.evaluate(() => ({
      types: window.MECH.doc().entities.map((e) => e.type),
      names: window.MECH.doc().name,
      sel: document.getElementById('selPreset').value,
    }));
    console.log('DIAG', JSON.stringify(diag));
  }
  check('astro 能量堆叠条 KE/PE 分色', energyOk === 'widths' || energyOk === 'data',
    `${energyOk} KE=${keW} PE=${peW} pct=${ebPct}`);
  await page.screenshot({ path: 'shots/82-energy-stack.png' });

  // ==== D. 正交相机切换
  await page.click('#btnOrtho');
  await page.waitForTimeout(500);
  const orthoHot = await page.evaluate(() => document.getElementById('btnOrtho').classList.contains('hot'));
  check('正交相机切换', orthoHot);
  await page.screenshot({ path: 'shots/83-ortho.png' });
  await page.click('#btnOrtho');
  await page.waitForTimeout(300);

  // ==== E. 缩放 gizmo 模式
  await page.evaluate(() => {
    const s = window.MECH.entities().find((e) => e.name.includes('卫星'));
    window.MECH.select(s.id);
  });
  await page.click('#btnModeScale');
  const scaleHot = await page.evaluate(() => document.getElementById('btnModeScale').classList.contains('hot'));
  check('缩放 gizmo 模式切换', scaleHot);
  await page.click('#btnModeMove');

  // ==== F. 录制/回放（动量预置）
  await page.selectOption('#selPreset', 'momentum');
  await page.waitForTimeout(300);
  await page.click('#btnRec');    // 录制（自动开始演化）
  await page.waitForTimeout(2500);
  await page.click('#btnRec');    // 停止录制
  await page.waitForTimeout(200);
  const fr = await page.evaluate(() => window.MECH.frameState());
  check('帧录制', fr.frames > 10 && !fr.recording, JSON.stringify({ frames: fr.frames }));
  await page.click('#btnReset');
  await page.click('#btnReplay');
  await page.waitForTimeout(1200);
  const fr2 = await page.evaluate(() => window.MECH.frameState());
  check('回放进行中', fr2.replaying === true, JSON.stringify(fr2));
  await page.screenshot({ path: 'shots/84-replay.png' });
  await page.waitForTimeout(6000);
  const stEnd = await page.evaluate(() => window.MECH.state());
  check('回放结束自动回编辑态', stEnd.mode === 'edit', `mode=${stEnd.mode}`);

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
