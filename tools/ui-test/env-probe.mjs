import { chromium } from 'playwright';
const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const browser = await chromium.launch({ headless: true });
try {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 820 } })).newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 30000 });
  await page.evaluate(() => {
    window.MECH.perfHud(false);
    window.MECH.loadPreset('incline');
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const vp = window.MECH.__vp;
    const ball = window.MECH.entities().find((e) => e.type === 'sphere');
    window.MECH.select(ball.id);
    const p = vp.selectedMesh.position;
    const cam = vp.camera, c = vp.controls;
    cam.position.set(p.x + 0.9, p.y + 0.5, p.z + 1.1);
    c.target.set(p.x, p.y, p.z);
    vp._poseAnim = null; vp._focusAnim = null; vp._zoomTarget = null; vp._zoomV = null;   // 相机飞行句柄会拉回，先清（R44 教训）
    c.update();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'shots/envprobe-ball.png' });
  console.log('OK');
} finally { await browser.close(); }
