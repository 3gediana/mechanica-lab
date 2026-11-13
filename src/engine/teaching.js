// teaching.js — R7-A 战区教学跃迁纯函数层（A1 简报 / A2a 代入行 / A2d 变式派生 /
// A3 新时机检测 / A4 节奏策略表）。
// 铁律（GOAL-R7 QUALITY BAR）：一切上屏数字确定性可复算、与 explain.js 同源公式同参数
// 口径（单测互证不许漂移）；禁止模型编数字上屏——模型只给 moment/title/formula 文案，
// 数值代入行一律由这里从场景文档算出。
// 时机检测器只吃简单数值（位置/速度/接触状态），workbench 逐帧喂——纯函数可单测。

// ---------- 场景族分类（代入行/简报共用；口径对齐 explainRun 分派序） ----------
// docOnly 分类：不依赖运行数据（series/reports），建场后即可出简报与代入行。
// 兼容两种形态：doc 实体（physics/params 完整，建场后）与 plan 实体（{type, given}，解析
// 评审期）——doc 判据优先（最可靠），plan 期落 questionType 关键词兜底。
export function sceneFamily(plan, doc) {
  // 优先级：建场后（doc 含 source:'agent' 实体=本 plan 建的）doc 判据更细（rope/onPulley
  // 等建场产物），doc 优先；解析评审期 doc 还是旧场景，plan 优先——简报写「即将建的场」。
  const docBuiltFromPlan = !!(doc && doc.entities && doc.entities.some((e) => e.source === 'agent'));
  const docFam = classifyByDoc(doc);
  const planFam = classifyByPlan(plan);
  return docBuiltFromPlan ? (docFam || planFam) : (planFam || docFam);
}

function classifyByDoc(doc) {
  const ents = (doc && doc.entities) || [];
  const T = (e) => e.type;
  const has = (t) => ents.some((e) => T(e) === t);
  const dyn = ents.filter((e) => e.physics && e.physics.body === 'dynamic');

  // 阿特伍德：滑轮 + 恰两只 onPulley 动态体（explainAtwood 同判）
  const pulley = ents.find((e) => T(e) === 'pulley');
  if (pulley) {
    const hung = dyn.filter((e) => e.physics.onPulley);
    if (hung.length === 2) return 'atwood';
  }
  // 天体：引力系统（explainAstro 同判）
  if (dyn.some((e) => e.physics.gravitating)) return 'celestial';
  // 转台（explainRotation 同判）
  if (dyn.some((e) => e.physics.spinLock) || has('turntable')) return 'rotation';
  // 弹簧族（explainSpring/explainSpringPair/explainHookeStatic 同族）
  if (has('spring')) return 'spring';
  // 单摆/圆锥摆/竖直圆：绳系单球（长度>0.4 才算摆——短绳多为约束细节）
  const rope = ents.find((e) => T(e) === 'rope');
  if (rope) {
    const L = (rope.params && rope.params.length) || 0;
    if (L > 0.4) return 'pendulum';
  }
  // 液体（浮沉）
  if (has('tank') || dyn.some((e) => e.physics.inLiquid != null)) return 'liquid';
  // 斜面：ramp 组件或 box 斜放（rot 非零且非 180°倍数）
  if (has('ramp')) return 'incline';
  const slope = ents.find((e) => T(e) === 'box' && e.physics && e.physics.body === 'fixed'
    && e.transform && e.transform.rot && Math.abs(e.transform.rot[2]) > 0.05 && Math.abs(Math.abs(e.transform.rot[2]) - Math.PI) > 0.05);
  if (slope) return 'incline';
  // 铰链/复摆
  if (ents.some((e) => Array.isArray(e.joints) && e.joints.some((j) => j.type === 'revolute'))) return 'hinge';
  // 双动态球对撞（momentum）
  if (dyn.filter((e) => T(e) === 'sphere').length >= 2) return 'momentum';
  // 抛体/自由落体：单动态球，有水平初速=抛体，否则竖直
  const movers = dyn.filter((e) => T(e) === 'sphere' || T(e) === 'box');
  if (movers.length >= 1) {
    const v = (movers[0].physics.linvel) || [0, 0, 0];
    if (Math.hypot(v[0], v[2]) > 0.1) return 'projectile';
    return 'freefall';
  }
  return null;
}

