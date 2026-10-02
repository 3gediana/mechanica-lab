// registry.js — 组件注册表：每种场景对象 = 几何构建 + 碰撞构建 + 参数 schema + 默认物理
// 新增对象类型只需在此登记，不写独立逻辑；schema 驱动检查器 UI 与校验。
import * as THREE from 'three';
import { newId } from './scene-doc.js';

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
    ],
    buildGeometry: (p) => new THREE.SphereGeometry(p.radius, 40, 28),
    buildCollider: (RAPIER, p) => RAPIER.ColliderDesc.ball(p.radius),
    spawnY: (p) => p.radius,
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
  },

  cylinder: {
    id: 'cylinder', label: '圆柱', category: '基础物体',
    desc: '直立圆柱，可滚动（放倒时）、碰撞',
    defaults: { params: { radius: 0.12, height: 0.3 }, physics: defaultPhysics('dynamic', 1.5), render: { material: 'brass' } },
    schema: [
      { key: 'radius', label: '半径', unit: 'm', min: 0.01, max: 2, step: 0.01 },
      { key: 'height', label: '高', unit: 'm', min: 0.02, max: 8, step: 0.01 },
    ],
    buildGeometry: (p) => new THREE.CylinderGeometry(p.radius, p.radius, p.height, 32),
    buildCollider: (RAPIER, p) => RAPIER.ColliderDesc.cylinder(p.height / 2, p.radius),
    spawnY: (p) => p.height / 2,
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
  },
};

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
    transform: { pos: [0, 0, 0], rot: [0, 0, 0] },
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
