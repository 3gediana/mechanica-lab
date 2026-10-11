// viewport.js — 中央 3D 视口：相机/灯光/网格/选择/gizmo/聚焦
// 编辑态职责：点选实体、gizmo 平移旋转、吸附、聚焦；运行态只读观察。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createEnvironment } from '../materials.js';

const ACCENT = 0xd9a441;

// 叠加层箭头/法线的模块级 scratch（PL-54）：每帧 × 每箭头的 new THREE.Vector3 是
// 稳定 GC 来源；setDirection/normalize 只读传入值，不持有引用，复用安全。
const _sv3 = new THREE.Vector3();
const _sv3b = new THREE.Vector3();
const _zoomN = new THREE.Vector3();   // 平滑缩放光标拉引 scratch
const _zoomV = new THREE.Vector3();

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
    this._arrowSmooth = [];   // FX-517：速度箭头平滑态（方向/长度/速度）
    this._normViz = [];
    this.trailsVisible = false;
    this._trailLines = [];
    this._impacts = [];          // 碰撞时刻标记环（1.5s 淡出）
    this._impactPool = [];       // 环对象池（PL-21：几何共享 + mesh 复用，防碰撞风暴 GC）
    this._impactGeo = null;
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

  // PL-42：平滑缩放收敛（workbench tick 每帧调用；外部改相机位置安全——OrbitControls
  // 每次 update 从 camera.position 重算 offset）
  tickZoom() {
    // FX-534：缩放终点缓出——距目标越近收得越慢(0.12+0.25·近距比),回弹感替代机械匀速
    if (this._zoomTarget == null) return;
    const cam = this.camera, t = this.controls.target;
    const cur = cam.position.distanceTo(t);
    // FX-534：自适应缓出——距目标越近收得越慢（0.12 基速 + 0.25·近距比），回弹感替代匀速
    const near = Math.min(1, Math.abs(this._zoomTarget - cur) / Math.max(this._zoomTarget, 1e-6));
    const next = cur + (this._zoomTarget - cur) * (0.12 + 0.25 * near);
    const k = (Math.abs(this._zoomTarget - next) < 0.004 * this._zoomTarget) ? this._zoomTarget / cur : next / cur;
    if (Number.isFinite(k) && k > 0) {
      cam.position.sub(t).multiplyScalar(k).add(t);
      this.markDirty();
    }
    if (Math.abs(this._zoomTarget - cam.position.distanceTo(t)) < 0.004 * this._zoomTarget) this._zoomTarget = null;
  }

  // ============ PL-44 选中/hover 三态视觉语言 ============
  // hover=淡灰盒 0.28 / 主选中=琥珀 0.9 / 多选其余=灰 0.45。hover 不抢占选中，仅在编辑态。
  updateHover(clientX, clientY) {
    if (this.boxSelectMode || !this._bindLookup) { this.clearHover(); return; }
    const hit = this.pickDynamic(clientX, clientY);
    const id = hit ? hit.id : null;
    const sel = new Set(this.highlightIds || []);
    if (id && sel.has(id)) { this.clearHover(); return; }   // 已选中体不重复画 hover 态
    if (this._hoverId === id) return;
    this._hoverId = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : '';   // 可抓取暗示：悬停实体=手型
    if (!this._hoverHelper) {
      this._hoverHelper = new THREE.BoxHelper(this.scene, 0x9aa0a6);
      this._hoverHelper.material.transparent = true;
      this._hoverHelper.material.opacity = 0.28;
      this._hoverHelper.visible = false;
      this.scene.add(this._hoverHelper);
    }
    if (id) {
      const bind = this._bindLookup(id);
      if (bind && bind.mesh) {
        this._hoverHelper.setFromObject(bind.mesh);
        this._hoverHelper.visible = true;
      } else this._hoverHelper.visible = false;
    } else {
      this._hoverHelper.visible = false;
    }
    this.markDirty();
  }

  clearHover() {
    if (this._hoverId != null) {
      this._hoverId = null;
      if (this._hoverHelper) this._hoverHelper.visible = false;
      this.markDirty();
    }
  }

  hoverState() { return { id: this._hoverId || null }; }

  // ============ 选中对象定位：相机 target/距离平滑移向实体（第六章「选中对象定位」） ============
  // 场景全景取景（UI-49）：建场/载入后把相机平滑移到全部实体的包围盒
  setGridVisible(on) {
    this._gridOn = on;
    if (this._grid) this._grid.visible = on;
    if (this._gridMajor) this._gridMajor.visible = on;
    if (this._axes) this._axes.forEach((a) => { a.visible = on; });
    this.markDirty();
  }

  // FX-531：子弹时间伪景深——雾近距 16→9 随缓动收紧（数据线 fog:false 不受影响）
  setBptDepth(ease) {
    if (!this.scene.fog) return;
    const near = 16 - 7 * ease;
    if (Math.abs(this.scene.fog.near - near) > 0.05) {
      this.scene.fog.near = near;
      this.markDirty();
    }
  }

  focusScene() {
    const box = new THREE.Box3();
    let any = false;
    for (const m of this.scene.children) {
      if (!m.userData || !m.userData.entityId || !m.visible) continue;
      box.expandByObject(m);
      any = true;
    }
    if (!any) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
    this._focusAnim = { target: center, dist: Math.max(size * 1.6, 2.2) };
  }

  focusOn(mesh) {
    if (!mesh) return;   // 无选中时聚焦是安全空操作（与 focus() 同守卫）
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
  // PL-21 池化：牛顿摆/碰撞链每步碰撞，原先每环 new RingGeometry+材质、1.5s 后 dispose——
  // GPU 缓冲反复建删 + GC。改共享几何 + mesh/材质对象池，只在池空时建新实例。
  spawnImpact(pos) {
    let ring = this._impactPool.pop();
    if (!ring) {
      if (!this._impactGeo) {
        this._impactGeo = new THREE.RingGeometry(0.06, 0.1, 40);
      }
      ring = new THREE.Mesh(
        this._impactGeo,
        new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })
      );
    }
    ring.position.set(pos[0], pos[1] + 0.01, pos[2]);
    ring.rotation.x = -Math.PI / 2;
    ring.userData.spawnT = performance.now();
    this.scene.add(ring);
    this._impacts.push(ring);
    this.markDirty();
  }

  tickImpacts(now) {
    for (let i = this._impacts.length - 1; i >= 0; i--) {
      const m = this._impacts[i];
      const age = (now - m.userData.spawnT) / 1000;
      if (age > 1.5) {
        this.scene.remove(m);
        this._impactPool.push(m);      // 几何共享不 dispose；材质随 mesh 回池复用
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
    if (on && this._ghost && this._lastPointer) this._updateGhostFollow(this._lastPointer[0], this._lastPointer[1]);   // FZ-3
    if (!on && this._snapMarker) this._snapMarker.visible = false;
  }

  // FZ-2：放置预览旋转（[ ] 键，Shift=90°）；放置时角度写进 transform.rot
  ghostRotate(deg) {
    if (!this._ghost) return;
    this._ghostRotY = ((this._ghostRotY || 0) + deg * Math.PI / 180) % (Math.PI * 2);
    this._ghost.rotation.y = this._ghostRotY;
    this.markDirty();
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
    this.raycaster.far = Infinity;   // 防御：共享 raycaster 的 far 可能被探针改小（根治外再加一道）
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
      // 自由摆放「指哪放哪」（用户反馈：球要能直接放上斜面）：光标射线直击实体表面
      // → ghost 骑到命中面上（球体沿命中面法线外推，其余竖直托起）；斜视角瞄到空地
      // 才落回 y=0 地面档。骑面位不参与网格吸附——吸附语义只属于地面档。
      const ride = this._surfaceRide(halfH);
      if (ride) {
        this._ghost.position.copy(ride);
        if (this._snapMarker) this._snapMarker.visible = false;
        this._ghostSnapHit = false;
      } else {
        let gx = pt.x, gz = pt.z;
        if (this._ghostSnapMode === 'grid') { gx = Math.round(gx * 2) / 2; gz = Math.round(gz * 2) / 2; }   // 0.5m 网格吸附
        this._ghost.position.set(gx, this._ghostSpawnY ?? this._ghost.position.y, gz);
        if (this._snapMarker) this._snapMarker.visible = false;
        this._ghostSnapHit = false;
      }
    }
    // 放置防穿模：当前位置的碰撞箱穿透探针（节流：位移 >2cm 或旋转变化才重查）→ ghost 红色警示
    const gp = this._ghost.position.toArray();
    const rotY = this._ghostRotY || 0;
    const movedProbe = !this._probeP || (this._probeRot || 0) !== rotY
      || Math.hypot(gp[0] - this._probeP[0], gp[1] - this._probeP[1], gp[2] - this._probeP[2]) > 0.02;
    if (movedProbe) {
      this._probeP = gp; this._probeRot = rotY;
      this._ghostOverlap = this.cb.ghostProbe ? this.cb.ghostProbe(gp, rotY) : false;
    }
    if (this._ghost.material) {
      this._ghost.material.color.set(this._ghostOverlap ? 0xc96a5a : 0xd9a441);
      this._ghost.material.opacity = this._ghostOverlap ? 0.55 : 0.35;   // UI-610：警示态更醒目
    }
    this.markDirty();
  }

  ghostState() {
    return {
      visible: !!this._ghost && this._ghostFollow,
      snapMode: this._ghostSnapMode || 'grid',
      follow: !!this._ghostFollow,
      snapped: !!this._ghostSnapHit,
      marker: this._snapMarker ? this._snapMarker.visible : false,
      overlap: !!this._ghostOverlap,
      pos: this._ghost ? this._ghost.position.toArray().map((v) => +v.toFixed(3)) : null,
    };
  }
  // 可停靠实体根集合（有 entityId 且非仅视觉的实体；传感器等无碰撞体不可骑不可挡）
  _collidableRoots() {
    const roots = [];
    for (const o of this.scene.children) {
      if (!o.userData || !o.userData.entityId || !o.visible) continue;
      const ob = this._bindLookup ? this._bindLookup(o.userData.entityId) : null;
      if (ob && ob.entity && ob.entity.physics && ob.entity.physics.body === 'none') continue;
      roots.push(o);
    }
    return roots;
  }
  // 光标射线 → 最近实体表面停靠点（ghost 骑面）：球体沿命中面法线外推 halfH+4mm
  // （坡面上=沿坡法线贴住，而非悬在顶点上方）；其余形体不会转体，竖直托起防沉。
  _surfaceRide(halfH) {
    const hits = this.raycaster.intersectObjects(this._collidableRoots(), true)
      .filter((h) => h.object.isMesh);
    if (!hits.length) return null;
    const h = hits[0];
    const p = new THREE.Vector3();
    if (this._ghost && this._ghost.geometry && this._ghost.geometry.type === 'SphereGeometry') {
      const n = h.face
        ? h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize()
        : new THREE.Vector3(0, 1, 0);
      p.copy(h.point).addScaledVector(n, halfH + 0.004);
    } else {
      p.set(h.point.x, h.point.y + halfH + 0.004, h.point.z);
    }
    return p;
  }

  // ============ 材质选择器真材质预览（用户反馈「材质选择全是纯色图案」） ============
  // 离屏微型渲染器把每个材质渲成 96px 材质球：微型摄影棚 env（渐变天光+两块柔光箱+暗地面，
  // equirect→PMREM 供金属反射）+ 主光/冷轮廓光。主场景光照不受影响；失败向上抛由调用方降级色块。
  async renderMaterialSwatches(mats) {
    const keys = Object.keys(mats).filter((k) => mats[k] && mats[k].isMaterial);
    if (!keys.length) return {};
    const R = 96;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(R, R);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    cam.position.set(0, 0.6, 3.9);
    cam.lookAt(0, 0, 0);
    const ec = document.createElement('canvas');
    ec.width = 512; ec.height = 256;
    const g = ec.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, '#3a3d44'); sky.addColorStop(0.52, '#23252a'); sky.addColorStop(0.62, '#0e0f12'); sky.addColorStop(1, '#0a0a0c');
    g.fillStyle = sky; g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#d8dce2'; g.fillRect(40, 52, 120, 46);    // 主柔光箱
    g.fillStyle = '#aeb6c2'; g.fillRect(300, 40, 130, 40);   // 副柔光箱
    g.fillStyle = '#6a707a'; g.fillRect(180, 96, 200, 14);   // 地平灯带
    const etex = new THREE.CanvasTexture(ec);
    etex.mapping = THREE.EquirectangularReflectionMapping;
    etex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(etex).texture;
    scene.environment = env;
    const key = new THREE.DirectionalLight(0xfff1dd, 2.4); key.position.set(2.2, 2.8, 1.6); scene.add(key);
    const rim = new THREE.DirectionalLight(0x9db4ff, 1.1); rim.position.set(-2.6, 1.2, -2.2); scene.add(rim);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32));
    scene.add(sphere);
    const out = {};
    try {
      for (const k of keys) {
        sphere.material = mats[k];
        renderer.render(scene, cam);
        out[k] = renderer.domElement.toDataURL('image/png');
      }
    } finally {
      pmrem.dispose(); etex.dispose(); env.dispose();
      sphere.geometry.dispose();
      renderer.dispose();
    }
    return out;
  }
  showGhost(component) {
    this.hideGhost();
    if (!this._ghostFactory) return;
    const geo = this._ghostFactory(component);
    if (!geo) return;
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9a441, transparent: true, opacity: 0.35, roughness: 0.6 });
    this._ghost = new THREE.Mesh(geo, mat);
    this._ghostSpawnY = component.spawnY ? component.spawnY(component.defaults.params) + 0.02 : 0.5;   // 地面档停靠高度
    this._ghost.position.set(0, this._ghostSpawnY, 0);
    this._ghost.rotation.y = this._ghostRotY || 0;
    this._ghostComponent = component;
    this.scene.add(this._ghost);
    if (this._lastPointer) this._updateGhostFollow(this._lastPointer[0], this._lastPointer[1]);   // FZ-3
    this.markDirty();
  }
  hideGhost() {
    if (this._ghost) {
      this.scene.remove(this._ghost);
      this._ghost.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this._ghost = null;
      this._ghostComponent = null;
      this._ghostRotY = 0;
      this.markDirty();
    }
    this._ghostOverlap = false;
    this._probeP = null;
  }

  // ============ 受力/加速度箭头 ============
  // 分解模式：支持力(淡绿 N)+摩擦力(橙 f)+重力(红)+加速度(青)；合力模式：接触合力(绿)+重力(红)+加速度(青)
  setForceArrows(on, decompose = this.decompose) {
    this.forcesOn = on;
    this.decompose = decompose;
    for (const a of this._forceArrows) a.visible = false;
    this.markDirty();
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
        const len = vd.v ? Math.hypot(vd.v[0], vd.v[1], vd.v[2]) : 0;
        if (vd.v && len > vd.min) {
          a.visible = true;
          a.position.set(it.pos[0], it.pos[1], it.pos[2]);
          a.setDirection(_sv3.set(vd.v[0], vd.v[1], vd.v[2]).normalize());
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
    this.markDirty();
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
          a.position.set(pos[0], pos[1], pos[2]);
          a.setDirection(_sv3.set(f[0], f[1], f[2]).normalize());
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
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));   // PL-54：定点缓冲复用
      const mat = new THREE.LineDashedMaterial({ color: 0x7ba7d9, dashSize: 0.06, gapSize: 0.04, transparent: true, opacity: 0.85 });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 5;
      this.scene.add(line);
      this._jointVizLines.push(line);
    }
    this._jointVizLines.forEach((line, i) => {
      if (i >= want) { line.visible = false; return; }
      const it = items[i];
      const to = it.ok ? it.to : [it.from[0], it.from[1] + 0.5, it.from[2]];
      const attr = line.geometry.attributes.position;
      attr.setXYZ(0, it.from[0], it.from[1], it.from[2]);
      attr.setXYZ(1, to[0], to[1], to[2]);
      attr.needsUpdate = true;
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
    this.markDirty();
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
      _sv3b.set(it.bPos[0] - it.aPos[0], it.bPos[1] - it.aPos[1], it.bPos[2] - it.aPos[2]).normalize();
      for (const [pos, mag, outward] of [[it.aPos, it.tA, -1], [it.bPos, it.tB, 1]]) {
        const a = this._tensionArrows[ai++];
        const len = Math.min(0.15 + mag * 0.05, 1.4);
        a.visible = mag > 0.2;
        a.position.set(pos[0], pos[1], pos[2]);
        a.setDirection(_sv3.set(outward * _sv3b.x, outward * _sv3b.y, outward * _sv3b.z));
        a.setLength(len, 0.08, 0.05);
      }
    }
    for (; ai < this._tensionArrows.length; ai++) this._tensionArrows[ai].visible = false;
  }

  tensionStats() {
    return { total: this._tensionArrows.length, visible: this._tensionArrows.filter((a) => a.visible).length };
  }

  // ============ 透视 / 正交相机切换（唯一入口 toggleProjection；正交视野高固定 6） ============
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
    this.controls.update();
    this.markDirty();
    return this.projection;
  }

  // ============ 轨迹线叠加层 ============
  setTrailsVisible(on) {
    this.trailsVisible = on;
    for (const line of this._trailLines) line.visible = on && line.geometry.drawRange.count >= 4;
    this.markDirty();
  }

  // trails: Map<id, [[x,y,z],...]>（runtime.trails），每实体一条线，颜色按序固定。
  // 增量写点（PER-2）：未到 1800 封顶时只 append 新点；封顶后数组每步 shift 滑动，退回全量重写。
  updateTrails(trails) {
    if (!this.trailsVisible) return;
    // FX-515 速度渐变：慢=蓝(0x5b8dd9) → 中=琥珀(0xd9a441) → 快=红(0xc96a5a)，8 m/s 满标
    const _cA = new THREE.Color(0x5b8dd9), _cB = new THREE.Color(0xd9a441), _cC = new THREE.Color(0xc96a5a);
    const speedColor = (sp, out) => {
      const t = Math.min(sp / 8, 1);
      if (t < 0.5) out.lerpColors(_cA, _cB, t * 2);
      else out.lerpColors(_cB, _cC, (t - 0.5) * 2);
      return out;
    };
    const _tmpC = new THREE.Color();
    let i = 0;
    for (const [trailId, pts] of trails) {
      let line = this._trailLines[i];
      if (!line) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1800 * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(1800 * 3), 3));
        geo.setDrawRange(0, 0);
        const mat = new THREE.LineBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.85, fog: false });   // 顶点色渐变（数据线不吃雾）
        line = new THREE.Line(geo, mat);
        line.frustumCulled = false;
        line.visible = false;
        line.userData.written = 0;
        this.scene.add(line);
        this._trailLines.push(line);
      }
      const attr = line.geometry.attributes.position;
      const cattr = line.geometry.attributes.color;
      if (!cattr) {   // 旧实例兼容：顶点色属性惰性补挂
        line.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(1800 * 3), 3));
        line.material.vertexColors = true;
        line.material.color.setHex(0xffffff);
        line.material.needsUpdate = true;
      }
      const cmap = line.geometry.attributes.color;
      const n = Math.min(pts.length, 1800);
      const w = line.userData.written;
      const full = pts.length >= 1800 || w > n;
      const k0 = full ? 0 : w;
      for (let k = k0; k < n; k++) {
        const pt = pts[k];
        attr.setXYZ(k, pt[0], pt[1], pt[2]);
        speedColor(pt[3] || 0, _tmpC);
        cmap.setXYZ(k, _tmpC.r, _tmpC.g, _tmpC.b);
      }
      if (line.material.vertexColors !== true) { line.material.vertexColors = true; line.material.color.setHex(0xffffff); line.material.needsUpdate = true; }   // FX-515 升级旧线
      line.userData.written = n;
      if (w !== n || full) {
        attr.needsUpdate = true;
        cmap.needsUpdate = true;
        this.markDirty();
      }
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
    this.markDirty();
  }

  // items: [{pos:[x,y,z], vel:[vx,vy,vz]}] 每 tick 由 workbench 用最新遥测驱动
  updateVelocityArrows(items) {
    if (!this.arrowsOn) return;
    while (this._arrows.length < items.length) {
      const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, ACCENT, 0.09, 0.055);
      this.scene.add(a);
      this._arrowSmooth.push({ dir: new THREE.Vector3(1, 0, 0), len: 1, speed: 0 });   // FX-517 平滑态
      this._arrows.push(a);
    }
    this._arrows.forEach((a, i) => {
      if (i >= items.length) { a.visible = false; return; }
      const v = items[i].vel;
      const speed = Math.hypot(v[0], v[1], v[2]);
      const sm = this._arrowSmooth[i];
      if (speed < 0.01 && (!sm || sm.speed < 0.01)) { a.visible = false; if (sm) sm.speed = 0; return; }
      a.visible = true;
      const p = items[i].pos;
      a.position.set(p[0], p[1], p[2]);
      // FX-517：方向/长度指数平滑（lerp 0.35）——碰撞帧速度突变不再毛刺跳变
      const k = 0.35;
      const target = _sv3.set(speed > 1e-9 ? v[0] / speed : 1, speed > 1e-9 ? v[1] / speed : 0, speed > 1e-9 ? v[2] / speed : 0);
      sm.dir.lerp(target, k).normalize();
      const tLen = Math.min(0.15 + speed * 0.22, 1.8);
      sm.len += (tLen - sm.len) * k;
      sm.speed += (speed - sm.speed) * k;
      a.setDirection(sm.dir);
      a.setLength(sm.len, 0.09, 0.055);
      // FX-522：箭头速度映射色（与轨迹同源:慢蓝→快琥珀→极快红,8 m/s 满标）
      const t = Math.min(sm.speed / 8, 1);
      const c1 = [0x5b, 0x8d, 0xd9], c2 = [0xd9, 0xa4, 0x41], c3 = [0xc9, 0x6a, 0x5a];
      const mix = (A, B, u) => A.map((x, j) => Math.round(x + (B[j] - x) * u));
      const rgb = t < 0.5 ? mix(c1, c2, t * 2) : mix(c2, c3, (t - 0.5) * 2);
      a.setColor(new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255));
    });
  }

  // FX-524：轨迹等时节拍点——每 0.5s 模拟时落一枚 0.02m 小点（疏=快密=慢,肉眼可读速度节奏）
  updateBeatDots(dots) {
    if (!this._beatDots) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
      geo.setDrawRange(0, 0);
      const mat = new THREE.PointsMaterial({ color: 0xe7bd68, size: 0.02, sizeAttenuation: true, transparent: true, opacity: 0.8, fog: false });
      this._beatDots = new THREE.Points(geo, mat);
      this._beatDots.frustumCulled = false;
      this.scene.add(this._beatDots);
    }
    const show = this.trailsVisible && dots && dots.length;
    this._beatDots.visible = !!show;
    if (!show) return;
    const attr = this._beatDots.geometry.attributes.position;
    const n = Math.min(dots.length, 64);
    for (let i = 0; i < n; i++) attr.setXYZ(i, dots[i][0], dots[i][1], dots[i][2]);
    attr.needsUpdate = true;
    this._beatDots.geometry.setDrawRange(0, n);
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
      const p = items[i].pos;
      a.position.set(p[0], p[1], p[2]);
      const d = items[i].dir;
      a.setDirection(_sv3.set(d[0], d[1], d[2]).normalize());
      a.setLength(0.55, 0.07, 0.045);
    });
  }

  normalVizCount() {
    return this._normViz.filter((a) => a.visible).length;
  }

  async init() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;   // r186 移除 PCFSoft（原本就静默回退到此，显式化去告警）
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
    controls.maxPolarAngle = Math.PI;   // PL-40 放开：允许压到地平线以下仰视（坡底/装置底面检查）
    controls.zoomSpeed = 0.9;           // 近景手感（FZ-45 同款定稿值）
    controls.addEventListener('change', () => this.markDirty());   // 阻尼收尾帧持续置脏，静止后停渲染
    // FZ-47：用户接管相机即中断取景/飞行动画（此前拖一下视角又被动画拽回去）
    controls.addEventListener('start', () => { this._focusAnim = null; this._poseAnim = null; this._zoomTarget = null; });
    // PL-41/42 平滑光标缩放：容器捕获级接管滚轮（r186 的步进 dolly 无阻尼）——
    // 目标距离指数趋近 + 缩进时 target 向光标点轻拉（zoomToCursor 语义自实现）
    this._zoomTarget = null;
    this.container.addEventListener('wheel', (e) => {
      if (!controls.enableZoom) return;
      e.preventDefault();
      e.stopPropagation();
      const cur = this.camera.position.distanceTo(controls.target);
      if (this._zoomTarget == null) this._zoomTarget = cur;
      const factor = Math.exp(e.deltaY * 0.0011);
      this._zoomTarget = Math.max(controls.minDistance, Math.min(controls.maxDistance, this._zoomTarget * factor));
      // 光标拉引：射线与「过 target、⊥视线」平面求交，缩进量的一半拉 target
      if (factor < 1) {
        const hit = this.rayOnPlane(e.clientX, e.clientY, this.camera.getWorldDirection(_zoomN), controls.target);
        if (hit) {
          _zoomV.set(hit[0], hit[1], hit[2]);
          controls.target.lerp(_zoomV, (1 - factor) * 0.5);
        }
      }
      this.markDirty();
    }, { passive: false, capture: true });
    this.controls = controls;

    // 环境：程序化环境球（materials.createEnvironment，与三灯位同源——网图 HDRI 的摄影棚
    // 在场景里不存在，金属反射两张皮；环境与光照必须同源）
    scene.environment = createEnvironment(renderer);
    scene.environmentIntensity = 0.9;

    const key = new THREE.DirectionalLight(0xfff1dd, 2.0);
    key.position.set(4.5, 7.5, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -9; key.shadow.camera.right = 9;
    key.shadow.camera.top = 9; key.shadow.camera.bottom = -9;
    key.shadow.camera.near = 1; key.shadow.camera.far = 24;
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.02;   // 消斜面/球面接触带自阴影 acne（MAT-6）
    scene.add(key);
    this._keyLight = key;           // 画质档位降/升阴影贴图用（PL-56）
    this._qTier = 2;                // 2=high 1=med 0=low（只动阴影+分辨率，QUALITY BAR 下限）
    const fill = new THREE.DirectionalLight(0xbcccdd, 0.5);
    fill.position.set(-5, 3.5, -4);
    scene.add(fill);
    // 三点布光的轮廓光（MAT-5，真实摄影棚参考）：低强度冷色从后上方勾边，
    // 暗背景里把物体边缘从背景分离（主光 2.0 / 补光 0.5 / 轮廓 0.35）
    const rim = new THREE.DirectionalLight(0x8ab0d0, 0.35);
    rim.position.set(-3.5, 5.5, -5.5);
    scene.add(rim);

    // 影 receiving 地面（透明 ShadowMaterial，不与实体碰撞概念混淆）
    const shadowFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.ShadowMaterial({ opacity: 0.42 })
    );
    shadowFloor.rotation.x = -Math.PI / 2;
    shadowFloor.position.y = 0.001;
    shadowFloor.receiveShadow = true;
    scene.add(shadowFloor);

    // 工作台网格：细格+主格双频（Blender 式分层，两层各自低不透明度；刻度间距随相机
    // 距离动态重建，见 setGridScale）+ 坐标轴
    this._grid = null;      // 细格层（步距 <0.25m 的密距档不渲染，防摩尔条纹）
    this._gridMajor = null; // 主格层（5×步距）
    this._gridOn = true;
    this._rebuildGrid(1);
    this._gridStep = 1;
    const axisMat = (c) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.38 });
    const xAxis = new THREE.Line(new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(-10, 0.002, 0), new THREE.Vector3(10, 0.002, 0)]), axisMat(0xa1554a));
    const zAxis = new THREE.Line(new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(0, 0.002, -10), new THREE.Vector3(0, 0.002, 10)]), axisMat(0x4f7ba6));
    scene.add(xAxis, zAxis);
    this._axes = [xAxis, zAxis];   // 网格显隐开关一并管坐标轴

    // gizmo（r186：TransformControls 非 Object3D，挂 getHelper()）
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setMode('translate');
    gizmo.setSize(0.85);
    gizmo.addEventListener('dragging-changed', (ev) => {
      controls.enabled = !ev.value; this.markDirty();
      // 拖拽会话边界（自由摆放实时碰撞）：起点位姿快照 + 通知 workbench 起止
      if (ev.value) {
        this._dragPose = this.gizmo.object
          ? { pos: this.gizmo.object.position.clone(), rot: this.gizmo.object.rotation.clone() }
          : null;
        if (this.cb.onGizmoDragStart) this.cb.onGizmoDragStart();
      } else {
        this._dragPose = null;
        if (this.cb.onGizmoDragEnd) this.cb.onGizmoDragEnd();
      }
    });
    gizmo.addEventListener('objectChange', () => {
      this.markDirty();
      // 拖拽中实时碰撞（自由摆放=全程有碰撞体积，不等提交才弹回）
      if (this._dragPose && this.cb.onGizmoLive) this.cb.onGizmoLive(this.gizmoMode);
    });
    gizmo.addEventListener('mouseUp', () => this.cb.onGizmoCommit && this.cb.onGizmoCommit());
    gizmo.enabled = false;
    this.gizmo = gizmo;
    scene.add(gizmo.getHelper());

    // 双击实体=相机聚焦（比「选中再按 F」少一步；空处双击=全景取景）
    renderer.domElement.addEventListener('dblclick', (e) => {
      const id = this.pick(e.clientX, e.clientY);   // pick 返回实体 id 或 null
      if (id && this.cb.onSelect) this.cb.onSelect(id, false);
      const bind = id && this._bindLookup ? this._bindLookup(id) : null;
      if (bind && bind.mesh) this.focusOn(bind.mesh);
      else if (!id) this.focusScene();   // 空处双击=全景取景
    });
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
      this._lastPointer = [e.clientX, e.clientY];   // FZ-3：ghost 跟随需指针历史（hover 后鼠标静止也能就位）
      if (this._ghostFollow && this._ghost) this._updateGhostFollow(e.clientX, e.clientY);
      if (this.boxSelectMode && this._boxSel) {
        this._boxSel.x1 = e.clientX;
        this._boxSel.y1 = e.clientY;
        const rb = document.getElementById('rubber');
        const rx = Math.min(this._boxSel.x0, e.clientX), ry = Math.min(this._boxSel.y0, e.clientY);
        const rw = Math.abs(this._boxSel.x1 - this._boxSel.x0), rh = Math.abs(this._boxSel.y1 - this._boxSel.y0);
        rb.style.left = rx + 'px';
        rb.style.top = ry + 'px';
        rb.style.width = rw + 'px';
        rb.style.height = rh + 'px';
        // UI-613：框选实时尺寸反馈（框下缘 mono 小签;屏幕像素→世界米,与标尺同口径）
        const tag = document.getElementById('rubberTag');
        if (tag && rw + rh > 30) {
          const cam = this.camera;
          const viewW = cam.isOrthographicCamera
            ? (cam.right - cam.left) / (cam.zoom || 1)
            : 2 * cam.position.distanceTo(this.controls.target) * Math.tan((cam.fov || 42) * Math.PI / 360);
          const mpp = viewW / Math.max(1, this.renderer.domElement.clientWidth);
          tag.style.display = 'block';
          tag.style.left = rx + 'px';
          tag.style.top = (ry + rh + 6) + 'px';
          tag.textContent = `${(rw * mpp).toFixed(1)} × ${(rh * mpp).toFixed(1)} m`;
        } else if (tag) tag.style.display = 'none';
      }
      // PL-44 hover 三态（编辑态、非 ghost/框选期），70ms 节流
      const now = performance.now();
      if (now - (this._hoverT || 0) > 70) {
        this._hoverT = now;
        if (this.gizmoEnabled !== false && !this._ghostFollow) this.updateHover(e.clientX, e.clientY);
      }
    });
    renderer.domElement.addEventListener('pointerup', (e) => this._onUp(e));
    window.addEventListener('resize', () => this.resize());
  }

  _onUp(e) {
    if (!this._downPos) return;
    const dx = e.clientX - this._downPos[0], dy = e.clientY - this._downPos[1];
    this._downPos = null;
    if (e.button !== 0) {   // FZ-35：右/中键松手不触发点选（右键平移松手曾误换选中）
      if (e.button === 2 && this._ghost && this._ghostFollow && dx * dx + dy * dy <= 25) {
        this.cb.onGhostCancel && this.cb.onGhostCancel();   // FZ-13：右键轻点退出放置模式
      }
      return;
    }
    if (this._ghost && this._ghostFollow) {   // FZ-1：ghost 激活期左键轻点=在 ghost 位放置
      if (dx * dx + dy * dy <= 25) this.cb.onGhostPlace && this.cb.onGhostPlace(this._ghost.position.clone());
      return;
    }
    if (this.boxSelectMode && this._boxSel) {
      const sel = this._boxSel;
      this._boxSel = null;
      if (this._rubber) this._rubber.style.display = 'none';
        const _rt = document.getElementById('rubberTag'); if (_rt) _rt.style.display = 'none';
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
        const _rt = document.getElementById('rubberTag'); if (_rt) _rt.style.display = 'none';
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

  // ============ 放置/挪动防穿模探测（用户需求「根据碰撞箱阻挡」） ============
  // 26 向射线从假想体质心出射（双面化临时材质），_embedStats 统一产出双口径：
  //   count=嵌入方向数（他面比自己面更近的方向；贴面相切 1e-4 容差不算）
  //   depth=最深嵌入深度 m（同方向自面-他面距离差最大值；体内包覆按 1.0 计）
  // count 口径供「嵌入/不嵌」判定（placementLiftFor/挪动弹回），depth 口径供拖拽实时
  // 碰撞的「不比出发更深」相对判定——坡面贴停的口径噪声下，方向数会同增同减导致
  // 「candN >= curN」恒真、贴坡球完全拖不动；深度差才是稳定的相对量。
  _penDirs = null;
  _probeOthers(mesh, excludeId, isDynamic) {
    const others = [];
    for (const o of this.scene.children) {
      if (!o.userData || !o.userData.entityId || o === mesh || !o.visible) continue;
      if (excludeId != null && o.userData.entityId === excludeId) continue;
      // 拦截规则（与 workbench 同）：固定探针只被动态体阻挡（固定×固定放行）
      const ob = this._bindLookup ? this._bindLookup(o.userData.entityId) : null;
      const otherDynamic = ob && ob.entity && ob.entity.physics ? ob.entity.physics.body === 'dynamic' : true;
      if (!isDynamic && !otherDynamic) continue;
      // 连接件（绳/弹簧 8 段圆柱 mesh 悬链穿过端物体是常态,无碰撞体）不作为嵌入障碍物
      // ——竖直圆摆正下方球曾被判埋抬飞 1.2m（MOD-504 实锤）
      if (ob && ob.entity && (ob.entity.type === 'rope' || ob.entity.type === 'spring' || ob.entity.type === 'tank')) continue;
      others.push(o);
    }
    return others;
  }
  _embedStats(mesh, others) {
    mesh.updateMatrixWorld(true);
    if (!others.length) return { count: 0, depth: 0 };
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const far = box.getSize(new THREE.Vector3()).length() * 4 + 2;
    if (!this._penDirs) {
      this._penDirs = [];
      for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
        if (!x && !y && !z) continue;
        this._penDirs.push(new THREE.Vector3(x, y, z).normalize());
      }
    }
    const mats = new Set();
    for (const o of [mesh, ...others]) {
      o.traverse((t) => { if (t.isMesh && t.material) { t.material.side = THREE.DoubleSide; mats.add(t.material); } });
    }
    const far0 = this.raycaster.far;   // 共享 raycaster：far 必须还原，否则泄漏污染后续所有射线
    try {
      let embedded = 0, enclosed = 0, depth = 0;
      for (const d of this._penDirs) {
        this.raycaster.set(center, d);
        this.raycaster.far = far;
        const sHit = this.raycaster.intersectObject(mesh, true)[0];
        const oHit = this.raycaster.intersectObjects(others, true)[0];
        if (!oHit) continue;
        enclosed++;
        // 他面比自己面更近 = 该方向被埋（贴面相切 o≈s 不算，1e-4 容差）
        if (!sHit || oHit.distance < sHit.distance - 1e-4) {
          embedded++;
          const pen = sHit ? sHit.distance - oHit.distance : far;
          if (pen > depth) depth = pen;
        }
      }
      // 体内包覆（≥22 向有他面=封闭体内）按全嵌 26 向 / 1m 深计
      if (enclosed >= 22) return { count: this._penDirs.length, depth: 1.0 };
      return { count: embedded, depth };
    } finally {
      this.raycaster.far = far0;
      for (const m of mats) m.side = THREE.FrontSide;
    }
  }
  meshPenetrates(mesh, excludeId = null, isDynamic = false) {
    return this._embedStats(mesh, this._probeOthers(mesh, excludeId, isDynamic)).count;
  }
  meshPenetrationDepth(mesh, excludeId = null, isDynamic = false) {
    return this._embedStats(mesh, this._probeOthers(mesh, excludeId, isDynamic)).depth;
  }

  // 运行态抓取拾取（层 2）：射线找最近可见实体网格，命中返回 {id, point:[x,y,z]}
  pickDynamic(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const roots = [];
    for (const o of this.scene.children) {
      if (o.userData && o.userData.entityId && o.visible) roots.push(o);
    }
    const hits = this.raycaster.intersectObjects(roots, true);
    if (!hits.length) return null;
    const h = hits[0];
    let o = h.object;
    while (o && !o.userData.entityId) o = o.parent;
    return o ? { id: o.userData.entityId, point: [h.point.x, h.point.y, h.point.z] } : null;
  }

  // 世界点 → 屏幕像素（测试/调试投影用）
  screenPosOf(x, y, z) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return [(v.x + 1) / 2 * r.width + r.left, (-v.y + 1) / 2 * r.height + r.top];
  }

  // 指针射线与平面（normal, point）求交 → 世界坐标拖拽目标
  rayOnPlane(clientX, clientY, normal, planePt) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const denom = this.raycaster.ray.direction.dot(normal);
    if (Math.abs(denom) < 1e-6) return null;
    const t = planePt.clone().sub(this.raycaster.ray.origin).dot(normal) / denom;
    if (t <= 0) return null;
    const p = this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, t);
    return [p.x, p.y, p.z];
  }

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
      h.material.opacity = main ? 0.65 : 0.4;
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
    this.markDirty();
  }

  refreshHighlight() {
    for (const h of this._highlights) h.update();
  }

  setGizmoMode(mode) {
    this.gizmoMode = mode;
    this.markDirty();
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
    this.markDirty();
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
    this._rebuildGrid(step);
    this.markDirty();
  }

  // 双频网格（UI 审计 U1）：单层 0.85 不透明度在 0.1m 档=200 条线，掠射角下摩尔条纹把
  // 地面糊成瓦楞钢；拆细格(op .30)+主格(op .52)两层。细格只在步距 ≥0.25m 渲染（密距档
  // 留 0.5m 主格承担参照，读数签仍报真实测量步距）；步距 5m 时主格超地界不画。
  _rebuildGrid(step) {
    for (const k of ['_grid', '_gridMajor']) {
      const g = this[k];
      if (g) {
        this.scene.remove(g);
        g.geometry.dispose();
        g.material.dispose();
        this[k] = null;
      }
    }
    const SIZE = 20;
    if (step >= 0.25) {
      const minor = new THREE.GridHelper(SIZE, Math.round(SIZE / step), 0x1f2226, 0x1f2226);
      minor.material.transparent = true;
      minor.material.opacity = 0.3;
      minor.visible = this._gridOn !== false;
      this.scene.add(minor);
      this._grid = minor;
    }
    const majorStep = step * 5;
    if (majorStep <= SIZE) {
      const major = new THREE.GridHelper(SIZE, Math.max(4, Math.round(SIZE / majorStep)), 0x3c4046, 0x3c4046);
      major.material.transparent = true;
      major.material.opacity = 0.52;
      major.visible = this._gridOn !== false;
      this.scene.add(major);
      this._gridMajor = major;
    }
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
    this._poseAnim = null;   // 程序化聚焦=用户意图：打断飞行动画
    this._zoomTarget = null;
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 0.25);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, Math.max(size * 2.4, 1.0));
    this.controls.update();
  }

  resetView() {
    this._poseAnim = null;   // 同 setViewPreset：打断动画
    this._focusAnim = null;
    this._zoomTarget = null;
    this.camera.position.set(3.4, 2.6, 5.2);
    this.controls.target.set(0, 0.5, 0);
    this.controls.update();
  }

  setViewPreset(p) {
    // 程序化视角=用户意图：打断取景/飞行/缩放动画（否则 flyToPose 会把视角拽回去——p29 回归）
    this._poseAnim = null;
    this._focusAnim = null;
    this._zoomTarget = null;
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
    } else if (this._orthoCam) {
      // 正交相机按新纵横比重建 frustum（视野高保持切换时的 6，与 toggleProjection 一致）
      const ar = w / h;
      this._orthoCam.left = -3 * ar;
      this._orthoCam.right = 3 * ar;
      this._orthoCam.top = 3;
      this._orthoCam.bottom = -3;
      this._orthoCam.updateProjectionMatrix();
    }
    this.renderer.setSize(w, h);
    this.markDirty();
  }

  // ============ 画质档（PL-56/58 自适应降档的唯一入口） ============
  // 只动阴影贴图分辨率与画布 pixelRatio（下限 1），不动几何/材质/叠加层（QUALITY BAR）。
  setQualityTier(tier) {
    tier = Math.max(0, Math.min(2, tier | 0));
    if (!this.renderer || this._qTier === tier) return;
    this._qTier = tier;
    const shadowSize = [512, 1024, 2048][tier];
    const key = this._keyLight;
    if (key && key.shadow.mapSize.x !== shadowSize) {
      key.shadow.mapSize.set(shadowSize, shadowSize);
      if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }   // 下一帧按新尺寸重建
    }
    const dpr = window.devicePixelRatio || 1;
    const pr = Math.max(1, Math.min(dpr, [1, 1.5, 2][tier]));
    if (this.renderer.getPixelRatio() !== pr) {
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }
    this.markDirty();
  }

  qualityTier() { return this._qTier == null ? 2 : this._qTier; }

  // ============ 脏标记（静止帧跳过 GPU 渲染，PER-1） ============
  // 任何可能改变画面的事件都必须 markDirty()；controls/gizmo 在 init 里统一接线。
  // 保险丝：连续跳过最长 500ms——未知置脏源漏网时至多半秒旧画，不会冻结。
  markDirty() { this._dirty = true; }
  consumeDirty(now = performance.now()) {
    if (this._dirty) { this._dirty = false; this._lastRenderAt = now; return true; }
    if (now - (this._lastRenderAt || 0) > 500) { this._lastRenderAt = now; return true; }
    return false;
  }

  render() {
    // controls.update() 由 workbench tick 每帧调用（脏帧与静止帧都要跑，保证阻尼收敛）；
    // 这里只做高亮盒跟随与 GPU 提交。
    this.refreshHighlight();
    this.renderer.render(this.scene, this.camera);
    // PL-50：HUD draw calls / 三角数（一次 render pass 的统计，读 info 不触发 GPU 工作）
    this.drawCalls = this.renderer.info.render.calls;
    this.triangles = this.renderer.info.render.triangles;
  }
}
