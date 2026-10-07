// runtime.js — 物理运行时：场景文档 → three 网格 + Rapier 刚体/碰撞体
// 全量重建语义：任何文档变更（编辑态）都 rebuild，杜绝增量同步bug；场景规模小，重建毫秒级。
// 步进：固定步长 1/120s + 每帧步数上限，超限丢弃积压（防掉帧后追赶螺旋、防物理死循环）。
import * as THREE from 'three';
import { TRACK_POINTS, TRACK_META } from '../track-curve.js';

export const FIXED_H = 1 / 120;
const MAX_STEPS_PER_FRAME = 8;
// 抓取伺服参数（层 2，PL-10）：β=每步收敛 25% 位置误差（跟手无超调）；
// F_MAX=单步速度增量上限的力换算（Δv≤F·h/m）——重物加速慢、悬吊超重下垂，即"沉感"。
const GRAB_BETA = 0.25;
const GRAB_F_MAX = 120;
// 滑槽约束临时向量（模块级复用，避免 120Hz 下 GC 抖动）
const _sq = new THREE.Quaternion(), _sqInv = new THREE.Quaternion();
const _sv = new THREE.Vector3(), _sw = new THREE.Vector3(), _ax = new THREE.Vector3();
const _vt = new THREE.Vector3(), _vs = new THREE.Vector3();
const _n1 = new THREE.Vector3(), _n2 = new THREE.Vector3();
// 受力差分基准（PER-3/52：120Hz 下每步新分配 Map+数组是 GC 大头，模块级复用原地写入）
const _prevVel = new Map();

export class Runtime {
  constructor(RAPIER, materials, scene) {
    this.RAPIER = RAPIER;
    this.M = materials;
    this.scene = scene;
    this.world = null;
    this.binds = new Map();      // id -> {entity, mesh, body, collider|null, geometry}
    this.simT = 0;
    this.acc = 0;
    this.dropped = 0;            // 因背压丢弃的模拟秒数（诊断）
    this.collisions = [];        // [{t, a, b}] 碰撞事件（动量等场景用），上限 200
    this.collisionReports = [];  // [{t, pBefore, pAfter, keBefore, keAfter}] 碰撞步前后系统守恒量快照，上限 50
    this.impactSounds = [];      // [{t, j, a, b, pos}] 撞击冲量缓冲（声音/juice 消费，帧级 drain），上限 160
    this.jointFailures = [];     // 约束创建失败记录（UI/Agent 可见）
    this.recording = null;       // 轨迹采样 {id, points:[{t,pos,speed,vel}], every, n}（解释器用，单实体）
    this.trailsOn = false;
    this.trails = new Map();
    this.contactForces = new Map();   // id -> [fx,fy,fz] 接触合力（速度差分反推，受力箭头用）
    this.contactNormals = new Map();  // id -> [nx,ny,nz] 世界系接触法向（Rapier 接触对，通用受力分解用）
    this.wantContactNormals = false;  // 分解模式开启时才收集（省 120Hz 下的遍历开销）
    this.accels = new Map();          // id -> [ax,ay,az] 加速度（差分）
    this.frames = [];                 // 录制帧 [{t, states:[[id,px,py,pz,qx,qy,qz,w],...]}]
    this.recFrames = false;     // 轨迹线数据 id -> [[x,y,z], ...]（叠加层用，多实体，每 2 步一点）
    this._grav = [];             // 天体（velocity-Verlet 自积分，不建 Rapier 刚体）
    this._gravMap = new Map();   // id -> 天体状态（telemetry/trails 用）
    this.epoch = 0;              // rebuild 代数（守恒量基准重取依据）
    this._spinSlots = [];        // spinLock 转台的 PBD 径向滑槽（_createJoints 收集）
    this.sensorReadings = new Map();  // 传感器读数（id → {speed/crossedT,...}），运行态数据不进文档
    this._colOwner = new Map();       // collider.handle → 实体 id（碰撞事件 O(1) 归属，PER-4）
    this._bindDocs = null;
    this._grab = null;                // 抓取态 {id, body, target:[x,y,z]}（层 2 运行中交互）
    this.pinned = new Set();          // 运行态图钉（body 固定，重置即消）
    this._gravBufs = [[], []];        // 天体加速度乒乓缓冲（PL-57，见 _gravAccel）
    this._gravBufIdx = 0;
  }

  get doc() { return this._bindDocs; }

  rebuild(doc) {
    this.clear();
    this._bindDocs = doc;
    this._colOwner.clear();
    _prevVel.clear();
    this.world = new this.RAPIER.World({ x: 0, y: doc.gravity, z: 0 });
    this.world.timestep = FIXED_H;
    this.world.numSolverIterations = 8;
    this.eventQueue = new this.RAPIER.EventQueue(true);
    for (const e of doc.entities) if (!this._reg.getComponent(e.type).isLink) this._createEntity(e);
    for (const e of doc.entities) if (this._reg.getComponent(e.type).isLink) this._createEntity(e);
    this._createJoints(doc);
    this._collectGravitating();
    this._collectTrackBalls(doc);
    this._collectPulleyPairs(doc);
    this.epoch++;
    this.simT = 0;    this.acc = 0;
    this.dropped = 0;
    this.collisions.length = 0;
    this.collisionReports.length = 0;
    this.impactSounds.length = 0;
    this.jointFailures.length = 0;
    this.trails.clear();
    this.contactForces.clear();
    this.accels.clear();
    this.sensorReadings.clear();
  }

