// buoyancy.js — 液体浮力纯数学（U-LIQ）：静水中规则体的浸没体积。
// 约定：球用精确球缺（教学口径——漂浮液面高度要定量可信）；其余形状用世界 AABB 与
// 水域 AABB 的重叠体积（旋转体按 AABB 高估→「偏乐观漂浮」保守近似，组件描述已注明）。
// 纯几何无运行时依赖，单测直测。

// 球缺体积：h=浸没高度(0..2r)，V=πh²(3r−h)/3
export function sphereSubmergedVolume(r, h) {
  if (!(r > 0)) return 0;
  const hh = Math.max(0, Math.min(2 * r, h));
  return (Math.PI * hh * hh * (3 * r - hh)) / 3;
}

// AABB 重叠体积：任一轴不重叠→0
export function overlapVolume(minA, maxA, minB, maxB) {
  let v = 1;
  for (let i = 0; i < 3; i++) {
    const lo = Math.max(minA[i], minB[i]);
    const hi = Math.min(maxA[i], maxB[i]);
    if (hi <= lo) return 0;
    v *= hi - lo;
  }
  return v;
}

// 浸没体积（实体口径）：type==='sphere' 走球缺，其余走 AABB 重叠
export function submergedVolume(type, box, center, r, wMin, wMax) {
  if (type === 'sphere' && r > 0) {
    return sphereSubmergedVolume(r, wMax[1] - (center[1] - r));
  }
  return overlapVolume(box.min, box.max, wMin, wMax);
}
