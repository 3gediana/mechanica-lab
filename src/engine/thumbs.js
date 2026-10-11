// thumbs.js — 组件目录缩略图（Goal 第六章目录「缩略图」条文）。
// 共享一个 72×72 离屏 WebGL 渲染器，按 registry 各组件的真实
// buildGeometry/makeMesh + 默认材质渲染小图；dataURL 按 typeId 缓存。
import * as THREE from 'three';

const FOV = 42; // 与主视口一致（MAT-78，值照抄 viewport.js）：缩略图与实机同 tone mapping/曝光/fov，目录不再"两张脸"

let renderer = null;
let scene = null;
let camera = null;
let M = null;
const cache = new Map();   // typeId → dataURL

function ensure(materials) {
  M = materials;
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(72, 72);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // MAT-78：主视口同款曲线（viewport.js:568）
  renderer.toneMappingExposure = 1.06;                 // 同曝光（viewport.js:569）
  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2.5, 3, 2.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd4ff, 0.5);
  rim.position.set(-2, 1, -2);
  scene.add(rim);
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 400);
}

export function renderThumb(comp, materials) {
  ensure(materials);
  if (cache.has(comp.id)) return cache.get(comp.id);
  const mat = M[comp.defaults?.render?.material] || M.chrome;
  let mesh = null;
  try {
    mesh = comp.makeMesh
      ? comp.makeMesh(comp.defaults.params, mat)
      : new THREE.Mesh(comp.buildGeometry(comp.defaults.params), mat);
  } catch (e) {
    cache.set(comp.id, null);          // 几何构建失败的类型不反复重试
    return null;
  }
  if (!mesh) { cache.set(comp.id, null); return null; }
  scene.add(mesh);
  const box = new THREE.Box3().setFromObject(mesh);
  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = (maxDim / 2) / Math.tan((FOV * Math.PI) / 360) * 1.2; // 与 camera fov 同源，改一处即可
    camera.position.set(center.x + dist * 0.75, center.y + dist * 0.6, center.z + dist);
    camera.lookAt(center);
    renderer.render(scene, camera);
    cache.set(comp.id, renderer.domElement.toDataURL('image/png'));
  } else {
    cache.set(comp.id, null);
  }
  scene.remove(mesh);
  return cache.get(comp.id);
}

// 环境贴图惰性加载（UI 审计 U2）：金属材质(metalness 1)无 envMap 只反射环境=纯黑——
// 目录里球/圆柱/传送带黑对黑的根因。主视口同款 HDRI 优先、RoomEnvironment 降级。
// 时序：首次 renderThumb 同步建渲染器后由 workbench 调本函数；环境就绪后清缓存并返回
// true，调用方重渲目录（材质预览同款「异步完成后就地补挂」套路）。
let envTried = false;
export async function preloadEnv(materials) {
  ensure(materials);
  if (envTried) return false;
  envTried = true;
  try {
    const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js');
    const tex = await new HDRLoader().loadAsync('./assets/hdri/studio_1k.hdr');
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = tex;
  } catch {
    try {
      const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    } catch (e2) {
      console.warn('[thumbs] 环境贴图缺失，金属件缩略图降级为灯光照明', e2);
      return false;
    }
  }
  scene.environmentIntensity = 0.7;
  cache.clear();
  return true;
}
