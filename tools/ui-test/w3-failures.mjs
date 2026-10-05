// w3-failures.mjs — 独立接管审计：失败/恢复路径走查（对无 Key 服务器运行）
// 覆盖：无 Key 图片解析（真实上传→真实失败文案→fixture 兜底可用）/ 图片格式错误 / 服务不可用 / 解析拒绝路径
// 预期运行环境：serve.py 在无 MECHANICA_STEP_KEY 且 tools/server/step_key.txt 移走时启动。
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
const QUESTION_IMG = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/question-incline.png');

mkdirSync('shots/w3', { recursive: true });

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
  await page.waitForTimeout(900);
  await page.click('#tabAgent');
  await page.waitForTimeout(200);

  // ===== D1. 图片格式错误：上传非图片文件 =====
  const badImg = 'shots/w3/not-an-image.json';
  writeFileSync(badImg, '{"no": "image"}');
  const [ch1] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#dropZone'),
  ]);
  await ch1.setFiles(badImg);
  await page.waitForTimeout(700);
  const st1 = await page.evaluate(() => ({
    status: (document.querySelector('#parseStatus') || {}).textContent || '',
    shown: getComputedStyle(document.querySelector('#imgPrevWrap')).display !== 'none',
  }));
  check('D1 非图片文件: 用户可见「图片读取失败」+不进预览', /图片读取失败/.test(st1.status) && !st1.shown,
    `status="${st1.status.trim()}"`);

  // ===== D2. 无 Key 真实解析：失败文案 + 阶段=出错 + fixture 兜底仍在 =====
  const [ch2] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#dropZone'),
  ]);
  await ch2.setFiles(QUESTION_IMG);
  await page.waitForTimeout(700);
  const upOk = await page.evaluate(() => getComputedStyle(document.querySelector('#imgPrevWrap')).display !== 'none');
  await page.click('#btnParse');
  const st2 = await page.evaluate(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const stage = (document.querySelector('#taskStage') || {}).textContent || '';
      if (/出错/.test(stage)) {
        return {
          stage,
          status: (document.querySelector('#parseStatus') || {}).textContent || '',
          fixtureBtn: !document.querySelector('#btnFixtureParse').disabled,
        };
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return { stage: 'timeout', status: '', fixtureBtn: false };
  });
  check('D2 无 Key 解析: 阶段=出错+用户可见原因+重试/fixture 提示', /出错/.test(st2.stage) && /解析失败/.test(st2.status) && /示例数据|重试/.test(st2.status),
    `stage=${st2.stage} status="${st2.status.trim().slice(0, 90)}"`);
  check('D2b fixture 兜底按钮仍可用', st2.fixtureBtn);
  await page.screenshot({ path: 'shots/w3/01-nokey-error.png' });

  // fixture 兜底走通（明确标注 fixture）
  await page.click('#btnFixtureParse');
  await page.waitForTimeout(700);
  const st3 = await page.evaluate(() => ({
    stage: (document.querySelector('#taskStage') || {}).textContent || '',
    badge: (document.querySelector('#parseSrcBadge') || {}).textContent || '',
  }));
  check('D2c 无 Key 时 fixture 兜底走通（标注示例/fixture）', /待确认/.test(st3.stage) && /示例|fixture/i.test(st3.badge),
    `stage=${st3.stage} badge=${st3.badge}`);

  // ===== D3. 解析拒绝路径：清空解析（用户拒绝整个计划）=====
  // 注：应用启动即载入 incline 预置（3 实体），「清空解析」的语义=丢弃解析计划且不污染已有场景文档
  const docBeforeClear = await page.evaluate(() => JSON.stringify(window.MECH.doc()));
  await page.click('#btnClearParse');
  await page.waitForTimeout(500);
  const st4 = await page.evaluate(() => ({
    total: window.MECH.state().count,
    grpShown: getComputedStyle(document.querySelector('#parseResultGrp')).display !== 'none',
  }));
  const docAfterClear = await page.evaluate(() => JSON.stringify(window.MECH.doc()));
  check('D3 清空解析: 场景文档未被污染(前后一致)+结果面板收起', docBeforeClear === docAfterClear && st4.total === 3 && !st4.grpShown,
    `total=${st4.total} docSame=${docBeforeClear === docAfterClear}`);

  // ===== D4. 服务不可用（网络失败）：杀服务器后解析 → 用户可见文案 =====
  // （由外层编排杀 serve.py；清空解析后图片预览已收起，真实用户路径=重新上传图片再解析）
  const [ch3] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#dropZone'),
  ]);
  await ch3.setFiles(QUESTION_IMG);
  await page.waitForTimeout(700);
  await page.click('#btnParse');
  const st5 = await page.evaluate(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const s = (document.querySelector('#parseStatus') || {}).textContent || '';
      if (/解析请求失败|网络或服务不可用/.test(s)) return s;
      await new Promise((r) => setTimeout(r, 300));
    }
    return '';
  });
  check('D4 服务不可用: 用户可见恢复文案（网络或服务不可用+重试）', /解析请求失败/.test(st5) && /重试/.test(st5),
    `status="${st5.trim().slice(0, 80)}"`);
  await page.screenshot({ path: 'shots/w3/02-server-down.png' });

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
