// registry.js — 组件注册表：每种场景对象 = 几何构建 + 碰撞构建 + 参数 schema + 默认物理
// 新增对象类型只需在此登记，不写独立逻辑；schema 驱动检查器 UI 与校验。
import * as THREE from 'three';
import { newId } from './scene-doc.js';
import { TRACK_POINTS, TRACK_META } from '../track-curve.js';
import { getSharedMaterials } from '../materials.js'; // celestial 环复用 saturnRing（MAT-68）

// ---------- 轨道：半管参数面（经典管道轨道，球经中心线解析约束滑行，Goal 第二节组件化迁移） ----------
function buildTroughGeometry(arcFraction, along, radial) {
  const pts = TRACK_POINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = lens[lens.length - 1];
  const up = new THREE.Vector3(0, 1, 0);
  const B = new THREE.Vector3(0, 0, 1);
  const openHalf = Math.PI * (1 - arcFraction) / 2;
  const pos = [], nor = [], uv = [], idx = [];
  const N = new THREE.Vector3(), P = new THREE.Vector3(), T = new THREE.Vector3(), D = new THREE.Vector3();
  for (let i = 0; i <= along; i++) {
    const d = (i / along) * total;
    let k = 1;
    while (k < lens.length - 1 && lens[k] < d) k++;
    const seg = (lens[k] - lens[k - 1]) || 1;
    P.copy(pts[k - 1]).lerp(pts[k], Math.min(Math.max((d - lens[k - 1]) / seg, 0), 1));
    T.copy(pts[k]).sub(pts[k - 1]).normalize();
    N.set(-T.y, T.x, 0).normalize();
    const phiUp = Math.atan2(up.dot(B), up.dot(N));
    for (let j = 0; j <= radial; j++) {
      const phi = phiUp + openHalf + (j / radial) * (2 * Math.PI - 2 * openHalf);
      D.copy(N).multiplyScalar(Math.cos(phi)).addScaledVector(B, Math.sin(phi));
      pos.push(P.x + D.x * TRACK_META.tubeRadius, P.y + D.y * TRACK_META.tubeRadius, P.z + D.z * TRACK_META.tubeRadius);
      nor.push(-D.x, -D.y, -D.z);
      uv.push((i / along) * 6, j / radial);
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

// 实体可用材质（键与 materials.js 返回对象一致）
export const MATERIAL_OPTIONS = [
  { key: 'marble', label: '大理石' },
  { key: 'wood', label: '橡木' },
  { key: 'chrome', label: '铬钢' },
  { key: 'steelDark', label: '暗钢' },
  { key: 'rubber', label: '橡胶' },
  { key: 'mattePlastic', label: '哑光塑料' }, // MAT-75
  { key: 'chalk', label: '粉笔' },            // MAT-75
  { key: 'brass', label: '黄铜' },
  { key: 'ice', label: '冰' },                // U-MAT：近无摩擦低弹（高速滑行/冰面斜面题型）
  { key: 'sun', label: '恒星' },
  { key: 'saturn', label: '土星' },
  { key: 'jupiter', label: '木星' },          // MAT-67
  { key: 'mars', label: '火星' },             // MAT-67
];

// U-MAT：材质→物理预设（摩擦系数 μ / 恢复系数 e / 密度 ρ kg/m³）——教学惯例+常见实测档位。
// 换材质自动套用：视觉材质与物理行为同源（用户点单「材质要影响物体的表现」）；
// 预设是起点不是锁——文档只存 μ/e/mass，套用后仍可逐项手改
export const MAT_PHYS = {
  chrome: { mu: 0.25, e: 0.60, rho: 7800 },    // 铬钢
  steelDark: { mu: 0.30, e: 0.50, rho: 7850 }, // 暗钢
  wood: { mu: 0.45, e: 0.35, rho: 600 },       // 橡木
  rubber: { mu: 0.90, e: 0.85, rho: 1100 },    // 橡胶
  marble: { mu: 0.40, e: 0.55, rho: 2700 },    // 大理石
  mattePlastic: { mu: 0.40, e: 0.40, rho: 1150 },
  chalk: { mu: 0.60, e: 0.20, rho: 2200 },
  brass: { mu: 0.30, e: 0.50, rho: 8500 },
  ice: { mu: 0.03, e: 0.10, rho: 917 },
};

// U-MAT：标准几何体按参数求体积（m³），供换材质按 ρV 重算质量；非标准形状返回 null（只套 μ/e）
export function volumeOf(typeId, params) {
  const p = params || {};
  if (typeId === 'sphere') return (4 / 3) * Math.PI * Math.pow(p.radius ?? 0.15, 3);
  if (typeId === 'box') return (p.sx ?? 0.3) * (p.sy ?? 0.3) * (p.sz ?? 0.3);
  if (typeId === 'cylinder') return Math.PI * Math.pow(p.radius ?? 0.12, 2) * (p.height ?? 0.3);
  return null;
}

export const BODY_OPTIONS = [
  { key: 'dynamic', label: '动态' },
  { key: 'fixed', label: '固定' },
  { key: 'none', label: '仅视觉' },
];

function defaultPhysics(body, mass) {
  return {
    body,
    mass,                                   // kg（dynamic 有效）
    friction: 0.4,
    restitution: 0.2,
    linvel: [0, 0, 0],                      // m/s，reset 时注入
    angvel: [0, 0, 0],                      // rad/s
    linDamping: 0.05,
    angDamping: 0.05,
    gravityScale: 1,
  };
}

// ---------- 斜坡：三角棱柱（高墙在 -x，坡面向 +x 下落） ----------
function wedgeGeometry(L, H, W) {
  const shape = new THREE.Shape();
  shape.moveTo(-L / 2, 0);
  shape.lineTo(L / 2, 0);
  shape.lineTo(-L / 2, H);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
  g.translate(0, 0, -W / 2);
  return g;
}
function wedgePoints(L, H, W) {
  return new Float32Array([
    -L / 2, 0, -W / 2, L / 2, 0, -W / 2, -L / 2, H, -W / 2,
    -L / 2, 0, W / 2, L / 2, 0, W / 2, -L / 2, H, W / 2,
  ]);
}

// ---------- 曲面族（B5/MOD-581~583）：接触式曲面——真实法向力（凹面压紧/凸面可脱离），
// 与 track 的中心线解析约束互补。渲染 BufferGeometry 与 Rapier trimesh 碰撞体由同一份
// 网格数据生成（几何/物理永不两张皮），computeVertexNormals 沿曲线平滑着色。 ----------

// 幂律剖面 y=H·(1-u)^p：p=1 直楔（同斜坡）、p>1 凹面（底端渐平，N>mg·cosθ）、
// p<1 凸面（拱顶，v²>g/κ 时脱离——脱离临界本身是教学点）
function curvedProfile(L, H, p, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    pts.push([-L / 2 + u * L, H * Math.pow(1 - u, p)]);
  }
  return pts;
}

// 曲面坡道网格：顶面条带（共享顶点→沿曲线平滑着色）+ 两侧壁 + 底面（顶点复制→边缘锐利）
function curvedMeshData(L, H, W, p, SEG = 16) {
  const prof = curvedProfile(L, H, p, SEG);
  const n = prof.length;
  const verts = [];
  const idx = [];
  for (let i = 0; i < n; i++) verts.push(prof[i][0], prof[i][1], -W / 2, prof[i][0], prof[i][1], W / 2);
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    idx.push(a, b, d, a, d, c);                   // 朝 +y（下降坡法线偏 +x）
  }
  // 两侧壁：竖直面从 y=0 到剖面线；顶端首段即后墙（同楔体高墙）
  let wb = verts.length / 3;
  for (let i = 0; i < n; i++) verts.push(prof[i][0], prof[i][1], -W / 2, prof[i][0], 0, -W / 2);
  for (let i = 0; i < n - 1; i++) {
    if (prof[i][1] < 1e-5 && prof[i + 1][1] < 1e-5) continue;   // 底端零面积段（退化=求解器毒药）
    const t0 = wb + i * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
    idx.push(b0, t0, t1, b0, t1, b1);             // 朝 −z
  }
  wb = verts.length / 3;
  for (let i = 0; i < n; i++) verts.push(prof[i][0], prof[i][1], W / 2, prof[i][0], 0, W / 2);
  for (let i = 0; i < n - 1; i++) {
    if (prof[i][1] < 1e-5 && prof[i + 1][1] < 1e-5) continue;
    const t0 = wb + i * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
    idx.push(t0, b0, b1, t0, b1, t1);             // 朝 +z（镜像绕向）
  }
  const bb = verts.length / 3;
  verts.push(-L / 2, 0, -W / 2, L / 2, 0, -W / 2, -L / 2, 0, W / 2, L / 2, 0, W / 2);
  idx.push(bb, bb + 1, bb + 3, bb, bb + 3, bb + 2);   // 朝 −y
  return { verts: new Float32Array(verts), idx: new Uint32Array(idx) };
}

// 球冠碗面：碗底 y=0、碗缘 y=D（几何恒等式 Rs=(R²+D²)/2D）；内表面朝腔内上方，
// 小球微幅震荡等效摆长 Rs−r → T≈2π√((Rs−r)/g)，曲面版单摆
function bowlMeshData(R, D, K = 28, M = 7) {
  D = Math.min(D, R * 0.88);                      // 球冠深度上限≈赤道（D>R 无解，钳制）
  const Rs = (R * R + D * D) / (2 * D);
  const phiRim = Math.asin(Math.min(1, R / Rs));
  const verts = [];
  for (let j = 0; j < M; j++) {                   // M 环带（不生成顶点环）+ 1 个顶点扇心
    const phi = phiRim * (1 - j / M);
    const rr = Rs * Math.sin(phi), y = Rs * (1 - Math.cos(phi));
    for (let k = 0; k < K; k++) {
      const th = (k / K) * Math.PI * 2;
      verts.push(rr * Math.cos(th), y, rr * Math.sin(th));
    }
  }
  const apex = verts.length / 3;                  // 碗底单顶点（y=0）：退化三角形是求解器毒药
  verts.push(0, 0, 0);
  const idx = [];
  for (let j = 0; j < M - 1; j++) {
    for (let k = 0; k < K; k++) {
      const k1 = (k + 1) % K;
      const a = j * K + k, b = (j + 1) * K + k, c = (j + 1) * K + k1, d = j * K + k1;
      idx.push(a, b, c, a, c, d);                 // 内表面法线朝腔内（j+1 环更矮更靠轴）
    }
  }
  for (let k = 0; k < K; k++) {                   // 底扇：环 M-1 → 顶点（绕向同带面，B5 推导）
    const k1 = (k + 1) % K;
    const a = (M - 1) * K + k, d = (M - 1) * K + k1;
    idx.push(a, apex, d);
  }
  return { verts: new Float32Array(verts), idx: new Uint32Array(idx), Rs };
}

// 波浪路面：双频正弦叠加（纵向主波 × 横向 0.7 倍频相位差调制）——单一波纹是圆柱滚筒，
// 叠加才有「不规则地形」感；最大坡度≈atan(2π·波幅/波长·1.35)
function waveFloorMeshData(sx, sz, lambda, amp, NX = 96, NZ = 16) {
  const sy = 0.12;
  const hAt = (x, z) => amp * Math.sin((x / lambda) * Math.PI * 2)
    * (1 + 0.35 * Math.sin((z / (lambda * 0.7)) * Math.PI * 2 + 1.3));
  const verts = [];
  for (let i = 0; i <= NX; i++) {
    const x = -sx / 2 + (i / NX) * sx;
    for (let k = 0; k <= NZ; k++) {
      const z = -sz / 2 + (k / NZ) * sz;
      verts.push(x, hAt(x, z), z);
    }
  }
  const idx = [];
  const gid = (i, k) => i * (NZ + 1) + k;
  for (let i = 0; i < NX; i++) {
    for (let k = 0; k < NZ; k++) {
      const a = gid(i, k), b = gid(i, k + 1), c = gid(i + 1, k + 1), d = gid(i + 1, k);
      idx.push(a, b, c, a, c, d);                 // 朝 +y
    }
  }
  // 四侧裙边（顶缘 → y=−sy 底缘，顶点复制保顶缘法线 crisp）；绕向按各边朝向推导
  const edges = [
    { along: 'x', fixed: 0, dir: 1 },             // z=−sz/2 → 朝 −z
    { along: 'x', fixed: NZ, dir: -1 },           // z=+sz/2 → 朝 +z
    { along: 'z', fixed: 0, dir: -1 },            // x=−sx/2 → 朝 −x
    { along: 'z', fixed: NX, dir: 1 },            // x=+sx/2 → 朝 +x
  ];
  for (const e of edges) {
    const n = e.along === 'x' ? NX + 1 : NZ + 1;
    const base = verts.length / 3;
    for (let t = 0; t < n; t++) {
      let x, z;
      if (e.along === 'x') { x = -sx / 2 + (t / NX) * sx; z = -sz / 2 + (e.fixed / NZ) * sz; }
      else { x = -sx / 2 + (e.fixed / NX) * sx; z = -sz / 2 + (t / NZ) * sz; }
      verts.push(x, hAt(x, z), z, x, -sy, z);
    }
    for (let t = 0; t < n - 1; t++) {
      const t0 = base + t * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
      if (e.dir > 0) idx.push(b0, t0, t1, b0, t1, b1);
      else idx.push(t0, b0, b1, t0, b1, t1);
    }
  }
  const bb = verts.length / 3;
  verts.push(-sx / 2, -sy, -sz / 2, sx / 2, -sy, -sz / 2, -sx / 2, -sy, sz / 2, sx / 2, -sy, sz / 2);
  idx.push(bb, bb + 1, bb + 3, bb, bb + 3, bb + 2);
  return { verts: new Float32Array(verts), idx: new Uint32Array(idx) };
}


// 共享视觉件材质（MAT-2/3/4 + PER-42）：辐条/旗面/灯泡此前每实例每 rebuild 各 new 一份
// （12 辐条转台=12 个材质），既费重建又泄漏 dispose 面——模块级共享，永不单独 dispose
const SPOKE_MAT = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.6, metalness: 0.1 });
const FLAG_MAT = new THREE.MeshStandardMaterial({ color: 0xc96a5a, roughness: 0.5 });
const BULB_MAT = new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffc880, emissiveIntensity: 0.9, roughness: 0.4 });

