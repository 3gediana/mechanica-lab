// viewport.js — 中央 3D 视口：相机/灯光/网格/选择/gizmo/聚焦
// 编辑态职责：点选实体、gizmo 平移旋转、吸附、聚焦；运行态只读观察。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const ACCENT = 0xd9a441;

export class Viewport {
  // cb: {onSelect(id|null), onGizmoCommit(), onEnvReady()}
  constructor(container, cb) {
    this.container = container;
    this.cb = cb;
    this.raycaster = new THREE.Raycaster();
    this._downPos = null;
    this._highlight = null;
    this.gizmoMode = 'translate';
    this.snap = false;
    this.arrowsOn = false;
    this._arrows = [];
    this._normViz = [];
    this.trailsVisible = false;
    this._trailLines = [];
    this._impacts = [];          // 碰撞时刻标记环（1.5s 淡出）
    this.boxSelectMode = false;
    this._boxSel = null;         // {x0,y0,x1,y1} 屏幕坐标
    this._highlights = [];       // 多选高亮 BoxHelper 池
    this.highlightIds = [];
    this._bindLookup = null;
    this.forcesOn = false;
    this.decompose = false;      // 受力分解模式（N/f 分列替代接触合力）
    this._forceArrows = [];      // 受力箭头池：3/实体 = 接触合力(绿)+重力(红)+加速度(青)
    this.tensionsOn = false;     // 绳张力箭头随受力开关
    this._tensionArrows = [];    // 张力箭池：2/绳 = 两端琥珀箭（颜色独立，不与摩擦冲突）
    this.springsOn = false;      // 弹簧胡克力箭头随受力开关
    this._springArrows = [];     // 弹力箭池：2/弹簧 = 两端品红箭（第九章「弹力」独立分列）
    this._jointVizLines = [];    // 约束关系可视化：选中实体的 joint 连线（虚线到 target）
    this._orthoCam = null;
    this.projection = 'persp';
    this._rubber = document.getElementById('rubber');
  }

  // ============ 选中对象定位：相机 target/距离平滑移向实体（第六章「选中对象定位」） ============
  focusOn(mesh) {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.isEmpty() ? 0.6
      : Math.max(box.getSize(new THREE.Vector3()).x, box.getSize(new THREE.Vector3()).y, box.getSize(new THREE.Vector3()).z, 0.4);
    this._focusAnim = { target: mesh.position.clone(), dist: Math.max(size * 3, 1.2) };
  }

  tickFocus() {
    if (!this._focusAnim) return;
    const a = this._focusAnim;
    const t = this.controls.target;
    t.lerp(a.target, 0.18);
    const dir = this.camera.position.clone().sub(t);
    const curLen = dir.length() || 1;
    const newLen = curLen + (a.dist - curLen) * 0.18;
    this.camera.position.copy(t).add(dir.setLength(newLen));
    if (t.distanceTo(a.target) < 0.02 && Math.abs(newLen - a.dist) < 0.05) this._focusAnim = null;
    this.controls.update();
  }

  // ============ 观察点飞行（相机和观察点分类）：平滑移到保存的相机位姿 ============
  flyToPose(pos, target) {
    this._poseAnim = { pos: new THREE.Vector3(...pos), target: new THREE.Vector3(...target) };
  }

  tickPose() {
    if (!this._poseAnim) return;
    const a = this._poseAnim;
    this.controls.target.lerp(a.target, 0.16);
    this.camera.position.lerp(a.pos, 0.16);
    if (this.camera.position.distanceTo(a.pos) < 0.02 && this.controls.target.distanceTo(a.target) < 0.02) {
      this.camera.position.copy(a.pos);
      this.controls.target.copy(a.target);
      this._poseAnim = null;
    }
    this.controls.update();
  }

