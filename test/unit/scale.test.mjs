// scale.test.mjs — 视觉缩放→碰撞参数同步单测（B4）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') {
      return { url: pathToFileURL(join(ROOT, 'vendor/three/three.module.js')).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { scaleShapeParams } = await import(pathToFileURL(join(ROOT, 'src/engine/runtime.js')).href);

test('B4 球缩放：三轴均值', () => {
  const p = scaleShapeParams('sphere', { radius: 0.15 }, [2, 2, 2]);
  assert.equal(p.radius, 0.3);
});

test('B4 盒按轴分量', () => {
  const p = scaleShapeParams('box', { sx: 0.3, sy: 0.2, sz: 0.2 }, [2, 1, 0.5]);
  assert.equal(p.sx, 0.6); assert.equal(p.sy, 0.2); assert.equal(p.sz, 0.1);
});

test('B4 圆柱：半径取 (kx+kz)/2 高取 ky', () => {
  const p = scaleShapeParams('cylinder', { radius: 0.12, height: 0.3 }, [2, 3, 2]);
  assert.equal(p.radius, 0.24); assert.equal(p.height, 0.9);
});

test('B4 单位缩放/非法输入返回 null', () => {
  assert.equal(scaleShapeParams('sphere', { radius: 0.15 }, [1, 1, 1]), null);
  assert.equal(scaleShapeParams('sphere', { radius: 0.15 }, null), null);
  assert.equal(scaleShapeParams('sphere', { radius: 0.15 }, [0, 1, 1]), null);
});

test('B4 无形状参类型（曲面/复合）返回 null（仅视觉）', () => {
  assert.equal(scaleShapeParams('ramp', { angleDeg: 30, length: 2 }, [2, 2, 2]), null);
  assert.equal(scaleShapeParams('track', { arcFraction: 0.6 }, [2, 2, 2]), null);
});