// ---------- 传送带：带面人字纹（RUN-2 运动方向可见性） ----------
// 基底 128×64 暗胶面 + 琥珀人字纹（指向 +x 输运方向，应用主题强调色——远距离也可读）；
// RepeatWrapping 沿 x 平铺，runtime 每步按带速滚动 offset（带停纹停，速度方向一眼可读）。
// 克隆共享底图，offset 独立。
let _beltTexBase = null;
function beltTexture() {
  if (!_beltTexBase) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#1c1d20';
    g.fillRect(0, 0, 128, 64);
    g.strokeStyle = '#c99b4a';
    g.lineWidth = 7;
    g.lineCap = 'round';
    for (const cx of [24, 88]) {   // 人字纹：两道折线指向 +x（输运方向）
      g.beginPath();
      g.moveTo(cx - 10, 12); g.lineTo(cx + 8, 32); g.lineTo(cx - 10, 52);
      g.stroke();
    }
    _beltTexBase = new THREE.CanvasTexture(c);
    _beltTexBase.wrapS = _beltTexBase.wrapT = THREE.RepeatWrapping;
    _beltTexBase.colorSpace = THREE.SRGBColorSpace;
  }
  const tex = _beltTexBase.clone();
  tex.needsUpdate = true;
  return tex;
}

