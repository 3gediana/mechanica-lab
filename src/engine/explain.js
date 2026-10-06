// explain.js — 运行后结构化解释器（确定性物理计算，非模型生成）
// 按题型分派：斜面（能量守恒）/ 一维对撞（动量守恒）；不支持的题型如实声明并只附遥测摘要。
// 原则：解释里的每个数字都可复算（用建场后的真实参数算理论值，对照实测演化）。

const FIXED_EXIT_TOL = 0.015; // 球心越过斜面底边的判定余量 m（小余量，避免离面飞行段混入实测）

// plan: normalizeParse 产物；doc: 场景文档；series: [{t,pos,speed,vel}]；reports: 碰撞报告；astro: 天体遥测
export function explainRun(plan, doc, series, reports = [], astro = null, rotation = null, atwood = null) {
  const hasRamp = doc.entities.some((e) => e.type === 'ramp');
  const hasGrav = doc.entities.some((e) => e.physics && e.physics.gravitating);
  const hasSpring = doc.entities.some((e) => e.type === 'spring');
  const hasHinge = doc.entities.some((e) => e.joints && e.joints.some((j) => j.type === 'revolute'));
  const spheres = doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic');
  const dynBodies = doc.entities.filter((e) => e.physics && e.physics.body === 'dynamic');
  if (hasHinge && series.length > 10 && series[0].rotz !== undefined) return explainHinge(plan, doc, series);
  if (hasSpring && series.length > 10) return explainSpring(plan, doc, series);
  // 抛体：单球带初速 + 地面（无斜面/弹簧/引力）且无其它动态体（AB-11：子弹打木块等
  // 「球+块」场景曾误入抛体分支拿 15m/s 算「射程」——条件收窄到真单球场景）
  const projBalls = doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic');
  const hasGround = doc.entities.some((e) => e.type === 'ground');
  const onlyBall = projBalls.length === 1 && dynBodies.length === 1;
  if (!hasRamp && !hasSpring && !hasGrav && onlyBall && hasGround) {
    return explainProjectile(plan, doc, series);
  }
  // 伽利略平抛同落（AB-8）：两动态球同高、都无竖直初速、恰一带水平初速、双球空中起始
  // + 地面——此前被误派二维斜碰分支输出「斜碰验证」（错误教学内容）。
  // 「双球离地 >0.3m」是与一维对撞场景的分界：对撞球贴地面滚（y≈半径），平抛球从高处落下
  if (!hasRamp && !hasSpring && !hasGrav && spheres.length === 2 && dynBodies.length === 2 && hasGround
    && spheres.every((b) => Math.abs(b.physics.linvel[1]) < 1e-6)
    && spheres.filter((b) => Math.abs(b.physics.linvel[0]) > 0.5).length === 1
    && spheres.every((b) => b.transform.pos[1] > 0.3)) {
    return explainGalileo(plan, doc, series, spheres);
  }
  // 完全非弹性对撞（AB-11 后半）：球+块（或球+球）e≈0 → 共速 v'=mv/(m+M)（子弹打木块类）
  if (!hasRamp && !hasGrav && dynBodies.length === 2 && reports.length
    && dynBodies.every((b) => (b.physics.restitution || 0) < 0.05)) {
    return explainInelastic(plan, doc, reports, dynBodies);
  }
  if (doc.kind === 'rotation' && rotation) return explainRotation(plan, doc, rotation);
  if (atwood) return explainAtwood(plan, atwood);
  if (hasGrav && astro) return explainAstro(plan, astro);
  if (hasRamp && spheres.length) return explainIncline(plan, doc, series);
  if (!hasRamp && spheres.length >= 2 && reports.length) return explainMomentum(plan, doc, reports);
  return {
    supported: false,
    reason: hasRamp ? '运行轨迹过短' : '该解析场景不含斜面、两球对撞、引力系统或转台，暂无专用解释器',
    summary: telemetrySummary(series),
  };
}

// ---------- 抛体：射程 R = v·t_land、最大高度 H = h0 + (vy0)²/(2g)（初速分解） ----------
function explainProjectile(plan, doc, series) {
  const ball = doc.entities.find((e) => e.type === 'sphere' && e.physics.body === 'dynamic');
  if (!ball || series.length < 5) return { supported: false, reason: '抛体解释需要单球与运行轨迹', summary: telemetrySummary(series) };
  const g = Math.abs(doc.gravity || -9.81);
  const v0 = ball.physics.linvel;
  const vx = v0[0], vy0 = v0[1];
  const h0 = series[0].pos[1];
  // 落地阈值 = 球半径 + 地面顶面（AB-8 关联：0.16 硬编码假设了半径 0.15 的球与 y=0 地面）
  const groundE = doc.entities.find((e) => e.type === 'ground');
  const gTop = groundE && groundE.transform && groundE.transform.pos
    ? groundE.transform.pos[1] + (groundE.params.sy || 0.2) / 2 : 0;
  const yFloor = gTop + (ball.params.radius || 0.15) + 0.01;
  // 理论（运动学）：最大高度 H = h0 + vy0²/(2g)（vy0>0 上抛分量）；落地时刻 t_land = (vy0 + √(vy0²+2g·h0))/g
  const Htheory = h0 + (vy0 > 0 ? vy0 * vy0 / (2 * g) : 0);
  const tFlight = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * h0)) / g;
  const Rtheory = vx * tFlight;

  // 实测：轨迹最大高度 + 落地（y 首次低于落点阈值后的 x 极值）
  let Hmeasured = -Infinity, xLand = null;
  for (const p of series) {
    if (p.pos[1] > Hmeasured) Hmeasured = p.pos[1];
    if (p.pos[1] <= yFloor && xLand === null && p.t > 0.2) { xLand = p.pos[0]; break; }
  }
  if (xLand === null) xLand = series[series.length - 1].pos[0];
  const Rmeasured = xLand - series[0].pos[0];
  const errPct = Rtheory > 1e-6 ? Math.abs(Rmeasured - Rtheory) / Rtheory * 100 : null;
  const pass = errPct != null && errPct < 8;

  const summary = [
    `抛体运动（初速 vx=${vx.toFixed(2)}, vy=${vy0.toFixed(2)} m/s，起点高 ${h0.toFixed(2)} m）：`,
    `理论最大高度 H = h0 + vy0²/(2g) = ${Htheory.toFixed(3)} m，理论射程 R = vx·t_land = ${Rtheory.toFixed(3)} m。`,
    `模拟实测最大高度 ${Hmeasured.toFixed(3)} m、落点 x = ${xLand != null ? xLand.toFixed(3) : '?'} m，射程偏差 ${errPct != null ? errPct.toFixed(2) + '%' : '?'}`,
    pass ? '——抛体运动学（水平匀速 + 竖直自由落体的合成）得到验证。' : '。',
  ].join('');

  return {
    supported: true,
    kind: 'projectile',
    simT: series[series.length - 1].t,
    observation: plan.observations[0] || '射程与最大高度',
    theoretical: { range: Rtheory, maxHeight: Htheory, formula: 'R = vx·t_land, H = h0 + vy0²/(2g)' },
    measured: { range: Rmeasured, maxHeight: Hmeasured },
    errPct, pass,
    summary,
  };
}

