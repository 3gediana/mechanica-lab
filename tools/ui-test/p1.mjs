// p1.mjs — P1 纵向切片验收：上传题图 → 解析（示例数据全链路 + 真实 API 单次）→ 确认/修正 → 白名单建场 → 真实物理运行
// 纪律：单浏览器 / 单 context / 单标签；真实 API 仅调用一次，失败不重试超过 1 次；总时长上限约 4 分钟。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8721';
const QUESTION_IMG = new URL('../fixtures/question-incline.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
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

  // ---- 打开 Agent 面板 + 上传题图
  await page.click('#tabAgent');
  await page.waitForTimeout(150);
  check('Agent 标签页打开', await page.isVisible('#agentWrap'));
  await page.setInputFiles('#agentFile', QUESTION_IMG);
  await page.waitForSelector('#imgPrevWrap', { state: 'visible' });
  check('题图上传+预览', await page.isVisible('#imgPrev') && !(await page.isVisible('#dropZone')));

  // ---- 示例数据解析（fixture，明确标注）
  await page.click('#btnFixtureParse');
  await page.waitForSelector('#parseResultGrp', { state: 'visible' });
  const badge = await page.textContent('#parseSrcBadge');
  const st = await page.evaluate(() => window.MECH.agentState());
  check('示例解析载入并标注', st.hasPlan && st.fixture === true && badge.includes('示例'), `badge=${badge.trim()} entities=${st.entities.length}`);
  check('解析含斜面+球', st.entities.some((e) => e.type === 'ramp') && st.entities.some((e) => e.type === 'sphere'),
    JSON.stringify(st.entities.map((e) => e.type)));
  check('未知量/假设已列出', await page.locator('#parseLists .plist li').count() >= 4);

  // ---- 用户修正：球质量 1 → 2
  const massInput = page.locator('.pe-row', { hasText: '小球' }).locator('input').first();
  await massInput.fill('2');
  await massInput.press('Enter');
  const st2 = await page.evaluate(() => window.MECH.agentState());
  check('用户修正解析值', st2.correctionCount >= 1 && st2.entities.find((e) => e.type === 'sphere').given.mass === 2,
    `corrections=${st2.correctionCount} mass=${st2.entities.find((e) => e.type === 'sphere').given.mass}`);
  await page.screenshot({ path: 'shots/10-agent-parse-review.png' });

  // ---- 确认建场（经 MECH 白名单）
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    doc: window.MECH.doc(),
    state: window.MECH.state(),
  }));
  const ents = after.doc.entities;
  check('白名单建场: 实体创建', ents.length === 2 && ents.every((e) => e.source === 'agent'),
    JSON.stringify(ents.map((e) => `${e.type}:${e.source}`)));
  check('白名单建场: 重力生效', after.doc.gravity === -10, `gravity=${after.doc.gravity}`);
  check('白名单建场: meta 记录假设/修正/来源',
    after.doc.meta.source === 'agent' && after.doc.meta.assumptions.length >= 2 && after.doc.meta.corrections.length >= 1
    && after.doc.meta.origin && after.doc.meta.origin.fixture === true,
    `assumptions=${after.doc.meta.assumptions.length} corrections=${after.doc.meta.corrections.length}`);

  // ---- 真实物理：光滑斜面下滑（friction=0，应滑动加速）
  await page.click('#btnPlay');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/11-agent-scene-running.png' });
  await page.waitForTimeout(800);
  const run = await page.evaluate(() => {
    const ball = window.MECH.entities().find((e) => e.type === 'sphere');
    return window.MECH.telemetry(ball.id);
  });
  check('解析场景真实演化: 球加速下滑', run && run.speed > 1 && run.pos[1] < 1.0,
    `v=${run.speed.toFixed(2)} y=${run.pos[1].toFixed(2)} x=${run.pos[0].toFixed(2)}`);
  await page.click('#btnReset');

  // ---- 真实 API 单次调用（step-5-preview）；失败最多重试 1 次，仍败则记 BLOCKED 继续
  let realOk = false, realDetail = '';
  for (let attempt = 1; attempt <= 2 && !realOk; attempt++) {
    try {
      await page.click('#tabAgent');          // 建场后面板自动切回检查器，重开
      await page.waitForTimeout(150);
      await page.click('#btnParse');
      // 等待：状态从"正在解析"变为完成或失败
      await page.waitForFunction(() => {
        const el = document.getElementById('parseStatus');
        return el && !el.textContent.includes('正在解析');
      }, null, { timeout: 100000 });
      const txt = await page.textContent('#parseStatus');
      if (txt.includes('解析完成')) {
        realOk = true;
        realDetail = await page.textContent('#parseSrcBadge');
      } else {
        realDetail = txt.trim().slice(0, 80);
      }
    } catch (e) {
      realDetail = '等待超时: ' + e.message.slice(0, 60);
    }
  }
  if (realOk) {
    const st3 = await page.evaluate(() => window.MECH.agentState());
    check('真实 API 解析（step-5-preview）', st3.hasPlan && st3.fixture === false && st3.entities.length >= 1,
      `badge=${realDetail.trim()} entities=${JSON.stringify(st3.entities.map((e) => e.type))}`);
    await page.screenshot({ path: 'shots/12-real-parse.png' });
    // 真实解析同样走确认建场
    await page.evaluate(() => window.MECH.loadPreset('empty'));
    await page.click('#btnApplyParse');
    await page.waitForTimeout(300);
    const doc2 = await page.evaluate(() => window.MECH.doc());
    check('真实解析建场', doc2.entities.length >= 1 && doc2.entities.every((e) => e.source === 'agent')
      && doc2.meta.origin.fixture === false, `n=${doc2.entities.length}`);
    const stR = await page.evaluate(() => window.MECH.state());
    check('建场后仍在编辑态', stR.mode === 'edit');
  } else {
    check('真实 API 解析（step-5-preview）', false, `BLOCKED: ${realDetail}`);
  }

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
