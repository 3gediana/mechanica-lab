// MECHANICA · 牛顿力学拟真沙盘 —— 主程序
// 物理内核 Rapier(WASM)，渲染 three.js + HDRI 摄影棚布光 + 轻 bloom
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { TRACK_POINTS, TRACK_META } from './track-curve.js';
import { createMaterials } from './materials.js';

const $ = (id) => document.getElementById(id);
const veil = $('veil'), veilStatus = $('veilStatus'), errbar = $('errbar');
function setLoad(msg) { veilStatus.textContent = msg; }
function fail(msg) {
  veilStatus.textContent = '加载失败：' + msg;
  veilStatus.classList.add('err');
  errbar.textContent = msg;
  errbar.style.display = 'block';
  veil.classList.remove('gone');
}

async function loadRapier() {
  const candidates = ['@dimforge/rapier3d-compat', './rapier-fallback.mjs'];
  for (const p of candidates) {
    try { const m = await import(p); return m.default ?? m; } catch (e) { /* 换下一个候选 */ }
  }
  throw new Error('Rapier 内核未找到（vendor/rapier/）');
}

// ============ 全局状态 ============
let RAPIER, world, renderer, scene, camera, controls, composer;
let simT = 0, acc = 0, paused = false, timeScale = 1, ready = false;
const H = 1 / 120;                       // 固定物理步长
const G_ARROW = 0x0001, G_DYN = 0x0002;  // 碰撞组：静态 / 可抓取动态
const groupsStatic = (G_ARROW << 16) | 0xffff;
const groupsDyn = (G_DYN << 16) | 0xffff;
const rayGroups = (G_ARROW << 16) | G_DYN; // 抓取射线只命中动态体

const pairs = [];            // {mesh, body} 同步对
let ballBody, ballMesh, pendBody, pendMesh, ropeMesh, blockBody, blockMesh;
let stopperMesh, stopperBody, stopperCol = null, stopperAnim = -1;
let saturnSpin;
let held = null, grabDist = 3, grabPoint = new THREE.Vector3();
const pointerNdc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let pendCross = { lastSign: 0, prevT: -1, lastT: -1, avg: 0, samples: [] };
let roTimer = 0;

const initPose = [];         // 复位用 [{body, pos, rot, vel, angvel}]