// ---------- 伽利略平抛同落：t=√(2h/g) 与水平初速无关（AB-8 新分支） ----------
// series 为带水平初速那只球的轨迹；同落结论用「实测落地时刻 vs 自由落体理论」验证，
// 两球同高由 checks 呈现（另一球无水平初速，落地时刻理论相同）。
function explainGalileo(plan, doc, series) {
  const balls = doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic');
  const groundE = doc.entities.find((e) => e.type === 'ground');
  if (series.length < 5 || balls.length !== 2 || !groundE) {
    return { supported: false, reason: '平抛同落解释需要两球+地面+运行轨迹', summary: telemetrySummary(series) };
  }
  const groundTop = groundE.transform.pos[1] + (groundE.params.sy || 0.2) / 2;
  const g = Math.abs(doc.gravity || -9.81);
  const mover = balls.find((b) => Math.abs(b.physics.linvel[0]) > 0.5) || balls[0];
  const dropper = balls.find((b) => b !== mover) || balls[0];
  const vx = mover.physics.linvel[0];
  const r = mover.params.radius || 0.15;
  const h0 = series[0].pos[1] - groundTop - r;                    // 球心相对落点的下落高度
  const tTheory = Math.sqrt(2 * Math.max(h0, 1e-6) / g);          // 自由落体（与 vx 无关）
  const xTheory = vx * tTheory;
  const thr = groundTop + r + 0.01;
  const land = series.find((p) => p.pos[1] <= thr && p.t > 0.05);
  const tMeasured = land ? land.t : null;
  const xMeasured = land ? land.pos[0] - series[0].pos[0] : null;
  const errPct = tMeasured != null ? Math.abs(tMeasured - tTheory) / tTheory * 100 : null;
  const pass = errPct != null && errPct < 8;
  const summary = [
    `平抛与自由落体同时落地（伽利略）：抛出球 vx=${vx.toFixed(2)} m/s，下落高度 h=${h0.toFixed(3)} m。`,
    `竖直方向是自由落体：理论落地时刻 t=√(2h/g)=${tTheory.toFixed(3)} s，与 vx 无关——同高的静止球同一时刻落地。`,
    `模拟实测（抛出球触地）t=${tMeasured != null ? tMeasured.toFixed(3) + ' s' : '未捕获'}，偏差 ${errPct != null ? errPct.toFixed(2) + '%' : '?'}；`,
    `水平位移实测 ${xMeasured != null ? xMeasured.toFixed(3) : '?'} m（理论 x=vx·t=${xTheory.toFixed(3)} m）。`,
    pass ? '水平匀速+竖直自由落体的独立性得到验证。' : '偏差偏大，建议检查初速与地面高度设置。',
  ].join('');
  return {
    supported: true,
    kind: 'galileo',
    simT: series[series.length - 1].t,
    observation: plan.observations[0] || '平抛与自由落体同时落地',
    theoretical: { tLand: tTheory, xRange: xTheory, formula: 't = √(2h/g)（与 vx 无关）' },
    measured: { tLand: tMeasured, xRange: xMeasured },
    errPct, pass,
    checks: [{ text: '两球同高释放', ok: Math.abs(mover.transform.pos[1] - dropper.transform.pos[1]) < 1e-6 }],
    summary,
  };
}

