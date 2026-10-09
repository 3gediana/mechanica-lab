// presets.test.mjs — 预置场景结构单测（第二批教学预置 MDL-16~40 + 原有预置回归）
// 断言口径：文档结构有效 / attach 与 joints 引用闭合 / 数值健全（无 NaN、质量>0、k>0）/
// 每预置实体数量与类型布局 / 关键物理参数与理论公式一致（理论值在测试内独立复算）。
// 运行：node --test test/unit/presets.test.mjs（无需浏览器/服务器）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');

// three 在浏览器经 index.html importmap 解析；node 下把裸说明符指到仓库内 vendor 副本，
// 与浏览器加载同一份模块源（registry.js 仅在模块级 new MeshStandardMaterial，node 可直跑）。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') {
      return { url: pathToFileURL(join(ROOT, 'vendor/three/three.module.js')).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { PRESETS, getPreset } = await import(pathToFileURL(join(ROOT, 'src/engine/presets.js')).href);

const G0 = 9.81;
const NEW_IDS = [
  'pendulum', 'conical', 'vertCircle', 'springSHM', 'springVert', 'coupled', 'springGun',
  'collLab', 'bulletBlock', 'newtonCradle', 'ballChain', 'bounceCompare', 'galileoDrop',
  'rangeAngles', 'atwoodHeavy', 'binaryStar', 'threeBody', 'rollRace', 'frictionLock',
  'blockOnBlock', 'weightless',
];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const speed = (v) => Math.hypot(v[0], v[1], v[2]);
const byType = (doc, t) => doc.entities.filter((e) => e.type === t);

// ---------- 结构总表：id → { count, types } ----------
const EXPECT = {
  empty: { count: 0, types: {} },
  incline: { count: 3, types: { ground: 1, ramp: 1, sphere: 1 } },
  momentum2d: { count: 3, types: { ground: 1, sphere: 2 } },
  momentum: { count: 3, types: { ground: 1, sphere: 2 } },
  celestial: { count: 2, types: { celestial: 2 } },
  classic: { count: 3, types: { track: 1, sphere: 1, ground: 1 } },
  projectile: { count: 2, types: { sphere: 1, ground: 1 } },
  hingePend: { count: 2, types: { box: 2 } },
  atwood: { count: 3, types: { pulley: 1, sphere: 2 } },
  spin: { count: 3, types: { cylinder: 2, box: 1 } },
  pendulum: { count: 3, types: { box: 1, sphere: 1, rope: 1 } },
  conical: { count: 3, types: { box: 1, sphere: 1, rope: 1 } },
  vertCircle: { count: 7, types: { box: 2, sphere: 2, rope: 2, ground: 1 } },
  springSHM: { count: 4, types: { ground: 1, box: 1, sphere: 1, spring: 1 } },
  springVert: { count: 3, types: { box: 1, sphere: 1, spring: 1 } },
  coupled: { count: 4, types: { ground: 1, box: 2, spring: 1 } },
  springGun: { count: 6, types: { ground: 1, box: 3, sphere: 1, spring: 1 } },
  collLab: { count: 5, types: { ground: 1, sphere: 4 } },
  bulletBlock: { count: 3, types: { ground: 1, sphere: 1, box: 1 } },
  newtonCradle: { count: 16, types: { box: 6, sphere: 5, rope: 5 } },
  ballChain: { count: 7, types: { ground: 1, sphere: 6 } },
  bounceCompare: { count: 6, types: { ground: 3, sphere: 3 } },
  galileoDrop: { count: 3, types: { ground: 1, sphere: 2 } },
  rangeAngles: { count: 4, types: { ground: 1, sphere: 3 } },
  atwoodHeavy: { count: 3, types: { pulley: 1, sphere: 2 } },
  binaryStar: { count: 2, types: { celestial: 2 } },
  threeBody: { count: 3, types: { celestial: 3 } },
  rollRace: { count: 4, types: { ground: 1, ramp: 1, sphere: 1, cylinder: 1 } },
  frictionLock: { count: 3, types: { ground: 1, ramp: 1, box: 1 } },
  blockOnBlock: { count: 3, types: { ground: 1, box: 2 } },
  weightless: { count: 3, types: { ground: 1, sphere: 1, forceSensor: 1 } },
  curvedRace: { count: 5, types: { ground: 1, ramp: 1, curvedRamp: 1, sphere: 2 } },
  bowlOsc: { count: 2, types: { bowl: 1, sphere: 1 } },
  waveRoad: { count: 2, types: { waveFloor: 1, sphere: 1 } },
};

// ---------- 通用：全部预置结构与引用闭合 ----------
test('预置注册表完整（原有 10 + 新增 24 = 34）', () => {
  assert.deepEqual(Object.keys(PRESETS).sort(), Object.keys(EXPECT).sort());
  for (const id of NEW_IDS) {
    assert.equal(PRESETS[id].id, id);
    assert.ok(PRESETS[id].label.length > 0);
  }
});

test('全部预置可构建：实体数量与类型布局正确、id 唯一', () => {
  for (const [id, exp] of Object.entries(EXPECT)) {
    const doc = getPreset(id);
    assert.ok(doc, id);
    assert.equal(doc.entities.length, exp.count, `${id} 实体数`);
    const counts = {};
    for (const e of doc.entities) counts[e.type] = (counts[e.type] || 0) + 1;
    assert.deepEqual(counts, exp.types, `${id} 类型布局`);
    const idList = doc.entities.map((e) => e.id);
    assert.equal(new Set(idList).size, idList.length, `${id} 实体 id 重复`);
    for (const e of doc.entities) {
      assert.ok(e.id && e.type && e.name, `${id} 实体缺 id/type/name`);
      assert.ok(Array.isArray(e.transform.pos) && e.transform.pos.length === 3);
    }
  }
});

test('attach 与 joints 引用全部闭合（索引在实体集合内）', () => {
  for (const id of Object.keys(EXPECT)) {
    const doc = getPreset(id);
    const ids = new Set(doc.entities.map((e) => e.id));
    for (const e of doc.entities) {
      if (Array.isArray(e.attach)) {
        assert.ok(e.attach.length >= 1 && e.attach.length <= 2, `${id}.${e.name} attach 长度`);
        for (const t of e.attach) assert.ok(ids.has(t), `${id}.${e.name} attach 悬空: ${t}`);
      }
      for (const j of (e.joints || [])) {
        assert.ok(ids.has(j.target), `${id}.${e.name} joint target 悬空: ${j.target}`);
      }
    }
    // 连接类（绳/弹簧）必须 attach 恰好两个实体；传感器恰好一个
    for (const r of byType(doc, 'rope')) assert.equal(r.attach.length, 2, `${id} 绳 attach`);
    for (const s of byType(doc, 'spring')) assert.equal(s.attach.length, 2, `${id} 弹簧 attach`);
    for (const s of doc.entities.filter((e) => /Sensor/.test(e.type))) {
      assert.equal(s.attach.length, 1, `${id} 传感器 attach`);
    }
  }
});

test('数值健全：无 NaN/Infinity、动态体质量>0、弹簧 k>0 且原长>0', () => {
  const walk = (v, path) => {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `非有限数 ${path}=${v}`);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  for (const id of Object.keys(EXPECT)) {
    const doc = getPreset(id);
    walk(doc, id);
    for (const e of doc.entities) {
      if (e.physics.body === 'dynamic') {
        assert.ok(e.physics.mass > 0, `${id}.${e.name} 动态体质量必须>0`);
      }
      if (e.type === 'spring') {
        assert.ok(e.params.stiffness > 0, `${id} 弹簧 k 必须>0`);
        assert.ok(e.params.restLength > 0, `${id} 弹簧原长必须>0`);
        assert.ok(e.params.damping >= 0, `${id} 弹簧阻尼非负`);
      }
      if (e.type === 'rope') assert.ok(e.params.length > 0, `${id} 绳长必须>0`);
    }
    // 文档可 JSON 序列化（撤销/存档主通道）
    assert.ok(JSON.parse(JSON.stringify(doc)).entities.length === doc.entities.length);
  }
});

test('新预置均写验证目标与理论值（meta.assumptions ≥ 2 条）', () => {
  for (const id of NEW_IDS) {
    const doc = getPreset(id);
    assert.ok(Array.isArray(doc.meta.assumptions) && doc.meta.assumptions.length >= 2, id);
    for (const s of doc.meta.assumptions) assert.equal(typeof s, 'string');
  }
});

// ---------- 单摆：T=2π√(L/g)，绳张紧几何 ----------
test('pendulum：绳长 1.2、拉开 0.3rad、球心距锚心=绳长、T≈2.20s', () => {
  const doc = getPreset('pendulum');
  const rope = byType(doc, 'rope')[0];
  const ball = byType(doc, 'sphere')[0];
  const anchor = byType(doc, 'box')[0];
  assert.equal(rope.params.length, 1.2);
  assert.ok(Math.abs(dist(anchor.transform.pos, ball.transform.pos) - 1.2) < 1e-9);
  assert.deepEqual(rope.attach, [anchor.id, ball.id]);
  const pull = Math.atan2(ball.transform.pos[0] - anchor.transform.pos[0],
    anchor.transform.pos[1] - ball.transform.pos[1]);
  assert.ok(Math.abs(pull - 0.3) < 1e-9, `拉开角 ${pull}`);
  const T = 2 * Math.PI * Math.sqrt(1.2 / G0);
  assert.ok(T > 2.19 && T < 2.21, `T=${T}`);
});

// ---------- 锥摆：v=√(g·L·sinθ·tanθ) ----------
test('conical：θ=30° 切向速度按公式、绳水平投影 ρ=0.5、总速度无径向分量', () => {
  const doc = getPreset('conical');
  const rope = byType(doc, 'rope')[0];
  const ball = byType(doc, 'sphere')[0];
  const anchor = byType(doc, 'box')[0];
  assert.equal(rope.params.length, 1.0);
  assert.ok(Math.abs(dist(anchor.transform.pos, ball.transform.pos) - 1.0) < 1e-9);
  const vTh = Math.sqrt(G0 * 1.0 * Math.sin(Math.PI / 6) * Math.tan(Math.PI / 6));
  assert.ok(Math.abs(speed(ball.physics.linvel) - vTh) < 1e-9);
  // 速度与绳方向垂直（纯切向）
  const ropeDir = [anchor.transform.pos[0] - ball.transform.pos[0], anchor.transform.pos[1] - ball.transform.pos[1], 0];
  const dot = ball.physics.linvel[0] * ropeDir[0] + ball.physics.linvel[1] * ropeDir[1];
  assert.ok(Math.abs(dot) < 1e-9);
});

// ---------- 竖直圆周：临界 √(5gL)=7.67，两道 7.0/8.0 ----------
test('vertCircle：两套独立绳长 1.2、底部水平速度恰为 7 与 8、z 错开', () => {
  const doc = getPreset('vertCircle');
  const balls = byType(doc, 'sphere');
  const ropes = byType(doc, 'rope');
  assert.deepEqual(balls.map((b) => b.physics.linvel[0]).sort(), [7, 8]);
  assert.ok(balls.every((b) => b.physics.linvel[1] === 0 && b.physics.linvel[2] === 0));
  const zs = balls.map((b) => b.transform.pos[2]);
  assert.notEqual(zs[0], zs[1]);
  const vc = Math.sqrt(5 * 1.2 * G0);
  assert.ok(vc > 7.66 && vc < 7.68);
  for (const r of ropes) assert.equal(r.params.length, 1.2);
  // 每球与自己的锚等距 1.2（绳端闭合）
  for (const r of ropes) {
    const a = doc.entities.find((e) => e.id === r.attach[0]);
    const b = doc.entities.find((e) => e.id === r.attach[1]);
    assert.ok(Math.abs(dist(a.transform.pos, b.transform.pos) - 1.2) < 1e-9);
  }
});

// ---------- 水平弹簧振子：T=2π√(m/k)，damping 必须显式 0 ----------
test('springSHM：k=20、damping=0（默认 0.5 回归锚）、T≈1.40s、墙球等高（纯水平力）', () => {
  const doc = getPreset('springSHM');
  const spring = byType(doc, 'spring')[0];
  const ball = byType(doc, 'sphere')[0];
  const wall = byType(doc, 'box')[0];
  assert.equal(spring.params.stiffness, 20);
  assert.equal(spring.params.damping, 0, 'MDL-20：spring 默认 damping 0.5 必须显式置 0');
  assert.deepEqual(spring.attach, [wall.id, ball.id]);
  assert.equal(ball.physics.mass, 1);
  assert.equal(wall.transform.pos[1], ball.transform.pos[1]);
  const T = 2 * Math.PI * Math.sqrt(1 / 20);
  assert.ok(T > 1.39 && T < 1.41);
  // 振幅 = 初始拉伸，且压至最左不穿墙（墙右缘 −0.9 vs 球最左表面）
  const stretch = dist(wall.transform.pos, ball.transform.pos) - spring.params.restLength;
  assert.ok(Math.abs(stretch - 0.6) < 1e-9, `拉伸 ${stretch}`);
  const eq = wall.transform.pos[0] + spring.params.restLength;
  assert.ok(eq - stretch - ball.params.radius > wall.transform.pos[0] + wall.params.sx / 2, '极端位置不穿墙');
});

// ---------- 竖直弹簧振子：从自然长释放 ----------
test('springVert：从自然长静止释放（球-锚距=原长）、damping=0、平衡位下移 mg/k', () => {
  const doc = getPreset('springVert');
  const spring = byType(doc, 'spring')[0];
  const ball = byType(doc, 'sphere')[0];
  const anchor = byType(doc, 'box')[0];
  assert.equal(spring.params.damping, 0);
  assert.equal(spring.params.stiffness, 30);
  assert.ok(Math.abs(dist(anchor.transform.pos, ball.transform.pos) - spring.params.restLength) < 1e-9);
  assert.ok(speed(ball.physics.linvel) === 0);
  const maxStretch = 2 * ball.physics.mass * G0 / spring.params.stiffness;
  assert.ok(maxStretch > 0.65 && maxStretch < 0.66);            // ≈0.654
  assert.ok(ball.transform.pos[1] - maxStretch - ball.params.radius > 0, '最低点不触地');
});

// ---------- 耦合双振子：质心 0.5、相对振动 T=2π√(m/2k) ----------
test('coupled：两块同速 0.5、k=15、初始拉伸 0.3、地面加长 sx=14', () => {
  const doc = getPreset('coupled');
  const blocks = byType(doc, 'box');
  const spring = byType(doc, 'spring')[0];
  const ground = byType(doc, 'ground')[0];
  assert.equal(ground.params.sx, 14);
  assert.ok(blocks.every((b) => b.physics.linvel[0] === 0.5));
  assert.equal(spring.params.stiffness, 15);
  assert.equal(spring.params.damping, 0);
  const sep = dist(blocks[0].transform.pos, blocks[1].transform.pos);
  assert.ok(Math.abs(sep - (spring.params.restLength + 0.3)) < 1e-9, `间距 ${sep}`);
  const T = 2 * Math.PI * Math.sqrt(1 / (2 * 15));
  assert.ok(T > 1.14 && T < 1.16);
  // 最小间距 > 两块半宽之和（永不相碰）
  assert.ok(spring.params.restLength - 0.3 > blocks[0].params.sx);
});

// ---------- 弹簧弹射：轻推板方案（弹簧不能直连弹丸） ----------
test('springGun：弹簧连墙-推板（非球）、压缩量恰 0.5、球与板同高贴合', () => {
  const doc = getPreset('springGun');
  const spring = byType(doc, 'spring')[0];
  const wall = byType(doc, 'box').find((b) => b.name === '固定墙');
  const plate = doc.entities.find((e) => e.name.includes('推板'));
  const ball = byType(doc, 'sphere')[0];
  assert.deepEqual(spring.attach, [wall.id, plate.id], '弹簧必须连墙-推板（拉推双向不能直连球）');
  const compression = spring.params.restLength - Math.abs(plate.transform.pos[0] - wall.transform.pos[0]);
  assert.ok(Math.abs(compression - 0.5) < 1e-6, `压缩量 ${compression}`);
  assert.equal(plate.physics.mass, 0.02);
  assert.equal(plate.transform.pos[1], ball.transform.pos[1], '推板与球等高（水平推力）');
  const gap = (ball.transform.pos[0] - ball.params.radius) - (plate.transform.pos[0] + plate.params.sx / 2);
  assert.ok(gap >= 0 && gap < 0.01, `球板间距 ${gap}`);
  // 出口速度与平抛落点（轻板修正）
  const v = 0.5 * Math.sqrt(20 / (1 + 0.02));
  assert.ok(v > 2.20 && v < 2.23);
});

// ---------- 一维碰撞实验台：双泳道 e=1 / e=0 ----------
test('collLab：四球两泳道，e 恰为 {1,1,0,0}，同泳道同 e、光滑地面', () => {
  const doc = getPreset('collLab');
  const balls = byType(doc, 'sphere');
  assert.deepEqual(balls.map((b) => b.physics.restitution).sort(), [0, 0, 1, 1]);
  const lanes = {};
  for (const b of balls) {
    const z = b.transform.pos[2];
    lanes[z] = lanes[z] || [];
    lanes[z].push(b.physics.restitution);
  }
  const laneVals = Object.values(lanes);
  assert.equal(laneVals.length, 2);
  for (const vals of laneVals) assert.equal(vals[0], vals[1], '同泳道两球必须同 e（引擎按平均合成）');
  assert.ok(balls.every((b) => b.physics.friction === 0));
  const inc = balls.filter((b) => b.physics.linvel[0] > 0);
  assert.equal(inc.length, 2);
});

// ---------- 子弹打木块：共速 v'=mv/(m+M) ----------
test('bulletBlock：弹丸 0.05kg v=15、木块 1kg、双方 e=0、共速 0.714', () => {
  const doc = getPreset('bulletBlock');
  const bullet = byType(doc, 'sphere')[0];
  const block = byType(doc, 'box')[0];
  assert.equal(bullet.physics.mass, 0.05);
  assert.equal(bullet.params.radius, 0.03);
  assert.equal(bullet.physics.linvel[0], 15);
  assert.equal(block.physics.mass, 1);
  assert.equal(bullet.physics.restitution, 0);
  assert.equal(block.physics.restitution, 0);
  const vCommon = bullet.physics.mass * 15 / (bullet.physics.mass + block.physics.mass);
  assert.ok(Math.abs(vCommon - 0.7143) < 1e-3);
  // 弹丸飞行高度=木块中心高度（正对撞击）
  assert.equal(bullet.transform.pos[1], block.transform.pos[1]);
});

// ---------- 牛顿摆：5 球等长预接触 + 左球拉开 ----------
test('newtonCradle：5 绳等长 0.8、相邻球心距=2r 精确对齐、e=1、左球拉开仍张紧', () => {
  const doc = getPreset('newtonCradle');
  const balls = byType(doc, 'sphere');
  const ropes = byType(doc, 'rope');
  assert.equal(ropes.length, 5);
  assert.ok(ropes.every((r) => r.params.length === 0.8));
  assert.ok(balls.every((b) => b.physics.restitution === 1));
  const r = balls[0].params.radius;
  const pulled = balls.find((b) => b.transform.pos[0] < -0.4);
  const rest = balls.filter((b) => b !== pulled).sort((a, b) => a.transform.pos[0] - b.transform.pos[0]);
  assert.equal(rest.length, 4);
  for (let i = 1; i < rest.length; i++) {
    assert.ok(Math.abs(rest[i].transform.pos[0] - rest[i - 1].transform.pos[0] - 2 * r) < 1e-9, '预接触对齐');
  }
  assert.ok(Math.abs(rest[0].transform.pos[1] - (1.8 - 0.8)) < 1e-9);
  // 拉开球与自己的吊点距离 = 绳长（保持张紧），且 1:1 绑定
  for (const ropeU of ropes) {
    const a = doc.entities.find((e) => e.id === ropeU.attach[0]);
    const b = doc.entities.find((e) => e.id === ropeU.attach[1]);
    assert.ok(Math.abs(dist(a.transform.pos, b.transform.pos) - 0.8) < 1e-9);
  }
});

// ---------- 水平碰撞链：5 球预接触 + 1 入射 ----------
test('ballChain：5 球球心距=2r 预接触、入射球 vx=2、全体 e=0.95、含地面', () => {
  const doc = getPreset('ballChain');
  const balls = byType(doc, 'sphere');
  assert.equal(balls.length, 6);
  assert.equal(byType(doc, 'ground').length, 1);
  const incident = balls.find((b) => b.physics.linvel[0] > 0);
  assert.equal(incident.physics.linvel[0], 2);
  const row = balls.filter((b) => b !== incident).sort((a, b) => a.transform.pos[0] - b.transform.pos[0]);
  assert.equal(row.length, 5);
  const r = row[0].params.radius;
  for (let i = 1; i < row.length; i++) {
    assert.ok(Math.abs(row[i].transform.pos[0] - row[i - 1].transform.pos[0] - 2 * r) < 1e-9);
  }
  assert.ok(balls.every((b) => b.physics.restitution === 0.95));
  assert.ok(row.every((b) => b.transform.pos[1] === b.params.radius), '贴地（球心=半径）');
});

// ---------- 反弹高度对照：三分道地面同步 e ----------
test('bounceCompare：三球 e={0.9,0.5,0.2} 同高 2m，每道地面 e 与球同值（平均合成不被稀释）', () => {
  const doc = getPreset('bounceCompare');
  const balls = byType(doc, 'sphere');
  const grounds = byType(doc, 'ground');
  assert.deepEqual(balls.map((b) => b.physics.restitution).sort(), [0.2, 0.5, 0.9]);
  assert.ok(balls.every((b) => b.transform.pos[1] === 2));
  for (const b of balls) {
    const g = grounds.find((g2) => g2.transform.pos[2] === b.transform.pos[2]);
    assert.ok(g, `z=${b.transform.pos[2]} 缺分道地面`);
    assert.equal(g.physics.restitution, b.physics.restitution, '地面 e 与球同步');
  }
  for (const b of balls) {
    const h1 = b.physics.restitution ** 2 * 2;                  // h₁=e²h₀
    assert.ok(h1 > 0 && h1 <= 1.63);
  }
});

// ---------- 平抛与自由落体同时落地 ----------
test('galileoDrop：两球同高 2m、一 vx=2 一静止、z 错开、e=0.05', () => {
  const doc = getPreset('galileoDrop');
  const balls = byType(doc, 'sphere');
  const proj = balls.find((b) => b.physics.linvel[0] === 2);
  const drop = balls.find((b) => b.physics.linvel[0] === 0);
  assert.ok(proj && drop);
  assert.equal(proj.transform.pos[1], drop.transform.pos[1]);
  assert.equal(proj.transform.pos[1], 2);
  assert.notEqual(proj.transform.pos[2], drop.transform.pos[2]);
  assert.ok(balls.every((b) => b.physics.restitution === 0.05));
  const t = Math.sqrt(2 * (2 - proj.params.radius) / G0);
  assert.ok(t > 0.60 && t < 0.62);
});

// ---------- 斜抛射程角：v=5，30/45/60 ----------
test('rangeAngles：三球速度均为 5、角度 {30,45,60}、45° 射程最大', () => {
  const doc = getPreset('rangeAngles');
  const balls = byType(doc, 'sphere');
  assert.equal(balls.length, 3);
  const angles = [];
  for (const b of balls) {
    const [vx, vy] = b.physics.linvel;
    assert.ok(Math.abs(Math.hypot(vx, vy) - 5) < 1e-9, '同速 5');
    angles.push(Math.atan2(vy, vx) * 180 / Math.PI);
  }
  assert.deepEqual(angles.map((a) => +a.toFixed(6)).sort(), [30, 45, 60]);
  const zs = balls.map((b) => b.transform.pos[2]);
  assert.equal(new Set(zs).size, 3, 'z 三泳道错开');
  const ranges = balls.map((b) => 25 * Math.sin(2 * Math.atan2(b.physics.linvel[1], b.physics.linvel[0])) / G0);
  assert.ok(Math.abs(ranges.sort((x, y) => y - x)[0] - 25 / G0) < 1e-9, '45° 射程 v²/g 最大');
});

// ---------- 阿特伍德大质量比 ----------
test('atwoodHeavy：m1=3/m2=1、双球 onPulley 绑定、a=(m1−m2)g/(m1+m2)≈4.91', () => {
  const doc = getPreset('atwoodHeavy');
  const pulley = byType(doc, 'pulley')[0];
  const balls = byType(doc, 'sphere');
  assert.deepEqual(balls.map((b) => b.physics.mass).sort(), [1, 3]);
  assert.ok(balls.every((b) => b.physics.onPulley === pulley.id));
  const [m1, m2] = [3, 1];
  const a = (m1 - m2) * G0 / (m1 + m2);
  assert.ok(a > 4.90 && a < 4.92);
});

// ---------- 双星互绕：v=√(G·m/(2d)) ----------
test('binaryStar：G=1、双星 50kg 间距 4、反向 2.5 m/s、总动量为零', () => {
  const doc = getPreset('binaryStar');
  assert.equal(doc.G, 1);
  const stars = byType(doc, 'celestial');
  assert.ok(stars.every((s) => s.physics.mass === 50));
  assert.ok(stars.every((s) => s.physics.gravitating === true));
  assert.ok(Math.abs(Math.abs(stars[0].transform.pos[0]) - 2) < 1e-9);
  assert.equal(dist(stars[0].transform.pos, stars[1].transform.pos), 4);
  const v = Math.sqrt(1 * 50 / (2 * 4));
  assert.ok(stars.every((s) => Math.abs(speed(s.physics.linvel) - v) < 1e-9));
  const p = stars.reduce((acc, s) => [acc[0] + s.physics.mass * s.physics.linvel[0],
    acc[1] + s.physics.mass * s.physics.linvel[1], acc[2] + s.physics.mass * s.physics.linvel[2]], [0, 0, 0]);
  assert.ok(Math.hypot(...p) < 1e-9, '质心静止');
});

// ---------- 三星拉格朗日：等边 + 各切向 √(G·m/a) ----------
test('threeBody：G=1、等边三角形边长 3、各速 √10、速度切向（径向分量为零）', () => {
  const doc = getPreset('threeBody');
  assert.equal(doc.G, 1);
  const stars = byType(doc, 'celestial');
  assert.ok(stars.every((s) => s.physics.mass === 30));
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      assert.ok(Math.abs(dist(stars[i].transform.pos, stars[j].transform.pos) - 3) < 1e-9, '等边边长 3');
    }
  }
  const v = Math.sqrt(1 * 30 / 3);
  const p = [0, 0, 0];
  for (const s of stars) {
    assert.ok(Math.abs(speed(s.physics.linvel) - v) < 1e-9);
    // 切向：速度·径向 ≈ 0
    const dot = s.physics.linvel[0] * s.transform.pos[0] + s.physics.linvel[2] * s.transform.pos[2];
    assert.ok(Math.abs(dot) < 1e-9, '速度须切向');
    for (let k = 0; k < 3; k++) p[k] += s.physics.mass * s.physics.linvel[k];
  }
  assert.ok(Math.hypot(...p) < 1e-9, '质心静止');
});

