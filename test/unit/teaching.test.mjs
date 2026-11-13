// teaching.test.mjs — R7-A 战区纯函数单测：A1 简报 / A2a 代入行（与 explain.js 同源互证）/
// A2d 变式派生 / A3 时机检测器 / A4 节奏表。
// 同源铁律：substitutionLine 的理论数字必须与 explainRun 的 theoretical 一致——用同一
// 份 doc 交叉锁定，漂移即爆红。运行：node --test test/unit/teaching.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sceneFamily, briefFromPlan, substitutionLine, deriveVariants,
  detectTurn, detectLeaveSurface, detectEquilibrium, detectSinkFloat,
  paceFor, TEACH_PACE, narrationText,
} from '../../src/engine/teaching.js';
import { explainRun } from '../../src/engine/explain.js';

const G0 = 9.81;
const mk = (over = {}) => Object.assign({ entities: [], gravity: -G0, G: 6.674e-11 }, over);

// ---------- 场景族分类 ----------
test('sceneFamily：六族代表 doc 各归各族', () => {
  const atwood = mk({ entities: [
    { id: 'p', type: 'pulley', physics: { body: 'fixed' }, params: { radius: 0.3 } },
    { id: 'a', type: 'sphere', physics: { body: 'dynamic', mass: 3, onPulley: 'p' }, transform: { pos: [0, 1, 0] }, params: { radius: 0.12 } },
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: 2, onPulley: 'p' }, transform: { pos: [1, 1, 0] }, params: { radius: 0.12 } },
  ] });
  assert.equal(sceneFamily({}, atwood), 'atwood');
  const incline = mk({ entities: [
    { id: 'r', type: 'ramp', physics: { body: 'fixed' }, params: { angleDeg: 30 }, transform: { pos: [0, 0, 0] } },
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: 1, friction: 0 }, transform: { pos: [0, 1, 0] }, params: { radius: 0.15 } },
  ] });
  assert.equal(sceneFamily({}, incline), 'incline');
  const spring = mk({ entities: [
    { id: 'w', type: 'box', physics: { body: 'fixed' }, transform: { pos: [-1, 0.15, 0] }, params: { sx: 0.2, sy: 0.2, sz: 0.2 } },
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: 1 }, transform: { pos: [0.5, 0.15, 0] }, params: { radius: 0.15 } },
    { id: 's', type: 'spring', params: { stiffness: 20, restLength: 0.9, damping: 0 }, attach: ['w', 'b'] },
  ] });
  assert.equal(sceneFamily({}, spring), 'spring');
  const pend = mk({ entities: [
    { id: 'a', type: 'box', physics: { body: 'fixed' }, transform: { pos: [0, 3, 0] }, params: { sx: 0.1, sy: 0.1, sz: 0.1 } },
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: 0.5 }, transform: { pos: [0, 2, 0] }, params: { radius: 0.1 } },
    { id: 'r', type: 'rope', params: { length: 1.0 }, attach: ['a', 'b'] },
  ] });
  assert.equal(sceneFamily({}, pend), 'pendulum');
  const mom = mk({ entities: [
    { id: 'b1', type: 'sphere', physics: { body: 'dynamic', mass: 2, linvel: [3, 0, 0], restitution: 1 }, transform: { pos: [-1, 0.15, 0] }, params: { radius: 0.15 } },
    { id: 'b2', type: 'sphere', physics: { body: 'dynamic', mass: 1, restitution: 1 }, transform: { pos: [1, 0.15, 0] }, params: { radius: 0.15 } },
  ] });
  assert.equal(sceneFamily({}, mom), 'momentum');
  const proj = mk({ entities: [
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: 0.5, linvel: [4, 3, 0] }, transform: { pos: [0, 0.6, 0] }, params: { radius: 0.15 } },
    { id: 'g', type: 'ground', physics: { body: 'fixed' }, params: { sy: 0.1 } },
  ] });
  assert.equal(sceneFamily({}, proj), 'projectile');
});

// ---------- A1 简报 ----------
test('A1 简报：atwood 已知量含双质量/g，路线首步给出正确 a 数值', () => {
  const doc = mk({ entities: [
    { id: 'p', type: 'pulley', physics: { body: 'fixed' }, params: { radius: 0.3 } },
    { id: 'a', type: 'sphere', name: '重球', physics: { body: 'dynamic', mass: 3, onPulley: 'p' }, transform: { pos: [0, 1, 0] }, params: { radius: 0.12 } },
    { id: 'b', type: 'sphere', name: '轻球', physics: { body: 'dynamic', mass: 2, onPulley: 'p' }, transform: { pos: [1, 1, 0] }, params: { radius: 0.12 } },
  ] });
  const br = briefFromPlan({ unknowns: ['加速度 a', '张力 T'] }, doc);
  assert.ok(br.known.some((k) => k.label.includes('质量') && k.value.startsWith('3')));
  assert.equal(br.unknown.length, 2);
  assert.ok(br.topics[0].includes('牛顿第二定律'));
  const a = (3 - 2) * G0 / 5;
  assert.ok(br.route[0].detail.includes(a.toFixed(2)), `路线应含 a=${a.toFixed(2)}：${br.route[0].detail}`);
});
test('A1 简报：无 doc 时不炸、未知量透传', () => {
  const br = briefFromPlan({ unknowns: ['v'] }, null);
  assert.equal(br.family, null);
  assert.equal(br.unknown.length, 1);
  assert.equal(br.route, null);
});

