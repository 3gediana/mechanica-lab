// parse-schema.js — 题图解析结果的客户端校验 / 规范化 / 建场计划
// 模型输出不可信：一切数值过范围检查，类型映射到 registry 组件 id；未给出的量不编造（标 默认/需确认）。

const TYPE_MAP = {
  ramp: 'ramp', sphere: 'sphere', box: 'box', cylinder: 'cylinder', ground: 'ground',
  celestial: 'celestial', planet: 'celestial', star: 'celestial',
  斜面: 'ramp', 球: 'sphere', 方块: 'box', 圆柱: 'cylinder', 地面: 'ground',
  天体: 'celestial', 行星: 'celestial', 恒星: 'celestial', 卫星: 'celestial',
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
      if (k === 'position') {
        const arr = Array.isArray(v) ? v.map((x) => Number(x)) : null;
        if (arr && arr.length === 3 && arr.every(Number.isFinite)) given.position = arr;
        continue;
      }
      if (k === 'angvel') {
        const arr = Array.isArray(v) ? v.map((x) => Number(x)) : null;
        if (arr && arr.length === 3 && arr.every(Number.isFinite)) given.angvel = arr;
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
    G: num(raw.G, [1e-14, 1e6]),            // 场景引力常数（天体题给；null=保持 doc 现值）
    kind: str(raw.kind, ''),                  // rotation = 角动量/转台类（需要自动 joint 布局）
    joint: raw.joint && typeof raw.joint === 'object' ? {
      type: 'prismatic',
      from: Math.max(0, Number(raw.joint.from) | 0),
      to: Math.max(0, Number(raw.joint.to) | 0),
      axis: Array.isArray(raw.joint.axis) ? raw.joint.axis.map((x) => Number(x)) : [1, 0, 0],
      limits: Array.isArray(raw.joint.limits) ? raw.joint.limits.map((x) => Number(x)) : [0.15, 1.05],
      anchor1: Array.isArray(raw.joint.anchor1) ? raw.joint.anchor1.map((x) => Number(x)) : [0, 0.14, 0],
      anchor2: Array.isArray(raw.joint.anchor2) ? raw.joint.anchor2.map((x) => Number(x)) : [0, 0, 0],
    } : null,
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

// ---------- 角动量（转台+径向滑块）布局：自动 prismatic joint ----------
// 第一个 cylinder = 转台（自动 4 辐条、ω0 默认 3 rad/s），第一个 box = 滑块（初始 r=0.7、切向速度匹配）。
// joint 用实体索引引用（from/to），applyAgentPlan 建场后映射为真实 id。
function rotationLayout(plan) {
  const out = [];
  const tableE = plan.entities.find((e) => e.type === 'cylinder');
  const sliderE = plan.entities.find((e) => e.type === 'box') || plan.entities.find((e) => e.type === 'sphere');
  if (!tableE || !sliderE) return out;
  const R = tableE.given.radius ?? 1.2;
  const H = tableE.given.height ?? 0.12;
  const M = tableE.given.mass ?? 8;
  const omega0 = (tableE.given.angvel ?? [0, 3, 0])[1];
  const r0 = 0.7;
  const ms = sliderE.given.mass ?? 1.5;
  out.push({
    type: 'cylinder', name: tableE.name || '转台', source: 'agent',
    params: { radius: R, height: H, spokes: 4 },
    transform: { pos: [0, 0.42, 0], rot: [0, 0, 0] },
    physics: {
      body: 'dynamic', mass: M, friction: 0, restitution: 0.1,
      linvel: [0, 0, 0], angvel: [0, omega0, 0],
      linDamping: 0, angDamping: 0, gravityScale: 0,
    },
    render: { material: 'wood' },
  });
  out.push({
    type: 'box', name: sliderE.name || '滑块', source: 'agent',
    params: { sx: 0.14, sy: 0.14, sz: 0.14 },
    transform: { pos: [r0, 0.56, 0], rot: [0, 0, 0] },
    physics: {
      body: 'dynamic', mass: ms, friction: 0, restitution: 0.1,
      linvel: [0, 0, -omega0 * r0], angvel: [0, 0, 0],
      linDamping: 0, angDamping: 0, gravityScale: 0,
    },
    render: { material: 'chrome' },
  });
  return out;
}

// ---------- 建场计划：plan → 每实体的 registry overrides（位置/参数/物理） ----------
// 布局规则：斜面置原点；球按斜面几何放到近顶端面（留球半径避让高墙）；其余放原点上方。
// 几何语义：题目"斜面长"= 坡面长（斜边）；registry 的 length/height 是底边水平长与高，
// 故给 angleDeg 时做换算 base = L·cosθ, height = L·sinθ（球心实际可滑全程 ≠ 全长，解释层处理）。
export function planToOverrides(plan) {
  if (plan.kind === 'rotation') return rotationLayout(plan);
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
      // 无斜面（对撞类）布局：沿 x 排开，悬浮于地面上方（gravityScale=0 + 无摩擦）——
      // "光滑水平面"理想化：不落地不接触，水平动量不被地面摩擦污染，动量守恒才可对照
      if (!rampGeom) {
        const order = plan.entities.filter((x) => x.type === 'sphere').indexOf(e);
        const n = plan.entities.filter((x) => x.type === 'sphere').length;
        const r = e.given.radius ?? 0.15;
        o.transform = { pos: [(order - (n - 1) / 2) * 1.6, r + 0.005, 0], rot: [0, 0, 0] };
        o.physics.friction = 0;
        o.physics.gravityScale = 0;
      } else {
        o.transform = { pos: ballOnRamp(rampGeom), rot: [0, 0, 0] };
      }
      if (e.given.velocity) o.physics.linvel = e.given.velocity;
    } else if (e.type === 'box') {
      o.params = { sx: 0.3, sy: 0.3, sz: 0.3 };
      o.physics = { mass: e.given.mass ?? 1, friction: e.given.friction ?? 0.4 };
      o.transform = { pos: [0.6, 0.35, 0], rot: [0, 0, 0] };
      if (e.given.velocity) o.physics.linvel = e.given.velocity;
    } else if (e.type === 'celestial') {
      o.params = { radius: e.given.radius ?? 0.5 };
      o.physics = {
        mass: e.given.mass ?? 100,
        linvel: e.given.velocity ?? [0, 0, 0],
      };
      o.transform = { pos: e.given.position ?? [0, 0, 0], rot: [0, 0, 0] };
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
  // 对撞类（无斜面且 ≥2 球）：自动补光滑地面承接（对撞题的隐含装置，假设记录在 plan.assumptions）
  if (!ramp && plan.entities.filter((e) => e.type === 'sphere').length >= 2) {
    out.push({
      type: 'ground', name: '光滑地面', source: 'agent',
      params: { sx: 12, sy: 0.1, sz: 6 },
      transform: { pos: [0, -0.05, 0], rot: [0, 0, 0] },
      physics: { body: 'fixed', friction: pairFriction != null ? pairFriction : 0, restitution: 0.05 },
    });
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
