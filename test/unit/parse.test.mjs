// parse.test.mjs — normalizeParse / planToOverrides 纯函数单测（AG-50）
// 金标数据 = tools/fixtures/parse-*.json（真实模型历史输出的冻结快照）+ 合成边界样例。
// 运行：node --test test/unit/parse.test.mjs（无需浏览器/服务器）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeParse, planToOverrides } from '../../src/engine/parse-schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FX = (n) => JSON.parse(readFileSync(join(HERE, '../../tools/fixtures', `parse-${n}.json`), 'utf8'));

// ---------- 金标：10 份 fixture 全部过 normalize ----------
const GOLDEN = ['incline', 'momentum', 'momentum2d', 'celestial', 'spin', 'spin-real', 'spring', 'hinge', 'projectile', 'atwood'];
for (const name of GOLDEN) {
  test(`金标 normalize: ${name}`, () => {
    const n = normalizeParse(FX(name));
    assert.equal(n.ok, true, `errors: ${n.errors?.join(';')}`);
    assert.ok(n.plan.entities.length >= 1);
    assert.equal(typeof n.plan.confidence, 'number');
  });
}

// ---------- 防御层 ----------
test('gravity=0 视为无效并落默认 9.81', () => {
  const raw = { questionType: '斜面', entities: [{ type: 'ramp', given: { angleDeg: 30 } }, { type: 'sphere', given: { mass: 1 } }], gravity: 0 };
  const n = normalizeParse(raw);
  assert.equal(n.ok, true);
  assert.equal(n.plan.gravity, 9.81);
  assert.equal(n.plan.gravityDefault, true);
  assert.ok(n.errors.some((e) => e.includes('gravity=0')));
});

test('光滑语义注入 friction=0 且标推断', () => {
  const raw = { questionType: '斜面下滑', goal: '求底端速度', environment: '斜面光滑', entities: [
    { type: 'ramp', given: { angleDeg: 30 } }, { type: 'sphere', given: { mass: 2 } }] };
  const n = normalizeParse(raw);
  const ramp = n.plan.entities.find((e) => e.type === 'ramp');
  const ball = n.plan.entities.find((e) => e.type === 'sphere');
  assert.equal(ramp.given.friction, 0);
  assert.equal(ball.given.friction, 0);
  assert.ok(ball.inferred.includes('friction'));
});

test('显式 friction 不被光滑推断覆盖', () => {
  const raw = { questionType: '斜面', environment: '光滑', entities: [
    { type: 'sphere', given: { mass: 1, friction: 0.2 } }] };
  const n = normalizeParse(raw);
  assert.equal(n.plan.entities[0].given.friction, 0.2);
  assert.ok(!n.plan.entities[0].inferred);
});

test('未知实体类型跳过并报错；未知 given 键丢弃不编造', () => {
  const raw = { entities: [{ type: '飞船', given: {} }, { type: 'sphere', given: { mass: 1, 颜色: '红' } }] };
  const n = normalizeParse(raw);
  assert.equal(n.ok, true);
  assert.equal(n.plan.entities.length, 1);
  assert.ok(n.errors.some((e) => e.includes('未知实体类型')));
  assert.equal('颜色' in n.plan.entities[0].given, false);
});

test('越界数值被拒（radius=50 超上限 2）', () => {
  const raw = { entities: [{ type: 'sphere', given: { radius: 50 } }] };
  const n = normalizeParse(raw);
  assert.equal(n.plan.entities[0].given.radius, undefined);
  assert.ok(n.errors.length >= 1);
});

test('attaches 自引用被过滤（from===to）', () => {
  const raw = { entities: [{ type: 'sphere', given: { mass: 1 } }], attaches: [{ type: 'spring', from: 0, to: 0 }] };
  const n = normalizeParse(raw);
  assert.equal(n.plan.attaches.length, 0);
});

test('无实体的输出判无效', () => {
  const n = normalizeParse({ entities: [] });
  assert.equal(n.ok, false);
});

