// ui-audit-shots.mjs — UI 审计新鲜截图（6 状态）：boot/选中检查器/运行态/解释卡/Agent 页/目录悬停。
// 产出 tools/ui-test/shots/audit-*.png 供视觉评审。用法：MECH_BASE=http://127.0.0.1:8722 node ui-audit-shots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 820 } })).newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 30000 });
  await page.evaluate(() => { window.MECH.perfHud(false); window.MECH.__vp.resetView(); });

  // 1. 空场景 boot
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'audit-01-boot.png') });

  // 2. 加载斜坡预设 + 选中球（检查器有内容）
  await page.evaluate(() => { window.MECH.loadPreset('incline'); });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const ball = window.MECH.entities().find((e) => e.type === 'sphere');
    if (ball) window.MECH.select(ball.id);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'audit-02-inspector.png') });

  // 3. 运行态 1.2s（矢量/轨迹可见）
  await page.evaluate(() => document.getElementById('btnPlay').click());
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, 'audit-03-running.png') });
  await page.evaluate(() => window.MECH.resetSim());

  // 4. 解释卡（单摆预设 + 运行解释）
  await page.evaluate(() => { window.MECH.loadPreset('pendulum'); });
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('btnRunExplain').click());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, 'audit-04-explain.png') });

  // 5. Agent 解析页
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('button, .tab, [role="tab"]')];
    const t = tabs.find((b) => (b.textContent || '').includes('Agent'));
    if (t) t.click();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'audit-05-agent.png') });

  // 6. 目录悬停态
  await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('button, .tab, [role="tab"]')];
    const t = tabs.find((b) => (b.textContent || '').includes('属性检查器'));
    if (t) t.click();
  });
  const tile = page.locator('#catalog .tile, .cat-tile, [data-add]').first();
  if (await tile.count()) await tile.hover();
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, 'audit-06-catalog-hover.png') });

  console.log('OK 6 shots ->', OUT);
} finally {
  await browser.close();
}