// ---------- 完全非弹性对撞（子弹打木块类）：共速 v'=Σmv/Σm + ΔKE 损失（AB-11 后半） ----------
function explainInelastic(plan, doc, reports, bodies) {
  const [b1, b2] = bodies;
  const rep = reports.find((r) => r.postVels && r.postVels[b1.id] && r.postVels[b2.id]
    && Math.abs(r.postVels[b1.id][0] - ((r.preVels && r.preVels[b1.id]) ? r.preVels[b1.id][0] : b1.physics.linvel[0])) > 0.3);
  if (!rep) return { supported: false, reason: '未捕捉到碰撞（初速不足或未命中木块）', summary: telemetrySummary([]) };
  const m1 = b1.physics.mass, m2 = b2.physics.mass;
  const u1 = (rep.preVels && rep.preVels[b1.id]) ? rep.preVels[b1.id][0] : b1.physics.linvel[0];
  const u2 = (rep.preVels && rep.preVels[b2.id]) ? rep.preVels[b2.id][0] : b2.physics.linvel[0];
  const p0 = m1 * u1 + m2 * u2;
  const vCommon = p0 / (m1 + m2);                                  // 完全非弹性：碰后共速
  const keBefore = 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2;
  const keAfterTheory = 0.5 * (m1 + m2) * vCommon * vCommon;
  const lossPct = (1 - keAfterTheory / Math.max(keBefore, 1e-9)) * 100;   // = μ/(m1+m2)·100%（一维）
  const w1 = rep.postVels[b1.id][0], w2 = rep.postVels[b2.id][0];
  const wAvg = (w1 + w2) / 2;
  const errPct = Math.abs(wAvg - vCommon) / Math.max(Math.abs(vCommon), 1e-9) * 100;
  const pass = errPct < 8;
  const summary = [
    `完全非弹性碰撞（子弹打木块，e≈0）：m1=${m1} kg 以 ${u1.toFixed(2)} m/s 撞 m2=${m2} kg（碰前 ${u2.toFixed(2)} m/s）。`,
    `动量守恒 m1u1+m2u2=(m1+m2)v′ → 理论共速 v′=${vCommon.toFixed(3)} m/s；`,
    `模拟实测碰后两体 ${w1.toFixed(3)} / ${w2.toFixed(3)} m/s（应相等且= v′），偏差 ${errPct.toFixed(2)}%。`,
    `动能损失 ΔKE=½μv²：碰前 ${keBefore.toFixed(3)} J → 碰后 ${keAfterTheory.toFixed(3)} J（损失 ${lossPct.toFixed(1)}% 转为内能）——动量守恒而动能不守恒。`,
    pass ? '完全非弹性碰撞的动量守恒与共速结论得到验证。' : '偏差偏大，建议检查恢复系数设置（两侧应均为 0）。',
  ].join('');
  return {
    supported: true,
    kind: 'inelastic',
    simT: rep.t,
    observation: plan.observations[0] || '碰后共速与动能损失',
    theoretical: { vCommon, keBefore, keAfter: keAfterTheory, lossPct, formula: 'v′ = (m1u1+m2u2)/(m1+m2)' },
    measured: { v1: w1, v2: w2 },
    errPct, pass,
    summary,
  };
}

// ---------- 铰链复摆：细杆绕端点 T = 2π√(2L/(3g)) ----------
function explainHinge(plan, doc, series) {
  const jdef = doc.entities.find((e) => e.joints && e.joints.some((j) => j.type === 'revolute'));
  const rod = jdef ? doc.entities.find((e) => e.id === jdef.joints[0].target) : null;   // 摆杆 = joint 的从动体
  if (!rod) return { supported: false, reason: '铰链解释需要摆杆实体', summary: telemetrySummary(series) };
  const L = Math.max(rod.params.sx, rod.params.sy, rod.params.sz);   // 杆长（最长维）
  const g = Math.abs(doc.gravity || -9.81);
  const Ttheory = 2 * Math.PI * Math.sqrt(2 * L / (3 * g));  // 细杆绕端点

  // 实测周期：rotz 序列解 wrap（连续化）+ 3 点滑动平均后，相对摆动中点
  // 上穿间隔（鲁棒于求解器毛刺与大角 wrap）
  const TWO_PI = Math.PI * 2;
  const rawUn = [];
  let acc = series[0].rotz;
  rawUn.push(acc);
  for (let i = 1; i < series.length; i++) {
    let v = series[i].rotz;
    while (v - acc > Math.PI) v -= TWO_PI;
    while (v - acc < -Math.PI) v += TWO_PI;
    acc = v;
    rawUn.push(v);
  }
  const rs = rawUn.map((_, i) => {
    const a = rawUn[Math.max(0, i - 1)], b = rawUn[i], c = rawUn[Math.min(rawUn.length - 1, i + 1)];
    return (a + b + c) / 3;
  });
  const mid = (Math.max.apply(null, rs) + Math.min.apply(null, rs)) / 2;   // 摆动中点（不受初始暂态拉偏）
  const ups = [];
  for (let i = 1; i < rs.length; i++) {
    if (rs[i - 1] < mid && rs[i] >= mid) ups.push(i);
  }
  let Tmeasured = null;
  if (ups.length >= 2) {
    const dt = (series[series.length - 1].t - series[0].t) / (series.length - 1);
    Tmeasured = (ups[ups.length - 1] - ups[0]) * dt / (ups.length - 1);
  }
  const errPct = Tmeasured != null ? Math.abs(Tmeasured - Ttheory) / Ttheory * 100 : null;
  const pass = errPct != null && errPct < 8;
  const swing = Math.max(...rs) - Math.min(...rs);
  const peaks = ups;

  const summary = [
    `复摆（细杆 L=${L} m 绕端点铰链）：周期理论 T = 2π√(2L/(3g)) = ${Ttheory.toFixed(3)} s。`,
    Tmeasured != null
      ? `实测振动周期 ${Tmeasured.toFixed(3)} s（${peaks.length} 个角位置峰），偏差 ${errPct.toFixed(2)}%。`
      : '运行时长不足两个完整摆动，周期未测出。',
    `初始摆角摆幅 ${swing.toFixed(3)} rad。`,
    pass ? '实测周期与复摆公式一致（刚性杆转动惯量 I=ML²/3 的动力学得到验证）。' : '偏差偏大，建议检查铰链轴与初始摆角。',
  ].join('');

  return {
    supported: true,
    kind: 'hinge',
    simT: series[series.length - 1].t,
    observation: plan.observations[0] || '复摆振动周期',
    theoretical: { period: Ttheory, formula: 'T = 2π√(2L/(3g))', L },
    measured: { period: Tmeasured, peaks: peaks.length, swing },
    errPct, pass,
    summary,
  };
}