// ---------- planToOverrides 关键布局 ----------
test('斜面：angleDeg 换算底边/坡高，球贴坡面（半径感知 AG-6）', () => {
  const raw = { questionType: '斜面', entities: [
    { type: 'ramp', given: { angleDeg: 30, length: 2 } },
    { type: 'sphere', given: { mass: 1, radius: 0.5 } }] };
  const n = normalizeParse(raw);
  const out = planToOverrides(n.plan);
  const ramp = out.find((o) => o.type === 'ramp');
  const ball = out.find((o) => o.type === 'sphere');
  assert.ok(Math.abs(ramp.params.length - 2 * Math.cos(Math.PI / 6)) < 1e-3);   // 底边 = L·cosθ
  assert.ok(Math.abs(ramp.params.height - 2 * Math.sin(Math.PI / 6)) < 1e-3);   // 坡高 = L·sinθ
  assert.equal(ball.params.radius, 0.5);
  // 球心偏移至少留出半径：xl > -base/2 + r
  assert.ok(ball.transform.pos[0] > -ramp.params.length / 2 + 0.5 - 1e-6);
  assert.ok(ball.transform.pos[1] > 0.5);   // 球心高于半径
});

test('天体：xz 平面归一 + 速度缺失按圆轨道 v=√(GM/r) 推断', () => {
  const raw = { kind: 'astro', G: 1, entities: [
    { type: 'celestial', name: '中心', given: { mass: 100, position: [0, 0, 0] } },
    { type: 'celestial', name: '卫星', given: { mass: 1, position: [4, 0, 0] } }] };
  const n = normalizeParse(raw);
  const out = planToOverrides(n.plan);
  const sat = out.find((o) => o.name === '卫星');
  const v = sat.physics.linvel;
  const speed = Math.hypot(v[0], v[1], v[2]);
  assert.ok(Math.abs(speed - Math.sqrt(1 * 100 / 4)) < 1e-3);   // v = √(GM/r) = 5
  assert.equal(v[1], 0);   // xz 平面
  assert.ok(Math.abs(v[0] * 4 + v[2] * 0) < 1e-9);   // 与径向垂直（纯切向）
});

test('天体：速度塞进 y 轴（xy 平面轨道）被切向化', () => {
  const raw = { kind: 'astro', G: 1, entities: [
    { type: 'celestial', given: { mass: 100, position: [0, 0, 0] } },
    { type: 'celestial', given: { mass: 1, position: [4, 0, 0], velocity: [0, 5, 0] } }] };
  const out = planToOverrides(normalizeParse(raw).plan);
  const v = out[1].physics.linvel;
  assert.equal(v[1], 0);
  assert.ok(Math.abs(Math.hypot(v[0], v[2]) - 5) < 1e-3);   // 模长守恒，方向转 xz 切向
});

test('对撞：两球自动补光滑地面（隐含装置）', () => {
  const raw = { entities: [
    { type: 'sphere', given: { mass: 2, velocity: [1.5, 0, 0] } },
    { type: 'sphere', given: { mass: 1 } }] };
  const out = planToOverrides(normalizeParse(raw).plan);
  assert.ok(out.some((o) => o.type === 'ground'));
  const b1 = out.find((o) => o.type === 'sphere');
  assert.equal(b1.physics.gravityScale, 0);   // 悬浮理想化
});

test('转台布局：题给转动惯量反解质量', () => {
  const raw = { kind: 'rotation', entities: [
    { type: 'cylinder', given: { radius: 1, momentOfInertia: 4 } },
    { type: 'box', given: { mass: 1.5 } }],
    joint: { from: 0, to: 1, type: 'prismatic', axis: [1, 0, 0] } };
  const out = planToOverrides(normalizeParse(raw).plan);
  const table = out[0];
  assert.ok(Math.abs(table.physics.mass - 2 * 4 / (1 * 1)) < 1e-6);   // M = 2I/R²
  assert.equal(table.physics.spinLock, true);
});