// plan 形态分类：{type, given} 实体 + 题型关键词（fixture 实测全命中）
function classifyByPlan(plan) {
  const pEnts = (plan && plan.entities) || [];
  if (!pEnts.length) {
    const qt0 = `${(plan && plan.questionType) || ''}${(plan && plan.goal) || ''}`;
    if (/弹簧/.test(qt0)) return 'spring';
    if (/滑轮|阿特伍德/.test(qt0)) return 'atwood';
    if (/斜面/.test(qt0)) return 'incline';
    if (/碰|动量/.test(qt0)) return 'momentum';
    if (/抛|落体/.test(qt0)) return 'projectile';
    return null;
  }
  const T = (e) => e.type;
  const qt = `${(plan && plan.questionType) || ''}${(plan && plan.goal) || ''}${(plan && plan.environment) || ''}`;
  const pHas = (t) => pEnts.some((e) => T(e) === t);
  const spheres = pEnts.filter((e) => T(e) === 'sphere');
  if (/滑轮|阿特伍德/.test(qt) || (pHas('pulley') && spheres.length >= 2)) return 'atwood';
  if (pHas('ramp') || /斜面/.test(qt)) return 'incline';
  if (pHas('tank') || /浮力|浮沉|液体/.test(qt)) return 'liquid';
  if (pHas('spring') || pEnts.some((e) => T(e) === 'spring') || /弹簧|简谐|劲度/.test(qt)) return 'spring';
  if (pHas('pulley')) return 'atwood';
  if (/单摆|圆锥摆|摆动|摆线/.test(qt)) return 'pendulum';
  if (/天体|引力|卫星|行星|轨道周期/.test(qt)) return 'celestial';
  if (/转台|转动惯量|角动量|圆周/.test(qt)) return 'rotation';
  if (/复摆|铰链/.test(qt)) return 'hinge';
  if (/碰|动量/.test(qt) || spheres.length >= 2) return 'momentum';
  if (/抛|落体|竖直上抛|自由落体/.test(qt)) return /竖直|自由落体/.test(qt) && !/斜抛|平抛/.test(qt) ? 'freefall' : 'projectile';
  // 单球无关键词：有水平初速=抛体，静止悬空=自由落体
  if (spheres.length === 1) {
    const gv = spheres[0].given || {};
    const v = Array.isArray(gv.velocity) ? gv.velocity : (typeof gv.velocity === 'number' ? [gv.velocity, 0, 0] : null);
    if (v) return Math.hypot(v[0], v[2]) > 0.1 ? 'projectile' : 'freefall';
  }
  return null;
}

const FAMILY_TOPIC = {
  atwood: '连接体 + 牛顿第二定律（整体法/隔离法）',
  incline: '斜面受力分解 + 牛顿第二定律',
  projectile: '运动的分解（水平匀速 × 竖直上/下抛）',
  freefall: '自由落体 / 竖直上抛运动学',
  momentum: '动量守恒定律（碰撞）',
  spring: '胡克定律 + 简谐振动 / 能量转化',
  pendulum: '单摆 / 圆周运动（绳约束）',
  celestial: '万有引力 + 天体运动',
  rotation: '转动与角动量',
  hinge: '复摆 / 转动定律',
  liquid: '浮力与浮沉条件',
};

