// p15.mjs — Round 18 验收：spin 真实模型解析九步 E2E（存档喂生产路径）+ 受力分解泛化（非斜面）+ 时间曲线多实体
// 纪律：单浏览器 / 单 context / 单标签；总时长上限约 3 分钟。
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

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

  // ==== A. spin 真实模型解析九步 E2E（step-5-preview 输出存档，非 fixture）====
  await page.click('#tabAgent');
  const realParse = JSON.parse(readFileSync(new URL('../fixtures/parse-spin-real.json', import.meta.url), 'utf-8'));
  const plan = await page.evaluate((p) => window.MECH.loadParse(p), realParse);
  check('真实解析载入(生产 normalizeParse 路径)', plan && plan.kind === 'rotation' && plan.joint
    && String(plan.questionType).includes('角动量'), plan && plan.questionType);
  check('真实解析保留题给转动惯量', plan && plan.entities[0].given.momentOfInertia === 6.5,
    plan && JSON.stringify(plan.entities[0].given));
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(300);
  const doc = await page.evaluate(() => window.MECH.doc());
  check('真实解析建场(转台+滑块+径向滑槽)', doc.entities.length === 2 && doc.kind === 'rotation'
    && doc.entities[0].joints && doc.entities[0].joints[0].type === 'prismatic',
    JSON.stringify(doc.entities.map((e) => e.type)));
  check('转台惯量反解命中题给 6.5', Math.abs(0.5 * doc.entities[0].physics.mass * doc.entities[0].params.radius ** 2 - 6.5) < 0.01,
    `I=${(0.5 * doc.entities[0].physics.mass * doc.entities[0].params.radius ** 2).toFixed(4)}`);

  // 运行+解释（内部 3.5s）→ L 守恒 + 题给惯量下的反比
  await page.click('#tabAgent');
  await page.click('#btnRunExplain');
  await page.waitForFunction(() => {
    const b = document.getElementById('explainBody');
    return b && b.textContent.length > 80;
  }, null, { timeout: 25000 });
  const ex = await page.evaluate(() => window.MECH.explainState());
  check('rotation 解释器(真实解析)', ex && ex.supported && ex.kind === 'rotation', ex ? `kind=${ex.kind}` : 'null');
  check('I0 含题给盘惯量(6.5+2×0.7²=7.48)', ex && Math.abs(ex.I0 - 7.48) < 0.03, ex && `I0=${ex.I0.toFixed(3)}`);
  check('L 守恒误差<1%', ex && ex.driftL < 1, ex && `dL=${ex.driftL.toFixed(3)}%`);
  check('判定通过(L 守恒门控)', ex && ex.pass === true);
  // 滑块滑到限位 1.3 后：ω 理论 = I₁ω₁/I₂ = 19.5/9.88 = 1.974（题给数值的教科书答案）
  await page.click('#btnPlay');
  await page.waitForFunction(() => {
    const s = window.MECH.rotationState();
    return s && s.sliderR >= 1.29;
  }, null, { timeout: 12000 });
  await page.click('#btnPause');
  const sEnd = await page.evaluate(() => window.MECH.rotationState());
  const omegaTheo = (6.5 + 2 * 0.7 * 0.7) * 3 / (6.5 + 2 * 1.3 * 1.3);   // L 含滑块：I₁ω₁=I₂ω₂
  check('滑块到达限位 r≈1.3', sEnd && Math.abs(sEnd.sliderR - 1.3) < 0.02, sEnd && `r=${sEnd.sliderR.toFixed(3)}`);
  check('末态 ω 命中守恒解 2.271±6%', sEnd && Math.abs(sEnd.omega - omegaTheo) / omegaTheo < 0.06,
    sEnd && `ω=${sEnd.omega.toFixed(3)} 理论=${omegaTheo.toFixed(3)}`);
  await page.screenshot({ path: 'shots/150-spin-real-explain.png' });

  // ==== B. 受力分解泛化：动量预置（无斜面，水平地面）====
  await page.selectOption('#selPreset', 'momentum');
  await page.waitForTimeout(300);
  await page.click('#btnForces');
  await page.click('#btnDecompose');
  await page.click('#btnPlay');
  await page.waitForTimeout(1500);
  const fs = await page.evaluate(() => window.MECH.forceState());
  check('泛化分解: 无斜面场景捕获接触法向', fs.decompose === true && fs.normals >= 1, JSON.stringify(fs));
  check('泛化分解: N/f 分列箭头显示', fs.visible >= 2, `visible=${fs.visible}`);
  await page.screenshot({ path: 'shots/151-decompose-ground.png' });

  // 斜面回归：分解模式仍工作
  await page.selectOption('#selPreset', 'incline');
  await page.waitForTimeout(300);
  await page.click('#btnPlay');
  await page.waitForTimeout(900);
  const fs2 = await page.evaluate(() => window.MECH.forceState());
  check('斜面分解回归: 法向捕获+箭头≥3', fs2.decompose && fs2.normals >= 1 && fs2.visible >= 3, JSON.stringify(fs2));
  await page.screenshot({ path: 'shots/152-decompose-incline.png' });

  // ==== C. 时间曲线多实体：动量预置两球叠加 ====
  await page.selectOption('#selPreset', 'momentum');
  await page.waitForTimeout(300);
  await page.click('#btnCurves');
  await page.click('#btnPlay');
  await page.waitForTimeout(2000);
  const cs = await page.evaluate(() => window.MECH.curveState());
  check('多实体曲线: 两球同时采样', cs.on && cs.entities.length === 2 && cs.samples >= 10,
    JSON.stringify({ entities: cs.entities, samples: cs.samples }));
  const legendN = await page.evaluate(() => document.querySelectorAll('#curveLegend span').length);
  check('曲线图例随实体生成(2×2+KE=5)', legendN === 5, `spans=${legendN}`);
  await page.screenshot({ path: 'shots/153-curves-multi.png' });
  await page.waitForTimeout(1200);
  const cs2 = await page.evaluate(() => window.MECH.curveState());
  check('多实体曲线持续采样', cs2.samples > cs.samples + 5, `${cs.samples}→${cs2.samples}`);

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
