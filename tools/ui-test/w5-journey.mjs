// w5-journey.mjs — 独立接管审计：E5 完整新用户旅程 + 整体 UX 走查
// 一位教师从启动到二次使用的连续旅程（不中断、真实 UI 入口）+ 死按钮/占位文案/术语扫描。
// 解析段走 fixture 按钮（无 key 用户正规 UI 入口；真实模型通道已由 w2/w4 E4 单独验证）。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8721';
mkdirSync('shots/w5', { recursive: true });

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

  // ===== J1. 冷启动体验（加载面→工作台，无报错）=====
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.waitForTimeout(1200);
  const boot = await page.evaluate(() => {
    const veil = document.querySelector('#veil');
    return {
      veilGone: !veil || veil.classList.contains('gone'),
      presetLoaded: window.MECH.state().count,
      simbarVisible: !!document.querySelector('#simbar'),
    };
  });
  check('J1 冷启动: 加载面收起+默认场景就绪+底栏可见',
    boot.veilGone && boot.presetLoaded === 3 && boot.simbarVisible,
    `veil=${boot.veilGone} n=${boot.presetLoaded}`);
  await page.screenshot({ path: 'shots/w5/01-boot.png' });

  // ===== J2. UX 扫描：占位文案/TODO/死内链 =====
  const uxScan = await page.evaluate(() => {
    const body = document.body.textContent || '';
    const hits = [];
    for (const pat of ['TODO', 'FIXME', '占位', '敬请期待', ' coming soon', 'Lorem']) {
      if (body.includes(pat)) hits.push(pat);
    }
    // 空标题/空 tooltip 的按钮
    const emptyBtns = [...document.querySelectorAll('button')]
      .filter((b) => !b.textContent.trim() && !b.title).map((b) => b.id || 'unnamed');
    return { hits, emptyBtns };
  });
  check('J2 UX: 无占位文案/TODO 残留', uxScan.hits.length === 0, `hits=${JSON.stringify(uxScan.hits)}`);
  check('J2b UX: 无无文字无标题的死按钮', uxScan.emptyBtns.length === 0, JSON.stringify(uxScan.emptyBtns));

  // ===== J3. 全按钮冒烟（视图/工具类逐个点击，捕获 pageerror）=====
  // 危险按钮（改文档/解析/保存/运行控制）排除——已在其他断言覆盖
  const safeButtons = ['#btnSnap', '#btnViewReset', '#btnViewTop', '#btnViewFront', '#btnViewSide',
    '#btnOrtho', '#btnModeMove', '#btnModeRotate', '#btnModeScale', '#btnFocus'];
  let clickErrorsBefore = consoleErrors.length;
  for (const sel of safeButtons) {
    const visible = await page.locator(sel).isVisible().catch(() => false);
    if (visible) { await page.click(sel); await page.waitForTimeout(120); }
  }
  await page.click('#btnOrtho');   // 切回透视
  check('J3 全按钮冒烟: 视图/工具类点击零异常', consoleErrors.length === clickErrorsBefore,
    `errors=${consoleErrors.length - clickErrorsBefore}`);

  // ===== J4. 旅程主线：预置备课 → 改参数 → 运行观察 → 守恒量 =====
  await page.selectOption('#selPreset', 'momentum');
  await page.waitForTimeout(500);
  await page.locator('#outline .ol-row', { hasText: '球 B' }).first().click();
  await page.waitForTimeout(200);
  const rowMass = page.locator('#inspBody .frow', { has: page.locator('label', { hasText: '质量' }) }).first();
  const massInp = rowMass.locator('input').first();
  await massInp.fill('2');
  await massInp.press('Enter');
  await page.waitForTimeout(300);
  await page.click('#btnPlay');
  await page.waitForTimeout(2600);
  const j4 = await page.evaluate(() => {
    const bar = document.querySelector('#consbar');
    return {
      simT: window.MECH.state().simT,
      consText: bar ? bar.textContent : '',
      on: !!(bar && bar.classList.contains('on')),
    };
  });
  check('J4 备课旅程: 改质量→运行→守恒条读数(动量误差0.000%)',
    j4.simT > 1.5 && j4.on && /动量误差0\.000%/.test(j4.consText),
    `simT=${j4.simT.toFixed(2)}`);
  await page.screenshot({ path: 'shots/w5/02-teaching.png' });
  await page.click('#btnReset');
  await page.waitForTimeout(300);

  // ===== J5. 旅程支线：拍题解析（fixture 按钮=无 key 正规入口）→ 评审 → 建场 → 解释 =====
  await page.click('#tabAgent');
  await page.waitForTimeout(200);
  await page.click('#btnFixtureParse');
  await page.waitForTimeout(700);
  const review = await page.evaluate(() => ({
    stage: (document.querySelector('#taskStage') || {}).textContent || '',
    badge: (document.querySelector('#parseSrcBadge') || {}).textContent || '',
    inputs: document.querySelectorAll('#parseEntities input[type=number]').length,
  }));
  check('J5a 解析评审: 待确认+示例徽标+可编辑表单', /待确认/.test(review.stage) && /示例/.test(review.badge) && review.inputs > 0,
    `stage=${review.stage} badge=${review.badge} inputs=${review.inputs}`);
  await page.click('#btnApplyParse');
  await page.waitForTimeout(900);
  await page.click('#tabAgent');
  await page.waitForTimeout(300);
  await page.click('#btnRunExplain');
  const j5 = await page.evaluate(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const stage = (document.querySelector('#taskStage') || {}).textContent || '';
      const btn = document.querySelector('#btnRunExplain');
      if (stage === '已解释' && btn && !btn.disabled) {
        const ex = window.MECH.explainState();
        return { stage, ex };
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return { stage: 'timeout', ex: null };
  });
  check('J5b 解释: 已解释+理论与实测一致(<5%)',
    j5.stage === '已解释' && j5.ex && j5.ex.supported && j5.ex.theoretical && j5.ex.measured
    && Math.abs(j5.ex.theoretical.value - j5.ex.measured.value) / Math.abs(j5.ex.theoretical.value) < 0.05,
    `stage=${j5.stage}`);
  await page.screenshot({ path: 'shots/w5/03-explained.png' });

  // ===== J6. 保存 → 刷新恢复 → 继续编辑 → 第二场景（重复使用）=====
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.click('#btnSave'),
  ]);
  const p1 = 'shots/w5/journey-saved.json';
  await dl.saveAs(p1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.waitForTimeout(1200);
  const j6a = await page.evaluate(() => window.MECH.state().count);
  check('J6a 刷新后 autosave 恢复(解析建场场景保留)', j6a >= 2, `n=${j6a}`);
  // 继续编辑：加一个方块
  await page.locator('.comp-item', { hasText: '方块' }).first().click();
  await page.waitForTimeout(300);
  const j6b = await page.evaluate(() => window.MECH.state().count);
  check('J6b 恢复后继续编辑', j6b === j6a + 1, `n=${j6b}`);
  // 第二个场景
  await page.click('#btnNew');
  await page.waitForTimeout(250);
  await page.locator('.comp-item', { hasText: '圆柱' }).first().click();
  await page.waitForTimeout(300);
  const j6c = await page.evaluate(() => window.MECH.state().count);
  check('J6c 第二场景创建（重复使用）', j6c === 1, `n=${j6c}`);

  // ===== J7. 术语与可理解性：关键控件有 title/说明 =====
  const terms = await page.evaluate(() => {
    const needTitle = ['btnPlay', 'btnPause', 'btnStep', 'btnReset', 'btnSave', 'btnOpen', 'btnUndo', 'btnRedo',
      'btnVectors', 'btnTrails', 'btnCons', 'btnModeMove', 'btnModeScale'];
    const missing = needTitle.filter((id) => {
      const el = document.getElementById(id);
      return !el || (!el.title && !el.textContent.trim());
    });
    return missing;
  });
  check('J7 关键控件均有可见文字或 tooltip', terms.length === 0, JSON.stringify(terms));

  // ===== J8. 收尾：整旅程零页面错误 =====
  check('J8 全旅程零 console/page 错误', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | ').slice(0, 200));

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
