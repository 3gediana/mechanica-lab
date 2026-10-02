// parse-schema.js — 题图解析结果的客户端校验 / 规范化 / 建场计划
// 模型输出不可信：一切数值过范围检查，类型映射到 registry 组件 id；未给出的量不编造（标 默认/需确认）。

const TYPE_MAP = {
  ramp: 'ramp', sphere: 'sphere', box: 'box', cylinder: 'cylinder', ground: 'ground',
  斜面: 'ramp', 球: 'sphere', 方块: 'box', 圆柱: 'cylinder', 地面: 'ground',
};

const RANGES = {
  angleDeg: [1, 80], length: [0.1, 12], height: [0.02, 6], width: [0.05, 6],
  radius: [0.01, 2], mass: [0.01, 10000], friction: [0, 2], restitution: [0, 1],
};

function num(v, [min, max]) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

// raw = 服务端/fixture 返回的解析 JSON → {ok, plan|errors}
export function normalizeParse(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['解析结果不是对象'] };
  const entities = [];
  for (const e of (Array.isArray(raw.entities) ? raw.entities : [])) {
    const type = TYPE_MAP[e.type];
    if (!type) { errors.push(`未知实体类型: ${e.type}（已跳过）`); continue; }
    const given = {};
    for (const [k, v] of Object.entries(e.given || {})) {
      if (k === 'velocity') {
        const arr = Array.isArray(v) ? v.map((x) => Number(x)) : null;
        if (arr && arr.length === 3 && arr.every(Number.isFinite)) given.velocity = arr;
        continue;
      }
      if (!(k in RANGES)) continue;                    // 未知键丢弃，不猜
      const n = num(v, RANGES[k]);
      if (n === null) errors.push(`${e.name || type}.${k} 值无效（${v}），已忽略`);
      else given[k] = n;
    }
    entities.push({ type, name: String(e.name || type).slice(0, 24), confidence: clamp01(e.confidence), given });
  }
  if (!entities.length) return { ok: false, errors: [...errors, '没有可用的实体'] };

  const plan = {
    fixture: raw._fixture === true,
    questionType: str(raw.questionType, '未知题型'),
    goal: str(raw.goal, ''),
    gravity: num(raw.gravity, [0, 50]),
    entities,                                        // 保留 given 供 UI 标来源
    observations: strs(raw.observations),
    unknowns: strs(raw.unknowns),
    assumptions: strs(raw.assumptions),
    confidence: clamp01(raw.confidence) ?? 0.5,
  };
  if (plan.gravity === null) { plan.gravity = 9.81; plan.gravityDefault = true; }
  return { ok: true, plan, errors };
}

function str(v, d) { return typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : d; }
function strs(v) { return Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((s) => s.slice(0, 120)).slice(0, 8) : []; }
function clamp01(v) { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : null; }

// ---------- 建场计划：plan → 每实体的 registry overrides（位置/参数/物理） ----------
// 布局规则：斜面置原点；球按斜面几何放到近顶端面（留球半径避让高墙）；其余放原点上方。
// 几何语义：题目"斜面长"= 坡面长（斜边）；registry 的 length/height 是底边水平长与高，
// 故给 angleDeg 时做换算 base = L·cosθ, height = L·sinθ（球心实际可滑全程 ≠ 全长，解释层处理）。
export function planToOverrides(plan) {
  const ramp = plan.entities.find((e) => e.type === 'ramp');
  let rampGeom = null;
  if (ramp) {
    const g = ramp.given;
    const width = g.width ?? 0.5;
    if (g.angleDeg != null) {
      const Lslope = g.length ?? 2.0;                       // 坡面长（斜边）
      const th = g.angleDeg * Math.PI / 180;
      const base = Lslope * Math.cos(th);
      const height = Lslope * Math.sin(th);
      rampGeom = { base, height, angleDeg: g.angleDeg };
    } else {
      const base = g.length ?? 2.0;                          // 无角度：length 按底边处理
      const height = g.height ?? base * Math.tan(30 * Math.PI / 180);
      rampGeom = { base, height, angleDeg: Math.atan2(height, base) * 180 / Math.PI };
    }
  }

  const out = [];
  // 摩擦是成对属性，模型可能把"不计摩擦"标在球上或斜面上（都是正确物理位置）：
  // 取两侧显式给定摩擦的最小值应用到整对（Rapier 默认取平均，min 注入两侧即得意图配对值）。
  const ballEnt = plan.entities.find((e) => e.type === 'sphere');
  const fBall = ballEnt ? ballEnt.given.friction : null;
  const fRamp = ramp ? ramp.given.friction : null;
  const explicitF = [fBall, fRamp].filter((v) => v != null);
  const pairFriction = explicitF.length ? Math.min(...explicitF) : null;
  for (const e of plan.entities) {
    const o = { type: e.type, name: e.name, source: 'agent' };
    if (e.type === 'ramp' && rampGeom) {
      o.params = {
        length: +rampGeom.base.toFixed(4),
        height: +rampGeom.height.toFixed(4),
        width: ramp.given.width ?? 0.5,
      };
      o.transform = { pos: [0, 0.05, 0], rot: [0, 0, 0] };
      // 摩擦是成对属性：固定斜面也必须带上题目给的摩擦（缺省 0.4），否则 Rapier 取平均把光滑面变粗糙
      o.physics = {
        body: 'fixed',
        friction: fRamp ?? pairFriction ?? 0.4,
        restitution: ramp.given.restitution ?? 0.05,
      };
    } else if (e.type === 'sphere') {
      o.params = { radius: e.given.radius ?? 0.15 };
      o.physics = {
        mass: e.given.mass ?? 1,
        friction: e.given.friction ?? pairFriction ?? 0.3,
        restitution: e.given.restitution ?? 0.1,
        linDamping: 0, angDamping: 0.02,       // 教学演化不加空气阻尼，守恒量才可对照理论
      };
      o.transform = { pos: ballOnRamp(rampGeom), rot: [0, 0, 0] };
      if (e.given.velocity) o.physics.linvel = e.given.velocity;
    } else if (e.type === 'box') {
      o.params = { sx: 0.3, sy: 0.3, sz: 0.3 };
      o.physics = { mass: e.given.mass ?? 1, friction: e.given.friction ?? 0.4 };
      o.transform = { pos: [0.6, 0.35, 0], rot: [0, 0, 0] };
      if (e.given.velocity) o.physics.linvel = e.given.velocity;
    } else if (e.type === 'cylinder') {
      o.params = { radius: e.given.radius ?? 0.12, height: 0.3 };
      o.physics = { mass: e.given.mass ?? 1 };
      o.transform = { pos: [0, 0.2, 0.8], rot: [0, 0, 0] };
    } else if (e.type === 'ground') {
      o.params = { sx: 10, sy: 0.1, sz: 8 };
      o.transform = { pos: [0, -0.05, 0], rot: [0, 0, 0] };
    }
    out.push(o);
  }
  return out;
}

// 球心位置：高墙在 -x，球心距墙留出半径+间隙，置于坡面近顶端
function ballOnRamp(rampGeom) {
  if (!rampGeom) return [0, 0.5, 0];
  const r = 0.15;
  const xl = -rampGeom.base / 2 + r + 0.01;
  const surfLocal = rampGeom.height * (1 - (xl + rampGeom.base / 2) / rampGeom.base);
  const yOff = r / Math.cos(rampGeom.angleDeg * Math.PI / 180);
  const worldY = 0.05 + surfLocal + yOff + 0.01;     // 0.05 = 斜面放置高度
  return [+xl.toFixed(3), +worldY.toFixed(3), 0];
}