// ---------- A2a 代入行：与 explainRun 同源互证 ----------
test('A2a atwood 代入行 a 与 explainAtwood 理论值一致（同源铁律）', () => {
  const doc = mk({ entities: [
    { id: 'p', type: 'pulley', physics: { body: 'fixed' }, params: { radius: 0.3 } },
    { id: 'a', type: 'sphere', physics: { body: 'dynamic', mass: 3, onPulley: 'p' }, transform: { pos: [0, 1, 0] }, params: { radius: 0.12 } },
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: 2, onPulley: 'p' }, transform: { pos: [1, 1, 0] }, params: { radius: 0.12 } },
  ] });
  const aTheory = (3 - 2) * G0 / 5;
  const sub = substitutionLine({}, doc, 'release');
  assert.ok(sub.includes(aTheory.toFixed(2)), sub);
  // 解释器同口径：explainAtwood 的 theoretical.a（经 explainRun atwood 通道）
  const r = explainRun({ observations: ['加速度'] }, doc, [], [], null, null, { m1: 3, m2: 2, aMeasured: aTheory, g: G0, simT: 2 });
  assert.equal(r.kind, 'atwood');
  assert.ok(Math.abs(r.theoretical.a - aTheory) < 1e-9);
});
test('A2a 弹簧代入行 T=2π√(m/k) 数值正确', () => {
  const doc = mk({ entities: [
    { id: 'w', type: 'box', physics: { body: 'fixed' }, transform: { pos: [-1, 0.15, 0] }, params: { sx: 0.2, sy: 0.2, sz: 0.2 } },
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: 1 }, transform: { pos: [0.5, 0.15, 0] }, params: { radius: 0.15 } },
    { id: 's', type: 'spring', params: { stiffness: 20, restLength: 0.9, damping: 0 }, attach: ['w', 'b'] },
  ] });
  const sub = substitutionLine({}, doc, 'contact');
  const T = 2 * Math.PI * Math.sqrt(1 / 20);
  assert.ok(sub.includes(T.toFixed(2)), sub);
});
test('A2a 抛体 highest 代入行含 h=vy²/2g 真值', () => {
  const vy = 20;
  const doc = mk({ entities: [
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: 0.5, linvel: [0, vy, 0] }, transform: { pos: [0, 0, 0] }, params: { radius: 0.15 } },
    { id: 'g', type: 'ground', physics: { body: 'fixed' }, params: { sy: 0.1 } },
  ] });
  const sub = substitutionLine({}, doc, 'highest');
  assert.ok(sub.includes((vy * vy / (2 * G0)).toFixed(2)), sub);
});
test('A2a 弹性碰撞代入行 v1/v2 公式正确（e=1）', () => {
  const doc = mk({ entities: [
    { id: 'b1', type: 'sphere', physics: { body: 'dynamic', mass: 2, linvel: [3, 0, 0], restitution: 1 }, transform: { pos: [-1, 0.15, 0] }, params: { radius: 0.15 } },
    { id: 'b2', type: 'sphere', physics: { body: 'dynamic', mass: 1, linvel: [0, 0, 0], restitution: 1 }, transform: { pos: [1, 0.15, 0] }, params: { radius: 0.15 } },
  ] });
  const sub = substitutionLine({}, doc, 'contact');
  const v1 = ((2 - 1) * 3 + 0) / 3, v2 = (0 + 2 * 2 * 3) / 3;
  assert.ok(sub.includes(v1.toFixed(2)) && sub.includes(v2.toFixed(2)), sub);
});
test('A2a 斜面代入行（光滑）a=g·sinθ', () => {
  const doc = mk({ entities: [
    { id: 'r', type: 'ramp', physics: { body: 'fixed' }, params: { angleDeg: 30 }, transform: { pos: [0, 0, 0], rot: [0, 0, 0] } },
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: 1, friction: 0 }, transform: { pos: [0, 1, 0] }, params: { radius: 0.15 } },
  ] });
  const sub = substitutionLine({}, doc, 'release');
  const a = G0 * Math.sin(Math.PI / 6);
  assert.ok(sub.includes(a.toFixed(2)), sub);
});
test('A2a 无适用公式时诚实返回 null（不编数字）', () => {
  assert.equal(substitutionLine({}, mk({ entities: [{ id: 'x', type: 'box', physics: { body: 'fixed' }, params: {} }] }), 'release'), null);
});

