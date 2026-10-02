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
    this.trailsVisible = false;
    this._trailLines = [];
    this._impacts = [];          // 碰撞时刻标记环（1.5s 淡出）
    this.boxSelectMode = false;
    this._boxSel = null;         // {x0,y0,x1,y1} 屏幕坐标
    this._highlights = [];       // 多选高亮 BoxHelper 池
    this.highlightIds = [];
    this._bindLookup = null;
    this.forcesOn = false;
    this._forceArrows = [];      // 受力箭头池：偶=接触合力(绿) 奇=重力(红)
    this._rubber = document.getElementById('rubber');
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

  // ============ 受力箭头（重力红 + 接触合力绿） ============
  setForceArrows(on) {
    this.forcesOn = on;
    for (const a of this._forceArrows) a.visible = false;
  }

  // items: [{pos, contact:[x,y,z]|null, gravity:[x,y,z]}]  每 tick 驱动
  updateForceArrows(items) {
    if (!this.forcesOn) return;
    const need = items.length * 2;
    while (this._forceArrows.length < need) {
      const isG = this._forceArrows.length % 2 === 1;
      const a = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 0.4, isG ? 0xc96a5a : 0x7dc87d, 0.07, 0.045);
      this.scene.add(a);
      this._forceArrows.push(a);
    }
    let ai = 0;
    for (const it of items) {
      const gLen = Math.hypot(...it.gravity);
      // 重力箭头（恒显）
      const ga = this._forceArrows[ai++];
      ga.visible = true;
      ga.position.set(...it.pos);
      ga.setDirection(new THREE.Vector3(...it.gravity).normalize());
      ga.setLength(Math.min(0.12 + gLen * 0.04, 1.2), 0.07, 0.045);
      // 接触合力箭头（超阈值显示）
      const ca = this._forceArrows[ai++];
      const c = it.contact;
      const cLen = c ? Math.hypot(...c) : 0;
      if (c && cLen > 0.35) {
        ca.visible = true;
        ca.position.set(...it.pos);
        ca.setDirection(new THREE.Vector3(...c).normalize());
        ca.setLength(Math.min(0.12 + cLen * 0.02, 1.6), 0.07, 0.045);
      } else {
        ca.visible = false;
      }
    }
    for (; ai < this._forceArrows.length; ai++) this._forceArrows[ai].visible = false;
  }

  forceArrowStats() {
    return { total: this._forceArrows.length, visible: this._forceArrows.filter((a) => a.visible).length };
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
    controls.maxDistance = 40;
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

    // 工作台网格：1m 主格 + 坐标轴
    const grid = new THREE.GridHelper(20, 20, 0x3c4046, 0x1f2226);
    grid.material.transparent = true;
    grid.material.opacity = 0.85;
    scene.add(grid);
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

  // gizmo 拖动后把 mesh 变换写回（由 workbench 调用，负责文档与历史）
  applyGizmoToEntity(entity) {
    if (!this.selectedMesh || !entity) return;
    entity.transform.pos = this.selectedMesh.position.toArray().map((v) => +v.toFixed(4));
    entity.transform.rot = [
      +this.selectedMesh.rotation.x.toFixed(4),
      +this.selectedMesh.rotation.y.toFixed(4),
      +this.selectedMesh.rotation.z.toFixed(4),
    ];
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  render() {
    this.controls.update();
    this.refreshHighlight();
    this.renderer.render(this.scene, this.camera);
  }
}
