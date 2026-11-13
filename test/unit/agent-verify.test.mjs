// agent-verify.test.mjs — 建场自查纯函数（AG-V）：静态核对/运动检测器/散开布局。
// 运行：node --test test/unit/agent-verify.test.mjs（零浏览器依赖）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditStatic, auditMotion, summarize, rampGeomFromParams, patchBrief } from '../../src/engine/agent-verify.js';
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

test('patchBrief: error 全量在前、warn 截断、ok 不进简报', () => {
  const F = [
    { sev: 'ok', cat: '理论对照', item: '斜面', msg: '吻合' },
    { sev: 'warn', cat: 'w1', item: 'i1', msg: 'm1' },
    { sev: 'error', cat: 'e1', item: 'i2', msg: 'm2' },
    { sev: 'warn', cat: 'w2', item: 'i3', msg: 'm3' },
  ];
  const brief = patchBrief(F);
  assert.equal(brief.length, 3, brief.join('|'));
  assert.ok(brief[0].startsWith('[错误] e1·i2'), brief[0]);
  assert.ok(brief[1].startsWith('[提醒] w1·i1'), brief[1]);
});
test('patchBrief: warn 超限截断（maxWarn 默认 6）', () => {
  const F = [{ sev: 'error', cat: 'e', item: 'i', msg: 'm' }];
  for (let i = 0; i < 9; i++) F.push({ sev: 'warn', cat: 'w', item: 'i' + i, msg: 'm' + i });
  assert.equal(patchBrief(F).length, 7);
  assert.equal(patchBrief(F, 2).length, 3);
});
test('patchBrief: 空发现 → 空简报', () => {
  assert.deepEqual(patchBrief([]), []);
});

// ---------- R7-B1 视觉探针（纯函数判定） ----------
import { auditVisualNdc, auditVisualCoverage, auditVisualFrame, auditVisualSubject, fitAccel, auditPhysicsCoarse } from '../../src/engine/agent-verify.js';

test('auditVisualNdc: 全程在框内=ok', () => {
  const F = auditVisualNdc({ tracks: [{ id: 'a', name: '球A', pts: [[0, 0], [0.8, -0.3], [1.2, 0.9]] }] });
  assert.equal(F.length, 1);
  assert.equal(F[0].sev, 'ok');
});
test('auditVisualNdc: 越限=error 且带 reframe 修复', () => {
  const F = auditVisualNdc({ tracks: [
    { id: 'a', name: '球A', pts: [[0, 0], [1.9, 0.2]] },
    { id: 'b', name: '球B', pts: [[0, 0], [0.1, -2.5]] }] })[0];
  assert.equal(F.sev, 'error');
  assert.equal(F.repair, 'reframe');
  assert.deepEqual(F.ids, ['a', 'b']);
  assert.ok(F.msg.includes('2.50'));
});
test('auditVisualNdc: skipIds 的体不重复定罪（世界级出界去重）', () => {
  const F = auditVisualNdc({ tracks: [{ id: 'a', name: '飞球', pts: [[5, -5]] }], skipIds: ['a'] });
  assert.equal(F[0].sev, 'ok');
});
test('auditVisualCoverage: 缺网格=error 且 skipPatch（回喂模型救不了渲染层）', () => {
  const F = auditVisualCoverage({ bodies: [{ id: 'a', name: '球', hasMesh: true }, { id: 'b', name: '块', hasMesh: false }] });
  const err = F.find((f) => f.sev === 'error');
  assert.ok(err && err.cat === '视觉·网格');
  assert.equal(err.skipPatch, true);
  assert.deepEqual(err.ids, ['b']);
});
test('auditVisualCoverage: 滑轮对无跨绳=error；正常=单条 ok 汇总', () => {
  const E = auditVisualCoverage({ bodies: [{ id: 'a', name: '球', hasMesh: true }], ropeSegs: 0, hasPulleyPair: true });
  assert.ok(E.some((f) => f.cat === '视觉·绳' && f.sev === 'error'));
  const OK = auditVisualCoverage({ bodies: [{ id: 'a', name: '球', hasMesh: true }], ropeSegs: 3, hasPulleyPair: true });
  assert.equal(OK.length, 1);
  assert.equal(OK[0].sev, 'ok');
  assert.ok(OK[0].msg.includes('3'));
});
test('auditVisualFrame: t0 退化=error+tightframe；t0 好而末帧退化=warn', () => {
  const bad = auditVisualFrame({ t0: { mean: 2.1, bright: 10 } });
  assert.equal(bad[0].sev, 'error');
  assert.equal(bad[0].repair, 'tightframe');
  const warn = auditVisualFrame({ t0: { mean: 18, bright: 900 }, tEnd: { mean: 1, bright: 2 } });
  assert.ok(warn.some((f) => f.sev === 'warn' && f.item === '探针末帧'));
  assert.ok(warn.some((f) => f.sev === 'ok' && f.item === '建场定格帧'));
  const clean = auditVisualFrame({ t0: { mean: 18, bright: 900 }, tEnd: { mean: 15, bright: 400 } });
  assert.ok(!clean.some((f) => f.sev !== 'ok'));
});

