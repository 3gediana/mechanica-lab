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

    renderer.domElement.addEventListener('pointerdown', (e) => { this._downPos = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', (e) => this._onUp(e));
    window.addEventListener('resize', () => this.resize());
  }

  _onUp(e) {
    if (!this._downPos) return;
    const dx = e.clientX - this._downPos[0], dy = e.clientY - this._downPos[1];
    this._downPos = null;
    if (dx * dx + dy * dy > 25) return;          // 拖动视角不视为点选
    if (this.gizmo.dragging) return;
    const hit = this.pick(e.clientX, e.clientY);
    this.cb.onSelect && this.cb.onSelect(hit);
  }

  pick(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = [];
    for (const child of this.scene.children) {
      if (child.userData && child.userData.entityId && child.visible) meshes.push(child);
    }
    const hits = this.raycaster.intersectObjects(meshes, false);
    return hits.length ? hits[0].object.userData.entityId : null;
  }

  // ============ 选择与 gizmo ============
  setSelected(mesh) {
    if (this._highlight) {
      this.scene.remove(this._highlight);
      this._highlight.geometry.dispose();
      this._highlight = null;
    }
    if (mesh) {
      this._highlight = new THREE.BoxHelper(mesh, ACCENT);
      this._highlight.material.transparent = true;
      this._highlight.material.opacity = 0.9;
      this.scene.add(this._highlight);
      if (this.gizmoMode && this.gizmoEnabled !== false) {
        this.gizmo.attach(mesh);
        this.gizmo.enabled = true;
      } else {
        this.gizmo.detach();
        this.gizmo.enabled = false;
      }
    } else {
      this.gizmo.detach();
      this.gizmo.enabled = false;
    }
    this.selectedMesh = mesh || null;
  }

  refreshHighlight() {
    if (this._highlight && this.selectedMesh) this._highlight.update();
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
