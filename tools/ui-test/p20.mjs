// p20.mjs — Round 23 验收：对象分组（成组/整组选中/解组/序列化保留）+ 选中对象定位（⌖ 相机聚焦）
// 纪律：单浏览器 / 单 context / 单标签；总时长上限约 3 分钟。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8721';
mkdirSync('shots', { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

  // ==== A. 分组：动量预置两球 → 多选 → 成组 ====
  await page.selectOption('#selPreset', 'momentum');
  await page.waitForTimeout(400);
  const ballIds = await page.evaluate(() => window.MECH.entities().filter((e) => e.type === 'sphere').map((e) => e.id));
  check('动量预置两球', ballIds.length === 2, JSON.stringify(ballIds));
  await page.evaluate((ids) => ids.forEach((id) => window.MECH.select(id, true)), ballIds);
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('.ol-group-btn')?.click());
  await page.waitForTimeout(250);
  const grp = await page.evaluate(() => ({
    members: window.MECH.groups().filter((g) => g.group),
    head: !!document.querySelector('.ol-group'),
    headText: document.querySelector('.ol-group') ? document.querySelector('.ol-group').textContent : null,
  }));
  check('成组: 两球 group 字段=「组1」', grp.members.length === 2 && grp.members.every((m) => m.group === '组1'),
    JSON.stringify(grp.members));
  check('大纲出现组头（▦ 组1 + 成员数）', grp.head && grp.headText.includes('组1') && grp.headText.includes('2 个对象'),
    grp.headText);
  await page.screenshot({ path: 'shots/200-groups.png' });

  // ==== B. 点组头 = 整组选中 ====
  await page.evaluate(() => window.MECH.select(null));
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('.ol-group')?.click());
  await page.waitForTimeout(150);
  const selAfter = await page.evaluate(() => window.MECH.entities().filter((e) => e.id)
    && document.querySelectorAll('.ol-row.sel').length);
  check('点组头整组选中(2 行高亮)', selAfter === 2, `sel=${selAfter}`);

  // ==== C. 序列化保留 + 撤销回退 ====
  const serialized = await page.evaluate(() => {
    const doc = window.MECH.doc();
    return JSON.stringify(doc).includes('"group":"组1"');
  });
  check('场景序列化含 group 字段', serialized === true);
  await page.evaluate(() => window.MECH.undo());
  await page.waitForTimeout(250);
  const afterUndo = await page.evaluate(() => window.MECH.groups().filter((g) => g.group).length);
  check('撤销后组清除(批次合并)', afterUndo === 0, `grouped=${afterUndo}`);

  // ==== D. 解组路径：重新成组再解组 ====
  await page.evaluate(() => window.MECH.select(null));
  await page.waitForTimeout(150);
  await page.evaluate((ids) => ids.forEach((id) => window.MECH.select(id, true)), ballIds);
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('.ol-group-btn')?.click());
  await page.waitForTimeout(200);
  const regrouped = await page.evaluate(() => window.MECH.groups().filter((g) => g.group).length);
  check('重新成组', regrouped === 2, `grouped=${regrouped}`);
  await page.evaluate(() => document.querySelector('.ol-group span[style*="underline"]')?.click());
  await page.waitForTimeout(200);
  const ungrouped = await page.evaluate(() => window.MECH.groups().filter((g) => g.group).length);
  check('解组后 group 清空', ungrouped === 0, `grouped=${ungrouped}`);

  // ==== E. 选中对象定位：spin 场景滑块 ⌖ → 相机 target 移向实体 ====
  await page.selectOption('#selPreset', 'spin');
  await page.waitForTimeout(400);
  const sliderId = await page.evaluate(() => window.MECH.entities().find((e) => e.name.includes('滑块')).id);
  const before = await page.evaluate(() => ({ t: window.MECH.cameraTarget(), p: window.MECH.cameraPos() }));
  await page.evaluate((id) => {
    const row = document.querySelector(`.ol-row[data-id="${id}"] .focus-btn`);
    row.click();
  }, sliderId);
  // headless rAF 帧率低，等插值收敛而非固定 sleep
  await page.waitForFunction((id) => {
    const t = window.MECH.cameraTarget();
    const s = window.MECH.telemetry(id).pos;
    return Math.hypot(t[0] - s[0], t[1] - s[1], t[2] - s[2]) < 0.02;
  }, sliderId, { timeout: 8000 });
  const after = await page.evaluate((id) => ({
    t: window.MECH.cameraTarget(),
    sliderPos: window.MECH.telemetry(id).pos,
  }), sliderId);
  const dBefore = Math.hypot(before.t[0] - after.sliderPos[0], before.t[1] - after.sliderPos[1], before.t[2] - after.sliderPos[2]);
  const dAfter = Math.hypot(after.t[0] - after.sliderPos[0], after.t[1] - after.sliderPos[1], after.t[2] - after.sliderPos[2]);
  check('定位: 相机 target 收敛到实体(<0.05)', dAfter < 0.05, `dBefore=${dBefore.toFixed(2)} dAfter=${dAfter.toFixed(4)}`);
  check('定位: 相机确有移动', dBefore > 0.5, `moved=${(dBefore - dAfter).toFixed(2)}`);
  await page.screenshot({ path: 'shots/201-focus.png' });

  // ==== F. 物理不受分组影响（回归：spin 运行照常） ====
  const rot = await page.evaluate(() => window.MECH.rotationState());
  check('spin 场景照常(ω≈3)', rot && Math.abs(rot.omega - 3) < 0.05, `ω=${rot ? rot.omega.toFixed(3) : 'null'}`);

  await page.close();
  await context.close();
} finally {
  await browser.close();
}

console.log('\n== 汇总 ==');
const nFail = results.filter((r) => !r.ok).length;
console.log(`PASS ${results.length - nFail}/${results.length}`);
if (consoleErrors.length) {
  console.log('浏览器 console/page 错误:');
  for (const e of consoleErrors.slice(0, 12)) console.log('  ', e.slice(0, 300));
}
process.exit(nFail === 0 && consoleErrors.length === 0 ? 0 : 1);