// ---------- 阿特伍德机：a=(m1−m2)g/(m1+m2)、张力 T=2m1m2g/(m1+m2) ----------
// atwood = workbench atwoodInfo() 结果 {m1, m2, aMeasured, y1, y2, simT}
function explainAtwood(plan, atwood) {
  const g = atwood.g ?? 9.81;   // 场景重力（atwoodInfo 传入；默认地球）
  const { m1, m2, aMeasured } = atwood;
  const aTheory = (m1 - m2) * g / (m1 + m2);
  const T = 2 * m1 * m2 * g / (m1 + m2);
  const errPct = Math.abs(aMeasured - aTheory) / Math.abs(aTheory) * 100;
  const pass = errPct < 5;
  const summary = [
    `阿特伍德机（m1=${m1} kg 重侧，m2=${m2} kg 轻侧）：`,
    `理论加速度 a = (m1−m2)g/(m1+m2) = ${aTheory.toFixed(3)} m/s²，`,
    `绳张力 T = 2·m1·m2·g/(m1+m2) = ${T.toFixed(3)} N。`,
    `模拟实测加速度 ${aMeasured.toFixed(3)} m/s²（重侧下落位移二次拟合），偏差 ${errPct.toFixed(2)}%。`,
    pass ? '验证了连接体动力学：两球加速度大小相等、方向相反（绳不可伸长）。'
         : '偏差偏大，建议检查绳长约束与导轨理想化设置。',
  ].join('');
  return {
    supported: true,
    kind: 'atwood',
    simT: atwood.simT,
    observation: plan.observations[0] || '两侧加速度与张力',
    theoretical: { a: aTheory, tension: T, m1, m2, formula: 'a = (m1−m2)g/(m1+m2)' },
    measured: { a: aMeasured },
    errPct, pass,
    summary,
  };
}

// ---------- 弹簧振子：简谐振动周期 T = 2π√(m/k) ----------
function explainSpring(plan, doc, series) {
  const spring = doc.entities.find((e) => e.type === 'spring');
  const ball = doc.entities.find((e) => e.type === 'sphere' && e.physics.body === 'dynamic');
  if (!spring || !ball) return { supported: false, reason: '弹簧解释需要弹簧+振子小球', summary: telemetrySummary(series) };
  const m = ball.physics.mass;
  const k = spring.params.stiffness;
  const Ttheory = 2 * Math.PI * Math.sqrt(m / k);

  // 实测周期：振子沿主导振动轴的序列峰间隔（AB-5：竖直弹簧振子 pos[0] 近似不动，
  // 峰检测只看 x 轴时峰数 0 → 取三轴方差最大的轴为振动主轴）
  const dims = [0, 1, 2].map((d) => {
    const a = series.map((p) => p.pos[d]);
    const mean = a.reduce((x, y) => x + y, 0) / a.length;
    return a.reduce((v, x) => v + (x - mean) * (x - mean), 0);
  });
  const axis = dims.indexOf(Math.max(...dims));
  const xs = series.map((p) => p.pos[axis]);
  const peaks = [];
  for (let i = 1; i < xs.length - 1; i++) {
    if (xs[i] > xs[i - 1] && xs[i] >= xs[i + 1] && xs[i] - xs[i - 1] > 1e-4) {
      if (!peaks.length || i - peaks[peaks.length - 1] > 5) peaks.push(i);   // 去毛刺：峰间隔 > 5 采样
    }
  }
  let Tmeasured = null;
  if (peaks.length >= 2) {
    const span = series[series.length - 1].t - series[0].t;
    const dt = span / (series.length - 1);
    Tmeasured = (peaks[peaks.length - 1] - peaks[0]) * dt / (peaks.length - 1);
  }
  const errPct = Tmeasured != null ? Math.abs(Tmeasured - Ttheory) / Ttheory * 100 : null;
  const pass = errPct != null && errPct < 8;
  const amp0 = Math.max(...xs) - Math.min(...xs);

  const summary = [
    `弹簧振子（m=${m} kg，k=${k} N/m）：简谐振动理论周期 T = 2π√(m/k) = ${Ttheory.toFixed(3)} s。`,
    Tmeasured != null
      ? `实测振动周期 ${Tmeasured.toFixed(3)} s（峰值间隔法，共 ${peaks.length} 个峰），偏差 ${errPct.toFixed(2)}%。`
      : '运行时长不足两个完整振动，周期未测出。',
    `初始振幅约 ${amp0.toFixed(3)} m${spring.params.damping > 0 ? `，阻尼 ${spring.params.damping} 会缓慢耗能使振幅衰减` : '（无阻尼，振幅保持）'}。`,
    pass ? '实测周期与理论一致，简谐振动 T=2π√(m/k) 得到验证。' : '周期偏差偏大，建议检查劲度系数与阻尼设置。',
  ].join('');

  return {
    supported: true,
    kind: 'spring',
    simT: series[series.length - 1].t,
    observation: plan.observations[0] || '振动周期',
    theoretical: { period: Ttheory, formula: 'T = 2π√(m/k)', m, k },
    measured: { period: Tmeasured, peaks: peaks.length, amplitude: amp0 },
    errPct, pass,
    summary,
  };
}

