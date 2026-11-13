// p51-selfheal.mjs — R7-B3 注入故障验证：应用内「自检 → 规则化修复 → 复检」闭环。
// 把 p49 首跑咬出的真问题类（编号沿用 R6-038 的 9 类清单）做成可注入故障：
//   ② 取景过近——动态体运动出画（相机级） → NDC 探针检出 → 轨迹包络重取景 → 复检绿
//   ③ 行程终点出画（初始包围盒取景，R6-037③ 原案） → 同上
//   ⑥ 抛体落点出画（落点在初始取景外，R6-038⑥ 原案） → 同上
//   ⑨ 画面退化（相机 260m 芝麻 / 40m 静态巨道具压芝麻） → 画面探针检出 → 主体特写重取景 → 复检绿
//   B  网格缺失 → 检出并如实报错（skipPatch 不烧模型修订轮次——不许静默放过）
// 验收：自动修复 ≥4 类；诚实失败路径有报告无静默；console 净。
// 全程 fixture 驱动（零出网/零 key）。用法：MECH_BASE=http://127.0.0.1:8722 node p51-selfheal.mjs
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

async function withPage(fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('net::ERR_FAILED')) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(40000);
  await page.route('**/api/**', (r) => r.abort());   // 出网保险丝：fixture 链路零 key
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

// 建场（fixture）→ 等基线自查收敛（含自动修复轮）
async function build(page, fixture) {
  await page.evaluate(() => document.getElementById('btnNew').click());
  await page.evaluate(() => document.getElementById('tabAgent').click());
  await page.evaluate((f) => window.MECH.loadFixture(f), fixture);
  await page.waitForFunction(() => {
    const b = document.getElementById('btnApplyParse');
    return b && !b.disabled;
  }, null, { timeout: 20000, polling: 250 });
  await page.evaluate(() => document.getElementById('btnApplyParse').click());
  await page.waitForFunction(() => {
    const s = window.MECH.agentVerifyState();
    return s != null && !window.MECH.agentBusy();
  }, null, { timeout: 60000, polling: 250 });
}

// 注入 → 自检 → 回收敛后的报告（附注入瞬间的相机距离，供「修复确实拉远了相机」对账）
async function faultSelfCheck(page, fault) {
  const note = await page.evaluate((f) => window.MECH.__injectFault(f), fault);
  const dInj = await page.evaluate(() => {
    const c = window.MECH.cameraPos(), t = window.MECH.cameraTarget();
    return Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2]);
  });
  const s = await page.evaluate(() => window.MECH.selfCheck());
  return { note, s, dInj };
}

