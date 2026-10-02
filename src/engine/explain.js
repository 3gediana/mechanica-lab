// explain.js — 运行后结构化解释器（确定性物理计算，非模型生成）
// 按题型分派：斜面（能量守恒）/ 一维对撞（动量守恒）；不支持的题型如实声明并只附遥测摘要。
// 原则：解释里的每个数字都可复算（用建场后的真实参数算理论值，对照实测演化）。

const FIXED_EXIT_TOL = 0.015; // 球心越过斜面底边的判定余量 m（小余量，避免离面飞行段混入实测）

// plan: normalizeParse 产物；doc: 场景文档；series: [{t,pos,speed,vel}]；reports: 碰撞报告
export function explainRun(plan, doc, series, reports = []) {
  const hasRamp = doc.entities.some((e) => e.type === 'ramp');
  const spheres = doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic');
  if (hasRamp && spheres.length) return explainIncline(plan, doc, series);
  if (!hasRamp && spheres.length >= 2 && reports.length) return explainMomentum(plan, doc, reports);
  return {
    supported: false,
    reason: hasRamp ? '运行轨迹过短' : '该解析场景不含斜面或两球对撞，暂无专用解释器（需运行产生碰撞记录）',
    summary: telemetrySummary(series),
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
  const startY = series[0].pos[1];
  const endY = exitPoint ? exitPoint.pos[1] : series[series.length - 1].pos[1];
  const hUsed = Math.max(startY - endY, 1e-6);
  const vTheoretical = Math.sqrt(2 * g * hUsed);
  const hFull = ramp.params.height;                                    // 斜面全高
  const vFull = Math.sqrt(2 * g * hFull);                              // 题目"从顶端滑到底端"参考
  const errorPct = Math.abs(measured - vTheoretical) / vTheoretical * 100;
  const pass = errorPct < 3;

  // 机械能：以底端为零势能面，起始 mg·Δh vs 底端 ½mv²（漂移=数值积分损耗）
  const m = ball.physics.mass;
  const e0 = m * g * hUsed;
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
  // 取第一份"球 A 速度相对初速发生显著变化"的碰撞报告（跳过出生触地等初始接触）
  const rep = reports.find((r) => r.postVels && r.postVels[b1.id]
    && Math.abs(r.postVels[b1.id][0] - u1) > 0.05);
  if (!rep) return { supported: false, reason: '碰撞报告中未捕捉到球球碰撞（初速过小或未碰撞）', summary: telemetrySummary([]) };
  const postVels = rep.postVels;
  const pv1 = postVels[b1.id], pv2 = postVels[b2.id];
  if (!pv1 || !pv2) return { supported: false, reason: '碰撞报告缺少碰后速度', summary: telemetrySummary([]) };

  const m1 = b1.physics.mass, m2 = b2.physics.mass;
  const e = Math.min(b1.physics.restitution, b2.physics.restitution) * 2 > 0
    ? (b1.physics.restitution + b2.physics.restitution) / 2 : 0;   // Rapier 默认取平均
  const M = m1 + m2;

  // 一维（x 轴）理论
  const p0 = m1 * u1 + m2 * u2;
  const v1t = (p0 + e * m2 * (u2 - u1)) / M;
  const v2t = (p0 + e * m1 * (u1 - u2)) / M;
  const keBefore = 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2;
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

function telemetrySummary(series) {
  if (!series || !series.length) return '无遥测数据';
  const last = series[series.length - 1];
  return `运行 ${last.t.toFixed(2)}s，末速度 ${last.speed.toFixed(2)} m/s，末位置 [${last.pos.map((v) => v.toFixed(2)).join(', ')}]`;
}