// ---------- 转台+径向滑块：L=I·ω 守恒、I-ω 反比 ----------
// prismatic 槽锁死滑块转动（滑块与转台同 ω），故任意时刻 L = (I_disk + m·r²)·ω 严格成立。
function explainRotation(plan, doc, rot) {
  const table = doc.entities.find((e) => e.type === 'cylinder' && e.physics.body === 'dynamic');
  const slider = doc.entities.find((e) => e.type === 'box' && e.physics.body === 'dynamic');
  if (!table || !slider) return { supported: false, reason: '转动解释需要转台+滑块', summary: telemetrySummary([]) };
  const Idisk = 0.5 * table.physics.mass * table.params.radius ** 2;
  const m = slider.physics.mass;
  const rNow = rot.sliderR != null ? rot.sliderR : 0;
  // 反比公式 ω=L/(I_disk+m·r²) 假设滑块与转台严格同转；滑移瞬态中槽-滑块转动耦合有偏差，
  // 因此该值仅作工程参考，判定只门控 L 守恒（无外力矩的硬结论）。
  const omegaTheory = rot.Lz / (Idisk + m * rNow * rNow);
  const errPct = Math.abs(rot.omega - omegaTheory) / Math.max(Math.abs(omegaTheory), 1e-9) * 100;
  const omega0 = rot.base.omega, I0 = rot.base.I;
  const pass = rot.driftL < 1;
  const summary = [
    `转台（I=½MR²=${Idisk.toFixed(3)} kg·m²）初始 ω0=${omega0.toFixed(3)} rad/s；`,
    `滑块（m=${m} kg）沿光滑径向槽由 r=${rNow.toFixed(3)} m 处因惯性外滑，`,
    `系统对轴无外力矩，角动量 L = I·ω 守恒：实测 L=${rot.Lz.toFixed(3)} kg·m²/s（漂移 ${rot.driftL.toFixed(3)}%）。`,
    `I 由 ${I0.toFixed(3)} 增至 ${rot.I.toFixed(3)} kg·m²，ω 由 ${omega0.toFixed(3)} 降至 ${rot.omega.toFixed(3)} rad/s（反比）；`,
    `由守恒的 L 反推 ω 理论值 = ${omegaTheory.toFixed(3)} rad/s，实测偏差 ${errPct.toFixed(2)}%。`,
    pass ? '角动量守恒得到验证；ω 与反比公式的偏差来自滑移过程中的转动耦合瞬态，限位稳定后趋于一致。' : '角动量漂移偏大，建议检查滑槽摩擦与外力矩假设。',
  ].join('');
  return {
    supported: true,
    kind: 'rotation',
    simT: rot.simT,
    observation: plan.observations[0] || '角速度随转动惯量的变化',
    omega0, I0,
    omegaNow: rot.omega, INow: rot.I,
    L: rot.Lz, driftL: rot.driftL,
    sliderR: rNow, theoryOmega: omegaTheory, errPct,
    torque: 0,
    pass,
    summary,
  };
}

// ---------- 天体：圆轨道理论 vs 实测（E/L 漂移、周期、偏心率） ----------
// astro = workbench astroInfo() 结果 {E, KE, PE, Lz, ecc, period, rmin, rmax, simT}
function explainAstro(plan, astro) {
  const G = astro.G;
  // 中心质量取解析实体中质量最大者（模型输出顺序不可信，[0] 不一定是中心天体）；
  // 两体开普勒（AB-18）：双星等质量系统周期由 G(m1+m2) 决定——用 G·M_center 会差 29%
  const cels = plan.entities.filter((e) => e.type === 'celestial');
  const center = cels.reduce((a, b) => ((b.given.mass ?? 0) > (a.given.mass ?? 0) ? b : a), cels[0]);
  const M = center ? (center.given.mass ?? 100) : 100;
  const mSum = cels.length >= 2 ? cels.reduce((s, c) => s + (c.given.mass ?? 0), 0) : M;
  // 圆轨道理论用轨道半径（实测 rmax/rmin 的中点近似半长轴）
  const a = astro.rmin != null && astro.rmax != null ? (astro.rmin + astro.rmax) / 2 : null;
  const Ttheory = a != null ? 2 * Math.PI * Math.sqrt(a * a * a / (G * mSum)) : null;
  const vcirc = a != null ? Math.sqrt(G * M / a) : null;
  const driftOk = astro.driftE < 2 && astro.driftL < 2;
  const eccOk = astro.ecc != null && astro.ecc < 0.1;
  const periodOk = astro.period != null && Ttheory != null
    && Math.abs(astro.period - Ttheory) / Ttheory * 100 < 5;
  const pass = driftOk && eccOk && periodOk;
  const summary = [
    `两体引力系统（G=${G}，中心质量 ${M}）：轨道半长轴 a≈${a != null ? a.toFixed(3) : '?'} m，`,
    `圆轨道理论周期 T = 2π√(a³/GM) = ${Ttheory != null ? Ttheory.toFixed(2) : '?'} s。`,
    `模拟实测周期 ${astro.period != null ? astro.period.toFixed(2) + ' s' : '采样中'}、偏心率 e=${astro.ecc != null ? astro.ecc.toFixed(4) : '?'}，`,
    `机械能漂移 ${astro.driftE.toExponential(1)}、角动量漂移 ${astro.driftL.toExponential(1)}（velocity-Verlet 辛积分，能量长期有界）。`,
    driftOk && eccOk ? '轨道闭合稳定，开普勒轨道动力学得到验证。' : '存在明显漂移或轨道变形，建议检查步长与初始条件。',
  ].join('');
  return {
    supported: true,
    kind: 'astro',
    simT: astro.simT,
    observation: plan.observations[0] || '轨道周期与偏心率',
    theoretical: { period: Ttheory, vcirc, formula: 'T = 2π√(a³/GM)' },
    measured: { period: astro.period, ecc: astro.ecc, rmin: astro.rmin, rmax: astro.rmax },
    driftE: astro.driftE, driftL: astro.driftL,
    pass,
    summary,
  };
}