  clear() {
    if (this.world) this.world.free();
    this.world = null;
    this.recording = null;
    for (const b of this.binds.values()) {
      this.scene.remove(b.mesh);
      b.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.binds.clear();
  }

  _createEntity(e) {
    const RAPIER = this.RAPIER;
    const c = this._reg.getComponent(e.type);
    const geometry = c.buildGeometry(e.params);
    const material = this.M[e.render.material] || this.M.marble;
    const mesh = c.makeMesh ? c.makeMesh(e.params, material) : new THREE.Mesh(geometry, material);
    mesh.position.fromArray(e.transform.pos);
    mesh.rotation.set(...e.transform.rot);
    if (e.transform.scale) mesh.scale.fromArray(e.transform.scale);
    // 默认只接收阴影：投影子在确认实体带碰撞体后开启（传感器/标记/连接类免阴影 pass，PER-11）
    mesh.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    mesh.visible = e.visible !== false;
    mesh.userData.entityId = e.id;
    mesh.userData.locked = e.locked === true;
    this.scene.add(mesh);

    const bind = { entity: e, mesh, body: null, collider: null, geometry };
    // 连接类（绳/弹簧）：attach 两个实体，建 rope/spring 关节；网格由 _syncLinks 每帧拉伸
    if (c.isLink && Array.isArray(e.attach) && e.attach.length === 2) {
      const bodyA = this.binds.get(e.attach[0]), bodyB = this.binds.get(e.attach[1]);
      if (bodyA && bodyA.body && bodyB && bodyB.body) {
        const v = (a) => new RAPIER.Vector3(a[0], a[1], a[2]);
        let jd = null;
        if (e.type === 'rope') jd = RAPIER.JointData.rope(e.params.length, v([0, 0, 0]), v([0, 0, 0]));
        else if (e.type === 'spring') jd = RAPIER.JointData.spring(e.params.restLength, e.params.stiffness, e.params.damping || 0, v([0, 0, 0]), v([0, 0, 0]));
        else if (e.type === 'hinge') {
          // 锚点 = 铰链实体自身位置（世界）→ 各 body 局部（忽略基座/臂的旋转，教学简化）
          const w = e.transform.pos;
          const pa = bodyA.body.translation(), pb = bodyB.body.translation();
          const a1 = v([w.x - pa.x, w.y - pa.y, w.z - pa.z]);
          const a2 = v([w.x - pb.x, w.y - pb.y, w.z - pb.z]);
          const ax = e.jointAxis || [0, 0, 1];
          jd = RAPIER.JointData.revolute(a1, a2, v(ax));
        }
        if (jd) this.world.createImpulseJoint(jd, bodyA.body, bodyB.body, true);
      }
      bind.isLink = true;
      bind.linkStatic = c.linkStatic === true;
      this.binds.set(e.id, bind);
      return;
    }
    // gravitating 天体走自写 velocity-Verlet n 体积分（辛积分器，能量长期有界），不建 Rapier 刚体：
    // 天体间纯引力作用，无需碰撞体；渲染网格仍归 three（物理与视觉分离）。
    if (e.physics.body !== 'none' && !e.physics.gravitating) {
      const desc = e.physics.body === 'fixed'
        ? RAPIER.RigidBodyDesc.fixed()
        : RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true);
      // 出生动效（AG-V2）：无初速动态体从文档位姿上方 4cm 落下——落+微弹+入稳，
      // 不许开局即稳态。教学精度安全：explainIncline/projectile 的理论以 series[0]
      // 实际出生高度为基准，这 4cm 被理论自动吸收（errPct 不受污染）。
      // 豁免：带初速（轨迹题）、天体（自积分）、转台 spinLock（悬空盘不落）、
      // gravityScale=0（理想化悬空场景——两球平面错位会让接触事件早于解析步，
      // 碰撞报告抓到速度未变的幽灵事件，p26 实测）、onPulley、spawnDrop:false。
      const spawnDrop = e.physics.body === 'dynamic' && !e.physics.spinLock && !e.physics.onPulley
        && e.physics.spawnDrop !== false
        && e.physics.gravityScale !== 0
        && e.physics.linvel.every((x) => Math.abs(x) < 1e-9) ? 0.04 : 0;
      desc.setTranslation(e.transform.pos[0], e.transform.pos[1] + spawnDrop, e.transform.pos[2]).setRotation(quatFromEuler(RAPIER, e.transform.rot));
      const body = this.world.createRigidBody(desc);
      if (e.physics.body === 'dynamic') {
        body.setLinvel({ x: e.physics.linvel[0], y: e.physics.linvel[1], z: e.physics.linvel[2] }, true);
        body.setAngvel({ x: e.physics.angvel[0], y: e.physics.angvel[1], z: e.physics.angvel[2] }, true);
        body.setLinearDamping(e.physics.linDamping);
        body.setAngularDamping(e.physics.angDamping);
        body.setGravityScale(e.physics.gravityScale, true);
        // 理想轴承：薄盘转台在滑块载荷下会绕水平轴摇摆（真实但非题设），锁成只绕 Y 转+平动锁死
        if (e.physics.spinLock) {
          body.setEnabledTranslations(false, false, false, true);
          body.setEnabledRotations(false, true, false, true);
        }
      }
      const colDesc = c.buildCollider(RAPIER, e.params);
      if (colDesc) {                                 // track 等解析约束组件无碰撞体
        colDesc.setFriction(e.physics.friction).setRestitution(e.physics.restitution)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        if (e.physics.body === 'dynamic' && e.physics.mass > 0) colDesc.setMass(e.physics.mass);
        bind.collider = this.world.createCollider(colDesc, body);
      }
      if (e.params.noCollide && bind.collider) {
        // noCollide：保留质量/惯性（joint 求解需要），但不与任何东西碰撞
        bind.collider.setCollisionGroups((0x0002 << 16) | 0);
      }
      if (bind.collider) {
        mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        this._colOwner.set(bind.collider.handle, e.id);
      }
      bind.body = body;
    }
    this.binds.set(e.id, bind);
  }

  // ============ 约束（entity.joints，场景文档可序列化） ============
  _createJoints(doc) {
    this._spinSlots.length = 0;
    const vec = (a) => new this.RAPIER.Vector3(a[0], a[1], a[2]);
    for (const e of doc.entities) {
      for (const j of (e.joints || [])) {
        const bindA = this.binds.get(e.id), bindB = this.binds.get(j.target);
        if (!bindA || !bindA.body || !bindB || !bindB.body) continue;
        // 转台径向滑槽（spinLock）：Rapier 旋转 prismatic 在质量可比时限位泄漏，改走守恒律驱动
        if (j.type === 'prismatic' && e.physics.spinLock) {
          // 捕获初始对轴角动量 L0 = I_t·ω0 + m·(ρ×v)_y（与 rotationInfo 同口径）
          const tp = bindA.body.translation(), sp = bindB.body.translation();
          const sv0 = bindB.body.linvel(), tw0 = bindA.body.angvel();
          const compT = this._reg.getComponent(e.type);
          const compS = this._reg.getComponent(bindB.entity.type);
          const It0 = compT && compT.inertiaY ? compT.inertiaY(e.params, e.physics.mass) : 0;
          const Is0 = compS && compS.inertiaY ? compS.inertiaY(bindB.entity.params, bindB.entity.physics.mass) : 0;
          const rx = sp.x - tp.x, rz = sp.z - tp.z;
          const L0 = It0 * tw0.y
            + bindB.entity.physics.mass * (rz * sv0.x - rx * sv0.z)
            + Is0 * bindB.body.angvel().y;
          this._spinSlots.push({
            tableId: e.id, sliderId: j.target,
            limits: j.limits || [0.15, 1.05], anchor1: j.anchor1 || [0, 0.14, 0],
            L0,
          });
          continue;
        }
        try {
          let jd = null;
          if (j.type === 'prismatic') {
            jd = this.RAPIER.JointData.prismatic(vec(j.anchor1), vec(j.anchor2), vec(j.axis));
            if (j.limits) {                       // 高层通道：intoRaw 读 limitsEnabled/limits
              jd.limitsEnabled = true;
              jd.limits = j.limits;
            }
          } else if (j.type === 'revolute') {
            jd = this.RAPIER.JointData.revolute(vec(j.anchor1 || [0, 0, 0]), vec(j.anchor2 || [0, 0, 0]), vec(j.axis || [0, 0, 1]));
          }
          if (jd) this.world.createImpulseJoint(jd, bindA.body, bindB.body, true);
        } catch (err) {
          // 单个约束失败不炸 rebuild，但必须可见
          console.warn('[runtime] joint 创建失败:', j.type, err && err.message);
          this.jointFailures.push({ type: j.type, target: j.target, error: String(err && err.message) });
        }
      }
    }
  }