// 传送带侧导轨共享材质（机器感：暗钢栏架勾出带的体量轮廓）
const BELT_RAIL_MAT = new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.45, metalness: 0.7 });
// MAT-90：灯泡按亮度三档预建共享 clone（暗 <2 / 中 2~8 / 亮 >8，emissive 0.35/0.9/1.6），
// lightGroup 构造时按 params.intensity 选挂 —— 仍为模块级共享，不回到每实例一份
const BULB_MAT_DIM = BULB_MAT.clone();
BULB_MAT_DIM.emissiveIntensity = 0.35;   // 暗档：余温微光
const BULB_MAT_BRIGHT = BULB_MAT.clone();
BULB_MAT_BRIGHT.emissiveIntensity = 1.6; // 亮档：灼目高亮
function bulbMatFor(intensity) {
  if (intensity < 2) return BULB_MAT_DIM;
  if (intensity > 8) return BULB_MAT_BRIGHT;
  return BULB_MAT; // 中档即原共享实例（0.9）
}

export const COMPONENTS = {
  sphere: {
    id: 'sphere', label: '球', category: '基础物体',
    desc: '均质球体，可滚动、碰撞、弹跳',
    compat: '自由刚体，可设初速度/角速度；支持滚阻(rollResist)；可被绳/弹簧连接',
    defaults: { params: { radius: 0.15 }, physics: defaultPhysics('dynamic', 1), render: { material: 'chrome' } },
    schema: [
      { key: 'radius', label: '半径', unit: 'm', min: 0.01, max: 2, step: 0.01 },
      { key: 'rollResist', label: '滚动阻力', unit: '', min: 0, max: 0.2, step: 0.005 },
    ],
    buildGeometry: (p) => new THREE.SphereGeometry(p.radius, 40, 28),
    buildCollider: (RAPIER, p) => RAPIER.ColliderDesc.ball(p.radius),
    spawnY: (p) => p.radius,
    inertiaY: (p, m) => 0.4 * m * p.radius * p.radius,
  },

  box: {
    id: 'box', label: '方块', category: '基础物体',
    desc: '长方体，可滑动、倾翻、堆叠',
    compat: '固定或动态块体；可作斜面台座；可被绳/弹簧连接',
    defaults: { params: { sx: 0.3, sy: 0.3, sz: 0.3 }, physics: defaultPhysics('dynamic', 2), render: { material: 'wood' } },
    schema: [
      { key: 'sx', label: '长', unit: 'm', min: 0.02, max: 10, step: 0.01 },
      { key: 'sy', label: '高', unit: 'm', min: 0.02, max: 10, step: 0.01 },
      { key: 'sz', label: '宽', unit: 'm', min: 0.02, max: 10, step: 0.01 },
    ],
    buildGeometry: (p) => new THREE.BoxGeometry(p.sx, p.sy, p.sz),
    buildCollider: (RAPIER, p) => RAPIER.ColliderDesc.cuboid(p.sx / 2, p.sy / 2, p.sz / 2),
    spawnY: (p) => p.sy / 2,
    inertiaY: (p, m) => m * (p.sx * p.sx + p.sz * p.sz) / 12,
  },

  cylinder: {
    id: 'cylinder', label: '圆柱', category: '基础物体',
    desc: '直立圆柱，可滚动（放倒时）、碰撞；spokes>0 时带辐条（转台演示，转动可见）',
    compat: '可滚动/绕轴转（转台用 spokes 可视化）；支持 spinLock 理想轴承',
    defaults: { params: { radius: 0.12, height: 0.3, spokes: 0 }, physics: defaultPhysics('dynamic', 1.5), render: { material: 'brass' } },
    schema: [
      { key: 'radius', label: '半径', unit: 'm', min: 0.01, max: 2, step: 0.01 },
      { key: 'height', label: '高', unit: 'm', min: 0.02, max: 8, step: 0.01 },
      { key: 'spokes', label: '辐条数', unit: '', min: 0, max: 12, step: 1 },
    ],
    buildGeometry: (p) => new THREE.CylinderGeometry(p.radius, p.radius, p.height, 32),
    // spokes>0 返回 Group：盘 + 顶面辐条（转动可视化；rotation 模式与转台演示用）
    makeMesh: (p, material) => {
      const disk = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius, p.height, 32), material);
      if (!p.spokes) return disk;
      const g = new THREE.Group();
      g.add(disk);
      for (let i = 0; i < p.spokes; i++) {
        const spoke = new THREE.Mesh(
          new THREE.BoxGeometry(p.radius * 2, 0.015, 0.035),
          SPOKE_MAT
        );
        spoke.position.y = p.height / 2 + 0.008;
        spoke.rotation.y = (i / p.spokes) * Math.PI;   // 每根辐条是一条直径
        g.add(spoke);
      }
      return g;
    },
    buildCollider: (RAPIER, p) => RAPIER.ColliderDesc.cylinder(p.height / 2, p.radius),
    spawnY: (p) => p.height / 2,
    inertiaY: (p, m) => 0.5 * m * p.radius * p.radius,        // 绕主轴
  },

  ramp: {
    id: 'ramp', label: '斜坡', category: '表面与结构',
    desc: '三角棱柱斜面，固定后供物体下滑（默认固定）',
    compat: '默认固定斜面；与球/块摩擦成对生效（取 min）',
    defaults: { params: { length: 1.6, height: 0.8, width: 0.5 }, physics: defaultPhysics('fixed', 0), render: { material: 'marble' } },
    schema: [
      { key: 'length', label: '坡长', unit: 'm', min: 0.1, max: 12, step: 0.05 },
      { key: 'height', label: '坡高', unit: 'm', min: 0.02, max: 6, step: 0.05 },
      { key: 'width', label: '坡宽', unit: 'm', min: 0.05, max: 6, step: 0.05 },
      { key: 'angle', label: '倾角', unit: '°', kind: 'rampAngle', min: 1, max: 80, step: 1 },
    ],
    buildGeometry: (p) => wedgeGeometry(p.length, p.height, p.width),
    buildCollider: (RAPIER, p) => RAPIER.ColliderDesc.convexHull(wedgePoints(p.length, p.height, p.width)),
    spawnY: () => 0.02, // 楔体局部原点在底面（y∈[0,H]），贴地即可
    computed: (p) => [{ key: 'angleDeg', label: '当前倾角', value: +(Math.atan2(p.height, p.length) * 180 / Math.PI).toFixed(1), unit: '°' }],
    // 编辑倾角 → 反推坡高（坡长不变）
    applySpecial: (params, key, value) => {
      if (key === 'angle') {
        params.height = +(Math.tan(value * Math.PI / 180) * params.length).toFixed(4);
        return true;
      }
      return false;
    },
  },

  ground: {
    id: 'ground', label: '地面板', category: '表面与结构',
    desc: '大平面承接板（默认固定），供物体落上反弹滑动',
    compat: '大承接板（固定）；与所有动态体碰撞',
    defaults: { params: { sx: 12, sy: 0.1, sz: 12 }, physics: { ...defaultPhysics('fixed', 0), friction: 0.6, restitution: 0.3 }, render: { material: 'floor' } },
    schema: [
      { key: 'sx', label: '长', unit: 'm', min: 0.5, max: 60, step: 0.5 },
      { key: 'sy', label: '厚', unit: 'm', min: 0.02, max: 2, step: 0.02 },
      { key: 'sz', label: '宽', unit: 'm', min: 0.5, max: 60, step: 0.5 },
    ],
    buildGeometry: (p) => new THREE.BoxGeometry(p.sx, p.sy, p.sz),
    buildCollider: (RAPIER, p) => RAPIER.ColliderDesc.cuboid(p.sx / 2, p.sy / 2, p.sz / 2),
    spawnY: (p) => p.sy / 2,
    inertiaY: (p, m) => m * (p.sx * p.sx + p.sz * p.sz) / 12,
  },

  tank: {
    id: 'tank', label: '水槽', category: '表面与结构',
    desc: '透明水槽（固定容器+水体）：物体入水受浮力 F=ρ液·g·V排，沉浮自判——球用精确球缺（漂浮液面定量可信），其余按包围盒近似（旋转偏乐观）；液体密度可调（盐水≈1030）',
    compat: '固定水槽；开放顶部，物体从上方入水；四壁+底为玻璃碰撞体',
    defaults: { params: { sx: 3, sy: 1.2, sz: 1.6, density: 1000 }, physics: { ...defaultPhysics('fixed', 0), friction: 0.4, restitution: 0.05 }, render: { material: 'glass' } },
    schema: [
      { key: 'sx', label: '槽长', unit: 'm', min: 0.6, max: 12, step: 0.1 },
      { key: 'sy', label: '水深', unit: 'm', min: 0.2, max: 4, step: 0.05 },
      { key: 'sz', label: '槽宽', unit: 'm', min: 0.4, max: 8, step: 0.1 },
      { key: 'density', label: '液体密度', unit: 'kg/m³', min: 500, max: 3000, step: 10 },
    ],
    buildGeometry: (p) => new THREE.BoxGeometry(p.sx, p.sy, p.sz), // ghost/包围占位
    // 底板（厚 6cm 实体，沉底物体的承托面）——主体碰撞体；四壁走 buildExtraColliders
    buildCollider: (RAPIER, p) => RAPIER.ColliderDesc.cuboid(p.sx / 2, 0.03, p.sz / 2)
      .setTranslation(0, -(p.sy / 2 - 0.03), 0),
    // 玻璃四壁（同一 fixed 刚体的附加碰撞体，runtime 通用支持）：壁厚 2cm、通高
    buildExtraColliders: (RAPIER, p) => {
      const t = 0.02;
      return [
        RAPIER.ColliderDesc.cuboid(t / 2, p.sy / 2, p.sz / 2 + t).setTranslation(p.sx / 2 - t / 2, 0, 0),
        RAPIER.ColliderDesc.cuboid(t / 2, p.sy / 2, p.sz / 2 + t).setTranslation(-(p.sx / 2 - t / 2), 0, 0),
        RAPIER.ColliderDesc.cuboid(p.sx / 2, p.sy / 2, t / 2).setTranslation(0, 0, p.sz / 2 - t / 2),
        RAPIER.ColliderDesc.cuboid(p.sx / 2, p.sy / 2, t / 2).setTranslation(0, 0, -(p.sz / 2 - t / 2)),
      ];
    },
    spawnY: (p) => p.sy / 2,
    // 玻璃壁+底（glass）与水体（water，水面留 5mm）——透明件 depthWrite 已关
    makeMesh: (p, material) => {
      const M = getSharedMaterials() || {};
      const g = new THREE.Group();
      const t = 0.02, bot = 0.06;
      const put = (geo, mat, x, y, z, order) => {
        const m = new THREE.Mesh(geo, mat || material);
        m.position.set(x, y, z);
        m.renderOrder = order;
        m.receiveShadow = true;
        g.add(m);
        return m;
      };
      if (M.glass) {
        put(new THREE.BoxGeometry(p.sx, bot, p.sz), M.glass, 0, -(p.sy / 2 - bot / 2), 0, 3);
        put(new THREE.BoxGeometry(t, p.sy, p.sz + 2 * t), M.glass, p.sx / 2 - t / 2, 0, 0, 3);
        put(new THREE.BoxGeometry(t, p.sy, p.sz + 2 * t), M.glass, -(p.sx / 2 - t / 2), 0, 0, 3);
        put(new THREE.BoxGeometry(p.sx + 2 * t, p.sy, t), M.glass, 0, 0, p.sz / 2 - t / 2, 3);
        put(new THREE.BoxGeometry(p.sx + 2 * t, p.sy, t), M.glass, 0, 0, -(p.sz / 2 - t / 2), 3);
      }
      if (M.water) {
        const hw = Math.max(0.05, p.sy - bot - 0.005);
        put(new THREE.BoxGeometry(Math.max(0.05, p.sx - 2 * t), hw, Math.max(0.05, p.sz - 2 * t)),
          M.water, 0, -(p.sy / 2) + bot + hw / 2, 0, 2);
      }
      return g;
    },
    computed: (p) => [{ key: 'rho', label: '液体密度', value: p.density, unit: 'kg/m³' }],
  },

  conveyor: {
    id: 'conveyor', label: '传送带', category: '表面与结构',
    desc: '水平传送带（固定）：带面以给定速度持续输运其上的物体——「轻放上去先滑动后共速」的经典模型',
    compat: '固定带体；带面切向物理由带速驱动模型接管（a=μg 滑动→共速，教科书口径），带面人字纹随带速滚动',
    // params.speed 带速 m/s（+x 方向为正，负值反向输运）；params.friction 在此语义=带面动摩擦因数 μ
    defaults: { params: { sx: 2.4, sy: 0.16, sz: 0.6, speed: 0.8 }, physics: { ...defaultPhysics('fixed', 0), friction: 0.2, restitution: 0 }, render: { material: 'rubber' } },
    schema: [
      { key: 'sx', label: '带长', unit: 'm', min: 0.5, max: 20, step: 0.1 },
      { key: 'sy', label: '带厚', unit: 'm', min: 0.05, max: 2, step: 0.01 },
      { key: 'sz', label: '带宽', unit: 'm', min: 0.1, max: 6, step: 0.05 },
      { key: 'speed', label: '带速', unit: 'm/s', min: -8, max: 8, step: 0.1 },
    ],
    buildGeometry: (p) => new THREE.BoxGeometry(p.sx, p.sy, p.sz),
    // 带面切向摩擦必须归零（Min 合成规则：min(带 0, 物 μ) = 0）——带对物的切向作用完全交给
    // runtime 的带速驱动模型（a=μg），否则 Rapier 静摩擦会把共速物体按「带其实没动」拖停
    buildCollider: (RAPIER, p) => RAPIER.ColliderDesc.cuboid(p.sx / 2, p.sy / 2, p.sz / 2)
      .setFriction(0)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
    spawnY: (p) => p.sy / 2,
    // 带体基座 + 顶面人字纹带（随带速滚动的运动方向可见性）+ 两侧钢导轨（机器轮廓）；
    // beltScroll 由 runtime 每步消费
    makeMesh: (p, material) => {
      const base = new THREE.Mesh(new THREE.BoxGeometry(p.sx, p.sy - 0.012, p.sz), material);
      const tex = beltTexture();
      const repX = Math.max(2, Math.round(p.sx / 0.3));   // 人字纹每 30cm 一组
      tex.repeat.set(repX, 1);
      const top = new THREE.Mesh(
        new THREE.PlaneGeometry(p.sx, p.sz),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 })
      );
      top.rotation.x = -Math.PI / 2;
      top.position.y = p.sy / 2 - 0.006;
      const railH = Math.min(0.06, p.sy * 0.5);
      const railGeo = new THREE.BoxGeometry(p.sx + 0.04, railH, 0.035);
      const railN = new THREE.Mesh(railGeo, BELT_RAIL_MAT); railN.position.set(0, p.sy / 2, p.sz / 2 + 0.0175);
      const railS = new THREE.Mesh(railGeo, BELT_RAIL_MAT); railS.position.set(0, p.sy / 2, -p.sz / 2 - 0.0175);
      const g = new THREE.Group();
      g.add(base, top, railN, railS);
      g.userData.beltScroll = { tex, unitPerMeter: repX / p.sx };   // offset 增量 = v·dt·unitPerMeter
      return g;
    },
    computed: (p) => [{ key: 'dir', label: '输运方向', value: p.speed > 0 ? '+x' : (p.speed < 0 ? '-x' : '停止'), unit: '' }],
  },

  hinge: {
    id: 'hinge', label: '铰链', category: '绳和约束',
    desc: '连接两实体的转轴关节（绕轴相对转动）；选中基座与摆臂后添加，铰链位置吸附到臂端',
    compat: '需选两个实体：固定锚点+摆杆（revolute 转轴）',
    defaults: { params: { }, physics: defaultPhysics('fixed', 0), render: { material: 'brass' } },
    schema: [],
    buildGeometry: () => new THREE.CylinderGeometry(0.035, 0.035, 0.16, 16),   // 轴柱视觉，置于锚点
    buildCollider: () => null,
    isLink: true,
    linkStatic: true,                              // 轴柱固定在锚点位置（不随两端拉伸）
    spawnY: () => 2.0,
  },

  pulley: {
    id: 'pulley', label: '定滑轮', category: '绳和约束',
    desc: '定滑轮（固定轴承）：跨绳两侧挂 onPulley 小球可演示阿特伍德机张力与加速度',
    compat: '定滑轮（固定、无碰撞体）；配合 onPulley 两球做阿特伍德',
    defaults: { params: { radius: 0.3 }, physics: defaultPhysics('fixed', 0), render: { material: 'brass' } },
    schema: [
      { key: 'radius', label: '半径', unit: 'm', min: 0.1, max: 1.5, step: 0.05 },
    ],
    buildGeometry: (p) => new THREE.CylinderGeometry(p.radius, p.radius, 0.08, 32),
    // R6-036：轮面必须朝 z（跨绳在 XY 竖直平面）——裸 CylinderGeometry 轴沿 Y，渲染成
    // 水平躺平的圆盘（用户实锤「整个场景就一块圆盘」），跨绳绳段/半弧与轮缘全对不上
    makeMesh: (p, material) => {
      const g = new THREE.Group();
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius, 0.08, 32), material);
      wheel.rotation.x = Math.PI / 2;
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 12), material);
      axle.rotation.x = Math.PI / 2;
      g.add(wheel, axle);
      return g;
    },
    buildCollider: () => null,   // 轮体无碰撞：跨绳球走 onPulley 导轨约束（碰撞体会挡住上升侧）
    spawnY: () => 3.0,
  },

  rope: {
    id: 'rope', label: '绳', category: '绳和约束',
    desc: '连接两个实体的轻绳（仅拉不推）；先选中两个实体再点目录添加，或由解析自动连接',
    compat: '需先选两个实体：按当前距离定长（超长张紧）',
    defaults: { params: { length: 0 }, physics: defaultPhysics('fixed', 0), render: { material: 'rope' } },
    schema: [
      { key: 'length', label: '绳长', unit: 'm', min: 0.05, max: 20, step: 0.05 },
    ],
    buildGeometry: () => new THREE.CylinderGeometry(0.008, 0.008, 1, 12),  // 单位杆；径向 12 段（MAT-76）斜视轮廓更圆
    // 8 段组网格（AG-V2）：runtime _syncRope 逐段摆放——slack 悬链弧、出生跳动、摆动可见
    makeMesh: (p, material) => {
      const g = new THREE.Group();
      const segGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 10);
      for (let i = 0; i < 8; i++) {
        const seg = new THREE.Mesh(segGeo, material);
        seg.position.set(0, 1 - (i + 0.5) / 8, 0);   // 初始沿 Y 单位高直排（缩略图/首帧不是一坨）
        g.add(seg);
      }
      return g;
    },
    buildCollider: () => null,
    isLink: true,                                  // 连接类：无独立 body，runtime 建绳关节并每帧同步网格
    spawnY: () => 0.5,
  },

  spring: {
    id: 'spring', label: '弹簧', category: '绳和约束',
    desc: '连接两个实体的线性弹簧（胡克定律 F=-k·Δx）；可演示简谐振动',
    compat: '需先选两个实体：胡克定律 F=-k·Δx，可设原长/阻尼',
    defaults: { params: { stiffness: 20, restLength: 0.8, damping: 0.5 }, physics: defaultPhysics('fixed', 0), render: { material: 'brass' } },
    schema: [
      { key: 'stiffness', label: '劲度系数', unit: 'N/m', min: 0.5, max: 5000, step: 0.5 },
      { key: 'restLength', label: '原长', unit: 'm', min: 0.1, max: 10, step: 0.05 },
      { key: 'damping', label: '阻尼', unit: '', min: 0, max: 50, step: 0.1 },
    ],
    // 螺旋线圈（AG-V2）：单位高 7 圈管体，runtime 按端距 scale.y 拉伸——
    // 弹簧拉开时圈距变疏（正确的视觉语义），不再是直挺挺一根杆
    buildGeometry: (() => {
      let coil = null;
      return () => {
        if (coil) return coil;
        const pts = [];
        const coils = 7, N = 150;
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          const a = t * coils * 2 * Math.PI;
          pts.push(new THREE.Vector3(Math.cos(a) * 0.034, t, Math.sin(a) * 0.034));
        }
        coil = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 170, 0.0075, 8, false);
        coil.translate(0, -0.5, 0);   // B1 用户实锤：螺旋 y 跨 [0,1] 未居中，_syncLinks 按中点+居中
                                      // 假设摆放→每根弹簧渲染整体偏移半长（端点够不到球/飘出球）。
                                      // 平移到 [-0.5,0.5] 后端点=两侧实体中心，与同步语义一致。
        return coil;
      };
    })(),
    buildCollider: () => null,
    isLink: true,
    spawnY: () => 0.5,
  },

  track: {
    id: 'track', label: '管道轨道', category: '轨道和曲面',
    desc: '半管滑道+竖直环轨（中心线解析约束，光滑无摩擦；球体设 onTrack 沿轨滑行）',
    compat: '固定滑道；球设 onTrack 沿中心线滑行（光滑）',
    defaults: { params: { arcFraction: 0.61 }, physics: defaultPhysics('fixed', 0), render: { material: 'marble' } },
    schema: [
      { key: 'arcFraction', label: '开口比', unit: '', min: 0.3, max: 0.9, step: 0.01 },
    ],
    buildGeometry: (p) => buildTroughGeometry(p.arcFraction, 620, 48),
    buildCollider: () => null,                     // 球走中心线解析约束，轨道自身无碰撞体
    spawnY: () => 0.02,
  },

  curvedRamp: {
    id: 'curvedRamp', label: '曲面坡道', category: '轨道和曲面',
    desc: '幂律曲面滑道（曲率指数>1 凹面底端渐平 / <1 凸面拱顶可脱离），接触式真实法向力',
    compat: '固定滑道；与球/块真实接触（凹面压紧、凸面足够快会脱离）；摩擦成对生效（取 min）',
    defaults: { params: { length: 2.4, height: 1.0, width: 0.5, curveExp: 1.4 }, physics: { ...defaultPhysics('fixed', 0), friction: 0.3, restitution: 0.05 }, render: { material: 'marble' } },
    schema: [
      { key: 'length', label: '底边长', unit: 'm', min: 0.3, max: 12, step: 0.05 },
      { key: 'height', label: '落差', unit: 'm', min: 0.05, max: 6, step: 0.05 },
      { key: 'width', label: '宽', unit: 'm', min: 0.1, max: 6, step: 0.05 },
      { key: 'curveExp', label: '曲率指数', unit: '', min: 0.3, max: 3, step: 0.05 },
    ],
    buildGeometry: (p) => {
      const m = curvedMeshData(p.length, p.height, p.width, p.curveExp ?? 1.4);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.verts, 3));
      g.setIndex(new THREE.BufferAttribute(m.idx, 1));
      g.computeVertexNormals();
      return g;
    },
    buildCollider: (RAPIER, p) => {
      const m = curvedMeshData(p.length, p.height, p.width, p.curveExp ?? 1.4);
      // FIX_INTERNAL_EDGES：不修内边则球在 trimesh 上每帧吃鬼接触——实测能量蒸发 97%/弹跳失真（B5 实锤）
      return RAPIER.ColliderDesc.trimesh(m.verts, m.idx, RAPIER.TriMeshFlags ? RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES : undefined);
    },
    spawnY: () => 0.02,
    computed: (p) => {
      const pe = p.curveExp ?? 1.4;
      const thTop = Math.atan(pe * p.height / p.length) * 180 / Math.PI;
      const thBot = pe > 1 ? 0 : (pe < 1 ? 90 : thTop);   // 凹面底端切平 / 凸面底端趋竖直
      return [
        { key: 'slopeTopDeg', label: '顶端切线角', value: +thTop.toFixed(1), unit: '°' },
        { key: 'slopeBotDeg', label: '底端切线角', value: +thBot.toFixed(1), unit: '°' },
      ];
    },
  },

  bowl: {
    id: 'bowl', label: '碗形曲面', category: '轨道和曲面',
    desc: '球冠内曲面碗（薄壳接触）：小球碗内往复震荡，微幅周期 T≈2π√((Rs−r)/g)，曲面版单摆',
    compat: '固定碗面；球在腔内真实接触，能量守恒可对照；深径比钳 ≤0.88（球冠几何上限）',
    defaults: { params: { radius: 0.8, depth: 0.35 }, physics: { ...defaultPhysics('fixed', 0), friction: 0.3, restitution: 0.05 }, render: { material: 'marble' } },
    schema: [
      { key: 'radius', label: '碗口半径', unit: 'm', min: 0.3, max: 2.5, step: 0.05 },
      { key: 'depth', label: '碗深', unit: 'm', min: 0.05, max: 1.5, step: 0.05 },
    ],
    buildGeometry: (p) => {
      const m = bowlMeshData(p.radius, p.depth);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.verts, 3));
      g.setIndex(new THREE.BufferAttribute(m.idx, 1));
      g.computeVertexNormals();
      return g;
    },
    buildCollider: (RAPIER, p) => {
      const m = bowlMeshData(p.radius, p.depth);
      // FIX_INTERNAL_EDGES：不修内边则球在 trimesh 上每帧吃鬼接触——实测能量蒸发 97%/弹跳失真（B5 实锤）
      return RAPIER.ColliderDesc.trimesh(m.verts, m.idx, RAPIER.TriMeshFlags ? RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES : undefined);
    },
    spawnY: () => 0.02,
    computed: (p) => {
      const D = Math.min(p.depth, p.radius * 0.88);
      const Rs = (p.radius * p.radius + D * D) / (2 * D);
      return [
        { key: 'sphereR', label: '等效球面半径', value: +Rs.toFixed(3), unit: 'm' },
        { key: 'smallT', label: '微幅周期参考', value: +(2 * Math.PI * Math.sqrt(Rs / 9.81)).toFixed(3), unit: 's' },
      ];
    },
  },

  waveFloor: {
    id: 'waveFloor', label: '波浪路面', category: '轨道和曲面',
    desc: '双频正弦叠加起伏路面（不规则地形）：法向力随坡度连续变化，球速快时波峰会颠簸跳离',
    compat: '固定路面；真实接触——最大坡度≈atan(2π·波幅/波长·1.35)，与球/块摩擦成对生效',
    defaults: { params: { sx: 6, sz: 1.6, waveLen: 0.8, waveAmp: 0.05 }, physics: { ...defaultPhysics('fixed', 0), friction: 0.3, restitution: 0.1 }, render: { material: 'marble' } },
    schema: [
      { key: 'sx', label: '路长', unit: 'm', min: 1, max: 20, step: 0.5 },
      { key: 'sz', label: '路宽', unit: 'm', min: 0.4, max: 8, step: 0.2 },
      { key: 'waveLen', label: '波长', unit: 'm', min: 0.2, max: 3, step: 0.05 },
      { key: 'waveAmp', label: '波幅', unit: 'm', min: 0.005, max: 0.25, step: 0.005 },
    ],
    buildGeometry: (p) => {
      const m = waveFloorMeshData(p.sx, p.sz, p.waveLen, p.waveAmp);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.verts, 3));
      g.setIndex(new THREE.BufferAttribute(m.idx, 1));
      g.computeVertexNormals();
      return g;
    },
    buildCollider: (RAPIER, p) => {
      const m = waveFloorMeshData(p.sx, p.sz, p.waveLen, p.waveAmp);
      // FIX_INTERNAL_EDGES：不修内边则球在 trimesh 上每帧吃鬼接触——实测能量蒸发 97%/弹跳失真（B5 实锤）
      return RAPIER.ColliderDesc.trimesh(m.verts, m.idx, RAPIER.TriMeshFlags ? RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES : undefined);
    },
    // R6-037 安全底衬：trimesh 薄壳特定入射角仍漏球（waveRoad 预置实测 2s 折返后穿面坠至
    // −11m 出画）。顶面低于最深波谷 1cm，仅泄漏兜底——正常接触全在 trimesh 面上
    buildExtraColliders: (RAPIER, p) => [
      RAPIER.ColliderDesc.cuboid(p.sx / 2, 0.05, p.sz / 2).setTranslation(0, -(p.waveAmp * 1.35 + 0.06), 0),
    ],
    spawnY: () => 0.02,
    computed: (p) => [
      { key: 'maxSlopeDeg', label: '最大坡度', value: +(Math.atan(2 * Math.PI * p.waveAmp / p.waveLen * 1.35) * 180 / Math.PI).toFixed(1), unit: '°' },
    ],
  },


  celestial: {
    id: 'celestial', label: '天体', category: '天体',
    desc: '参与成对引力作用的球状天体（不受世界重力，physics.gravitating）；ring=1 挂 26.7° 倾角行星环',
    compat: '参与成对引力（场景 G）；不与世界重力作用；行星环仅视觉不参与碰撞',
    // 渲染半径与引力质量分离：radius 只是视觉/碰撞尺寸，mass 才是引力质量（物理实体与视觉实体分离）
    defaults: {
      params: { radius: 0.5, ring: 0 },
      physics: {
        body: 'dynamic', mass: 100, friction: 0, restitution: 0.5,
        linvel: [0, 0, 0], angvel: [0, 0, 0],
        linDamping: 0, angDamping: 0, gravityScale: 0, gravitating: true,
      },
      render: { material: 'sun' },
    },
    schema: [
      { key: 'radius', label: '半径', unit: 'm', min: 0.05, max: 4, step: 0.05 },
      { key: 'ring', label: '行星环', unit: '', min: 0, max: 1, step: 1 }, // MAT-68：0/1 开关
    ],
    buildGeometry: (p) => new THREE.SphereGeometry(p.radius, 48, 32),
    makeMesh: (p, material) => celestialGroup(p, material), // MAT-68：可选环，Group 结构
    buildCollider: (RAPIER, p) => RAPIER.ColliderDesc.ball(p.radius),
    spawnY: (p) => p.radius,
    inertiaY: (p, m) => 0.4 * m * p.radius * p.radius,
  },

  marker: {
    id: 'marker', label: '关键点标记', category: '测量和教学',
    desc: '竖直小旗标注（固定、无碰撞）：标出题目关键点/初始位置等教学标注',
    compat: '纯视觉教学标注（固定、无碰撞、不参与物理与测量计算）',
    defaults: { params: { height: 0.42 }, physics: { body: 'fixed', mass: 0, friction: 0.4, restitution: 0.2, linvel: [0, 0, 0], angvel: [0, 0, 0], linDamping: 0.05, angDamping: 0.05, gravityScale: 1 }, render: { material: 'brass' } },
    schema: [
      { key: 'height', label: '旗杆高', unit: 'm', min: 0.1, max: 2, step: 0.02 },
    ],
    buildGeometry: (p) => new THREE.CylinderGeometry(0.012, 0.012, p.height, 8),
    makeMesh: (p, material) => markerGroup(p.height, material),
    buildCollider: () => null,           // 纯标注：无碰撞体
    spawnY: (p) => p.height / 2,
  },

  speedSensor: {
    id: 'speedSensor', label: '速度传感器', category: '测量和教学',
    desc: '绑定一个动态体，运行时实时读其速度大小与分量（固定、无碰撞）',
    compat: '需先选一个动态实体：传感器实时显示该体速度',
    defaults: { params: { }, physics: { body: 'fixed', mass: 0, friction: 0.4, restitution: 0.2, linvel: [0, 0, 0], angvel: [0, 0, 0], linDamping: 0.05, angDamping: 0.05, gravityScale: 1 }, render: { material: 'brass' } },
    schema: [],
    buildGeometry: () => new THREE.ConeGeometry(0.06, 0.16, 12),
    buildCollider: () => null,
    spawnY: () => 0.5,
    isSensor: true,                      // 放置语义：选 1 个动态体绑定
  },

  timer: {
    id: 'timer', label: '计时器', category: '测量和教学',
    desc: '竖直光门（固定、无碰撞）：绑定动态体，记录其首次穿过光门平面的时刻',
    compat: '需先选一个动态实体：运行开始计时，该体穿过光门平面时停止',
    defaults: { params: { height: 0.9 }, physics: { body: 'fixed', mass: 0, friction: 0.4, restitution: 0.2, linvel: [0, 0, 0], angvel: [0, 0, 0], linDamping: 0.05, angDamping: 0.05, gravityScale: 1 }, render: { material: 'steelDark' } },
    schema: [
      { key: 'height', label: '门柱高', unit: 'm', min: 0.2, max: 3, step: 0.05 },
    ],
    buildGeometry: (p) => new THREE.BoxGeometry(0.05, p.height, 0.05),
    buildCollider: () => null,
    spawnY: (p) => p.height / 2,
    isSensor: true,
  },

  forceSensor: {
    id: 'forceSensor', label: '力传感器', category: '测量和教学',
    desc: '绑定一个动态体，实时读其所受接触合力（支持力+摩擦力，固定、无碰撞）',
    compat: '需先选一个动态实体：静止称重读 mg，自由飞行读 0（失重演示）',
    defaults: { params: { }, physics: { body: 'fixed', mass: 0, friction: 0.4, restitution: 0.2, linvel: [0, 0, 0], angvel: [0, 0, 0], linDamping: 0.05, angDamping: 0.05, gravityScale: 1 }, render: { material: 'brass' } },
    schema: [],
    buildGeometry: () => new THREE.CylinderGeometry(0.14, 0.14, 0.05, 24),
    buildCollider: () => null,
    spawnY: () => 0.03,
    isSensor: true,                      // 放置语义：选 1 个动态体绑定
  },

  ruler: {
    id: 'ruler', label: '测量尺', category: '测量和教学',
    desc: '带刻度横尺（固定、无碰撞）：量两实体间距，检查器实时读长度',
    compat: '需先选两个实体：尺自动放两端点之间，检查器实时显示间距',
    defaults: { params: { }, physics: { body: 'fixed', mass: 0, friction: 0.4, restitution: 0.2, linvel: [0, 0, 0], angvel: [0, 0, 0], linDamping: 0.05, angDamping: 0.05, gravityScale: 1 }, render: { material: 'wood' } },
    schema: [],
    buildGeometry: () => rulerGeometry(),
    buildCollider: () => null,
    spawnY: () => 0.02,
    isMeasure: true,                     // 放置语义同 isLink（选两实体），但产的是测量标注
  },

  light: {
    id: 'light', label: '点光源', category: '光源',
    desc: '暖白点光源（固定、无碰撞）：给局部区域补光，gizmo 可移动位置',
    compat: '纯视觉光源，不参与物理与测量；亮度/灯高在检查器调节（重建生效）',
    defaults: { params: { intensity: 6, height: 1.2 }, physics: { body: 'fixed', mass: 0, friction: 0.4, restitution: 0.2, linvel: [0, 0, 0], angvel: [0, 0, 0], linDamping: 0.05, angDamping: 0.05, gravityScale: 1 }, render: { material: 'brass' } },
    schema: [
      { key: 'intensity', label: '亮度', unit: 'cd', min: 0.5, max: 30, step: 0.5 },
      { key: 'height', label: '灯高', unit: 'm', min: 0.2, max: 4, step: 0.1 },
    ],
    buildGeometry: (p) => new THREE.SphereGeometry(0.07, 16, 12),
    makeMesh: (p) => lightGroup(p),
    buildCollider: () => null,
    spawnY: (p) => p.height,
    paramsRebuild: true,                 // 调参需重建（PointLight 属性在建体时挂载）
  },

  viewpoint: {
    id: 'viewpoint', label: '观察点', category: '相机和观察点',
    desc: '保存当前相机视角（固定、无碰撞）：放置时记录相机位姿，检查器一键飞回',
    compat: '放置即记录当前视角；多观察点可保存教学场景的多个检查角度',
    defaults: { params: { height: 0.14, target: [0, 0.5, 0] }, physics: { body: 'fixed', mass: 0, friction: 0.4, restitution: 0.2, linvel: [0, 0, 0], angvel: [0, 0, 0], linDamping: 0.05, angDamping: 0.05, gravityScale: 1 }, render: { material: 'brass' } },
    schema: [
      { key: 'height', label: '标记大小', unit: 'm', min: 0.06, max: 0.4, step: 0.02 },
    ],
    buildGeometry: (p) => new THREE.OctahedronGeometry(p.height),
    buildCollider: () => null,
    spawnY: (p) => p.height,
    isViewpoint: true,                   // 放置语义：记录当前相机位姿（workbench 特殊分支）
  },
};