// ---------- A2d 变式派生 ----------
test('A2d 变式：有摩擦+有初速 → 无摩擦/质量减半/初速加倍三变式，原 doc 不被改', () => {
  const doc = mk({ entities: [
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: 2, friction: 0.3, linvel: [3, 0, 0] }, transform: { pos: [0, 0.15, 0] }, params: { radius: 0.15 } },
    { id: 'g', type: 'ground', physics: { body: 'fixed', friction: 0.3 }, params: { sy: 0.1 } },
  ] });
  const vs = deriveVariants(doc);
  assert.deepEqual(vs.map((v) => v.id), ['nofric', 'halfmass', 'doublev']);
  assert.equal(vs[0].doc.entities[0].physics.friction, 0);
  assert.equal(vs[1].doc.entities[0].physics.mass, 1);
  assert.deepEqual(vs[2].doc.entities[0].physics.linvel, [6, 0, 0]);
  // 原 doc 不动（深拷贝铁律）
  assert.equal(doc.entities[0].physics.friction, 0.3);
  assert.equal(doc.entities[0].physics.mass, 2);
});
test('A2d 变式：全静止无摩擦 → 零变式（诚实空集）', () => {
  const doc = mk({ entities: [
    { id: 'b', type: 'sphere', physics: { body: 'dynamic', mass: 1, friction: 0, linvel: [0, 0, 0] }, transform: { pos: [0, 2, 0] }, params: { radius: 0.15 } },
  ] });
  assert.equal(deriveVariants(doc).length, 1);   // 质量减半仍成立
  const doc2 = mk({ entities: [] });
  assert.equal(deriveVariants(doc2).length, 0);
});

// ---------- A3 时机检测器 ----------
test('A3 turn：vx 变号且近水平 → true；竖直运动中不误报', () => {
  assert.equal(detectTurn(0.5, -0.1, 0.02), true);
  assert.equal(detectTurn(0.5, -0.1, 1.2), false);   // 明显竖直分量=不是水平折返
  assert.equal(detectTurn(0.02, -0.01, 0.01), false); // 微小速度抖动不报
});
test('A3 leaveSurface：接触消失+正在上升 → true', () => {
  assert.equal(detectLeaveSurface(true, false, 0.5), true);
  assert.equal(detectLeaveSurface(true, false, -0.5), false);  // 下落离面=坠离非抛离
  assert.equal(detectLeaveSurface(false, false, 0.5), false);
});
test('A3 equilibrium：曾动+静≥1s+低速 → true；出生即静不报', () => {
  assert.equal(detectEquilibrium(true, 1.2, 0.01), true);
  assert.equal(detectEquilibrium(false, 5, 0.001), false);   // 从未运动
  assert.equal(detectEquilibrium(true, 0.5, 0.01), false);   // 静得不够久
  assert.equal(detectEquilibrium(true, 1.2, 0.5), false);    // 还在动
});
test('A3 sinkFloat：浸没+曾竖直运动+vy≈0 → true', () => {
  assert.equal(detectSinkFloat(true, 0.01, true), true);
  assert.equal(detectSinkFloat(true, 0.5, true), false);
  assert.equal(detectSinkFloat(true, 0.01, false), false);   // 未浸入液体
});

// ---------- A4 节奏表 ----------
test('A4 节奏表：contact/ground 定格、highest 慢放、end 最长、未知 moment 回退不炸', () => {
  assert.equal(TEACH_PACE.contact.pause, true);
  assert.equal(TEACH_PACE.ground.pause, true);
  assert.equal(TEACH_PACE.highest.pause, false);
  assert.equal(TEACH_PACE.highest.slow, 0.25);
  assert.ok(TEACH_PACE.end.hold >= 5000);
  assert.ok(paceFor('release').hold > 0);
  assert.ok(paceFor('不存在的时机').hold > 0);   // 回退策略
  for (const m of ['contact', 'highest', 'lowest', 'ground', 'turn', 'leaveSurface', 'equilibrium', 'sinkFloat', 'end', 'release']) {
    const p = paceFor(m);
    assert.ok(p.hold >= 2000 && p.hold <= 6000, `${m} hold 越界: ${p.hold}`);
    assert.ok(p.slow === 0 || (p.slow > 0 && p.slow <= 1), `${m} slow 越界`);
  }
});

// ---------- A2c 旁白文案 ----------
test('A2c 旁白：title+formula+代入行拼接，等号转中文可读', () => {
  const n = narrationText({ title: '最高点', formula: 'vy=0' }, '代入：h = 20.4 m');
  assert.ok(n.startsWith('最高点。'));
  assert.ok(n.includes('等于'));
  assert.ok(n.endsWith('。'));
  assert.equal(narrationText({ title: '释放' }, null), '释放。');
});
