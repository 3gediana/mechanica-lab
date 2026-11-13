// z-devprobe.mjs — 开发诊断（非回归）：量化「前端实际呈现 vs 物理引擎计算」偏差
// 场景族：弹簧/绳（编辑态+运行态）、两球碰撞（幽灵碰撞）、半埋球（出生弹飞）、确定性对比。
// 输出纯 JSON 事实，不做判定——判定标准由人/后续 audit 模块定。
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
const r3 = (v) => +(v ?? 0).toFixed?.(4) ?? v;

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

// ---------- 页内探针原语 ----------
await page.evaluate(() => {
  // 四元数旋转向量（纯数学，页内无 THREE 全局）
  const qv2 = (q, v) => {
    const { x, y, z, w } = q;
    const [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * tx - y * ty)];
  };
  window.__probe = {
    // bind 事实：网格位姿（链接网格是 scene 直子，mesh.position 即世界位）+ 物理体位姿
    bindFacts() {
      const rt = window.MECH.__rt;
      const out = [];
      for (const [id, b] of rt.binds) {
        const m = b.mesh;
        out.push({
          id, type: b.entity.type, name: b.entity.name,
          mesh: { pos: [m.position.x, m.position.y, m.position.z], scale: [m.scale.x, m.scale.y, m.scale.z], visible: m.visible },
          body: b.body ? { pos: (() => { const p = b.body.translation(); return [p.x, p.y, p.z]; })() } : null,
          attach: b.entity.attach || null,
          params: b.entity.params,
        });
      }
      return out;
    },
    // 弹簧渲染端点（世界系）：线圈中心=mesh.pos，长轴=y 缩放，端点=±(quat·(0,scale.y/2,0))
    linkEndpoints(id) {
      const rt = window.MECH.__rt;
      const b = rt.binds.get(id);
      if (!b || !b.mesh) return null;
      const h = qv2(b.mesh.quaternion, [0, b.mesh.scale.y / 2, 0]);
      const c = b.mesh.position;
      return { a: [c.x - h[0], c.y - h[1], c.z - h[2]], b: [c.x + h[0], c.y + h[1], c.z + h[2]] };
    },
    // 绳段实际摆放（段是 mesh.children，父组无变换 → 子 position 即世界位）
    ropeSegs(id) {
      const rt = window.MECH.__rt;
      const b = rt.binds.get(id);
      if (!b || !b.mesh) return null;
      return b.mesh.children.map((seg) => ({ pos: [seg.position.x, seg.position.y, seg.position.z], len: seg.scale.y }));
    },
    stepN(n) {
      const rt = window.MECH.__rt;
      for (let i = 0; i < n; i++) rt.stepOnce();
      return rt.simT;
    },
    qv: qv2,
  };
});

const bindFacts = () => page.evaluate(() => window.__probe.bindFacts());
const linkEndpoints = (id) => page.evaluate((id) => window.__probe.linkEndpoints(id), id);
const stepN = (n) => page.evaluate((n) => window.__probe.stepN(n), n);

const report = { errors, scenarios: {} };
const V = (a) => a.map((x) => +x.toFixed(4));