// ---------- A1 拆题简报：已知量/未知量/考点/解题路线（结构化分步，非灰字墙） ----------
// known 从实体 given/params 提取（质量/初速/半径/劲度/摆长/倾角/摩擦）；route 按族给
// 确定性步骤模板，套题面数值——学生一眼看清「这题在考什么、分几步走」。
export function briefFromPlan(plan, doc = null) {
  const p = plan || {};
  const known = [];
  const push = (label, value, unit = '') => {
    if (value == null || Number.isNaN(value)) return;
    known.push({ label, value: `${fmtNum(value)}${unit ? ' ' + unit : ''}` });
  };
  // 建场前 doc 还是旧场景：已知量读 plan 实体（given）；建场后读 doc（source:'agent' 同判据）
  const docBuilt = !!(doc && doc.entities && doc.entities.some((e) => e.source === 'agent'));
  const ents = docBuilt ? doc.entities : ((p.entities && p.entities.length) ? p.entities : (doc && doc.entities) || []);
  const g = Math.abs((docBuilt ? doc.gravity : (p.gravity ?? (doc && doc.gravity))) || -9.81);
  push('重力加速度 g', g, 'm/s²');
  for (const e of ents) {
    const nm = e.name || e.type;
    const ph = e.physics || {};
    const gv = e.given || {};
    // doc 形态读 physics/params；plan 形态读 given（解析评审期 doc 未建）
    const mass = ph.mass ?? gv.mass;
    if (ph.body === 'dynamic' || (gv.mass != null && !ph.body)) push(`${nm}·质量`, mass, 'kg');
    const v = ph.linvel || (Array.isArray(gv.velocity) ? gv.velocity : null) || (typeof gv.velocity === 'number' ? [gv.velocity, 0, 0] : null);
    if (v && Math.hypot(...v) > 0.01) push(`${nm}·初速`, Math.hypot(...v), 'm/s');
    const k = ph.stiffness ?? gv.stiffness ?? (e.params && e.params.stiffness);
    if (e.type === 'spring' && k != null) push('弹簧劲度 k', k, 'N/m');
    const L = gv.length ?? (e.params && e.params.length);
    if (L != null && (e.type === 'rope' || e.type === 'rod')) push(`${e.type === 'rope' ? '绳长' : '杆长'} L`, L, 'm');
    const th = gv.angleDeg ?? (e.params && e.params.angleDeg);
    if (th != null) push('倾角 θ', th, '°');
    const mu = ph.friction ?? gv.friction;
    if (mu != null && mu > 0) push('摩擦系数 μ', mu);
    const e1 = ph.restitution ?? gv.restitution;
    if (e1 != null && e1 >= 0.95) push(`${nm}·弹性碰撞 e=1`, 1, '');
  }
  const family = sceneFamily(p, doc);
  const unknown = (p.unknowns || []).slice(0, 6);
  const topics = [FAMILY_TOPIC[family]].filter(Boolean);
  const route = ROUTE_TEMPLATES[family] ? ROUTE_TEMPLATES[family]({ plan: p, doc, g, ents }) : null;
  return { family, known: known.slice(0, 10), unknown, topics, route };
}

function fmtNum(x) {
  if (Number.isInteger(x)) return String(x);
  return String(Math.round(x * 100) / 100);
}

