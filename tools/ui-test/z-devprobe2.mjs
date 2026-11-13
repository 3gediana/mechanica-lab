// z-devprobe2.mjs — 干净场景复核：每个场景前 #btnNew 清场，id 用 addComponent 返回值。
// 验证：F1 编辑态链接位置 / F3 出生跳变 / F5 贴地渗透 / F6 半埋冻结 / F7 端点锚体心 / 弹簧拉球下陷
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
await page.click('#btnNew');
await page.waitForTimeout(150);

const report = { errors, boot: await page.evaluate(() => window.MECH.entities().length), scenarios: {} };

// 场景 A：贴地球静止（干净）——F3 出生跳变 + F5 渗透
{
  const s = {};
  const gid = await page.evaluate(() => window.MECH.addComponent('ground', { transform: { pos: [0, -0.05, 0] }, params: { sx: 14, sy: 0.1, sz: 14 } }));
  const bid = await page.evaluate(() => window.MECH.addComponent('sphere', { name: '贴地球', params: { radius: 0.15 }, transform: { pos: [0, 0.15, 0] } }));
  s.trace = await page.evaluate(({ bid, N }) => {
    const rt = window.MECH.__rt;
    const b = rt.binds.get(bid);
    const rows = [];
    for (let i = 0; i < N; i++) {
      rt.stepOnce();
      if (i < 6 || i % 12 === 0) {
        const p = b.body.translation();
        rows.push({ i, y: +p.y.toFixed(5), meshY: +b.mesh.position.y.toFixed(5) });
      }
    }
    return rows;
  }, { bid, N: 240 });
  s.restHeight = s.trace[s.trace.length - 1].y;
  s.penetrationCm = +((0.15 - s.restHeight) * 100).toFixed(2);
  report.scenarios.restClean = s;
}

// 场景 B：弹簧墙-球（干净）——F1/F7/弹簧拉球
{
  const s = {};
  const ids = await page.evaluate(() => {
    const M = window.MECH;
    const g = M.addComponent('ground', { transform: { pos: [0, -0.05, 0] }, params: { sx: 14, sy: 0.1, sz: 14 } });
    const w = M.addComponent('box', { name: '墙', params: { sx: 0.2, sy: 1, sz: 1 }, physics: { body: 'fixed' }, transform: { pos: [-1, 0.5, 0] } });
    const b = M.addComponent('sphere', { name: '小球', params: { radius: 0.15 }, transform: { pos: [0, 0.15, 0] } });
    return { g, w, b };
  });
  const springId = await page.evaluate(({ w, b }) => window.MECH.addComponent('spring', {
    params: { stiffness: 20, restLength: 0.8, damping: 0.5 }, attach: [w, b], source: 'agent',
  }), ids);
  s.edit = await page.evaluate((springId) => {
    const rt = window.MECH.__rt;
    const sb = rt.binds.get(springId);
    return { meshPos: [sb.mesh.position.x, sb.mesh.position.y, sb.mesh.position.z], scaleY: sb.mesh.scale.y };
  }, springId);
  s.run = await page.evaluate(({ springId, ballId, N }) => {
    const rt = window.MECH.__rt;
    const sb = rt.binds.get(springId), bb = rt.binds.get(ballId);
    const rows = [];
    for (let i = 0; i < N; i++) {
      rt.stepOnce();
      if (i === 0 || i === 1 || i % 40 === 0 || i === N - 1) {
        const p = bb.body.translation();
        rows.push({ i, ballX: +p.x.toFixed(4), ballY: +p.y.toFixed(4), springMid: [+(sb.mesh.position.x).toFixed(4), +(sb.mesh.position.y).toFixed(4)], springLen: +sb.mesh.scale.y.toFixed(4) });
      }
    }
    return rows;
  }, { springId, ballId: ids.b, N: 480 });
  report.scenarios.springClean = s;
}

