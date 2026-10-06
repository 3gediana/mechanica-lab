// p40-data-export.mjs — DE-1 实验数据导出：解释/自查探针的采样序列 → CSV 下载（Excel 直开）。
// 验收：①建场自查后探针序列可导（lastSeries 快照重置不丢）②CSV 结构正确（表头/行数/t 单调/数值列）
// ③本地指令「导出数据」同通道触发 ④空数据按钮给引导 toast 不炸。
// 建场走真实 normalizeParse→applyAgentPlan(vivid)→runAgentVerify 链（stub fetch 零出网）。
// 用法：MECH_BASE=http://127.0.0.1:8722 node p40-data-export.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

const INCLINE = { questionType: '斜面下滑', kind: '', goal: '求底端速度', gravity: 9.81,
  entities: [
    { type: 'ramp', name: '斜面', given: { angleDeg: 30, length: 2 }, confidence: 0.95 },
    { type: 'sphere', name: '小球', given: { mass: 1 }, confidence: 0.9 }],
  observations: [], anchorPoints: [], keyPoints: [], environment: '不计摩擦',
  unknowns: [], uncertain: [], removals: [], joint: null, assumptions: [], confidence: 0.9 };

async function withPage(fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('net::ERR_FAILED')) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);
  await page.route('**/api/**', (r) => r.abort());
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

async function buildIncline(page) {
  await page.evaluate(() => document.getElementById('btnNew').click());
  await page.evaluate((stub) => {
    window.__realFetch = window.fetch;
    window.fetch = async (url) => {
      if (String(url).includes('/api/parse-text')) return { json: async () => ({ ok: true, parse: stub }) };
      return window.__realFetch(url);
    };
    document.getElementById('tabAgent').click();
    document.getElementById('agentTextReq').value = '按题目建场（一比一还原成拟真沙盘场景演示）';
    document.getElementById('btnParseText').click();
  }, INCLINE);
  await page.waitForFunction(() => {
    const b = document.getElementById('btnApplyParse');
    return b && !b.disabled && document.getElementById('changePreview').style.display !== 'none';
  }, null, { timeout: 30000, polling: 300 });
  await page.click('#btnApplyParse');
  await page.waitForFunction(() => window.MECH.agentVerifyState() != null && !window.MECH.agentBusy(),
    null, { timeout: 60000, polling: 300 });
}

async function saveDownload(page, trigger) {
  const dl = page.waitForEvent('download', { timeout: 15000 });
  await trigger();
  const d = await dl;
  const path = await d.path();
  return { name: d.suggestedFilename(), text: readFileSync(path, 'utf-8') };
}

try {
  // ==== A. 自查探针序列 → 导出 CSV ====
  await withPage(async (page) => {
    await buildIncline(page);
    const info = await page.evaluate(() => window.MECH.lastSeriesInfo());
    check('A1 探针序列已快照', info && info.n > 20, JSON.stringify(info));
    const { name, text } = await saveDownload(page, () => page.click('#btnExportCSV'));
    const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    check('A2 文件名带题型标签', name.startsWith('mechanica-') && name.includes('斜面') && name.endsWith('.csv'), name);
    check('A3 表头九列', lines[0] === 't_s,x_m,y_m,z_m,vx_mps,vy_mps,vz_mps,speed_mps,rotz_rad', lines[0]);
    check('A4 行数与快照一致', lines.length - 1 === info.n, `csv=${lines.length - 1} snapshot=${info.n}`);
    const body = lines.slice(1).map((l) => l.split(',').map(Number));
    const tOk = body.every((r, i) => r.length === 9 && r.every((v) => Number.isFinite(v)) && (i === 0 || r[0] > body[i - 1][0]));
    check('A5 数值列全有限且 t 严格递增', tOk && body.length > 20, `rows=${body.length}`);
    const speeds = body.map((r) => r[7]);
    check('A6 速度非全零（球真在动）', Math.max(...speeds) > 0.3, `max=${Math.max(...speeds).toFixed(2)}`);
  });

  // ==== B. 本地指令「导出数据」同通道 + 空数据引导 ====
  await withPage(async (page) => {
    await buildIncline(page);
    const dl = page.waitForEvent('download', { timeout: 15000 });
    await page.fill('#agentTextReq', '导出数据');
    await page.focus('#agentTextReq');
    await page.keyboard.press('Control+Enter');
    const d = await dl;
    check('B1 本地指令触发导出', (await d.suggestedFilename()).endsWith('.csv'), d.suggestedFilename());
  });

  await withPage(async (page) => {
    await page.evaluate(() => document.getElementById('btnNew').click());
    await page.evaluate(() => document.getElementById('tabAgent').click());
    // 空数据时导出按钮所在面板不可见——真实可达路径是本地指令「导出数据」
    await page.fill('#agentTextReq', '导出数据');
    await page.focus('#agentTextReq');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(300);
    const t = await page.evaluate(() => document.getElementById('toast').textContent);
    check('B2 空数据给引导 toast（不炸）', t.includes('导出') && t.includes('解释'), t);
  });

  // ==== C. console 净 ====
  check('C1 无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

const fails = results.filter((r) => !r.ok);
console.log(`\n== 汇总 ==\nPASS ${results.length - fails.length}/${results.length}`);
process.exit(fails.length ? 1 : 0);