// ============================================================
// 场景 1：弹簧连接（墙-球），Agent 路径建场
// ============================================================
{
  const s = {};
  await page.evaluate(() => { window.MECH.__vp; });
  // 新建空场景 + 地面 + 墙 + 球 + 弹簧（走 addComponent = Agent/解析同路径）
  await page.evaluate(() => {
    const M = window.MECH;
    M.addComponent('ground', { transform: { pos: [0, -0.05, 0] }, params: { sx: 12, sy: 0.1, sz: 12 } });
    M.addComponent('box', { name: '墙', params: { sx: 0.2, sy: 1, sz: 1 }, physics: { body: 'fixed' }, transform: { pos: [-1, 0.5, 0] } });
    M.addComponent('sphere', { name: '小球', params: { radius: 0.15 }, transform: { pos: [0, 0.15, 0] } });
  });
  const wallId = (await page.evaluate(() => window.MECH.entities().find((e) => e.name === '墙')?.id));
  const ballId = (await page.evaluate(() => window.MECH.entities().find((e) => e.name === '小球')?.id));
  await page.evaluate(([w, b]) => window.MECH.addComponent('spring', {
    params: { stiffness: 20, restLength: 0.8, damping: 0.5 },
    attach: [w, b], source: 'agent',
  }), [wallId, ballId]);
  const springId = (await page.evaluate(() => window.MECH.entities().find((e) => e.type === 'spring')?.id));

  // —— 编辑态事实
  const edit = await bindFacts();
  const springEdit = edit.find((e) => e.id === springId);
  s.editState = {
    springMesh: springEdit.mesh,
    springAtDocPos: springEdit.mesh.pos,
    wallPos: edit.find((e) => e.id === wallId).mesh.pos,
    ballPos: edit.find((e) => e.id === ballId).mesh.pos,
    note: '编辑态弹簧网格位置——若为 [0,0,0] 即编辑态从未同步（_syncLinks 只在 stepOnce 里跑）',
  };
  const springWorldEndpoints = await linkEndpoints(springId);
  s.editState.springWorldEndpoints = springWorldEndpoints;

  // —— 运行态：步进 240 步（2s），逐步采样 网格vs体 + 弹簧端点
  const runSamples = await page.evaluate(({ springId, ballId, wallId, N }) => {
    const rt = window.MECH.__rt;
    const pts = [];
    const springBind = rt.binds.get(springId);
    const attach = springBind ? springBind.entity.attach : null;
    for (let i = 0; i < N; i++) {
      rt.stepOnce();
      if (i % 20 !== 0 && i !== 0 && i !== 1) continue;   // 首两步细看 + 每 20 步
      const bb = rt.binds.get(ballId), bw = rt.binds.get(wallId);
      const sb = rt.binds.get(springId);
      const m2 = sb.mesh.position;
      const h = window.__probe.qv(sb.mesh.quaternion, [0, sb.mesh.scale.y / 2, 0]);
      pts.push({
        i,
        ballMesh: [bb.mesh.position.x, bb.mesh.position.y, bb.mesh.position.z],
        ballBody: (() => { const p = bb.body.translation(); return [p.x, p.y, p.z]; })(),
        springMeshPos: [m2.x, m2.y, m2.z], springScaleY: sb.mesh.scale.y,
        springEnds: {
          a: [m2.x - h[0], m2.y - h[1], m2.z - h[2]],
          b: [m2.x + h[0], m2.y + h[1], m2.z + h[2]],
        },
        wallMesh: [bw.mesh.position.x, bw.mesh.position.y, bw.mesh.position.z],
      });
    }
    return { attach, pts };
  }, { springId, ballId, wallId, N: 240 });

  s.runState = runSamples;
  // 端点间隙计算：端点到球面/墙面的距离
  const e0 = runSamples.pts[0];
  const last = runSamples.pts[runSamples.pts.length - 1];
  const gapToBallSurface = (p) => Math.hypot(p[0] - last.ballMesh[0], p[1] - last.ballMesh[1], p[2] - last.ballMesh[2]) - 0.15;
  const gapToWall = (p) => {
    // 墙 x∈[-1.1,-0.9]：端点 x 到墙面 -0.9 的距离（只看 x 向，教学简化）
    return Math.abs(p[0] - (-0.9));
  };
  s.endpointGaps = {
    note: '弹簧渲染端点与被连物体表面的间隙（负=嵌入物体内部，正=悬空）',
    lastStep: {
      ballSide: +gapToBallSurface(last.springEnds.b).toFixed(4),
      wallSide: +gapToWall(last.springEnds.a).toFixed(4),
    },
  };
  report.scenarios.spring = s;
}

// ============================================================
// 场景 2：绳连接两球（编辑态 + 运行态）
// ============================================================
{
  const s = {};
  await page.evaluate(() => {
    const M = window.MECH;
    M.addComponent('ground', { transform: { pos: [0, -0.05, 0] }, params: { sx: 12, sy: 0.1, sz: 12 } });
    M.addComponent('sphere', { name: '球A', params: { radius: 0.12 }, transform: { pos: [-0.6, 0.12, 0] }, physics: { body: 'fixed' } });
    M.addComponent('sphere', { name: '球B', params: { radius: 0.12 }, transform: { pos: [0.6, 0.12, 0] } });
  });
  const [aId, bId] = await page.evaluate(() => {
    const es = window.MECH.entities();
    return [es.find((e) => e.name === '球A').id, es.find((e) => e.name === '球B').id];
  });
  await page.evaluate(([a, b]) => window.MECH.addComponent('rope', {
    params: { length: 1.5 }, attach: [a, b], source: 'agent',
  }), [aId, bId]);
  const ropeId = (await page.evaluate(() => window.MECH.entities().find((e) => e.type === 'rope')?.id));

  const edit = await bindFacts();
  s.editState = {
    ropeMesh: edit.find((e) => e.id === ropeId).mesh,
    segs: await page.evaluate((id) => window.__probe.ropeSegs(id), ropeId),
  };
  // 运行 120 步
  s.runState = await page.evaluate(({ ropeId, N }) => {
    const rt = window.MECH.__rt;
    const sb = rt.binds.get(ropeId);
    const [ia, ib] = sb.entity.attach;
    const first = [], last = [];
    for (let i = 0; i < N; i++) {
      rt.stepOnce();
      if (i === 0 || i === N - 1) {
        const snap = sb.mesh.children.map((seg) => {
          return { pos: [seg.position.x, seg.position.y, seg.position.z], len: +seg.scale.y.toFixed(4) };
        });
        const ba = rt.binds.get(ia), bb = rt.binds.get(ib);
        (i === 0 ? first : last).push({
          segs: snap,
          a: [ba.mesh.position.x, ba.mesh.position.y, ba.mesh.position.z],
          b: [bb.mesh.position.x, bb.mesh.position.y, bb.mesh.position.z],
        });
      }
    }
    return { first: first[0], last: last[0] };
  }, { ropeId, N: 120 });
  report.scenarios.rope = s;
}

