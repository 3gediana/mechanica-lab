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
};

export function getPreset(id) {
  const p = PRESETS[id];
  if (!p) throw new Error(`未知预置: ${id}`);
  return p.build();
}
