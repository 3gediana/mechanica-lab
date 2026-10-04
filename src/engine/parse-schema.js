// parse-schema.js — 题图解析结果的客户端校验 / 规范化 / 建场计划
// 模型输出不可信：一切数值过范围检查，类型映射到 registry 组件 id；未给出的量不编造（标 默认/需确认）。

const TYPE_MAP = {
  ramp: 'ramp', sphere: 'sphere', box: 'box', cylinder: 'cylinder', ground: 'ground',
  celestial: 'celestial', planet: 'celestial', star: 'celestial', pulley: 'pulley', 滑轮: 'pulley',
  斜面: 'ramp', 球: 'sphere', 方块: 'box', 圆柱: 'cylinder', 地面: 'ground',
  天体: 'celestial', 行星: 'celestial', 恒星: 'celestial', 卫星: 'celestial',
};

const RANGES = {
  angleDeg: [1, 80], length: [0.1, 12], height: [0.02, 6], width: [0.05, 6],
  radius: [0.01, 2], mass: [0.01, 10000], friction: [0, 2], restitution: [0, 1],
  momentOfInertia: [0.001, 1e6], momentInertia: [0.001, 1e6],   // 转台类：模型两种拼写都收
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

  // 重力防御：解析的是一道"物理题"，必须发生在重力场里。真实模型偶尔把未提重力的题
  // 解析成 gravity=0（失重）——建场后物体不运动，教学演示直接报废。0 视为无效值
  // （报错+不生成重力变更）；确需零重力场景请手动改环境卡。
  let gravityRaw = raw.gravity;
  if (gravityRaw === 0) {
    errors.push('gravity=0 已忽略（解析题目需要在重力场中；零重力场景请在环境卡手动设置）');
    gravityRaw = null;
  }

  const plan = {
    fixture: raw._fixture === true,
    questionType: str(raw.questionType, '未知题型'),
    goal: str(raw.goal, ''),
    gravity: num(gravityRaw, [0.01, 50]),
    G: num(raw.G, [1e-14, 1e6]),            // 场景引力常数（天体题给；null=保持 doc 现值）
    kind: str(raw.kind, ''),                  // rotation = 角动量/转台类（需要自动 joint 布局）
    attaches: Array.isArray(raw.attaches) ? raw.attaches.map((a) => ({
      type: a.type === 'rope' ? 'rope' : 'spring',
      from: Math.max(0, Number(a.from) | 0),
      to: Math.max(0, Number(a.to) | 0),
      length: num(a.length, [0.05, 20]),
      stiffness: num(a.stiffness, [0.5, 5000]),
      restLength: num(a.restLength, [0.1, 10]),
      damping: num(a.damping, [0, 50]),
    })).filter((a) => a.from !== a.to).slice(0, 4) : [],
    joint: raw.joint && typeof raw.joint === 'object' ? {
      type: raw.joint.type === 'revolute' ? 'revolute' : 'prismatic',
      from: Math.max(0, Number(raw.joint.from) | 0),
      to: Math.max(0, Number(raw.joint.to) | 0),
      axis: Array.isArray(raw.joint.axis) ? raw.joint.axis.map((x) => Number(x)) : [1, 0, 0],
      limits: Array.isArray(raw.joint.limits) ? raw.joint.limits.map((x) => Number(x)) : [0.15, 1.05],
      anchor1: Array.isArray(raw.joint.anchor1) ? raw.joint.anchor1.map((x) => Number(x)) : [0, 0, 0],
      anchor2: Array.isArray(raw.joint.anchor2) ? raw.joint.anchor2.map((x) => Number(x)) : [0, 0, 0],
    } : null,
    entities,                                        // 保留 given 供 UI 标来源
    observations: strs(raw.observations),
    anchorPoints: strs(raw.anchorPoints),            // 固定点（支撑/悬挂/铰接点描述；Goal 七）
    environment: str(raw.environment, ''),           // 环境条件（光滑水平面/不计空气阻力…）
    keyPoints: strs(raw.keyPoints),                  // 题目关键点（关键位置/时刻/事件）
    unknowns: strs(raw.unknowns),
    uncertain: strs(raw.uncertain),                  // 无法确定的内容（需用户确认；与未知量并列）
    assumptions: strs(raw.assumptions),
    confidence: clamp01(raw.confidence) ?? 0.5,
  };
  if (plan.gravity === null) { plan.gravity = 9.81; plan.gravityDefault = true; }

  // 光滑语义推断（零信任规范化层的确定性保证）：真实模型常把"光滑/不计摩擦"写进
  // environment/assumptions 文案，却漏把 friction: 0 写进 given —— 建场会落到默认摩擦
  // （斜面 0.4/球 0.3），球滚动而非滑动，能量/动量解释全部对不上理论。此处按题面语义
  // 注入 friction=0（仅接触相关实体、仅模型未显式给出时），标 inferred 供 UI 显示
  // 「推断」徽标——不冒充题给，用户可在评审表单改回。
  const smoothText = [plan.questionType, plan.goal, plan.environment, ...plan.assumptions].join(' ');
  if (/光滑|不计(一切)?摩擦|无摩擦|忽略.{0,2}摩擦|摩擦可?忽略/.test(smoothText)) {
    const CONTACT = new Set(['ramp', 'ground', 'sphere', 'box', 'cylinder']);
    let injected = false;
    for (const e of plan.entities) {
      if (CONTACT.has(e.type) && e.given.friction == null) {
        e.given.friction = 0;
        e.inferred = [...(e.inferred || []), 'friction'];
        injected = true;
      }
    }
    if (injected) {
      plan.assumptions = [...plan.assumptions, '按题面光滑语义注入摩擦=0（客户端推断，可在评审中修改）'].slice(0, 8);
    }
  }
  return { ok: true, plan, errors };
}

