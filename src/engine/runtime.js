// runtime.js — 物理运行时：场景文档 → three 网格 + Rapier 刚体/碰撞体
// 全量重建语义：任何文档变更（编辑态）都 rebuild，杜绝增量同步bug；场景规模小，重建毫秒级。
// 步进：固定步长 1/120s + 每帧步数上限，超限丢弃积压（防掉帧后追赶螺旋、防物理死循环）。
import * as THREE from 'three';

export const FIXED_H = 1 / 120;
const MAX_STEPS_PER_FRAME = 8;

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
    this.recording = null;       // 轨迹采样 {id, points:[{t,pos,speed,vel}], every, n}（解释器用，单实体）
    this.trailsOn = false;
    this.trails = new Map();     // 轨迹线数据 id -> [[x,y,z], ...]（叠加层用，多实体，每 2 步一点）
    this._grav = [];             // 天体（velocity-Verlet 自积分，不建 Rapier 刚体）
    this._gravMap = new Map();   // id -> 天体状态（telemetry/trails 用）
    this.epoch = 0;              // rebuild 代数（守恒量基准重取依据）
    this._bindDocs = null;
  }

  get doc() { return this._bindDocs; }

  rebuild(doc) {
    this.clear();
    this._bindDocs = doc;
    this.world = new this.RAPIER.World({ x: 0, y: doc.gravity, z: 0 });
    this.world.timestep = FIXED_H;
    this.world.numSolverIterations = 8;
    this.eventQueue = new this.RAPIER.EventQueue(true);
    for (const e of doc.entities) this._createEntity(e);
    this._collectGravitating();
    this.epoch++;
    this.simT = 0;    this.acc = 0;
    this.dropped = 0;
    this.collisions.length = 0;
    this.collisionReports.length = 0;
    this.trails.clear();
  }

  clear() {
    if (this.world) this.world.free();
    this.world = null;
    this.recording = null;
    for (const b of this.binds.values()) {
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
    }
    this.binds.clear();
  }

  _createEntity(e) {
    const RAPIER = this.RAPIER;
    const c = this._reg.getComponent(e.type);
    const geometry = c.buildGeometry(e.params);
    const material = this.M[e.render.material] || this.M.marble;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.fromArray(e.transform.pos);
    mesh.rotation.set(...e.transform.rot);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = e.visible !== false;
    mesh.userData.entityId = e.id;
    this.scene.add(mesh);

    const bind = { entity: e, mesh, body: null, collider: null, geometry };
    // gravitating 天体走自写 velocity-Verlet n 体积分（辛积分器，能量长期有界），不建 Rapier 刚体：
    // 天体间纯引力作用，无需碰撞体；渲染网格仍归 three（物理与视觉分离）。
    if (e.physics.body !== 'none' && !e.physics.gravitating) {
      const desc = e.physics.body === 'fixed'
        ? RAPIER.RigidBodyDesc.fixed()
        : RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true);
      desc.setTranslation(...e.transform.pos).setRotation(quatFromEuler(RAPIER, e.transform.rot));
      const body = this.world.createRigidBody(desc);
      if (e.physics.body === 'dynamic') {
        body.setLinvel({ x: e.physics.linvel[0], y: e.physics.linvel[1], z: e.physics.linvel[2] }, true);
        body.setAngvel({ x: e.physics.angvel[0], y: e.physics.angvel[1], z: e.physics.angvel[2] }, true);
        body.setLinearDamping(e.physics.linDamping);
        body.setAngularDamping(e.physics.angDamping);
        body.setGravityScale(e.physics.gravityScale, true);
      }
      let colDesc = c.buildCollider(RAPIER, e.params);
      if (!colDesc) colDesc = RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1); // 退化几何兜底
      colDesc.setFriction(e.physics.friction).setRestitution(e.physics.restitution)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      if (e.physics.body === 'dynamic' && e.physics.mass > 0) colDesc.setMass(e.physics.mass);
      const collider = this.world.createCollider(colDesc, body);
      bind.body = body;
      bind.collider = collider;
    }
    this.binds.set(e.id, bind);
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

  _gravAccel() {
    const G = this._bindDocs.G;
    const gs = this._grav;
    const acc = gs.map(() => [0, 0, 0]);
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

  // ============ 步进 ============
  stepOnce() {
    if (!this.world) return;
    const nCol0 = this.collisions.length;
    const pre = this.systemTotals();          // 上一步末速度 = 本次碰撞前状态
    this._gravStep(FIXED_H);                  // 天体（自积分）先行；Rapier 步内不含天体
    this.world.step(this.eventQueue);         // 事件队列必须传入 step 才会被填充
    this._drainCollisions();
    if (this.collisions.length > nCol0) {
      const post = this.systemTotals();
      this.collisionReports.push({ t: this.simT, pBefore: pre.p, keBefore: pre.ke, pAfter: post.p, keAfter: post.ke });
      if (this.collisionReports.length > 50) this.collisionReports.shift();
    }
    this._syncMeshes();
    this.simT += FIXED_H;
    this._stepN = (this._stepN || 0) + 1;
    if (this.trailsOn && this._stepN % 2 === 0) {
      for (const [id, b] of this.binds) {
        if (b.entity.physics.body !== 'dynamic') continue;
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
        if (t) r.points.push({ t: this.simT, pos: t.pos, speed: t.speed, vel: t.vel });
      }
    }
  }

  advance(dt) {
    this.acc += dt;
    let n = 0;
    while (this.acc >= FIXED_H && n < MAX_STEPS_PER_FRAME) {
      this.stepOnce();
      this.acc -= FIXED_H;
      n++;
    }
    if (this.acc > FIXED_H * MAX_STEPS_PER_FRAME) {
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
    for (const [id, b] of this.binds) {
      if (b.collider && b.collider.handle === handle) return id;
    }
    return null;
  }

  _syncMeshes() {
    for (const b of this.binds.values()) {
      if (!b.body || b.entity.physics.body === 'fixed') continue;
      b.mesh.position.copy(b.body.translation());
      b.mesh.quaternion.copy(b.body.rotation());
    }
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
    const b = this.binds.get(id);
    if (!b) return null;
    let pos, vel, m;
    if (b.body) {
      const p = b.body.translation(), v = b.body.linvel();
      pos = [p.x, p.y, p.z]; vel = [v.x, v.y, v.z]; m = b.body.mass();
    } else {
      const g = this._gravMap.get(id);
      if (!g) return null;
      pos = [...g.pos]; vel = [...g.vel]; m = g.m;
    }
    const speed = Math.hypot(vel[0], vel[1], vel[2]);
    return {
      pos, vel, angvel: [0, 0, 0],
      speed, mass: m,
      momentum: m * speed,
      keTrans: 0.5 * m * speed * speed,
      height: pos[1],
    };
  }

  // 选中实体最近一次碰撞（t, 对方 id）
  lastCollisionFor(id) {
    for (let i = this.collisions.length - 1; i >= 0; i--) {
      const c = this.collisions[i];
      if (c.a === id || c.b === id) return c;
    }
    return null;
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
