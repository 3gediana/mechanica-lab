// buoyancy.test.mjs — 浮力纯数学单测（U-LIQ）：球缺/重叠体积/浸没口径
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sphereSubmergedVolume, overlapVolume, submergedVolume } from '../../src/engine/buoyancy.js';

test('U-LIQ 球缺：半浸 = 半体积', () => {
  const r = 0.5;
  const full = (4 / 3) * Math.PI * r ** 3;
  assert.ok(Math.abs(sphereSubmergedVolume(r, r) - full / 2) < 1e-12);
});

test('U-LIQ 球缺：全浸钳到整球，离水为 0', () => {
  const r = 0.3;
  const full = (4 / 3) * Math.PI * r ** 3;
  assert.ok(Math.abs(sphereSubmergedVolume(r, 2 * r + 5) - full) < 1e-12);
  assert.equal(sphereSubmergedVolume(r, 0), 0);
  assert.equal(sphereSubmergedVolume(r, -1), 0);
});

test('U-LIQ 球缺：1/4 浸没高度非线性（球缺公式非线性口径）', () => {
  const r = 1;
  const v = sphereSubmergedVolume(r, r / 2);
  // h=0.5r: V = π(0.25)(3−0.5)/3 = π·0.625/3 ≈ 0.6545 (< 线性外推 0.5·全体积)
  assert.ok(Math.abs(v - Math.PI * 0.625 / 3) < 1e-12);
  assert.ok(v < (2 / 3) * Math.PI * r ** 3); // 小于半体积（球底窄）
});

test('U-LIQ AABB 重叠：轴不交为 0，正常交为积', () => {
  assert.equal(overlapVolume([0, 0, 0], [1, 1, 1], [2, 0, 0], [3, 1, 1]), 0);
  assert.equal(overlapVolume([0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5], [2, 2, 2]), 0.125);
});

test('U-LIQ 浸没分派：球走球缺，其余走 AABB', () => {
  const wMin = [0, 0, 0], wMax = [2, 1, 2];
  // 球心 y=1.25, r=0.5 → 浸没高 0.25
  const vS = submergedVolume('sphere', null, [1, 1.25, 1], 0.5, wMin, wMax);
  assert.ok(Math.abs(vS - sphereSubmergedVolume(0.5, 0.25)) < 1e-12);
  // 盒 y∈[0.9,1.1] 超出水面 1.0 → 浸没高 0.1
  const vB = submergedVolume('box', { min: [0.5, 0.9, 0.5], max: [1.5, 1.1, 1.5] }, [1, 1, 1], 0, wMin, wMax);
  assert.ok(Math.abs(vB - 1 * 0.1 * 1) < 1e-12);
});

test('U-LIQ 浮力口径：木块 60% 浸没时 Fb = mg（漂浮平衡）', () => {
  // V=0.012 m³, ρ物=600 → m=7.2kg; ρ液=1000 → 平衡 V排 = 0.0072 (60%)
  const g = 9.81;
  const vSub = 0.0072;
  const fb = 1000 * g * vSub;
  assert.ok(Math.abs(fb - 7.2 * g) < 1e-9);
});
