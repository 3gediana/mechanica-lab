// p52-render-consistency.mjs — RP 系列（渲染-物理一致性）回归：
// T1 编辑态弹簧摆在两实体之间（不再杵在原点）  T2 编辑态绳段沿两端表面连线
// T3 贴地/带链接体无出生跳变                     T4 运行态链接端点全程贴面
// T5 两球碰撞事件视觉间隙（无幽灵碰撞）           T6 碰撞报告只含 dyn-dyn（出生落地不混入）
// T7 同场景两次重跑轨迹哈希一致（确定性）         T8 自查通道产出渲染·审计条目
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

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
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.click('#btnNew');
  await page.waitForTimeout(150);

  // ---- T1/T3 场景：地面 + 墙 + 贴地球 + 弹簧（Agent 同路径 addComponent）
  const ids = await page.evaluate(() => {
    const M = window.MECH;
    const g = M.addComponent('ground', { transform: { pos: [0, -0.05, 0] }, params: { sx: 12, sy: 0.1, sz: 12 } });
    const w = M.addComponent('box', { name: '墙', params: { sx: 0.2, sy: 1, sz: 1 }, physics: { body: 'fixed' }, transform: { pos: [-1, 0.5, 0] } });
    const b = M.addComponent('sphere', { name: '小球', params: { radius: 0.15 }, transform: { pos: [0, 0.15, 0] } });
    return { g, w, b };
  });
  const springId = await page.evaluate(({ w, b }) => window.MECH.addComponent('spring', {
    params: { stiffness: 20, restLength: 0.8, damping: 0.5 }, attach: [w, b], source: 'agent',
  }), ids);

  // T1 编辑态弹簧位置：中点 ±5cm、长度=表面距（1.06−0.259−0.15≈0.65）±2cm
  const t1 = await page.evaluate(({ springId, w, b }) => {
    const rt = window.MECH.__rt;
    const s = rt.binds.get(springId).mesh;
    const pa = rt.binds.get(w).mesh.position, pb = rt.binds.get(b).mesh.position;
    const mid = [(pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2];
    return {
      meshPos: [s.position.x, s.position.y, s.position.z], scaleY: s.scale.y,
      dist: Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z),
      offOrigin: Math.hypot(s.position.x, s.position.y, s.position.z),
    };
  }, { springId, w: ids.w, b: ids.b });
  check('T1 编辑态弹簧摆在两实体之间（表面点中点）', t1.offOrigin > 0.2 && Math.abs(t1.meshPos[0] + 0.449) < 0.02 && Math.abs(t1.meshPos[1] - 0.307) < 0.03,
    `mesh=${t1.meshPos.map((v) => v.toFixed(3))}（期望≈[-0.449, 0.307]）`);
  check('T1b 编辑态弹簧长度=表面距', Math.abs(t1.scaleY - 0.651) < 0.02, `scaleY=${t1.scaleY.toFixed(3)} 期望≈0.651（中心距1.06−墙0.259−球0.15）`);

  // T3 出生跳变：贴地球（0.15）与带弹簧球都不得瞬移（renderAuditFacts t0）
  const t3 = await page.evaluate(() => window.MECH.__rt.renderAuditFacts(0));
  const jumped = t3.bodies.filter((x) => x.docDelta != null && Math.abs(x.docDelta - (x.spawnLift || 0)) > 0.012);
  check('T3 贴地/带链接体无出生跳变', jumped.length === 0,
    jumped.length ? jumped.map((j) => `${j.name}:${j.docDelta}`).join(',') : `docDelta max=${Math.max(...t3.bodies.filter((x) => x.docDelta != null).map((x) => x.docDelta)).toFixed(4)}`);
  const linkT0 = t3.links[0];
  check('T3b 编辑态弹簧端点贴面（facts 口径）', linkT0 && Math.max(linkT0.gapA, linkT0.gapB) < 0.006,
    `gapA=${(linkT0.gapA || -1).toFixed(4)} gapB=${(linkT0.gapB || -1).toFixed(4)}`);

  // T4 运行态端点全程贴面：步进 240 步，每 24 步取 facts
  const t4 = await page.evaluate((springId) => {
    const rt = window.MECH.__rt;
    let worst = 0, worstT = 0;
    const frames = [];
    for (let i = 0; i < 240; i++) {
      rt.stepOnce();
      if (i % 24 === 0 || i === 239) {
        const f = rt.renderAuditFacts(0);
        const l = f.links[0];
        if (l) {
          const g = Math.max(l.gapA || 0, l.gapB || 0);
          if (g > worst) { worst = g; worstT = f.t; }
        }
        let meshDelta = 0;
        for (const b of f.bodies) if (b.delta != null) meshDelta = Math.max(meshDelta, b.delta);
        frames.push({ t: f.t, worst, meshDelta });
      }
    }
    return { worst, worstT, maxMesh: Math.max(...frames.map((f) => f.meshDelta)) };
  }, springId);
  check('T4 运行态弹簧端点全程贴面 ≤6mm', t4.worst <= 0.006, `worst=${(t4.worst * 1000).toFixed(1)}mm @t=${t4.worstT.toFixed(2)}`);
  check('T4b 运行态网格与物理体零漂移 ≤2mm', t4.maxMesh <= 0.002, `max=${(t4.maxMesh * 1000).toFixed(2)}mm`);

  // ---- T2 编辑态绳段：沿两端表面连线（新场景）
  await page.click('#btnNew');
  await page.waitForTimeout(150);
  const ropeIds = await page.evaluate(() => {
    const M = window.MECH;
    const a = M.addComponent('sphere', { name: '锚球', params: { radius: 0.12 }, transform: { pos: [-0.6, 1.2, 0] }, physics: { body: 'fixed' } });
    const b = M.addComponent('sphere', { name: '摆球', params: { radius: 0.12 }, transform: { pos: [0.6, 1.2, 0] } });
    return { a, b };
  });
  const ropeId = await page.evaluate(({ a, b }) => window.MECH.addComponent('rope', {
    params: { length: 1.5 }, attach: [a, b], source: 'agent',
  }), ropeIds);
  const t2 = await page.evaluate((ropeId) => {
    const rt = window.MECH.__rt;
    const m = rt.binds.get(ropeId).mesh;
    const segs = m.children.map((s) => [s.position.x, s.position.y, s.position.z]);
    return { segs, offOrigin: Math.hypot(m.position.x, m.position.y, m.position.z) };
  }, ropeId);
  // 期望：表面连线 surfA(-0.48,1.2)→surfB(0.48,1.2)，8 段，段心 1/16 处起
  const s0x = -0.48 + 0.96 / 16, s7x = 0.48 - 0.96 / 16;
  check('T2 编辑态绳段沿表面连线', Math.abs(t2.segs[0][0] - s0x) < 0.01 && Math.abs(t2.segs[7][0] - s7x) < 0.01
    && Math.abs(t2.segs[0][1] - 1.2) < 0.01,
    `seg0=${t2.segs[0].map((v) => v.toFixed(3))} seg7=${t2.segs[7].map((v) => v.toFixed(3))}`);

  // ---- T5/T6 光滑对撞（摩擦 0，必碰）：幽灵碰撞 + 报告纯度
  await page.click('#btnNew');
  await page.waitForTimeout(150);
  const colIds = await page.evaluate(() => {
    const M = window.MECH;
    const g = M.addComponent('ground', { transform: { pos: [0, -0.05, 0] }, params: { sx: 14, sy: 0.1, sz: 14 }, physics: { friction: 0 } });
    const a = M.addComponent('sphere', { name: '甲', params: { radius: 0.15 }, transform: { pos: [0.6, 0.15, 0] }, physics: { friction: 0, restitution: 0.9 } });
    const b = M.addComponent('sphere', { name: '乙', params: { radius: 0.15 }, transform: { pos: [-0.6, 0.15, 0] }, physics: { friction: 0, restitution: 0.9, linvel: [2, 0, 0] } });
    return { g, a, b };
  });
  const t5 = await page.evaluate(() => {
    const rt = window.MECH.__rt;
    const gaps = [];
    let lastN = 0;
    let hit = false;
    for (let i = 0; i < 200; i++) {
      rt.stepOnce();
      if (rt.collisions.length > lastN) {
        const f = rt.renderAuditFacts(lastN);
        for (const ev of f.events) { gaps.push(ev.visualGap); hit = true; }
        lastN = rt.collisions.length;
      }
    }
    const reports = rt.collisionReports.map((r) => ({ t: r.t, pair: r.pair }));
    const envEvents = rt.collisions.filter((c) => c.pairKind === 'env').length;
    const dynEvents = rt.collisions.filter((c) => c.pairKind === 'dyn').length;
    return { gaps, hit, reports, envEvents, dynEvents };
  });
  check('T5 两球真实碰撞发生（dyn 事件 ≥1）', t5.dynEvents >= 1, `dyn=${t5.dynEvents} env=${t5.envEvents}`);
  check('T5b 碰撞事件视觉间隙 ≤1cm（无幽灵碰撞）', t5.gaps.every((g) => g <= 0.01),
    t5.gaps.length ? `gaps=${t5.gaps.map((g) => g.toFixed(4)).join(',')}` : '无 dyn 事件');
  check('T6 碰撞报告只含 dyn-dyn（出生落地不混入）', t5.reports.length >= 1 && t5.reports.every((r) => Array.isArray(r.pair)),
    `reports=${t5.reports.length} pair0=${JSON.stringify(t5.reports[0] && t5.reports[0].pair)}`);

  // ---- T7 确定性：同场景 reset 重跑两次，轨迹哈希一致
  const t7 = await page.evaluate(() => {
    const rt = window.MECH.__rt;
    const M = window.MECH;
    const runOnce = () => {
      M.resetSim(true);
      const pts = [];
      for (let i = 0; i < 240; i++) {
        rt.stepOnce();
        if (i % 8 === 0) for (const [id, b] of rt.binds) {
          if (!b.body || b.entity.physics.body !== 'dynamic') continue;
          const p = b.body.translation();
          pts.push(id, +p.x.toFixed(6), +p.y.toFixed(6), +p.z.toFixed(6));
        }
      }
      const s = pts.join(',');
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return h;
    };
    return { r1: runOnce(), r2: runOnce() };
  });
  check('T7 确定性（同场景两跑哈希一致）', t7.r1 === t7.r2, `h1=${t7.r1} h2=${t7.r2}`);

  // ---- T8 走 Agent 计划路径（fixture 弹簧题）：自查含渲染·审计条目
  await page.click('#btnNew');
  await page.waitForTimeout(150);
  await page.click('#tabAgent');
  const springFixture = JSON.parse(readFileSync(new URL('../fixtures/parse-spring.json', import.meta.url), 'utf-8'));
  const planLoaded = await page.evaluate((p) => window.MECH.loadParse(p), springFixture);
  check('T8 fixture 计划载入', !!planLoaded, planLoaded && planLoaded.questionType);
  await page.click('#btnApplyParse');
  await page.waitForFunction(() => {
    const s = window.MECH.agentVerifyState();
    return s && s.findings;
  }, null, { timeout: 40000 });
  const sc = await page.evaluate(() => window.MECH.agentVerifyState());
  const rpFindings = (sc.findings || []).filter((f) => String(f.cat).startsWith('渲染·'));
  const rpErrors = rpFindings.filter((f) => f.sev === 'error');
  check('T8 自查产出渲染·审计条目', rpFindings.length >= 2,
    rpFindings.map((f) => `${f.cat}[${f.sev}]`).join(' | '));
  check('T8b 弹簧场景渲染审计无 error', rpErrors.length === 0,
    rpErrors.map((e) => e.msg).join(' | ') || '全过');

  // ---- T9（MOD-505 清偿回归锚）：水平圆周绳系球——地面锚不再假阳（661cm 支撑距），
  // 绳建出+约束生效（轨道半径≈绳长）。地面/柱双锚里取地面锚（历史最重灾）。----
  await page.click('#btnNew');
  await page.waitForTimeout(150);
  const circlePlan = {
    questionType: '水平圆周运动（绳系球）', goal: '光滑水平面绳系球做匀速圆周，求周期与向心力',
    environment: '光滑水平面', gravity: 10,
    entities: [
      { type: 'ground', name: '地面', given: { position: [0, -0.05, 0], length: 12, width: 8 }, confidence: 0.9 },
      { type: 'sphere', name: '绳系球', given: { mass: 1, position: [1, 0.15, 0], radius: 0.15, velocity: [0, 0, 2] }, confidence: 0.9 },
    ],
    attaches: [{ type: 'rope', from: 0, to: 1, length: 1.0 }],
    teaching: [], unknowns: [], assumptions: [], keyPoints: [], observations: [], anchorPoints: [], uncertain: [], confidence: 0.9,
  };
  await page.evaluate((p) => window.MECH.loadParse(p), circlePlan);
  await page.click('#btnApplyParse');
  await page.waitForFunction(() => {
    const s = window.MECH.agentVerifyState();
    return s && s.findings && !window.MECH.agentBusy();
  }, null, { timeout: 60000, polling: 250 });
  const t9 = await page.evaluate(() => {
    const d = window.MECH.doc();
    const s = window.MECH.agentVerifyState();
    return {
      rope: d.entities.filter((e) => e.type === 'rope').length,
      linkErr: s.findings.filter((f) => f.sev === 'error' && String(f.cat).includes('连接件')).map((f) => f.msg),
    };
  });
  check('T9 绳建出（系地面不丢绳）', t9.rope === 1, `rope=${t9.rope}`);
  check('T9 链接端点审计零 error（地面锚假阳已修）', t9.linkErr.length === 0, t9.linkErr.join(' | ') || '全过');
  await page.evaluate(() => document.getElementById('btnPlay').click());
  await page.waitForTimeout(2400);
  const orbit = await page.evaluate(() => {
    const d = window.MECH.doc();
    const ball = d.entities.find((e) => e.type === 'sphere');
    const t = window.MECH.__rt.telemetry(ball.id);
    return +Math.hypot(t.pos[0], t.pos[2]).toFixed(3);
  });
  check('T9 绳约束生效（轨道半径≈绳长 1.0）', orbit > 0.9 && orbit < 1.1, `r=${orbit}`);

  check('无 console/page 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' ; '));
} finally {
  await browser.close();
}
const fails = results.filter((r) => !r.ok).length;
console.log(`\np52-render-consistency: ${results.length - fails}/${results.length} pass`);
process.exit(fails ? 1 : 0);
