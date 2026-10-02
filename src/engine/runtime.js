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
    this.simT = 0;
    this.acc = 0;
    this.dropped = 0;
    this.collisions.length = 0;
  }

  clear() {
    if (this.world) this.world.free();
    this.world = null;
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
    if (e.physics.body !== 'none') {
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

  // ============ 步进 ============
  stepOnce() {
    if (!this.world) return;
    this.world.step();
    this._drainCollisions();
    this._syncMeshes();
    this.simT += FIXED_H;
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

  // ============ 遥测（检查器实时区 / 底栏 / 未来 Agent 解释用） ============
  telemetry(id) {
    const b = this.binds.get(id);
    if (!b || !b.body) return null;
    const p = b.body.translation(), v = b.body.linvel(), w = b.body.angvel();
    const m = b.body.mass();
    const speed = Math.hypot(v.x, v.y, v.z);
    return {
      pos: [p.x, p.y, p.z], vel: [v.x, v.y, v.z], angvel: [w.x, w.y, w.z],
      speed, mass: m,
      momentum: m * speed,
      keTrans: 0.5 * m * speed * speed,
      height: p.y,
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