// 解题路线模板：每族 3~4 步，套题面真值（确定性，无模型参与）。
const ROUTE_TEMPLATES = {
  atwood: ({ doc, g, ents }) => {
    const all = ents && ents.length ? ents : ((doc && doc.entities) || []);
    // doc 形态：onPulley 动态体；plan 形态：球实体 given.mass
    let hung = all.filter((e) => e.physics && e.physics.body === 'dynamic' && e.physics.onPulley);
    if (!hung.length) hung = all.filter((e) => e.type === 'sphere');
    const [m1, m2] = hung.map((e) => (e.physics ? e.physics.mass : (e.given && e.given.mass))).filter((m) => m > 0).sort((a, b) => b - a);
    if (m1 == null || m2 == null) return null;
    return [
      { title: '整体法求加速度', detail: `a = (m₁−m₂)g/(m₁+m₂) = (${m1}−${m2})×${fmtNum(g)}/(${m1}+${m2}) = ${fmtNum((m1 - m2) * g / (m1 + m2))} m/s²` },
      { title: '隔离法求绳张力', detail: `T = 2m₁m₂g/(m₁+m₂) = ${fmtNum(2 * m1 * m2 * g / (m1 + m2))} N` },
      { title: '对照实测', detail: '运行后由解释器用位移二次拟合实测 a，对照理论值' },
    ];
  },
  incline: ({ doc, g, ents }) => {
    const ramp = (ents || []).find((e) => e.type === 'ramp');
    const th = ramp && ramp.params ? (ramp.params.angleDeg ?? Math.abs((ramp.transform.rot || [0, 0, 0])[2] * 180 / Math.PI)) : null;
    if (th == null) return null;
    const mu = inclineFriction(doc);
    const thR = th * Math.PI / 180;
    const a = mu > 0 ? g * (Math.sin(thR) - mu * Math.cos(thR)) : g * Math.sin(thR);
    return [
      { title: '受力分解', detail: `沿斜面：重力分量 mg·sinθ${mu > 0 ? ' − 摩擦 μmg·cosθ' : '（光滑面无摩擦）'}` },
      { title: '牛顿第二定律', detail: `a = g(sinθ${mu > 0 ? '−μcosθ' : ''}) = ${fmtNum(g)}×${mu > 0 ? `(sin${fmtNum(th)}°−${fmtNum(mu)}·cos${fmtNum(th)}°)` : `sin${fmtNum(th)}°`} = ${fmtNum(a)} m/s²` },
      { title: '运动学求未知量', detail: 'v² = 2a·s（斜面长已知时直接代入）' },
    ];
  },
  projectile: ({ doc, g, ents }) => {
    const m = (ents || []).find((e) => e.physics && e.physics.body === 'dynamic' && (e.physics.linvel || [0]).some((x) => Math.abs(x) > 0.05));
    if (!m) return null;
    const [vx, vy] = m.physics.linvel;
    return [
      { title: '分解初速度', detail: `v₀ 分解：水平 ${fmtNum(vx)} m/s（匀速）× 竖直 ${fmtNum(vy)} m/s（加速度 −g）` },
      { title: '竖直方向求时间', detail: vy > 0
        ? `上升高度 h = vy²/(2g) = ${fmtNum(vy * vy / (2 * g))} m`
        : '下落高度已知时由 h = ½gt²（或 vy·t+½gt²）解 t' },
      { title: '水平方向求射程', detail: `R = vx·t（t 为飞行总时间）` },
    ];
  },
  freefall: ({ g }) => [
    { title: '判定运动类型', detail: '只受重力 → 匀变速直线运动，a = g' },
    { title: '选公式', detail: 'v = gt；h = ½gt²；v² = 2gh（三个方程两个独立）' },
    { title: '代入求解', detail: `g = ${fmtNum(g)} m/s² 代入即可` },
  ],
  momentum: ({ ents }) => {
    const dyn = (ents || []).filter((e) => e.physics && e.physics.body === 'dynamic' && e.type === 'sphere');
    if (dyn.length < 2) return null;
    const [a, b] = dyn;
    return [
      { title: '判断系统', detail: `两球 + 光滑面 → 系统动量守恒：m₁u₁+m₂u₂ = m₁v₁+m₂v₂` },
      { title: '判断碰撞类型', detail: (a.physics.restitution ?? 0) >= 0.95 && (b.physics.restitution ?? 0) >= 0.95
        ? 'e=1 弹性碰撞 → 动量守恒 + 动能守恒两式联立'
        : `e<1 → 动量守恒 + 恢复系数 e·(u₁−u₂) = −(v₁−v₂)` },
      { title: '联立求解', detail: '解出碰后 v₁、v₂，运行后由解释器对照实测' },
    ];
  },
  spring: ({ ents, g }) => {
    const sp = (ents || []).find((e) => e.type === 'spring');
    const m = (ents || []).find((e) => e.physics && e.physics.body === 'dynamic');
    if (!sp || !m) return null;
    const k = sp.params.stiffness, mm = m.physics.mass;
    return [
      { title: '胡克定律', detail: `F = kx（k = ${fmtNum(k)} N/m，x 为形变量）` },
      { title: '简谐周期', detail: `T = 2π√(m/k) = 2π√(${fmtNum(mm)}/${fmtNum(k)}) = ${fmtNum(2 * Math.PI * Math.sqrt(mm / k))} s` },
      { title: '能量转化', detail: `弹性势能 ½kx² ↔ 动能 ½mv² ↔ 重力势能 mgh（${g ? '竖直振子含重力势' : ''}总机械能守恒于无阻尼时）` },
    ];
  },
  pendulum: ({ ents, g, plan }) => {
    const r = (ents || []).find((e) => e.type === 'rope');
    const aRope = (plan && plan.attaches || []).find((a) => a.type === 'rope');
    const L = (r && r.params ? r.params.length : null) ?? (aRope && aRope.length) ?? null;
    if (L == null) return null;
    return [
      { title: '受力分析', detail: '绳张力 + 重力；切向分量提供回复力' },
      { title: '小角度简谐', detail: `T = 2π√(L/g) = 2π√(${fmtNum(L)}/${fmtNum(g)}) = ${fmtNum(2 * Math.PI * Math.sqrt(L / g))} s` },
      { title: '圆周关系', detail: '最高/最低点用牛顿第二定律沿绳方向列式（T ± mg = mv²/L）' },
    ];
  },
  celestial: () => [
    { title: '引力做向心力', detail: 'GMm/r² = mv²/r → v = √(GM/r)' },
    { title: '开普勒第三定律', detail: 'T² ∝ r³（圆轨道 T = 2π√(r³/GM)）' },
    { title: '代入求解', detail: '运行后由解释器对照实测周期/速率' },
  ],
  rotation: () => [
    { title: '转动描述', detail: 'ω = 2π/T；线速度 v = ωr' },
    { title: '向心力', detail: 'F = mω²r = mv²/r（由摩擦/约束提供）' },
    { title: '守恒量', detail: '无外力矩时角动量 L = Iω 守恒' },
  ],
  hinge: ({ ents, g }) => {
    const rod = (ents || []).find((e) => e.physics && e.physics.body === 'dynamic' && e.params && e.params.sx);
    const L = rod ? rod.params.sx : null;
    if (L == null) return null;
    return [
      { title: '复摆周期', detail: `T = 2π√(I/mgd)（均匀杆 I=mL²/3, d=L/2 → T = 2π√(2L/3g) = ${fmtNum(2 * Math.PI * Math.sqrt(2 * L / (3 * g)))} s）` },
      { title: '恢复力矩', detail: 'τ = −mgd·sinθ ≈ −mgd·θ（小角度）' },
    ];
  },
  liquid: ({ ents, g }) => {
    const tk = (ents || []).find((e) => e.type === 'tank');
    const rho = tk && tk.params ? tk.params.density ?? 1000 : 1000;
    return [
      { title: '浮力', detail: `F浮 = ρ液·g·V排（ρ = ${fmtNum(rho)} kg/m³）` },
      { title: '浮沉判据', detail: 'ρ物 vs ρ液：重力大于/小于浮力 → 沉底/上浮；相等 → 悬浮' },
      { title: '漂浮方程', detail: `漂浮时 mg = ρ液·g·V排 → V排 = m/ρ液` },
    ];
  },
};

