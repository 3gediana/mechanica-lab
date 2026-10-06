// agent-verify.test.mjs — 建场自查纯函数（AG-V）：静态核对/运动检测器/散开布局。
// 运行：node --test test/unit/agent-verify.test.mjs（零浏览器依赖）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditStatic, auditMotion, summarize, rampGeomFromParams } from '../../src/engine/agent-verify.js';
import { normalizeParse, planToOverrides, ballOnRamp } from '../../src/engine/parse-schema.js';

// ---------- 散开布局：同类型多件不再叠在同一点（复杂场景前置） ----------
test('planToOverrides: 两个 box 沿 x 对称散开', () => {
  const n = normalizeParse({ questionType: '多块', entities: [
    { type: 'box', given: { mass: 1 } }, { type: 'box', given: { mass: 2 } }] });
  const out = planToOverrides(n.plan);
  const xs = out.filter((o) => o.type === 'box').map((o) => o.transform.pos[0]);
  assert.equal(xs.length, 2);
  assert.notEqual(xs[0], xs[1]);
  assert.ok(Math.abs(xs[0] - xs[1]) >= 0.9 - 1e-9, `间距应 ≥0.9，实际 ${xs}`);
});
test('planToOverrides: 三个 cylinder 沿 z 散开', () => {
  const n = normalizeParse({ questionType: '多柱', entities: [
    { type: 'cylinder', given: {} }, { type: 'cylinder', given: {} }, { type: 'cylinder', given: {} }] });
  const zs = planToOverrides(n.plan).map((o) => o.transform.pos[2]);
  assert.equal(new Set(zs).size, 3, `z 应互不相同，实际 ${zs}`);
});
test('planToOverrides: 单 box 位置不变（兼容既有测试/预置）', () => {
  const n = normalizeParse({ questionType: '单块', entities: [{ type: 'box', given: { mass: 1 } }] });
  const p = planToOverrides(n.plan)[0].transform.pos;
  assert.ok(Math.abs(p[0] - 0.6) < 1e-9 && Math.abs(p[1] - 0.17) < 1e-9 && Math.abs(p[2]) < 1e-9, JSON.stringify(p));
});

// ---------- 静态核对 ----------
const RAMP = { params: { length: 1.732, height: 1.0 } };
test('auditStatic: 球在坡面上=ok', () => {
  const geom = rampGeomFromParams(RAMP.params);
  const pos = ballOnRamp(geom, 0.15);
  const F = auditStatic({
    kind: '', ramp: RAMP, penetrations: {},
    items: [{ id: 'b1', type: 'sphere', name: '小球', params: { radius: 0.15 }, pos, rotY: 0, isDynamic: true, given: {} }],
  });
  assert.ok(!F.some((f) => f.sev === 'error'), JSON.stringify(F));
  assert.ok(F.some((f) => f.sev === 'ok' && f.msg.includes('在坡面上')));
});
test('auditStatic: 球悬空离坡 0.5m=error（用户点名的「球没放在坡上」）', () => {
  const geom = rampGeomFromParams(RAMP.params);
  const pos = ballOnRamp(geom, 0.15);
  pos[1] += 0.5;
  const F = auditStatic({
    kind: '', ramp: RAMP, penetrations: {},
    items: [{ id: 'b1', type: 'sphere', name: '小球', params: { radius: 0.15 }, pos, rotY: 0, isDynamic: true, given: {} }],
  });
  const bad = F.find((f) => f.sev === 'error' && f.repair === 'onramp');
  assert.ok(bad, JSON.stringify(F));
  assert.ok(bad.msg.includes('不在坡面上'));
});
test('auditStatic: 嵌入方向数>0=error+lift 修复', () => {
  const F = auditStatic({
    kind: '', ramp: null, penetrations: { k1: 7 },
    items: [{ id: 'k1', type: 'box', name: '方块', params: { sx: 0.3 }, pos: [0.6, 0.17, 0], rotY: 0, isDynamic: true, given: {} }],
  });
  const bad = F.find((f) => f.sev === 'error' && f.repair === 'lift');
  assert.ok(bad && bad.msg.includes('嵌入'));
});
test('auditStatic: 题给位置偏 0.4m=error+restore 修复', () => {
  const F = auditStatic({
    kind: '', ramp: null, penetrations: {},
    items: [{ id: 's1', type: 'sphere', name: '小球', params: { radius: 0.15 },
      pos: [0, 0.16, 0], rotY: 0, isDynamic: true, given: { position: [3, 0.5, 1] } }],
  });
  const bad = F.find((f) => f.sev === 'error' && f.repair === 'restore');
  assert.ok(bad && bad.msg.includes('未放在题目要求的位置'));
});
test('auditStatic: 专用布局 kind 豁免题给位置核对（spring 重摆位是设计行为）', () => {
  const F = auditStatic({
    kind: 'spring', ramp: null, penetrations: {},
    items: [{ id: 's1', type: 'sphere', name: '振子小球', params: { radius: 0.15 },
      pos: [0, 0.6, 0], rotY: 0, isDynamic: true, given: { position: [3, 0.5, 1] } }],
  });
  assert.ok(!F.some((f) => f.cat === '静态·题给位置'));
});
test('auditStatic: 绳绷紧=warn，弹簧 3 倍拉伸=warn', () => {
  const F = auditStatic({
    kind: '', ramp: null, penetrations: {},
    items: [],
    attaches: [
      { type: 'rope', aName: 'A', bName: 'B', aPos: [0, 1, 0], bPos: [1.2, 1, 0], length: 0.5, restLength: null },
      { type: 'spring', aName: 'A', bName: 'C', aPos: [0, 1, 0], bPos: [4, 1, 0], length: null, restLength: 0.8 },
    ],
  });
  assert.ok(F.some((f) => f.sev === 'warn' && f.msg.includes('绳初始绷紧')));
  assert.ok(F.some((f) => f.sev === 'warn' && f.msg.includes('弹簧初始拉伸')));
});