test('atwood 布局：双球 onPulley 占位', () => {
  const raw = { kind: 'atwood', entities: [
    { type: 'pulley', given: { radius: 0.3 } },
    { type: 'sphere', given: { mass: 2 } }, { type: 'sphere', given: { mass: 1 } }] };
  const out = planToOverrides(normalizeParse(raw).plan);
  assert.equal(out[0].type, 'pulley');
  assert.ok(out.slice(1).every((o) => o.physics.onPulley === '__PULLEY__'));
});

// ---------- Round36 B8 追加：别名/透传/透明化 ----------
test('中文类型别名被消化（AG-12）', () => {
  const raw = { entities: [
    { type: '斜坡', given: { angleDeg: 30 } }, { type: '小球', given: { mass: 1 } },
    { type: '滑块', given: { mass: 2 } }, { type: '圆盘', given: { radius: 0.5 } }] };
  const n = normalizeParse(raw);
  assert.deepEqual(n.plan.entities.map((e) => e.type).sort(), ['box', 'cylinder', 'ramp', 'sphere']);
});

test('不支持字段进 uncertain 透明展示（AG-9）', () => {
  const raw = { entities: [{ type: 'sphere', name: '球A', given: { mass: 1, 颜色: '红', 密度: 2 } }] };
  const n = normalizeParse(raw);
  assert.ok(n.plan.uncertain.some((u) => u.includes('球A') && u.includes('不支持')), n.plan.uncertain.join('|'));
});

test('gravity 非法值显式报错不静默（AG-10）', () => {
  const raw = { entities: [{ type: 'sphere', given: { mass: 1 } }], gravity: 200 };
  const n = normalizeParse(raw);
  assert.equal(n.plan.gravity, 9.81);
  assert.ok(n.errors.some((e) => e.includes('gravity 值无效')), n.errors.join('|'));
});

test('box 题给尺寸透传 sx/sy/sz（AG-18）', () => {
  const raw = { entities: [{ type: 'box', given: { mass: 2, length: 0.5, width: 0.4, height: 0.2 } }] };
  const out = planToOverrides(normalizeParse(raw).plan);
  assert.deepEqual(out[0].params, { sx: 0.5, sy: 0.2, sz: 0.4 });
  assert.ok(out[0].transform.pos[1] >= 0.1);   // 落地高度 = sy/2 + 余量
  const raw1 = { entities: [{ type: 'box', given: { length: 0.6 } }] };   // 只给一边=正方块
  const out1 = planToOverrides(normalizeParse(raw1).plan);
  assert.deepEqual(out1[0].params, { sx: 0.6, sy: 0.6, sz: 0.6 });
});

test('坡宽随球半径放大（AG-21）', () => {
  const raw = { questionType: '斜面', entities: [
    { type: 'ramp', given: { angleDeg: 30, length: 2 } },
    { type: 'sphere', given: { mass: 1, radius: 0.5 } }] };
  const out = planToOverrides(normalizeParse(raw).plan);
  assert.ok(out.find((o) => o.type === 'ramp').params.width >= 2.2 * 0.5 - 1e-6);
});

// ---------- R2 防御层（AG-97/99/112/95 单测锚） ----------
test('二维向量补零升维：velocity [vx,vy] → [vx,vy,0] 并进 uncertain', () => {
  const raw = { questionType: '抛体', entities: [{ type: 'sphere', given: { mass: 1, velocity: [3, 4] } }] };
  const n = normalizeParse(raw);
  assert.equal(n.ok, true);
  assert.deepEqual(n.plan.entities[0].given.velocity, [3, 4, 0]);
  assert.ok(n.plan.uncertain.some((u) => u.includes('补零升维')));
});

