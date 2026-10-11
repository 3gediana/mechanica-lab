import { chromium } from 'playwright';
const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const PRESET = process.env.PROBE_PRESET || 'incline';
const OUT = process.env.PROBE_OUT || 'shots/envprobe-ball.png';
const browser = await chromium.launch({ headless: true });
try {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 820 } })).newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 30000 });
  await page.evaluate((p) => {
    window.MECH.perfHud(false);
    window.MECH.loadPreset(p);
  }, PRESET);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const vp = window.MECH.__vp;
    const cam = vp.camera, c = vp.controls;
    cam.position.set(3.2, 2.4, 4.2);
    c.target.set(0, 0.7, 0);
    vp._poseAnim = null; vp._focusAnim = null; vp._zoomTarget = null; vp._zoomV = null;   // 相机飞行句柄会拉回，先清（R44 教训）
    c.update();
  });
  await page.evaluate(() => document.getElementById('btnPlay').click());
  await page.waitForTimeout(3600);
  await page.screenshot({ path: OUT });
  console.log('OK');
} finally { await browser.close(); }
