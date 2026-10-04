// explain.test.mjs — 运行解释器纯函数单测（AG-51）：合成轨迹/碰撞报告验证 8 分支理论公式。
// 每个分支的实测数据由闭式解生成，偏差应 < 判定阈值——公式或合成规则回归会立刻爆红。
// 运行：node --test test/unit/explain.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainRun } from '../../src/engine/explain.js';

const G0 = 9.81;
const mk = (over = {}) => Object.assign({
  entities: [], gravity: -G0, G: 6.674e-11, kind: '',
}, over);

// ---------- 抛体：闭式抛物线轨迹 ----------
test('抛体：理论 vs 合成实测 射程/高度 一致', () => {
  const vx = 4, vy = 3, h0 = 0.6, g = G0;
  const tFlight = (vy + Math.sqrt(vy * vy + 2 * g * h0)) / g;
  const doc = mk({
    entities: [
      { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: 1, linvel: [vx, vy, 0], restitution: 0.1 }, transform: { pos: [0, h0, 0] }, params: { radius: 0.15 } },
      { id: 'g', type: 'ground', physics: { body: 'fixed' }, params: { sy: 0.1 } },
    ],
  });
  const series = [];
  for (let t = 0; t <= tFlight + 0.3; t += 1 / 60) {
    const x = vx * t, y = h0 + vy * t - 0.5 * g * t * t;
    series.push({ t, pos: [x, y, 0], speed: Math.hypot(vx, vy - g * t), vel: [vx, vy - g * t, 0] });
  }
  const r = explainRun({ observations: ['射程'] }, doc, series);
  assert.equal(r.kind, 'projectile');
  const Htheory = h0 + vy * vy / (2 * g);
  assert.ok(Math.abs(r.theoretical.maxHeight - Htheory) < 1e-9);
  assert.ok(Math.abs(r.theoretical.range - vx * tFlight) < 1e-9);
  assert.ok(r.errPct < 8, `errPct=${r.errPct}`);
  assert.equal(r.pass, true);
});

// ---------- 一维对撞：恢复系数合成 = 平均（AG-2 回归锚） ----------
test('一维对撞：e=平均（一侧 0 一侧 0.8 → e=0.4）理论自洽', () => {
  const m1 = 2, m2 = 1, u1 = 1.5, u2 = 0;
  const doc = mk({
    entities: [
      { id: 'b1', type: 'sphere', physics: { body: 'dynamic', mass: m1, linvel: [u1, 0, 0], restitution: 0 }, transform: { pos: [-1.6, 0.15, 0] }, params: {} },
      { id: 'b2', type: 'sphere', physics: { body: 'dynamic', mass: m2, linvel: [u2, 0, 0], restitution: 0.8 }, transform: { pos: [1.6, 0.15, 0] }, params: {} },
    ],
  });
  const e = 0.4;   // Rapier 平均：(0 + 0.8)/2（node 实测引擎行为）
  const M = m1 + m2, p0 = m1 * u1 + m2 * u2;
  const v1 = (p0 + e * m2 * (u2 - u1)) / M, v2 = (p0 + e * m1 * (u1 - u2)) / M;
  const reports = [{
    t: 1.0, pBefore: [p0, 0, 0], pAfter: [p0, 0, 0],
    keBefore: 0.5 * m1 * u1 * u1, keAfter: 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2,
    postVels: { b1: [v1, 0, 0], b2: [v2, 0, 0] },
  }];
  const r = explainRun({ observations: ['碰后速度'] }, doc, [], reports);
  assert.equal(r.kind, 'momentum-1d');
  assert.ok(Math.abs(r.e - 0.4) < 1e-9, `e=${r.e}（应为平均 0.4，非 0）`);
  assert.ok(r.pairs.every((p) => p.errPct < 1), JSON.stringify(r.pairs));
  assert.equal(r.pass, true);
});

