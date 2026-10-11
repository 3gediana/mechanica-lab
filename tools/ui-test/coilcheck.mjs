import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto('http://127.0.0.1:8722', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
const r = await page.evaluate(() => {
  const M = window.MECH;
  M.loadPreset('springSHM');
  const spDoc = M.doc().entities.find((e) => e.type === 'spring');
  const mesh = M.__vp._bindLookup(spDoc.id).mesh;
  const aPos = M.__vp._bindLookup(spDoc.attach[0]).mesh.position.toArray().map((v) => +v.toFixed(3));
  const cPos = M.__vp._bindLookup(spDoc.attach[1]).mesh.position.toArray().map((v) => +v.toFixed(3));
  const before = { pos: mesh.position.toArray().map((v) => +v.toFixed(3)), scale: +mesh.scale.y.toFixed(3) };
  for (let i = 0; i < 60; i++) M.stepOnce();
  const after = { pos: mesh.position.toArray().map((v) => +v.toFixed(3)), scale: +mesh.scale.y.toFixed(3) };
  return { restLength: spDoc.params.restLength, attach: spDoc.attach, aPos, cPos, before, after };
});
console.log(JSON.stringify(r));
await browser.close();