function str(v, d) { return typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : d; }
function strs(v) { return Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((s) => s.slice(0, 120)).slice(0, 8) : []; }
function clamp01(v) { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : null; }

// ---------- 铰链复摆布局：锚点基座 + 刚性杆（近锚端对齐锚点，初始摆角 1.2 rad） ----------
function hingeLayout(plan) {
  const out = [];
  const anchor = plan.entities.find((e) => e.type === 'box' || e.type === 'ground');
  const rod = plan.entities.find((e) => (e.type === 'box' || e.type === 'cylinder') &&
    (!e.given.length || e.given.length <= 4));
  if (!anchor || !rod) return out;
  const aPos = anchor.given.position ?? [0, 2.5, 0];
  const L = rod.given.length ?? 1.0;
  const swing = 0.4;   // 离竖直垂下的初始偏角（小角度，T=2π√(2L/3g) 适用）
  out.push({
    type: 'box', name: anchor.name || '铰链基座', source: 'agent',
    params: { sx: 0.2, sy: 0.2, sz: 0.2 },
    transform: { pos: [...aPos], rot: [0, 0, 0] },
    physics: { body: 'fixed', friction: 0.8 },
    render: { material: 'steelDark' },
  });
  out.push({
    type: 'box', name: rod.name || '摆杆', source: 'agent',
    params: { sx: L, sy: 0.06, sz: 0.06, noCollide: true },   // 铰链连接体互碰禁用（纯摆）
    transform: {
      pos: [aPos[0] + (L / 2) * Math.sin(swing), aPos[1] - (L / 2) * Math.cos(swing), aPos[2] ?? 0],
      rot: [0, 0, -Math.PI / 2 + swing],
    },
    physics: {
      body: 'dynamic', mass: 1, friction: 0.5, restitution: 0.1,
      linvel: [0, 0, 0], angvel: [0, 0, 0],
      linDamping: 0, angDamping: 0, gravityScale: 1,
    },
    render: { material: 'wood' },
    measured: true,
  });
  return out;
}