// 场景 C：两球对撞（干净）——F8 碰撞事件内容 + 撞击时视觉间隙
{
  const s = {};
  const ids = await page.evaluate(() => {
    const M = window.MECH;
    const g = M.addComponent('ground', { transform: { pos: [0, -0.05, 0] }, params: { sx: 14, sy: 0.1, sz: 14 } });
    const a = M.addComponent('sphere', { name: '甲', params: { radius: 0.15 }, transform: { pos: [0.6, 0.15, 0] } });
    const b = M.addComponent('sphere', { name: '乙', params: { radius: 0.15 }, transform: { pos: [-0.9, 0.15, 0] }, physics: { linvel: [2, 0, 0] } });
    return { g, a, b };
  });
  s.trace = await page.evaluate(({ a, b, N }) => {
    const rt = window.MECH.__rt;
    const ba = rt.binds.get(a), bb = rt.binds.get(b);
    const rows = [];
    const evts = [];
    for (let i = 0; i < N; i++) {
      const n0 = rt.collisions.length;
      rt.stepOnce();
      const pa = ba.body.translation(), pb = bb.body.translation();
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
      if (rt.collisions.length > n0) evts.push({ i, t: +rt.simT.toFixed(3), d: +d.toFixed(4), gap: +(d - 0.3).toFixed(4) });
      if (i % 12 === 0 || i < 4) rows.push({ i, d: +d.toFixed(4), vA: +Math.hypot(ba.body.linvel().x, ba.body.linvel().y, ba.body.linvel().z).toFixed(3), vB: +Math.hypot(bb.body.linvel().x, bb.body.linvel().y, bb.body.linvel().z).toFixed(3) });
    }
    return { rows, evts };
  }, { ...ids, N: 180 });
  report.scenarios.headonClean = s;
}

// 场景 D：绳两球（干净）——编辑态绳段位置 + 运行态端点
{
  const s = {};
  const ids = await page.evaluate(() => {
    const M = window.MECH;
    const g = M.addComponent('ground', { transform: { pos: [0, -0.05, 0] }, params: { sx: 14, sy: 0.1, sz: 14 } });
    const a = M.addComponent('sphere', { name: '锚球', params: { radius: 0.12 }, transform: { pos: [-0.6, 1.2, 0] }, physics: { body: 'fixed' } });
    const b = M.addComponent('sphere', { name: '摆球', params: { radius: 0.12 }, transform: { pos: [0.6, 1.2, 0] } });
    return { g, a, b };
  });
  const ropeId = await page.evaluate(({ a, b }) => window.MECH.addComponent('rope', {
    params: { length: 1.5 }, attach: [a, b], source: 'agent',
  }), ids);
  s.editSegs = await page.evaluate((ropeId) => {
    const sb = window.MECH.__rt.binds.get(ropeId);
    return sb.mesh.children.map((seg) => [+seg.position.x.toFixed(3), +seg.position.y.toFixed(3), +seg.position.z.toFixed(3)]);
  }, ropeId);
  s.runSegs = await page.evaluate(({ ropeId, N }) => {
    const rt = window.MECH.__rt;
    for (let i = 0; i < N; i++) rt.stepOnce();
    const sb = rt.binds.get(ropeId);
    const segs = sb.mesh.children.map((seg) => ([+seg.position.x.toFixed(3), +seg.position.y.toFixed(3), +seg.position.z.toFixed(3)]));
    const [ia, ib] = sb.entity.attach;
    const pa = rt.binds.get(ia).mesh.position, pb = rt.binds.get(ib).mesh.position;
    return { segs, a: [pa.x, pa.y, pa.z], b: [pb.x, pb.y, pb.z] };
  }, { ropeId, N: 120 });
  report.scenarios.ropeClean = s;
}

// 场景 E：半埋 3cm 球（浅埋）——F6 浅埋是否也冻结
{
  const s = {};
  const ids = await page.evaluate(() => {
    const M = window.MECH;
    const g = M.addComponent('ground', { transform: { pos: [0, -0.05, 0] }, params: { sx: 14, sy: 0.1, sz: 14 } });
    const b = M.addComponent('sphere', { name: '浅埋球', params: { radius: 0.15 }, transform: { pos: [0, 0.12, 0] } });
    return { g, b };
  });
  s.trace = await page.evaluate(({ b, N }) => {
    const rt = window.MECH.__rt;
    const bb = rt.binds.get(b);
    const rows = [];
    for (let i = 0; i < N; i++) {
      rt.stepOnce();
      if (i < 6 || i % 24 === 0) rows.push({ i, y: +bb.body.translation().y.toFixed(5) });
    }
    return rows;
  }, { b: ids.b, N: 480 });
  report.scenarios.shallowBuried = s;
}

await browser.close();
console.log(JSON.stringify(report, null, 1));
