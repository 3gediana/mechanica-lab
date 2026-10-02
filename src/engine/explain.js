// explain.js — 运行后结构化解释器（确定性物理计算，非模型生成）
// 输入解析计划 + 运行轨迹采样，输出理论值 vs 实测对比 / 机械能漂移 / 假设核对。
// 原则：解释里的每个数字都可复算；不支持题型明确声明并只附遥测摘要，不硬编。

const FIXED_EXIT_TOL = 0.015; // 球心越过斜面底边的判定余量 m（小余量，避免离面飞行段混入实测）

// plan: normalizeParse 产物；doc: 场景文档；series: [{t, pos[3], speed, vel[3]}]
export function explainRun(plan, doc, series) {
  const ball = doc.entities.find((e) => e.type === 'sphere');
  const ramp = doc.entities.find((e) => e.type === 'ramp');
  if (!ball || !ramp || series.length < 5) {
    return {
      supported: false,
      reason: !ball || !ramp ? '该解析场景缺少斜面+球，暂无专用解释器' : '运行轨迹过短',
      summary: telemetrySummary(doc, series),
    };
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

function telemetrySummary(doc, series) {
  if (!series.length) return '无遥测数据';
  const last = series[series.length - 1];
  return `运行 ${last.t.toFixed(2)}s，末速度 ${last.speed.toFixed(2)} m/s，末位置 [${last.pos.map((v) => v.toFixed(2)).join(', ')}]`;
}