// ============================================================
// 场景 3：两球对撞（幽灵碰撞检测）——B 以 2m/s 撞向 1.2m 外的静止 A
// ============================================================
{
  const s = {};
  await page.evaluate(() => {
    const M = window.MECH;
    M.addComponent('ground', { transform: { pos: [0, -0.05, 0] }, params: { sx: 14, sy: 0.1, sz: 14 } });
    M.addComponent('sphere', { name: 'A', params: { radius: 0.15 }, transform: { pos: [0.6, 0.15, 0] } });
    M.addComponent('sphere', { name: 'B', params: { radius: 0.15 }, transform: { pos: [-0.6, 0.15, 0] }, physics: { linvel: [2, 0, 0] } });
  });
  const [aId, bId] = await page.evaluate(() => {
    const es = window.MECH.entities();
    return [es.find((e) => e.name === 'A').id, es.find((e) => e.name === 'B').id];
  });
  s.collisionTrace = await page.evaluate(({ aId, bId, N }) => {
    const rt = window.MECH.__rt;
    const evts = [];
    const track = [];
    for (let i = 0; i < N; i++) {
      rt.stepOnce();
      const ba = rt.binds.get(aId), bb = rt.binds.get(bId);
      const pa = ba.body.translation(), pb = bb.body.translation();
      const va = ba.body.linvel(), vb = bb.body.linvel();
      const meshA = ba.mesh.position, meshB = bb.mesh.position;
      if (i % 12 === 0 || i < 3) {
        track.push({
          i, t: +rt.simT.toFixed(3),
          bodyA: [pa.x, pa.y, pa.z], bodyB: [pb.x, pb.y, pb.z],
          meshA: [meshA.x, meshA.y, meshA.z], meshB: [meshB.x, meshB.y, meshB.z],
          vA: +Math.hypot(va.x, va.y, va.z).toFixed(3), vB: +Math.hypot(vb.x, vb.y, vb.z).toFixed(3),
        });
      }
    }
    // 事后：碰撞事件时刻的视觉间隙（用事件数回放不便——直接记录全部事件及其步号）
    const evs = rt.collisions.map((c) => ({ t: +c.t.toFixed(4), a: c.a, b: c.b }));
    return { track, events: evs, nCol: rt.collisions.length };
  }, { aId, bId, N: 240 });
  report.scenarios.collision = s;
}

// ============================================================
// 场景 4：碰撞事件逐帧视觉间隙（精确版）——撞前 10 步到撞后 5 步每步记录球距
// ============================================================
{
  const s = {};
  await page.evaluate(() => {
    const M = window.MECH;
    M.addComponent('ground', { transform: { pos: [0, -0.05, 0] }, params: { sx: 14, sy: 0.1, sz: 14 } });
    M.addComponent('sphere', { name: 'A2', params: { radius: 0.15 }, transform: { pos: [0.6, 0.15, 0] } });
    M.addComponent('sphere', { name: 'B2', params: { radius: 0.15 }, transform: { pos: [-0.55, 0.15, 0] }, physics: { linvel: [1.2, 0, 0] } });
  });
  s.trace = await page.evaluate((N) => {
    const rt = window.MECH.__rt;
    const es = [...rt.binds.values()].filter((b) => b.entity.name === 'A2' || b.entity.name === 'B2');
    const rows = [];
    let colAt = null;
    for (let i = 0; i < N; i++) {
      const n0 = rt.collisions.length;
      rt.stepOnce();
      const hit = rt.collisions.length > n0 && !colAt ? i : colAt;
      colAt = hit;
      const [ba, bb] = es;
      const pa = ba.body.translation(), pb = bb.body.translation();
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
      rows.push({ i, d: +d.toFixed(5), gap: +(d - 0.30).toFixed(5), hit: rt.collisions.length > n0 });
      void colAt;
    }
    return { rows: rows.filter((r) => (colAt == null ? r.i % 20 === 0 : Math.abs(r.i - colAt) <= 8 || r.i % 30 === 0)), colAt };
  }, 160);
  report.scenarios.collisionPrecise = s;
}

