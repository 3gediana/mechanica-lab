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
test('天体：两体开普勒用总质量 G(m1+m2)，卫星排第一不误取', () => {
  const a = 4.0, G = 1, M = 100, m = 1;
  const T = 2 * Math.PI * Math.sqrt(a * a * a / (G * (M + m)));   // AB-18：周期由系统总质量决定
  const plan = { observations: [], entities: [
    { type: 'celestial', given: { mass: m, radius: 0.15 } },      // 卫星在前（顺序陷阱）
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

// ---------- R3-B1 分派修复锚（AB-13/14/18/11/5/8） ----------
test('伽利略同落：两球同高一平抛一静止 → galileo 分支且 t=√(2h/g)', () => {
  const g = G0, h0 = 1.2, vx = 2;
  const fallH = h0 + 0.15 - 0.1 - 0.15;      // 球心起 y=1.35，落点=地面顶 0.1+球半径 0.15
  const tLand = Math.sqrt(2 * fallH / g);
  const doc = mk({ entities: [
    { id: 'a', type: 'sphere', physics: { body: 'dynamic', mass: 1, linvel: [vx, 0, 0], restitution: 0.05 }, transform: { pos: [0, h0 + 0.15, 0.3] }, params: { radius: 0.15 } },
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: 1, linvel: [0, 0, 0], restitution: 0.05 }, transform: { pos: [0, h0 + 0.15, -0.3] }, params: { radius: 0.15 } },
    { id: 'g', type: 'ground', physics: { body: 'fixed' }, transform: { pos: [0, 0, 0] }, params: { sy: 0.2 } },
  ] });
  const series = [];
  for (let t = 0; t <= tLand + 0.2; t += 1 / 60) {
    series.push({ t, pos: [vx * t, h0 + 0.15 - 0.5 * g * t * t, 0.3], speed: 1, vel: [vx, -g * t, 0] });
  }
  const r = explainRun({ observations: [] }, doc, series);
  assert.equal(r.kind, 'galileo');
  assert.ok(Math.abs(r.theoretical.tLand - tLand) < 1e-9);
  assert.ok(r.pass, `err=${r.errPct && r.errPct.toFixed(2)}`);
});

test('子弹打木块：球+块 e≈0 → inelastic 分支共速 v′=mv/(m+M)', () => {
  const m = 0.05, M2 = 1, u = 15;
  const vC = m * u / (m + M2);
  const doc = mk({ entities: [
    { id: 'p', type: 'sphere', physics: { body: 'dynamic', mass: m, linvel: [u, 0, 0], restitution: 0 }, transform: { pos: [0, 0.5, 0] }, params: { radius: 0.03 } },
    { id: 'w', type: 'box', physics: { body: 'dynamic', mass: M2, linvel: [0, 0, 0], restitution: 0 }, transform: { pos: [2, 0.5, 0] }, params: { sx: 0.4, sy: 0.3, sz: 0.3 } },
    { id: 'g', type: 'ground', physics: { body: 'fixed' }, transform: { pos: [0, 0, 0] }, params: { sy: 0.2 } },
  ] });
  const reports = [{ t: 0.5, pBefore: [m * u, 0, 0], keBefore: 0.5 * m * u * u, pAfter: [m * u, 0, 0], keAfter: 0.5 * (m + M2) * vC * vC,
    preVels: { p: [u, 0, 0], w: [0, 0, 0] }, postVels: { p: [vC, 0, 0], w: [vC, 0, 0] } }];
  const r = explainRun({ observations: [] }, doc, [], reports);
  assert.equal(r.kind, 'inelastic');
  assert.ok(Math.abs(r.theoretical.vCommon - vC) < 1e-9);
  assert.ok(r.pass, `err=${r.errPct && r.errPct.toFixed(2)}`);
});

test('一维对撞：理论用 preVels 真实碰前速度（静止释放后碰，文档初速 0）', () => {
  const m1 = 2, m2 = 1, u1 = 1.5, u2 = 0;   // u1 来自碰前瞬间（摆落后撞击），文档 linvel=0
  const e = 0.4;
  const v1t = (m1 * u1 + m2 * u2 + e * m2 * (u2 - u1)) / (m1 + m2);
  const doc = mk({ entities: [
    { id: 'a', type: 'sphere', physics: { body: 'dynamic', mass: m1, linvel: [0, 0, 0], restitution: 0 }, transform: { pos: [0, 0.15, 0] }, params: { radius: 0.15 } },
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: m2, linvel: [0, 0, 0], restitution: 0.8 }, transform: { pos: [1.6, 0.15, 0] }, params: { radius: 0.15 } },
  ] });
  const reports = [{ t: 1, pBefore: [m1 * u1, 0, 0], keBefore: 0, pAfter: [m1 * u1, 0, 0], keAfter: 0,
    preVels: { a: [u1, 0, 0], b: [u2, 0, 0] }, postVels: { a: [v1t, 0, 0], b: [(m1 * u1 - m1 * v1t) / m2, 0, 0] } }];
  const r = explainRun({ observations: [] }, doc, [], reports);
  assert.equal(r.kind, 'momentum-1d');
  assert.ok(Math.abs(r.pairs[0].vTheory - v1t) < 1e-9, `theory=${r.pairs[0].vTheory} 期望=${v1t}（若用文档初速 0 会得 0）`);
});

