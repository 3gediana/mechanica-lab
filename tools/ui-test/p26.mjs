// p26.mjs — Round 29 验收：二维斜碰（动量矢量守恒 x/z 分量门控 + 斜散射开）
// 纪律：单浏览器 / 单 context / 单标签；总时长上限约 3 分钟。
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

  // ==== A. 二维斜碰预置：两球 z 错开、入射带 z 分量 ====
  await page.selectOption('#selPreset', 'momentum2d');
  await page.waitForTimeout(400);
  const scene = await page.evaluate(() => {
    const balls = window.MECH.doc().entities.filter((e) => e.type === 'sphere');
    return {
      n: balls.length,
      zA: balls[0].transform.pos[2], zB: balls[1].transform.pos[2],
      vzA: balls[0].physics.linvel[2],
      e: balls[0].physics.restitution,
    };
  });
  check('斜碰预置: 双球 + z 错开 + 入射 z 分量', scene.n === 2
    && Math.abs(scene.zA - scene.zB) > 0.05 && Math.abs(scene.vzA) > 0.1,
    JSON.stringify(scene));
  await page.click('#btnPlay');
  // 接触发生在 ~2.2s（A 行进 1.2 m/s × 2.6m 距离）；等待碰撞后 z 分离达标（负载下实时率<1）
  await page.waitForFunction(() => {
    const balls = window.MECH.doc().entities.filter((e) => e.type === 'sphere');
    if (balls.length !== 2) return false;
    const a = window.MECH.telemetry(balls[0].id), b = window.MECH.telemetry(balls[1].id);
    return a && b && Math.abs(a.pos[2] - b.pos[2]) > 0.25;
  }, null, { timeout: 10000 });
  await page.click('#btnPause');
  const spread = await page.evaluate(() => {
    const balls = window.MECH.doc().entities.filter((e) => e.type === 'sphere');
    return balls.map((b) => {
      const t = window.MECH.telemetry(b.id);
      return { name: b.name, x: +t.pos[0].toFixed(2), z: +t.pos[2].toFixed(2), v: +t.speed.toFixed(2) };
    });
  });
  check('两球散开(z 位置分离增大)', Math.abs(spread[0].z - spread[1].z) > 0.25,
    JSON.stringify(spread));
  await page.screenshot({ path: 'shots/260-momentum2d.png' });

  // ==== B. 运行解释：kind=momentum-2d，动量矢量守恒门控 ====
  await page.click('#tabAgent');
  await page.waitForTimeout(300);
  // RunExplain 需 agentPlan 建场后开放：momentum2d fixture 建场（二维布局：
  // given.position 自由落位 + z 错开），解释器按 doc 走 2d 分支
  await page.evaluate(() => window.MECH.loadFixture('momentum2d'));
  await page.waitForTimeout(300);
  await page.click('#btnReset');      // A 段暂停后仍是运行态——建场要求编辑态
  await page.waitForTimeout(300);
  await page.click('#btnApplyParse');
  await page.waitForTimeout(400);
  const built = await page.evaluate(() => {
    const balls = window.MECH.doc().entities.filter((e) => e.type === 'sphere');
    return { n: balls.length, zSep: Math.abs(balls[0].transform.pos[2] - balls[1].transform.pos[2]) };
  });
  check('fixture 建场保持二维布局(z 错开)', built.n === 2 && built.zSep > 0.05, JSON.stringify(built));
  await page.click('#tabAgent');   // applyAgentPlan 尾部 selectTab('inspector') 会切走面板
  await page.waitForTimeout(250);
  await page.click('#btnRunExplain');
  await page.waitForFunction(() => {
    const b = document.getElementById('explainBody');
    return b && b.textContent.length > 200 && !document.getElementById('btnRunExplain').disabled;
  }, null, { timeout: 180000, polling: 500 });
  const ex = await page.evaluate(() => window.MECH.explainState());
  check('解释分支 momentum-2d', ex && ex.supported && ex.kind === 'momentum-2d', ex ? ex.kind : 'null');
  check('x 动量分量守恒(<2%)', ex && ex.momentum2d.errX < 2, `errX=${ex.momentum2d.errX.toFixed(3)}%`);
  check('z 动量分量守恒(<2%)', ex && ex.momentum2d.errZ < 2, `errZ=${ex.momentum2d.errZ.toFixed(3)}%`);
  check('判定通过(矢量门控)', ex && ex.pass === true);
  check('KE 损失介于 0 与一维同 e 之间', ex && ex.ke.lossPct > 0 && ex.ke.lossPct < (1 - ex.e * ex.e) * 100,
    `loss=${ex.ke.lossPct.toFixed(1)}% 一维上限=${((1 - ex.e * ex.e) * 100).toFixed(1)}%`);
  await page.screenshot({ path: 'shots/261-momentum2d-explain.png' });

  // ==== C. 一维回归：等 B 段解释完成（按钮恢复）后切预置 ====
  // 等 #2（B 段排队触发的重跑）完成——headless 掉帧下 4s 模拟可能 60s+
  await page.waitForFunction(() => !document.getElementById('btnRunExplain').disabled, null, { timeout: 150000 });
  await page.selectOption('#selPreset', 'momentum');
  await page.waitForTimeout(400);
  await page.click('#tabAgent');
  await page.evaluate(() => window.MECH.loadFixture('momentum'));
  await page.waitForTimeout(300);
  await page.click('#btnApplyParse');
  // AG-V：建场后自动自查（异步探针）——等自查收尾再跑解释，避免 resetSim 冲掉录制
  await page.waitForFunction(() => window.MECH.agentBusy && !window.MECH.agentBusy(), null, { timeout: 30000, polling: 100 });
  await page.click('#tabAgent');
  await page.click('#btnRunExplain');
  await page.waitForFunction(() => {
    const b = document.getElementById('explainBody');
    return b && b.textContent.length > 80 && !document.getElementById('btnRunExplain').disabled;
  }, null, { timeout: 120000 });
  const ex1 = await page.evaluate(() => window.MECH.explainState());
  check('一维分支回归 momentum-1d', ex1 && ex1.supported && ex1.kind === 'momentum-1d' && ex1.pass,
    ex1 ? `kind=${ex1.kind} pass=${ex1.pass}` : 'null');

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
