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

  momentum2d: {
    id: 'momentum2d', label: '动量守恒（二维斜碰）',
    build() {
      const doc = createEmptyDoc('动量守恒：二维斜碰');
      const seq = {};
      const ground = createEntity('ground', {
        name: '光滑地面',
        transform: { pos: [0, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 14, sy: 0.1, sz: 6 },
        physics: { body: 'fixed', friction: 0, restitution: 0.1 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      // 二维斜碰：两球 z 错开 0.12m（非对心），入射速度带 z 分量 → 碰后两球在 xz 平面散开
      // 瞄准线计算：A 从 (-1.2, 0.22) 以 (1.2, -0.15) 出发，过 B 的 x 时 z≈-0.11
      // → 瞄准参数 b=0.11 < 半径和 0.3，必碰且碰撞法向含明显 z 分量（二维效应显著）
      const ballA = createEntity('sphere', {
        name: '球 A（入射）',
        transform: { pos: [-1.2, 0.15, 0.22], rot: [0, 0, 0] },
        params: { radius: 0.15 },
        physics: {
          body: 'dynamic', mass: 2, friction: 0, restitution: 0.8,
          linvel: [1.2, 0, -0.15], angvel: [0, 0, 0],
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
        '水平面（xz）内无外力（光滑地面），总动量矢量守恒——x 与 z 分量分别守恒',
        '二维斜碰（非对心）：碰后速度方向由碰撞几何决定，无闭式一维公式；解释器门控动量矢量守恒',
        '恢复系数 e=0.8：法向动能有损失（斜碰整体 KE 损失小于一维同 e 值）',
      ];
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
          spawnDrop: false,   // 能量守恒是本场景教学主体：出生下落的 4cm 幻影势能会污染 E0 基线（p22 实测 -5.5%）
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
          spawnDrop: false,   // 能量守恒是本场景教学主体：出生下落的 4cm 幻影势能会污染 E0 基线（p22 实测 -5.5%）
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
      // 两侧小球：m1=1.2（左/重）m2=1.0（右/轻）；绳长常数 C = 1.0 + 1.0 = 2.0
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

  // ========== 第二批教学预置（OPTIMIZATION-R2 MDL-16~40）==========
  // 绳/弹簧均为 link 实体：attach=[实体A.id, 实体B.id]（两端锚点取刚体质心，runtime 建 rope/spring 关节）。
  // 注意两类引擎口径（预置数值都按此校准）：
  //   恢复系数/摩擦按两碰撞体的平均值合成 → 需要指定配对值时两侧设同值或按平均值反解；
  //   rope 是 max-distance 约束（仅拉不推），spring 关节拉/推双向（不能当"分离式弹射器"直接连弹丸）。

  pendulum: {
    id: 'pendulum', label: '单摆',
    build() {
      const doc = createEmptyDoc('单摆：周期与摆长');
      const seq = {};
      const L = 1.2, th0 = 0.3;                       // 摆长 1.2 m，拉开 0.3 rad 静止释放
      const anchor = createEntity('box', {
        name: '悬点锚',
        transform: { pos: [0, 2.5, 0], rot: [0, 0, 0] },
        params: { sx: 0.2, sy: 0.2, sz: 0.2 },
        physics: { body: 'fixed', friction: 0.8 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      const ball = createEntity('sphere', {
        name: '摆球',
        transform: { pos: [L * Math.sin(th0), 2.5 - L * Math.cos(th0), 0], rot: [0, 0, 0] },
        params: { radius: 0.1 },
        physics: {
          body: 'dynamic', mass: 1, friction: 0.3, restitution: 0,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      const rope = createEntity('rope', {
        name: `绳 ${L.toFixed(2)}m`,
        params: { length: L },
        attach: [anchor.id, ball.id],
        transform: { pos: [(0 + L * Math.sin(th0)) / 2, (2.5 + 2.5 - L * Math.cos(th0)) / 2, 0] },
        source: 'preset',
      }, seq);
      doc.entities.push(anchor, ball, rope);
      doc.meta.assumptions = [
        '验证目标：小角单摆周期 T=2π√(L/g)=2π√(1.2/9.81)≈2.20 s（θ₀=0.3 rad 时精确解仅偏大约 0.03%）',
        '质点摆理想化：摆球有限半径的复摆修正可忽略（r=0.1 ≪ L=1.2）',
        '轻绳 max-distance 约束（只拉不推）：初始恰好张紧（球心到锚心=1.2 m）',
      ];
      return doc;
    },
  },

  conical: {
    id: 'conical', label: '圆锥摆',
    build() {
      const doc = createEmptyDoc('圆锥摆：稳定回转');
      const seq = {};
      const L = 1.0, th = Math.PI / 6, g = 9.81;      // 摆长 1 m，半顶角 30°
      const v = Math.sqrt(g * L * Math.sin(th) * Math.tan(th));   // ≈1.683 m/s
      const anchor = createEntity('box', {
        name: '悬点锚',
        transform: { pos: [0, 2.2, 0], rot: [0, 0, 0] },
        params: { sx: 0.15, sy: 0.15, sz: 0.15 },
        physics: { body: 'fixed', friction: 0.8 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      const ball = createEntity('sphere', {
        name: '回转球',
        transform: { pos: [L * Math.sin(th), 2.2 - L * Math.cos(th), 0], rot: [0, 0, 0] },
        params: { radius: 0.05 },
        physics: {
          body: 'dynamic', mass: 0.5, friction: 0, restitution: 0,
          linvel: [0, 0, -v], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      const rope = createEntity('rope', {
        name: `绳 ${L.toFixed(2)}m`,
        params: { length: L },
        attach: [anchor.id, ball.id],
        transform: { pos: [L * Math.sin(th) / 2, (2.2 + 2.2 - L * Math.cos(th)) / 2, 0] },
        source: 'preset',
      }, seq);
      doc.entities.push(anchor, ball, rope);
      doc.meta.assumptions = [
        '验证目标：圆锥摆稳定回转，θ=30° 所需切向速度 v=√(g·L·sinθ·tanθ)≈1.68 m/s，周期 T=2πρ/v≈1.87 s（ρ=L·sinθ=0.5 m）',
        '绳为 max-distance 约束（仅拉不推）：回转半径存在约束半径内的微摆，长期轨道稳定',
        '向心力由张力水平分量提供，竖直分量平衡重力（tanθ=v²/(g·ρ)）',
      ];
      return doc;
    },
  },

  vertCircle: {
    id: 'vertCircle', label: '竖直圆周（临界速度）',
    build() {
      const doc = createEmptyDoc('竖直圆周：临界速度对照');
      const seq = {};
      const L = 1.2, H = 2.4;                          // 绳长 1.2 m，锚高 2.4 m
      const mk = (z, v, label, mat) => {
        const a = createEntity('box', {
          name: `锚 ${label}`,
          transform: { pos: [0, H, z], rot: [0, 0, 0] },
          params: { sx: 0.15, sy: 0.15, sz: 0.15 },
          physics: { body: 'fixed', friction: 0.8 },
          render: { material: 'steelDark' },
          source: 'preset',
        }, seq);
        const b = createEntity('sphere', {
          name: `圆周球（${label}，v=${v.toFixed(1)}）`,
          transform: { pos: [0, H - L, z], rot: [0, 0, 0] },
          params: { radius: 0.08 },
          physics: {
            body: 'dynamic', mass: 0.5, friction: 0.3, restitution: 0.05,
            linvel: [v, 0, 0], angvel: [0, 0, 0],
            linDamping: 0, angDamping: 0, gravityScale: 1,
          },
          render: { material: mat },
          measured: true,
          source: 'preset',
        }, seq);
        const r = createEntity('rope', {
          name: `绳 ${L.toFixed(2)}m`,
          params: { length: L },
          attach: [a.id, b.id],
          transform: { pos: [0, H - L / 2, z] },
          source: 'preset',
        }, seq);
        return [a, b, r];
      };
      const slow = mk(-0.7, 7.0, 'A', 'brass');        // < 临界 7.67：顶部抛离
      const fast = mk(0.7, 8.0, 'B', 'chrome');        // > 临界：过顶
      const ground = createEntity('ground', {
        name: '地面板',
        transform: { pos: [0, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 10, sy: 0.1, sz: 4 },
        source: 'preset',
      }, seq);
      doc.entities.push(...slow, ...fast, ground);
      doc.meta.assumptions = [
        '验证目标：竖直圆周临界底部速度 √(5gL)=√(5×1.2×9.81)≈7.67 m/s',
        'v=7.0 < 临界：绳在顶点前约 44°（φ≈136°，自底量起）松弛，球脱离圆轨作抛体（顶部抛离）',
        'v=8.0 > 临界：全程张紧过顶，顶点速度 √(v²−4gL)≈4.12 m/s > √(gL)≈3.43 m/s',
        '两套装置 z=±0.7 平行摆位互不干扰；绳为 max-distance 约束（仅拉不推，松弛即抛体）',
      ];
      return doc;
    },
  },

  springSHM: {
    id: 'springSHM', label: '弹簧振子（水平简谐）',
    build() {
      const doc = createEmptyDoc('弹簧振子：水平简谐振动');
      const seq = {};
      const k = 20, m = 1, L0 = 0.9;                   // T=2π√(m/k)=1.40 s
      const ground = createEntity('ground', {
        name: '光滑地面',
        transform: { pos: [0, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 6, sy: 0.1, sz: 1.6 },
        physics: { body: 'fixed', friction: 0, restitution: 0 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      // 固定墙：中心与球心等高（弹簧沿两刚体质心连线作用，等高才是纯水平力）
      const wall = createEntity('box', {
        name: '固定墙',
        transform: { pos: [-1, 0.15, 0], rot: [0, 0, 0] },
        params: { sx: 0.2, sy: 0.6, sz: 0.8 },
        physics: { body: 'fixed', friction: 0.8 },
        render: { material: 'marble' },
        source: 'preset',
      }, seq);
      const ball = createEntity('sphere', {
        name: '振子球',
        transform: { pos: [0.5, 0.15, 0], rot: [0, 0, 0] },
        params: { radius: 0.15 },
        physics: {
          body: 'dynamic', mass: m, friction: 0, restitution: 0,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      const spring = createEntity('spring', {
        name: `弹簧 k=${k}`,
        params: { stiffness: k, restLength: L0, damping: 0 },   // 默认 0.5 会衰减，必须显式置 0
        attach: [wall.id, ball.id],
        transform: { pos: [(-1 + 0.5) / 2, 0.15, 0] },
        source: 'preset',
      }, seq);
      doc.entities.push(ground, wall, ball, spring);
      doc.meta.assumptions = [
        '验证目标：水平弹簧振子周期 T=2π√(m/k)=2π√(1/20)≈1.40 s',
        '释放拉伸 0.6 m → 振幅 A=0.6 m，弹性势 ½kA²=3.6 J 与动能往复互换（平衡位 x=−0.1 m=墙心+原长）',
        '弹簧阻尼显式置 0（组件默认 0.5 会衰减振幅）；光滑地面（μ=0）球纯滑动不受滚转转矩',
      ];
      return doc;
    },
  },

  springVert: {
    id: 'springVert', label: '竖直弹簧振子',
    build() {
      const doc = createEmptyDoc('竖直弹簧振子：重力只移平衡位');
      const seq = {};
      const k = 30, m = 1, L0 = 1.0;                   // T=2π√(m/k)≈1.15 s
      const anchor = createEntity('box', {
        name: '吊锚',
        transform: { pos: [0, 3.0, 0], rot: [0, 0, 0] },
        params: { sx: 0.15, sy: 0.15, sz: 0.15 },
        physics: { body: 'fixed', friction: 0.8 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      const ball = createEntity('sphere', {
        name: '振子球',
        transform: { pos: [0, 3.0 - L0, 0], rot: [0, 0, 0] },   // 从自然长静止释放
        params: { radius: 0.12 },
        physics: {
          body: 'dynamic', mass: m, friction: 0.3, restitution: 0,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      const spring = createEntity('spring', {
        name: `弹簧 k=${k}`,
        params: { stiffness: k, restLength: L0, damping: 0 },
        attach: [anchor.id, ball.id],
        transform: { pos: [0, (3.0 + 2.0) / 2, 0] },
        source: 'preset',
      }, seq);
      doc.entities.push(anchor, ball, spring);
      doc.meta.assumptions = [
        '验证目标：竖直弹簧振子周期与水平相同 T=2π√(m/k)=2π√(1/30)≈1.15 s（重力只移动平衡位，不改变周期）',
        '平衡位在锚下 L0+mg/k=1.0+0.327≈1.33 m；从自然长静止释放 → 最大伸长 2mg/k≈0.65 m（由 mg·Δ=½kΔ²）',
        '重力势能基准面取 y=0（能量曲线口径）；最低点球底 y≈1.23 m，全程不触地',
      ];
      return doc;
    },
  },

  coupled: {
    id: 'coupled', label: '耦合双振子',
    build() {
      const doc = createEmptyDoc('耦合双振子：质心匀速+相对振动');
      const seq = {};
      const k = 15, L0 = 0.8;                          // 相对振动 T=2π√(m/(2k))≈1.15 s
      const ground = createEntity('ground', {
        name: '光滑地面（加长）',
        transform: { pos: [2, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 14, sy: 0.1, sz: 3 },            // 质心漂移 0.5 m/s 需长地面承接
        physics: { body: 'fixed', friction: 0, restitution: 0 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      const mkBlock = (x, mat) => createEntity('box', {
        name: `振子块 ${x < 0 ? 'A' : 'B'}`,
        transform: { pos: [x, 0.15, 0], rot: [0, 0, 0] },
        params: { sx: 0.3, sy: 0.3, sz: 0.3 },
        physics: {
          body: 'dynamic', mass: 1, friction: 0, restitution: 0,
          linvel: [0.5, 0, 0], angvel: [0, 0, 0],      // 质心初速 0.5 m/s（两块同速）
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: mat },
        measured: true,
        source: 'preset',
      }, seq);
      const a = mkBlock(-0.55, 'chrome');
      const b = mkBlock(0.55, 'brass');
      const spring = createEntity('spring', {
        name: `耦合弹簧 k=${k}`,
        params: { stiffness: k, restLength: L0, damping: 0 },
        attach: [a.id, b.id],
        transform: { pos: [0, 0.15, 0] },
        source: 'preset',
      }, seq);
      doc.entities.push(ground, a, b, spring);
      doc.meta.assumptions = [
        '验证目标：光滑地面质心匀速 0.5 m/s（系统动量守恒）+ 相对振动叠加',
        '相对振动周期 T=2π√(m/(2k))=2π√(1/30)≈1.15 s（两等质量+单弹簧的等效劲度 2k）',
        '初始拉伸 0.3 m → 两块间距在 0.5~1.1 m 间振荡（块宽 0.3 永不接触）；地面加长至 14 m 承接质心漂移',
      ];
      return doc;
    },
  },

  springGun: {
    id: 'springGun', label: '弹簧弹射平抛',
    build() {
      const doc = createEmptyDoc('弹簧弹射：弹性势能→平抛');
      const seq = {};
      const k = 20, L0 = 0.9, dx = 0.5;                // 压缩 0.5 m 释放
      const ground = createEntity('ground', {
        name: '地面',
        transform: { pos: [9, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 24, sy: 0.1, sz: 3 },            // 球落地后滚动段防滚出
        physics: { body: 'fixed', friction: 0.3, restitution: 0.05 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      // 高台：台面顶 y=1.0，右缘 x=0.7（球离台后平抛 1 m 落地）
      const table = createEntity('box', {
        name: '发射台',
        transform: { pos: [-0.4, 0.95, 0], rot: [0, 0, 0] },
        params: { sx: 2.2, sy: 0.1, sz: 1.2 },
        physics: { body: 'fixed', friction: 0, restitution: 0 },
        render: { material: 'marble' },
        source: 'preset',
      }, seq);
      const wall = createEntity('box', {
        name: '固定墙',
        transform: { pos: [-1.2, 1.1, 0], rot: [0, 0, 0] },
        params: { sx: 0.2, sy: 0.5, sz: 0.8 },
        physics: { body: 'fixed', friction: 0.8 },
        render: { material: 'marble' },
        source: 'preset',
      }, seq);
      // 轻推板：弹簧拉/推双向不能直连弹丸（会永远振荡）→ 推板传力，原长点板减速球自然分离
      const plate = createEntity('box', {
        name: '轻推板 (0.02kg)',
        transform: { pos: [-1.2 + L0 - dx, 1.1, 0], rot: [0, 0, 0] },
        params: { sx: 0.04, sy: 0.2, sz: 0.3 },
        physics: {
          body: 'dynamic', mass: 0.02, friction: 0, restitution: 0,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'brass' },
        source: 'preset',
      }, seq);
      const ball = createEntity('sphere', {
        name: '弹射球',
        transform: { pos: [-1.2 + L0 - dx + 0.02 + 0.1 + 0.002, 1.1, 0], rot: [0, 0, 0] },
        params: { radius: 0.1 },
        physics: {
          body: 'dynamic', mass: 1, friction: 0, restitution: 0.05,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      const spring = createEntity('spring', {
        name: `弹簧 k=${k}`,
        params: { stiffness: k, restLength: L0, damping: 0 },
        attach: [wall.id, plate.id],
        transform: { pos: [(-1.2 + -1.2 + L0 - dx) / 2, 1.1, 0] },
        source: 'preset',
      }, seq);
      doc.entities.push(ground, table, wall, plate, ball, spring);
      doc.meta.assumptions = [
        '验证目标：出口速度 v=Δx·√(k/(m+m板))≈0.5×√(20/1.02)≈2.21 m/s（理想 √(kΔx²/m)=2.24，轻板 0.02 kg 修正 <1%）',
        '引擎 spring 关节拉/推双向作用，球直接连弹簧会永远振荡——经轻质推板传力，球在原长点（推板开始减速）自然分离',
        '平抛落点理论：台缘 x=0.7、球心高 1.1 m，t=√(2×1.0/9.81)≈0.45 s，落点 x≈0.7+2.21×0.45≈1.70 m；台面光滑',
      ];
      return doc;
    },
  },

  collLab: {
    id: 'collLab', label: '一维碰撞实验台',
    build() {
      const doc = createEmptyDoc('一维碰撞实验台：e=1 与 e=0 双泳道');
      const seq = {};
      const ground = createEntity('ground', {
        name: '光滑地面',
        transform: { pos: [5, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 24, sy: 0.1, sz: 2.4 },          // 碰后滚行段防滚出
        physics: { body: 'fixed', friction: 0, restitution: 0.1 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      // 双泳道：z=−0.3 弹性道（e=1），z=+0.3 非弹性道（e=0）；同泳道两球同 e（引擎按平均合成）
      const mk = (z, e, matA, matB) => {
        const a = createEntity('sphere', {
          name: `入射球（e=${e}）`,
          transform: { pos: [-1.2, 0.15, z], rot: [0, 0, 0] },
          params: { radius: 0.15 },
          physics: {
            body: 'dynamic', mass: 1, friction: 0, restitution: e,
            linvel: [1.5, 0, 0], angvel: [0, 0, 0],
            linDamping: 0, angDamping: 0, gravityScale: 1,
          },
          render: { material: matA },
          measured: true,
          source: 'preset',
        }, seq);
        const b = createEntity('sphere', {
          name: `靶球（e=${e}）`,
          transform: { pos: [0.6, 0.15, z], rot: [0, 0, 0] },
          params: { radius: 0.15 },
          physics: {
            body: 'dynamic', mass: 1, friction: 0, restitution: e,
            linvel: [0, 0, 0], angvel: [0, 0, 0],
            linDamping: 0, angDamping: 0, gravityScale: 1,
          },
          render: { material: matB },
          measured: true,
          source: 'preset',
        }, seq);
        return [a, b];
      };
      const elastic = mk(-0.3, 1, 'chrome', 'brass');
      const inelastic = mk(0.3, 0, 'chrome', 'brass');
      doc.entities.push(ground, ...elastic, ...inelastic);
      doc.meta.assumptions = [
        '验证目标（e=1 泳道）：等质量弹性对撞速度交换——A 停、B 以 1.5 m/s 前进；动量与动能双守恒',
        '验证目标（e=0 泳道）：完全非弹性共速 v′=1.5/2=0.75 m/s；动能损失 50%，动量守恒',
        '同泳道两球设相同恢复系数（引擎按两碰撞体平均合成 e）；双泳道 z=±0.3 互不干扰',
      ];
      return doc;
    },
  },

  bulletBlock: {
    id: 'bulletBlock', label: '子弹打木块',
    build() {
      const doc = createEmptyDoc('子弹打木块：完全非弹性碰撞');
      const seq = {};
      const ground = createEntity('ground', {
        name: '地面',
        transform: { pos: [2, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 20, sy: 0.1, sz: 3 },            // 共速 0.71 m/s 长滑行需长地面
        physics: { body: 'fixed', friction: 0, restitution: 0.1 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      const bullet = createEntity('sphere', {
        name: '弹丸 (0.05kg)',
        transform: { pos: [-1.0, 0.1, 0], rot: [0, 0, 0] },
        params: { radius: 0.03 },
        physics: {
          body: 'dynamic', mass: 0.05, friction: 0, restitution: 0,
          linvel: [15, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'rubber' },
        measured: true,
        source: 'preset',
      }, seq);
      const block = createEntity('box', {
        name: '木块 (1kg)',
        transform: { pos: [0.2, 0.1, 0], rot: [0, 0, 0] },
        params: { sx: 0.4, sy: 0.2, sz: 0.3 },
        physics: {
          body: 'dynamic', mass: 1, friction: 0, restitution: 0,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'wood' },
        measured: true,
        source: 'preset',
      }, seq);
      doc.entities.push(ground, bullet, block);
      doc.meta.assumptions = [
        '验证目标：完全非弹性碰撞动量守恒 v′=m·v/(m+M)=0.05×15/1.05≈0.71 m/s',
        '弹丸不嵌入木块，但双方 e=0 碰后共速，与完全非弹性语义等价',
        '动能损失 ≈95%：ΔKE=½·μ·v²≈5.36 J（μ=mM/(m+M) 为约化质量）；光滑地面水平方向无外力',
      ];
      return doc;
    },
  },

  newtonCradle: {
    id: 'newtonCradle', label: '牛顿摆',
    build() {
      const doc = createEmptyDoc('牛顿摆：动量链式传递');
      const seq = {};
      const n = 5, r = 0.05, L = 0.8, pull = 0.6;      // 球 r=0.05，绳长 0.8，左球拉开 0.6 rad
      const beam = createEntity('box', {
        name: '固定横梁',
        transform: { pos: [0, 1.88, 0], rot: [0, 0, 0] },
        params: { sx: 0.6, sy: 0.06, sz: 0.06 },
        physics: { body: 'fixed', friction: 0.8 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      const balls = [], ropes = [];
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * 2 * r;           // 相邻球心距 = 2r 精确预接触
        const nub = createEntity('box', {
          name: `吊点 ${i + 1}`,
          transform: { pos: [x, 1.8, 0], rot: [0, 0, 0] },
          params: { sx: 0.02, sy: 0.02, sz: 0.02 },
          physics: { body: 'fixed', friction: 0.8 },
          render: { material: 'brass' },
          source: 'preset',
        }, seq);
        const isPulled = i === 0;
        const px = x - (isPulled ? L * Math.sin(pull) : 0);
        const py = 1.8 - L * Math.cos(isPulled ? pull : 0);
        const ball = createEntity('sphere', {
          name: isPulled ? `摆球 1（拉开 ${pull}rad）` : `摆球 ${i + 1}`,
          transform: { pos: [px, py, 0], rot: [0, 0, 0] },
          params: { radius: r },
          physics: {
            body: 'dynamic', mass: 0.1, friction: 0, restitution: 1,
            linvel: [0, 0, 0], angvel: [0, 0, 0],
            linDamping: 0, angDamping: 0, gravityScale: 1,
          },
          render: { material: 'chrome' },
          measured: true,
          source: 'preset',
        }, seq);
        const rope = createEntity('rope', {
          name: `绳 ${i + 1} (${L.toFixed(2)}m)`,
          params: { length: L },
          attach: [nub.id, ball.id],
          transform: { pos: [(x + px) / 2, (1.8 + py) / 2, 0] },
          source: 'preset',
        }, seq);
        balls.push(ball); ropes.push(rope); doc.entities.push(nub);
      }
      doc.entities.unshift(beam);
      doc.entities.push(...balls, ...ropes);
      doc.meta.assumptions = [
        '验证目标：e=1 等质量链式动量传递——理想结果仅远端球摆出、其余球保持静止',
        '求解器按接触对序列逐步传递（非严格同时碰撞）：末端摆幅不足与中间球残余微动属数值局限，系统总动量始终守恒',
        '5 球等长绳（L=0.8 m）预接触：相邻球心距=2r=0.1 m 精确对齐；左端球拉开 0.6 rad 静止释放',
      ];
      return doc;
    },
  },

  ballChain: {
    id: 'ballChain', label: '水平碰撞链',
    build() {
      const doc = createEmptyDoc('水平碰撞链：多球连环传递');
      const seq = {};
      const r = 0.1, e = 0.95;
      const ground = createEntity('ground', {
        name: '光滑地面',
        transform: { pos: [6, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 24, sy: 0.1, sz: 2 },            // 链传递后滚行段防滚出（入射球少量反弹向左）
        physics: { body: 'fixed', friction: 0, restitution: 0.05 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      doc.entities.push(ground);
      for (let i = 0; i < 5; i++) {
        doc.entities.push(createEntity('sphere', {
          name: `链球 ${i + 1}`,
          transform: { pos: [(i - 2) * 2 * r, r, 0], rot: [0, 0, 0] },   // 预接触：球心距=2r
          params: { radius: r },
          physics: {
            body: 'dynamic', mass: 1, friction: 0, restitution: e,
            linvel: [0, 0, 0], angvel: [0, 0, 0],
            linDamping: 0, angDamping: 0, gravityScale: 1,
          },
          render: { material: 'brass' },
          measured: true,
          source: 'preset',
        }, seq));
      }
      doc.entities.push(createEntity('sphere', {
        name: '入射球',
        transform: { pos: [-1.5, r, 0], rot: [0, 0, 0] },
        params: { radius: r },
        physics: {
          body: 'dynamic', mass: 1, friction: 0, restitution: e,
          linvel: [2, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq));
      doc.meta.assumptions = [
        '验证目标：光滑水平面多球连环碰撞系统动量守恒——入射 2 m/s，碰后各球速度之和恒为 2 m/s（实测对照）',
        'e=0.95 折衷（e=1 的链式传递对求解器时序更敏感）：末端球带出最大前进速度，入射球有少量反弹残余，总动量守恒',
        '5 球预接触（球心距=2r=0.2 m 精确对齐）+1 入射球；μ=0 纯滑动不受滚转',
      ];
      return doc;
    },
  },

  bounceCompare: {
    id: 'bounceCompare', label: '反弹高度对照',
    build() {
      const doc = createEmptyDoc('反弹高度对照：e=0.9/0.5/0.2');
      const seq = {};
      const lanes = [
        { z: -0.4, e: 0.9, mat: 'chrome' },
        { z: 0.0, e: 0.5, mat: 'brass' },
        { z: 0.4, e: 0.2, mat: 'rubber' },
      ];
      for (const { z, e, mat } of lanes) {
        // 分道地面：恢复系数与该道球同步同值（引擎取平均合成，同值时 e 不被稀释）
        doc.entities.push(createEntity('ground', {
          name: `分道地面（e=${e}）`,
          transform: { pos: [0, -0.05, z], rot: [0, 0, 0] },
          params: { sx: 2, sy: 0.1, sz: 0.3 },
          physics: { body: 'fixed', friction: 0.6, restitution: e },
          render: { material: 'steelDark' },
          source: 'preset',
        }, seq));
        doc.entities.push(createEntity('sphere', {
          name: `落球（e=${e}）`,
          transform: { pos: [0, 2.0, z], rot: [0, 0, 0] },
          params: { radius: 0.15 },
          physics: {
            body: 'dynamic', mass: 1, friction: 0.4, restitution: e,
            linvel: [0, 0, 0], angvel: [0, 0, 0],
            linDamping: 0, angDamping: 0, gravityScale: 1,
          },
          render: { material: mat },
          measured: true,
          source: 'preset',
        }, seq));
      }
      doc.meta.assumptions = [
        '验证目标：首轮反弹高度 h₁=e²·h₀（h₀=2 m，以球心计）：e=0.9→1.62 m、e=0.5→0.50 m、e=0.2→0.08 m',
        '三分道地面与球设同值恢复系数（引擎按两碰撞体平均合成 e）',
        '无空气阻力（linDamping=0）：逐次反弹 hₙ=e²ⁿ·h₀',
      ];
      return doc;
    },
  },

  galileoDrop: {
    id: 'galileoDrop', label: '平抛与自由落体',
    build() {
      const doc = createEmptyDoc('平抛与自由落体：同时落地');
      const seq = {};
      const ground = createEntity('ground', {
        name: '地面',
        transform: { pos: [4, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 24, sy: 0.1, sz: 2 },            // 平抛球落地后仍滚动，长地面防滚出
        physics: { body: 'fixed', friction: 0.4, restitution: 0.05 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      const mk = (z, vx, name, mat) => createEntity('sphere', {
        name,
        transform: { pos: [0, 2.0, z], rot: [0, 0, 0] },
        params: { radius: 0.15 },
        physics: {
          body: 'dynamic', mass: 1, friction: 0.3, restitution: 0.05,
          linvel: [vx, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: mat },
        measured: true,
        source: 'preset',
      }, seq);
      const proj = mk(-0.3, 2, '平抛球（vx=2）', 'chrome');
      const drop = mk(0.3, 0, '自由落体球', 'brass');
      doc.entities.push(ground, proj, drop);
      doc.meta.assumptions = [
        '验证目标：平抛与自由落体同时落地——水平速度不影响下落时间，t=√(2h/g)≈0.61 s（球底高 1.85 m）',
        '平抛球水平位移 x=vx·t=2×0.61≈1.23 m（落地时刻两球 y 始终相同）',
        '两球 z=±0.3 错开防互碰；落地 e=0.05 防乱跳',
      ];
      return doc;
    },
  },

  rangeAngles: {
    id: 'rangeAngles', label: '斜抛射程角对照',
    build() {
      const doc = createEmptyDoc('斜抛射程角：30°/45°/60°');
      const seq = {};
      const v0 = 5;
      const ground = createEntity('ground', {
        name: '地面',
        transform: { pos: [16, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 36, sy: 0.1, sz: 2.4 },          // 落点 2.2~2.6 m，落地后滚动防滚出
        physics: { body: 'fixed', friction: 0.4, restitution: 0.05 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      const lanes = [
        { z: -0.5, deg: 30, mat: 'chrome' },
        { z: 0.0, deg: 45, mat: 'brass' },
        { z: 0.5, deg: 60, mat: 'rubber' },
      ];
      for (const { z, deg, mat } of lanes) {
        const th = deg * Math.PI / 180;
        doc.entities.push(createEntity('sphere', {
          name: `斜抛球 ${deg}°`,
          transform: { pos: [0, 0.12, z], rot: [0, 0, 0] },
          params: { radius: 0.12 },
          physics: {
            body: 'dynamic', mass: 1, friction: 0.3, restitution: 0.05,
            linvel: [v0 * Math.cos(th), v0 * Math.sin(th), 0], angvel: [0, 0, 0],
            linDamping: 0, angDamping: 0, gravityScale: 1,
          },
          render: { material: mat },
          measured: true,
          source: 'preset',
        }, seq));
      }
      doc.entities.unshift(ground);
      doc.meta.assumptions = [
        '验证目标：同速斜抛射程 R=v²·sin2θ/g（v=5）：30°→2.21 m、45°→2.55 m（最大）、60°→2.21 m（与 30° 对称）',
        '三球 z=−0.5/0/0.5 三泳道互不干扰',
        '落地 e=0.05 防乱跳；不计空气阻力（linDamping=0）',
      ];
      return doc;
    },
  },

  atwoodHeavy: {
    id: 'atwoodHeavy', label: '阿特伍德机（大质量比）',
    build() {
      const doc = createEmptyDoc('阿特伍德机：3:1 大质量比');
      const seq = {};
      // 定滑轮（固定轴承，视觉轮体）
      const pulley = createEntity('pulley', {
        name: '定滑轮',
        transform: { pos: [0, 3.0, 0], rot: [0, 0, 0] },
        params: { radius: 0.3 },
        source: 'preset',
      }, seq);
      // 两侧小球：m1=3（左/重）m2=1（右/轻）；绳长常数 C = 1.0 + 1.0 = 2.0
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
      const left = mkBall('左', -0.35, 3, 'chrome');
      const right = mkBall('右', 0.35, 1, 'brass');
      doc.entities.push(pulley, left, right);
      doc.meta.assumptions = [
        '轻绳不可伸长：y1+y2=常数（逐步投影约束），两侧竖直导轨理想化（无摆动）',
        '理论加速度 a=(m1−m2)g/(m1+m2)=2×9.81/4≈4.91 m/s²（3:1 质量比加速度显著）',
        '张力 T=2·m1·m2·g/(m1+m2)=2×3×1×9.81/4≈14.72 N；滑轮与绳质量不计（理想滑轮）',
      ];
      return doc;
    },
  },

  binaryStar: {
    id: 'binaryStar', label: '双星互绕',
    build() {
      const doc = createEmptyDoc('双星系统：绕质心互绕');
      doc.G = 1;                                       // 教学缩放引力常数（动力学同构）
      const seq = {};
      const m = 50, d = 4;
      const v = Math.sqrt(1 * m / (2 * d));            // v=√(G·m/(2d))=2.5 m/s（G=1）
      const mk = (x, vz, name, mat) => createEntity('celestial', {
        name,
        transform: { pos: [x, 0, 0], rot: [0, 0, 0] },
        params: { radius: 0.35 },
        physics: { mass: m, linvel: [0, 0, vz] },
        render: { material: mat },
        measured: true,
        source: 'preset',
      }, seq);
      const a = mk(-d / 2, -v, '恒星 A (50kg)', 'sun');
      const b = mk(d / 2, v, '恒星 B (50kg)', 'saturn');
      doc.entities.push(a, b);
      doc.meta.assumptions = [
        '验证目标：双星绕共同质心（原点）互绕，圆轨道条件 v=√(G·m/(2d))=√(50/8)=2.5 m/s（d=4、质量相等）',
        '周期 T=2π·(d/2)/v=2π×2/2.5≈5.03 s；两星轨迹为等半径圆（r=d/2=2 m）',
        '文档引力常数 G=1（教学缩放）；初始总动量为零（质心静止），velocity-Verlet 辛积分零扩展',
      ];
      return doc;
    },
  },

  threeBody: {
    id: 'threeBody', label: '三星拉格朗日解',
    build() {
      const doc = createEmptyDoc('三星系统：拉格朗日等边三角形解');
      doc.G = 1;                                       // 教学缩放引力常数
      const seq = {};
      const m = 30, a = 3;
      const R = a / Math.sqrt(3);                      // 外接圆半径
      const v = Math.sqrt(1 * m / a);                  // v=√(G·m/a)=√10≈3.16 m/s（G=1）
      const mats = ['sun', 'saturn', 'marble'];
      for (let i = 0; i < 3; i++) {
        const phi = i * 2 * Math.PI / 3;               // 等边三角形顶点（xz 平面）
        doc.entities.push(createEntity('celestial', {
          name: `星体 ${i + 1} (30kg)`,
          transform: {
            pos: [R * Math.cos(phi), 0, R * Math.sin(phi)],
            rot: [0, 0, 0],
          },
          params: { radius: 0.25 },
          physics: {
            mass: m,
            linvel: [-v * Math.sin(phi), 0, v * Math.cos(phi)],   // 切向（绕质心同向）
          },
          render: { material: mats[i] },
          measured: true,
          source: 'preset',
        }, seq));
      }
      doc.meta.assumptions = [
        '验证目标：拉格朗日等边三角形解——三星绕质心整体刚性旋转，各切向 v=√(G·m/a)=√(30/3)≈3.16 m/s（a=3）',
        '周期 T=2π/ω，ω=√(G·3m/a³)≈1.83 rad/s → T≈3.44 s（三角形边长 3 m 保持不变）',
        'G=1 教学缩放；三体系统一般混沌，此特殊解对初值敏感：约 20 s 内演化可信，此后数值漂移逐渐放大',
      ];
      return doc;
    },
  },

  rollRace: {
    id: 'rollRace', label: '滚动竞速（球 vs 圆柱）',
    build() {
      const doc = createEmptyDoc('滚动竞速：球 vs 圆柱');
      const seq = {};
      const Lb = 3.0, H = 0.8;                         // 坡角 atan(0.8/3)≈14.9°≈15°
      const hyp = Math.hypot(Lb, H);
      const nx = H / hyp, ny = Lb / hyp;               // 坡面法向 (sinθ, cosθ)
      const tx = Lb / hyp, ty = -H / hyp;              // 坡面向下方向
      const r = 0.1, s0 = 0.15;                        // 起点距坡顶 0.15 m（坡面弧长）
      const ax = -Lb / 2 + s0 * tx, ay = 0.85 + s0 * ty;   // 坡顶 (−1.5, 0.85)（含 ramp 抬高 0.05）
      const cx = ax + r * nx, cy = ay + r * ny + 0.01; // 球心 = 表面点 + r·n̂（+0.01 沉降余量）
      const ground = createEntity('ground', {
        name: '地面板',
        transform: { pos: [16, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 40, sy: 0.1, sz: 2 },            // 坡底出速 ~3.3 m/s，长地面防滚出
        source: 'preset',
      }, seq);
      const ramp = createEntity('ramp', {
        name: '缓坡（≈15°）',
        transform: { pos: [0, 0.05, 0], rot: [0, 0, 0] },
        params: { length: Lb, height: H, width: 0.6 },  // 坡宽 0.6 ≥ 2.2×半径 防侧翻出坡
        physics: { body: 'fixed', friction: 0.5 },      // 与滚动物同 μ（平均合成 0.5，纯滚动充足）
        source: 'preset',
      }, seq);
      const ball = createEntity('sphere', {
        name: '实心球 (1kg)',
        transform: { pos: [cx, cy, -0.15], rot: [0, 0, 0] },
        params: { radius: r },
        physics: {
          body: 'dynamic', mass: 1, friction: 0.5, restitution: 0.05,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      const cyl = createEntity('cylinder', {
        name: '实心圆柱 (1kg)',
        transform: { pos: [cx, cy, 0.15], rot: [Math.PI / 2, 0, 0] },   // 轴向放倒沿 z，沿坡滚下
        params: { radius: r, height: 0.2, spokes: 0 },
        physics: {
          body: 'dynamic', mass: 1, friction: 0.5, restitution: 0.05,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'brass' },
        measured: true,
        source: 'preset',
      }, seq);
      doc.entities.push(ground, ramp, ball, cyl);
      doc.meta.assumptions = [
        '验证目标：同质量（1kg）同半径（0.1m）的实心球与实心圆柱比赛下滑——球 a=5/7·g·sinθ≈1.80 m/s² 先到，圆柱 a=2/3·g·sinθ≈1.69 m/s²',
        '差别来自转动惯量（球 2/5mr²、圆柱 1/2mr²）：同样势能下降，圆柱把更多能量分给转动',
        '坡角 ≈15°（14.9°）；μ=0.5 ≥ (2/7)tanθ≈0.075 保证纯滚动；坡宽 0.6 m ≥ 2.2×半径 防侧翻出坡',
      ];
      return doc;
    },
  },

  frictionLock: {
    id: 'frictionLock', label: '摩擦自锁（临界角）',
    build() {
      const doc = createEmptyDoc('摩擦自锁：tanθ=μ 临界');
      const seq = {};
      const Lb = 1.6, H = 0.8;                         // 坡角 atan(0.8/1.6)=26.57°（tanθ=0.500）
      const th = Math.atan2(H, Lb);
      const hyp = Math.hypot(Lb, H);
      const nx = H / hyp, ny = Lb / hyp;
      const tx = Lb / hyp, ty = -H / hyp;
      const s0 = 0.55, half = 0.12;                    // 方块半高 0.12（0.24³ 块）
      const ax = -Lb / 2 + s0 * tx, ay = 0.85 + s0 * ty;   // 坡面表面点（ramp 抬高 0.05）
      const ground = createEntity('ground', {
        name: '地面板',
        transform: { pos: [0, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 6, sy: 0.1, sz: 3 },
        source: 'preset',
      }, seq);
      const ramp = createEntity('ramp', {
        name: '斜坡（26.57°）',
        transform: { pos: [0, 0.05, 0], rot: [0, 0, 0] },
        params: { length: Lb, height: H, width: 0.5 },  // 默认 1.6×0.8 即 26.57°
        physics: { body: 'fixed', friction: 0.5 },      // 与块同 μ（平均合成得配对值 0.5）
        source: 'preset',
      }, seq);
      const block = createEntity('box', {
        name: '方块 (μ=0.5)',
        transform: {
          pos: [ax + half * nx, ay + half * ny, 0],     // 块心 = 表面点 + (h/2)·n̂
          rot: [0, 0, -th],                             // 贴坡面姿态（局部 y 对齐坡面法向）
        },
        params: { sx: 0.24, sy: 0.24, sz: 0.24 },
        physics: {
          body: 'dynamic', mass: 1, friction: 0.5, restitution: 0.05,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'wood' },
        measured: true,
        source: 'preset',
      }, seq);
      doc.entities.push(ground, ramp, block);
      doc.meta.assumptions = [
        '验证目标：摩擦自锁临界条件 tanθ=μ——坡角 26.57°（tanθ=0.500）恰与 μ=0.5 相等，处于自锁临界',
        '引擎摩擦无静/动摩擦之分（单一动摩擦模型）：临界附近方块会有缓慢蠕变，属数值现象而非物理结论',
        '摩擦按两接触面平均合成：块与坡面同设 μ=0.5；检查器微调坡高跨临界（26.57°±）可观察 静止↔滑动 切换',
      ];
      return doc;
    },
  },

  blockOnBlock: {
    id: 'blockOnBlock', label: '板块模型（滑板叠块）',
    build() {
      const doc = createEmptyDoc('板块模型：地面光滑+叠面摩擦');
      const seq = {};
      const ground = createEntity('ground', {
        name: '光滑地面',
        transform: { pos: [6, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 28, sy: 0.1, sz: 3 },            // 共速 1.33 m/s 长滑行需长地面
        physics: { body: 'fixed', friction: 0, restitution: 0.1 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      // 板 μ=0、滑块 μ=0.8：叠面有效 μ=avg(0,0.8)=0.4，板-地有效 μ=avg(0,0)=0（两侧接触面各取所需）
      const board = createEntity('box', {
        name: '滑板 (2kg, v0=2)',
        transform: { pos: [0, 0.1, 0], rot: [0, 0, 0] },
        params: { sx: 1.2, sy: 0.2, sz: 0.6 },
        physics: {
          body: 'dynamic', mass: 2, friction: 0, restitution: 0,
          linvel: [2, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'wood' },
        measured: true,
        source: 'preset',
      }, seq);
      const slider = createEntity('box', {
        name: '滑块 (1kg)',
        transform: { pos: [0, 0.35, 0], rot: [0, 0, 0] },   // 叠放：板顶 0.2 + 块半高 0.15
        params: { sx: 0.3, sy: 0.3, sz: 0.3 },
        physics: {
          body: 'dynamic', mass: 1, friction: 0.8, restitution: 0,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      doc.entities.push(ground, board, slider);
      doc.meta.assumptions = [
        '验证目标：板块模型动量守恒（地面光滑）→ 共速 v′=m板·v0/(m板+m块)=2×2/3≈1.33 m/s',
        '叠面有效摩擦 μ=0.4（引擎取两接触面平均：板 μ=0、滑块 μ=0.8 → 板-地 μ=0 光滑）',
        '摩擦生热 Q=μ·m块·g·d相对≈0.4×9.81×0.34≈1.33 J = 初始动能 4 J − 末动能 2.67 J（能量守恒对照）',
      ];
      return doc;
    },
  },

  weightless: {
    id: 'weightless', label: '失重演示（力传感器）',
    build() {
      const doc = createEmptyDoc('失重演示：力传感器读数');
      const seq = {};
      const ground = createEntity('ground', {
        name: '地面',
        transform: { pos: [4, -0.05, 0], rot: [0, 0, 0] },
        params: { sx: 16, sy: 0.1, sz: 3 },            // 落地弹跳滚动段防滚出
        physics: { body: 'fixed', friction: 0.6, restitution: 0.2 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      const ball = createEntity('sphere', {
        name: '抛体球',
        transform: { pos: [0, 1.5, 0], rot: [0, 0, 0] },
        params: { radius: 0.15 },
        physics: {
          body: 'dynamic', mass: 1, friction: 0.4, restitution: 0.2,
          linvel: [1.2, 3, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      // 力传感器：绑定单个动态体（attach:[id]），实时读接触合力（支持力+摩擦）
      const sensor = createEntity('forceSensor', {
        name: '力传感器→抛体球',
        attach: [ball.id],
        transform: { pos: [0.6, 0.03, 0], rot: [0, 0, 0] },
        source: 'preset',
      }, seq);
      doc.entities.push(ground, ball, sensor);
      doc.meta.assumptions = [
        '验证目标：力传感器读接触合力——自由飞行段 ≈0 N（失重：a=g，视重为零），落地静止后 ≈mg=9.81 N',
        '球上抛初速 (1.2, 3) m/s：飞行约 0.91 s，全程失重读数 0',
        '传感器绑定单个动态体（attach 一元数组）；读数口径为支持力+摩擦的接触合力，已做线阻尼补偿（linDamping=0 时精确）',
      ];
      return doc;
    },
  },

  curvedRace: {
    id: 'curvedRace', label: '曲面滑道竞速（形状 vs 时间）',
    build() {
      const doc = createEmptyDoc('曲面滑道竞速：末速相同，耗时不同');
      const seq = {};
      const H = 1.0, drop = 0.825;
      // 左：直坡（26.6°）；右：凹曲面 curveExp=1.6（顶端陡、底端渐平）——同落差同放
      const ground = createEntity('ground', {
        name: '接引地面',
        transform: { pos: [0.2, 0, 0], rot: [0, 0, 0] },
        params: { sx: 9, sy: 0.1, sz: 6 },
        physics: { body: 'fixed', friction: 0.5, restitution: 0.2 },
        render: { material: 'steelDark' },
        source: 'preset',
      }, seq);
      const ramp = createEntity('ramp', {
        name: '直坡',
        transform: { pos: [-2.2, 0.05, 0], rot: [0, 0, 0] },
        params: { length: 2.0, height: H, width: 0.5 },
        physics: { body: 'fixed', friction: 0, restitution: 0.05 },
        render: { material: 'marble' },
        source: 'preset',
      }, seq);
      const cr = createEntity('curvedRamp', {
        name: '凹曲面滑道',
        transform: { pos: [2.2, 0.05, 0], rot: [0, 0, 0] },
        params: { length: 2.4, height: H, width: 0.5, curveExp: 1.6 },
        physics: { body: 'fixed', friction: 0, restitution: 0.05 },
        render: { material: 'marble' },
        source: 'preset',
      }, seq);
      // 两球落差严格一致（0.825 m）：曲面球 u0=0.1153 → (1−u)^1.6=0.825
      const u0 = 1 - Math.pow(drop / H, 1 / 1.6);
      const ballA = createEntity('sphere', {
        name: '直坡球',
        transform: { pos: [-2.85, 0.05 + 0.825 + 0.1 / Math.cos(Math.atan(0.5)) + 0.005, 0], rot: [0, 0, 0] },
        params: { radius: 0.1 },
        physics: {
          body: 'dynamic', mass: 1, friction: 0, restitution: 0,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      const ballB = createEntity('sphere', {
        name: '曲面球',
        transform: { pos: [2.2 - 1.2 + u0 * 2.4, 0.05 + drop + 0.105 + 0.005, 0], rot: [0, 0, 0] },
        params: { radius: 0.1 },
        physics: {
          body: 'dynamic', mass: 1, friction: 0, restitution: 0,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'brass' },
        measured: true,
        source: 'preset',
      }, seq);
      doc.entities.push(ground, ramp, cr, ballA, ballB);
      doc.meta.assumptions = [
        '验证目标：两球落差相同（0.825 m），坡底末速理论同为 √(2gH)=4.03 m/s——末速与滑道形状无关',
        '耗时不同：凹曲面顶端陡（33°）先获得速度，先到坡底；直坡（26.6°）匀加速后到',
        '光滑接触（双方 friction=0，滑动无滚转）；接触式真实法向力——凹面法向力大于 mg·cosθ',
      ];
      return doc;
    },
  },

  bowlOsc: {
    id: 'bowlOsc', label: '碗中小球（曲面版单摆）',
    build() {
      const doc = createEmptyDoc('碗内曲面震荡：回复力与周期');
      const seq = {};
      const R = 0.8, D = 0.35, r = 0.08;
      const Rs = (R * R + D * D) / (2 * D);          // 1.089 m
      const phi0 = Math.asin(0.44 / Rs);
      const bowl = createEntity('bowl', {
        name: '碗形曲面',
        transform: { pos: [0, 0.02, 0], rot: [0, 0, 0] },
        params: { radius: R, depth: D },
        physics: { body: 'fixed', friction: 0, restitution: 0.05 },
        render: { material: 'marble' },
        source: 'preset',
      }, seq);
      const ball = createEntity('sphere', {
        name: '震荡球',
        transform: { pos: [(Rs - r) * Math.sin(phi0), 0.02 + Rs - (Rs - r) * Math.cos(phi0), 0], rot: [0, 0, 0] },
        params: { radius: r },
        physics: {
          body: 'dynamic', mass: 0.3, friction: 0, restitution: 0,
          linvel: [0, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      doc.entities.push(bowl, ball);
      doc.meta.assumptions = [
        '验证目标：碗面=球冠（Rs=(R²+D²)/(2D)=1.089 m），微幅周期 T=2π√((Rs−r)/g)≈2.02 s——曲面版单摆',
        '回复力=重力切向分量（光滑碗面 friction=0 滑动）；释放幅度 23.9°，周期略长于微幅公式约 1%',
        '能量往复：最低点动能最大、最高点势能最大，守恒条与曲线图可直接对照',
      ];
      return doc;
    },
  },

  waveRoad: {
    id: 'waveRoad', label: '波浪路面（不规则地形）',
    build() {
      const doc = createEmptyDoc('波浪路面：波峰跳跃与法向力');
      const seq = {};
      const road = createEntity('waveFloor', {
        name: '波浪路面',
        transform: { pos: [0, 0, 0], rot: [0, 0, 0] },
        params: { sx: 6, sz: 1.2, waveLen: 0.8, waveAmp: 0.05 },
        physics: { body: 'fixed', friction: 0.1, restitution: 0.1 },
        render: { material: 'marble' },
        source: 'preset',
      }, seq);
      const ball = createEntity('sphere', {
        name: '滚球',
        transform: { pos: [-2.4, 0.05 * 1.35 + 0.12 + 0.05, 0], rot: [0, 0, 0] },
        params: { radius: 0.12 },
        physics: {
          body: 'dynamic', mass: 0.8, friction: 0.05, restitution: 0.05,
          linvel: [2.4, 0, 0], angvel: [0, 0, 0],
          linDamping: 0, angDamping: 0.02, gravityScale: 1,
        },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      doc.entities.push(road, ball);
      doc.meta.assumptions = [
        '验证目标：双频叠加不规则路面（横向 0.7 倍频调制），波峰曲率半径 ρ=1/(A·k²)≈0.32 m',
        '临界脱离速度 √(gρ)≈1.78 m/s < 球速 2.4 m/s → 波峰周期性跳离（颠簸），落回后继续',
        '法向力随坡度连续变化：波谷压紧（N>mg·cosθ）、波峰趋离（N<mg·cosθ）——轨迹速度渐变色可见快慢',
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

// PL-43 预置相机位：教学动线的主视角（pos=相机位，target=注视点）。
// 只收主推教学预置；未列出的预置走 focusScene 自动取景（全实体包围盒平滑飞行）。
export const PRESET_CAMERA = {
  incline: { pos: [2.6, 1.9, 3.6], target: [0.5, 0.6, 0] },
  momentum: { pos: [1.8, 1.5, 4.0], target: [0, 0.4, 0] },
  momentum2d: { pos: [2.4, 2.0, 3.4], target: [0.2, 0.4, 0] },
  projectile: { pos: [2.8, 1.8, 4.4], target: [1.4, 0.8, 0] },
  pendulum: { pos: [1.6, 1.8, 3.2], target: [0, 1.0, 0] },
  atwood: { pos: [2.0, 3.0, 4.2], target: [0, 2.0, 0] },
  newtonCradle: { pos: [1.4, 1.6, 3.0], target: [0, 0.8, 0] },
  ballChain: { pos: [2.2, 1.8, 3.6], target: [0, 0.6, 0] },
  collLab: { pos: [2.0, 1.7, 4.0], target: [0, 0.6, 0] },
  classic: { pos: [2.6, 2.0, 4.2], target: [0.4, 0.8, 0] },
  threeBody: { pos: [0, 10, 18], target: [0, 0, 0] },
  binaryStar: { pos: [0, 8, 14], target: [0, 0, 0] },
  curvedRace: { pos: [0.2, 2.2, 6.8], target: [0, 0.5, 0] },
  bowlOsc: { pos: [1.3, 1.3, 2.8], target: [0, 0.25, 0] },
  waveRoad: { pos: [0, 2.6, 5.4], target: [0, 0.12, 0] },
};
