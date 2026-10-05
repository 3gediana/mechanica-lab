// p32-presets.mjs — R2 新预置 UI 冒烟（MDL-44）：21 个新预置逐一 loadPreset →
// 实体就绪、真实物理可推进、telemetry 无 NaN、无 console 错误。单浏览器/单标签，约 90s。
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
const PRESETS = [
  'pendulum', 'conical', 'vertCircle', 'springSHM', 'springVert', 'coupled', 'springGun',
  'collLab', 'bulletBlock', 'newtonCradle', 'ballChain', 'bounceCompare', 'galileoDrop',
  'rangeAngles', 'atwoodHeavy', 'binaryStar', 'threeBody', 'rollRace', 'frictionLock',
  'blockOnBlock', 'weightless',
];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};

const browser = await chromium.launch({ headless: true });
try {
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(20000);
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !(m.location()?.url || '').includes('/api/')) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

  for (const id of PRESETS) {
    const st = await page.evaluate((id) => {
      window.MECH.loadPreset(id);
      return true;
    }, id);
    // 实体就绪（loadPreset 同步建 doc，运行时绑定异步就绪）
    const ents = await page.waitForFunction(() => {
      const doc = window.MECH.doc();
      return doc.entities.length > 0 ? doc.entities.map((e) => e.type) : null;
    }, id, { timeout: 10000 }).then((r) => r.jsonValue()).catch(() => null);
    check(`${id}: 载入即有实体`, st && Array.isArray(ents) && ents.length > 0, ents ? `n=${ents.length}` : 'timeout');

    // 真实物理推进 0.5s（waitForFunction，不依赖墙钟）→ 无 NaN
    await page.evaluate(() => window.MECH.play());
    const healthy = await page.waitForFunction(() => {
      const s = window.MECH.state();
      if (s.simT < 0.5) return false;
      const ents = window.MECH.entities().filter((e) => e.physics && e.physics.body === 'dynamic');
      const tel = ents.map((e) => window.MECH.telemetry(e.id)).filter(Boolean);
      return tel.length ? tel.every((t) => Number.isFinite(t.pos[0]) && Number.isFinite(t.pos[1]) && Number.isFinite(t.speed)) : true;
    }, null, { timeout: 15000 }).then(() => true).catch(() => false);
    check(`${id}: 运行 0.5s telemetry 无 NaN`, healthy);
    await page.evaluate(() => window.MECH.resetSim());
  }

  check('全程无 console 错误/页面异常', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  await page.screenshot({ path: 'shots/p32-final.png' });
} finally {
  await browser.close();
}

const fail = results.filter((r) => !r.ok).length;
console.log(fail ? `\n== 汇总 ==\nFAIL ${fail} 项` : `\n== 汇总 ==\nPASS ${results.length}/${results.length}`);
process.exit(fail ? 1 : 0);