function markerGroup(height, material) {
  // 旗：细杆 + 三角旗面（Group：杆用组件材质，旗面固定警示色）
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, height, 8), material);
  pole.position.y = height / 2;
  const flag = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 3), FLAG_MAT);
  flag.position.y = height - 0.06;
  flag.rotation.z = -Math.PI / 2;
  g.add(pole, flag);
  return g;
}

function celestialGroup(p, material) {
  // 天体组（MAT-68）：本体球（组件材质）+ 可选行星环；环仅视觉，碰撞体仍是球
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(p.radius, 48, 32), material));
  if (p.ring) {
    const ringMat = getSharedMaterials()?.saturnRing; // 材质表未就绪或环图缺失 → null → 跳过环（既有契约）
    if (ringMat) {
      // 内 1.4r 外 2.3r；材质自带 transparent + DoubleSide + depthWrite:false（materials.js 契约）
      const ring = new THREE.Mesh(new THREE.RingGeometry(p.radius * 1.4, p.radius * 2.3, 64), ringMat);
      ring.rotation.x = -Math.PI / 2 + (26.7 * Math.PI) / 180; // 先放平再倾 26.7°（土星轴倾角实测）
      g.add(ring);
    }
  }
  return g;
}

function lightGroup(p) {
  // 点光源：小灯泡球体（亮度三档 emissive，MAT-90）+ PointLight（暖白，decay=2 物理平方衰减；
  // MAT-83：distance 0 = 无 7m 硬截断，光沿距离自然回落；不投影避免阴影重叠）
  const g = new THREE.Group();
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), bulbMatFor(p.intensity ?? 6));
  const lamp = new THREE.PointLight(0xffe2b8, p.intensity ?? 6, 0, 2);
  lamp.position.y = 0;
  g.add(bulb, lamp);
  return g;
}

