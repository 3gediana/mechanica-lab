// p7.mjs — Round 9 验收：spin 题拍题九步（fixture→建场+joint→运行→rotation 解释）+ 受力箭头 + 时间曲线
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
  await page.click('#tabAgent');

  // ==== A. spin 题拍题九步（fixture）
  const plan = await page.evaluate(() => window.MECH.loadFixture('spin'));
  check('spin fixture 载入(kind=rotation+joint)', plan && plan.kind === 'rotation' && plan.joint && plan.joint.from === 0,
    JSON.stringify({ kind: plan && plan.kind, joint: plan && !!plan.joint }));
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(300);
  const doc = await page.evaluate(() => window.MECH.doc());
  const table = doc.entities.find((e) => e.name.includes('转台'));
  check('对转建场+自动滑槽约束', doc.entities.length === 2 && table && Array.isArray(table.joints)
    && table.joints[0].type === 'prismatic' && table.joints[0].target === doc.entities[1].id,
    JSON.stringify(doc.entities.map((e) => ({ t: e.type, j: (e.joints || []).length }))));
  check('doc.kind=rotation', doc.kind === 'rotation');

  // ==== 运行 → rotation 解释
  await page.click('#tabAgent');
  await page.click('#btnRunExplain');
  await page.waitForFunction(() => {
    const b = document.getElementById('explainBody');
    return b && b.textContent.length > 80;
  }, null, { timeout: 25000 });
  const ex = await page.evaluate(() => window.MECH.explainState());
  check('rotation 解释器: 结构化输出', ex && ex.supported && ex.kind === 'rotation', ex ? `kind=${ex.kind}` : 'null');
  check('rotation: L 守恒误差<1%', ex.driftL < 1, `dL=${ex.driftL.toFixed(3)}%`);
  check('rotation: I 增大 ω 减小(反比)', ex.INow > ex.I0 && ex.omegaNow < ex.omega0,
    `I ${ex.I0.toFixed(2)}→${ex.INow.toFixed(2)}, ω ${ex.omega0.toFixed(2)}→${ex.omegaNow.toFixed(2)}`);
  check('rotation: 反比参考值已计算', typeof ex.errPct === 'number', `err=${ex.errPct != null ? ex.errPct.toFixed(2) : 'null'}%（滑移瞬态，作参考）`);
  check('rotation: 判定通过(L 守恒门控)', ex.pass === true);
  await page.screenshot({ path: 'shots/70-spin-explain.png' });

  // ==== B+C. 斜面预置：受力箭头 + 时间曲线
  await page.selectOption('#selPreset', 'incline');
  await page.waitForTimeout(300);
  await page.click('#btnForces');
  await page.click('#btnCurves');
  await page.click('#btnPlay');
  await page.waitForTimeout(1200);
  const fs = await page.evaluate(() => window.MECH.forceState());
  check('受力箭头显示(重力+接触合力)', fs.on && fs.visible >= 1, JSON.stringify(fs));
  // 固定 1.2s 在批负载下可能只采 4 个样（采样节流 0.15s）：等待采样到位
  await page.waitForFunction(() => window.MECH.curveState().samples >= 5, null, { timeout: 5000 });
  const cs = await page.evaluate(() => window.MECH.curveState());
  check('时间曲线采样中', cs.on && cs.samples >= 5, JSON.stringify(cs));
  await page.screenshot({ path: 'shots/71-forces-curves.png' });
  await page.waitForTimeout(1200);
  const cs2 = await page.evaluate(() => window.MECH.curveState());
  check('曲线持续采样', cs2.samples > cs.samples + 5, `${cs.samples}→${cs2.samples}`);
  await page.screenshot({ path: 'shots/72-curves-late.png' });

  // ---- 通用控制冒烟
  await page.click('#btnReset');
  const stR = await page.evaluate(() => window.MECH.state());
  check('重置可用', stR.mode === 'edit' && stR.simT === 0, `mode=${stR.mode}`);

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