let repairedClasses = 0;
try {
  // ==== E0. 干净基线：atwood 建场自带包络取景，视觉三探针全过零修复 ====
  await withPage(async (page) => {
    await build(page, 'atwood');
    const s = await page.evaluate(() => window.MECH.agentVerifyState());
    check('E0-1 干净链路零 error', s.summary.error === 0, JSON.stringify(s.summary));
    const cats = s.findings.filter((f) => f.cat.startsWith('视觉·')).map((f) => f.cat + ':' + f.sev);
    check('E0-2 视觉三探针在报告里且全 ok',
      ['视觉·出画', '视觉·覆盖', '视觉·画面'].every((c) => cats.some((x) => x.startsWith(c + ':ok'))),
      cats.join(' '));
    check('E0-3 干净场景不触发修复轮', s.visual.rounds === 0, JSON.stringify(s.visual));
  });

  // ==== E1. ②类：取景过近 → 包络重取景修复 ====
  await withPage(async (page) => {
    await build(page, 'atwood');
    const { s, dInj } = await faultSelfCheck(page, 'ndc-out');
    check('E1-1 ②类检出并修复', s.visual.repaired.includes('视觉·出画'), JSON.stringify(s.visual));
    check('E1-2 修复后零视觉 error', s.summary.error === 0, JSON.stringify(s.summary));
    const d1 = await page.evaluate(() => {
      const c = window.MECH.cameraPos(), t = window.MECH.cameraTarget();
      return Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2]);
    });
    check('E1-3 重取景实际生效（相机比故障态拉远）', d1 > dInj * 1.5, `dist 注入${dInj.toFixed(2)}→修复后${d1.toFixed(2)}`);
    if (s.visual.repaired.length) repairedClasses++;
  });

  // ==== E2. ③类：行程终点出画（初始包围盒取景原案） → 包络补拍修复 ====
  await withPage(async (page) => {
    await build(page, 'atwood');
    const { s } = await faultSelfCheck(page, 'travel-out');
    check('E2-1 ③类检出并修复', s.visual.repaired.includes('视觉·出画'), JSON.stringify(s.visual));
    check('E2-2 修复后零视觉 error', s.summary.error === 0, JSON.stringify(s.summary));
    if (s.visual.repaired.length) repairedClasses++;
  });

  // ==== E3. ⑥类：抛体落点出画 → 轨迹包络重取景修复 ====
  await withPage(async (page) => {
    await build(page, 'projectile');
    const { s } = await faultSelfCheck(page, 'travel-out');
    check('E3-1 ⑥类检出并修复', s.visual.repaired.includes('视觉·出画'), JSON.stringify(s.visual));
    check('E3-2 修复后零视觉 error', s.summary.error === 0, JSON.stringify(s.summary));
    if (s.visual.repaired.length) repairedClasses++;
  });

  // ==== E4. ⑨类：相机 260m 主体芝麻 → 主体份额探针检出 → 主体特写修复 ====
  await withPage(async (page) => {
    await build(page, 'atwood');
    const { s } = await faultSelfCheck(page, 'sesame');
    check('E4-1 ⑨类(远)检出并修复', s.visual.repaired.some((c) => c === '视觉·主体' || c === '视觉·画面'), JSON.stringify(s.visual));
    check('E4-2 修复后主体可读', s.summary.error === 0
      && s.findings.some((f) => f.cat === '视觉·主体' && f.sev === 'ok'), JSON.stringify(s.summary));
    if (s.visual.repaired.length) repairedClasses++;
  });

  // ==== E5. ⑨类变体：40m 静态巨道具压芝麻 → 主体特写修复 ====
  await withPage(async (page) => {
    await build(page, 'atwood');
    const { s } = await faultSelfCheck(page, 'prop-huge');
    check('E5-1 ⑨类(巨道具)检出并修复', s.visual.repaired.some((c) => c === '视觉·主体' || c === '视觉·画面'), JSON.stringify(s.visual));
    check('E5-2 修复后零视觉 error', s.summary.error === 0, JSON.stringify(s.summary));
    if (s.visual.repaired.length) repairedClasses++;
  });

  // ==== E6. 诚实失败：网格缺失 → 如实报错，不静默不烧模型轮次 ====
  await withPage(async (page) => {
    await build(page, 'atwood');
    const { s } = await faultSelfCheck(page, 'mesh-missing');
    const mesh = s.findings.find((f) => f.cat === '视觉·网格');
    check('E6-1 网格缺失被检出', mesh && mesh.sev === 'error', mesh && mesh.msg);
    check('E6-2 不静默放过（error 留在报告）', s.summary.error >= 1, JSON.stringify(s.summary));
    check('E6-3 渲染层问题不烧模型修订轮次',
      !s.visual.repaired.includes('视觉·网格') && (await page.evaluate(() => window.MECH.agentPatchState())).rounds === 0);
  });

  check('B3 闭环自动修复 ≥4 类故障', repairedClasses >= 4, `已修复 ${repairedClasses} 类`);
  check('无 console 错误', consoleErrors.length === 0, consoleErrors[0] || '');
} finally {
  await browser.close();
}

console.log('\n== 汇总 ==');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
const pass = results.filter((r) => r.ok).length;
console.log(`\nPASS ${pass}/${results.length}`);
if (pass !== results.length) process.exitCode = 1;
