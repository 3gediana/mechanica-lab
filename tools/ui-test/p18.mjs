// p18.mjs — Round 21 验收：逐条接受/拒绝变更 UI（变更预览清单勾选确认，跳过单条）
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

const loadManualScene = (page) => page.evaluate(() => {
  window.MECH.loadPreset('empty');
  const rid = window.MECH.addComponent('ramp', { name: '我的斜面',
    params: { length: 1.0, height: 0.3, width: 0.5 }, physics: { body: 'fixed' } });
  const sid = window.MECH.addComponent('sphere', { name: '我的球',
    physics: { mass: 3, friction: 0.5, restitution: 0.2, linvel: [0, 0, 0] } });
  return { rid, sid };
});
const checkboxCount = (page) => page.evaluate(() =>
  document.querySelectorAll('#changePreviewList input[type=checkbox]').length);
const setChecked = (page, i, checked) => page.evaluate(([i, checked]) => {
  const cb = document.querySelectorAll('#changePreviewList input[type=checkbox]')[i];
  cb.checked = checked;
  cb.dispatchEvent(new Event('change'));
}, [i, checked]);

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

  // ==== A. 手动场景 → incline fixture → 变更预览清单 ====
  const manual = await loadManualScene(page);
  await page.waitForTimeout(250);
  await page.click('#tabAgent');
  await page.evaluate(() => window.MECH.loadFixture('incline'));
  await page.waitForTimeout(250);
  const pv = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#changePreviewList label span')];
    const vis = document.getElementById('changePreview').style.display !== 'none';
    return { vis, labels: rows.map((r) => r.textContent), n: rows.length };
  });
  check('变更预览可见', pv.vis && pv.n >= 3, JSON.stringify(pv.labels));
  check('清单含更新斜面/更新球/重力三类', pv.labels.some((l) => l.includes('更新已有 ramp'))
    && pv.labels.some((l) => l.includes('更新已有 sphere'))
    && pv.labels.some((l) => l.includes('调整重力')), JSON.stringify(pv.labels));
  check('更新条目带参数差异摘要', pv.labels.some((l) => l.includes('mass 3→1')), pv.labels.find((l) => l.includes('sphere')));
  await page.screenshot({ path: 'shots/180-change-preview.png' });

  // ==== B. 拒绝「更新小球」条目 → 球参数保留，斜面/重力照常 ====
  const sphereIdx = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#changePreviewList label')];
    return rows.findIndex((r) => r.textContent.includes('更新已有 sphere'));
  });
  await setChecked(page, sphereIdx, false);
  await page.click('#btnApplyParse');
  await page.waitForTimeout(400);
  const st = await page.evaluate((ids) => {
    const d = window.MECH.doc();
    const r = d.entities.find((e) => e.id === ids.rid);
    const s = d.entities.find((e) => e.id === ids.sid);
    return {
      rampLen: r.params.length, ballMass: s.physics.mass, ballFriction: s.physics.friction,
      gravity: d.gravity, total: d.entities.length,
      ops: window.MECH.agentOpsState().ops.map((o) => o.op),
    };
  }, manual);
  check('拒绝条目: 球参数未被改动(m=3 f=0.5)', st.ballMass === 3 && st.ballFriction === 0.5,
    `m=${st.ballMass} f=${st.ballFriction}`);
  check('勾选条目: 斜面已更新(L≈1.732)', Math.abs(st.rampLen - 1.7321) < 0.01, `L=${st.rampLen}`);
  check('勾选条目: 重力已调整(→-10)', st.gravity === -10, `g=${st.gravity}`);
  check('操作明细含「跳过」', st.ops.some((o) => o.includes('跳过')), JSON.stringify(st.ops));
  check('实体不倍增(total=2)', st.total === 2, `total=${st.total}`);

  // ==== C. 拒绝重力条目（重载手动场景再来一遍） ====
  await loadManualScene(page);
  await page.waitForTimeout(250);
  await page.click('#tabAgent');
  await page.evaluate(() => window.MECH.loadFixture('incline'));
  await page.waitForTimeout(250);
  const gIdx = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#changePreviewList label')];
    return rows.findIndex((r) => r.textContent.includes('调整重力'));
  });
  await setChecked(page, gIdx, false);
  await page.click('#btnApplyParse');
  await page.waitForTimeout(400);
  const st2 = await page.evaluate(() => ({ gravity: window.MECH.doc().gravity,
    rampLen: window.MECH.doc().entities.find((e) => e.type === 'ramp').params.length }));
  check('拒绝重力: 重力保持 -9.81', Math.abs(st2.gravity + 9.81) < 1e-6, `g=${st2.gravity}`);
  check('其余条目照常执行(斜面已更新)', Math.abs(st2.rampLen - 1.7321) < 0.01, `L=${st2.rampLen}`);

  // ==== D. 拒绝滑块实体 → joint 自动跳过，单转台场景不炸 ====
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.waitForTimeout(250);
  await page.click('#tabAgent');
  await page.evaluate(() => window.MECH.loadFixture('spin'));
  await page.waitForTimeout(250);
  const sliderIdx = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#changePreviewList label')];
    return rows.findIndex((r) => r.textContent.includes('新建 box'));
  });
  check('spin 预览含滑块+滑槽约束（含重力共 4 条）', sliderIdx >= 0
    && (await checkboxCount(page)) === 4, `sliderIdx=${sliderIdx}`);
  await setChecked(page, sliderIdx, false);
  await page.click('#btnApplyParse');
  await page.waitForTimeout(400);
  const st3 = await page.evaluate(() => {
    const d = window.MECH.doc();
    const table = d.entities.find((e) => e.type === 'cylinder');
    return { total: d.entities.length, tableJoints: table ? (table.joints || []).length : -1 };
  });
  check('拒绝滑块: 单转台建场(total=1)', st3.total === 1, `total=${st3.total}`);
  check('滑槽约束自动跳过(joints=0)', st3.tableJoints === 0, `joints=${st3.tableJoints}`);
  await page.click('#btnPlay');
  await page.waitForTimeout(1200);
  await page.click('#btnPause');
  check('单转台运行不炸(无页面错误)', consoleErrors.length === 0, `${consoleErrors.length} errors`);

  // ==== E. 纯 Agent 回归：默认全勾照常建场 ====
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.waitForTimeout(250);
  await page.click('#tabAgent');
  await page.evaluate(() => window.MECH.loadFixture('incline'));
  await page.waitForTimeout(250);
  const allChecked = await page.evaluate(() =>
    [...document.querySelectorAll('#changePreviewList input[type=checkbox]')].every((c) => c.checked));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(400);
  const st4 = await page.evaluate(() => ({ total: window.MECH.doc().entities.length,
    g: window.MECH.doc().gravity }));
  check('默认全勾照常建场(2 实体+重力)', allChecked && st4.total === 2 && st4.g === -10,
    `total=${st4.total} g=${st4.g}`);

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