// ---------- 弹簧振子布局：立柱墙 + 水平理想化小球（拉开 rest+0.4 静止释放，简谐振动） ----------
// ---------- 阿特伍德布局：滑轮 + 双球（onPulley 指向滑轮 id，应用层已建滑轮后回填） ----------
function atwoodLayout(plan) {
  const out = [];
  const pulley = plan.entities.find((e) => e.type === 'pulley');
  const balls = plan.entities.filter((e) => e.type === 'sphere' || e.type === 'box');
  if (!pulley || balls.length !== 2) return out;
  const plPos = pulley.given.position ?? [0, 3.0, 0];
  out.push({
    type: 'pulley', name: pulley.name || '定滑轮', source: 'agent',
    params: { radius: pulley.given.radius ?? 0.3 },
    transform: { pos: [...plPos], rot: [0, 0, 0] },
    physics: { body: 'fixed' },
  });
  const R = pulley.given.radius ?? 0.3;
  balls.forEach((e, i) => {
    const m = e.given.mass ?? 1;
    const x = (i === 0 ? -1 : 1) * (R + 0.05);
    out.push({
      type: 'sphere', name: e.name || ('球 ' + (i + 1)), source: 'agent',
      params: { radius: 0.12 },
      transform: { pos: [x, 1.0, 0], rot: [0, 0, 0] },
      physics: {
        body: 'dynamic', mass: m, friction: 0, restitution: 0,
        linvel: [0, 0, 0], angvel: [0, 0, 0],
        linDamping: 0, angDamping: 0, gravityScale: 1, onPulley: '__PULLEY__',
      },
      render: { material: i === 0 ? 'chrome' : 'brass' },
      measured: true,
    });
  });
  return out;
}

function springLayout(plan) {
  const out = [];
  const sphere = plan.entities.find((e) => e.type === 'sphere');
  const m = sphere ? (sphere.given.mass ?? 1) : 1;
  const k = (plan.attaches.find((a) => a.type === 'spring') || {}).stiffness ?? 20;
  const rest = (plan.attaches.find((a) => a.type === 'spring') || {}).restLength ?? 0.8;
  const stretch = 0.4;                                       // 初始拉伸（静止释放 → 简谐振动）
  const wallPos = [-2.0, 0.6, 0];
  out.push({
    type: 'box', name: '立柱墙', source: 'agent',
    params: { sx: 0.3, sy: 1.2, sz: 1.2 },
    transform: { pos: wallPos, rot: [0, 0, 0] },
    physics: { body: 'fixed', friction: 0.8 },
    render: { material: 'steelDark' },
  });
  out.push({
    type: 'sphere', name: sphere ? sphere.name || '振子小球' : '振子小球', source: 'agent',
    params: { radius: 0.15 },
    // 球放到拉伸位（墙 + rest+stretch 沿 +x）：否则 Rapier spring joint 首帧猛拉
    transform: { pos: [wallPos[0] + rest + stretch, wallPos[1], 0], rot: [0, 0, 0] },
    physics: {
      body: 'dynamic', mass: m, friction: 0, restitution: 0.1,
      linvel: [0, 0, 0], angvel: [0, 0, 0],
      linDamping: 0, angDamping: 0, gravityScale: 0,
    },
    render: { material: 'chrome' },
    measured: true,
  });
  return out;
}