// ============ 轨道几何（开口朝上的半管） ============
function buildTrough(radius, arcFraction, along, radial) {
  const pts = TRACK_POINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
  const up = new THREE.Vector3(0, 1, 0);
  const B = new THREE.Vector3(0, 0, 1);
  const openHalf = Math.PI * (1 - arcFraction) / 2;
  const pos = [], nor = [], uv = [], idx = [];
  const N = new THREE.Vector3(), P = new THREE.Vector3(), T = new THREE.Vector3(), D = new THREE.Vector3();
  for (let i = 0; i <= along; i++) {
    const t = i / along;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T).normalize();
    N.set(-T.y, T.x, 0).normalize();                 // 平面曲线的面内法向
    const phiUp = Math.atan2(up.dot(B), up.dot(N));  // 开口对准世界正上方
    for (let j = 0; j <= radial; j++) {
      const phi = phiUp + openHalf + (j / radial) * (2 * Math.PI - 2 * openHalf);
      D.copy(N).multiplyScalar(Math.cos(phi)).addScaledVector(B, Math.sin(phi));
      pos.push(P.x + D.x * radius, P.y + D.y * radius, P.z + D.z * radius);
      nor.push(-D.x, -D.y, -D.z);                    // 法向指向管轴（内表面）
      uv.push(t * 6, j / radial);                    // 全长 24 块砖 ×repeat4 ≈ 37cm/纹，大理石纹理尺度
    }
  }
  for (let i = 0; i < along; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ============ 初始化 ============
(async function init() {
  try {
    setLoad('正在加载物理内核');
    RAPIER = await loadRapier();
    await RAPIER.init();

    setLoad('正在初始化渲染器');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    $('stage').appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0c0e);
    scene.fog = new THREE.Fog(0x0b0c0e, 11, 28);
    camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 120);
    camera.position.set(0.4, 1.7, 7.3);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(-0.1, 0.75, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 1.6;
    controls.maxDistance = 14;
    controls.maxPolarAngle = 1.52;

    setLoad('正在加载材质库');
    const M = await createMaterials();

    setLoad('正在加载摄影棚灯光');
    scene.environmentIntensity = 0.55;           // 收敛环境反射，暗部沉下去，高光留给主光
    try {
      const tex = await new HDRLoader().loadAsync('./assets/hdri/studio_1k.hdr');
      tex.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = tex;
    } catch (e) {
      console.warn('HDRI 缺失，降级 RoomEnvironment', e);
      const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }

    // ---- 灯光：暖主光 + 冷辅光，环境由 HDRI 提供
    const key = new THREE.DirectionalLight(0xfff1dd, 2.05);
    key.position.set(4.5, 7.5, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -5; key.shadow.camera.right = 5;
    key.shadow.camera.top = 5; key.shadow.camera.bottom = -5;
    key.shadow.camera.near = 1; key.shadow.camera.far = 20;
    key.shadow.bias = -0.0002;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcccdd, 0.5);
    fill.position.set(-5, 3.5, -4);
    scene.add(fill);

    // ---- 地面：真镜面 + 暗色覆层
    const mirror = new Reflector(new THREE.CircleGeometry(16, 72), {
      textureWidth: Math.floor(1024 * Math.min(window.devicePixelRatio, 2)),
      textureHeight: Math.floor(1024 * Math.min(window.devicePixelRatio, 2)),
      color: 0x84878d, clipBias: 0.003,
    });
    mirror.rotateX(-Math.PI / 2);
    scene.add(mirror);
    const overlay = new THREE.Mesh(new THREE.CircleGeometry(16, 72), M.floorOverlay);
    overlay.rotateX(-Math.PI / 2);
    overlay.position.y = 0.002;
    overlay.receiveShadow = true;
    scene.add(overlay);

    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = H;                          // 固定步长 1/120，与累加器一致（默认 1/60 会让全场景双倍速）

    // ---- 轨道（视觉 600 段 / 碰撞 420 段）
    const R = TRACK_META.tubeRadius;
    const trackGeo = buildTrough(R, 0.61, 620, 48);
    const track = new THREE.Mesh(trackGeo, M.marble);
    track.castShadow = true; track.receiveShadow = true;
    scene.add(track);
    const colGeo = buildTrough(R, 0.61, 420, 20);
    const tri = new Uint32Array(colGeo.getIndex().array);
    const vtx = new Float32Array(colGeo.getAttribute('position').array);
    world.createCollider(RAPIER.ColliderDesc.trimesh(vtx, tri).setFriction(0.15).setRestitution(0.04));

    // ---- 支撑柱（暗钢）
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 20);
    for (const [px, uy] of TRACK_META.pylonAnchors) {
      const p = new THREE.Mesh(cylGeo, M.steelDark);
      p.scale.set(0.034, uy, 0.034);
      p.position.set(px, uy / 2, 0);
      p.castShadow = true;
      scene.add(p);
      const foot = new THREE.Mesh(cylGeo, M.steelDark);
      foot.scale.set(0.1, 0.018, 0.1);
      foot.position.set(px, 0.009, 0);
      scene.add(foot);
    }

    // ---- 环侧支撑架（两柱一横梁，托住环管两侧）
    for (const [fx, fy, hs] of (TRACK_META.sideFrames || [])) {
      for (const dz of [-hs, hs]) {
        const post = new THREE.Mesh(cylGeo, M.steelDark);
        post.scale.set(0.024, fy, 0.024);
        post.position.set(fx, fy / 2, dz);
        post.castShadow = true;
        scene.add(post);
      }
      const bar = new THREE.Mesh(cylGeo, M.steelDark);
      bar.scale.set(0.02, hs * 2, 0.02);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(fx, fy, 0);
      bar.castShadow = true;
      scene.add(bar);
    }

    // ---- 挡板（抽开式，立在坡上球的前方）
    stopperMesh = new THREE.Mesh(new THREE.BoxGeometry(...TRACK_META.stopper.size), M.brass);
    stopperMesh.position.set(...TRACK_META.slopeStopper);
    stopperMesh.castShadow = true;
    scene.add(stopperMesh);
    stopperBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...TRACK_META.slopeStopper));
    stopperCol = world.createCollider(RAPIER.ColliderDesc.cuboid(
      TRACK_META.stopper.size[0] / 2, TRACK_META.stopper.size[1] / 2, TRACK_META.stopper.size[2] / 2
    ).setFriction(0.4).setCollisionGroups(groupsStatic), stopperBody);

    // ---- 铬钢球（主角）：出生在斜坡上、贴管底，挡板抽开即沿坡滚下
    const spawn = TRACK_META.slopeSpawn;
    ballMesh = new THREE.Mesh(new THREE.SphereGeometry(TRACK_META.ballRadius, 48, 32), M.chrome);
    ballMesh.castShadow = true;
    scene.add(ballMesh);
    ballBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(...spawn).setCcdEnabled(true).setLinearDamping(0.0).setAngularDamping(0.01));
    world.createCollider(RAPIER.ColliderDesc.ball(TRACK_META.ballRadius)
      .setDensity(7100).setFriction(0.3).setRestitution(0.06).setCollisionGroups(groupsDyn), ballBody);

    // ---- 橡胶球（用户抛掷用）
    const rubberBallMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 40, 28), M.rubber);
    rubberBallMesh.castShadow = true;
    rubberBallMesh.position.set(3.3, 0.09, 1.3);
    scene.add(rubberBallMesh);
    const rubberBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(3.3, 0.09, 1.3).setLinearDamping(0.12).setAngularDamping(0.35));
    world.createCollider(RAPIER.ColliderDesc.ball(0.09)
      .setDensity(1100).setFriction(0.85).setRestitution(0.72).setCollisionGroups(groupsDyn), rubberBody);
    pairs.push({ mesh: rubberBallMesh, body: rubberBody });

    // ---- 橡木块（跑道末端的碰撞对象，加重防止被撞出画面）
    blockMesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.20), M.wood);
    blockMesh.castShadow = true;
    blockMesh.position.set(4.15, 0.13, 0);
    scene.add(blockMesh);
    blockBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(4.15, 0.13, 0).setLinearDamping(0.6).setAngularDamping(0.8));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.21, 0.13, 0.10)
      .setDensity(700).setFriction(0.8).setRestitution(0.12).setCollisionGroups(groupsDyn), blockBody);
    pairs.push({ mesh: blockMesh, body: blockBody });

    // ---- 单摆：钢架门式横梁 + 铬球 + 轻绳
    const gantry = new THREE.Group();
    const post1 = new THREE.Mesh(cylGeo, M.steelDark);
    post1.scale.set(0.03, 2.4, 0.03); post1.position.set(1.95, 1.2, -1.62);
    const post2 = post1.clone(); post2.position.z = -0.58;
    const cross = new THREE.Mesh(cylGeo, M.steelDark);
    cross.scale.set(0.024, 1.1, 0.024);
    cross.rotation.x = Math.PI / 2; cross.position.set(1.95, 2.38, -1.1);
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 24), M.brass);
    mount.position.set(1.95, 2.355, -1.1);
    gantry.add(post1, post2, cross, mount);
    gantry.traverse((o) => { o.castShadow = true; });
    scene.add(gantry);

    pendMesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 40, 28), M.chrome);
    pendMesh.castShadow = true;
    scene.add(pendMesh);
    pendBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(1.95, 1.1, -1.1).setLinearDamping(0.12).setAngularDamping(0.2));
    world.createCollider(RAPIER.ColliderDesc.ball(0.075)
      .setDensity(7100).setFriction(0.3).setRestitution(0.3).setCollisionGroups(groupsDyn), pendBody);
    const anchorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(1.95, 2.35, -1.1));
    world.createImpulseJoint(RAPIER.JointData.rope(1.25, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), anchorBody, pendBody, true);
    ropeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 1, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.6 }));
    scene.add(ropeMesh);
    pendBody.setLinvel({ x: 0.9, y: 0, z: 0 }, true);

    // ---- 土星展台（黄铜座 + 真实贴图行星，置于滑道左侧空地避免遮挡）
    const pedestal = new THREE.Group();
    pedestal.position.set(-2.35, 0, -1.35);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.05, 40), M.brass);
    base.position.y = 0.025;
    const stem = new THREE.Mesh(cylGeo, M.brass);
    stem.scale.set(0.028, 0.72, 0.028); stem.position.y = 0.41;
    pedestal.add(base, stem);
    const saturnTilt = new THREE.Group();
    saturnTilt.position.y = 1.18;
    saturnTilt.rotation.z = 0.28;
    saturnSpin = new THREE.Mesh(new THREE.SphereGeometry(0.42, 48, 32), M.saturn);
    saturnSpin.castShadow = true;
    const ring = M.saturnRing ? new THREE.Mesh(saturnRingGeometry(), M.saturnRing) : null;
    if (ring) { ring.rotation.x = -Math.PI / 2 + 0.12; saturnTilt.add(ring); }
    saturnTilt.add(saturnSpin);
    pedestal.add(saturnTilt);
    pedestal.traverse((o) => { o.castShadow = true; });
    scene.add(pedestal);

    // ---- 环顶光门标记（两根细针 + 黄铜珠）
    const lc = loopCenter();
    for (const dz of [-0.26, 0.26]) {
      const pin = new THREE.Mesh(cylGeo, M.steelDark);
      pin.scale.set(0.006, 0.34, 0.006);
      pin.position.set(lc.x, 1.32, dz);
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 12), M.brass);
      bead.position.set(lc.x, 1.49, dz);
      scene.add(pin, bead);
    }

    // ---- 后处理：轻 bloom（vendor 缺失时直渲）
    try {
      const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
      const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js');
      const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');
      const { OutputPass } = await import('three/addons/postprocessing/OutputPass.js');
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.45, 0.92));
      composer.addPass(new OutputPass());
    } catch (e) { console.warn('后处理不可用，直渲', e); composer = null; }

    // ---- 复位快照
    for (const p of pairs) snapshot(p.body);
    snapshot(ballBody); snapshot(pendBody); snapshot(blockBody);

    bindEvents();
    bindUI();

    ready = true;
    veil.classList.add('gone');
    $('console').classList.add('on');
    $('panel').classList.add('on');
    for (const b of document.querySelectorAll('#console button')) b.disabled = false;
  } catch (err) {
    console.error(err);
    fail(err && err.message ? err.message : String(err));
  }

  function snapshot(body) {
    const t = body.translation(), r = body.rotation();
    initPose.push({ body, pos: { ...t }, rot: { ...r } });
  }
})();

