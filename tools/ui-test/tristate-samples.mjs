// tristate-samples.mjs — 选中/hover 三态视觉语言样张（PL-44 视觉门取证）。
// 同机位四连拍：无选中 / hover / 单选 / 多选。人工或评审代理逐张对照。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  args: ['--window-size=1560,950', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
});
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 30000 });
  await page.evaluate(() => window.MECH.loadPreset('incline'));
  // flyToPose 镜头飞行未收敛会让取样点漂移（视觉门 ts3 实测点到地面）——等动画句柄清空
  await page.waitForFunction(() => {
    const vp = window.MECH.__vp;
    return vp._poseAnim == null && vp._focusAnim == null && vp._zoomTarget == null;
  }, null, { timeout: 8000, polling: 200 });
  await page.waitForTimeout(400);

  // 球的屏幕坐标（同机位全程不动）；flyToPose 镜头飞行未收敛会漂——轮询到 pick 真命中球为止
  const sp = await page.waitForFunction(() => {
    const e = window.MECH.doc().entities.find((x) => x.type === 'sphere');
    const t = window.MECH.telemetry(e.id);
    const [cx, cy] = window.MECH.__vp.screenPosOf(t.pos[0], t.pos[1], t.pos[2]);
    const hit = window.MECH.__vp.pickDynamic(cx, cy - 8);
    return hit && hit.id === e.id ? [cx, cy - 8] : null;
  }, null, { timeout: 8000, polling: 250 }).then((r) => r.jsonValue());
  const far = [sp[0] + 320, Math.max(sp[1] - 160, 120)];   // 空白处（不命中任何实体）

  // S1 无选中基线（hover 在空白处）
  await page.mouse.move(far[0], far[1]);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, 'ts1-none.png') });

  // S2 hover（未选中体上悬停：淡灰盒 0.28）
  await page.mouse.move(sp[0], sp[1]);
  await page.waitForTimeout(400);
  const hv = await page.evaluate(() => window.MECH.hoverState());
  await page.screenshot({ path: join(outDir, 'ts2-hover.png') });

  // S3 单选（琥珀 0.9）：左键点击
  await page.mouse.click(sp[0], sp[1]);
  await page.mouse.move(far[0], far[1]);          // 移开：hover 消失，只剩主选
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, 'ts3-selected.png') });

  // S4 多选（其余=灰 0.45）：additive 加选斜坡
  await page.evaluate(() => {
    const ramp = window.MECH.doc().entities.find((x) => x.type === 'ramp');
    window.MECH.select(ramp.id, true);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, 'ts4-multi.png') });

  console.log('tri-state samples done; hover=', JSON.stringify(hv));
} finally {
  await browser.close();
}
