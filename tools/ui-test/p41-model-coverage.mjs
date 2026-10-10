// p41-model-coverage.mjs — 模型库覆盖度（UX-R）：14 个新 fixtures（初/高中/大学）全部走
// 真实生产链 loadFixture → normalizeParse → vivid 建场 → 自查（静态+探针+理论），断言：
// ①自查零 error ②关键实体在场（连接件/坡面放置等结构断言）。
// 零出网（fixture 本地）。这是对「示例模型库」的回归兜底——新增模型必须进 EXPECT 表。
// 用法：MECH_BASE=http://127.0.0.1:8722 node p41-model-coverage.mjs
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

// 每模型一条期望：verify error 必须为 0；has=必须存在的实体类型；springN 等结构断言可选
const EXPECT = [
  ['freefall', { has: ['ground', 'sphere'], n: 3, gs: 1 }],
  ['friction-race', { has: ['ground', 'box'], boxN: 2 }],
  ['inertia', { has: ['ground', 'sphere'] }],
  ['vertical-throw', { has: ['ground', 'sphere'] }],
  ['inelastic', { has: ['ground', 'sphere'], sphereN: 2 }],
  ['recoil', { has: ['ground', 'sphere'], sphereN: 2 }],
  ['bullet-block', { has: ['ground', 'box', 'sphere'] }],
  ['plank', { has: ['ground', 'box'], boxN: 2 }],
  ['rolling', { has: ['ramp', 'cylinder'], onRamp: 'cylinder' }],
  ['ramp-race', { has: ['ramp', 'sphere', 'cylinder'] }],
  ['elliptic', { has: ['celestial'], celN: 2 }],
  ['coupled', { has: ['ground', 'sphere'], springN: 1 }],
  ['damped', { has: ['sphere'], springN: 1 }],
  ['launcher', { has: ['ground', 'box', 'sphere'], springN: 1 }],
  // 波2（传送带+课程补齐）
  ['conveyor', { has: ['conveyor', 'sphere', 'ground'] }],
  ['horizontal-throw', { has: ['sphere', 'ground'] }],
  ['oblique45', { has: ['sphere', 'ground'] }],
  ['elastic', { has: ['sphere'], sphereN: 2 }],
  ['chase', { has: ['sphere'], sphereN: 2 }],
  // R5-B2 模型波3（MOD-516~545 S 级）
  ['vertical-down', { has: ['sphere'] }],
  ['freefall3', { has: ['ground', 'sphere'], sphereN: 3, gs: 1 }],
  ['oblique60', { has: ['sphere'] }],
  ['oblique-moon', { has: ['sphere', 'ground'] }],
  ['elastic-heavy-light', { has: ['sphere'], sphereN: 2 }],
  ['elastic-light-heavy', { has: ['sphere'], sphereN: 2 }],
  ['elastic-rear', { has: ['sphere'], sphereN: 2 }],
  ['elastic-headon', { has: ['sphere'], sphereN: 2 }],
  ['collision-e05', { has: ['sphere'], sphereN: 2 }],
  // R5-B5 曲面族（MOD-581~595）
  ['curved-descent', { has: ['curvedRamp', 'sphere', 'ground'] }],
  ['bowl', { has: ['bowl', 'sphere'] }],
  ['hooke-static', { has: ['spring', 'sphere', 'box'], springN: 1, n: 3 }],
  ['pendulum-compare', { has: ['rope', 'sphere', 'box', 'ground'], ropeN: 2, sphereN: 2, n: 7 }],   // 4 题给体+2 绳+AG-542 自动承接地面
  ['recoil-unequal', { has: ['ground', 'sphere'], sphereN: 2 }],
  ['conveyor-reverse', { has: ['conveyor', 'sphere'] }],
  ['binary', { has: ['celestial'], celN: 2 }],
  ['elliptic-deep', { has: ['celestial'], celN: 2 }],
  ['hinge-l15', { has: ['box'], boxN: 2 }],
  // R5-B2 模型波4（单摆族+竖直弹簧，MOD-501/506）
  ['pendulum', { has: ['rope', 'sphere', 'box'], ropeN: 1, sphereN: 1, n: 3 }],
  ['spring-vert', { has: ['spring', 'sphere', 'box'], springN: 1, sphereN: 1, n: 3 }],
];

