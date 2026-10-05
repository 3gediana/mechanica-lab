// juice-samples.mjs — 层 3 视觉样张生成（headed 真 GPU）：三材质粒子爆发、碰撞环两阶段、
// 震屏峰值/对照同机位对、运行态整体氛围。产出 tools/ui-test/shots/juice-*.png 供双轮评审。
// 环/震屏用 juice.freezeAt 诊断时钟冻结相位（CDP 截图延迟 ~200ms 无法命中 150ms 闪光——
// 第一轮评审教训），粒子走真实演化（寿命 ≥0.45s 可覆盖延迟）。
// 用法：node juice-samples.mjs（前置 MECH_BASE 服务存活）
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: false, args: ['--window-size=1500,900'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 820 } })).newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 30000 });
  await page.evaluate(() => { window.MECH.perfHud(false); window.MECH.__vp.resetView(); });

  const setupDrop = (material, height, mass = 1, extra = {}) => page.evaluate(({ material: m, height: h, mass: mm, extra: ex }) => {
    const M = window.MECH;
    M.resetSim();
    M.setShake(true);
    M.loadPreset('empty');
    M.addComponent('ground');
    M.addComponent('sphere', { transform: { pos: [0, h, 0] }, physics: { mass: mm, linvel: [0, -5, 0], restitution: ex.rest ?? 0.1 }, render: { material: m } });
    document.getElementById('btnPlay').click();
  }, { material, height, mass, extra });

  // ---- 1. 三材质粒子爆发（真实演化，撞击后 ~250ms 抓帧：尘雾/火花展开期） ----
  for (const mat of ['ceramic', 'wood', 'rubber']) {
    await setupDrop(mat, 1.6);
    await page.waitForFunction(() => window.MECH.juiceState().spawnedTotal > 0, null, { timeout: 8000, polling: 30 });
    await page.waitForTimeout(60);
    await page.screenshot({ path: join(OUT, `juice-particles-${mat}.png`) });
    await page.evaluate(() => window.MECH.resetSim());
  }

  // ---- 2. 碰撞环两阶段（freezeAt 冻结相位：闪光期 55ms / 扩张期 330ms） ----
  await setupDrop('marble', 2.2, 2, { rest: 0 });
  await page.waitForFunction(() => window.MECH.impactCount() > 0, null, { timeout: 8000, polling: 30 });
  await page.evaluate(() => {
    const J = window.MECH.__juice;
    J.freezeAt = J._rings[0].birth + 0.055;   // 闪光相位
    J._age.fill(-1);                          // 粒子清场，环构图纯净
    J._points.visible = false;
  });
  await page.waitForTimeout(120);             // 冻结已生效，CDP 延迟无碍
  await page.screenshot({ path: join(OUT, 'juice-ring-flash.png') });
  await page.evaluate(() => {
    const J = window.MECH.__juice;
    J.freezeAt = J._rings[0].birth + 0.33;    // 扩张相位
  });
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(OUT, 'juice-ring-expand.png') });
  await page.evaluate(() => { window.MECH.__juice.freezeAt = null; window.MECH.resetSim(); });

  // ---- 3. 震屏对（同机位同 sim 状态：强制 trauma + 冻结衰减 → 恒定可见偏移；对照=关） ----
  await setupDrop('steelDark', 2.6, 4, { rest: 0 });
  await page.waitForFunction(() => window.MECH.state().simT > 1.4, null, { timeout: 8000, polling: 100 });
  await page.evaluate(() => {
    const J = window.MECH.__juice;
    J.trauma = 0.85;                          // 峰值能量
    J.freezeAt = performance.now() / 1000 + 60;   // 冻结衰减（tick 早退），偏移恒定
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, 'juice-shake-peak.png') });
  await page.evaluate(() => {
    const J = window.MECH.__juice;
    J.freezeAt = null;
    J.trauma = 0;
    J.setShake(false);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'juice-shake-off.png') });
  await page.evaluate(() => { window.MECH.__juice.setShake(true); window.MECH.resetSim(); });

  // ---- 4. 运行态整体氛围（collLab 满配叠加层） ----
  await page.evaluate(() => {
    const M = window.MECH;
    M.resetSim();
    M.loadPreset('collLab');
    for (const b of ['btnVectors', 'btnCons', 'btnCurves']) document.getElementById(b).classList.add('hot');
    M.play();
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, 'juice-ambient-run.png') });

  console.log('samples done → shots/juice-*.png');
} finally {
  await browser.close();
}
