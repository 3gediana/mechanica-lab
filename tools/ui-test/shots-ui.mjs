// shots-ui.mjs — UI 精致化样张采集（headed 真 GPU）：classic 环底套管 + 工作台 simbar/perfHUD/图例。
// 只采图不断言；人工评审用。用法：MECH_BASE=http://127.0.0.1:8722 node shots-ui.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  args: [
    '--window-size=1600,950',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));

  // ==== A. classic.html：全景（球跑到环顶附近）+ 环底套管特写（滚轮推近 + 拖拽环绕）====
  await page.goto(BASE + '/classic.html?run=1', { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await page.waitForFunction(() => {
    const c = document.querySelector('#console');
    return c && c.classList.contains('on') && !document.querySelector('#btnRelease').disabled;
  }, null, { timeout: 20000 });
  await page.waitForTimeout(2600);   // 球已进环
  await page.screenshot({ path: join(outDir, 'c1-classic-wide.png') });

  // 环底中距取景（用户真实视距：能看清接头做工，但不过度显微——显微距离会把开槽管的
  // 诚实几何也读成缺陷；视觉门 c2 首轮教训）
  await page.mouse.move(700, 420);
  await page.mouse.down();
  await page.mouse.move(1150, 430, { steps: 20 });
  await page.mouse.up();
  await page.mouse.move(990, 450);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(70); }
  await page.mouse.move(880, 470);
  await page.mouse.down();
  await page.mouse.move(1010, 480, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(outDir, 'c2-classic-loop.png') });
  const title = await page.title();
  console.log('classic title =', JSON.stringify(title), '(应为干净的「MECHANICA · 经典演示」)');

  // ==== B. 工作台：编辑态 + 运行态（perf HUD + 四叠加开关 + 曲线面板 + 守恒条齐亮——热态视觉评审样张）====
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 30000 });
  await page.evaluate(() => {
    window.MECH.loadPreset('incline');
    window.MECH.perfHud(true);
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(outDir, 'w1-workbench-edit.png') });

  await page.evaluate(() => {
    for (const id of ['btnVectors', 'btnForces', 'btnTrails', 'btnCons']) {
      const b = document.getElementById(id);
      if (b && !b.classList.contains('hot')) b.click();
    }
    document.getElementById('btnCurves').click();
  });
  await page.click('#btnPlay');
  await page.waitForTimeout(2500);   // 曲线/守恒/箭头都出数据，HUD 采到运行态样本
  await page.screenshot({ path: join(outDir, 'w2-workbench-run.png') });

  // perf HUD 特写（裁剪右上门仪表区域）
  await page.screenshot({ path: join(outDir, 'w3-perfhud.png'), clip: { x: 1160, y: 50, width: 440, height: 400 } });
  console.log('shots done ->', outDir);
} finally {
  await browser.close();
}
