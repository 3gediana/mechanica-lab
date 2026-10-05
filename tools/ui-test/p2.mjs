// p2.mjs — P2 动量守恒预置验收：真实 UI 载入预置 → 检查器改质量/弹性 → 运行对撞 → 守恒量条/速度向量断言
// 纪律：单浏览器 / 单 context / 单标签；总时长上限约 2 分钟。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
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

  // ---- 载入动量守恒预置（真实 UI 下拉）
  await page.selectOption('#selPreset', 'momentum');
  await page.waitForTimeout(300);
  const ents = await page.evaluate(() => window.MECH.entities());
  check('预置载入: 地面+两球', ents.length === 3 && ents.filter((e) => e.type === 'sphere').length === 2,
    JSON.stringify(ents.map((e) => e.type)));
  check('教学叠加层自动开启', await page.evaluate(() => window.MECH.vectorState().on) === true
    && await page.isVisible('#consbar'), `vectors=${JSON.stringify(await page.evaluate(() => window.MECH.vectorState()))}`);
  await page.screenshot({ path: 'shots/20-momentum-edit.png' });

  // ---- 检查器可编辑性：改球 A 质量 2→3、初速度 1.5 保持
  await page.evaluate(() => {
    const a = window.MECH.entities().find((e) => e.name.includes('球 A'));
    window.MECH.select(a.id);
  });
  await page.waitForTimeout(200);
  const massInput = page.locator('#inspBody .frow', { has: page.locator('label', { hasText: '质量' }) }).locator('input');
  await massInput.fill('3');
  await massInput.press('Enter');
  await page.waitForTimeout(250);
  const docA = await page.evaluate(() => window.MECH.doc().entities.find((e) => e.name.includes('球 A')));
  check('质量可编辑(2→3kg)', Math.abs(docA.physics.mass - 3) < 1e-6, `mass=${docA.physics.mass}`);

  // ---- 弹性可编辑：两球恢复系数 0.8 → 1.0（完全弹性，动能也应守恒）
  for (const nm of ['球 A', '球 B']) {
    await page.evaluate((nm) => {
      const b = window.MECH.entities().find((e) => e.name.includes(nm));
      window.MECH.select(b.id);
    }, nm);
    await page.waitForTimeout(150);
    const restInput = page.locator('#inspBody .frow', { has: page.locator('label', { hasText: '弹性' }) }).locator('input');
    await restInput.fill('1');
    await restInput.press('Enter');
    await page.waitForTimeout(200);
  }
  const rests = await page.evaluate(() => window.MECH.doc().entities.filter((e) => e.type === 'sphere').map((e) => e.physics.restitution));
  check('弹性可编辑(→e=1.0)', rests.every((r) => Math.abs(r - 1) < 1e-6), JSON.stringify(rests));

  // ---- 运行对撞（完全弹性：动量与动能都应守恒）
  await page.click('#btnPlay');
  // 等球球碰撞（t>0.5s 的报告；避免误取出生触地等初始接触）
  await page.waitForFunction(() => window.MECH.consState().reports.some((r) => r.t > 0.5), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'shots/21-momentum-after-collision.png' });
  await page.click('#btnPause');
  const cs = await page.evaluate(() => window.MECH.consState());
  const rep = cs.reports.filter((r) => r.t > 0.5).pop();
  const pErr = Math.abs(rep.pAfter[0] - rep.pBefore[0]) / Math.abs(rep.pBefore[0]) * 100;
  const keErr = Math.abs(rep.keAfter - rep.keBefore) / rep.keBefore * 100;
  check('碰撞发生且有时刻', rep && rep.t > 0.5, `t=${rep.t.toFixed(3)}s n=${cs.reports.length}`);
  check('动量守恒误差<1%', pErr < 1, `p ${rep.pBefore[0].toFixed(3)} → ${rep.pAfter[0].toFixed(3)} err=${pErr.toFixed(3)}%`);
  check('完全弹性: 动能守恒误差<2%', keErr < 2, `KE ${rep.keBefore.toFixed(3)} → ${rep.keAfter.toFixed(3)} err=${keErr.toFixed(2)}%`);
  check('速度向量箭头可见', await page.evaluate(() => { const s = window.MECH.vectorState(); return s.on && s.visible >= 1; }),
    JSON.stringify(await page.evaluate(() => window.MECH.vectorState())));

  // ---- 守恒量条数值与报告一致（UI 读出）
  const cb = await page.evaluate(() => ({
    perr: document.getElementById('cbPerr').textContent,
    t: document.getElementById('cbT').textContent,
  }));
  check('守恒量条 UI 读出', cb.perr.includes('%') && cb.t.includes('t='), JSON.stringify(cb));

  // ---- 改回 e=0.5（非弹性）：动能应有明显损失，动量仍守恒
  // 先重置回编辑态（运行态检查器只读是设计行为），改完再运行
  await page.click('#btnReset');
  for (const nm of ['球 A', '球 B']) {
    await page.evaluate((nm) => {
      const b = window.MECH.entities().find((e) => e.name.includes(nm));
      window.MECH.select(b.id);
    }, nm);
    await page.waitForTimeout(150);
    const restInput = page.locator('#inspBody .frow', { has: page.locator('label', { hasText: '弹性' }) }).locator('input');
    await restInput.fill('0.5');
    await restInput.press('Enter');
    await page.waitForTimeout(200);
  }
  await page.click('#btnReset');
  await page.click('#btnPlay');
  await page.waitForFunction(() => window.MECH.consState().reports.some((r) => r.t > 0.5), null, { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.click('#btnPause');
  const cs2 = await page.evaluate(() => window.MECH.consState());
  const rep2 = cs2.reports.filter((r) => r.t > 0.5).pop();
  const pErr2 = Math.abs(rep2.pAfter[0] - rep2.pBefore[0]) / Math.abs(rep2.pBefore[0]) * 100;
  const keLoss = (1 - rep2.keAfter / rep2.keBefore) * 100;
  check('e=0.5: 动量仍守恒(<1%)', pErr2 < 1, `err=${pErr2.toFixed(3)}%`);
  check('e=0.5: 动能有损失(>10%)', keLoss > 10, `KE 损失=${keLoss.toFixed(1)}%`);
  await page.screenshot({ path: 'shots/22-momentum-inelastic.png' });

  // ---- 暂停/单步/重置通用控制仍可用（复用 P0 语义）
  await page.click('#btnReset');
  const stR = await page.evaluate(() => window.MECH.state());
  check('重置回初始态', stR.mode === 'edit' && stR.simT === 0, `mode=${stR.mode}`);

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
