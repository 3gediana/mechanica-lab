// p31.mjs — Round 34 验收：Goal 七结构化解析字段清单逐项证据
// （24 字段→plan 字段/UI 落点映射逐项断言；fixture 对齐 + 真实模型抽查一次）
// 纪律：单浏览器 / 单 context / 单标签；真实 API 抽查仅 1 次调用。
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

  // ==== A. Goal 七 24 字段逐项（fixture: incline 全字段锚点） ====
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.click('#tabAgent');
  await page.evaluate(() => window.MECH.loadFixture('incline'));
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => window.MECH.agentState());
  check('题目类型 questionType', !!st.questionType && st.questionType !== '未知题型', st.questionType);
  check('实验目标 goal', !!st.goal, (st.goal || '').slice(0, 24));
  check('实体列表+类型 entities[].type', st.entities.length >= 2 && st.entities.every((e) => e.type), st.entities.map((e) => e.type).join(','));
  check('角度/尺寸 given.angleDeg+length', st.entities[0].given.angleDeg === 30 && st.entities[0].given.length === 2,
    JSON.stringify(st.entities[0].given));
  check('质量/摩擦 given.mass+friction', st.entities[1].given.mass === 1 && st.entities[1].given.friction === 0,
    JSON.stringify(st.entities[1].given));
  check('重力条件 gravity', typeof st.gravity === 'number', `g=${st.gravity}`);
  check('环境条件 environment（新）', !!st.environment, st.environment);
  check('固定点 anchorPoints（新）', st.anchorPoints.length >= 1, st.anchorPoints[0]);
  check('关键点 keyPoints（新）', st.keyPoints.length >= 2, `${st.keyPoints.length} 项`);
  check('要求观察的量 observations', st.observations.length >= 1, st.observations[0]);
  check('未知量 unknowns', st.unknowns.length >= 1, st.unknowns[0]);
  check('无法确定的内容 uncertain（新）', st.uncertain.length >= 1, st.uncertain[0]);
  check('假设 assumptions', st.assumptions.length >= 1, `${st.assumptions.length} 项`);
  check('置信度 confidence', st.confidence > 0 && st.confidence <= 1, `${(st.confidence * 100).toFixed(0)}%`);

  // 碰撞条件/速度（momentum fixture）+ 角速度（spin fixture）+ 约束关系（hinge joint）
  await page.evaluate(() => window.MECH.loadFixture('momentum'));
  await page.waitForTimeout(250);
  const mo = await page.evaluate(() => window.MECH.agentState());
  check('碰撞条件 given.restitution', mo.entities.some((e) => e.given.restitution != null),
    JSON.stringify(mo.entities.map((e) => e.given.restitution)));
  check('速度/初始状态 given.velocity', mo.entities.some((e) => Array.isArray(e.given.velocity)),
    JSON.stringify(mo.entities.map((e) => e.given.velocity || null)));
  await page.evaluate(() => window.MECH.loadFixture('spin'));
  await page.waitForTimeout(250);
  const sp = await page.evaluate(() => window.MECH.agentState());
  check('角速度 given.angvel', sp.entities.some((e) => Array.isArray(e.given.angvel)),
    JSON.stringify(sp.entities.map((e) => e.given.angvel || null)));
  await page.evaluate(() => window.MECH.loadFixture('hinge'));
  await page.waitForTimeout(250);
  const hg = await page.evaluate(() => window.MECH.agentState());
  check('约束关系 joint（hinge revolute）', hg.joint && hg.joint.type === 'revolute', JSON.stringify(hg.joint));

  // ==== B. 面板展示落点（incline fixture 渲染后 DOM 断言） ====
  await page.evaluate(() => window.MECH.loadFixture('incline'));
  await page.waitForTimeout(300);
  const ui = await page.evaluate(() => {
    const txt = (sel) => [...document.querySelectorAll(sel)].map((n) => n.textContent.trim());
    return {
      meta: txt('#parseMeta .k'),
      lists: txt('#parseLists .k'),
      badges: txt('#parseEntities .badge'),
      units: txt('#parseEntities .u'),
      entityNames: txt('#parseEntities .pe-head .nm'),
    };
  });
  check('面板: 题型+总体置信度行', ui.meta.includes('题型') && ui.meta.includes('总体置信度'), ui.meta.join('|'));
  check('面板: 目标段', ui.meta.includes('目标'));
  check('面板: 环境条件段（新）', ui.meta.includes('环境条件'));
  check('面板: 观察/固定点/关键点/未知量/无法确定/假设 六段全落点',
    ['要求观察', '固定点', '关键点', '未知量', '无法确定（需确认）', '假设'].every((t) => ui.lists.includes(t)),
    ui.lists.join('|'));
  check('面板: 实体名+单位+题给徽标', ui.entityNames.includes('小球') && ui.units.includes('kg') && ui.badges.includes('题给'),
    `units=${ui.units.join(',')} badges=${ui.badges.join(',')}`);
  // 评审可改：重力 10→9.8 记修正
  const corr = await page.evaluate(() => {
    const inp = document.querySelector('#parseMeta input[type=number]');
    const before = window.MECH.agentState().correctionCount;
    inp.value = '9.8';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return { before, after: window.MECH.agentState().correctionCount, g: window.MECH.agentState().gravity };
  });
  check('评审表单可修正（重力 10→9.8 记 correction）', corr.after === corr.before + 1 && corr.g === 9.8,
    `count ${corr.before}→${corr.after} g=${corr.g}`);
  await page.screenshot({ path: 'shots/310-parse-fields.png' });

  // ==== C. 新字段不破坏建场链路 ====
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(400);
  const built = await page.evaluate(() => window.MECH.state().count);
  check('带新字段建场成功(2 实体)', built === 2, `count=${built}`);

  // ==== D. 真实模型抽查（step-5-preview 一次文字解析；失败如实 FAIL 不 fallback） ====
  const real = await page.evaluate(async () => {
    try {
      const resp = await fetch('/api/parse-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '光滑固定斜面倾角30°、坡长2m，质量1kg的小球由静止从顶端下滑，不计空气阻力，求小球滑到斜面底端时的速度大小。' }),
      });
      const j = await resp.json();
      return { ok: resp.ok, j };
    } catch (e) { return { ok: false, err: String(e) }; }
  });
  if (real.ok && real.j && real.j.ok && real.j.parse) {
    const p = real.j.parse;
    check('真实抽查: 结构化字段存在(题型/实体/置信度)', !!p.questionType && Array.isArray(p.entities) && p.entities.length >= 1,
      `${p.questionType} entities=${p.entities.length}`);
    check('真实抽查: 新四字段键存在（值可空）',
      Array.isArray(p.anchorPoints) && Array.isArray(p.keyPoints) && typeof p.environment === 'string' && Array.isArray(p.uncertain),
      `env="${p.environment}" anchor=${p.anchorPoints.length} key=${p.keyPoints.length} unc=${p.uncertain.length}`);
    check('真实抽查: 数值对题(角度30/质量1/坡长2)',
      JSON.stringify(p.entities.map((e) => e.given)).includes('30'),
      JSON.stringify(p.entities.map((e) => e.given)).slice(0, 120));
  } else {
    check('真实抽查: API 调用成功', false, real.err || JSON.stringify(real.j).slice(0, 160));
  }
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
