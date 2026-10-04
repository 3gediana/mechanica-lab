// p12.mjs — Round 14 验收：铰链复摆九步（周期解释）+ 滚动阻力对比
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

  // ==== A. 复摆预置：载入 → 运行 5.5s → hinge 解释
  await page.selectOption('#selPreset', 'hingePend');
  await page.waitForTimeout(400);
  const ents = await page.evaluate(() => window.MECH.entities());
  check('复摆预置: 基座+杆(杆带 revolute joint)', ents.length === 2
    && await page.evaluate(() => {
      const a = window.MECH.doc().entities.find((e) => e.name.includes('基座'));
      return a && a.joints && a.joints[0].type === 'revolute';
    }), JSON.stringify(ents.map((e) => e.type)));
  await page.click('#btnPlay');
  await page.waitForTimeout(6000);
  await page.click('#btnPause');
  await page.screenshot({ path: 'shots/110-hinge-pendulum.png' });

  // ==== B. 拍题九步（hinge fixture）→ 解释
  await page.click('#tabAgent');
  const hplan = await page.evaluate(() => window.MECH.loadFixture('hinge'));
  check('铰链 fixture 载入', hplan && hplan.kind === 'hinge', hplan && hplan.kind);
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(300);
  const hdoc = await page.evaluate(() => window.MECH.doc());
  check('铰链建场(锚点+杆+joints)', hdoc.entities.length === 2
    && hdoc.entities.some((e) => e.joints && e.joints[0].type === 'revolute'),
    JSON.stringify(hdoc.entities.map((e) => e.type)));
  await page.click('#tabAgent');
  await page.click('#btnRunExplain');
  await page.waitForFunction(() => {
    const b = document.getElementById('explainBody');
    return b && b.textContent.length > 80;
  }, null, { timeout: 25000 });
  const ex = await page.evaluate(() => window.MECH.explainState());
  check('hinge 解释器: 结构化输出', ex && ex.supported && ex.kind === 'hinge', ex ? `kind=${ex.kind}` : 'null');
  // 理论周期：fixture 题给 g=10 → 2π√(2/(3×10)) = 1.622（AG-3 修复后理论与场景重力一致）
  check('hinge: 理论周期≈1.622(g=10 题给)', Math.abs(ex.theoretical.period - 1.622) < 0.01, `T=${ex.theoretical.period.toFixed(3)}`);
  check('hinge: 实测周期偏差<8%', ex.pass && ex.errPct < 8,
    `T=${ex.measured.period != null ? ex.measured.period.toFixed(3) : '?'} err=${ex.errPct != null ? ex.errPct.toFixed(2) : '?'}%`);
  await page.screenshot({ path: 'shots/111-hinge-explain.png' });

  // ==== C. 滚动阻力对比（斜面预置 + rollResist 球 vs 普通球）
  await page.selectOption('#selPreset', 'incline');
  await page.waitForTimeout(300);
  // 添加第二球并开滚动阻力 0.08
  const id2 = await page.evaluate(() => {
    const r = window.MECH.entities().find((e) => e.type === 'ramp');
    const id = window.MECH.addComponent('sphere', {
      name: '滚动阻力球',
      transform: { pos: [-0.45, 0.86, 0.6] },
      params: { radius: 0.15, rollResist: 0.08 },
      physics: { mass: 1, friction: 0.3, restitution: 0.1, linvel: [0, 0, 0] },
    });
    void r;
    return id;
  });
  await page.waitForTimeout(250);
  const rrb = await page.evaluate((id) => {
    const e = window.MECH.doc().entities.find((x) => x.id === id);
    return e && e.params.rollResist;
  }, id2);
  check('滚动阻力参数写入(0.08)', rrb === 0.08, `rollResist=${rrb}`);
  await page.click('#btnPlay');
  await page.waitForTimeout(2500);
  await page.click('#btnPause');
  await page.waitForTimeout(200);
  const cmp = await page.evaluate(() => {
    const balls = window.MECH.entities().filter((e) => e.type === 'sphere');
    return balls.map((e) => ({ name: e.name, id: e.id, tel: window.MECH.telemetry(e.id) }));
  });
  const rr = cmp.find((c) => c.name.includes('阻力'));
  const normal = cmp.find((c) => !c.name.includes('阻力'));
  check('两球均在斜面演化', rr && normal && rr.tel && normal.tel, JSON.stringify(cmp.map((c) => c.tel && +c.tel.pos[0].toFixed(2))));
  check('滚动阻力球位移更短', rr && normal && rr.tel.pos[0] < normal.tel.pos[0],
    `阻力球x=${rr.tel.pos[0].toFixed(2)} 普通球x=${normal.tel.pos[0].toFixed(2)}`);
  await page.screenshot({ path: 'shots/112-rollresist.png' });

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
