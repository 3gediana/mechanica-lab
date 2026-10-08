// parse-schema.js — 题图解析结果的客户端校验 / 规范化 / 建场计划
// 模型输出不可信：一切数值过范围检查，类型映射到 registry 组件 id；未给出的量不编造（标 默认/需确认）。

const TYPE_MAP = {
  ramp: 'ramp', sphere: 'sphere', box: 'box', cylinder: 'cylinder', ground: 'ground',
  celestial: 'celestial', planet: 'celestial', star: 'celestial', pulley: 'pulley', 滑轮: 'pulley',
  conveyor: 'conveyor', belt: 'conveyor',
  斜面: 'ramp', 球: 'sphere', 方块: 'box', 圆柱: 'cylinder', 地面: 'ground',
  天体: 'celestial', 行星: 'celestial', 恒星: 'celestial', 卫星: 'celestial',
  传送带: 'conveyor', 输送带: 'conveyor',
  // 中文别名兜底（AG-12）：模型偶发无视英文枚举直接输出中文类型，能消化的都收下
  楔子: 'ramp', 楔块: 'ramp', 斜坡: 'ramp', 坡: 'ramp', 坡道: 'ramp', 斜板: 'ramp',
  小球: 'sphere', 质点: 'sphere', 钢球: 'sphere', 铁球: 'sphere', 球体: 'sphere',
  滑块: 'box', 物块: 'box', 木块: 'box', 木板: 'box', 细杆: 'box', 摆杆: 'box',
  砝码: 'box', 重物: 'box', 货物: 'box', 轻杆: 'box', 棒: 'box', 挡板: 'box', 台阶: 'box',
  圆盘: 'cylinder', 转盘: 'cylinder',
  传送带: 'conveyor', 输送带: 'conveyor', 传输带: 'conveyor',
  桌面: 'ground', 平台: 'ground', 台面: 'ground', 高台: 'ground', 地板: 'ground',
};

// kind 中文/近义归一（AG-99）：模型偶发输出中文 kind，布局分派全靠英文枚举，不归一直接走通用路径丢关节
const KIND_MAP = {
  转台: 'rotation', 转动: 'rotation', 角动量: 'rotation', 圆盘: 'rotation', 转盘: 'rotation',
  铰链: 'hinge', 复摆: 'hinge', 单摆: 'hinge',
  弹簧: 'spring', 振子: 'spring', 简谐: 'spring',
  滑轮: 'atwood', 阿特伍德: 'atwood',
  天体: 'celestial', 卫星: 'celestial', 行星: 'celestial',
};

const RANGES = {
  angleDeg: [1, 80], length: [0.1, 12], height: [0.02, 6], width: [0.05, 6],
  radius: [0.01, 2], mass: [0.01, 10000], friction: [0, 2], restitution: [0, 1],
  speed: [-8, 8],   // 传送带带速（负值反向输运）
  momentOfInertia: [0.001, 1e6], momentInertia: [0.001, 1e6],   // 转台类：模型两种拼写都收
};

// given 键别名归一（AG-527）：模型偶发输出 mu/μ→friction、v0→velocity、m→mass、theta→angleDeg
const GIVEN_KEY_ALIAS = {
  mu: 'friction', 'μ': 'friction', 摩擦系数: 'friction', 摩擦因数: 'friction',
  v0: 'velocity', 初速度: 'velocity', 初速: 'velocity',
  m: 'mass', 质量: 'mass',
  theta: 'angleDeg', angle: 'angleDeg', 角度: 'angleDeg', 倾角: 'angleDeg',
  len: 'length', 长: 'length', 长度: 'length',
  h: 'height', 高: 'height', 高度: 'height',
  w: 'width', 宽: 'width', 宽度: 'width',
  r: 'radius', 半径: 'radius',
  L: 'momentOfInertia', I: 'momentOfInertia', 转动惯量: 'momentOfInertia',
};