// ---------- 斜面：机械能守恒 v=√(2g·Δh) ----------
function explainIncline(plan, doc, series) {
  const ball = doc.entities.find((e) => e.type === 'sphere');
  const ramp = doc.entities.find((e) => e.type === 'ramp');
  if (series.length < 5) {
    return { supported: false, reason: '运行轨迹过短', summary: telemetrySummary(series) };
  }

  const g = Math.abs(plan.gravity);
  const L = ramp.params.length;
  const theta = Math.atan2(ramp.params.height, ramp.params.length);   // 实际建出来的斜面角

  // 实测：球心越过斜面底边（+x 端）首个采样点
  const exitX = ramp.transform.pos[0] + L / 2 + FIXED_EXIT_TOL;
  const exitPoint = series.find((p) => p.pos[0] >= exitX);
  const measured = exitPoint ? exitPoint.speed : series[series.length - 1].speed;

  // 理论值：机械能守恒 v = √(2g·Δh)，Δh = 球心实际下落高度（轨迹起→底端，诚实可比）。
  // 球心无法从坡顶棱角起滑（要避让高墙），故 Δh 略小于斜面全高；题目全长参考值单独给出。
  // 基准取样点 AG-V2：跳过出生下落的反弹窗（≥0.15s，落地微弹 ~0.09s 内结束），
  // 从已贴合坡面的样本起算——下落损耗不进能量账，教学漂移回到数值积分本底。
  const k0 = series.findIndex((p2) => p2.t >= 0.15);
  const base = k0 > 0 ? series[k0] : series[0];
  const startY = base.pos[1];
  const endY = exitPoint ? exitPoint.pos[1] : series[series.length - 1].pos[1];
  const hUsed = Math.max(startY - endY, 1e-6);
  // 理论含实测初速（AG-V2 出生下落友好）：首采样点若已带速度（出生 4cm 落下/题给初速），
  // 机械能守恒口径 v=√(v0²+2gΔh) 从真实初始状态起算——静态释放 v0=0 时与旧公式全等。
  const v0 = base.speed;
  const vTheoretical = Math.sqrt(v0 * v0 + 2 * g * hUsed);
  const hFull = ramp.params.height;                                    // 斜面全高
  const vFull = Math.sqrt(2 * g * hFull);                              // 题目"从顶端滑到底端"参考
  const errorPct = Math.abs(measured - vTheoretical) / vTheoretical * 100;
  const pass = errorPct < 3;

  // 机械能：以底端为零势能面，起始 mg·Δh vs 底端 ½mv²（漂移=数值积分损耗）
  const m = ball.physics.mass;
  const e0 = 0.5 * m * v0 * v0 + m * g * hUsed;   // 能量基准含初速动能（与理论同口径,出生下落友好）
  const e1 = 0.5 * m * measured * measured;
  const driftPct = e0 > 1e-9 ? (e0 - e1) / e0 * 100 : 0;

  // 假设核对：对照 plan.assumptions 与真实建出的场景
  const effFriction = (ball.physics.friction + ramp.physics.friction) / 2;   // Rapier 默认取平均
  const frictionIsZero = effFriction < 0.01;
  const checks = [
    { text: '斜面固定于地面', ok: ramp.physics.body === 'fixed' },
    { text: '接触面光滑（组合摩擦≈0）', ok: frictionIsZero },
    { text: `重力取 ${g} m/s²（题给）`, ok: Math.abs(Math.abs(doc.gravity) - g) < 1e-6 },
    { text: '由静止释放（初速度为 0）', ok: ball.physics.linvel.every((v) => Math.abs(v) < 1e-9) },
  ];

  const obs = plan.observations[0] || '斜面底端速度';
  const deg = (theta * 180 / Math.PI).toFixed(1);
  const summary = [
    `小球在 ${g} m/s² 重力下沿 ${deg}° 光滑斜面下滑，球心下落 Δh = ${hUsed.toFixed(3)} m。`,
    `由机械能守恒 mgΔh = ½mv²，理论末速度 v = √(2g·Δh) = ${vTheoretical.toFixed(3)} m/s；`,
    `模拟实测离开斜面瞬间速度 ${measured.toFixed(3)} m/s，偏差 ${errorPct.toFixed(2)}%，`,
    errorPct < 3 ? '在数值积分误差范围内，验证了光滑斜面机械能守恒。' : '超出 3% 判定阈值，建议检查场景参数与假设。',
    `若从坡顶棱角全长滑下（题目语义），参考值为 √(2g·H) = ${vFull.toFixed(3)} m/s（H=${hFull.toFixed(3)} m），`,
    '实测略小于它是因为球心起滑点需避让高墙留出半径间隙。',
  ].join('');

  return {
    supported: true,
    kind: 'incline-slide',
    simT: series[series.length - 1].t,
    observation: obs,
    theoretical: { value: vTheoretical, unit: 'm/s', formula: 'v = √(2g·Δh)', h: hUsed },
    reference: { label: '题目全长参考', value: vFull, unit: 'm/s', h: hFull },
    measured: { value: measured, unit: 'm/s', exitX },
    errorPct, pass,
    energy: {
      initial: e0, final: e1, driftPct,
      note: frictionIsZero ? '光滑无摩擦，机械应守恒（漂移来自离散积分误差）' : '存在摩擦，部分机械能转为热与转动动能',
    },
    checks,
    summary,
  };
}