  // ============ 阿特伍德约束（pulley + onPulley 球对：绳长守恒 + 竖直导轨理想化） ============
  _collectPulleyPairs(doc) {
    this._pulleyPairs = [];
    const pulleys = doc.entities.filter((e) => e.type === 'pulley');
    if (!pulleys.length) return;
    for (const pl of pulleys) {
      const balls = doc.entities.filter((e) => e.physics.onPulley === pl.id && e.physics.body === 'dynamic');
      if (balls.length !== 2) continue;
      const states = balls.map((e) => {
        const b = this.binds.get(e.id);
        return { id: e.id, body: b.body, mesh: b.mesh, m: e.physics.mass || 1, home: [...e.transform.pos], y0: e.transform.pos[1] };
      });
      // 绳长常数 C = y_left + y_right（初始竖直坐标和，两侧绳段等高布置）
      states.sort((a, b) => a.home[0] - b.home[0]);          // 左侧在前
      this._pulleyPairs.push({ C: states[0].y0 + states[1].y0, balls: states });
    }
  }

  _constrainAtwood() {
    for (const pair of this._pulleyPairs) {
      const [a, b] = pair.balls;
      const pa = a.body.translation(), pb = b.body.translation();
      const va = a.body.linvel(), vb = b.body.linvel();
      // 位置投影：y1 + y2 = C，修正量按质量反比分配（轻侧多动 = 张力动力学正确）；
      // 速度 = 重力积分速度 + 位置修正/h（PBD 一致性：投影隐含的冲量进入速度，重力不被吞）
      const viol = pa.y + pb.y - pair.C;
      const wA = b.m / (a.m + b.m), wB = a.m / (a.m + b.m);
      const yA = pa.y - viol * wA, yB = pb.y - viol * wB;
      a.body.setTranslation({ x: a.home[0], y: yA, z: a.home[2] }, true);
      b.body.setTranslation({ x: b.home[0], y: yB, z: b.home[2] }, true);
      a.body.setLinvel({ x: 0, y: va.y + (yA - pa.y) / FIXED_H, z: 0 }, true);
      b.body.setLinvel({ x: 0, y: vb.y + (yB - pb.y) / FIXED_H, z: 0 }, true);
    }
  }