// ---------- 运动探针检测器 ----------
const mkProbe = (states, ke = [0.1], entities = null, hasGround = true) => ({
  sceneFlags: { hasGround },
  entities: entities ?? [{ id: 'b1', name: '小球', isDynamic: true, gravitating: false, locked: false, v0: 0 }],
  samples: states.map((s) => ({ t: s.t ?? 0, states: { b1: { p: s.p, v: s.v ?? [0, 0, 0] } } })),
  ke,
});
test('auditMotion: 正常滚动无 finding', () => {
  const F = auditMotion(mkProbe([
    { p: [0, 0.2, 0], v: [0.5, 0, 0] }, { p: [0.5, 0.15, 0], v: [1.2, 0, 0] }, { p: [1.2, 0.1, 0], v: [1.5, 0, 0] },
  ], [0.2, 0.9, 1.4]));
  assert.equal(F.length, 0, JSON.stringify(F));
});
test('auditMotion: NaN=error', () => {
  const F = auditMotion(mkProbe([{ p: [0, 0.2, 0] }, { p: [NaN, 0.2, 0] }]));
  assert.ok(F.some((f) => f.sev === 'error' && f.msg.includes('NaN')));
});
test('auditMotion: 有地面时下坠出界=error；无地面=不报（合法自由落体）', () => {
  const fell = mkProbe([{ p: [0, 1, 0] }, { p: [0, -30, 0] }], [0.1, 5]);
  assert.ok(auditMotion(fell).some((f) => f.sev === 'error' && f.msg.includes('飞出')));
  const noGround = mkProbe([{ p: [0, 1, 0] }, { p: [0, -30, 0] }], [0.1, 5], null, false);
  assert.ok(!auditMotion(noGround).some((f) => f.sev === 'error'));
});
test('auditMotion: 侧向出界任何时候=error', () => {
  const F = auditMotion(mkProbe([{ p: [0, 1, 0] }, { p: [55, 1, 0] }], [0.1, 9], null, false));
  assert.ok(F.some((f) => f.sev === 'error' && f.msg.includes('飞出')));
});
test('auditMotion: 题给初速却全程未动=error（卡死）；无初速未动=warn', () => {
  const still = [{ p: [1, 0.5, 0], v: [0, 0, 0] }, { p: [1, 0.5, 0], v: [0, 0, 0] }, { p: [1, 0.5, 0], v: [0, 0, 0] }];
  const stuck = auditMotion(mkProbe(still, [0.05, 0.05, 0.05],
    [{ id: 'b1', name: '小球', isDynamic: true, gravitating: false, locked: false, v0: 2 }]));
  assert.ok(stuck.some((f) => f.sev === 'error' && f.msg.includes('卡死')));
  const idle = auditMotion(mkProbe(still, [0.05, 0.05, 0.05]));
  assert.ok(idle.some((f) => f.sev === 'warn' && f.msg.includes('未运动')));
});
test('auditMotion: KE 突跳=warn（深嵌被弹出信号）', () => {
  const still = { p: [0, 0.5, 0], v: [0, 0, 0] };
  const fly = { p: [3, 0.5, 0], v: [4, 0, 0] };
  const states = [still, still, still, still, fly, fly, fly, fly, fly, fly, fly, fly, fly, fly];
  const ke = [0.05, 0.05, 0.05, 0.05, 60, 120, 120, 120, 120, 120, 120, 120, 120, 120];
  const F = auditMotion(mkProbe(states, ke));
  assert.ok(F.some((f) => f.sev === 'warn' && f.msg.includes('动能突增')), JSON.stringify(F));
});
test('auditMotion: 光滑增速（斜面从静止加速）不误报', () => {
  const ke = [];
  const states = [];
  for (let i = 0; i < 20; i++) {
    ke.push(+(0.05 + i * 0.45).toFixed(3));   // 每采样 +0.45J，总量到 ~9J
    states.push({ p: [i * 0.1, 0.4 - i * 0.01, 0], v: [0.3 + i * 0.12, 0, 0] });
  }
  const F = auditMotion(mkProbe(states, ke));
  assert.ok(!F.some((f) => f.cat === '运动·能量'), JSON.stringify(F));
});
test('summarize 计数', () => {
  assert.deepEqual(summarize([{ sev: 'ok' }, { sev: 'ok' }, { sev: 'warn' }, { sev: 'error' }]),
    { ok: 2, warn: 1, error: 1 });
});
