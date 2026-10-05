// p0.mjs — P0 工作台内核验收：真实 UI 点击走完核心链路（单浏览器/单上下文/单标签）
// 流程：启动 → 自检 → 新建空场景 → 目录加斜坡 → 调倾角 → 加球 → 改质量/位置 → 运行 → 暂停/单步/重置 → 撤销重做 → 刷新自动保存 → classic 页存活
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

  // ---- 启动
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  check('启动: MECH.ready', true);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: 'shots/01-boot-incline-preset.png' });

  // ---- 物理自检（页面内同步步进）
  const st = await page.evaluate(() => window.MECH.selftest());
  check('selftest: 斜面物理演化', st.pass, JSON.stringify(st.checks));

  // ---- 新建空场景
  await page.click('#btnNew');
  await page.waitForTimeout(200);
  let roN = await page.textContent('#roN');
  check('新建空场景: 实体=0', roN.trim() === '0', `roN=${roN}`);

  // ---- 目录添加斜坡
  await page.locator('.comp-item', { hasText: '斜坡' }).click();
  await page.waitForTimeout(250);
  roN = await page.textContent('#roN');
  const ents1 = await page.evaluate(() => window.MECH.entities());
  check('目录添加斜坡', roN.trim() === '1' && ents1[0].type === 'ramp', JSON.stringify(ents1));

  // ---- 检查器改倾角 30°（联动坡高）
  const angleInput = page.locator('#inspBody .frow', { has: page.locator('label', { hasText: '倾角' }) }).locator('input');
  await angleInput.fill('30');
  await angleInput.press('Enter');
  await page.waitForTimeout(250);
  const rampParams = (await page.evaluate(() => window.MECH.doc())).entities[0].params;
  check('倾角30°联动坡高', Math.abs(rampParams.height - Math.tan(Math.PI / 6) * rampParams.length) < 0.01,
    `height=${rampParams.height}`);

  // ---- 目录添加球 + 改质量 + 改位置（放到斜坡面上）
  await page.locator('.comp-item', { hasText: '球' }).first().click();
  await page.waitForTimeout(250);
  roN = await page.textContent('#roN');
  check('目录添加球', roN.trim() === '2', `roN=${roN}`);

  const massInput = page.locator('#inspBody .frow', { has: page.locator('label', { hasText: '质量' }) }).locator('input');
  await massInput.fill('2');
  await massInput.press('Enter');
  await page.waitForTimeout(200);
  const ballDoc = (await page.evaluate(() => window.MECH.doc())).entities[1];
  check('质量改为 2kg', Math.abs(ballDoc.physics.mass - 2) < 1e-6, `mass=${ballDoc.physics.mass}`);

  // 位置三连输入（斜坡在 [-0.8,0.07,-0.8]，高墙 -x；球放坡面上段，z 同步改值验证写入）
  const posRow = page.locator('#inspBody .frow', { has: page.locator('label', { hasText: '位置' }) }).locator('input');
  await posRow.nth(0).fill('-1.15');
  await posRow.nth(1).fill('0.78');
  await posRow.nth(2).fill('-0.6');
  await posRow.nth(2).press('Enter');
  await page.waitForTimeout(250);
  const ballPos = (await page.evaluate(() => window.MECH.doc())).entities[1].transform.pos;
  check('初位置写入', Math.abs(ballPos[0] + 1.15) < 1e-6 && Math.abs(ballPos[1] - 0.78) < 1e-6 && Math.abs(ballPos[2] + 0.6) < 1e-6,
    JSON.stringify(ballPos));

  // ---- 运行 2.5s：真实物理滚落（waitForFunction 替代固定等待：批量负载下 rAF 节流会饿死墙钟推断）
  await page.click('#btnPlay');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/02-running.png' });
  await page.waitForFunction(() => window.MECH.state().simT > 2.2, null, { timeout: 15000 });
  const tRun = await page.evaluate(() => {
    const s = window.MECH.state();
    const ball = window.MECH.entities().find((e) => e.type === 'sphere');
    return { state: s, tel: window.MECH.telemetry(ball.id) };
  });
  check('运行: 模拟时间推进', tRun.state.simT > 2.2, `simT=${tRun.state.simT.toFixed(2)}`);
  check('运行: 小球沿坡滚落(x+,y-)', tRun.tel.pos[0] > -0.9 && tRun.tel.pos[1] < 0.55,
    `pos=[${tRun.tel.pos.map((v) => v.toFixed(2))}] v=${tRun.tel.speed.toFixed(2)}`);
  check('运行: 运行态', tRun.state.mode === 'run' && !tRun.state.paused);

  // ---- 暂停 + 时间冻结
  await page.click('#btnPause');
  await page.waitForTimeout(150);
  const t1 = await page.evaluate(() => window.MECH.state().simT);
  await page.waitForTimeout(400);
  const t2 = await page.evaluate(() => window.MECH.state().simT);
  check('暂停: 时间冻结', Math.abs(t1 - t2) < 1e-9, `t1=${t1} t2=${t2}`);

  // ---- 单步 3 次 = 3/120 s
  await page.click('#btnStep');
  await page.click('#btnStep');
  await page.click('#btnStep');
  await page.waitForTimeout(150);
  const t3 = await page.evaluate(() => window.MECH.state().simT);
  check('单步x3: 步长精确', Math.abs((t3 - t2) - 3 / 120) < 1e-9, `delta=${(t3 - t2).toFixed(5)}`);

  // ---- 重置回初始态
  await page.click('#btnReset');
  await page.waitForTimeout(250);
  const stR = await page.evaluate(() => {
    const s = window.MECH.state();
    const ball = window.MECH.entities().find((e) => e.type === 'sphere');
    return { s, tel: window.MECH.telemetry(ball.id) };
  });
  check('重置: 回初始态', stR.s.mode === 'edit' && stR.s.simT === 0 && Math.abs(stR.tel.pos[0] + 1.15) < 1e-3,
    `mode=${stR.s.mode} simT=${stR.s.simT} x=${stR.tel.pos[0].toFixed(3)}`);

  // ---- 撤销 / 重做
  const beforeUndo = await page.evaluate(() => JSON.stringify(window.MECH.doc()));
  await page.click('#btnUndo');
  await page.waitForTimeout(200);
  const afterUndo = await page.evaluate(() => JSON.stringify(window.MECH.doc()));
  await page.click('#btnRedo');
  await page.waitForTimeout(200);
  const afterRedo = await page.evaluate(() => JSON.stringify(window.MECH.doc()));
  check('撤销改变文档', beforeUndo !== afterUndo);
  check('重做还原文档', afterRedo === beforeUndo);

  // ---- 自动保存：刷新后场景恢复
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.waitForTimeout(1400);
  const cnt = await page.evaluate(() => window.MECH.state().count);
  check('刷新后自动保存恢复', cnt === 2, `entities=${cnt}`);
  await page.screenshot({ path: 'shots/03-after-reload.png' });

  // ---- gizmo / 相机按钮冒烟（不校验像素，只校验不抛错、状态切换）
  await page.click('#btnModeRotate');
  await page.click('#btnSnap');
  await page.click('#btnViewTop');
  await page.click('#btnViewReset');
  await page.waitForTimeout(300);
  check('工具按钮冒烟', (await page.evaluate(() => window.MECH.ready())) === true);

  // ---- classic 保留页存活（同标签跳转；legacy readouts 会覆写 document.title，用控制台激活特征断言）
  await page.goto(BASE + '/classic.html?run=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const c = document.querySelector('#console');
    return c && c.classList.contains('on') && !document.querySelector('#btnRelease').disabled;
  }, null, { timeout: 15000 });
  await page.waitForTimeout(4000);   // run=1 1.2s 后自动抽挡板，球开始滚
  const legacyT = await page.title();
  check('classic.html 存活(物理在读数)', legacyT.startsWith('M x='), legacyT.slice(0, 60));
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