// ---------- 滚动竞速：同质量同半径，坡宽防侧翻 ----------
test('rollRace：球/圆柱同质量同半径、坡角≈15°、坡宽≥2.2×半径', () => {
  const doc = getPreset('rollRace');
  const ball = byType(doc, 'sphere')[0];
  const cyl = byType(doc, 'cylinder')[0];
  const ramp = byType(doc, 'ramp')[0];
  assert.equal(ball.physics.mass, cyl.physics.mass);
  assert.equal(ball.params.radius, cyl.params.radius);
  const angle = Math.atan2(ramp.params.height, ramp.params.length) * 180 / Math.PI;
  assert.ok(angle > 14 && angle < 16, `坡角 ${angle}`);
  assert.ok(ramp.params.width >= 2.2 * ball.params.radius);
  // 圆柱轴放倒（rot x=π/2），与球同一起跑线（同 x/y）
  assert.ok(Math.abs(cyl.transform.rot[0] - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(cyl.transform.pos[0] - ball.transform.pos[0]) < 1e-9);
});

// ---------- 摩擦自锁：tanθ=μ 临界 ----------
test('frictionLock：坡 tanθ=0.5（26.57°）、块与坡 μ=0.5、块姿态贴坡面', () => {
  const doc = getPreset('frictionLock');
  const ramp = byType(doc, 'ramp')[0];
  const block = byType(doc, 'box')[0];
  const tan = ramp.params.height / ramp.params.length;
  assert.ok(Math.abs(tan - 0.5) < 1e-9);
  assert.equal(ramp.physics.friction, 0.5);
  assert.equal(block.physics.friction, 0.5);
  const th = Math.atan(0.5);
  assert.ok(Math.abs(block.transform.rot[2] + th) < 1e-6, '块旋转对齐坡面');
});

// ---------- 板块模型：μ 分配反解（平均合成口径） ----------
test('blockOnBlock：板 μ=0/滑块 μ=0.8 → 叠面有效 0.4、板-地 0、共速 4/3', () => {
  const doc = getPreset('blockOnBlock');
  const board = doc.entities.find((e) => e.name.includes('滑板'));
  const slider = doc.entities.find((e) => e.name.includes('滑块'));
  const ground = byType(doc, 'ground')[0];
  assert.equal(board.physics.friction, 0);
  assert.equal(slider.physics.friction, 0.8);
  assert.equal(ground.physics.friction, 0);
  const muInterface = (board.physics.friction + slider.physics.friction) / 2;
  assert.ok(Math.abs(muInterface - 0.4) < 1e-9, '引擎摩擦平均合成');
  assert.equal(board.physics.mass, 2);
  assert.equal(slider.physics.mass, 1);
  assert.equal(board.physics.linvel[0], 2);
  // 叠放贴合：板顶 = 块底
  assert.ok(Math.abs((board.transform.pos[1] + board.params.sy / 2)
    - (slider.transform.pos[1] - slider.params.sy / 2)) < 1e-9);
  const vCommon = 2 * 2 / 3;
  assert.ok(Math.abs(vCommon - 1.3333) < 1e-3);
});

// ---------- 失重演示：力传感器绑定 ----------
test('weightless：力传感器 attach 恰绑球、球上抛 (1.2,3)、飞行期传感器读数口径为接触合力', () => {
  const doc = getPreset('weightless');
  const ball = byType(doc, 'sphere')[0];
  const sensor = byType(doc, 'forceSensor')[0];
  assert.deepEqual(sensor.attach, [ball.id]);
  assert.deepEqual(ball.physics.linvel, [1.2, 3, 0]);
  assert.equal(ball.physics.linDamping, 0, 'linDamping=0 时传感器读数精确（阻尼补偿项为零）');
  assert.ok(ball.physics.mass * G0 > 9.8, '静止读数 mg≈9.81 N');
});