function inclineFriction(doc) {
  const dyn = (doc && doc.entities || []).filter((e) => e.physics && e.physics.body === 'dynamic');
  const fr = dyn.map((e) => e.physics.friction ?? 0);
  return fr.length ? Math.max(...fr) : 0;
}

// ---------- A2a 公式实时代入行（teach 卡 title/formula 之下的「代入行」） ----------
// 与 explain.js 理论行同公式同口径（atwood a=(m1−m2)g/(m1+m2)、incline a=g sinθ…），
// 单测交叉锁定，不许漂移。返回 null = 该场景无确定代入行（诚实降级，不编数字）。
export function substitutionLine(plan, doc, moment) {
  const family = sceneFamily(plan, doc);
  const g = Math.abs((doc && doc.gravity) || -9.81);
  const ents = (doc && doc.entities) || [];
  const dyn = ents.filter((e) => e.physics && e.physics.body === 'dynamic');

  if (family === 'atwood') {
    const hung = dyn.filter((e) => e.physics.onPulley);
    if (hung.length !== 2) return null;
    const [m1, m2] = hung.map((e) => e.physics.mass).sort((a, b) => b - a);
    const a = (m1 - m2) * g / (m1 + m2);
    if (moment === 'release') return `代入：a = (m₁−m₂)g/(m₁+m₂) = (${m1}−${m2})×${fmtNum(g)}/(${m1}+${m2}) = ${a.toFixed(2)} m/s²`;
    const T = 2 * m1 * m2 * g / (m1 + m2);
    return `代入：T = 2m₁m₂g/(m₁+m₂) = ${T.toFixed(2)} N，a = ${a.toFixed(2)} m/s²`;
  }
  if (family === 'incline') {
    const ramp = ents.find((e) => e.type === 'ramp');
    if (!ramp || ramp.params.angleDeg == null) return null;
    const th = ramp.params.angleDeg * Math.PI / 180;
    const mu = inclineFriction(doc);
    const a = mu > 0 ? g * (Math.sin(th) - mu * Math.cos(th)) : g * Math.sin(th);
    return `代入：a = g·${mu > 0 ? `(sinθ−μ·cosθ)` : 'sinθ'} = ${fmtNum(g)}×${mu > 0 ? `(sin${ramp.params.angleDeg}°−${fmtNum(mu)}·cos${ramp.params.angleDeg}°)` : `sin${ramp.params.angleDeg}°`} = ${a.toFixed(2)} m/s²`;
  }
  if (family === 'projectile' || family === 'freefall') {
    const m = dyn.find((e) => (e.physics.linvel || []).some((x) => Math.abs(x) > 0.05))
      || dyn.find((e) => (e.physics.linvel || [0, 0, 0])[1] !== 0);
    if (!m || !m.physics.linvel) return null;
    const [vx, vy] = m.physics.linvel;
    if (moment === 'highest' && vy > 0) return `代入：最高点 h = vy²/(2g) = ${vy.toFixed(1)}²/(2×${fmtNum(g)}) = ${(vy * vy / (2 * g)).toFixed(2)} m，此刻 vx = ${vx.toFixed(1)} m/s 不变`;
    if (family === 'projectile') return `代入：vy₀ = ${vy.toFixed(1)} m/s，vx = ${vx.toFixed(1)} m/s（水平匀速 × 竖直加速度 −g）`;
    if (vy > 0) return `代入：上升高度 h = v₀²/(2g) = ${vy.toFixed(1)}²/(2×${fmtNum(g)}) = ${(vy * vy / (2 * g)).toFixed(2)} m`;
    return null;
  }
  if (family === 'momentum') {
    const balls = dyn.filter((e) => e.type === 'sphere');
    if (balls.length < 2) return null;
    const [a, b] = balls;
    const m1 = a.physics.mass, m2 = b.physics.mass;
    const u1 = (a.physics.linvel || [0, 0, 0])[0], u2 = (b.physics.linvel || [0, 0, 0])[0];
    const M = m1 + m2;
    if (moment === 'contact') {
      const e1 = a.physics.restitution ?? 0, e2 = b.physics.restitution ?? 0;
      const e = (e1 + e2) / 2;   // 引擎按平均合成（AG-2 回归锚）
      if (e >= 0.95) {
        const v1 = ((m1 - m2) * u1 + 2 * m2 * u2) / M, v2 = ((m2 - m1) * u2 + 2 * m1 * u1) / M;
        return `代入：弹性碰撞 v₁ = ((m₁−m₂)u₁+2m₂u₂)/(m₁+m₂) = ${v1.toFixed(2)} m/s，v₂ = ${v2.toFixed(2)} m/s`;
      }
      const vc = (m1 * u1 + m2 * u2) / M;
      return `代入：完全非弹性 v′ = (m₁u₁+m₂u₂)/(m₁+m₂) = (${m1}×${u1}+${m2}×${u2})/${M} = ${vc.toFixed(2)} m/s`;
    }
    return `代入：动量 p = m₁u₁+m₂u₂ = ${m1}×${u1}+${m2}×${u2} = ${(m1 * u1 + m2 * u2).toFixed(2)} kg·m/s（守恒量）`;
  }
  if (family === 'spring') {
    const sp = ents.find((e) => e.type === 'spring');
    const m = dyn[0];
    if (!sp || !m) return null;
    const k = sp.params.stiffness, mm = m.physics.mass;
    const T = 2 * Math.PI * Math.sqrt(mm / k);
    return `代入：T = 2π√(m/k) = 2π√(${fmtNum(mm)}/${fmtNum(k)}) = ${T.toFixed(2)} s${moment === 'stretchMax' ? '（此刻弹性势能最大、动能为零）' : ''}`;
  }
  if (family === 'pendulum') {
    const r = ents.find((e) => e.type === 'rope');
    const aRope = (plan && plan.attaches || []).find((a) => a.type === 'rope');
    const L = (r && r.params ? r.params.length : null) ?? (aRope && aRope.length) ?? null;
    if (L == null) return null;
    if (moment === 'lowest') return `代入：最低点 T绳 − mg = mv²/L → 向心力由张力与重力合力提供（T = 2π√(L/g) = ${(2 * Math.PI * Math.sqrt(L / g)).toFixed(2)} s）`;
    return `代入：T = 2π√(L/g) = 2π√(${fmtNum(L)}/${fmtNum(g)}) = ${(2 * Math.PI * Math.sqrt(L / g)).toFixed(2)} s`;
  }
  if (family === 'celestial') {
    const G = (doc && doc.G) || 6.674e-11;
    const prim = ents.filter((e) => e.physics.gravitating);
    if (prim.length < 2) return null;
    const [A, B] = prim.slice().sort((a, b) => (b.physics.mass || 0) - (a.physics.mass || 0));
    const d = Math.hypot(...A.transform.pos.map((x, i) => x - B.transform.pos[i]));
    if (!d || !A.physics.mass) return null;
    const v = Math.sqrt(A.physics.mass * G / d);
    return `代入：v = √(GM/r) = √(${fmtNum(A.physics.mass)}×G/${fmtNum(d)}) = ${v.toPrecision(3)} m/s（圆轨道速率）`;
  }
  if (family === 'hinge') {
    const rod = dyn.find((e) => e.params && e.params.sx);
    if (!rod) return null;
    const L = rod.params.sx;
    return `代入：T = 2π√(2L/3g) = 2π√(2×${fmtNum(L)}/(3×${fmtNum(g)})) = ${(2 * Math.PI * Math.sqrt(2 * L / (3 * g))).toFixed(2)} s`;
  }
  if (family === 'liquid') {
    const m = dyn[0];
    if (!m || !m.physics.mass) return null;
    const tk = ents.find((e) => e.type === 'tank');
    const rho = tk && tk.params ? tk.params.density ?? 1000 : 1000;
    const V = m.params.radius ? (4 / 3) * Math.PI * m.params.radius ** 3 : null;
    if (V == null) return null;
    const Fb = rho * g * V;
    return `代入：F浮 = ρgV = ${fmtNum(rho)}×${fmtNum(g)}×${V.toFixed(4)} = ${Fb.toFixed(1)} N（全浸没；vs 重力 mg = ${(m.physics.mass * g).toFixed(1)} N → ${Fb > m.physics.mass * g ? '上浮' : Fb < m.physics.mass * g ? '下沉' : '悬浮'}）`;
  }
  return null;
}

