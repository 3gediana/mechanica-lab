// p25.mjs — Round 28 验收：组件兼容性提示（compat tooltip + 两实体徽标）+ 测量教学组件（标记/测量尺）
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

  // ==== A. 兼容性提示：tooltip 含【兼容性】段，连接类带「需两实体」徽标 ====
  const tip = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#catalogList .comp-item')];
    const spring = rows.find((r) => r.querySelector('.nm')?.textContent === '弹簧');
    const sphere = rows.find((r) => r.querySelector('.nm')?.textContent === '球');
    return {
      springTitle: spring?.title || '',
      sphereTitle: sphere?.title || '',
      springBadge: !!spring?.querySelector('.need2'),
      sphereBadge: !!sphere?.querySelector('.need2'),
    };
  });
  check('连接类 tooltip 含兼容性段', tip.springTitle.includes('【兼容性】') && tip.springTitle.includes('两个实体'),
    tip.springTitle.slice(0, 60));
  check('连接类带「需两实体」徽标', tip.springBadge === true);
  check('普通组件无徽标但有兼容性段', tip.sphereBadge === false && tip.sphereTitle.includes('【兼容性】'),
    tip.sphereTitle.slice(0, 50));
  await page.screenshot({ path: 'shots/250-compat.png' });

  // ==== B. 关键点标记：放置（无碰撞、固定、不参与测量）====
  await page.evaluate(() => {
    window.MECH.loadPreset('empty');
    window.MECH.addComponent('marker', { name: '起点标记', transform: { pos: [0.5, 0.21, 0] } });
  });
  await page.waitForTimeout(300);
  const mk = await page.evaluate(() => {
    const e = window.MECH.doc().entities.find((x) => x.name === '起点标记');
    void e;
    return {
      exists: !!e,
      // 运行 1s 不动（固定无碰撞）
    };
  });
  await page.click('#btnPlay');
  await page.waitForTimeout(1000);
  await page.click('#btnPause');
  const mk2 = await page.evaluate(() => window.MECH.doc().entities.find((x) => x.name === '起点标记')?.transform.pos);
  check('标记放置成功', mk.exists === true);
  check('标记运行中不动(fixed)', JSON.stringify(mk2) === JSON.stringify([0.5, 0.21, 0]), JSON.stringify(mk2));

  // ==== C. 测量尺：两实体放置 + 实时距离读数 ====
  await page.evaluate(() => {
    const M = window.MECH;
    M.addComponent('sphere', { name: '甲球', transform: { pos: [-1, 0.15, 0] },
      params: { radius: 0.15 }, physics: { mass: 1, friction: 0, restitution: 0, linvel: [1, 0, 0], linDamping: 0, angDamping: 0 } });
    M.addComponent('sphere', { name: '乙球', transform: { pos: [1, 0.15, 0] },
      params: { radius: 0.15 }, physics: { mass: 1, friction: 0, restitution: 0, linvel: [0, 0, 0], linDamping: 0, angDamping: 0 } });
  });
  await page.waitForTimeout(250);
  const rulerId = await page.evaluate(() => {
    const d = window.MECH.doc();
    const a = d.entities.find((e) => e.name === '甲球');
    const b = d.entities.find((e) => e.name === '乙球');
    window.MECH.select(a.id);
    window.MECH.select(b.id, true);
    return window.MECH.addComponent('ruler');
  });
  await page.waitForTimeout(300);
  const r0 = await page.evaluate((id) => {
    const e = window.MECH.doc().entities.find((x) => x.id === id);
    const a = window.MECH.telemetry(e.attach[0]);
    const b = window.MECH.telemetry(e.attach[1]);
    return { name: e.name, dist: Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]) };
  }, rulerId);
  check('测量尺放置(名称带初距)', r0.name.includes('测量尺') && r0.name.includes('2.00'), r0.name);
  check('初距 2.00m', Math.abs(r0.dist - 2.0) < 0.02, `d=${r0.dist.toFixed(3)}`);

  // 运行（甲球向乙球运动）→ 距离实时变化（跟随）
  await page.click('#btnPlay');
  await page.waitForTimeout(900);
  await page.click('#btnPause');
  const r1 = await page.evaluate((id) => {
    const e = window.MECH.doc().entities.find((x) => x.id === id);
    const a = window.MECH.telemetry(e.attach[0]);
    const b = window.MECH.telemetry(e.attach[1]);
    return Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]);
  }, rulerId);
  check('运行中测量尺跟随(距离变小)', r1 < r0.dist - 0.3, `d=${r1.toFixed(3)} < ${r0.dist.toFixed(2)}`);
  // 检查器选中测量尺显示实时读数
  await page.evaluate((id) => window.MECH.select(id), rulerId);
  await page.waitForTimeout(200);
  const inspHasDist = await page.evaluate(() =>
    [...document.querySelectorAll('#inspBody span')].some((s) => s.textContent === '两端点距离'));
  check('检查器显示「两端点距离」读数', inspHasDist === true);
  await page.screenshot({ path: 'shots/251-ruler.png' });

  // ==== D. 兼容性徽标语义回归：单实体时点弹簧被拒并提示 ====
  await page.evaluate(() => window.MECH.select(null));
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.comp-item')];
    rows.find((r) => r.querySelector('.nm')?.textContent === '弹簧').click();
  });
  await page.waitForTimeout(200);
  const toastText = await page.evaluate(() => document.getElementById('toast').textContent);
  check('单实体点弹簧被拒+提示', toastText.includes('两个实体'), toastText);

  // ==== E. 回归：预置照常（新增组件不破坏既有链路） ====
  await page.selectOption('#selPreset', 'incline');
  await page.waitForTimeout(400);
  await page.click('#btnPlay');
  await page.waitForTimeout(1200);
  await page.click('#btnPause');
  check('incline 回归运行', consoleErrors.length === 0, `${consoleErrors.length} errors`);

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
