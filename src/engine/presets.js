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
        physics: { ...rampDefaultBall(), mass: 1 },
        render: { material: 'chrome' },
        measured: true,
        source: 'preset',
      }, seq);
      doc.entities.push(ground, ramp, ball);
      return doc;
    },
  },
};

function rampDefaultBall() {
  return {
    body: 'dynamic', friction: 0.3, restitution: 0.1,
    linvel: [0, 0, 0], angvel: [0, 0, 0],
    linDamping: 0.02, angDamping: 0.02, gravityScale: 1,
  };
}

export function getPreset(id) {
  const p = PRESETS[id];
  if (!p) throw new Error(`未知预置: ${id}`);
  return p.build();
}
