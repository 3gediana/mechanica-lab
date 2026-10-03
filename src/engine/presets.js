// presets.js — 预置场景：均通过 createEntity 构造（与 UI/Agent 同一条路径，保证可编辑可序列化）
import { createEmptyDoc } from './scene-doc.js';
import { createEntity } from './registry.js';

export const PRESETS = {
  empty: {
    id: 'empty', label: '空场景',
    build() {
      return createEmptyDoc('空场景');
    },
  },

  incline: {
    id: 'incline', label: '斜面小球',
    build() {
      const doc = createEmptyDoc('斜面小球');
      const seq = {};
      // 地面板：厚 0.1，顶面落在 y=0
      const ground = createEntity('ground', {
        name: '地面板 1',
        transform: { pos: [0, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 10, sy: 0.1, sz: 8 },
        source: 'preset',
      }, seq);
      // 斜坡：长 1.6 高 0.8（倾角 26.6°），高墙在 -x，坡面向 +x 下落
      const ramp = createEntity('ramp', {
        name: '斜坡 1',
        transform: { pos: [0, 0.05, 0], rot: [0, 0, 0] },
        source: 'preset',
      }, seq);
      // 小球：置于坡面上段，静止释放
      const ball = createEntity('sphere', {
        name: '小球 1',
        transform: { pos: [-0.45, 0.86, 0], rot: [0, 0, 0] },
        params: { radius: 0.15 },
        physics: {
          body: 'dynamic', mass: 1, friction: 0.3, restitution: 0.1,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0.02, angDamping: 0.02, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      doc.entities.push(ground, ramp, ball);
      return doc;
    },
  },

  momentum: {
    id: 'momentum', label: '动量守恒（一维对撞）',
    build() {
      const doc = createEmptyDoc('动量守恒：一维对撞');
      const seq = {};
      // 光滑地面：摩擦 0，水平方向无外力，动量严格守恒
      const ground = createEntity('ground', {
        name: '光滑地面',
        transform: { pos: [0, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 14, sy: 0.1, sz: 4 },
        physics: { body: 'fixed', friction: 0, restitution: 0.1 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      // 球 A：动碰者；球 B：静止。质量/初速度/弹性(恢复系数)全部可在检查器编辑
      const ballA = createEntity('sphere', {
        name: '球 A（入射）',
        transform: { pos: [-1.6, 0.15, 0], rot: [0, 0, 0] },
        params: { radius: 0.15 },
        physics: {
          body: 'dynamic', mass: 2, friction: 0, restitution: 0.8,
          linvel: [1.5, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      const ballB = createEntity('sphere', {
        name: '球 B（静止）',
        transform: { pos: [1.6, 0.15, 0], rot: [0, 0, 0] },
        params: { radius: 0.15 },
        physics: {
          body: 'dynamic', mass: 1, friction: 0, restitution: 0.8,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'brass' },
        measured: true,
        source: 'preset',
      }, seq);
      doc.entities.push(ground, ballA, ballB);
      doc.meta.assumptions = [
        '水平方向无外力（光滑地面，摩擦为 0），总动量守恒',
        '恢复系数 e=0.8（非完全弹性，动能有损失）；改 e=1 可验证动能守恒',
        '对撞约束在一维（x 轴）',
      ];
      return doc;
    },
  },

  celestial: {
    id: 'celestial', label: '天体运动（恒星+卫星）',
    build() {
      const doc = createEmptyDoc('天体运动：近圆轨道');
      doc.G = 1;                                 // 场景引力常数（教学缩放；动力学与真实引力同构）
      const seq = {};
      // 中心恒星 m=100 静止；卫星 m=1 在 r=4 处以圆轨道速度 v=√(GM/r)=5 m/s 入轨（xz 平面）
      const star = createEntity('celestial', {
        name: '中心恒星',
        transform: { pos: [0, 0, 0], rot: [0, 0, 0] },
        params: { radius: 0.6 },
        physics: { mass: 100, linvel: [0, 0, 0] },
        render: { material: 'sun' },
        source: 'preset',
      }, seq);
      const sat = createEntity('celestial', {
        name: '卫星',
        transform: { pos: [4, 0, 0], rot: [0, 0, 0] },
        params: { radius: 0.15 },
        physics: { mass: 1, linvel: [0, 0, -5] },
        render: { material: 'saturn' },
        measured: true,
        source: 'preset',
      }, seq);
      doc.entities.push(star, sat);
      doc.meta.assumptions = [
        '两体引力 F=G·m1·m2/r² 逐步施加（Rapier 数值积分，固定步长 1/120s）',
        '场景引力常数 G=1（教学缩放）；轨道半径 4 m，圆轨道速度 √(GM/r)=5 m/s',
        '天体不受世界重力（gravityScale=0）；渲染尺寸与引力质量分离',
      ];
      return doc;
    },
  },

  classic: {
    id: 'classic', label: '管道轨道（经典演示迁移）',
    build() {
      const doc = createEmptyDoc('管道轨道：下坡+竖直环轨');
      const seq = {};
      // 轨道本体（中心线解析约束，光滑无摩擦）
      const track = createEntity('track', {
        name: '管道轨道',
        transform: { pos: [0, 0, 0], rot: [0, 0, 0] },
        source: 'preset',
      }, seq);
      // 铬钢球：置于坡顶，onTrack 沿中心线滑行（free release，无挡板）
      const ball = createEntity('sphere', {
        name: '轨道小球',
        transform: { pos: [-1.70, 1.577, 0], rot: [0, 0, 0] },
        params: { radius: 0.09 },
        physics: {
          body: 'dynamic', mass: 0.24, friction: 0, restitution: 0.05,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1, onTrack: true,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      // 地面板：接甩出/抛出的球
      const ground = createEntity('ground', {
        name: '地面板',
        transform: { pos: [0, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 12, sy: 0.1, sz: 6 },
        source: 'preset',
      }, seq);
      doc.entities.push(track, ball, ground);
      doc.meta.assumptions = [
        '光滑管道（中心线解析约束，无摩擦）：球心被约束在管中心线半径 0.05m 内',
        '环轨可行性：释放高 1.47m > 2.7·R_eff=1.107m（余量 32.8%），环顶不掉落',
        '无挡板：小球由静止自由释放（经典演示的闸门释放的理想化）',
      ];
      return doc;
    },
  },

  projectile: {
    id: 'projectile', label: '抛体运动',
    build() {
      const doc = createEmptyDoc('抛体运动：斜抛与射程');
      const seq = {};
      // 抛体小球：初速 (4, 3, 0)，从高 0.6m 抛出（理论射程 vx·t_land ≈ 3.26m，最大高度 ≈ 1.06m）
      const ball = createEntity('sphere', {
        name: '抛体小球',
        transform: { pos: [0, 0.6, 0], rot: [0, 0, 0] },
        params: { radius: 0.15 },
        physics: {
          body: 'dynamic', mass: 1, friction: 0.4, restitution: 0.1,
          linvel: [4, 3, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      const ground = createEntity('ground', {
        name: '地面',
        transform: { pos: [4, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 24, sy: 0.1, sz: 8 },
        source: 'preset',
      }, seq);
      doc.entities.push(ball, ground);
      doc.meta.assumptions = [
        '理想抛体：水平匀速 + 竖直自由落体（不计空气阻力）',
        '初速 (4, 3, 0) m/s，起点高 0.6 m',
        '理论最大高度 H = 0.6 + 3²/19.62 ≈ 1.06 m',
      ];
      return doc;
    },
  },

  hingePend: {
    id: 'hingePend', label: '复摆（铰链杆）',
    build() {
      const doc = createEmptyDoc('复摆：铰链刚性杆摆动');
      const seq = {};
      // 锚点基座（固定）
      const anchor = createEntity('box', {
        name: '铰链基座',
        transform: { pos: [0, 2.5, 0], rot: [0, 0, 0] },
        params: { sx: 0.2, sy: 0.2, sz: 0.2 },
        physics: { body: 'fixed', friction: 0.8 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      // 刚性杆：绕 z 轴摆动，初始拉开 1.2 rad
      const rod = createEntity('box', {
        name: '摆杆',
        transform: { pos: [(0.5) * Math.sin(0.4), 2.5 - (0.5) * Math.cos(0.4), 0], rot: [0, 0, -Math.PI / 2 + 0.4] },   // 近锚端恰在锚点
        params: { sx: 1.0, sy: 0.06, sz: 0.06, noCollide: true },   // 铰链连接体互碰禁用（纯摆）
        physics: {
          body: 'dynamic', mass: 1, friction: 0.5, restitution: 0.1,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'wood' },
        measured: true,
        source: 'preset',
      }, seq);
      // 铰链：锚点基座 ↔ 摆杆，绕 z 轴，锚点=基座中心（杆端）
      anchor.joints = [{
        type: 'revolute', target: rod.id,
        axis: [0, 0, 1],
        anchor1: [0, 0, 0], anchor2: [-0.5, 0, 0],   // 杆局部近端（绕近端摆）
      }];
      doc.entities.push(anchor, rod);
      doc.meta.assumptions = [
        '复摆（细杆绕端点）：周期理论 T = 2π√(2L/(3g))，L=1m 时 ≈ 1.638 s',
        '铰链绕 z 轴无摩擦；摆动平面为 x-y',
      ];
      return doc;
    },
  },

  atwood: {
    id: 'atwood', label: '阿特伍德机（定滑轮）',
    build() {
      const doc = createEmptyDoc('阿特伍德机：张力与加速度');
      const seq = {};
      // 定滑轮（固定轴承，视觉轮体）
      const pulley = createEntity('pulley', {
        name: '定滑轮',
        transform: { pos: [0, 3.0, 0], rot: [0, 0, 0] },
        params: { radius: 0.3 },
        source: 'preset',
      }, seq);
      // 两侧小球：m1=2（左/重）m2=1（右/轻）；绳长常数 C = 1.0 + 1.0 = 2.0
      const mkBall = (side, x, m, mat) => createEntity('sphere', {
        name: `${side}侧球 (${m}kg)`,
        transform: { pos: [x, 1.0, 0], rot: [0, 0, 0] },
        params: { radius: 0.12 },
        physics: {
          body: 'dynamic', mass: m, friction: 0, restitution: 0,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1, onPulley: pulley.id,
        },
        render: { material: mat },
        measured: true,
        source: 'preset',
      }, seq);
      const left = mkBall('左', -0.35, 1.2, 'chrome');
      const right = mkBall('右', 0.35, 1, 'brass');
      doc.entities.push(pulley, left, right);
      doc.meta.assumptions = [
        '轻绳不可伸长：y1+y2=常数（逐步投影约束），两侧竖直导轨理想化（无摆动）',
        '理论加速度 a = (m1−m2)g/(m1+m2) = 0.2×9.81/2.2 ≈ 0.892 m/s²',
        '滑轮与绳质量不计（理想滑轮），张力 T = 2·m1·m2·g/(m1+m2) ≈ 10.70 N',
      ];
      return doc;
    },
  },

  spin: {
    id: 'spin', label: '角动量守恒（转台+径向滑块）',
    build() {
      const doc = createEmptyDoc('角动量守恒：转台+径向滑块');
      doc.kind = 'rotation';
      const seq = {};
      // 轴承底座（固定装饰，示意无外力矩轴承）
      const base = createEntity('cylinder', {
        name: '轴承底座',
        transform: { pos: [0, 0.15, 0], rot: [0, 0, 0] },
        params: { radius: 0.25, height: 0.3, spokes: 0 },
        physics: { body: 'fixed' },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      // 转台 m=8 R=1.2，ω0=3 rad/s；重力归零=理想轴承（对转轴无外力矩）；spinLock=轴承约束只绕 Y 转
      const table = createEntity('cylinder', {
        name: '转台',
        transform: { pos: [0, 0.42, 0], rot: [0, 0, 0] },
        params: { radius: 1.2, height: 0.12, spokes: 4 },
        physics: {
          body: 'dynamic', mass: 8, friction: 0, restitution: 0.1,
          linvel: [0, 0, 0], angvel: [0, 3, 0],
          linDamping: 0, angDamping: 0, gravityScale: 0, spinLock: true,
        },
        render: { material: 'wood' },
        measured: true,
        source: 'preset',
      }, seq);
      // 滑块 m=1.5 初始 r=0.7，切向速度与转台匹配 ω0·r=2.1；槽内无摩擦，惯性外滑 → I 增 ω 减
      const slider = createEntity('box', {
        name: '滑块',
        transform: { pos: [0.7, 0.56, 0], rot: [0, 0, 0] },
        params: { sx: 0.14, sy: 0.14, sz: 0.14 },
        physics: {
          body: 'dynamic', mass: 1.5, friction: 0, restitution: 0.1,
          linvel: [0, 0, -2.1], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 0,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      // 径向滑槽：转台局部 +x 方向 prismatic joint（沿轴自由无摩擦，法向刚性约束）
      table.joints = [{
        type: 'prismatic', target: slider.id,
        anchor1: [0, 0.14, 0], anchor2: [0, 0, 0], axis: [1, 0, 0],
        limits: [0.15, 1.05],
      }];
      doc.entities.push(base, table, slider);
      doc.meta.assumptions = [
        '对转轴无外力矩（理想轴承，重力沿轴方向或已理想化为零），系统角动量 L=I·ω 守恒',
        '滑槽沿转台径向、槽内无摩擦；滑块因惯性向外滑，I 增大 → ω 减小',
        '转台初始 ω=3 rad/s，滑块 m=1.5kg 初始 r=0.7m，切向速度与转台匹配（3×0.7=2.1 m/s）',
      ];
      return doc;
    },
  },
};

export function getPreset(id) {
  const p = PRESETS[id];
  if (!p) throw new Error(`未知预置: ${id}`);
  return p.build();
}
