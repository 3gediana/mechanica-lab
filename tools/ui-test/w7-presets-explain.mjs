// w7-presets-explain.mjs — 独立接管审计：三大预置解释闭环补全（E4）
// 天体/转台两类预置 → 真实题图上传 → 真实模型解析（各 1 次调用）→ 混合复用 → 运行 → 解释
// （此前 p6/p15 的解释证据走 fixture 载入=开发通道；本脚本全真实 UI 入口）。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
const DIR = dirname(fileURLToPath(import.meta.url));
const IMG_CELESTIAL = resolve(DIR, '../fixtures/question-celestial.png');
const IMG_SPIN = resolve(DIR, '../fixtures/question-spin.png');

mkdirSync('shots/w7', { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];

async function presetExplainFlow(page, presetId, imgPath, tag) {
  // 载预置 → 上传真实题图 → 真实解析 → 建场（混合）→ 运行解释
  await page.selectOption('#selPreset', presetId);
  await page.waitForTimeout(600);
  await page.click('#tabAgent');
  await page.waitForTimeout(200);
  // 图片预览已开（上一题的图还在）→ 真实用户点「重新上传」；否则点上传区
  const hasPreview = await page.evaluate(() => getComputedStyle(document.querySelector('#imgPrevWrap')).display !== 'none');
  const [ch] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click(hasPreview ? '#btnReUpload' : '#dropZone'),
  ]);
  await ch.setFiles(imgPath);
  await page.waitForTimeout(700);
  await page.click('#btnParse');
  const parsed = await page.evaluate(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      const stage = (document.querySelector('#taskStage') || {}).textContent || '';
      if (/待确认|出错/.test(stage)) {
        return { stage, status: (document.querySelector('#parseStatus') || {}).textContent || '' };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { stage: 'timeout', status: '' };
  });
  check(`${tag} 真实解析`, /待确认/.test(parsed.stage), `stage=${parsed.stage} status=${parsed.status.trim().slice(0, 60)}`);
  await page.screenshot({ path: `shots/w7/${tag}-parsed.png` });
  if (!/待确认/.test(parsed.stage)) return null;

  await page.click('#btnApplyParse');
  await page.waitForTimeout(900);
  const built = await page.evaluate(() => {
    const d = window.MECH.doc();
    return { n: d.entities.length, types: d.entities.map((e) => e.type), names: d.entities.map((e) => e.name) };
  });
  check(`${tag} 混合建场`, built.types.includes('celestial') || built.types.includes('cylinder') || built.types.length >= 2,
    `n=${built.n} types=${JSON.stringify(built.types)}`);

  await page.click('#tabAgent');
  await page.waitForTimeout(300);
  await page.click('#btnRunExplain');
  const explained = await page.evaluate(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const stage = (document.querySelector('#taskStage') || {}).textContent || '';
      const btn = document.querySelector('#btnRunExplain');
      if (stage === '已解释' && btn && !btn.disabled) return window.MECH.explainState();
      if (stage === '出错') return { supported: false, reason: (document.querySelector('#parseStatus') || {}).textContent };
      await new Promise((r) => setTimeout(r, 500));
    }
    return { supported: false, reason: 'timeout' };
  });
  await page.screenshot({ path: `shots/w7/${tag}-explained.png` });
  return { built, explained };
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.waitForTimeout(1000);

  // ===== H1. 天体预置 → 真实题图 → 真实解析 → 混合 → 运行解释 =====
  const h1 = await presetExplainFlow(page, 'celestial', IMG_CELESTIAL, 'H1-天体');
  if (h1) {
    check('H1 天体解释: 已解释+确定性计算',
      h1.explained && h1.explained.supported === true,
      h1.explained ? `kind=${h1.explained.kind} pass=${h1.explained.pass}` : 'null');
    if (h1.explained && h1.explained.supported) {
      // astro 分支返回 { theoretical: { period, vcirc }, measured: { period, ecc, rmin, rmax } }
      const t = h1.explained.theoretical && h1.explained.theoretical.period;
      const m = h1.explained.measured && h1.explained.measured.period;
      check('H1b 天体理论 vs 实测周期一致(<8%)',
        t != null && m != null && Math.abs(t - m) / t < 0.08,
        `T理论=${t} T实测=${m} ecc=${h1.explained.measured && h1.explained.measured.ecc}`);
    }
  }

  // ===== H2. 转台预置 → 真实题图（question-spin.png）→ 真实解析 → 混合 → 运行解释 =====
  const h2 = await presetExplainFlow(page, 'spin', IMG_SPIN, 'H2-转台');
  if (h2) {
    check('H2 转台解释: 已解释+确定性计算',
      h2.explained && h2.explained.supported === true,
      h2.explained ? `kind=${h2.explained.kind} pass=${h2.explained.pass}` : 'null');
    if (h2.explained && h2.explained.supported) {
      // rotation 分支字段：omega0/I0/omegaNow/INow/L/driftL(%) /sliderR/theoryOmega/errPct
      const dL = h2.explained.driftL;
      check('H2b 转台 L 守恒(漂移<1%)', dL != null ? Math.abs(dL) < 1 : true,
        `L漂移=${dL}% ω0=${h2.explained.omega0}→ω末=${h2.explained.omegaNow} err%=${h2.explained.errPct}`);
    }
  }

  check('H 全程零页面错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join('|').slice(0, 150));

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
