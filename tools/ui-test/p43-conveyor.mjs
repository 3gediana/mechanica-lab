// p43-conveyor.mjs — 传送带端到端（RUN-2）：fixture 建场 → 带驱动「先滑动后共速」实测
// → 带面人字纹随带速滚动 → 反向带速输运 → 全程无 console 错误。
// 物理口径（教科书）：a = μg 滑动段，共速后随带匀速；实测球 vx 收敛到带速 ±6%。
// 零出网（fixture 本地）。用法：MECH_BASE=http://127.0.0.1:8722 node p43-conveyor.mjs
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

async function withPage(fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('net::ERR_FAILED')) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.route('**/api/**', (r) => r.abort());
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

// 建场：fixture → apply → 自查零 error（p41 同款门）
async function buildFixture(page, name) {
  await page.evaluate(() => document.getElementById('btnNew').click());
  await page.evaluate(() => document.getElementById('tabAgent').click());
  await page.evaluate((n) => window.MECH.loadFixture(n), name);
  await page.waitForFunction(() => {
    const b = document.getElementById('btnApplyParse');
    return b && !b.disabled && document.getElementById('changePreview').style.display !== 'none';
  }, null, { timeout: 30000, polling: 300 });
  await page.click('#btnApplyParse');
  await page.waitForFunction(() => window.MECH.agentVerifyState() != null && !window.MECH.agentBusy(),
    null, { timeout: 90000, polling: 300 });
}

try {
  // ==== A. 建场 + 自查零 error ====
  await withPage(async (page) => {
    await buildFixture(page, 'conveyor');
    const st = await page.evaluate(() => window.MECH.agentVerifyState().summary);
    check('A 建场+自查零 error', st.error === 0, JSON.stringify(st));

    // ==== B. 运行 4s：球 vx 收敛到带速 0.8（先滑动后共速）+ 人字纹滚动 ====
    const scroll0 = await page.evaluate(() => {
      window.MECH.play();
      const belt = [...window.MECH.__vp.scene.children].find((o) => o.userData && o.userData.entityId
        && window.MECH.entities().find((e) => e.id === o.userData.entityId && e.type === 'conveyor'));
      const tex = belt && belt.userData.beltScroll ? belt.userData.beltScroll.tex : null;
      return tex ? tex.offset.x : null;
    });
    await page.waitForTimeout(4000);
    const out = await page.evaluate((scroll0) => {
      window.MECH.pause();
      const d = window.MECH.doc();
      const beltEnt = d.entities.find((e) => e.type === 'conveyor');
      const ballEnt = d.entities.find((e) => e.type === 'sphere');
      const ball = window.MECH.__vp._bindLookup(ballEnt.id);
      const belt = window.MECH.__vp._bindLookup(beltEnt.id);
      const vx = ball ? ball.body.linvel().x : null;
      const tex = belt && belt.mesh && belt.mesh.userData.beltScroll ? belt.mesh.userData.beltScroll.tex : null;
      return { vx, vBelt: beltEnt.params.speed, types: d.entities.map((e) => e.type), offset: tex ? tex.offset.x : null, y: ball ? +ball.mesh.position.y.toFixed(2) : null };
    }, scroll0);
    const coErr = out.vx != null ? Math.abs(out.vx - out.vBelt) / Math.abs(out.vBelt) * 100 : null;
    check('B 球 4s 后共速（|vx-带速| ≤ 6%）', coErr != null && coErr <= 6, `vx=${out.vx} 带速=${out.vBelt} 偏差=${coErr == null ? '?' : coErr.toFixed(2)}% y=${out.y}`);
    check('B 带面人字纹随带速滚动（offset 前后变化）', scroll0 != null && out.offset != null && out.offset !== scroll0,
      `offset ${scroll0} → ${out.offset}`);

    // ==== C. 反向带速（speed=-0.8）：球被反向输运（vx 收敛到 -0.8）====
    await page.evaluate(() => {
      window.MECH.resetSim();
      const beltEnt = window.MECH.doc().entities.find((e) => e.type === 'conveyor');
      window.MECH.updateEntity(beltEnt.id, { params: { ...beltEnt.params, speed: -0.8 } }, '反向带速');
      window.MECH.play();
    });
    await page.waitForTimeout(4000);
    const rev = await page.evaluate(() => {
      window.MECH.pause();
      const ballEnt = window.MECH.doc().entities.find((e) => e.type === 'sphere');
      const ball = window.MECH.__vp._bindLookup(ballEnt.id);
      return { vx: ball ? ball.body.linvel().x : null, x: ball ? +ball.mesh.position.x.toFixed(2) : null };
    });
    const revErr = rev.vx != null ? Math.abs(rev.vx - (-0.8)) / 0.8 * 100 : null;
    check('C 反向带速输运（vx → -0.8 ±6%）', revErr != null && revErr <= 6, `vx=${rev.vx} 偏差=${revErr == null ? '?' : revErr.toFixed(2)}% x=${rev.x}`);

    // ==== D. 目录放置通路：从组件目录 API 加传送带（trusted），默认参数在场 ====
    const placed = await page.evaluate(() => {
      window.MECH.resetSim();
      const id = window.MECH.addComponent('conveyor', { transform: { pos: [2.5, 0.08, 1.2] } });
      const e = id != null ? window.MECH.doc().entities.find((x) => x.id === id) : null;
      return e ? { ok: true, type: e.type, speed: e.params.speed } : { ok: false };
    });
    check('D 目录通路加传送带（默认带速 0.8）', placed.ok && placed.speed === 0.8, JSON.stringify(placed));
  });

  // ==== E. 无 console 错误 ====
  check('全程无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log('\n== 汇总 ==');
const nFail = results.filter((r) => !r.ok).length;
console.log(`PASS ${results.length - nFail}/${results.length}`);
process.exit(nFail === 0 && consoleErrors.length === 0 ? 0 : 1);