// ---------- A2d 对比变式：从场景文档规则化派生（改参数非模型调用） ----------
// 深拷贝后仅动目标参数；原题↔变式一键切换=文档级切换，物理链路不变。
export function deriveVariants(doc) {
  if (!doc || !Array.isArray(doc.entities)) return [];
  const out = [];
  const clone = (mut) => {
    const c = JSON.parse(JSON.stringify(doc));
    mut(c);
    return c;
  };
  const dyn = doc.entities.filter((e) => e.physics && e.physics.body === 'dynamic');
  // 无摩擦版：任何动态体摩擦 > 0 才有意义
  if (dyn.some((e) => (e.physics.friction ?? 0) > 0)) {
    out.push({
      id: 'nofric', label: '无摩擦版',
      hint: '所有动态体摩擦归零——对照摩擦对运动的影响',
      doc: clone((c) => { for (const e of c.entities) if (e.physics && e.physics.body === 'dynamic') e.physics.friction = 0; }),
    });
  }
  // 质量减半版：恰一只主动态体时语义最清晰（多体改质量=整题改条件，仍合法）
  if (dyn.length >= 1 && dyn.every((e) => (e.physics.mass ?? 0) > 0)) {
    out.push({
      id: 'halfmass', label: '质量减半版',
      hint: '全部动态体质量减半——观察哪些量随质量变、哪些不变',
      doc: clone((c) => { for (const e of c.entities) if (e.physics && e.physics.body === 'dynamic') e.physics.mass = e.physics.mass / 2; }),
    });
  }
  // 初速加倍版：存在非零初速才有意义
  if (dyn.some((e) => (e.physics.linvel || []).some((x) => Math.abs(x) > 0.05))) {
    out.push({
      id: 'doublev', label: '初速加倍版',
      hint: '全部初速度 ×2——动能 ×4，检验速度平方依赖关系',
      doc: clone((c) => {
        for (const e of c.entities) if (e.physics && e.physics.linvel) e.physics.linvel = e.physics.linvel.map((x) => x * 2);
      }),
    });
  }
  return out.slice(0, 3);
}