// ---------- 复摆：周期公式含场景重力（AG-3 回归锚：月球 g 也对） ----------
function hingeDoc(g) {
  return mk({
    gravity: -g,
    entities: [
      { id: 'a', type: 'box', physics: { body: 'fixed' }, joints: [{ type: 'revolute', target: 'r', axis: [0, 0, 1] }], params: {} },
      { id: 'r', type: 'box', physics: { body: 'dynamic' }, params: { sx: 1.0, sy: 0.06, sz: 0.06 } },
    ],
  });
}
function hingeSeries(T, dur = 5.5, amp = 0.4) {
  const out = [];
  for (let t = 0; t <= dur; t += 1 / 60) {
    const rotz = amp * Math.cos(2 * Math.PI * t / T);
    out.push({ t, pos: [0, 0, 0], speed: 0, vel: [0, 0, 0], rotz });
  }
  return out;
}
test('复摆（地球 g）：T=2π√(2L/3g) 自洽', () => {
  const T = 2 * Math.PI * Math.sqrt(2 / (3 * G0));
  const r = explainRun({ observations: [] }, hingeDoc(G0), hingeSeries(T));
  assert.equal(r.kind, 'hinge');
  assert.ok(Math.abs(r.theoretical.period - T) < 1e-9);
  assert.equal(r.pass, true, `Tmeas=${r.measured.period} err=${r.errPct}`);
});
test('复摆（月球 g=1.62）：不得沿用 9.81', () => {
  const g = 1.62, T = 2 * Math.PI * Math.sqrt(2 / (3 * g));
  const r = explainRun({ observations: [] }, hingeDoc(g), hingeSeries(T, 8.5));   // 慢摆需更长窗口覆盖 ≥2 个上穿
  assert.equal(r.kind, 'hinge');
  assert.ok(Math.abs(r.theoretical.period - T) < 1e-9, `理论用了错误 g: ${r.theoretical.period} vs ${T}`);
  assert.equal(r.pass, true, `err=${r.errPct}`);
});

// ---------- 弹簧振子：T=2π√(m/k) ----------
test('弹簧振子：峰值间隔法测周期', () => {
  const m = 1, k = 20, T = 2 * Math.PI * Math.sqrt(m / k);
  const doc = mk({
    entities: [
      { id: 's', type: 'spring', params: { stiffness: k, restLength: 0.8, damping: 0 }, physics: { body: 'fixed', mass: 0 } },
      { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: m, linvel: [0, 0, 0] } },
    ],
  });
  const series = [];
  const x0 = 1.4;
  for (let t = 0; t <= 6.5; t += 1 / 60) {
    const x = x0 - 0.4 * Math.cos(2 * Math.PI * t / T);   // 围绕平衡位简谐
    series.push({ t, pos: [x, 0, 0], speed: 0, vel: [0, 0, 0] });
  }
  const r = explainRun({ observations: [] }, doc, series);
  assert.equal(r.kind, 'spring');
  assert.ok(Math.abs(r.theoretical.period - T) < 1e-9);
  assert.equal(r.pass, true, `Tmeas=${r.measured.period} err=${r.errPct}`);
});

// ---------- 天体：中心质量取最大者而非输出顺序（AG-5 回归锚） ----------
test('天体：卫星排第一时中心质量仍取 100', () => {
  const a = 4.0, G = 1, M = 100;
  const T = 2 * Math.PI * Math.sqrt(a * a * a / (G * M));
  const plan = { observations: [], entities: [
    { type: 'celestial', given: { mass: 1, radius: 0.15 } },      // 卫星在前（顺序陷阱）
    { type: 'celestial', given: { mass: M } },
  ] };
  const astro = { G, E: -12.5, KE: 12.5, PE: -25, Lz: 20, ecc: 0.01, period: T * 0.999, rmin: 3.99, rmax: 4.01, driftE: 0.01, driftL: 0.01, simT: 12 };
  const doc = mk({ entities: [
    { id: 's1', type: 'celestial', physics: { body: 'dynamic', mass: 1, gravitating: true } },
    { id: 's2', type: 'celestial', physics: { body: 'dynamic', mass: M, gravitating: true } },
  ] });
  const r = explainRun(plan, doc, [], [], astro);
  assert.equal(r.kind, 'astro');
  assert.ok(Math.abs(r.theoretical.period - T) < 1e-9, `若按 entities[0] 取质量会得 ${r.theoretical.period}`);
  assert.equal(r.pass, true);
});

// ---------- 阿特伍德：a=(m1−m2)g/(m1+m2) 带场景重力（AG-3/4 锚） ----------
test('阿特伍德（月球 g）：理论带 g=1.62', () => {
  const g = 1.62, m1 = 2, m2 = 1;
  const aT = (m1 - m2) * g / (m1 + m2);
  const r = explainRun({ observations: [] }, mk(), [], [], null, null, { m1, m2, aMeasured: +aT.toFixed(4), g, simT: 2 });
  assert.equal(r.kind, 'atwood');
  assert.ok(Math.abs(r.theoretical.a - aT) < 1e-9);
  assert.equal(r.pass, true);
});

// ---------- 不支持题型：诚实降级 ----------
test('空场景：不支持题型降级而非编造', () => {
  const r = explainRun({ observations: [] }, mk(), []);
  assert.equal(r.supported, false);
  assert.ok(r.reason.length > 0);
});
