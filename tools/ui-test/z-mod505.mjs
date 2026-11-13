// z-mod505.mjs — B4 MOD-505 复现：水平圆周绳系球。两种锚（固定柱 / 地面）× 建场链路，
// 断言：绳建出（doc 有 rope 实体 + 渲染有绳网格）+ 柱不被嵌入误判（RP-FIX 后应绿）+
// 运行轨迹半径≈绳长（约束生效）。
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const mkPlan = (anchorType) => ({
  questionType: '水平圆周运动（绳系球）', goal: '光滑水平面绳系球做匀速圆周，求周期与向心力',
  environment: '光滑水平面',
  gravity: 10,
  entities: anchorType === 'pillar'
    ? [
        { type: 'box', name: '固定柱', given: { position: [0, 0.4, 0], length: 0.2, width: 0.2, height: 0.8, fixed: 1 }, confidence: 0.9 },
        { type: 'sphere', name: '绳系球', given: { mass: 1, position: [1, 0.15, 0], radius: 0.15, velocity: [0, 0, 2] }, confidence: 0.9 },
        { type: 'ground', given: { position: [0, -0.05, 0], length: 12, width: 8 }, confidence: 0.9 },
      ]
    : [
        { type: 'ground', name: '地面', given: { position: [0, -0.05, 0], length: 12, width: 8 }, confidence: 0.9 },
        { type: 'sphere', name: '绳系球', given: { mass: 1, position: [1, 0.15, 0], radius: 0.15, velocity: [0, 0, 2] }, confidence: 0.9 },
      ],
  attaches: [{ type: 'rope', from: 0, to: 1, length: 1.0 }],
  teaching: [{ moment: 'end', title: '匀速圆周', formula: 'F=mv²/r', note: '绳张力提供向心力' }],
  unknowns: ['周期 T', '向心力 F'], assumptions: ['光滑水平面'], keyPoints: [], observations: [], anchorPoints: [], uncertain: [], confidence: 0.9,
});

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 820 } })).newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

for (const anchor of ['pillar', 'ground']) {
  await page.evaluate(() => document.getElementById('btnNew').click());
  const plan = mkPlan(anchor);
  await page.evaluate((p) => window.MECH.loadParse(p), plan);
  await page.evaluate(() => document.getElementById('btnApplyParse').click());
  // 等自查收敛
  const st = await page.waitForFunction(() => {
    const s = window.MECH.agentVerifyState();
    return (!window.MECH.agentBusy() && s && s.findings) ? s : null;
  }, null, { timeout: 60000, polling: 250 }).then((r) => r.jsonValue());
  const info = await page.evaluate(() => {
    const d = window.MECH.doc();
    return {
      ents: d.entities.map((e) => `${e.type}${e.physics && e.physics.body === 'dynamic' ? '*' : ''}`),
      ropes: d.entities.filter((e) => e.type === 'rope').length,
      ropeAttach: d.entities.filter((e) => e.type === 'rope').map((e) => e.attach),
      embedErr: window.MECH.agentVerifyState().findings.filter((f) => f.sev === 'error').map((f) => `${f.cat}:${f.msg.slice(0, 50)}`),
    };
  });
  console.log(`== ${anchor} ==`, JSON.stringify(info, null, 1));
  // 运行 2s 看约束：球心到柱(0,·,0) 距离应≈1（绳长）
  await page.evaluate(() => document.getElementById('btnPlay').click());
  await page.waitForTimeout(2500);
  const orbit = await page.evaluate(() => {
    const d = window.MECH.doc();
    const ball = d.entities.find((e) => e.type === 'sphere');
    const t = window.MECH.__rt.telemetry(ball.id);
    return { pos: t.pos.map((x) => +x.toFixed(3)), r: +Math.hypot(t.pos[0], t.pos[2]).toFixed(3), simT: window.MECH.__rt.simT };
  });
  console.log(`   orbit: r=${orbit.r} (期望≈1.0) simT=${orbit.simT}`);
}
console.log('console errors:', errors.length ? errors.slice(0, 4) : '无');
await browser.close();