// ============================================================
// 场景 5：半埋球出生弹飞（agent 常见错位）——球心放 y=0.05（半径 0.15 → 埋 0.10）
// ============================================================
{
  const s = {};
  await page.evaluate(() => {
    const M = window.MECH;
    M.addComponent('ground', { transform: { pos: [0, -0.05, 0] }, params: { sx: 14, sy: 0.1, sz: 14 } });
    M.addComponent('sphere', { name: '埋球', params: { radius: 0.15 }, transform: { pos: [0, 0.05, 0] } });
  });
  s.trace = await page.evaluate((N) => {
    const rt = window.MECH.__rt;
    const b = [...rt.binds.values()].find((x) => x.entity.name === '埋球');
    const rows = [];
    for (let i = 0; i < N; i++) {
      rt.stepOnce();
      if (i % 4 === 0 || i < 6) {
        const p = b.body.translation(); const v = b.body.linvel();
        rows.push({ i, y: +p.y.toFixed(4), vy: +v.y.toFixed(4), meshY: +b.mesh.position.y.toFixed(4) });
      }
    }
    return rows;
  }, 120);
  report.scenarios.buriedBall = s;
}

// ============================================================
// 场景 6：正常贴地球的出生行为（spawnDrop=0.04 效应）——球放在 y=0.15（正确贴地）
// ============================================================
{
  const s = {};
  await page.evaluate(() => {
    const M = window.MECH;
    M.addComponent('ground', { transform: { pos: [0, -0.05, 0] }, params: { sx: 14, sy: 0.1, sz: 14 } });
    M.addComponent('sphere', { name: '贴地球', params: { radius: 0.15 }, transform: { pos: [0, 0.15, 0] } });
  });
  s.trace = await page.evaluate((N) => {
    const rt = window.MECH.__rt;
    const b = [...rt.binds.values()].find((x) => x.entity.name === '贴地球');
    const rows = [];
    for (let i = 0; i < N; i++) {
      rt.stepOnce();
      if (i < 8 || i % 10 === 0) {
        const p = b.body.translation(); const v = b.body.linvel();
        rows.push({ i, y: +p.y.toFixed(4), vy: +v.y.toFixed(4), meshY: +b.mesh.position.y.toFixed(4) });
      }
    }
    return rows;
  }, 60);
  report.scenarios.restingBallSpawn = s;
}

// ============================================================
// 场景 7：确定性——同一斜面场景 reset 后重跑两次，轨迹哈希对比
// ============================================================
{
  const s = {};
  await page.evaluate(() => {
    const M = window.MECH;
    M.addComponent('ground', { transform: { pos: [0, -0.05, 0] }, params: { sx: 14, sy: 0.1, sz: 14 } });
    M.addComponent('ramp', { params: { length: 1.6, height: 0.8, width: 0.5 }, transform: { pos: [0, 0, 0] } });
    M.addComponent('sphere', { name: '斜球', params: { radius: 0.12 }, transform: { pos: [-0.5, 0.55, 0] } });
  });
  s.hashes = await page.evaluate(() => {
    const rt = window.MECH.__rt;
    const M = window.MECH;
    const runOnce = () => {
      M.resetSim(true);
      const pts = [];
      for (let i = 0; i < 300; i++) {
        rt.stepOnce();
        if (i % 5 === 0) {
          for (const [id, b] of rt.binds) {
            if (!b.body || b.entity.physics.body !== 'dynamic') continue;
            const p = b.body.translation(), v = b.body.linvel();
            pts.push(id, +p.x.toFixed(6), +p.y.toFixed(6), +p.z.toFixed(6), +v.x.toFixed(6), +v.y.toFixed(6));
          }
        }
      }
      // 简易哈希
      let h = 0;
      const str = pts.join(',');
      for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
      return { h, n: pts.length, tail: str.slice(-120) };
    };
    return { r1: runOnce(), r2: runOnce(), r3: runOnce() };
  });
  report.scenarios.determinism = s;
}

// ============================================================
// 场景 8：编辑态 → 运行 → 重置回编辑态，链接网格回哪了
// ============================================================
{
  const s = {};
  const es = await bindFacts();
  const spring = es.find((e) => e.type === 'spring') || es.find((e) => e.type === 'rope');
  if (spring) {
    s.docPosOfLink = spring.mesh.pos;
    await page.evaluate(() => window.MECH.resetSim(true));
    const es2 = await bindFacts();
    const spring2 = es2.find((e) => e.id === spring.id);
    s.afterReset = spring2.mesh.pos;
  }
  report.scenarios.linkAfterReset = s;
}

await browser.close();
console.log(JSON.stringify(report, null, 1));