// ---------- R7-B1 物理粗对账（观察量 vs 理论量级） ----------
test('fitAccel: 恒加速序列回归出正确斜率（跳过安定段）', () => {
  const samples = [];
  for (let i = 0; i <= 30; i++) {
    const t = i * 0.1;
    samples.push({ t, states: { a: { p: [0, 0, 0], v: [0, -9.81 * Math.max(0, t - 0.2), 0] } } });
  }
  const a = fitAccel(samples, 'a');
  assert.ok(Math.abs(a - (-9.81)) < 0.01, 'a=' + a);
});
test('auditPhysicsCoarse: atwoodLike 吻合=ok / 偏差>30%=error', () => {
  // a=(3−1)×10/(3+1)=5 m/s²；两侧一升一降同量级
  const samples = [];
  for (let i = 0; i <= 30; i++) {
    const t = i * 0.1, v = 5 * Math.max(0, t - 0.25);
    samples.push({ t, states: { L: { p: [0, 0, 0], v: [0, -v, 0] }, R: { p: [1, 0, 0], v: [0, v, 0] } } });
  }
  const ok = auditPhysicsCoarse({ samples, docInfo: { g: 10, topology: 'atwoodLike', masses: { L: 3, R: 1 }, pairIds: ['L', 'R'] } });
  assert.equal(ok.sev, 'ok');
  // L 侧加速度砍到 30%（1.5 m/s²）：均值 (1.5+5)/2=3.25，对 5.00 偏差 35%>30% → error
  const samples2 = samples.map((s) => ({ t: s.t, states: { L: { p: [0, 0, 0], v: [0, -s.states.L.v[1] * 0.3, 0] }, R: s.states.R } }));
  const bad = auditPhysicsCoarse({ samples: samples2, docInfo: { g: 10, topology: 'atwoodLike', masses: { L: 3, R: 1 }, pairIds: ['L', 'R'] } });
  assert.equal(bad.sev, 'error');
  assert.ok(bad.msg.includes('(m₁−m₂)g/(m₁+m₂)=5.00'));
});
test('auditPhysicsCoarse: 质量平衡跳过 / freefallLike 对账 g / 拓扑空=null', () => {
  const bal = auditPhysicsCoarse({ samples: [], docInfo: { g: 10, topology: 'atwoodLike', masses: { L: 1, R: 1 }, pairIds: ['L', 'R'] } });
  assert.equal(bal.sev, 'ok');
  const samples = [];
  for (let i = 0; i <= 30; i++) {
    const t = i * 0.1;
    samples.push({ t, states: { f: { p: [0, 0, 0], v: [0, -9.81 * t, 0] } } });
  }
  const ff = auditPhysicsCoarse({ samples, docInfo: { g: 9.81, topology: 'freefallLike', pairIds: ['f'] } });
  assert.equal(ff.sev, 'ok');
  assert.equal(auditPhysicsCoarse({ samples, docInfo: null }), null);
});
test('patchBrief: skipPatch 的 error 不进修订简报（视觉网格类不烧模型轮次）', () => {
  const brief = patchBrief([
    { sev: 'error', cat: '视觉·网格', item: '实体网格', msg: '无网格', skipPatch: true },
    { sev: 'error', cat: '静态·嵌入', item: '块', msg: '嵌入' },
  ]);
  assert.equal(brief.length, 1);
  assert.ok(brief[0].includes('静态·嵌入'));
});

test('auditVisualSubject: 正常份额=ok / 芝麻份额=error+tightframe / 无轨迹=ok', () => {
  // atwood 实测正常帧：NDC 轨迹 ~0.6×0.3 → diag 0.67 → 份额 24%
  const normal = auditVisualSubject({ tracks: [{ id: 'a', name: '球', pts: [] }] });
  assert.equal(normal[0].sev, 'ok');   // 空轨迹=静态场景不查
  const ok = auditVisualSubject({ tracks: [{ id: 'a', name: '球', pts: [[-0.3, -0.15], [0.3, 0.15]] }] });
  assert.equal(ok[0].sev, 'ok');
  // 260m 远：全轨迹挤在 NDC ±0.01 → 份额 0.5% → error
  const tiny = auditVisualSubject({ tracks: [{ id: 'a', name: '球', pts: [[-0.01, -0.005], [0.01, 0.005]] }] });
  assert.equal(tiny[0].sev, 'error');
  assert.equal(tiny[0].repair, 'tightframe');
  assert.equal(tiny[0].skipPatch, true);
  // 宽抛体合法宽取景：轨迹撑满画面 → ok
  const wide = auditVisualSubject({ tracks: [{ id: 'a', name: '球', pts: [[-0.9, -0.4], [0.9, 0.4]] }] });
  assert.equal(wide[0].sev, 'ok');
});
