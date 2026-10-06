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
  { key: 'sun', label: '恒星' },
  { key: 'saturn', label: '土星' },
  { key: 'jupiter', label: '木星' },          // MAT-67
  { key: 'mars', label: '火星' },             // MAT-67
];

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

// 共享视觉件材质（MAT-2/3/4 + PER-42）：辐条/旗面/灯泡此前每实例每 rebuild 各 new 一份
// （12 辐条转台=12 个材质），既费重建又泄漏 dispose 面——模块级共享，永不单独 dispose
const SPOKE_MAT = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.6, metalness: 0.1 });
const FLAG_MAT = new THREE.MeshStandardMaterial({ color: 0xc96a5a, roughness: 0.5 });
const BULB_MAT = new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffc880, emissiveIntensity: 0.9, roughness: 0.4 });
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
    defaults: { params: { sx: 12, sy: 0.1, sz: 12 }, physics: { ...defaultPhysics('fixed', 0), friction: 0.6, restitution: 0.3 }, render: { material: 'steelDark' } },
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
    buildCollider: () => null,   // 轮体无碰撞：跨绳球走 onPulley 导轨约束（碰撞体会挡住上升侧）
    spawnY: () => 3.0,
  },

  rope: {
    id: 'rope', label: '绳', category: '绳和约束',
    desc: '连接两个实体的轻绳（仅拉不推）；先选中两个实体再点目录添加，或由解析自动连接',
    compat: '需先选两个实体：按当前距离定长（超长张紧）',
    defaults: { params: { length: 0 }, physics: defaultPhysics('fixed', 0), render: { material: 'steelDark' } },
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
