// p50-teach-elevate.mjs — R7-A 战区教学跃迁端到端（fixture 驱动，零 API）：
// A1 拆题简报（已知量/路线分步）→ A2a 公式实时代入行 → A2b 聚光（曲线打标+力箭头闪烁）
// → A2c TTS 静默降级（无语音环境零报错）→ A2d 对比变式（切半质量/切回）→ A3 equilibrium
// 新时机 → A4 节奏分级（contact 真定格自动续播）→ A5 课堂放映（自动收尾）→ A6 六族金标。
// 用法：MECH_BASE=http://127.0.0.1:8722 node p50-teach-elevate.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const browser = await chromium.launch({ headless: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};
const consoleErrors = [];

try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 820 } })).newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('net::ERR_FAILED')) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(30000);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

  // ============ A. atwood 金标：A1 简报 → A2a 代入 → A2d 变式 → A5 放映 ============
  await page.evaluate(() => { window.MECH.perfHud(false); window.MECH.loadFixture('atwood'); });
  await page.waitForFunction(() => {
    const b = document.getElementById('btnApplyParse');
    return b && !b.disabled;
  }, null, { timeout: 15000, polling: 250 });

  // A1：简报卡上屏（已知量 chips + 解题路线含真值 a）
  const briefUi = await page.evaluate(() => {
    const card = document.querySelector('#parseMeta .brief-card');
    return { on: !!card, text: card ? card.textContent : '', brief: window.MECH.teachBrief() };
  });
  check('A1 拆题简报卡上屏', briefUi.on, briefUi.text.slice(0, 60));
  check('A1 族分类 atwood（plan 形态兜底）', briefUi.brief.family === 'atwood', String(briefUi.brief.family));
  check('A1 已知量含质量与 g', briefUi.brief.known.some((k) => k.label.includes('质量')) && briefUi.brief.known.some((k) => k.label.includes('g')), JSON.stringify(briefUi.brief.known.slice(0, 4)));
  check('A1 解题路线首步含 a 真值', !!briefUi.brief.route && briefUi.brief.route[0].detail.includes('='), briefUi.brief.route ? briefUi.brief.route[0].detail : '无路线');

  await page.evaluate(() => document.getElementById('btnApplyParse').click());
  await page.waitForFunction(() => {
    const s = window.MECH.agentVerifyState();
    return s && s.findings;
  }, null, { timeout: 40000, polling: 250 });

  // A2d：变式面板（atwood 双动态体 → 质量减半变式）
  const varPre = await page.evaluate(() => window.MECH.variantState());
  check('A2d 变式面板产出（≥1 变式）', varPre.base && varPre.list.length >= 1, JSON.stringify(varPre));
  const massPre = await page.evaluate(() => {
    const d = window.MECH.doc();
    return d.entities.filter((e) => e.physics && e.physics.body === 'dynamic').map((e) => e.physics.mass);
  });
  await page.evaluate(() => window.MECH.switchVariant(0));
  const varPost = await page.evaluate(() => ({ st: window.MECH.variantState(), masses: window.MECH.doc().entities.filter((e) => e.physics && e.physics.body === 'dynamic').map((e) => e.physics.mass) }));
  check('A2d 切换质量减半变式', varPost.st.now === 0 && varPost.masses[0] != null && Math.abs(varPost.masses[0] - massPre[0] / 2) < 1e-9, `${massPre[0]} → ${varPost.masses[0]}`);
  await page.evaluate(() => window.MECH.switchVariant(null));
  const varBack = await page.evaluate(() => window.MECH.variantState().now);
  check('A2d 切回原题', varBack === -1);

  // A4：节奏表断言（contact 定格 / release 慢放 / end 最长）
  const paces = await page.evaluate(() => ({ contact: window.MECH.teachPace('contact'), release: window.MECH.teachPace('release'), end: window.MECH.teachPace('end') }));
  check('A4 contact=定格型', paces.contact.pause === true && paces.contact.slow === 0);
  check('A4 release=慢放型', paces.release.pause === false && paces.release.slow > 0);
  check('A4 end 阅读时长最长', paces.end.hold >= 5000 && paces.end.hold > paces.release.hold);

  // A2a：release 触发的卡片带代入行（atwood 真值 a=(1.2-1)g/(1.2+1)）
  await page.evaluate(() => document.getElementById('btnPlay').click());
  await page.waitForFunction(() => window.MECH.teachState().fired >= 1, null, { timeout: 5000, polling: 150 });
  const rel = await page.evaluate(() => ({
    sub: window.MECH.teachState().items.find((t) => t.moment === 'release').sub,
    card: document.getElementById('teachCard').textContent,
  }));
  check('A2a release 代入行非空', !!rel.sub, String(rel.sub));
  check('A2a 代入行进卡片（含 m/s²）', rel.card.includes('m/s²'), rel.card.slice(0, 90));
  const aTheory = (1.2 - 1) * 10 / (1.2 + 1);   // fixture 题给 g=10
  check('A2a 代入行数值=确定性真值', rel.sub && rel.sub.includes(aTheory.toFixed(2)), `期望含 ${aTheory.toFixed(2)}`);

  // A5：课堂放映（已在运行态——放映会自动重置→重放→end 后自动收尾）
  await page.evaluate(() => document.getElementById('btnProjector').click());
  const projOn = await page.evaluate(() => window.MECH.projectorState().on);
  check('A5 放映开启', projOn === true);
  await page.waitForFunction(() => !window.MECH.projectorState().on, null, { timeout: 60000, polling: 400 });
  check('A5 放映自动收尾（end 后停录）', true);
  check('A5 全程零 console 错误（含 TTS 静默降级路径）', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' ; '));

  // ============ B. 合成对撞计划：A3 新时机 + A4 定格续播 + A2b 聚光 ============
  await page.evaluate(() => document.getElementById('btnNew').click());
  const collisionPlan = {
    questionType: '一维对撞（动量守恒）', goal: '弹性正碰求碰后速度', environment: '光滑水平面',
    entities: [
      { type: 'sphere', name: '球A', given: { mass: 2, velocity: 3, position: [-1.2, 0.16, 0], radius: 0.15, restitution: 1 }, confidence: 0.9 },
      { type: 'sphere', name: '球B', given: { mass: 1, position: [0.9, 0.16, 0], radius: 0.15, restitution: 1 }, confidence: 0.9 },
      { type: 'ground', given: { position: [0, -0.05, 0] }, confidence: 0.9 },
    ],
    attaches: [],
    teaching: [
      { moment: 'contact', title: '弹性碰撞', formula: 'm₁u₁+m₂u₂=m₁v₁+m₂v₂', note: '光滑面系统动量守恒' },
      { moment: 'equilibrium', title: '碰后趋稳', formula: '', note: '两球速度稳定下来' },
    ],
    unknowns: ['碰后速度'], assumptions: [], keyPoints: [], observations: [], anchorPoints: [], uncertain: [], confidence: 0.9,
  };
  const loaded = await page.evaluate((p) => window.MECH.loadParse(p), collisionPlan);
  check('B0 合成计划载入（新 moment 归一）', !!loaded && loaded.teaching.length === 2, loaded && loaded.teaching.map((t) => t.moment).join(','));
  await page.evaluate(() => document.getElementById('btnApplyParse').click());
  await page.waitForFunction(() => {
    const s = window.MECH.agentVerifyState();
    return s && s.findings;
  }, null, { timeout: 40000, polling: 250 });
  await page.evaluate(() => document.getElementById('btnPlay').click());
  // contact：碰撞发生 → 定格（paused=true）→ 自动续播（paused=false）
  await page.waitForFunction(() => window.MECH.teachState().items.find((t) => t.moment === 'contact' && t.fired), null, { timeout: 15000, polling: 120 });
  const frozen = await page.evaluate(() => ({ paused: window.MECH.state().paused, flash: window.MECH.__vp.forceFlashing(), marks: window.MECH.teachState().marks }));
  check('A4 contact 触发即定格', frozen.paused === true, `paused=${frozen.paused}`);
  check('A2b 力箭头聚光闪烁窗开启', frozen.flash === true);
  check('A2b 曲线面板打标 ≥1', frozen.marks >= 1, `marks=${frozen.marks}`);
  await page.waitForFunction(() => !window.MECH.state().paused, null, { timeout: 12000, polling: 200 });
  check('A4 定格后自动续播', true);
  // A3 equilibrium：换落地回弹场景（对撞球会滚走不停）——小球 1.2m 落下，回弹耗能，
  // 静止 ≥1s 且曾运动过 → equilibrium 触发（detectEquilibrium 判据的真链路）
  await page.evaluate(() => document.getElementById('btnNew').click());
  const dropPlan = {
    questionType: '自由落体落地', goal: '观察小球落地静止', environment: '地面有摩擦',
    entities: [
      { type: 'sphere', name: '落球', given: { mass: 1, position: [0, 1.2, 0], radius: 0.15, restitution: 0.2, friction: 0.6 }, confidence: 0.9 },
      { type: 'ground', given: { position: [0, -0.05, 0] }, confidence: 0.9 },
    ],
    attaches: [],
    teaching: [{ moment: 'equilibrium', title: '落地静止', formula: 'N=mg', note: '静止时支持力与重力平衡' }],
    unknowns: [], assumptions: [], keyPoints: [], observations: [], anchorPoints: [], uncertain: [], confidence: 0.9,
  };
  await page.evaluate((p) => window.MECH.loadParse(p), dropPlan);
  await page.evaluate(() => document.getElementById('btnApplyParse').click());
  await page.waitForFunction(() => {
    const s = window.MECH.agentVerifyState();
    return s && s.findings;
  }, null, { timeout: 40000, polling: 250 });
  await page.evaluate(() => document.getElementById('btnPlay').click());
  await page.waitForFunction(() => window.MECH.teachState().items.find((t) => t.moment === 'equilibrium' && t.fired), null, { timeout: 30000, polling: 300 });
  check('A3 equilibrium 新时机触发', true);
  check('B 全程零 console/page 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' ; '));

  // ============ C. A6 六族金标：fixture 全走 brief/substitution 确定性 ============
  const families = [
    ['atwood', 'atwood'], ['incline', 'incline'], ['projectile', 'projectile'],
    ['spring', 'spring'], ['pendulum', 'pendulum'], ['momentum', 'momentum'],
  ];
  for (const [fx, want] of families) {
    await page.evaluate(() => document.getElementById('btnNew').click());
    await page.evaluate((name) => window.MECH.loadFixture(name), fx);
    // loadFixture 异步渲染解析面板——等「本 fixture 的简报卡」出现再读（防串到上一题）
    await page.waitForFunction((nm) => {
      const qt = document.querySelector('#parseMeta .pmeta .v');
      const card = document.querySelector('#parseMeta .brief-card');
      return card && qt && window.MECH.teachBrief().family != null
        && window.MECH.teachBrief().known.some((k) => k.label.includes('g'));
    }, fx, { timeout: 8000, polling: 150 });
    const fam = await page.evaluate(() => window.MECH.teachBrief().family);
    check(`A6 ${fx} → ${want}`, fam === want, String(fam));
  }
} finally {
  await browser.close();
}
const fails = results.filter((r) => !r).length;
console.log(`\np50-teach-elevate: ${results.length - fails}/${results.length} pass`);
process.exit(fails ? 1 : 0);