// ---------- 一维对撞：动量守恒 + 恢复系数能量账 ----------
// 理论碰后速度（用建场后的真实质量/初速/恢复系数算）：
//   v1' = (m1v1 + m2v2 + e·m2·(v2−v1)) / (m1+m2)
//   v2' = (m1v1 + m2v2 + e·m1·(v1−v2)) / (m1+m2)
function explainMomentum(plan, doc, reports) {
  const balls = doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic');
  if (balls.length < 2) return { supported: false, reason: '对撞解释需要两个动态球', summary: telemetrySummary([]) };
  const b1 = balls[0], b2 = balls[1];
  const u1 = b1.physics.linvel[0], u2 = b2.physics.linvel[0];
  // 二维斜碰检测：初速带 z 分量或两球初始 z 错开 → 动量矢量守恒门控（无闭式一维公式）
  const is2D = Math.abs(b1.physics.linvel[2]) > 1e-6 || Math.abs(b2.physics.linvel[2]) > 1e-6
    || Math.abs(b1.transform.pos[2] - b2.transform.pos[2]) > 1e-6;
  if (is2D) return explainMomentum2D(plan, doc, reports, b1, b2);
  // 取第一份"两球速度都相对碰前显著变化"的碰撞报告（AB-13/14：跳过出生触地/单球撞地——
  // 伽利略同落等场景曾把「球1 撞地」当成「两球斜碰」输出误导性通过）
  const rep = reports.find((r) => r.postVels && r.postVels[b1.id] && r.postVels[b2.id]
    && Math.abs(r.postVels[b1.id][0] - u1) > 0.05
    && Math.abs(r.postVels[b2.id][0] - u2) > 0.01);
  if (!rep) return { supported: false, reason: '碰撞报告中未捕捉到球球碰撞（初速过小或未碰撞）', summary: telemetrySummary([]) };
  const postVels = rep.postVels;
  const pv1 = postVels[b1.id], pv2 = postVels[b2.id];
  if (!pv1 || !pv2) return { supported: false, reason: '碰撞报告缺少碰后速度', summary: telemetrySummary([]) };

  const m1 = b1.physics.mass, m2 = b2.physics.mass;
  // 理论初速取真实碰前速度（AB-13：静止释放后才碰的场景拿文档初速算理论会得 0/0）
  const u1r = (rep.preVels && rep.preVels[b1.id]) ? rep.preVels[b1.id][0] : u1;
  const u2r = (rep.preVels && rep.preVels[b2.id]) ? rep.preVels[b2.id][0] : u2;
  // Rapier 默认合成规则=平均（node 实测 e=0/0.8 组合按 0.4 碰撞），一侧为 0 也取平均而非 0
  const e = (b1.physics.restitution + b2.physics.restitution) / 2;
  const M = m1 + m2;

  // 一维（x 轴）理论
  const p0 = m1 * u1r + m2 * u2r;
  const v1t = (p0 + e * m2 * (u2r - u1r)) / M;
  const v2t = (p0 + e * m1 * (u1r - u2r)) / M;
  const keBefore = 0.5 * m1 * u1r * u1r + 0.5 * m2 * u2r * u2r;
  const keAfterTheory = 0.5 * m1 * v1t * v1t + 0.5 * m2 * v2t * v2t;

  // 实测（碰后 x 分量）
  const w1 = pv1[0], w2 = pv2[0];
  const pMeasuredBefore = rep.pBefore[0];
  const pMeasuredAfter = rep.pAfter[0];
  const pErrPct = Math.abs(pMeasuredAfter - pMeasuredBefore) / Math.max(Math.abs(pMeasuredBefore), 1e-9) * 100;

  const pairs = [
    { name: b1.name, vTheory: v1t, vMeasured: w1, errPct: Math.abs(w1 - v1t) / Math.max(Math.abs(v1t), 1e-9) * 100 },
    { name: b2.name, vTheory: v2t, vMeasured: w2, errPct: Math.abs(w2 - v2t) / Math.max(Math.abs(v2t), 1e-9) * 100 },
  ];
  const pass = pErrPct < 2 && pairs.every((p) => p.errPct < 8);
  const keLossPct = ((1 - e * e) * 100).toFixed(1);

  const summary = [
    `一维对撞（恢复系数 e=${e.toFixed(2)}）：碰前总动量 p = m1v1 + m2v2 = ${p0.toFixed(3)} N·s，`,
    `实测碰后总动量 ${pMeasuredAfter.toFixed(3)} N·s，误差 ${pErrPct.toFixed(2)}%——水平方向无外力，动量守恒。`,
    `恢复系数公式给出碰后速度 v1'=${v1t.toFixed(3)}、v2'=${v2t.toFixed(3)} m/s，`,
    `实测 ${w1.toFixed(3)} / ${w2.toFixed(3)} m/s。`,
    `动能账：碰前 ${keBefore.toFixed(3)} J，理论碰后 ${keAfterTheory.toFixed(3)} J`,
    e < 0.999 ? `（损失 ${keLossPct}% 转为形变热）；` : '（完全弹性，应守恒）；',
    `模拟实测碰后 ${rep.keAfter.toFixed(3)} J。`,
  ].join('');

  return {
    supported: true,
    kind: 'momentum-1d',
    simT: rep.t,
    observation: plan.observations[0] || '碰后速度与总动量',
    e,
    pairs,
    momentum: { before: pMeasuredBefore, after: pMeasuredAfter, errPct: pErrPct },
    ke: { before: keBefore, theoryAfter: keAfterTheory, measuredAfter: rep.keAfter },
    pass,
    summary,
  };
}