function rulerGeometry() {
  // 单位尺：1m 长横杆（放置时按两端点拉伸，runtime _syncLinks 同语义）
  return new THREE.BoxGeometry(1, 0.03, 0.06);
}

// 绕 y 轴自转动惯量（rotation 模式守恒量；未定义的组件返回 0）
export function inertiaYOf(typeId, params, mass) {
  const c = getComponent(typeId);
  return c.inertiaY ? c.inertiaY(params, mass) : 0;
}

export function getComponent(typeId) {
  const c = COMPONENTS[typeId];
  if (!c) throw new Error(`未知组件类型: ${typeId}`);
  return c;
}

export function catalog() {
  const cats = [];
  for (const c of Object.values(COMPONENTS)) {
    let cat = cats.find((x) => x.id === c.category);
    if (!cat) { cat = { id: c.category, label: c.category, items: [] }; cats.push(cat); }
    cat.items.push(c);
  }
  return cats;
}

// 由组件默认值构造完整实体（带类型化初始名）。overrides 的 params/physics/render/transform 做键级合并，
// 其余键直接覆盖 —— 保证 partial override 不丢默认字段（如 linvel）。
export function createEntity(typeId, overrides = {}, nameSeq = {}) {
  const c = getComponent(typeId);
  nameSeq[typeId] = (nameSeq[typeId] || 0) + 1;
  const e = {
    id: newId(typeId),
    type: typeId,
    name: `${c.label} ${nameSeq[typeId]}`,
    visible: true,
    locked: false,
    transform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
    params: { ...c.defaults.params },
    physics: { ...c.defaults.physics, linvel: [...c.defaults.physics.linvel], angvel: [...c.defaults.physics.angvel] },
    render: { ...c.defaults.render },
    measured: false,
    source: 'user',
  };
  for (const [k, v] of Object.entries(overrides || {})) {
    if (k === 'id' || k === 'type') continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && ['params', 'physics', 'render', 'transform'].includes(k)) {
      Object.assign(e[k], v);
    } else {
      e[k] = v;
    }
  }
  return e;
}

// schema 校验：返回 {ok, value, msg}，超界夹取并提示
export function validate(schemaItem, raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return { ok: false, value: null, msg: '必须是数字' };
  if (schemaItem.min !== undefined && v < schemaItem.min) {
    return { ok: false, value: schemaItem.min, msg: `最小 ${schemaItem.min}${schemaItem.unit || ''}` };
  }
  if (schemaItem.max !== undefined && v > schemaItem.max) {
    return { ok: false, value: schemaItem.max, msg: `最大 ${schemaItem.max}${schemaItem.unit || ''}` };
  }
  return { ok: true, value: v, msg: '' };
}