test('KIND_MAP 中文 kind 归一：转台→rotation（布局不再失配）', () => {
  const raw = { questionType: '角动量', kind: '转台', entities: [
    { type: 'cylinder', given: { radius: 1, mass: 8, angvel: [0, 3, 0] } },
    { type: 'box', given: { mass: 1.5 } }] };
  const n = normalizeParse(raw);
  assert.equal(n.plan.kind, 'rotation');
  const out = planToOverrides(n.plan);
  assert.ok(out.length >= 2);
  const slider = out.find((o) => o.type === 'box');
  assert.ok(slider, 'rotation 布局应产出滑块');
  assert.ok(Math.abs(slider.physics.linvel[2] - (-3 * 0.7)) < 1e-6, '滑块切向速度应与 ω0·r0 匹配');
});

test('attaches 索引越界被丢弃并报错（AG-112）', () => {
  const raw = { questionType: '连接体', entities: [
    { type: 'sphere', given: { mass: 1 } }, { type: 'sphere', given: { mass: 2 } }],
    attaches: [{ type: 'rope', from: 0, to: 9 }] };
  const n = normalizeParse(raw);
  assert.equal(n.ok, true);
  assert.equal(n.plan.attaches.length, 0);
  assert.ok(n.errors.some((e) => e.includes('越界')));
});

test('joint 索引越界被丢弃并报错（AG-112）', () => {
  const raw = { questionType: '转台', kind: 'rotation', entities: [
    { type: 'cylinder', given: { radius: 1 } }, { type: 'box', given: { mass: 1 } }],
    joint: { type: 'prismatic', from: 0, to: 99 } };
  const n = normalizeParse(raw);
  assert.equal(n.plan.joint, null);
  assert.ok(n.errors.some((e) => e.includes('joint') && e.includes('越界')));
});

test('atwood 摆球数≠2 回退通用布局而非 0 实体（AG-95）', () => {
  const raw = { questionType: '滑轮', kind: 'atwood', entities: [
    { type: 'pulley', given: { radius: 0.3 } },
    { type: 'sphere', given: { mass: 1 } },
    { type: 'sphere', given: { mass: 2 } },
    { type: 'sphere', given: { mass: 1.5 } }] };
  const n = normalizeParse(raw);
  const out = planToOverrides(n.plan);
  assert.ok(out.length >= 4, `应回退通用布局产出全部实体，实际 ${out.length}`);
  assert.ok(n.plan.uncertain.some((u) => u.includes('阿特伍德')));
});

// ---------- removals（AG-R1 删除指令：混合搭建「去掉某物」语义） ----------
test('removals：字符串与 {target} 对象混写，去重并截断（≤6）', () => {
  const raw = { questionType: '混合', entities: [{ type: 'box', given: { mass: 1 } }],
    removals: ['小球', { target: '斜面' }, '小球', { target: '' }, 'x'.repeat(100)] };
  const n = normalizeParse(raw);
  assert.equal(n.ok, true);
  assert.deepEqual(n.plan.removals, ['小球', '斜面', 'x'.repeat(80)]);
});
test('removals 超过 6 条截断到 6', () => {
  const raw = { questionType: '混合', entities: [{ type: 'box', given: {} }],
    removals: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] };
  const n = normalizeParse(raw);
  assert.equal(n.plan.removals.length, 6);
});
test('removals 缺省=空数组（既有 fixture 不受影响）', () => {
  const n = normalizeParse(FX('incline'));
  assert.deepEqual(n.plan.removals, []);
});

test('planToOverrides: 显式 ground 实体带 physics（AG-V3 修订计划补地面不再炸）', () => {
  const raw = FX('incline');
  raw.entities.push({ type: 'ground', name: '地面', given: { length: 12, width: 8, friction: 0.2 }, confidence: 0.9 });
  const n = normalizeParse(raw);
  assert.equal(n.ok, true, n.errors && n.errors.join('; '));
  const ov = planToOverrides(n.plan);
  const g = ov.find((o) => o.type === 'ground');
  assert.ok(g, 'override 缺 ground');
  assert.equal(g.physics.body, 'fixed');
  assert.equal(g.physics.friction, 0.2);
  assert.equal(g.params.sx, 12);
});
