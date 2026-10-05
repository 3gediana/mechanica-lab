// p34-perf.mjs — 前沿0 性能验收（PL-50）：headed 真 GPU 采样最重预置 30s 帧成本。
// headless rAF 饿死是本项目已验证的坑（p8/w1 实测物理掉到 ~1fps）——本套件必须 headed 跑，
// headless 数字不作数。验收：每预置 p95 帧成本 ≤5ms、无 >8ms 尖峰、HUD 可见、数据落 perf-raw。
// 用法：node p34-perf.mjs [--quick]   （--quick 每预置 10s，日常冒烟；验收必须全量 30s）
// 前置：MECH_BASE（默认 http://127.0.0.1:8721）服务存活。
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
const QUICK = process.argv.includes('--quick');
const RUN_SEC = QUICK ? 10 : 30;         // 采样时长（预热 3s 另计，不计入窗口）
const WARMUP_SEC = 3;
// 最重预置（Goal 指定：三星天体/牛顿摆碰撞链）+ 碰撞链/碰撞实验台（碰撞风暴 + 叠加层满载）
const CASES = [
  { id: 'threeBody', overlays: ['btnTrails', 'btnCons', 'btnCurves'] },     // n 体自积分 480 次/s + 轨迹
  { id: 'newtonCradle', overlays: ['btnVectors', 'btnCons', 'btnCurves'] }, // 碰撞链：报告/碰撞环风暴
  { id: 'ballChain', overlays: ['btnVectors', 'btnTrails', 'btnCons'] },    // 7 球链式碰撞
  { id: 'collLab', overlays: ['btnVectors', 'btnForces', 'btnCons'] },      // 力箭头满载
];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};