// ---------- A3 新时机检测器（纯函数；workbench tickTeach 逐帧喂 prev/cur） ----------
// turn：水平折返——vx 变号且 |vy| 微小（水平往返运动的转折点）
export function detectTurn(prevVx, curVx, curVy, tol = 0.06) {
  return prevVx != null && Math.abs(curVy) < 0.15
    && ((prevVx > tol && curVx <= 0) || (prevVx < -tol && curVx >= 0));
}
// leaveSurface：接触结束即抛离——上一帧有接触支撑、本帧无且正在离面
export function detectLeaveSurface(prevOnGround, curOnGround, curVy) {
  return prevOnGround === true && curOnGround === false && curVy > 0.05;
}
// equilibrium：静息钳制触发——曾运动过（排除出生即静止）且速率连续 ≥1s 低于阈值
export function detectEquilibrium(wasMoving, stillForSec, curSpeed, tol = 0.02) {
  return wasMoving === true && stillForSec >= 1.0 && Math.abs(curSpeed) < tol;
}
// sinkFloat：浮沉平衡——浸入液体且竖直速度趋零（曾有明显浮沉运动）
export function detectSinkFloat(wasMovingVert, curVy, immersed) {
  return immersed === true && wasMovingVert === true && Math.abs(curVy) < 0.03;
}