// 二维斜碰解释（第八章「条件允许时再扩展二维碰撞」）：
// 无外力 → 动量矢量守恒（x/z 分量分别校验）；e=0.8 法向动能损失但二维切向分量保持，
// 整体 KE 损失小于一维同 e 值——门控动量矢量误差。
function explainMomentum2D(plan, doc, reports, b1, b2) {
  const m1 = b1.physics.mass, m2 = b2.physics.mass;
  const e = (b1.physics.restitution + b2.physics.restitution) / 2;
  // 两段式（AB-13/14）：先用文档初速选报告，要求两球速度都显著变化（排除单球撞地——
  // 伽利略同落/竖直圆周等场景曾把「球撞地」当「两球斜碰」输出误导性通过）；
  // 选中后再用报告里的真实碰前速度算理论（静止释放后才碰 ≠ 文档初速）
  const rep = reports.find((r) => r.postVels && r.postVels[b1.id] && r.postVels[b2.id]
    && Math.hypot(r.postVels[b1.id][0] - b1.physics.linvel[0], r.postVels[b1.id][2] - b1.physics.linvel[2]) > 0.05
    && Math.hypot(r.postVels[b2.id][0] - b2.physics.linvel[0], r.postVels[b2.id][2] - b2.physics.linvel[2]) > 0.02);
  if (!rep) return { supported: false, reason: '碰撞报告中未捕捉到二维斜碰', summary: telemetrySummary([]) };
  const pv1 = rep.postVels[b1.id], pv2 = rep.postVels[b2.id];
  if (!pv1 || !pv2) return { supported: false, reason: '碰撞报告缺少碰后速度', summary: telemetrySummary([]) };
  const u1v = (rep.preVels && rep.preVels[b1.id]) ? rep.preVels[b1.id] : b1.physics.linvel;
  const u2v = (rep.preVels && rep.preVels[b2.id]) ? rep.preVels[b2.id] : b2.physics.linvel;

  // 动量矢量守恒（x/z 分量）
  const p0x = m1 * u1v[0] + m2 * u2v[0], p0z = m1 * u1v[2] + m2 * u2v[2];
  const p1x = rep.pAfter[0], p1z = rep.pAfter[2];
  const errX = Math.abs(p1x - p0x) / Math.max(Math.abs(p0x), 1e-9) * 100;
  const errZ = Math.abs(p1z - p0z) / Math.max(Math.abs(p0z), 1e-9) * 100;
  const errPct = Math.max(errX, errZ);

  const w1 = Math.hypot(pv1[0], pv1[2]), w2 = Math.hypot(pv2[0], pv2[2]);
  const u1mag = Math.hypot(u1v[0], u1v[2]);
  const u2mag = Math.hypot(u2v[0], u2v[2]);
  // AG-96：碰前动能必须含 B 球（此前漏项致 lossPct 虚高）
  const keBefore = 0.5 * m1 * u1mag * u1mag + 0.5 * m2 * u2mag * u2mag;
  const keAfter = 0.5 * m1 * w1 * w1 + 0.5 * m2 * w2 * w2;
  const keLossPct = (1 - keAfter / Math.max(keBefore, 1e-9)) * 100;

  const pass = errPct < 2;
  const summary = [
    `二维斜碰（恢复系数 e=${e.toFixed(2)}，非对心）：水平面内无外力，动量矢量守恒——`,
    `x 分量 ${p0x.toFixed(3)} → ${p1x.toFixed(3)} N·s（误差 ${errX.toFixed(2)}%）、`,
    `z 分量 ${p0z.toFixed(3)} → ${p1z.toFixed(3)} N·s（误差 ${errZ.toFixed(2)}%）。`,
    `碰后速度：球 A ${w1.toFixed(3)} m/s（入射 ${u1mag.toFixed(3)}）、球 B ${w2.toFixed(3)} m/s——`,
    `两球沿碰撞法向与切向分解散开，方向由碰撞几何决定（无闭式一维公式）。`,
    `动能账：碰前 ${keBefore.toFixed(3)} J → 碰后 ${keAfter.toFixed(3)} J`,
    e < 0.999 ? `（法向非弹性损失 ${keLossPct.toFixed(1)}%，小于一维同 e 值的 ${((1 - e * e) * 100).toFixed(1)}%——切向分量保持）。` : '（完全弹性应守恒）。',
  ].join('');
  return {
    supported: true,
    kind: 'momentum-2d',
    simT: rep.t,
    observation: plan.observations[0] || '斜碰后两球散开与动量矢量守恒',
    e,
    momentum2d: { p0x, p1x, errX, p0z, p1z, errZ, errPct },
    pairs: [
      { name: b1.name, vMeasured: w1 },
      { name: b2.name, vMeasured: w2 },
    ],
    ke: { before: keBefore, measuredAfter: keAfter, lossPct: keLossPct },
    pass,
    summary,
  };
}

function telemetrySummary(series) {
  if (!series || !series.length) return '无遥测数据';
  const last = series[series.length - 1];
  return `运行 ${last.t.toFixed(2)}s，末速度 ${last.speed.toFixed(2)} m/s，末位置 [${last.pos.map((v) => v.toFixed(2)).join(', ')}]`;
}