async function withPage(fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('net::ERR_FAILED')) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);
  await page.route('**/api/**', (r) => r.abort());
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

for (const [name, exp] of EXPECT) {
  await withPage(async (page) => {
    await page.evaluate(() => document.getElementById('btnNew').click());
    await page.evaluate(() => document.getElementById('tabAgent').click());
    await page.evaluate((n) => window.MECH.loadFixture(n), name);
    await page.waitForFunction(() => {
      const b = document.getElementById('btnApplyParse');
      return b && !b.disabled && document.getElementById('changePreview').style.display !== 'none';
    }, null, { timeout: 30000, polling: 300 });
    await page.click('#btnApplyParse');
    let built = true;
    try {
      await page.waitForFunction(() => window.MECH.agentVerifyState() != null && !window.MECH.agentBusy(),
        null, { timeout: 90000, polling: 300 });
    } catch {
      built = false;
    }
    if (!built) {
      check(`${name} 建场+自查完成`, false, '超时');
      return;
    }
    const out = await page.evaluate(() => {
      const d = window.MECH.doc();
      const st = window.MECH.agentVerifyState();
      return {
        summary: st.summary,
        errs: st.findings.filter((f) => f.sev === 'error').map((f) => `${f.cat}:${f.msg.slice(0, 60)}`),
        types: d.entities.map((e) => e.type),
        springN: d.entities.filter((e) => e.type === 'spring').length,
        ropeN: d.entities.filter((e) => e.type === 'rope').length,
        boxN: d.entities.filter((e) => e.type === 'box').length,
        sphereN: d.entities.filter((e) => e.type === 'sphere').length,
        celN: d.entities.filter((e) => e.type === 'celestial').length,
        cylPos: (d.entities.find((e) => e.type === 'cylinder') || {}).transform?.pos,
        rampW: (d.entities.find((e) => e.type === 'ramp') || {}).params?.width,
        gs0: (d.entities.find((e) => e.type === 'sphere') || {}).physics?.gravityScale,
      };
    });
    check(`${name} 自查零 error`, out.summary.error === 0, JSON.stringify({ s: out.summary, errs: out.errs }));
    const missing = exp.has.filter((t) => !out.types.includes(t));
    check(`${name} 实体齐备`, missing.length === 0, `缺 ${missing} | got ${out.types.join(',')}`);
    if (exp.n != null) check(`${name} 实体数=${exp.n}`, out.types.length === exp.n, 'got ' + out.types.length);
    if (exp.boxN != null) check(`${name} box=${exp.boxN}`, out.boxN === exp.boxN, 'got ' + out.boxN);
    if (exp.sphereN != null) check(`${name} sphere=${exp.sphereN}`, out.sphereN === exp.sphereN, 'got ' + out.sphereN);
    if (exp.springN != null) check(`${name} spring=${exp.springN}`, out.springN === exp.springN, 'got ' + out.springN);
    if (exp.ropeN != null) check(`${name} rope=${exp.ropeN}`, out.ropeN === exp.ropeN, 'got ' + out.ropeN);
    if (exp.celN != null) check(`${name} celestial=${exp.celN}`, out.celN === exp.celN, 'got ' + out.celN);
    if (exp.onRamp === 'cylinder' && out.cylPos) {
      // 圆柱应贴坡（y 高于地面且在坡高处，而非默认平地 [0, h/2, 0.8]）
      check(`${name} 圆柱在坡面上`, out.cylPos[1] > 0.3, `pos=${JSON.stringify(out.cylPos)}`);
    }
    if (exp.gs === 1) check(`${name} 球体重力生效（gravityScale=1，自由落体语义）`, out.gs0 === 1, 'gs0=' + out.gs0);
    if (name === 'ramp-race' && out.rampW != null) {
      check(`${name} 斜面自动加宽（2 车道）`, out.rampW >= 1.4, `width=${out.rampW}`);
    }
  });
}

check('Z1 无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

const fails = results.filter((r) => !r.ok);
console.log(`\n== 汇总 ==\nPASS ${results.length - fails.length}/${results.length}`);
process.exit(fails.length ? 1 : 0);