test('二维斜碰：单球撞地的报告不得入选（双变过滤）', () => {
  const doc = mk({ entities: [
    { id: 'a', type: 'sphere', physics: { body: 'dynamic', mass: 1, linvel: [2, 0, 0], restitution: 0.05 }, transform: { pos: [0, 2, 0.3] }, params: { radius: 0.15 } },
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: 1, linvel: [0, 0, 0], restitution: 0.05 }, transform: { pos: [1, 2, -0.3] }, params: { radius: 0.15 } },
    { id: 'g', type: 'ground', physics: { body: 'fixed' }, transform: { pos: [0, 0, 0] }, params: { sy: 0.2 } },
  ] });
  // 只有球 a 撞地减速（b 不动）——此前会被 momentum2D 当成「斜碰」输出误导性通过
  const reports = [{ t: 0.64, pBefore: [2, 0, 0], keBefore: 2, pAfter: [1.9, 0, 0], keAfter: 1.8,
    preVels: { a: [2, -6, 0], b: [0, 0, 0] }, postVels: { a: [1.9, 0.1, 0], b: [0, 0, 0] } }];
  const g0 = G0, fallH = 2 - 0.1 - 0.15;
  const series = [];
  for (let t = 0; t <= Math.sqrt(2 * fallH / g0) + 0.1; t += 1 / 60) {
    series.push({ t, pos: [2 * t, 2 - 0.5 * g0 * t * t, 0.3], speed: 1, vel: [2, -g0 * t, 0] });
  }
  const r = explainRun({ observations: [] }, doc, series, reports);
  assert.equal(r.kind, 'galileo');   // 双变过滤后落回 galileo 分支（两球同高一平抛一静止）
});

test('竖直弹簧振子：峰检测沿主振动轴（y）而非 x（AB-5）', () => {
  const m = 1, k = 20, T = 2 * Math.PI * Math.sqrt(m / k);
  const doc = mk({ entities: [
    { id: 'a', type: 'box', physics: { body: 'fixed' }, transform: { pos: [0, 3, 0] }, params: { sx: 0.3, sy: 0.3, sz: 0.3 } },
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: m, linvel: [0, 0, 0], restitution: 0 }, transform: { pos: [0, 2, 0] }, params: { radius: 0.15 } },
    { id: 's', type: 'spring', params: { stiffness: k, restLength: 0.8, damping: 0 }, attach: ['a', 'b'] },
  ] });
  const series = [];
  const A = 0.3, y0 = 2.0;
  for (let t = 0; t <= 3 * T; t += T / 60) {
    series.push({ t, pos: [0, y0 + A * Math.cos(Math.sqrt(k / m) * t), 0], speed: 1, vel: [0, 0, 0] });
  }
  const r = explainRun({ observations: [] }, doc, series);
  assert.equal(r.kind, 'spring');
  assert.ok(r.measured.period && Math.abs(r.measured.period - T) / T < 0.05, `T=${r.measured.period} 期望≈${T.toFixed(3)}`);
});