// 数值解析（AG-519）：模型偶发输出 "30°"/"≈9.8"/"2.5m" 这类带装饰字符的字符串——
// 先剥掉单位/比较符号/空白再 Number，仍失败才判 null（范围校验照走，零信任不破）
function parseLoose(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const s = v.replace(/[°º≈~<>≥≤\s]|m\/s|kg|m$|cm$|kg\/m³|N\/m$|rad|度|米|千克/gi, '');
  return Number(s);
}

function num(v, [min, max]) {
  const n = parseLoose(v);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

// raw = 服务端/fixture 返回的解析 JSON → {ok, plan|errors}
export function normalizeParse(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['解析结果不是对象'] };
  const entities = [];
  const droppedNotes = [];
  let vec2Padded = 0;                                       // 二维向量补零升维计数（AG-97）
  for (const e of (Array.isArray(raw.entities) ? raw.entities : [])) {
    const type = TYPE_MAP[e.type];
    if (!type) { errors.push(`未知实体类型: ${e.type}（已跳过）`); continue; }
    const given = {};
    const dropped = [];
    for (const [k0, v] of Object.entries(e.given || {})) {
      // AG-527 given 键别名归一（mu→friction / v0→velocity / m→mass / theta→angleDeg…）
      const k = GIVEN_KEY_ALIAS[k0] || k0;
      if (k === 'velocity') {
        const arr = Array.isArray(v) ? v.map((x) => Number(x)) : null;
        if (arr && arr.length === 3 && arr.every(Number.isFinite)) given.velocity = arr;
        else if (arr && arr.length === 2 && arr.every(Number.isFinite)) { given.velocity = [arr[0], arr[1], 0]; vec2Padded++; }
        continue;
      }
      if (k === 'position') {
        const arr = Array.isArray(v) ? v.map((x) => Number(x)) : null;
        if (arr && arr.length === 3 && arr.every(Number.isFinite)) given.position = arr;
        else if (arr && arr.length === 2 && arr.every(Number.isFinite)) { given.position = [arr[0], arr[1], 0]; vec2Padded++; }
        continue;
      }
      if (k === 'angvel') {
        const arr = Array.isArray(v) ? v.map((x) => Number(x)) : null;
        if (arr && arr.length === 3 && arr.every(Number.isFinite)) given.angvel = arr;
        else if (arr && arr.length === 2 && arr.every(Number.isFinite)) { given.angvel = [arr[0], arr[1], 0]; vec2Padded++; }
        continue;
      }
      if (k === 'fixed') {
        // UX-R：固定体表达（弹簧固定端/挡板/立柱）——given.fixed=1 → body fixed
        if (Number(v) > 0) given.fixed = 1;
        continue;
      }
      if (!(k in RANGES)) { dropped.push(k); continue; }   // 未知键丢弃不猜，但让用户看见（AG-9）
      const n = num(v, RANGES[k]);
      if (n === null) {
        const hint = Number.isFinite(parseLoose(v)) ? '（注意单位需为 SI：m/kg/s，cm/g/km·h 请先换算）' : '';
        errors.push(`${e.name || type}.${k} 值无效（${v}），已忽略${hint}`);
      } else given[k] = n;
    }
    if (dropped.length) droppedNotes.push(`${e.name || type}：字段 ${dropped.join('/')} 沙盘不支持，已忽略`);
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

  // attaches/joint 索引越界在 normalize 层拦截（AG-112）：不拖到建场才静默失败
  const attList = (Array.isArray(raw.attaches) ? raw.attaches : []).map((a) => ({
    type: a.type === 'rope' ? 'rope' : 'spring',
    from: Math.max(0, Number(a.from) | 0),
    to: Math.max(0, Number(a.to) | 0),
    length: num(a.length, [0.05, 20]),
    stiffness: num(a.stiffness, [0.5, 5000]),
    restLength: num(a.restLength, [0.1, 10]),
    damping: num(a.damping, [0, 50]),
  }));
  for (const a of attList) {
    // 索引语义针对「布局后实体列表」：springLayout 会补墙、projectile 会补地面（各 +1），
    // 故 normalize 层只挡明显荒谬的越界（>= 原始实体数+2）；精确边界由建场时的 created[] 映射守卫
    if (a.from === a.to || a.from >= entities.length + 2 || a.to >= entities.length + 2) {
      a.drop = true;
      errors.push(`attaches ${a.type} ${a.from}→${a.to} 实体索引越界（原始 ${entities.length} 个实体），已丢弃`);
    }
  }
  const attaches = attList.filter((a) => !a.drop).slice(0, 6);
  let joint = null;
  if (raw.joint && typeof raw.joint === 'object') {
    const jf = Math.max(0, Number(raw.joint.from) | 0);
    const jt = Math.max(0, Number(raw.joint.to) | 0);
    if (jf >= entities.length + 2 || jt >= entities.length + 2) {
      errors.push(`joint from/to 实体索引越界（${raw.joint.from}→${raw.joint.to}，原始 ${entities.length} 个实体），已丢弃`);
    } else {
      joint = {
        type: raw.joint.type === 'revolute' ? 'revolute' : 'prismatic',
        from: jf,
        to: jt,
        axis: Array.isArray(raw.joint.axis) ? raw.joint.axis.map((x) => Number(x)) : [1, 0, 0],
        limits: Array.isArray(raw.joint.limits) ? raw.joint.limits.map((x) => Number(x)) : [0.15, 1.05],
        anchor1: Array.isArray(raw.joint.anchor1) ? raw.joint.anchor1.map((x) => Number(x)) : [0, 0, 0],
        anchor2: Array.isArray(raw.joint.anchor2) ? raw.joint.anchor2.map((x) => Number(x)) : [0, 0, 0],
      };
    }
  }

  // 删除指令（AG-R1）：模型可输出 removals（字符串或 {target}）表示要移除的既有对象。
  // 这里只做去重/截断/字符串化；「名字包含 or 类型别名」匹配与预览勾选在应用层做。
  const removals = (Array.isArray(raw.removals) ? raw.removals : [])
    .map((r) => str(r && typeof r === 'object' ? r.target : r, ''))
    .filter(Boolean)
    .filter((r, i, a) => a.indexOf(r) === i)
    .slice(0, 6);

  const plan = {
    fixture: raw._fixture === true,
    questionType: str(raw.questionType, '未知题型'),
    goal: str(raw.goal, ''),
    gravity: num(gravityRaw, [0.01, 50]),
    G: num(raw.G, [1e-14, 1e6]),            // 场景引力常数（天体题给；null=保持 doc 现值）
    kind: KIND_MAP[str(raw.kind, '')] || str(raw.kind, ''),   // rotation = 角动量/转台类（需要自动 joint 布局）
    removals,                                        // 要删除的既有对象（混合搭建「去掉某物」语义）
    attaches,
    joint,
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
  // 被丢弃字段的透明化（AG-9）：进 uncertain 让用户在评审界面看见，不静默吞
  for (const note of droppedNotes) {
    if (plan.uncertain.length >= 8) break;
    if (!plan.uncertain.some((u) => u.includes('不支持'))) plan.uncertain.push(note);
  }
  if (vec2Padded) plan.uncertain.push(`二维向量已按 [x,y,0] 补零升维（velocity/position/angvel 共 ${vec2Padded} 处）`);
  // 越界/非数值 gravity 的显式提示（AG-10）：不再静默落默认
  if (gravityRaw != null && plan.gravity === null) {
    errors.push(`gravity 值无效（${gravityRaw}），已按默认 9.81 处理`);
  }
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
  if (plan.kind === 'atwood' || plan.entities.some((e) => e.type === 'pulley')) {
    const atw = atwoodLayout(plan);
    if (atw.length) return atw;
    // AG-95：摆球数≠2 时不再静默建场 0 实体——回退通用布局并让用户在评审界面看见原因
    if (!plan.uncertain.some((u) => u.includes('阿特伍德'))) plan.uncertain.push('摆球数≠2，未按阿特伍德专用布局建场（已回退通用摆位），请检查实体数量');
  }
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
  const maxBallR = Math.max(0.15, ...plan.entities
    .filter((e) => e.type === 'sphere')
    .map((e) => e.given.radius ?? 0.15));
  if (ramp) {
    const g = ramp.given;
    // UX-R：坡面多物体（球/圆柱/方块赛跑、对比实验）自动加宽斜面——车道 0.75m 间距
    const rampLanes = plan.entities.filter((x) => x.type === 'sphere' || x.type === 'cylinder' || x.type === 'box').length;
    const width = Math.max(g.width ?? 0, Math.max(0.5, +(2.2 * maxBallR).toFixed(3)), rampLanes > 1 ? +(rampLanes * 0.75).toFixed(3) : 0);   // AG-21 防大球侧翻 + UX-R 多车道
    if (g.angleDeg != null) {
      const Lslope = g.length ?? 2.0;                       // 坡面长（斜边）
      const th = g.angleDeg * Math.PI / 180;
      const base = Lslope * Math.cos(th);
      const height = Lslope * Math.sin(th);
      rampGeom = { base, height, angleDeg: g.angleDeg, width };
    } else {
      const base = g.length ?? 2.0;                          // 无角度：length 按底边处理
      const height = g.height ?? base * Math.tan(30 * Math.PI / 180);
      rampGeom = { base, height, angleDeg: Math.atan2(height, base) * 180 / Math.PI, width };
    }
  }

  const out = [];
  // UX-R：坡面放置通用化——球（z 车道并排）、圆柱（躺平、轴向 z=滚动向 x）、方块（贴坡旋转）。
  // 车道全宽 rampGeom.width（多物体自动加宽），间距 0.75m；题给 position 的实体自由落位不占车道。
  const rampObjs = plan.entities.filter((x) =>
    (x.type === 'sphere' || x.type === 'cylinder' || x.type === 'box')
    && x.given.position == null);
  const laneMap = new Map(rampObjs.map((x, i) => [x, i]));
  const laneZ = (e) => +((laneMap.get(e) ?? 0) - (rampObjs.length - 1) / 2) * 0.75;
  const slopeSpot = (r, off = 0.3) => {
    const xl = -rampGeom.base / 2 + off;
    const surf = rampGeom.height * (1 - (xl + rampGeom.base / 2) / rampGeom.base);
    const yOff = r / Math.cos(rampGeom.angleDeg * Math.PI / 180);
    return { xl, y: +(0.05 + surf + yOff + 0.01).toFixed(3) };
  };
  // UX-R：springLayout 只接管「单振子弹簧振子」——kind=spring 或（有 spring attach 且计划里
  // 只有 ≤1 个实体）。多体 attach（耦合双振子/弹射器=显式墙+多实体）必须走正常管线，
  // 否则模型给的地面/第二球/题给位置全被丢弃（p41 coupled/launcher 实测）。
  const wantsSpringLayout = plan.kind === 'spring'
    || ((plan.attaches || []).some((a) => a.type === 'spring') && plan.entities.length <= 1);
  if (wantsSpringLayout) {
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
        width: +rampGeom.width.toFixed(4),   // UX-R：多车道自动加宽（题给 width 或车道数×0.75）
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
      if (e.given.fixed) o.physics.body = 'fixed';
      // 无斜面（对撞类）布局：沿 x 排开，悬浮于地面上方（gravityScale=0 + 无摩擦）——
      // "光滑水平面"理想化：不落地不接触，水平动量不被地面摩擦污染，动量守恒才可对照。
      // 传送带场景例外：物体必须落在带顶（接触才有摩擦驱动），正常重力。
      const r = e.given.radius ?? 0.15;
      const hasConveyor = plan.entities.some((x) => x.type === 'conveyor');
      if (!rampGeom && hasConveyor) {
        const beltE = plan.entities.find((x) => x.type === 'conveyor');
        const beltTop = +(beltE.given.height ?? 0.16);
        const beltX = (beltE.given.position ?? [0, 0, 0])[0];
        const beltLen = beltE.given.length ?? 2.4;
        o.physics.friction = e.given.friction ?? 0.3;   // 物-带 μ 由带侧 params.friction 驱动；此处常规取值
        o.transform = {
          pos: e.given.position ?? [+(beltX - beltLen / 2 + 0.35).toFixed(3), +(beltTop + r + 0.01).toFixed(3), 0],
          rot: [0, 0, 0],
        };
      } else if (!rampGeom) {
        const order = plan.entities.filter((x) => x.type === 'sphere').indexOf(e);
        const n = plan.entities.filter((x) => x.type === 'sphere').length;
        // given.position 自由落位（二维斜碰 z 错开需要）；缺省一维沿 x 排开
        o.transform = { pos: e.given.position ?? [(order - (n - 1) / 2) * 1.6, r + 0.005, 0], rot: [0, 0, 0] };
        o.physics.friction = 0;
        // 自由落体例外（波2 补课）：无初速且题给高位置（y > r+0.1）=「从高处由静止释放」语义，
        // 必须保留重力——悬浮理想化只属于带初速的对撞场景（freefall fixture 此前一直悬浮，
        // p41 靠 vacuous verify 绿，教学上是坏的）。带初速+显式地面的抛体场景应走单实体
        // 自动抛体布局（不要显式给 ground），否则会被此处悬浮化劫持（月面斜抛实测 +56%）
        const dropFromHigh = !e.given.velocity && e.given.position != null && e.given.position[1] > r + 0.1;
        if (!dropFromHigh) o.physics.gravityScale = 0;
      } else {
        // UX-R：坡面球多车道并排（球 vs 球、球 vs 圆柱赛跑）；off=r+0.01 与 ballOnRamp 同点
        const spot = slopeSpot(o.params.radius, o.params.radius + 0.01);
        o.transform = { pos: [spot.xl, spot.y, laneZ(e)], rot: [0, 0, 0] };
      }
      if (e.given.velocity) o.physics.linvel = e.given.velocity;
    } else if (e.type === 'box') {
      // 题给尺寸透传（AG-18）：length/height/width → sx/sy/sz；只给一边时三边同值（正方块惯例）
      const bl = e.given.length ?? e.given.width ?? e.given.height;
      o.params = {
        sx: e.given.length ?? bl ?? 0.3,
        sy: e.given.height ?? bl ?? 0.3,
        sz: e.given.width ?? bl ?? 0.3,
      };
      o.physics = { mass: e.given.mass ?? 1, friction: e.given.friction ?? 0.4 };
      if (e.given.fixed) o.physics.body = 'fixed';   // UX-R：固定墙/挡板（弹簧固定端等）
      // 复杂场景（AG-V 前置）：同类型多件沿 x 对称散开，不再全部叠在 [0.6,…] 同一点
      const boxList = plan.entities.filter((x) => x.type === 'box');
      const bi = boxList.indexOf(e);
      const spreadX = boxList.length > 1 ? (bi - (boxList.length - 1) / 2) * 0.9 : 0;
      if (rampGeom && e.given.position == null) {
        // UX-R：坡面方块——贴坡旋转（rot z=-θ，斜面沿 +x 下坡）；题给 position 仍自由落位
        const th = rampGeom.angleDeg * Math.PI / 180;
        const spot = slopeSpot(o.params.sy / 2, o.params.sx / 2 + 0.02);
        o.transform = { pos: [spot.xl, spot.y, laneZ(e)], rot: [0, 0, +(-th)] };
      } else {
        // UX-R：方块尊重题给 position（此前恒被忽略——「把方块放在…」类要求无法表达）
        o.transform = { pos: e.given.position ?? [0.6 + spreadX, (o.params.sy / 2) + 0.02, 0], rot: [0, 0, 0] };
      }
      if (e.given.velocity) o.physics.linvel = e.given.velocity;
    } else if (e.type === 'pulley') {
      o.params = { radius: e.given.radius ?? 0.3 };
      o.physics = { body: 'fixed' };
      o.transform = { pos: e.given.position ?? [0, 3.0, 0], rot: [0, 0, 0] };
    } else if (e.type === 'conveyor') {
      // 传送带（RUN-2）：带长/带厚/带宽/带速；friction 语义=带面动摩擦因数 μ（驱动模型用）
      const bsy = e.given.height ?? 0.16;
      o.params = {
        sx: e.given.length ?? 2.4,
        sy: bsy,
        sz: e.given.width ?? 0.6,
        speed: e.given.speed ?? 0.8,
      };
      o.physics = { body: 'fixed', friction: e.given.friction ?? 0.2, restitution: 0 };
      o.transform = { pos: e.given.position ?? [0, +(bsy / 2).toFixed(3), 0], rot: [0, 0, 0] };
    } else if (e.type === 'celestial') {
      o.params = { radius: e.given.radius ?? 0.5 };
      o.physics = {
        mass: e.given.mass ?? 100,
        linvel: e.given.velocity ?? [0, 0, 0],
      };
      o.transform = { pos: e.given.position ?? [0, 0, 0], rot: [0, 0, 0] };
    } else if (e.type === 'cylinder') {
      o.params = { radius: e.given.radius ?? 0.12, height: e.given.height ?? 0.3 };   // AG-19
      o.physics = { mass: e.given.mass ?? 1 };
      if (e.given.fixed) o.physics.body = 'fixed';
      // 同类型多圆柱沿 z 散开（复杂场景不叠在同一点）
      const cylList = plan.entities.filter((x) => x.type === 'cylinder');
      const ci = cylList.indexOf(e);
      const spreadZ = cylList.length > 1 ? (ci - (cylList.length - 1) / 2) * 0.8 : 0;
      if (rampGeom && e.given.position == null) {
        // UX-R：坡面圆柱——躺平（rot x=90°，轴向 z），可演示刚体纯滚动（摩擦不做功）
        const spot = slopeSpot(o.params.radius, o.params.radius + 0.01);
        o.transform = { pos: [spot.xl, spot.y, laneZ(e)], rot: [Math.PI / 2, 0, 0] };
      } else {
        o.transform = { pos: e.given.position ?? [0, (o.params.height / 2) + 0.02, 0.8 + spreadZ], rot: [0, 0, 0] };
      }
    } else if (e.type === 'ground') {
      o.params = { sx: e.given.length ?? 10, sy: 0.1, sz: e.given.width ?? 8 };   // AG-20
      // 显式地面也要有 physics（AG-V3 修：模型修订计划常补 ground，缺 body 下游读 physics.body 炸）
      o.physics = { body: 'fixed', friction: e.given.friction ?? 0, restitution: e.given.restitution ?? 0.05 };
      // 题给 position 尊重（月面斜抛等长地面需偏移覆盖落点；缺省居中原点）
      o.transform = { pos: e.given.position ?? [0, -0.05, 0], rot: [0, 0, 0] };
    }
    out.push(o);
  }
  // 对撞类（无斜面且 ≥2 球）：自动补光滑地面承接（对撞题的隐含装置，假设记录在 plan.assumptions）。
  // UX-R：模型已给 ground 则不重复补（freefall fixture 实测双地面）。
  // 传送带场景同样补（物体滑出带端后要有承接；摩擦 0——离开带后保持共速滑行，不污染测量）。
  const hasConveyorEnt = plan.entities.some((e) => e.type === 'conveyor');
  if (!ramp && !plan.entities.some((e) => e.type === 'ground')
    && (hasConveyorEnt || plan.entities.filter((e) => e.type === 'sphere').length >= 2)) {
    // 传送带场景地面收紧到 8×4（默认取景不被空地拉远；带长 2.4 出带后仍有余量滑行）
    out.push({
      type: 'ground', name: '光滑地面', source: 'agent',
      params: hasConveyorEnt ? { sx: 8, sy: 0.1, sz: 4 } : { sx: 12, sy: 0.1, sz: 6 },
      transform: { pos: [0, -0.05, 0], rot: [0, 0, 0] },
      physics: { body: 'fixed', friction: !hasConveyorEnt && pairFriction != null ? pairFriction : 0, restitution: 0.05 },
    });
  }
  // 天体圆轨道确定性推断：应用引力教学约定轨道在 xz 平面（守恒量跟踪 Lz、周期检测用 xz 方位角）。
  // 模型给的绕转体位置/速度可能带 y 分量或纯径向（xy 平面轨道会让 Lz≈0、周期采样失灵）——
  // 统一归一：位置贴中心天体所在平面，速度投影到 xz 切向；速度缺失时按圆轨道 v=√(GM/r) 推断。
  const celOut = out.filter((o) => o.type === 'celestial');
  if (celOut.length >= 2) {
    const Gv = plan.G ?? 1;
    const center = celOut.reduce((a, b) => (b.physics.mass > a.physics.mass ? b : a));
    for (const sat of celOut) {
      if (sat === center) continue;
      const c = center.transform.pos;
      sat.transform.pos = [sat.transform.pos[0], c[1], sat.transform.pos[2]];
      let p = sat.transform.pos;
      let rv = [p[0] - c[0], 0, p[2] - c[2]];
      let r = Math.hypot(rv[0], rv[2]);
      const v0 = sat.physics.linvel || [0, 0, 0];
      const speed0 = Math.hypot(v0[0], v0[1], v0[2]);
      // 位置与中心重合（模型把轨道半径塞进 radius 被范围校验拒掉、position 缺失——实测行为）：
      // 按圆轨道条件反推 r = GM/v²（题面圆周运动语义下的确定性推论）
      if (r < 1e-6 && speed0 >= 1e-6) {
        r = Gv * center.physics.mass / (speed0 * speed0);
        sat.transform.pos = [c[0] + r, c[1], c[2]];
        p = sat.transform.pos;
        rv = [r, 0, 0];
        plan.assumptions = [...plan.assumptions, `位置缺失，按圆轨道条件反推轨道半径 r=${r.toFixed(2)}（客户端推断）`].slice(0, 8);
      }
      if (r < 1e-6) continue;
      const v = sat.physics.linvel || [0, 0, 0];
      const speed = Math.hypot(v[0], v[1], v[2]);
      // xz 切向分量（保留题给切向方向），径向与 y 分量丢弃（圆周运动题面语义）；
      // 切向为零（速度缺失/纯径向/法向）时按圆轨道 v=√(GM/r) 推断
      const vn = (v[0] * rv[0] + v[2] * rv[2]) / (r * r);
      const vt = [v[0] - vn * rv[0], 0, v[2] - vn * rv[2]];
      const vtl = Math.hypot(vt[0], vt[2]);
      if (vtl < 1e-6 || speed < 1e-6) {
        const vc = Math.sqrt(Gv * center.physics.mass / r);
        sat.physics.linvel = [-rv[2] / r * vc, 0, rv[0] / r * vc].map((x) => +x.toFixed(4));
        plan.assumptions = [...plan.assumptions, `按圆轨道语义推断绕转体入轨速度 v=${vc.toFixed(2)}（xz 切向，客户端推断）`].slice(0, 8);
      } else {
        sat.physics.linvel = [vt[0] / vtl * speed, 0, vt[2] / vtl * speed].map((x) => +x.toFixed(4));
      }
    }
  }
  return out;
}

// 球心位置：高墙在 -x，球心距墙留出半径+间隙，置于坡面近顶端（r = 实际题给/默认球半径）
// 导出供 agent-verify 自查复用（同一公式，静核与建场不两张脸）
export function ballOnRamp(rampGeom, r = 0.15) {
  if (!rampGeom) return [0, 0.5, 0];
  const xl = -rampGeom.base / 2 + r + 0.01;
  const surfLocal = rampGeom.height * (1 - (xl + rampGeom.base / 2) / rampGeom.base);
  const yOff = r / Math.cos(rampGeom.angleDeg * Math.PI / 180);
  const worldY = 0.05 + surfLocal + yOff + 0.01;     // 0.05 = 斜面放置高度
  return [+xl.toFixed(3), +worldY.toFixed(3), 0];
}