  // ============ 管道轨道约束（track 组件 + onTrack 球，光滑管道语义） ============
  _collectTrackBalls(doc) {
    this._trackBalls = [];
    this._pulleyPairs = [];
    const hasTrack = doc.entities.some((e) => e.type === 'track');
    if (!hasTrack) return;
    for (const b of this.binds.values()) {
      if (!b.body || !b.entity.physics.onTrack) continue;
      const t = b.entity.transform.pos;
      let bi = 0, bd = Infinity;
      for (let i = 0; i < TRACK_POINTS.length; i++) {
        const d = (TRACK_POINTS[i][0] - t[0]) ** 2 + (TRACK_POINTS[i][1] - t[1]) ** 2 + (TRACK_POINTS[i][2] - t[2]) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
      this._trackBalls.push({ id: b.entity.id, body: b.body, closest: bi, ballR: b.entity.params.radius ?? 0.09 });
    }
  }

  _constrainToPipe(tb) {
    const q = tb.body.translation();
    // 最近"线段"投影（顶点投影会把坡向分量混入径向形成锯齿卡球——legacy 已验证的结论）
    let bi = tb.closest, bd = Infinity, bp = TRACK_POINTS[tb.closest];
    const i0 = Math.max(0, tb.closest - 8), i1 = Math.min(TRACK_POINTS.length - 2, tb.closest + 40);
    for (let i = i0; i <= i1; i++) {
      const a = TRACK_POINTS[i], b = TRACK_POINTS[i + 1];
      const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
      const apx = q.x - a[0], apy = q.y - a[1], apz = q.z - a[2];
      const len2 = abx * abx + aby * aby + abz * abz;
      let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
      t = Math.min(Math.max(t, 0), 1);
      const px = a[0] + abx * t, py = a[1] + aby * t, pz = a[2] + abz * t;
      const d = (q.x - px) ** 2 + (q.y - py) ** 2 + (q.z - pz) ** 2;
      if (d < bd) { bd = d; bi = i; bp = { x: px, y: py, z: pz }; }
    }
    tb.closest = bi;
    const rx = q.x - bp.x, ry = q.y - bp.y, rz = q.z - bp.z;
    const r = Math.hypot(rx, ry, rz);
    if (r > 0.30) return;                                          // 离管太远（被抛出），不约束
    const LIMIT = TRACK_META.tubeRadius - tb.ballR;
    if (r <= LIMIT) return;
    const nx = rx / r, ny = ry / r, nz = rz / r;
    tb.body.setTranslation({ x: bp.x + nx * LIMIT, y: bp.y + ny * LIMIT, z: bp.z + nz * LIMIT }, true);
    const v = tb.body.linvel();
    const vn = v.x * nx + v.y * ny + v.z * nz;
    if (vn > 0) tb.body.setLinvel({ x: v.x - vn * nx, y: v.y - vn * ny, z: v.z - vn * nz }, true);
  }

  // ============ 转台径向滑槽（spinLock：理想轴承 + 守恒律驱动） ============
  // Rapier 旋转 prismatic 在转台/滑块质量可比时限位泄漏（两约束求解器内打架），
  // 故与 n 体自积分/阿特伍德 PBD 同哲学：直接实现教学理想定律——
  // 对轴无外力矩 → ω = L0/(I_t + m·s²) 驱动转台；滑块位置/速度共转由运动学投影保证；
  // 径向自由（离心项经旋转框架重提取隐式涌现，一阶精确）；限位=非弹性止挡。
  // 角动量与能量守恒到机器精度（Lz = (I_t+m·s²)·ω = L0 恒等式）。
  _constrainSpinSlots() {
    for (const slot of this._spinSlots) {
      const T = this.binds.get(slot.tableId), S = this.binds.get(slot.sliderId);
      if (!T || !S || !T.body || !S.body) continue;
      const tb = T.body, sb = S.body;
      const q = tb.rotation();
      _sq.set(q.x, q.y, q.z, q.w);
      _sqInv.copy(_sq).invert();
      const tPos = tb.translation(), sPos = sb.translation();
      // 滑块转台局部系：x=径向 s（自由域+限位），y/z=槽线固定
      _sv.set(sPos.x - tPos.x, sPos.y - tPos.y, sPos.z - tPos.z).applyQuaternion(_sqInv);
      const sRaw = _sv.x;
      const s = Math.min(Math.max(sRaw, slot.limits[0]), slot.limits[1]);
      // 守恒律：ω = L0/(I_t + m·s²)（钳位后的 s 参与惯量，静止在止位的滑块照常共转）
      const ms = sb.mass();
      const comp = this._reg.getComponent(T.entity.type);
      const It = comp && comp.inertiaY ? comp.inertiaY(T.entity.params, T.entity.physics.mass) : 0;
      const omega = slot.L0 / (It + ms * s * s);
      tb.setAngvel({ x: 0, y: omega, z: 0 }, true);
      // 位置投影：滑块钳到槽线（限位 + 横向/竖直漂移一并清零）
      _sw.set(s, slot.anchor1[1], slot.anchor1[2]).applyQuaternion(_sq);
      sb.setTranslation({ x: tPos.x + _sw.x, y: tPos.y + _sw.y, z: tPos.z + _sw.z }, true);
      // 速度：v = ω×ρ + vr·axis；vr 对新框架重提取 → 离心漂移隐式涌现
      _vt.set(omega * _sw.z, 0, -omega * _sw.x);          // ω×ρ，ω=(0,ω,0)，转台平动锁死
      const sv = sb.linvel();
      _ax.set(1, 0, 0).applyQuaternion(_sq);
      let vr = (sv.x - _vt.x) * _ax.x + (sv.y - _vt.y) * _ax.y + (sv.z - _vt.z) * _ax.z;
      if ((sRaw > slot.limits[1] && vr > 0) || (sRaw < slot.limits[0] && vr < 0)) {
        vr = 0;                                            // 止位：出界径向速度清零（非弹性）
      }
      _vs.set(_vt.x + vr * _ax.x, _vt.y + vr * _ax.y, _vt.z + vr * _ax.z);
      sb.setLinvel({ x: _vs.x, y: _vs.y, z: _vs.z }, true);
    }
  }

  // ============ 天体 n 体引力（velocity-Verlet，自写积分器） ============
  _collectGravitating() {
    this._grav = [];
    this._gravMap.clear();
    const G = this._bindDocs ? this._bindDocs.G : null;
    if (!G) return;
    for (const b of this.binds.values()) {
      const e = b.entity;
      if (e.physics.body !== 'dynamic' || !e.physics.gravitating) continue;
      const g = {
        id: e.id, mesh: b.mesh,
        m: e.physics.mass || 1,
        pos: [...e.transform.pos],
        vel: [...(e.physics.linvel || [0, 0, 0])],
        acc: null,
      };
      this._grav.push(g);
      this._gravMap.set(e.id, g);
    }
  }

  // PL-57 零分配：加速度写进乒乓预分配缓冲（_gravStep 里 g.acc 持有上一轮返回值，
  // 单缓冲会在「vel += ½(acc+na)h」读到被清零的自身——必须双缓冲交替）。
  // 天体 4 子步 × 120Hz = 每秒 480 次调用，原先每次 gs.map(() => [0,0,0]) 是 GC 大头。
  _gravAccel() {
    const G = this._bindDocs.G;
    const gs = this._grav;
    this._gravBufIdx = 1 - (this._gravBufIdx || 0);
    const acc = this._gravBufs[this._gravBufIdx];
    if (acc.length !== gs.length) {
      acc.length = gs.length;
      for (let i = 0; i < gs.length; i++) acc[i] = [0, 0, 0];
    }
    for (let i = 0; i < gs.length; i++) { const a = acc[i]; a[0] = 0; a[1] = 0; a[2] = 0; }
    for (let i = 0; i < gs.length; i++) {
      for (let j = i + 1; j < gs.length; j++) {
        const dx = gs[j].pos[0] - gs[i].pos[0];
        const dy = gs[j].pos[1] - gs[i].pos[1];
        const dz = gs[j].pos[2] - gs[i].pos[2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < 1e-9) continue;
        const invR3 = 1 / (r2 * Math.sqrt(r2));
        const s = G * invR3;
        acc[i][0] += s * gs[j].m * dx; acc[i][1] += s * gs[j].m * dy; acc[i][2] += s * gs[j].m * dz;
        acc[j][0] -= s * gs[i].m * dx; acc[j][1] -= s * gs[i].m * dy; acc[j][2] -= s * gs[i].m * dz;
      }
    }
    return acc;
  }

  // 每逻辑步 4 个子步（h=1/480）：velocity-Verlet 二阶辛积分，轨道能量长期有界
  _gravStep(hTotal) {
    const gs = this._grav;
    if (gs.length < 2) return;
    const SUB = 4, h = hTotal / SUB;
    if (gs[0].acc === null) {
      const a0 = this._gravAccel();
      gs.forEach((g, i) => { g.acc = a0[i]; });
    }
    for (let s = 0; s < SUB; s++) {
      for (const g of gs) {
        g.pos[0] += g.vel[0] * h + 0.5 * g.acc[0] * h * h;
        g.pos[1] += g.vel[1] * h + 0.5 * g.acc[1] * h * h;
        g.pos[2] += g.vel[2] * h + 0.5 * g.acc[2] * h * h;
      }
      const na = this._gravAccel();
      for (let i = 0; i < gs.length; i++) {
        gs[i].vel[0] += 0.5 * (gs[i].acc[0] + na[i][0]) * h;
        gs[i].vel[1] += 0.5 * (gs[i].acc[1] + na[i][1]) * h;
        gs[i].vel[2] += 0.5 * (gs[i].acc[2] + na[i][2]) * h;
        gs[i].acc = na[i];
        gs[i].mesh.position.set(...gs[i].pos);
      }
    }
  }

  getGravState() {
    return this._grav.map((g) => ({ id: g.id, m: g.m, pos: [...g.pos], vel: [...g.vel] }));
  }

  // ============ 轨迹采样（叠加层）：所有动态体，每 2 步一点，单线 1800 点上限 ============
  setTrails(on) {
    this.trailsOn = on;
    if (!on) this.trails.clear();
  }

  // ============ 系统守恒量（所有动态体总动量/平动动能） ============
  systemTotals() {
    let px = 0, py = 0, pz = 0, ke = 0;
    for (const b of this.binds.values()) {
      if (!b.body || b.entity.physics.body !== 'dynamic') continue;
      const v = b.body.linvel(), m = b.body.mass();
      px += m * v.x; py += m * v.y; pz += m * v.z;
      ke += 0.5 * m * (v.x * v.x + v.y * v.y + v.z * v.z);
    }
    return { p: [px, py, pz], ke };
  }

  // 系统能量（能量堆叠曲线用）：KE = Σ½mv²；PE = 重力势 Σm·|g|·gs·y（基准 y=0）
  // + 弹性势 Σ½k·(|AB|−L0)²（弹簧 link）；引力势能属天体守恒量条口径
  energyTotals() {
    const gy = this._bindDocs ? this._bindDocs.gravity : -9.81;
    let ke = 0, pe = 0;
    for (const b of this.binds.values()) {
      if (!b.body || b.entity.physics.body !== 'dynamic') continue;
      const v = b.body.linvel(), m = b.body.mass();
      ke += 0.5 * m * (v.x * v.x + v.y * v.y + v.z * v.z);
      // 转动动能 ½Iω²（PHY-1）：滚动/旋转体的动能不再被低估（守恒量条平动口径单独算，互不影响）
      const I = this._reg && this._reg.inertiaYOf ? this._reg.inertiaYOf(b.entity.type, b.entity.params, m) : 0;
      if (I > 0) {
        const w = b.body.angvel();
        ke += 0.5 * I * (w.x * w.x + w.y * w.y + w.z * w.z);
      }
      const gs = b.entity.physics.gravityScale != null ? b.entity.physics.gravityScale : 1;
      pe += m * Math.abs(gy) * gs * b.body.translation().y;
    }
    for (const b of this.binds.values()) {
      const e = b.entity;
      if (e.type !== 'spring' || !Array.isArray(e.attach) || e.attach.length !== 2) continue;
      const ba = this.binds.get(e.attach[0]), bb = this.binds.get(e.attach[1]);
      if (!ba?.mesh || !bb?.mesh) continue;
      const p1 = ba.mesh.position, p2 = bb.mesh.position;
      const len = Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
      const dx = len - (e.params.restLength ?? 0.8);
      pe += 0.5 * (e.params.stiffness ?? 20) * dx * dx;
    }
    return { ke, pe, e: ke + pe };
  }

  // ============ 步进 ============
  stepOnce() {
    if (!this.world) return;
    this._stepGrab();
    const nCol0 = this.collisions.length;
    const pre = this.systemTotals();          // 上一步末速度 = 本次碰撞前状态
    for (const [id, b] of this.binds) {
      if (!b.body || b.entity.physics.body !== 'dynamic') continue;
      const v = b.body.linvel();
      let pv = _prevVel.get(id);
      if (!pv) { pv = [0, 0, 0]; _prevVel.set(id, pv); }
      pv[0] = v.x; pv[1] = v.y; pv[2] = v.z;
    }
    this._gravStep(FIXED_H);                  // 天体（自积分）先行；Rapier 步内不含天体
    this.world.step(this.eventQueue);         // 事件队列必须传入 step 才会被填充
    for (const tb of this._trackBalls) this._constrainToPipe(tb);
    this._constrainAtwood();
    this._constrainSpinSlots();
    this._drainCollisions();
    if (this.collisions.length > nCol0) {
      const post = this.systemTotals();
      const postVels = {};
      for (const [id, b] of this.binds) {
        if (!b.body) continue;
        const v = b.body.linvel();
        postVels[id] = [v.x, v.y, v.z];
      }
      // 分体碰前速度（_prevVel 在本步 step 前刷新——恰好是碰撞前瞬时；AB-13：
      // 解释器理论值改用真实碰前速度，静止释放后才碰的场景不再拿文档初速算出 0/0）
      const preVels = {};
      for (const [id, b] of this.binds) {
        if (!b.body) continue;
        const pv = _prevVel.get(id);
        if (pv) preVels[id] = [pv[0], pv[1], pv[2]];
      }
      // 碰撞位置：本次新事件两碰撞体的中点（视口碰撞时刻标记用）
      const lastEvt = this.collisions[this.collisions.length - 1];
      let pos = null;
      const ca = lastEvt.a && this.binds.get(lastEvt.a), cb = lastEvt.b && this.binds.get(lastEvt.b);
      if (ca && ca.mesh && cb && cb.mesh) {
        pos = [(ca.mesh.position.x + cb.mesh.position.x) / 2, (ca.mesh.position.y + cb.mesh.position.y) / 2, (ca.mesh.position.z + cb.mesh.position.z) / 2];
      }
      // 撞击冲量（声音/碰撞 juice 的强度源）：J = Σ m·|Δv|，碰前取 _prevVel（步前刷新=
      // 碰撞前瞬时）、碰后取当前 linvel。冲量口径对理想弹性碰撞照样响（ΔKE 口径会把
      // 无能量损耗的脆响漏成静音）；< 0.04 视为静默微接触不记。
      if (pos && ca && cb) {
        let J = 0;
        const va0 = _prevVel.get(lastEvt.a), vb0 = _prevVel.get(lastEvt.b);
        if (ca.body && va0) { const v = ca.body.linvel(); J += ca.body.mass() * Math.hypot(v.x - va0[0], v.y - va0[1], v.z - va0[2]); }
        if (cb.body && vb0) { const v = cb.body.linvel(); J += cb.body.mass() * Math.hypot(v.x - vb0[0], v.y - vb0[1], v.z - vb0[2]); }
        if (J > 0.04) {
          this.impactSounds.push({ t: this.simT, j: J, a: lastEvt.a, b: lastEvt.b, pos });
          if (this.impactSounds.length > 160) this.impactSounds.shift();
        }
      }
      this.collisionReports.push({ t: this.simT, pBefore: pre.p, keBefore: pre.ke, pAfter: post.p, keAfter: post.ke, postVels, preVels, pos });
      if (this.collisionReports.length > 50) this.collisionReports.shift();
    }
    // 滚动阻力（教学模型）：滚阻矩 τ = μr·N·r 与转动惯量耦合（α = τ/I），
    // N = m·|g|·gs（贴地法向近似，斜面上 cosθ 自动减小）、纯滚动 v=ωr → 线减速 dv = α·r·h。
    // 实心球 I=0.4mr² → a_dec = μr·g/0.4（与 m、r 无关，形状因子决定）；仅对可滚几何生效
    for (const [id, b] of this.binds) {
      if (!b.body || b.entity.physics.body !== 'dynamic') continue;
      const mu = b.entity.params.rollResist;
      if (!mu) continue;
      const c = this._reg.getComponent(b.entity.type);
      if (!c || !c.inertiaY) continue;
      const r = b.entity.params.radius;
      if (!r || r <= 0) continue;
      const v = b.body.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp < 1e-3) continue;
      const m = b.body.mass();
      const gs = b.entity.physics.gravityScale != null ? b.entity.physics.gravityScale : 1;
      const gy = this._bindDocs ? this._bindDocs.gravity : -9.81;
      const I = c.inertiaY(b.entity.params, m);
      if (I <= 0) continue;
      const alpha = (mu * m * Math.abs(gy) * gs * r) / I;   // 角减速 α = μr·N·r / I
      const dv = alpha * r * FIXED_H;                        // 纯滚动线减速
      const k = Math.max(1 - dv / sp, 0);
      b.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
      this._rollLast = { mu, m, gy, gs, r, I, alpha, dv, sp, ts: this.world.timestep, steps: this._stepN || 0, simT: this.simT };
    }
    this._driveConveyors();
    // 接触合力 = m·(a − g·gravityScale)（速度差分反推；阻尼小量忽略，教学近似）
    const gy = this._bindDocs ? this._bindDocs.gravity : -9.81;
    for (const [id, b] of this.binds) {
      if (!b.body || b.entity.physics.body !== 'dynamic') continue;
      const pv = _prevVel.get(id);
      if (!pv) continue;
      const v = b.body.linvel();
      const m = b.body.mass();
      const gs = b.entity.physics.gravityScale != null ? b.entity.physics.gravityScale : 1;
      let av = this.accels.get(id);
      if (!av) { av = [0, 0, 0]; this.accels.set(id, av); }
      av[0] = (v.x - pv[0]) / FIXED_H; av[1] = (v.y - pv[1]) / FIXED_H; av[2] = (v.z - pv[2]) / FIXED_H;
      let cf = this.contactForces.get(id);
      if (!cf) { cf = [0, 0, 0]; this.contactForces.set(id, cf); }
      cf[0] = m * ((v.x - pv[0]) / FIXED_H - 0);
      cf[1] = m * ((v.y - pv[1]) / FIXED_H - gy * gs);
      cf[2] = m * ((v.z - pv[2]) / FIXED_H - 0);
    }
    // 接触法向（通用受力分解）：取第一个接触对的世界法向，定向为「对方表面指向本体」；
    // 对方实体 params.inMeasure === false（「参与测量」关闭）时不作为测量接触面
    this.contactNormals.clear();
    if (this.wantContactNormals) {
      for (const [id, b] of this.binds) {
        if (!b.collider || b.entity.physics.body !== 'dynamic') continue;
        const found = { n: null };
        this.world.contactPairsWith(b.collider, (other) => {
          if (found.n) return;
          const oOwner = other && other.handle != null ? this._idOfCollider(other.handle) : null;
          if (oOwner) {
            const oe = this._bindDocs ? this._bindDocs.entities.find((x) => x.id === oOwner) : null;
            if (oe && oe.params && oe.params.inMeasure === false) return;
          }
          this.world.contactPair(b.collider, other, (mf) => {
            if (mf.numContacts() <= 0 || found.n) return;
            const n = mf.normal();
            const pT = b.body.translation();
            const ob = other.parent();
            const pO = ob ? ob.translation() : other.translation();
            const dx = pT.x - pO.x, dy = pT.y - pO.y, dz = pT.z - pO.z;
            let nx = n.x, ny = n.y, nz = n.z;
            if (nx * dx + ny * dy + nz * dz < 0) { nx = -nx; ny = -ny; nz = -nz; }
            const L = Math.hypot(nx, ny, nz) || 1;
            found.n = [nx / L, ny / L, nz / L];
          });
        });
        if (found.n) this.contactNormals.set(id, found.n);
      }
    }
    this._syncMeshes();
    this.simT += FIXED_H;
    this._stepN = (this._stepN || 0) + 1;
    if (this.trailsOn && this._stepN % 2 === 0) {
      for (const [id, b] of this.binds) {
        if (b.entity.physics.body !== 'dynamic') continue;
        if (b.entity.params && b.entity.params.recordTrail === false) continue;   // per-entity「记录轨迹」关闭
        let arr = this.trails.get(id);
        if (!arr) { arr = []; this.trails.set(id, arr); }
        if (arr.length >= 1800) arr.shift();
        const g = b.body ? null : this._gravMap.get(id);
        const p = b.body ? b.body.translation() : { x: g.pos[0], y: g.pos[1], z: g.pos[2] };
        arr.push([p.x, p.y, p.z]);
      }
    }
    if (this.recording) {
      const r = this.recording;
      if (r.n++ % r.every === 0 && r.points.length < r.cap) {
        const t = this.telemetry(r.id);
        if (t) {
          const bb = this.binds.get(r.id);
          let rotz = 0;
          if (bb && bb.body) {
            const q = bb.body.rotation();
            rotz = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));   // 欧拉 z
          }
          r.points.push({ t: this.simT, pos: t.pos, speed: t.speed, vel: t.vel, rotz });
        }
      }
    }
    if (this.recFrames && this._stepN % 3 === 0) {
      const states = [];
      for (const [id, b] of this.binds) {
        if (!b.body) continue;
        const p = b.body.translation(), q = b.body.rotation();
        states.push([id, p.x, p.y, p.z, q.x, q.y, q.z, q.w]);
      }
      this.frames.push({ t: this.simT, states });
      if (this.frames.length >= 1200) this.recFrames = false;   // ~30s 上限
    }
  }

  // ============ 回放（应用录制帧到网格，演化暂停） ============
  applyFrame(fi) {
    const f = this.frames[fi];
    if (!f) return false;
    for (const s of f.states) {
      const b = this.binds.get(s[0]);
      if (b && b.mesh) {
        b.mesh.position.set(s[1], s[2], s[3]);
        b.mesh.quaternion.set(s[4], s[5], s[6], s[7]);
      }
    }
    this.simT = f.t;
    return true;
  }

  advance(dt, maxSteps = MAX_STEPS_PER_FRAME) {
    this.acc += dt;
    let n = 0;
    while (this.acc >= FIXED_H && n < maxSteps) {
      this.stepOnce();
      this.acc -= FIXED_H;
      n++;
    }
    if (this.acc > FIXED_H * maxSteps) {
      this.dropped += this.acc;
      this.acc = 0;                // 背压：丢弃积压而不是无限追赶
    }
  }

  _drainCollisions() {
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this._idOfCollider(h1), b = this._idOfCollider(h2);
      if (a || b) {
        this.collisions.push({ t: this.simT, a, b });
        if (this.collisions.length > 200) this.collisions.shift();
      }
    });
  }

  _idOfCollider(handle) {
    return this._colOwner.get(handle) ?? null;
  }

  // ============ 传送带驱动（RUN-2）：带对物的切向作用 = 动摩擦 a=μg 朝带速 ============
  // 「轻放上去先滑动后共速」的教科书模型：步内速度增量 dv = sign(带速-vx)·min(|差|, μg·dt)。
  // 带面 Rapier 摩擦已归零（registry Min 合成规则），切向物理完全在此接管——共速后不再受力
  // （静态陈列随带走），只认顶面接触（法向竖直分量占优；侧碰不驱动）。带停纹停。
  _driveConveyors() {
    const gy = this._bindDocs ? this._bindDocs.gravity : -9.81;
    for (const [, belt] of this.binds) {
      const be = belt.entity;
      if (be.type !== 'conveyor' || !belt.collider) continue;
      const vB = be.params.speed || 0;
      const scroll = belt.mesh && belt.mesh.userData && belt.mesh.userData.beltScroll;
      if (scroll && vB) scroll.tex.offset.x -= vB * FIXED_H * scroll.unitPerMeter;
      if (!vB) continue;
      const mu = be.physics.friction ?? 0.2;
      if (mu <= 0) continue;
      this.world.contactPairsWith(belt.collider, (other) => {
        const oid = other && other.handle != null ? this._idOfCollider(other.handle) : null;
        if (!oid) return;
        const ob = this.binds.get(oid);
        if (!ob || !ob.body || ob.entity.physics.body !== 'dynamic') return;
        let up = false;
        this.world.contactPair(belt.collider, other, (mf) => {
          if (mf.numContacts() <= 0 || up) return;
          const n = mf.normal();
          up = Math.abs(n.y) > 0.5;   // 顶面接触（法向竖直占优；法向符号随流翻转不定，取绝对值）
        });
        if (!up) return;
        const v = ob.body.linvel();
        const rel = vB - v.x;
        if (Math.abs(rel) < 1e-6) return;
        const gs = ob.entity.physics.gravityScale != null ? ob.entity.physics.gravityScale : 1;
        const dvMax = mu * Math.abs(gy) * gs * FIXED_H;   // a = μ·N/m = μg·gs
        const dv = Math.sign(rel) * Math.min(Math.abs(rel), dvMax);
        ob.body.setLinvel({ x: v.x + dv, y: v.y, z: v.z }, true);
      });
    }
  }

  // ============ 传感器读数（速度/计时/力）：读数存 runtime 不进文档 ============
  _syncSensors() {
    for (const b of this.binds.values()) {
      const e = b.entity;
      if (e.type !== 'speedSensor' && e.type !== 'timer' && e.type !== 'forceSensor') continue;
      if (!Array.isArray(e.attach) || e.attach.length !== 1) continue;
      const t = this.binds.get(e.attach[0]);
      if (!t || !t.body) continue;
      const v = t.body.linvel();
      const p = t.body.translation();
      let rec = this.sensorReadings.get(e.id);
      if (!rec) { rec = {}; this.sensorReadings.set(e.id, rec); }
      if (e.type === 'speedSensor') {
        rec.speed = Math.hypot(v.x, v.y, v.z);
        rec.vx = v.x; rec.vy = v.y; rec.vz = v.z;
        rec.targetPos = [p.x, p.y, p.z];
        rec.simT = this.simT;
      } else if (e.type === 'forceSensor') {
        // 接触合力取本步受力差分结果（step 内 contactForces 先于 _syncMeshes 更新），
        // 补回被差分误计入的线阻尼力 F_d = −m·d·v（阻尼非接触力）：
        // 静止 v=0 读数不变；自由飞行修正后精确归 0（失重演示）
        const f0 = this.contactForces.get(e.attach[0]);
        if (f0) {
          const m = t.body.mass();
          const d = t.entity.physics.linDamping || 0;
          const f = [f0[0] + m * d * v.x, f0[1] + m * d * v.y, f0[2] + m * d * v.z];
          rec.f = f; rec.fmag = Math.hypot(f[0], f[1], f[2]); rec.fy = f[1];
        }
        rec.simT = this.simT;
      } else {
        // 计时器光门：运行开始后，目标体首次穿过光门所在 x 平面（±0.15 容差）的时刻
        if (rec.crossedT == null && this.simT > 0) {
          const gx = e.transform.pos[0];
          const prevX = rec._prevX;
          if (prevX != null && ((prevX - gx) * (p.x - gx) <= 0 || Math.abs(p.x - gx) < 0.15)) {
            rec.crossedT = this.simT;
          }
          rec._prevX = p.x;
        }
        rec.simT = this.simT;
      }
    }
  }

  _syncLinks() {
    for (const b of this.binds.values()) {
      // 测量尺：两端点间摆放（x 轴向拉伸 + 对齐），纯测量标注不建 joint
      if (b.entity.type === 'ruler' && Array.isArray(b.entity.attach) && b.entity.attach.length === 2 && b.mesh) {
        const a = this.binds.get(b.entity.attach[0]), c = this.binds.get(b.entity.attach[1]);
        if (a && c && a.mesh && c.mesh) {
          const pa = a.mesh.position, pc = c.mesh.position;
          const dir = new THREE.Vector3().subVectors(pc, pa);
          const len = Math.max(dir.length(), 1e-3);
          b.mesh.position.copy(pa).addScaledVector(dir, 0.5);
          b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
          b.mesh.scale.set(len, 1, 1);
        }
        continue;
      }
      if (!b.isLink) continue;
      if (b.linkStatic) {                            // 铰链轴柱：固定在自身位置
        b.mesh.position.fromArray(b.entity.transform.pos);
        continue;
      }
      if (!Array.isArray(b.entity.attach) || b.entity.attach.length !== 2) continue;
      const a = this.binds.get(b.entity.attach[0]), c = this.binds.get(b.entity.attach[1]);
      if (!a || !c) continue;
      const pa = a.mesh.position, pc = c.mesh.position;
      if (b.entity.type === 'rope') { this._syncRope(b, pa, pc); continue; }   // 绳：verlet 垂坠/摆动（AG-V2）
      const dir = new THREE.Vector3().subVectors(pc, pa);
      const len = dir.length();
      if (len < 1e-6) continue;
      b.mesh.position.copy(pa).addScaledVector(dir, 0.5);
      b.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      b.mesh.scale.set(1, len, 1);
    }
  }

  // 绳的呈现层动力学（AG-V2）：8 段 verlet 链——重力下垂（slack 时悬链弧）、出生上踢的
  // 跳动、端点拖动的摆动。只动网格不动关节（rope joint 照旧约束刚体），零物理污染。
  // 张紧时 segRest 取 max(绳长/8, 端距/8)，链自然绷直，与 rope joint 单侧拉紧语义一致。
  _syncRope(b, pa, pc) {
    const N = 8;
    if (!b.linkPts || b.linkPts.length !== N + 1) {
      b.linkPts = [];
      b.linkPrev = [];
      for (let i = 0; i <= N; i++) {
        const p = pa.clone().lerp(pc, i / N);
        b.linkPts.push(p);
        b.linkPrev.push(p.clone());
        // 出生抖动：中段向上小踢 + 横向扰动——绳子落入垂弧时看得见「跳一跳」
        if (i > 0 && i < N) {
          b.linkPrev[i].y += 0.02 + Math.random() * 0.012;
          b.linkPrev[i].x += (Math.random() - 0.5) * 0.014;
        }
      }
    }
    const span = pa.distanceTo(pc);
    const segRest = Math.max(b.entity.params.length / N, span / N, 1e-4);
    const s2 = FIXED_H * FIXED_H;
    for (let i = 1; i < N; i++) {
      const pt = b.linkPts[i], pr = b.linkPrev[i];
      const nx = pt.x + (pt.x - pr.x) * 0.982;
      const ny = pt.y + (pt.y - pr.y) * 0.982 - 9.81 * s2;
      const nz = pt.z + (pt.z - pr.z) * 0.982;
      pr.copy(pt);
      pt.set(nx, ny, nz);
    }
    b.linkPts[0].copy(pa);
    b.linkPts[N].copy(pc);
    const corr = (A, B, movA, movB) => {
      const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const f = (d - segRest) / d;
      if (movA && movB) { A.x += dx * f * 0.5; A.y += dy * f * 0.5; A.z += dz * f * 0.5; B.x -= dx * f * 0.5; B.y -= dy * f * 0.5; B.z -= dz * f * 0.5; }
      else if (movA) { A.x += dx * f; A.y += dy * f; A.z += dz * f; }
      else if (movB) { B.x -= dx * f; B.y -= dy * f; B.z -= dz * f; }
    };
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < N; i++) corr(b.linkPts[i], b.linkPts[i + 1], i !== 0, i + 1 !== N);
    }
    const segs = b.mesh.children;
    const dir = new THREE.Vector3();
    for (let i = 0; i < N && i < segs.length; i++) {
      const A = b.linkPts[i], B2 = b.linkPts[i + 1];
      dir.subVectors(B2, A);
      const len = Math.max(dir.length(), 1e-4);
      segs[i].position.copy(A).addScaledVector(dir, 0.5);
      segs[i].quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.multiplyScalar(1 / len));
      segs[i].scale.set(1, len, 1);
    }
  }

  _syncMeshes() {
    for (const b of this.binds.values()) {
      if (b.isLink) continue;
      if (!b.body || b.entity.physics.body === 'fixed') continue;
      b.mesh.position.copy(b.body.translation());
      b.mesh.quaternion.copy(b.body.rotation());
    }
    this._syncLinks();
    this._syncSensors();
  }

  // ============ 轨迹采样（解释器/未来教学叠加层用） ============
  startRecording(id) {
    this.recording = { id, points: [], every: 2, n: 0, cap: 2400 };   // 60Hz 采样，~80s 上限
  }
  stopRecording() {
    const r = this.recording;
    this.recording = null;
    return r ? r.points : [];
  }

  // ============ 遥测（检查器实时区 / 底栏 / 解释器用）；天体走自积分状态 ============
  telemetry(id) {
    const out = { pos: [0, 0, 0], vel: [0, 0, 0], angvel: [0, 0, 0], speed: 0, mass: 0, momentum: 0, keTrans: 0, height: 0 };
    return this.telemetryInto(id, out) ? out : null;
  }

  // PL-53 零分配遥测：写入调用方复用的 out 对象（叠加层每帧 × 每实体调用，原先每次
  // 新分配 4 数组 + 1 对象是 60Hz 下 GC 稳定来源）。有遥测返回 out，无则 null。
  telemetryInto(id, out) {
    const b = this.binds.get(id);
    if (!b) return null;
    let m;
    if (b.body) {
      const p = b.body.translation(), v = b.body.linvel(), w = b.body.angvel();
      out.pos[0] = p.x; out.pos[1] = p.y; out.pos[2] = p.z;
      out.vel[0] = v.x; out.vel[1] = v.y; out.vel[2] = v.z;
      out.angvel[0] = w.x; out.angvel[1] = w.y; out.angvel[2] = w.z;
      m = b.body.mass();
    } else {
      const g = this._gravMap.get(id);
      if (!g) return null;
      out.pos[0] = g.pos[0]; out.pos[1] = g.pos[1]; out.pos[2] = g.pos[2];
      out.vel[0] = g.vel[0]; out.vel[1] = g.vel[1]; out.vel[2] = g.vel[2];
      out.angvel[0] = 0; out.angvel[1] = 0; out.angvel[2] = 0;
      m = g.m;
    }
    const vx = out.vel[0], vy = out.vel[1], vz = out.vel[2];
    const speed = Math.hypot(vx, vy, vz);
    out.speed = speed;
    out.mass = m;
    out.momentum = m * speed;
    out.keTrans = 0.5 * m * speed * speed;
    out.height = out.pos[1];
    return out;
  }

  // 选中实体最近一次碰撞（t, 对方 id）
  lastCollisionFor(id) {
    for (let i = this.collisions.length - 1; i >= 0; i--) {
      const c = this.collisions[i];
      if (c.a === id || c.b === id) return c;
    }
    return null;
  }

  // ============ 抓取拖拽（层 2，PL-10）：速度伺服——铁律禁 setTranslation 跟手 ============
  // setTranslation 直接搬运会吞掉速度语义（松手直掉、碰撞不交换动量）；伺服只在每步
  // 改写 linvel：位置误差按 β 收敛 + Δv 上限 F·h/m（质量缩力=沉感），松手零操作即继承当前速度。
  grabBody(id) {
    const b = this.binds.get(id);
    if (!b || !b.body || b.entity.physics.body !== 'dynamic') return false;
    const p = b.body.translation();
    this._grab = { id, body: b.body, target: [p.x, p.y, p.z] };
    return true;
  }

  moveGrabTarget(pos) {
    if (this._grab) this._grab.target = [pos[0], pos[1], pos[2]];
  }

  // 松手：vOverride 为指针轨迹推出的投掷速度（null=按住不动，保持当前速度=零操作继承/直掉）
  releaseGrab(vOverride) {
    const g = this._grab;
    if (!g) return null;
    this._grab = null;
    const v = g.body.linvel();
    if (vOverride) g.body.setLinvel({ x: vOverride[0], y: vOverride[1], z: vOverride[2] }, true);
    return [v.x, v.y, v.z];
  }

  grabState() {
    if (!this._grab) return null;
    const v = this._grab.body.linvel();
    const p = this._grab.body.translation();
    return { id: this._grab.id, target: [...this._grab.target], vel: [v.x, v.y, v.z], pos: [p.x, p.y, p.z] };
  }

  _stepGrab() {
    const g = this._grab;
    if (!g) return;
    if (!this.binds.has(g.id)) { this._grab = null; return; }
    const body = g.body;
    const p = body.translation();
    const kv = GRAB_BETA / FIXED_H;
    const wantX = (g.target[0] - p.x) * kv;
    const wantY = (g.target[1] - p.y) * kv;
    const wantZ = (g.target[2] - p.z) * kv;
    const m = body.mass() || 1;
    const dvMax = (GRAB_F_MAX * FIXED_H) / m;   // 沉感：重物每步可获得的 Δv 更小
    const v = body.linvel();
    const clamped = (want, cur) => Math.max(cur - dvMax, Math.min(cur + dvMax, want));
    body.setLinvel({ x: clamped(wantX, v.x), y: clamped(wantY, v.y), z: clamped(wantZ, v.z) }, true);
  }

  // ============ 运行态图钉（PL-12）：dynamic ⇄ fixed 切换，重置（rebuild）即消 ============
  togglePin(id) {
    const b = this.binds.get(id);
    if (!b || !b.body || b.entity.physics.body !== 'dynamic') return false;
    const pin = !this.pinned.has(id);
    if (pin) {
      b.body.setBodyType(this.RAPIER.RigidBodyType.Fixed, true);
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.pinned.add(id);
    } else {
      b.body.setBodyType(this.RAPIER.RigidBodyType.Dynamic, true);
      this.pinned.delete(id);
    }
    return pin;
  }

  pinState() { return [...this.pinned]; }

  // ============ 暂停态 gizmo 摆姿势（PL-14）：直接写物理体，不进文档/undo，重置即消 ============
  setLivePose(id, pos, rotEuler) {
    const b = this.binds.get(id);
    if (!b || !b.body) return false;
    b.body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
    if (rotEuler) b.body.setRotation(quatFromEuler(this.RAPIER, [rotEuler[0], rotEuler[1], rotEuler[2]]), true);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    return true;
  }

  // ============ 运行态删除（PL-12）：只拆运行时，文档不动，重置即回 ============
  // 有 joint/attach 关联的体不允许（impulse joint 悬空会拖垮求解器），轻量拒绝。
  removeLive(id) {
    const b = this.binds.get(id);
    if (!b || !b.entity) return false;
    const e = b.entity;
    const linked = (e.joints && e.joints.length) || (Array.isArray(e.attach) && e.attach.length);
    if (linked || e.physics.gravitating) return false;
    for (const other of this._bindDocs ? this._bindDocs.entities : []) {
      if (other.joints && other.joints.some((j) => j.target === id)) return false;
      if (Array.isArray(other.attach) && other.attach.includes(id)) return false;
    }
    if (this._grab && this._grab.id === id) this._grab = null;
    if (b.body) this.world.removeRigidBody(b.body);
    if (b.mesh) {
      this.scene.remove(b.mesh);
      b.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.binds.delete(id);
    this.trails.delete(id);
    return true;
  }

  // ============ 运行态增量添加（PL-11）：直接建进现有世界，文档不动，重置即消 ============
  addLive(e) {
    if (!this.world) return false;
    const c = this._reg.getComponent(e.type);
    if (!c || c.isLink || c.isSensor || c.isMeasure || c.isViewpoint) return false;
    this._createEntity(e);
    return true;
  }



}

// 注册表通过独立 setter 注入，避免构造参数序依赖
export function attachRegistry(runtime, reg) { runtime._reg = reg; }

function quatFromEuler(RAPIER, rot) {
  const [x, y, z] = rot;
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}