const browser = await chromium.launch({
  headless: false,
  args: [
    '--window-size=1600,950',
    // headed 窗口失焦时 Chrome 把 rAF 节流到 ~20fps（实测 30s 只跑 600 帧）——禁三路后台节流，
    // 否则帧成本样本是"低帧率大步长"口径，不作数（与 headless rAF 饿死同性质）
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const consoleErrors = [];
  page.on('console', (m) => {
    const loc = m.location()?.url || '';
    if (m.type() === 'error' && !loc.includes('/api/') && !loc.includes('favicon')) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('favicon')) consoleErrors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 30000 });

  const rawDir = join(dirname(fileURLToPath(import.meta.url)), 'shots');
  mkdirSync(rawDir, { recursive: true });
  const allRaw = {};

  for (const c of CASES) {
    // 载入预置（UI 黑盒走下拉 + MECH 载入等价路径——p32 已覆盖下拉，这里用 API 直载保确定性）
    await page.evaluate((id) => { window.MECH.resetSim(); window.MECH.loadPreset(id); }, c.id);
    await page.waitForFunction(() => window.MECH.doc().entities.length > 0);
    for (const btn of c.overlays) {
      const hot = await page.evaluate((b) => document.getElementById(b).classList.contains('hot'), btn);
      if (!hot) await page.click(`#${btn}`);
    }
    // HUD 开关存在且可见（PL-50 验收形式：HUD 常开可见）
    const hudVisible = await page.evaluate(() => {
      const el = document.getElementById('perfHud');
      return !!el && el.style.display !== 'none';
    });
    if (!hudVisible) await page.evaluate(() => window.MECH.perfHud(true));

    await page.evaluate(() => window.MECH.play());
    // 预热（着色器编译/JIT）：simT 与墙钟对齐推进，rAF 健康时 3s 模拟 = 3s 墙钟
    await page.waitForFunction((s) => window.MECH.state().simT >= s, WARMUP_SEC, { timeout: 30000 });
    // 采样窗：真实墙钟推进 RUN_SEC 秒（simT 达标 = rAF 活跃 + 物理未欠载）。
    // 轮询必须低频（500ms）：waitForFunction 默认 rAF 轮询 = 每帧一次 CDP evaluate，
    // 30s × 240fps 的往返风暴会把主线程打到 ~13fps 并制造周期性百毫秒级假尖峰（实测教训）
    const okRun = await page.waitForFunction(
      (lim) => window.MECH.state().simT >= lim,
      WARMUP_SEC + RUN_SEC, { timeout: (RUN_SEC + 25) * 1000, polling: 500 },
    ).then(() => true).catch(() => false);

    const sum = await page.evaluate(() => {
      const s = window.MECH.perf(2400);
      // ring 容量 2400（240Hz×10s）：30s 运行窗内 ring 全满，且最早样本也远晚于预热期——
      // 直接取全环（2400 帧样本横跨运行窗最近 ≥10s，GC 周期性尖峰必被覆盖）
      return { ...s, windowRaw: window.MECH.perfSamples('frame', 2400) };
    });

    // rAF 健康门：预热后实测帧率 ≥45Hz 才算有效样本（低于此=节流环境，数字不作数）
    check(`${c.id}: rAF 健康门（≥45fps，非节流环境）`, sum.fps >= 45, `fps=${sum.fps}`);

    const raw = sum.windowRaw.filter((v) => Number.isFinite(v));
    raw.sort((a, b) => a - b);
    const p = (q) => raw.length ? raw[Math.min(raw.length - 1, Math.round(q * (raw.length - 1)))] : NaN;
    const p95 = p(0.95), max = raw.length ? raw[raw.length - 1] : NaN, p50 = p(0.5);
    const spikes8 = raw.filter((v) => v > 8).length;

    check(`${c.id}: 采样窗推进成功（rAF 存活）`, okRun && raw.length > 300, `frames=${raw.length} total=${sum.total}`);
    check(`${c.id}: p95 帧成本 ≤5ms`, p95 <= 5, `p50=${p50.toFixed(2)} p95=${p95.toFixed(2)} max=${max.toFixed(2)}ms`);
    check(`${c.id}: 无 >8ms 尖峰（GC 卫生）`, spikes8 === 0, `spikes=${spikes8}/${raw.length} 1%low≈${(raw.slice(Math.floor(raw.length * 0.99)).reduce((a, b) => a + b, 0) / Math.max(1, raw.length - Math.floor(raw.length * 0.99))).toFixed(2)}`);
    check(`${c.id}: perf 摘要分段齐备`, sum && sum.physics && sum.render && sum.overlay && typeof sum.calls === 'number',
      `phys=${sum.physics.p95} ov=${sum.overlay.p95} rnd=${sum.render.p95} dc=${sum.calls} tier=${sum.tier}`);
    check(`${c.id}: HUD 可见`, hudVisible || await page.evaluate(() => document.getElementById('perfHud').style.display !== 'none'));

    allRaw[c.id] = { p50, p95, max, spikes8, n: raw.length, summary: { physics: sum.physics, overlay: sum.overlay, render: sum.render, dom: sum.dom, calls: sum.calls, tris: sum.tris, tier: sum.tier, fps: sum.fps } };
    await page.screenshot({ path: join(rawDir, `p34-${c.id}.png`) });
    await page.evaluate(() => window.MECH.resetSim());
  }

  // HUD 开关持久化（刷新后保持）
  await page.evaluate(() => window.MECH.perfHud(false));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 30000 });
  const hudOff = await page.evaluate(() => document.getElementById('perfHud').style.display === 'none');
  await page.evaluate(() => window.MECH.perfHud(true));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 30000 });
  const hudOn = await page.evaluate(() => document.getElementById('perfHud').style.display !== 'none');
  check('HUD 开关刷新后持久', hudOff && hudOn, `off=${hudOff} on=${hudOn}`);

  check('全程无 console 错误/页面异常', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  writeFileSync(join(rawDir, 'p34-perf-raw.json'), JSON.stringify({ runSec: RUN_SEC, cases: allRaw }, null, 2));
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n== 汇总 ==\nPASS ${pass}/${results.length}`);
  if (pass !== results.length) process.exit(1);
} finally {
  await browser.close();
}
