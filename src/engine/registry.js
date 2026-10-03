// registry.js — 组件注册表：每种场景对象 = 几何构建 + 碰撞构建 + 参数 schema + 默认物理
// 新增对象类型只需在此登记，不写独立逻辑；schema 驱动检查器 UI 与校验。
import * as THREE from 'three';
import { newId } from './scene-doc.js';
import { TRACK_POINTS, TRACK_META } from '../track-curve.js';

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
  { key: 'brass', label: '黄铜' },
  { key: 'sun', label: '恒星' },
  { key: 'saturn', label: '土星' },
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

export const COMPONENTS = {
  sphere: {
    id: 'sphere', label: '球', category: '基础物体',
    desc: '均质球体，可滚动、碰撞、弹跳',
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
          new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.6, metalness: 0.1 })
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
    defaults: { params: { length: 0 }, physics: defaultPhysics('fixed', 0), render: { material: 'steelDark' } },
    schema: [
      { key: 'length', label: '绳长', unit: 'm', min: 0.05, max: 20, step: 0.05 },
    ],
    buildGeometry: () => new THREE.CylinderGeometry(0.008, 0.008, 1, 8),   // 单位杆，runtime 按两端拉伸
    buildCollider: () => null,
    isLink: true,                                  // 连接类：无独立 body，runtime 建绳关节并每帧同步网格
    spawnY: () => 0.5,
  },

  spring: {
    id: 'spring', label: '弹簧', category: '绳和约束',
    desc: '连接两个实体的线性弹簧（胡克定律 F=-k·Δx）；可演示简谐振动',
    defaults: { params: { stiffness: 20, restLength: 0.8, damping: 0.5 }, physics: defaultPhysics('fixed', 0), render: { material: 'brass' } },
    schema: [
      { key: 'stiffness', label: '劲度系数', unit: 'N/m', min: 0.5, max: 5000, step: 0.5 },
      { key: 'restLength', label: '原长', unit: 'm', min: 0.1, max: 10, step: 0.05 },
      { key: 'damping', label: '阻尼', unit: '', min: 0, max: 50, step: 0.1 },
    ],
    buildGeometry: () => new THREE.CylinderGeometry(0.022, 0.022, 1, 10),   // 单位杆，runtime 按两端拉伸
    buildCollider: () => null,
    isLink: true,
    spawnY: () => 0.5,
  },

  track: {
    id: 'track', label: '管道轨道', category: '轨道和曲面',
    desc: '半管滑道+竖直环轨（中心线解析约束，光滑无摩擦；球体设 onTrack 沿轨滑行）',
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
    desc: '参与成对引力作用的球状天体（不受世界重力，physics.gravitating）',
    // 渲染半径与引力质量分离：radius 只是视觉/碰撞尺寸，mass 才是引力质量（物理实体与视觉实体分离）
    defaults: {
      params: { radius: 0.5 },
      physics: {
        body: 'dynamic', mass: 100, friction: 0, restitution: 0.5,
        linvel: [0, 0, 0], angvel: [0, 0, 0],
        linDamping: 0, angDamping: 0, gravityScale: 0, gravitating: true,
      },
      render: { material: 'sun' },
    },
    schema: [
      { key: 'radius', label: '半径', unit: 'm', min: 0.05, max: 4, step: 0.05 },
    ],
    buildGeometry: (p) => new THREE.SphereGeometry(p.radius, 48, 32),
    buildCollider: (RAPIER, p) => RAPIER.ColliderDesc.ball(p.radius),
    spawnY: (p) => p.radius,
    inertiaY: (p, m) => 0.4 * m * p.radius * p.radius,
  },
};

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