// ---------- A4 讲解节奏策略表：moment 类型 → 暂停/慢放/持续（不再一刀切 1.6s） ----------
// slow=慢放倍率（0=不定格只提示）；hold=卡片持续 ms；pause=真定格（画面全停）。
export const TEACH_PACE = {
  release:    { slow: 0.5,  hold: 3000, pause: false, why: '开局交代装置与条件，半速足够' },
  contact:    { slow: 0,    hold: 4200, pause: true,  why: '碰撞一瞬即逝，必须定格看接触与形变' },
  highest:    { slow: 0.25, hold: 3600, pause: false, why: '折返点 vy=0，慢放体会速度方向翻转' },
  lowest:     { slow: 0.25, hold: 3200, pause: false, why: '最低点速度最大/张力最大，慢放强调' },
  ground:     { slow: 0,    hold: 3800, pause: true,  why: '落地即反弹，定格看落点与能量' },
  turn:       { slow: 0.25, hold: 3200, pause: false, why: '水平折返 vx=0，对应伸缩/回复极值' },
  leaveSurface: { slow: 0.25, hold: 3000, pause: false, why: '抛离瞬间只有支撑力消失，慢放可读' },
  equilibrium: { slow: 0.5, hold: 3000, pause: true,  why: '平衡态定格，读出稳态量' },
  sinkFloat:  { slow: 0.25, hold: 3200, pause: true,  why: '悬浮位置定格，对照 F浮=mg' },
  end:        { slow: 0.5,  hold: 5000, pause: false, why: '收尾总结留足阅读时间' },
};
export function paceFor(moment) {
  return TEACH_PACE[moment] || TEACH_PACE.release;
}

// ---------- A2c 语音旁白文案（纯构造；TTS 由 workbench 走 Web Speech） ----------
export function narrationText(tip, subLine) {
  const parts = [tip.title];
  if (tip.formula) parts.push(tip.formula);
  if (subLine) parts.push(subLine.replace(/代入：/, '').replace(/[＝=]/g, '等于'));
  return parts.filter(Boolean).join('。') + '。';
}
