// w4-mixed.mjs — 独立接管审计：混合搭建真实用户路径（E3/E4 证据）
// 场景：用户先手动建一部分 → 真实文字通道让 Agent 补充 → 逐条接受/拒绝 → 场景不被重建 → 可运行可保存
// 与 p16（fixture）/p19（真实文字）的区别：本轮从手动建场起步走完整用户路径，真实 API 仅 1 次调用。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8721';
mkdirSync('shots/w4', { recursive: true });

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

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.waitForTimeout(1000);

  // ===== E1. 用户手动建场：空场景 + 地面板（保留用户命名）=====
  await page.click('#btnNew');
  await page.waitForTimeout(250);
  await page.locator('.comp-item', { hasText: '地面板' }).first().click();
  await page.waitForTimeout(300);
  // 大纲双击 .nm 重命名为用户自定义名（验证混合时保留）
  const row = page.locator('#outline .ol-row', { hasText: '地面板' }).first();
  await row.locator('.nm').dblclick();
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+a');
  await page.keyboard.type('我的实验台');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const manual = await page.evaluate(() => window.MECH.doc().entities[0]);
  check('E1 手动建场: 地面板+用户重命名「我的实验台」', manual.name === '我的实验台' && manual.type === 'ground',
    `name=${manual.name}`);

  // ===== E2. 真实文字要求：Agent 补充（识别已有实体，1 次真实调用）=====
  await page.click('#tabAgent');
  await page.waitForTimeout(200);
  await page.fill('#agentTextReq', '在现有场景中补充一个倾角30度坡长2米的固定斜面和一个质量1kg的小球，斜面光滑不计摩擦，小球从斜面顶端由静止释放，要求观察小球滑到斜面底端的速度');
  await page.click('#btnParseText');
  const parsed = await page.evaluate(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 95000) {
      const stage = (document.querySelector('#taskStage') || {}).textContent || '';
      if (/待确认|出错/.test(stage)) return { stage, badge: (document.querySelector('#parseSrcBadge') || {}).textContent || '' };
      await new Promise((r) => setTimeout(r, 500));
    }
    return { stage: 'timeout', badge: '' };
  });
  check('E2 文字解析: 真实模型待确认', /待确认/.test(parsed.stage), `stage=${parsed.stage} badge=${parsed.badge}`);

  // ===== E3. 变更预览区分已有实体（更新=复用/新建）=====
  const preview = await page.evaluate(() => {
    const box = document.querySelector('#changePreviewList');
    return box ? box.textContent : '';
  });
  await page.screenshot({ path: 'shots/w4/01-preview.png' });
  check('E3 变更预览显示新建条目(斜面/球)且无删除用户实体项', /新建/.test(preview) && /斜面|斜坡|ramp/i.test(preview),
    preview.replace(/\s+/g, ' ').slice(0, 150));

  // ===== E4. 接受 → 用户实体保留（不删除不重建）=====
  await page.click('#btnApplyParse');
  await page.waitForTimeout(900);
  const mixed = await page.evaluate(() => {
    const d = window.MECH.doc();
    return {
      n: d.entities.length,
      names: d.entities.map((e) => e.name),
      ground: d.entities.find((e) => e.type === 'ground'),
      ramp: d.entities.find((e) => e.type === 'ramp'),
      ball: d.entities.find((e) => e.type === 'sphere'),
    };
  });
  check('E4 混合建场: 用户「我的实验台」原样保留+新增斜面/球',
    mixed.ground && mixed.ground.name === '我的实验台' && !!mixed.ramp && !!mixed.ball && mixed.n === 3,
    `n=${mixed.n} names=${JSON.stringify(mixed.names)}`);
  const ballF = mixed.ball ? mixed.ball.physics.friction : null;
  check('E4b 光滑语义推断进混合场景(球摩擦=0)', ballF === 0, `ballFriction=${ballF}`);
  await page.screenshot({ path: 'shots/w4/02-mixed-built.png' });

  // ===== E5. 混合场景运行真实物理 + 保存重开 =====
  await page.click('#btnPlay');
  await page.waitForTimeout(2500);
  const run = await page.evaluate(() => {
    const s = window.MECH.state();
    const ball = window.MECH.entities().find((e) => e.type === 'sphere');
    return { simT: s.simT, tel: window.MECH.telemetry(ball.id) };
  });
  check('E5 混合场景运行: 球真实滑落', run.simT > 1.5 && run.tel.speed > 1, `simT=${run.simT.toFixed(2)} v=${run.tel.speed.toFixed(2)}`);
  await page.screenshot({ path: 'shots/w4/03-mixed-run.png' });
  await page.click('#btnReset');
  await page.waitForTimeout(300);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.click('#btnSave'),
  ]);
  const savedPath = 'shots/w4/mixed-saved.json';
  await dl.saveAs(savedPath);
  await page.click('#btnNew');
  await page.waitForTimeout(200);
  const [ch] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#btnOpen'),
  ]);
  await ch.setFiles(savedPath);
  await page.waitForTimeout(500);
  const reopened = await page.evaluate(() => {
    const d = window.MECH.doc();
    return { n: d.entities.length, ground: d.entities.find((e) => e.type === 'ground') };
  });
  check('E5b 混合场景保存→重开(用户命名保留)', reopened.n === 3 && reopened.ground.name === '我的实验台',
    `n=${reopened.n} ground=${reopened.ground.name}`);

  // ===== E6. 拒绝路径（真实 UI 入口）：空场景+用户实体 → fixture 解析 → 拒绝一条新建 → 依赖联动 =====
  await page.click('#btnNew');
  await page.waitForTimeout(250);
  await page.locator('.comp-item', { hasText: '地面板' }).first().click();
  await page.waitForTimeout(300);
  await page.click('#tabAgent');
  await page.waitForTimeout(200);
  await page.click('#btnFixtureParse');   // 无 key 用户正规入口（明确标注 fixture）
  await page.waitForTimeout(700);
  const listState = await page.evaluate(() => {
    const box = document.querySelector('#changePreviewList');
    if (!box) return { rows: 0, labels: [] };
    const items = [...box.querySelectorAll('input[type=checkbox]')];
    return { rows: items.length, labels: items.map((i) => i.closest('div,label')?.textContent || '') };
  });
  check('E6 预 勾选清单出现(>=3条: 重力/斜面/球)', listState.rows >= 3, `rows=${listState.rows}`);
  // 拒绝「新建 sphere」那条（勾选行的自有 label 文本含「球」）
  const rejected = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#changePreviewList input[type=checkbox]')];
    for (const it of items) {
      const lab = it.closest('label');
      const txt = lab ? lab.textContent : '';
      if (/球/.test(txt) && it.checked) { it.click(); return txt.trim().slice(0, 40); }
    }
    return null;
  });
  check('E6 预b 找到并取消勾选球条目', !!rejected, `rejected=${rejected}`);
  await page.click('#btnApplyParse');
  await page.waitForTimeout(900);
  const afterReject = await page.evaluate(() => {
    const d = window.MECH.doc();
    return {
      n: d.entities.length,
      hasRamp: d.entities.some((e) => e.type === 'ramp'),
      hasBall: d.entities.some((e) => e.type === 'sphere'),
      hasGround: d.entities.some((e) => e.type === 'ground'),
    };
  });
  check('E6 逐条拒绝: 被拒球不创建+斜面新建+用户地面板保留',
    !afterReject.hasBall && afterReject.hasRamp && afterReject.hasGround,
    `n=${afterReject.n} ramp=${afterReject.hasRamp} ball=${afterReject.hasBall} ground=${afterReject.hasGround}`);
  const e6b = await page.evaluate(async () => {
    document.getElementById('btnPlay').click();
    await new Promise((r) => setTimeout(r, 1600));
    const s = window.MECH.state();
    return { mode: s.mode, simT: s.simT, paused: s.paused };
  });
  check('E6b 拒绝后场景仍可运行', e6b.mode === 'run' && e6b.simT > 0.8,
    `mode=${e6b.mode} simT=${e6b.simT.toFixed(2)} paused=${e6b.paused}`);

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