// ---------- 角动量（转台+径向滑块）布局：自动 prismatic joint ----------
// 第一个 cylinder = 转台（自动 4 辐条、ω0 默认 3 rad/s），第一个 box = 滑块（初始 r=0.7、切向速度匹配）。
// joint 用实体索引引用（from/to），applyAgentPlan 建场后映射为真实 id。
function rotationLayout(plan) {
  const out = [];
  const tableE = plan.entities.find((e) => e.type === 'cylinder' || e.type === 'pulley');
  const sliderE = plan.entities.find((e) => e.type === 'box') || plan.entities.find((e) => e.type === 'sphere');
  if (!tableE || !sliderE) return out;
  const R = tableE.given.radius ?? 1.2;
  const H = tableE.given.height ?? 0.12;
  // 题目直给转动惯量（两种拼写）：反解盘质量使 ½MR² = I_given，仿真惯量与题目一致
  const Igiven = tableE.given.momentOfInertia ?? tableE.given.momentInertia ?? null;
  const M = (Igiven != null && tableE.type !== 'pulley')
    ? Math.min(500, Math.max(0.05, 2 * Igiven / (R * R)))
    : (tableE.given.mass ?? 8);
  const omega0 = (tableE.given.angvel ?? [0, 3, 0])[1];
  const r0 = 0.7;
  const ms = sliderE.given.mass ?? 1.5;
  const isPulley = tableE.type === 'pulley';
  out.push(isPulley ? {
    type: 'pulley', name: tableE.name || '定滑轮', source: 'agent',
    params: { radius: R },
    transform: { pos: [0, 3.0, 0], rot: [0, 0, 0] },
    physics: { body: 'fixed' },
    render: { material: 'brass' },
  } : {
    type: 'cylinder', name: tableE.name || '转台', source: 'agent',
    params: { radius: R, height: H, spokes: 4 },
    transform: { pos: [0, 0.42, 0], rot: [0, 0, 0] },
    physics: {
      body: 'dynamic', mass: M, friction: 0, restitution: 0.1,
      linvel: [0, 0, 0], angvel: [0, omega0, 0],
      linDamping: 0, angDamping: 0, gravityScale: 0, spinLock: true,
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
  if (plan.kind === 'hinge') return hingeLayout(plan);
  const hasSpringAttach = (plan.attaches || []).some((a) => a.type === 'spring');
  if (plan.kind === 'atwood' || plan.entities.some((e) => e.type === 'pulley')) return atwoodLayout(plan);
  // 抛体布局：单球带斜向初速（无斜面）→ 球 + 地面板（抛物线落到地面）
  const ramp = plan.entities.find((e) => e.type === 'ramp');
  // 抛体布局：单球带斜向初速（无斜面）→ 球 + 地面板（抛物线落到地面）
  const projBalls = plan.entities.filter((e) => (e.type === 'sphere') && (e.given.velocity || []).some((v) => Math.abs(v) > 1e-9));
  if (!ramp && !plan.attaches.length && projBalls.length === 1 && plan.entities.length === 1) {
    const e = projBalls[0];
    const r = e.given.radius ?? 0.15;
    const v = e.given.velocity;
    const pout = [];
    pout.push({
      type: 'sphere', name: e.name || '抛体', source: 'agent',
      params: { radius: r },
      transform: { pos: e.given.position ?? [0, 0.6, 0], rot: [0, 0, 0] },
      physics: {
        body: 'dynamic', mass: e.given.mass ?? 1, friction: 0, restitution: 0.1,
        linvel: [...v], angvel: [0, 0, 0],
        linDamping: 0, angDamping: 0, gravityScale: 1,
      },
      render: { material: 'chrome' },
      measured: true,
    });
    pout.push({
      type: 'ground', name: '地面', source: 'agent',
      params: { sx: 30, sy: 0.1, sz: 12 },
      transform: { pos: [8, -0.05, 0], rot: [0, 0, 0] },
      physics: { body: 'fixed', friction: 0.6, restitution: 0.2 },
    });
    return pout;
  }
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
  // 弹簧振子布局（attaches 有 spring 或 kind=spring）
  if ((plan.attaches || []).some((a) => a.type === 'spring') || plan.kind === 'spring') {
    return springLayout(plan);
  }
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
        // given.position 自由落位（二维斜碰 z 错开需要）；缺省一维沿 x 排开
        o.transform = { pos: e.given.position ?? [(order - (n - 1) / 2) * 1.6, r + 0.005, 0], rot: [0, 0, 0] };
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
    } else if (e.type === 'pulley') {
      o.params = { radius: e.given.radius ?? 0.3 };
      o.physics = { body: 'fixed' };
      o.transform = { pos: e.given.position ?? [0, 3.0, 0], rot: [0, 0, 0] };
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