function loopCenter() {
  const [i0, i1] = TRACK_META.segments.loop;
  let sx = 0, n = 0;
  for (let i = i0; i <= i1; i++) { sx += TRACK_POINTS[i][0]; n++; }
  return { x: sx / n };
}

// 土星环贴图是径向条带：UV 从圆盘映射重排为径向（u=半径方向）
function saturnRingGeometry() {
  const g = new THREE.RingGeometry(0.55, 0.98, 96);
  const pos = g.attributes.position, uv = g.attributes.uv;
  const v3 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v3.fromBufferAttribute(pos, i);
    uv.setXY(i, (v3.length() - 0.55) / 0.43, 0.5);
  }
  return g;
}

// ============ 交互 ============
function bindEvents() {
  const el = renderer.domElement;
  el.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('resize', onResize);

  function rayFromEvent(e) {
    pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    return new RAPIER.Ray(
      { x: raycaster.ray.origin.x, y: raycaster.ray.origin.y, z: raycaster.ray.origin.z },
      { x: raycaster.ray.direction.x, y: raycaster.ray.direction.y, z: raycaster.ray.direction.z });
  }
  function onDown(e) {
    if (!ready) return;
    const hit = world.castRay(rayFromEvent(e), 30, true, undefined, rayGroups);
    if (!hit) return;
    const body = hit.collider.parent();
    if (!body || !body.isDynamic()) return;
    held = body;
    grabDist = hit.timeOfImpact;
    controls.enabled = false;
    held.setGravityScale(0, true);
    el.style.cursor = 'grabbing';
  }
  function onMove(e) {
    if (!held) return;
    rayFromEvent(e);
    grabPoint.copy(raycaster.ray.direction).multiplyScalar(grabDist).add(raycaster.ray.origin);
  }
  function onUp() {
    if (!held) return;
    held.setGravityScale(1, true);
    held = null;
    controls.enabled = true;
    el.style.cursor = '';
  }
  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  }
}

