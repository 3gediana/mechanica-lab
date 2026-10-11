// scalecoll.mjs — B4 假设验证：视觉缩放体的碰撞一致性（缩放 2x 的球 vs 正常球落体）
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto('http://127.0.0.1:8722', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
const r = await page.evaluate(() => {
  const M = window.MECH;
  M.loadPreset('empty');
  M.addComponent('ground');
  // 大球：视觉缩放 2x（视觉半径 0.3），放在地上
  const big = M.addComponent('sphere', { transform: { pos: [0, 0.3, 0], scale: [2, 2, 2] }, physics: { mass: 1, body: 'fixed' } });
  // 小球从高处落下，x 对齐
  const small = M.addComponent('sphere', { transform: { pos: [0, 2.2, 0] }, physics: { mass: 1, restitution: 0.3 } });
  M.play();
  const bound = M.doc().entities.map((e) => ({ id: e.id, bound: !!M.__vp._bindLookup(e.id), t: !!M.telemetry(e.id) }));
  return { n: M.doc().entities.length, bound, bigInDoc: !!M.doc().entities.find((e) => e.id === big), big, small };
});
console.log(JSON.stringify(r));
const r2 = await page.evaluate((ids) => {
  const M = window.MECH;
  const bb = M.__vp._bindLookup(ids.big), sb = M.__vp._bindLookup(ids.small);
  if (!bb || !sb) return { err: 'bind missing' };
  let minD = 1e9;
  for (let i = 0; i < 360; i++) {
    M.stepOnce();
    const d = Math.hypot(bb.mesh.position.x - sb.mesh.position.x, bb.mesh.position.y - sb.mesh.position.y, bb.mesh.position.z - sb.mesh.position.z);
    if (d < minD) minD = d;
  }
  return { minD: +minD.toFixed(3), visualTouch: 0.45 };
}, r);
console.log(JSON.stringify(r2));
await browser.close();
