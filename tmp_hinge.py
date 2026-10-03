from pathlib import Path

# ===== parse-schema: joint revolute 透传 + hingeLayout =====
p = Path('src/engine/parse-schema.js')
s = p.read_text(encoding='utf-8')
old = """      type: 'prismatic',
      from: Math.max(0, Number(raw.joint.from) | 0),"""
new = """      type: raw.joint.type === 'revolute' ? 'revolute' : 'prismatic',
      from: Math.max(0, Number(raw.joint.from) | 0),"""
assert old in s, 'joint type'
s = s.replace(old, new)

old = '// ---------- 弹簧振子布局'
new = '''// ---------- 铰链复摆布局：锚点基座 + 刚性杆（近锚端对齐锚点，初始摆角 1.2 rad） ----------
function hingeLayout(plan) {
  const out = [];
  const anchor = plan.entities.find((e) => e.type === 'box');
  const rod = plan.entities.filter((e) => e.type === 'box')[1];
  if (!anchor || !rod) return out;
  const aPos = anchor.given.position ?? [0, 2.5, 0];
  const L = rod.given.length ?? 1.0;
  const swing = 1.2;
  out.push({
    type: 'box', name: anchor.name || '铰链基座', source: 'agent',
    params: { sx: 0.2, sy: 0.2, sz: 0.2 },
    transform: { pos: [...aPos], rot: [0, 0, 0] },
    physics: { body: 'fixed', friction: 0.8 },
    render: { material: 'steelDark' },
  });
  out.push({
    type: 'box', name: rod.name || '摆杆', source: 'agent',
    params: { sx: L, sy: 0.06, sz: 0.06 },
    transform: {
      pos: [aPos[0] - (L / 2) * Math.cos(swing), aPos[1] - (L / 2) * Math.sin(swing), aPos[2] ?? 0],
      rot: [0, 0, swing],
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

// ---------- 弹簧振子布局'''
assert old in s, 'spring layout anchor'
s = s.replace(old, new, 1)

old = '''  if (plan.kind === 'rotation') return rotationLayout(plan);'''
new = '''  if (plan.kind === 'rotation') return rotationLayout(plan);
  if (plan.kind === 'hinge') return hingeLayout(plan);'''
assert old in s, 'dispatch'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('parse-schema hinge ok')

# ===== workbench: joint revolute 通用化 + runAndExplain hinge 分派 =====
p = Path('src/workbench.js')
s = p.read_text(encoding='utf-8')
old = '''  if (agentPlan.kind === 'rotation' && agentPlan.joint) {
    const fromId = created[agentPlan.joint.from], toId = created[agentPlan.joint.to];
    if (fromId && toId) {
      M.updateEntity(fromId, {
        joints: [{
          type: 'prismatic', target: toId,
          axis: agentPlan.joint.axis, limits: agentPlan.joint.limits,
          anchor1: agentPlan.joint.anchor1, anchor2: agentPlan.joint.anchor2,
        }],
      }, '建立径向滑槽约束');
    }
  }'''
new = '''  if (agentPlan.joint && (agentPlan.kind === 'rotation' || agentPlan.kind === 'hinge')) {
    const fromId = created[agentPlan.joint.from], toId = created[agentPlan.joint.to];
    if (fromId && toId) {
      const jd = agentPlan.joint.type === 'revolute'
        ? { type: 'revolute', target: toId, axis: agentPlan.joint.axis, anchor1: agentPlan.joint.anchor1, anchor2: agentPlan.joint.anchor2 }
        : { type: 'prismatic', target: toId, axis: agentPlan.joint.axis, limits: agentPlan.joint.limits, anchor1: agentPlan.joint.anchor1, anchor2: agentPlan.joint.anchor2 };
      M.updateEntity(fromId, { joints: [jd] },
        agentPlan.joint.type === 'revolute' ? '建立铰链转轴' : '建立径向滑槽约束');
    }
  }'''
assert old in s, 'apply joint'
s = s.replace(old, new, 1)

old = '''  const isSpring = doc.entities.some((e) => e.type === 'spring');
  const isAtwood = doc.entities.some((e) => e.type === 'pulley');
  if (mode !== 'edit') resetSim();'''
new = '''  const isSpring = doc.entities.some((e) => e.type === 'spring');
  const isAtwood = doc.entities.some((e) => e.type === 'pulley');
  const isHinge = doc.entities.some((e) => e.joints && e.joints.some((j) => j.type === 'revolute'));
  if (mode !== 'edit') resetSim();'''
assert old in s, 'flags'
s = s.replace(old, new, 1)

old = '''  const isMomentum = !hasRamp && !isAstro && !isRotation && !isSpring && !isAtwood;
  const needT = isAstro ? 11 : (isRotation ? 3.5 : 4);'''
new = '''  const isMomentum = !hasRamp && !isAstro && !isRotation && !isSpring && !isAtwood && !isHinge;
  const needT = isHinge ? 5.5 : (isSpring ? 6.5 : (isAstro ? 11 : (isRotation ? 3.5 : 4)));'''
assert old in s, 'needT'
s = s.replace(old, new, 1)

old = '''      const done = isAstro || isRotation
        ? runtime.simT > needT
        : isMomentum'''
new = '''      const done = isAstro || isRotation || isHinge
        ? runtime.simT > needT
        : isMomentum'''
assert old in s, 'done'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('workbench hinge ok')

# ===== runtime: revolute joint =====
p = Path('src/engine/runtime.js')
s = p.read_text(encoding='utf-8')
old = '''        if (e.type === 'spring') jd = RAPIER.JointData.spring(e.params.restLength, e.params.stiffness, e.params.damping || 0, v([0, 0, 0]), v([0, 0, 0]));'''
new = '''        else if (e.type === 'spring') jd = RAPIER.JointData.spring(e.params.restLength, e.params.stiffness, e.params.damping || 0, v([0, 0, 0]), v([0, 0, 0]));
        else if (e.type === 'hinge') {
          // 锚点 = 铰链实体自身位置（世界）→ 各 body 局部（忽略基座/臂旋转，教学简化）
          const w = e.transform.pos;
          const pa = bodyA.body.translation(), pb = bodyB.body.translation();
          const a1 = v([w[0] - pa.x, w[1] - pa.y, w[2] - pa.z]);
          const a2 = v([w[0] - pb.x, w[1] - pb.y, w[2] - pb.z]);
          jd = RAPIER.JointData.revolute(a1, a2, v(e.jointAxis || [0, 0, 1]));
        }'''
assert old in s, 'runtime hinge'
s = s.replace(old, new, 1)

old = '''        let jd = null;
        if (j.type === 'prismatic') {'''
new = '''        let jd = null;
        if (j.type === 'revolute') {
          jd = this.RAPIER.JointData.revolute(v(j.anchor1 || [0, 0, 0]), v(j.anchor2 || [0, 0, 0]), v(j.axis || [0, 0, 1]));
        }
        if (j.type === 'prismatic') {'''
assert old in s, 'runtime joints revolute'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('runtime hinge ok')
PYEOF