  // ============ 碰撞时刻标记（关键时刻可视化） ============
  spawnImpact(pos) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.1, 40),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.position.set(pos[0], pos[1] + 0.01, pos[2]);
    ring.rotation.x = -Math.PI / 2;
    ring.userData.spawnT = performance.now();
    this.scene.add(ring);
    this._impacts.push(ring);
  }

  tickImpacts(now) {
    for (let i = this._impacts.length - 1; i >= 0; i--) {
      const m = this._impacts[i];
      const age = (now - m.userData.spawnT) / 1000;
      if (age > 1.5) {
        this.scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
        this._impacts.splice(i, 1);
        continue;
      }
      m.material.opacity = 0.95 * (1 - age / 1.5);
      const s = 1 + age * 3.5;
      m.scale.set(s, s, s);
    }
  }

  impactCount() { return this._impacts.length; }

  // ============ ghost preview（目录 hover：视口中央半透明预览） ============
  setGhostFactory(fn) { this._ghostFactory = fn; }

  // ghost 跟随鼠标：地面投射 + 吸附档位联动（endpoint/surface/center 吸附 + 琥珀标记）
  setGhostFollow(on) {
    this._ghostFollow = on;
    if (!on && this._snapMarker) this._snapMarker.visible = false;
  }

  setGhostSnapMode(mode) {
    this._ghostSnapMode = mode;
    if (!this._snapMarker) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.055, 0.085, 24),
        new THREE.MeshBasicMaterial({ color: 0xd9a441, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      this._snapMarker = m;
    }
  }

  _ghostHalfHeight() {
    if (!this._ghost) return 0.1;
    const box = new THREE.Box3().setFromObject(this._ghost);
    return box.isEmpty() ? 0.1 : Math.max(box.getSize(new THREE.Vector3()).y / 2, 0.02);
  }

  // 在场景实体中找吸附目标（端点=包围盒角点 / 表面=顶面 / 中心=xz 中心）
  _snapCandidate(px, pz, halfH) {
    const mode = this._ghostSnapMode;
    if (!mode || mode === 'off' || mode === 'grid') return null;
    let best = null;
    const consider = (d, x, y, z, kind, cap) => { if (d < cap && (best === null || d < best.d)) best = { d, x, y, z, kind }; };
    for (const o of this.scene.children) {
      if (!o.isMesh && !o.isGroup) continue;
      if (o === this._ghost || o === this._snapMarker) continue;
      if (!o.visible) continue;
      if (o.userData && (o.userData.ghost || o.userData.isHelper)) continue;
      const box = new THREE.Box3().setFromObject(o);
      if (box.isEmpty()) continue;
      const sy = box.max.y - box.min.y;
      if (sy > 12 || sy < 0.01) continue;   // 跳过地面级大平面与异常体
      if (mode === 'endpoint') {
        for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
          consider((px - cx) ** 2 + (pz - cz) ** 2, cx, cy + halfH, cz, 'endpoint', 0.09);
        }
      } else if (mode === 'surface') {
        if (px >= box.min.x - 0.05 && px <= box.max.x + 0.05 && pz >= box.min.z - 0.05 && pz <= box.max.z + 0.05) {
          consider(0.02, px, box.max.y + halfH, pz, 'surface', Infinity);
        }
      } else if (mode === 'center') {
        const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
        consider((px - cx) ** 2 + (pz - cz) ** 2, cx, box.max.y + halfH, cz, 'center', 0.09);
      }
    }
    return best;
  }

  _updateGhostFollow(clientX, clientY) {
    if (!this._ghostFollow || !this._ghost) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const denom = this.raycaster.ray.direction.y;
    const t = denom !== 0 ? -this.raycaster.ray.origin.y / denom : -1;
    if (t <= 0) return;
    const pt = this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, t);
    const halfH = this._ghostHalfHeight();
    const hit = this._snapCandidate(pt.x, pt.z, halfH);
    if (hit) {
      this._ghost.position.set(hit.x, hit.y + 0.01, hit.z);
      if (this._snapMarker) {
        this._snapMarker.visible = true;
        this._snapMarker.position.set(hit.x, hit.y - halfH + 0.012, hit.z);
      }
      this._ghostSnapHit = true;
    } else {
      let gx = pt.x, gz = pt.z;
      if (this._ghostSnapMode === 'grid') { gx = Math.round(gx * 2) / 2; gz = Math.round(gz * 2) / 2; }   // 0.5m 网格吸附
      this._ghost.position.set(gx, this._ghost.position.y, gz);
      if (this._snapMarker) this._snapMarker.visible = false;
      this._ghostSnapHit = false;
    }
  }

  ghostState() {
    return {
      visible: !!this._ghost && this._ghostFollow,
      snapMode: this._ghostSnapMode || 'grid',
      snapped: !!this._ghostSnapHit,
      marker: this._snapMarker ? this._snapMarker.visible : false,
      pos: this._ghost ? this._ghost.position.toArray().map((v) => +v.toFixed(3)) : null,
    };
  }
  showGhost(component) {
    this.hideGhost();
    if (!this._ghostFactory) return;
    const geo = this._ghostFactory(component);
    if (!geo) return;
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9a441, transparent: true, opacity: 0.35, roughness: 0.6 });
    this._ghost = new THREE.Mesh(geo, mat);
    this._ghost.position.set(0, component.spawnY ? component.spawnY(component.defaults.params) + 0.02 : 0.5, 0);
    this.scene.add(this._ghost);
  }
  hideGhost() {
    if (this._ghost) {
      this.scene.remove(this._ghost);
      this._ghost.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this._ghost = null;
    }
  }

  // ============ 受力/加速度箭头 ============
  // 分解模式：支持力(淡绿 N)+摩擦力(橙 f)+重力(红)+加速度(青)；合力模式：接触合力(绿)+重力(红)+加速度(青)
  setForceArrows(on, decompose = this.decompose) {
    this.forcesOn = on;
    this.decompose = decompose;
    for (const a of this._forceArrows) a.visible = false;
  }

  setForceDecompose(on) {
    this.decompose = on;
  }

  // items: [{pos, contact, normal, friction, gravity, accel}]  每 tick 驱动
  updateForceArrows(items) {
    if (!this.forcesOn) return;
    const COLORS = [0x7dc87d, 0xc96a5a, 0x5ac8c8, 0x9fd8a8, 0xd88a5a];
    const PER = this.decompose ? 4 : 3;   // 分解: N/f/重力/加速度；合力: 接触/重力/加速度
    if (this._forcePoolPer !== PER) {
      // 模式切换重建池：箭头按 %PER 分色，跨模式复用会颜色错位
      for (const a of this._forceArrows) this.scene.remove(a);
      this._forceArrows.length = 0;
      this._forcePoolPer = PER;
    }
    const need = items.length * PER;
    while (this._forceArrows.length < need) {
      const kind = this._forceArrows.length % PER;
      const a = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 0.4, COLORS[kind], 0.07, 0.045);
      this.scene.add(a);
      this._forceArrows.push(a);
    }
    let ai = 0;
    for (const it of items) {
      const vecs = this.decompose
        ? [
            { v: it.normal, min: 0.35, scale: 0.02, max: 1.6 },    // 支持力 N（淡绿）
            { v: it.friction, min: 0.15, scale: 0.03, max: 1.2 },  // 摩擦力 f（橙）
            { v: it.gravity, min: 0.01, scale: 0.04, max: 1.2 },   // 重力（红）
            { v: it.accel, min: 0.15, scale: 0.06, max: 1.4 },     // 加速度（青）
          ]
        : [
            { v: it.contact, min: 0.35, scale: 0.02, max: 1.6 },   // 接触合力（绿）
            { v: it.gravity, min: 0.01, scale: 0.04, max: 1.2 },   // 重力（红）
            { v: it.accel, min: 0.15, scale: 0.06, max: 1.4 },     // 加速度（青）
          ];
      for (const vd of vecs) {
        const a = this._forceArrows[ai++];
        const len = vd.v ? Math.hypot(...vd.v) : 0;
        if (vd.v && len > vd.min) {
          a.visible = true;
          a.position.set(...it.pos);
          a.setDirection(new THREE.Vector3(...vd.v).normalize());
          a.setLength(Math.min(0.12 + len * vd.scale, vd.max), 0.07, 0.045);
        } else {
          a.visible = false;
        }
      }
    }
    for (; ai < this._forceArrows.length; ai++) this._forceArrows[ai].visible = false;
  }

  forceArrowStats() {
    return { total: this._forceArrows.length, visible: this._forceArrows.filter((a) => a.visible).length };
  }

  // ============ 弹簧胡克力箭头（专属品红箭池，与张力琥珀区分） ============
  setSpringArrows(on) {
    this.springsOn = on;
    for (const a of this._springArrows) a.visible = false;
  }

  // items: [{aPos, bPos, fA}] fA = A 端弹力向量（拉伸>0 指向 B；B 端取反；F=k·|Δx|，阻尼力不画）
  updateSpringArrows(items) {
    if (!this.springsOn) return;
    const need = items.length * 2;
    while (this._springArrows.length < need) {
      const a = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 0.4, 0xc7559a, 0.08, 0.05);
      this.scene.add(a);
      this._springArrows.push(a);
    }
    let ai = 0;
    for (const it of items) {
      const mag = Math.hypot(it.fA[0], it.fA[1], it.fA[2]);
      const ends = [[it.aPos, it.fA], [it.bPos, [-it.fA[0], -it.fA[1], -it.fA[2]]]];
      for (const [pos, f] of ends) {
        const a = this._springArrows[ai++];
        if (mag > 0.05) {
          a.visible = true;
          a.position.set(...pos);
          a.setDirection(new THREE.Vector3(f[0], f[1], f[2]).normalize());
          a.setLength(Math.min(0.12 + mag * 0.05, 1.4), 0.08, 0.05);
        } else {
          a.visible = false;
        }
      }
    }
    for (; ai < this._springArrows.length; ai++) this._springArrows[ai].visible = false;
  }

  springArrowStats() {
    return { total: this._springArrows.length, visible: this._springArrows.filter((a) => a.visible).length };
  }

  // ============ 约束关系可视化：选中实体的 joint 连线（编辑/运行态都画） ============
  // items: [{from:[x,y,z], to:[x,y,z], ok:true}] —— ok=false 表示 target 缺失（画到自身上方示警）
  updateJointViz(items) {
    const want = items.length;
    while (this._jointVizLines.length < want) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const mat = new THREE.LineDashedMaterial({ color: 0x7ba7d9, dashSize: 0.06, gapSize: 0.04, transparent: true, opacity: 0.85 });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 5;
      this.scene.add(line);
      this._jointVizLines.push(line);
    }
    this._jointVizLines.forEach((line, i) => {
      if (i >= want) { line.visible = false; return; }
      const it = items[i];
      const pts = it.ok
        ? [new THREE.Vector3(...it.from), new THREE.Vector3(...it.to)]
        : [new THREE.Vector3(...it.from), new THREE.Vector3(it.from[0], it.from[1] + 0.5, it.from[2])];
      line.geometry.setFromPoints(pts);
      line.computeLineDistances();
      line.material.color.setHex(it.ok ? 0x7ba7d9 : 0xc96a5a);
      line.visible = true;
    });
  }

  jointVizCount() { return this._jointVizLines.filter((l) => l.visible).length; }

  // ============ 绳张力箭头（专门箭池：琥珀，避免与摩擦力颜色语义冲突） ============
  setTensionArrows(on) {
    this.tensionsOn = on;
    for (const a of this._tensionArrows) a.visible = false;
  }

  // items: [{aPos, bPos, tA, tB}] tA/tB 为两端张力大小（N）
  updateTensionArrows(items) {
    if (!this.tensionsOn) return;
    const need = items.length * 2;
    while (this._tensionArrows.length < need) {
      const a = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 0.4, 0xe0b050, 0.08, 0.05);
      this.scene.add(a);
      this._tensionArrows.push(a);
    }
    let ai = 0;
    for (const it of items) {
      const dir = new THREE.Vector3().subVectors(
        new THREE.Vector3(...it.bPos), new THREE.Vector3(...it.aPos)
      ).normalize();
      for (const [pos, mag, outward] of [[it.aPos, it.tA, -1], [it.bPos, it.tB, 1]]) {
        const a = this._tensionArrows[ai++];
        const len = Math.min(0.15 + mag * 0.05, 1.4);
        a.visible = mag > 0.2;
        a.position.set(pos[0], pos[1], pos[2]);
        a.setDirection(dir.clone().multiplyScalar(outward));
        a.setLength(len, 0.08, 0.05);
      }
    }
    for (; ai < this._tensionArrows.length; ai++) this._tensionArrows[ai].visible = false;
  }

  tensionStats() {
    return { total: this._tensionArrows.length, visible: this._tensionArrows.filter((a) => a.visible).length };
  }

  // ============ 透视 / 正交相机切换 ============
  setProjection(mode) {
    if (mode === this.projection) return;
    if (!this._orthoCam) {
      const ar = this.camera.aspect;
      const h = 6;
      this._orthoCam = new THREE.OrthographicCamera(-h * ar / 2, h * ar / 2, h / 2, -h / 2, 0.01, 300);
    }
    const target = this.controls.target.clone();
    const pos = this.camera.position.clone();
    const o = this._orthoCam;
    o.position.copy(pos);
    o.zoom = 1;
    o.updateProjectionMatrix();
    this.controls.object = o;
    this.gizmo.camera = o;
    this.camera = o;
    this.controls.target.copy(target);
    this.controls.update();
    this.projection = mode;
  }

  setPersp() {
    if (this.projection === 'persp') return;
    const pos = this.camera.position.clone();
    this.controls.object = this._perspCamSaved || this.camera;
    // 恢复透视：_orthoCam 保存了切走前的透视相机
    const persp = this._perspSaved;
    this.controls.object = persp;
    this.gizmo.camera = persp;
    this.camera = persp;
    persp.position.copy(pos);
    this.controls.target.copy(this.controls.target);
    this.controls.update();
    this.projection = 'persp';
  }

  toggleProjection() {
    if (this.projection === 'persp') {
      this._perspSaved = this.camera;
      const pos = this.camera.position.clone();
      if (!this._orthoCam) {
        const ar = this.camera.aspect;
        const h = 6;
        this._orthoCam = new THREE.OrthographicCamera(-h * ar / 2, h * ar / 2, h / 2, -h / 2, 0.01, 300);
      }
      const o = this._orthoCam;
      o.position.copy(pos);
      this.controls.object = o;
      this.gizmo.camera = o;
      this.camera = o;
      this.projection = 'ortho';
    } else {
      const pos = this.camera.position.clone();
      const p = this._perspSaved || this.camera;
      this.controls.object = p;
      this.gizmo.camera = p;
      this.camera = p;
      p.position.copy(pos);
      this.projection = 'persp';
    }
    this.controls.target.copy(this.controls.target);
    this.controls.update();
    return this.projection;
  }

  // ============ 多选高亮（BoxHelper 池，末位为主选中） ============
  setHighlights(ids) {
    for (const h of this._highlights) {
      this.scene.remove(h);
      h.geometry.dispose();
    }
    this._highlights = [];
    let mainMesh = null;
    for (const id of ids) {
      const bind = this._bindLookup && this._bindLookup(id);
      if (!bind || !bind.mesh) continue;
      const h = new THREE.BoxHelper(bind.mesh, id === ids[ids.length - 1] ? ACCENT : 0x82878f);
      h.material.transparent = true;
      h.material.opacity = id === ids[ids.length - 1] ? 0.9 : 0.45;
      this.scene.add(h);
      this._highlights.push(h);
      mainMesh = bind.mesh;
    }
    if (mainMesh && this.gizmoEnabled !== false && this.gizmoMode) {
      this.gizmo.attach(mainMesh);
      this.gizmo.enabled = true;
    } else {
      this.gizmo.detach();
      this.gizmo.enabled = false;
    }
    this.selectedMesh = mainMesh || null;
    this.highlightIds = ids;
  }

  // ============ 轨迹线叠加层 ============
  setTrailsVisible(on) {
    this.trailsVisible = on;
    for (const line of this._trailLines) line.visible = on && line.geometry.drawRange.count >= 4;
  }

  // trails: Map<id, [[x,y,z],...]>（runtime.trails），每实体一条线，颜色按序固定
  updateTrails(trails) {
    if (!this.trailsVisible) return;
    const PALETTE = [0xd9a441, 0x7ba7d9, 0x93c47d, 0xc27ba0, 0xd98a6f];
    let i = 0;
    for (const pts of trails.values()) {
      let line = this._trailLines[i];
      if (!line) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1800 * 3), 3));
        geo.setDrawRange(0, 0);
        const mat = new THREE.LineBasicMaterial({ color: PALETTE[i % PALETTE.length], transparent: true, opacity: 0.75 });
        line = new THREE.Line(geo, mat);
        line.frustumCulled = false;
        line.visible = false;
        this.scene.add(line);
        this._trailLines.push(line);
      }
      const attr = line.geometry.attributes.position;
      const n = Math.min(pts.length, 1800);
      for (let k = 0; k < n; k++) attr.setXYZ(k, pts[k][0], pts[k][1], pts[k][2]);
      attr.needsUpdate = true;
      line.geometry.setDrawRange(0, n);
      line.visible = n >= 2;
      i++;
    }
    for (; i < this._trailLines.length; i++) this._trailLines[i].visible = false;
  }

  trailStats() {
    return this._trailLines.map((l) => l.geometry.drawRange.count).filter((c) => c >= 2).length;
  }

  // ============ 速度向量叠加层（教学观察层） ============
  setVelocityArrows(on) {
    this.arrowsOn = on;
    if (!on) {
      for (const a of this._arrows) { a.visible = false; }
    }
  }

  // items: [{pos:[x,y,z], vel:[vx,vy,vz]}] 每 tick 由 workbench 用最新遥测驱动
  updateVelocityArrows(items) {
    if (!this.arrowsOn) return;
    while (this._arrows.length < items.length) {
      const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, ACCENT, 0.09, 0.055);
      this.scene.add(a);
      this._arrows.push(a);
    }
    this._arrows.forEach((a, i) => {
      if (i >= items.length) { a.visible = false; return; }
      const v = new THREE.Vector3(...items[i].vel);
      const speed = v.length();
      if (speed < 0.01) { a.visible = false; return; }
      a.visible = true;
      a.position.set(...items[i].pos);
      a.setDirection(v.normalize());
      a.setLength(Math.min(0.15 + speed * 0.22, 1.8), 0.09, 0.055);
    });
  }

  arrowStats() {
    return { total: this._arrows.length, visible: this._arrows.filter((a) => a.visible).length };
  }

  // ============ 斜坡法线可视化（Goal 六「是否显示法线」，per-entity） ============
  // items: [{pos:[x,y,z], dir:[nx,ny,nz]}] 每 tick 由 workbench 从 ramp 几何算出
  updateNormalViz(items) {
    if (!items.length) {
      for (const a of this._normViz) a.visible = false;
      return;
    }
    while (this._normViz.length < items.length) {
      const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0x4fc3f7, 0.07, 0.045);
      this.scene.add(a);
      this._normViz.push(a);
    }
    this._normViz.forEach((a, i) => {
      if (i >= items.length) { a.visible = false; return; }
      a.visible = true;
      a.position.set(...items[i].pos);
      a.setDirection(new THREE.Vector3(...items[i].dir).normalize());
      a.setLength(0.55, 0.07, 0.045);
    });
  }

  normalVizCount() {
    return this._normViz.filter((a) => a.visible).length;
  }

  async init() {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0c0e);
    scene.fog = new THREE.Fog(0x0b0c0e, 16, 42);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(42, this.container.clientWidth / this.container.clientHeight, 0.05, 200);
    camera.position.set(3.4, 2.6, 5.2);
    this.camera = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.5, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 0.4;
    controls.maxDistance = 100;   // 大场景（天体系）与 5m 刻度档可达
    controls.maxPolarAngle = 1.54;
    this.controls = controls;

    // 环境：HDRI 失败降级 RoomEnvironment（材质复用 materials.js，光照环境必须先就绪）
    try {
      const tex = await new HDRLoader().loadAsync('./assets/hdri/studio_1k.hdr');
      tex.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = tex;
    } catch (e) {
      console.warn('[viewport] HDRI 缺失，降级 RoomEnvironment', e);
      const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }
    scene.environmentIntensity = 0.55;

    const key = new THREE.DirectionalLight(0xfff1dd, 2.0);
    key.position.set(4.5, 7.5, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -9; key.shadow.camera.right = 9;
    key.shadow.camera.top = 9; key.shadow.camera.bottom = -9;
    key.shadow.camera.near = 1; key.shadow.camera.far = 24;
    key.shadow.bias = -0.0002;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcccdd, 0.5);
    fill.position.set(-5, 3.5, -4);
    scene.add(fill);

    // 影 receiving 地面（透明 ShadowMaterial，不与实体碰撞概念混淆）
    const shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.ShadowMaterial({ opacity: 0.42 })
    );
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.position.y = 0.001;
    shadowFloor.receiveShadow = true;
    scene.add(shadowFloor);

    // 工作台网格：1m 主格 + 坐标轴（刻度间距随相机距离动态重建，见 setGridScale）
    const grid = new THREE.GridHelper(20, 20, 0x3c4046, 0x1f2226);
    grid.material.transparent = true;
    grid.material.opacity = 0.85;
    scene.add(grid);
    this._grid = grid;
    this._gridStep = 1;
    const axisMat = (c) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.6 });
    const xAxis = new THREE.Line(new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(-10, 0.002, 0), new THREE.Vector3(10, 0.002, 0)]), axisMat(0x8a4a42));
    const zAxis = new THREE.Line(new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(0, 0.002, -10), new THREE.Vector3(0, 0.002, 10)]), axisMat(0x42688a));
    scene.add(xAxis, zAxis);

    // gizmo（r186：TransformControls 非 Object3D，挂 getHelper()）
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setMode('translate');
    gizmo.setSize(0.85);
    gizmo.addEventListener('dragging-changed', (ev) => { controls.enabled = !ev.value; });
    gizmo.addEventListener('mouseUp', () => this.cb.onGizmoCommit && this.cb.onGizmoCommit());
    gizmo.enabled = false;
    this.gizmo = gizmo;
    scene.add(gizmo.getHelper());

    renderer.domElement.addEventListener('pointerdown', (e) => {
      this._downPos = [e.clientX, e.clientY];
      if (this.boxSelectMode) {
        this._boxSel = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
        const rb = document.getElementById('rubber');
        rb.style.display = 'block';
        rb.style.left = e.clientX + 'px';
        rb.style.top = e.clientY + 'px';
        rb.style.width = '0px';
        rb.style.height = '0px';
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (this._ghostFollow && this._ghost) this._updateGhostFollow(e.clientX, e.clientY);
      if (this.boxSelectMode && this._boxSel) {
        this._boxSel.x1 = e.clientX;
        this._boxSel.y1 = e.clientY;
        const rb = document.getElementById('rubber');
        rb.style.left = Math.min(this._boxSel.x0, e.clientX) + 'px';
        rb.style.top = Math.min(this._boxSel.y0, e.clientY) + 'px';
        rb.style.width = Math.abs(e.clientX - this._boxSel.x0) + 'px';
        rb.style.height = Math.abs(e.clientY - this._boxSel.y0) + 'px';
      }
    });
    renderer.domElement.addEventListener('pointerup', (e) => this._onUp(e));
    window.addEventListener('resize', () => this.resize());
  }

  _onUp(e) {
    if (!this._downPos) return;
    const dx = e.clientX - this._downPos[0], dy = e.clientY - this._downPos[1];
    this._downPos = null;
    if (this.boxSelectMode && this._boxSel) {
      const sel = this._boxSel;
      this._boxSel = null;
      if (this._rubber) this._rubber.style.display = 'none';
      if (Math.abs(sel.x1 - sel.x0) + Math.abs(sel.y1 - sel.y0) < 6) return;   // 微小拖动=误触，忽略
      const ids = this._idsInScreenRect(sel);
      this.cb.onBoxSelect && this.cb.onBoxSelect(ids);
      return;
    }
    if (dx * dx + dy * dy > 25) return;          // 拖动视角不视为点选
    if (this.gizmo.dragging) return;
    const hit = this.pick(e.clientX, e.clientY);
    this.cb.onSelect && this.cb.onSelect(hit, e.shiftKey === true);
  }

  // 屏幕矩形内（可见、未锁定）的实体 id
  _idsInScreenRect(sel) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const x0 = Math.min(sel.x0, sel.x1), x1 = Math.max(sel.x0, sel.x1);
    const y0 = Math.min(sel.y0, sel.y1), y1 = Math.max(sel.y0, sel.y1);
    const ids = [];
    const v = new THREE.Vector3();
    for (const child of this.scene.children) {
      if (!child.userData || !child.userData.entityId || !child.visible) continue;
      if (child.userData.locked) continue;
      v.copy(child.position).project(this.camera);
      const sx = r.left + ((v.x + 1) / 2) * r.width;
      const sy = r.top + ((1 - v.y) / 2) * r.height;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ids.push(child.userData.entityId);
    }
    return ids;
  }

  setBoxSelect(on) {
    this.boxSelectMode = on;
    this.controls.enableRotate = !on;            // 框选时左键拖拽归选框，不转视角
    this.renderer.domElement.style.cursor = on ? 'crosshair' : '';
    if (this._rubber) this._rubber.style.display = 'none';
  }

  pick(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const roots = [];
    for (const child of this.scene.children) {
      if (child.userData && child.userData.entityId && child.visible) roots.push(child);
    }
    const hits = this.raycaster.intersectObjects(roots, true);   // 递归：Group 子网格（辐条等）也可点选
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && (!o.userData || !o.userData.entityId)) o = o.parent;
    const id = o ? o.userData.entityId : null;
    if (id && o.userData.locked) return null;                    // 锁定实体不可被视口点选
    return id;
  }

  // ============ 选择与 gizmo ============
  // workbench 注入 id→bind 查询（viewport 不持有 runtime 引用）
  setBindLookup(fn) { this._bindLookup = fn; }

  setSelected(mesh) {
    // 兼容旧单选接口：委托 setHighlights（mesh 为空=清空）
    this.setHighlights(mesh ? [mesh.userData.entityId] : []);
  }

  setHighlights(ids) {
    for (const h of this._highlights) {
      this.scene.remove(h);
      h.geometry.dispose();
    }
    this._highlights = [];
    let mainMesh = null;
    for (const id of ids) {
      const bind = this._bindLookup && this._bindLookup(id);
      if (!bind || !bind.mesh) continue;
      const main = id === ids[ids.length - 1];
      const h = new THREE.BoxHelper(bind.mesh, main ? ACCENT : 0x82878f);
      h.material.transparent = true;
      h.material.opacity = main ? 0.9 : 0.45;
      this.scene.add(h);
      this._highlights.push(h);
      mainMesh = bind.mesh;
    }
    if (mainMesh && this.gizmoEnabled !== false && this.gizmoMode) {
      this.gizmo.attach(mainMesh);
      this.gizmo.enabled = true;
    } else {
      this.gizmo.detach();
      this.gizmo.enabled = false;
    }
    this.selectedMesh = mainMesh || null;
    this.highlightIds = ids;
  }

  refreshHighlight() {
    for (const h of this._highlights) h.update();
  }

  setGizmoMode(mode) {
    this.gizmoMode = mode;
    // 缩放模式语义=均匀视觉缩放：r186 的 showX/Y/Z=false 会连中心 XYZ 手柄一起隐藏（按名字
    // 联动过滤，实测抓不到手柄），所以轴向手柄保留、松手提交时在 applyGizmoToEntity 统一
    // 均匀化+钳制——拖拽过程中的瞬时异形是可见预览，落点状态总是合理值。
    if (this.selectedMesh && this.gizmoEnabled !== false) {
      this.gizmo.setMode(mode);
      this.gizmo.attach(this.selectedMesh);
      this.gizmo.enabled = true;
    }
  }

  setGizmoEnabled(on) {
    this.gizmoEnabled = on;
    if (!on || !this.selectedMesh) {
      this.gizmo.detach();
      this.gizmo.enabled = false;
    } else {
      this.gizmo.attach(this.selectedMesh);
      this.gizmo.enabled = true;
    }
  }

  setSnap(on) {
    this.snap = on;
    this.gizmo.setTranslationSnap(on ? 0.1 : null);
    this.gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
  }

  // ============ 单位标尺动态刻度：按档位重建网格（1 格 = step 米，总覆盖 20m 不变） ============
  setGridScale(step) {
    if (this._gridStep === step) return;
    this._gridStep = step;
    if (this._grid) {
      this.scene.remove(this._grid);
      this._grid.geometry.dispose();
      this._grid.material.dispose();
    }
    const divisions = Math.max(4, Math.round(20 / step));
    const grid = new THREE.GridHelper(20, divisions, 0x3c4046, 0x1f2226);
    grid.material.transparent = true;
    grid.material.opacity = 0.85;
    this.scene.add(grid);
    this._grid = grid;
  }

  gridInfo() {
    return { step: this._gridStep || 1, divisions: Math.round(20 / (this._gridStep || 1)) };
  }

  // gizmo 拖动后把 mesh 变换写回（由 workbench 调用，负责文档与历史）
  applyGizmoToEntity(entity) {
    if (!this.selectedMesh || !entity) return;
    entity.transform.pos = this.selectedMesh.position.toArray().map((v) => +v.toFixed(4));
    entity.transform.rot = [
      +this.selectedMesh.rotation.x.toFixed(4),
      +this.selectedMesh.rotation.y.toFixed(4),
      +this.selectedMesh.rotation.z.toFixed(4),
    ];
    // 缩放模式：把视觉缩放写进文档（runtime 重建时会应用），均匀化+钳制到教学合理区间。
    // 语义：只改视觉网格——碰撞体/质量/转动惯量不变（检查器有标注）。
    if (this.gizmoMode === 'scale') {
      const s = this.selectedMesh.scale;
      const avg = (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3 || 1;
      const k = +Math.min(4, Math.max(0.25, avg)).toFixed(3);
      entity.transform.scale = [k, k, k];
      this.selectedMesh.scale.set(k, k, k);
    }
  }

  // ============ 相机 ============
  focus(mesh) {
    if (!mesh) return;
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 0.25);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, Math.max(size * 2.4, 1.0));
    this.controls.update();
  }

  resetView() {
    this.camera.position.set(3.4, 2.6, 5.2);
    this.controls.target.set(0, 0.5, 0);
    this.controls.update();
  }

  setViewPreset(p) {
    const t = this.controls.target;
    const d = this.camera.position.distanceTo(t);
    const dirs = {
      top: [0, 1, 0.0001], front: [0, 0.12, 1], side: [1, 0.12, 0.0001],
    };
    const dir = new THREE.Vector3(...dirs[p]).normalize();
    this.camera.position.copy(t).addScaledVector(dir, d);
    this.controls.update();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (this.camera.isPerspectiveCamera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.setSize(w, h);
  }

  render() {
    this.controls.update();
    this.refreshHighlight();
    this.renderer.render(this.scene, this.camera);
  }
}