function bindUI() {
  $('btnRelease').onclick = releaseStopper;
  $('btnPause').onclick = togglePause;
  $('btnSlow').onclick = toggleSlow;
  $('btnReset').onclick = resetAll;
  if (new URLSearchParams(location.search).get('run') === '1') {
    setTimeout(releaseStopper, 1200);   // 确定性验证通道：加载完自动抽挡板
  }
  window.addEventListener('keydown', (e) => {
    if (!ready) return;
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    else if (e.code === 'KeyR') resetAll();
    else if (e.code === 'KeyF') toggleSlow();
    else if (e.code === 'KeyG') releaseStopper();
  });
}
function releaseStopper() {
  if (stopperCol === null || stopperAnim >= 0) return;
  stopperAnim = 0;
}
function togglePause() {
  paused = !paused;
  $('btnPause').textContent = paused ? '继续' : '暂停';
  $('btnPause').classList.toggle('hot', paused);
}
function toggleSlow() {
  timeScale = timeScale === 1 ? 0.3 : 1;
  $('btnSlow').textContent = timeScale === 1 ? '慢速' : '常速';
  $('btnSlow').classList.toggle('hot', timeScale !== 1);
}
function resetAll() {
  for (const s of initPose) {
    s.body.setTranslation({ ...s.pos }, true);
    s.body.setRotation({ ...s.rot }, true);
    s.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    s.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  pendBody.setLinvel({ x: 0.9, y: 0, z: 0 }, true);
  if (held) { held.setGravityScale(1, true); held = null; controls.enabled = true; }
  if (stopperCol === null) {
    stopperCol = world.createCollider(RAPIER.ColliderDesc.cuboid(
      TRACK_META.stopper.size[0] / 2, TRACK_META.stopper.size[1] / 2, TRACK_META.stopper.size[2] / 2
    ).setFriction(0.4).setCollisionGroups(groupsStatic), stopperBody);
  }
  stopperAnim = -1;
  stopperMesh.position.set(...TRACK_META.slopeStopper);
  stopperMesh.visible = true;
  simT = 0; acc = 0; timeScale = 1;
  $('btnSlow').textContent = '慢速'; $('btnSlow').classList.remove('hot');
  paused = false;
  $('btnPause').textContent = '暂停'; $('btnPause').classList.remove('hot');
  pendCross = { lastSign: 0, prevT: -1, lastT: -1, avg: 0, samples: [] };
}

// ============ 物理步进 ============
function stepPhysics(h) {
  if (held) {
    const m = held.mass();
    const p = held.translation(), v = held.linvel();
    const K = 90, C = 9;
    held.resetForces(true);
    held.addForce({
      x: m * (K * (grabPoint.x - p.x) - C * v.x),
      y: m * (K * (grabPoint.y - p.y) - C * v.y),
      z: m * (K * (grabPoint.z - p.z) - C * v.z),
    }, true);
  }
  world.step();

  // 摆周期：只记 -→+ 同向过零，相邻两次间隔才是整周期
  const vx = pendBody.linvel().x;
  const sign = vx > 0 ? 1 : (vx < 0 ? -1 : pendCross.lastSign);
  if (pendCross.lastSign < 0 && sign > 0) {
    if (pendCross.prevT > 0) {
      pendCross.samples.push(simT - pendCross.prevT);
      if (pendCross.samples.length > 4) pendCross.samples.shift();
      pendCross.avg = pendCross.samples.reduce((a, b) => a + b, 0) / pendCross.samples.length;
    }
    pendCross.prevT = simT;
  }
  pendCross.lastSign = sign;
  simT += h;
}

// ============ 渲染循环 ============
const clock = new THREE.Clock();
const ropeDir = new THREE.Vector3(), ropeMid = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0), ropeQ = new THREE.Quaternion();
const pendAnchor = new THREE.Vector3(1.95, 2.35, -1.1);
function sync(rawDt) {
  ballMesh.position.copy(ballBody.translation());
  ballMesh.quaternion.copy(ballBody.rotation());
  for (const p of pairs) {
    p.mesh.position.copy(p.body.translation());
    p.mesh.quaternion.copy(p.body.rotation());
  }
  const pp = pendBody.translation();
  pendMesh.position.copy(pp);
  ropeDir.subVectors(pp, pendAnchor);
  const len = ropeDir.length();
  ropeMid.addVectors(pendAnchor, pp).multiplyScalar(0.5);
  ropeMesh.position.copy(ropeMid);
  ropeMesh.scale.set(1, len, 1);
  ropeQ.setFromUnitVectors(yAxis, ropeDir.normalize());
  ropeMesh.quaternion.copy(ropeQ);
  if (saturnSpin && rawDt > 0 && !paused) saturnSpin.rotation.y += 0.0025;
  if (stopperAnim >= 0 && rawDt > 0) {
    stopperAnim += rawDt;
    const k = Math.min(stopperAnim / 0.35, 1);
    stopperMesh.position.y = TRACK_META.slopeStopper[1] + 0.26 * k;
    if (k >= 1 && stopperCol !== null) {
      world.removeCollider(stopperCol, true);
      stopperCol = null;
    }
  }
}
function readouts() {
  const v = ballBody.linvel();
  const speed = Math.hypot(v.x, v.y, v.z);
  $('roT').textContent = simT.toFixed(2);
  $('roV').textContent = speed.toFixed(2);
  $('roH').textContent = Math.max(0, ballBody.translation().y - TRACK_META.ballRadius).toFixed(2);
  $('roX').textContent = ballBody.translation().x.toFixed(2);
  $('roP').textContent = pendCross.avg > 0 ? pendCross.avg.toFixed(2) : '--';
}
function tick() {
  requestAnimationFrame(tick);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  if (!ready || !renderer) return;
  const dt = rawDt * (paused ? 0 : timeScale);
  acc += dt;
  let n = 0;
  while (acc >= H && n < 10) { stepPhysics(H); acc -= H; n++; }
  sync(rawDt);
  roTimer += rawDt;
  if (roTimer > 0.1) { roTimer = 0; readouts(); }
  controls.update();
  if (composer) composer.render(); else renderer.render(scene, camera);
}
tick();

// 只读探针（后续自动化验收与 AI 接入用）
window.MECH = {
  get ready() { return ready; },
  ball: () => ({ pos: ballBody.translation(), vel: ballBody.linvel() }),
  time: () => simT,
};
