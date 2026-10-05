// p16.mjs — Round 19 验收：混合搭建（Agent 计划复用/更新已有实体，不推翻用户场景）
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

  // ==== A. 手动搭建：用户放斜面（改名+改角度+换材质）+ 一个球 ====
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.waitForTimeout(300);
  const manual = await page.evaluate(() => {
    const M = window.MECH;
    const rid = M.addComponent('ramp', { name: '我的斜面', transform: { pos: [0, 0, 0] },
      params: { length: 1.0, height: 0.3, width: 0.5 },
      physics: { body: 'fixed' }, render: { material: 'wood' } });
    const sid = M.addComponent('sphere', { name: '我的球', transform: { pos: [-0.3, 0.75, 0] },
      params: { radius: 0.12 },
      physics: { mass: 3, friction: 0.5, restitution: 0.2, linvel: [0, 0, 0] } });
    return { rid, sid };
  });
  await page.waitForTimeout(250);
  const before = await page.evaluate((ids) => {
    const r = window.MECH.doc().entities.find((e) => e.id === ids.rid);
    const s = window.MECH.doc().entities.find((e) => e.id === ids.sid);
    return { rampLen: r.params.length, mass: s.physics.mass, name: r.name, mat: r.render.material };
  }, manual);
  check('手动场景就绪(斜面L=1.0 球m=3)', before.rampLen === 1.0 && before.mass === 3,
    JSON.stringify(before));

  // ==== B. Agent 解析（incline fixture）→ 混合建场 ====
  await page.click('#tabAgent');
  const plan = await page.evaluate(() => window.MECH.loadFixture('incline'));
  check('incline 解析载入', plan && plan.entities.length === 2);
  await page.click('#btnApplyParse');
  await page.waitForTimeout(400);
  const mixed = await page.evaluate((ids) => {
    const doc = window.MECH.doc();
    const r = doc.entities.find((e) => e.id === ids.rid);
    const s = doc.entities.find((e) => e.id === ids.sid);
    return {
      total: doc.entities.length,
      rampKept: !!r, sphereKept: !!s,
      rampLen: r ? r.params.length : null,
      rampName: r ? r.name : null,
      rampMat: r ? r.render.material : null,
      rampSrc: r ? r.source : null,
      ballMass: s ? s.physics.mass : null,
      ballFriction: s ? s.physics.friction : null,
      ops: (window.MECH.agentOpsState ? window.MECH.agentOpsState() : null),
      origin: doc.meta && doc.meta.origin ? { mixed: doc.meta.origin.mixed, reused: doc.meta.origin.reused, created: doc.meta.origin.created } : null,
      gravity: doc.gravity,
    };
  }, manual);
  check('混合复用: 斜面/球 id 保留不重建', mixed.rampKept && mixed.sphereKept && mixed.total === 2,
    `total=${mixed.total}`);
  check('斜面参数按题给更新(L→2·cos30°≈1.732)', Math.abs(mixed.rampLen - 2 * Math.cos(Math.PI / 6)) < 0.01, `L=${mixed.rampLen}`);
  check('用户命名/材质保留', mixed.rampName === '我的斜面' && mixed.rampMat === 'wood',
    `${mixed.rampName}/${mixed.rampMat}`);
  check('球物理按题给更新(m=1 friction=0)', mixed.ballMass === 1 && mixed.ballFriction === 0,
    `m=${mixed.ballMass} f=${mixed.ballFriction}`);
  check('重力按题给调整(→-10)', mixed.gravity === -10, `g=${mixed.gravity}`);
  check('操作明细含更新两类', mixed.ops && mixed.ops.ops && mixed.ops.ops.some((o) => String(o.op).startsWith('更新')),
    JSON.stringify(mixed.ops && mixed.ops.ops));
  check('meta.origin 标注混合(reused=2)', mixed.origin && mixed.origin.mixed === true && mixed.origin.reused === 2,
    JSON.stringify(mixed.origin));
  await page.screenshot({ path: 'shots/160-mixed-build.png' });

  // ==== C. 混合建场后运行+解释链路照常 ====
  await page.click('#btnPlay');
  await page.waitForTimeout(2600);
  await page.click('#btnPause');
  await page.screenshot({ path: 'shots/161-mixed-run.png' });
  await page.click('#tabAgent');
  await page.click('#btnRunExplain');
  await page.waitForFunction(() => {
    const b = document.getElementById('explainBody');
    return b && b.textContent.length > 80;
  }, null, { timeout: 25000 });
  const ex = await page.evaluate(() => window.MECH.explainState());
  check('混合建场解释链路(斜面分支)', ex && ex.supported, ex ? `kind=${ex.kind} err=${ex.errPct != null ? ex.errPct.toFixed(2) + '%' : '?'}` : 'null');
  check('混合建场解释数值合理(err<15%)', ex && ex.pass !== false && (ex.errPct == null || ex.errPct < 15),
    ex && JSON.stringify({ err: ex.errPct, pass: ex.pass }));

  // ==== D. 撤销恢复用户原参数（Agent 建场批次合并为单个 undo 单元） ====
  await page.evaluate(() => window.MECH.undo());
  await page.waitForTimeout(200);
  const undone = await page.evaluate((ids) => {
    const r = window.MECH.doc().entities.find((e) => e.id === ids.rid);
    return { len: r ? r.params.length : null, name: r ? r.name : null };
  }, manual);
  check('单次撤销恢复用户参数(L=1.0，批次合并)', undone.len === 1.0 && undone.name === '我的斜面', `L=${undone.len} name=${undone.name}`);

  // ==== E. 纯 Agent 路径回归：empty 场景 applyParse 全新建（不复用） ====
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.waitForTimeout(300);
  await page.click('#tabAgent');
  await page.evaluate(() => window.MECH.loadFixture('incline'));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(400);
  const pure = await page.evaluate(() => {
    const doc = window.MECH.doc();
    return { total: doc.entities.length, origin: doc.meta.origin };
  });
  check('纯 Agent 路径: 全新建不复用', pure.total === 2 && pure.origin.mixed === false && pure.origin.reused === 0,
    `total=${pure.total} origin=${JSON.stringify(pure.origin)}`);

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
