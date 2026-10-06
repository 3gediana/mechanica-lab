// p39-agent-patch.mjs — AG-V3 语义自修正闭环：自查剩余 error → 回喂模型出修订计划 → 重建 → 复验。
// 验收：①飞出题检出→修订落地（补地面+限速）复验清零 ②修订计划仍烂→2 轮封顶不无限打转
// ③干净建场不触发 ④修订服务失败自动重试一次后钉死轮数（重跑自查不再烧 API）。
// 全程 stub fetch（零出网），计划走真实 normalizeParse→applyAgentPlan(vivid)→runAgentVerify 链。
// 用法：MECH_BASE=http://127.0.0.1:8722 node p39-agent-patch.mjs
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

// 脏计划：无地面 + 题给大初速（探针必检出运动·出界 error，且该错误无自动修复）
const DIRTY = { questionType: '抛体', kind: '', goal: '观察抛体', gravity: 9.81,
  entities: [
    { type: 'sphere', name: '炮弹', given: { mass: 2, velocity: [30, 8, 0], radius: 0.2 }, confidence: 0.95 }],
  observations: [], anchorPoints: [], keyPoints: [], environment: '',
  unknowns: [], uncertain: [], removals: [], joint: null, assumptions: [], confidence: 0.9 };
// 修订计划：补地面 + 合理初速（复验应清零：出界消除）
const FIXED = { questionType: '抛体', kind: '', goal: '观察抛体', gravity: 9.81,
  entities: [
    { type: 'ground', name: '地面', given: { length: 12, width: 8 }, confidence: 0.95 },
    { type: 'sphere', name: '炮弹', given: { mass: 2, velocity: [2, 0, 0], radius: 0.2 }, confidence: 0.95 }],
  observations: [], anchorPoints: [], keyPoints: [], environment: '',
  unknowns: [], uncertain: [], removals: [], joint: null, assumptions: [], confidence: 0.9 };
const CLEAN = { questionType: '斜面下滑', kind: '', goal: '求底端速度', gravity: 9.81,
  entities: [
    { type: 'ramp', name: '斜面', given: { angleDeg: 30, length: 2 }, confidence: 0.95 },
    { type: 'sphere', name: '小球', given: { mass: 1 }, confidence: 0.9 }],
  observations: [], anchorPoints: [], keyPoints: [], environment: '不计摩擦',
  unknowns: [], uncertain: [], removals: [], joint: null, assumptions: [], confidence: 0.9 };

async function withPage(fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('net::ERR_FAILED')) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);
  await page.route('**/api/**', (r) => r.abort());   // 出网保险丝（stub 不落网，真 fetch 才会撞上）
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

// 建场驱动：parse-text 回 initial 计划；parse-patch 按 patchMode 回（fixed/dirty/fail）
async function drive(page, initial, patchMode) {
  await page.evaluate(() => document.getElementById('btnNew').click());
  await page.evaluate(([stub, mode, fixed]) => {
    window.__patchCalls = 0; window.__patchMode = mode; window.__fixedPlan = fixed;
    window.__realFetch = window.fetch;
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/parse-text')) return { json: async () => ({ ok: true, parse: stub }) };
      if (u.includes('/api/parse-patch')) {
        window.__patchCalls++;
        if (window.__patchMode === 'fail') return { json: async () => ({ ok: false, error: '解析服务错误(HTTP 502)' }) };
        return { json: async () => ({ ok: true, parse: window.__patchMode === 'fixed' ? window.__fixedPlan : stub }) };
      }
      return window.__realFetch(url);
    };
    document.getElementById('tabAgent').click();
    document.getElementById('agentTextReq').value = '按题目建场（一比一还原成拟真沙盘场景演示）';
    document.getElementById('btnParseText').click();
  }, [initial, patchMode, FIXED]);
  await page.waitForFunction(() => {
    const b = document.getElementById('btnApplyParse');
    return b && !b.disabled && document.getElementById('changePreview').style.display !== 'none';
  }, null, { timeout: 30000, polling: 300 });
  await page.click('#btnApplyParse');
  await page.waitForFunction(() => window.MECH.agentVerifyState() != null, null, { timeout: 30000, polling: 300 });
}

try {
  // ==== A. 脏计划 → 修订落地 → 复验清零 ====
  await withPage(async (page) => {
    await drive(page, DIRTY, 'fixed');
    await page.waitForFunction(() => window.MECH.agentPatchState().rounds === 1, null, { timeout: 30000, polling: 200 });
    await page.waitForFunction(() => {
      const p = window.MECH.agentPatchState();
      return !p.busy && window.MECH.agentVerifyState().summary.error === 0;
    }, null, { timeout: 60000, polling: 300 });
    const st = await page.evaluate(() => window.MECH.agentVerifyState());
    check('A1 修订触发（1 轮）', (await page.evaluate(() => window.MECH.agentPatchState().rounds)) === 1);
    check('A2 复验零 error（出界消除）', st.summary.error === 0, JSON.stringify(st.summary));
    const doc = await page.evaluate(() => {
      const d = window.MECH.doc();
      const ball = d.entities.find((e) => e.type === 'sphere');
      return { hasGround: d.entities.some((e) => e.type === 'ground'), vx: ball && ball.physics.linvel[0], n: d.entities.length };
    });
    check('A3 修订计划落地（补地面+限速）', doc.hasGround && doc.vx === 2, JSON.stringify(doc));
    await page.waitForTimeout(400);   // 留 scheduleAgentPatch 判定窗口
    check('A4 复验干净后不再触发修订', (await page.evaluate(() => window.__patchCalls)) === 1);
  });

  // ==== B. 修订计划仍是脏的 → 2 轮封顶，不无限打转 ====
  await withPage(async (page) => {
    await drive(page, DIRTY, 'dirty');
    await page.waitForFunction(() => {
      const p = window.MECH.agentPatchState();
      return p.rounds >= p.max && !p.busy;
    }, null, { timeout: 90000, polling: 300 });
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => window.MECH.agentVerifyState());
    const calls = await page.evaluate(() => window.__patchCalls);
    check('B1 轮数封顶=2 且停手', (await page.evaluate(() => window.MECH.agentPatchState().rounds)) === 2
      && (await page.evaluate(() => window.MECH.agentPatchState().busy)) === false);
    check('B2 修订恰好调用 2 次', calls === 2, 'calls=' + calls);
    check('B3 最终报告未洗白（仍 1 error）', st.summary.error === 1, JSON.stringify(st.summary));
  });

  // ==== C. 干净建场不触发修订 ====
  await withPage(async (page) => {
    await drive(page, CLEAN, 'fixed');
    await page.waitForTimeout(600);
    const p = await page.evaluate(() => window.MECH.agentPatchState());
    const calls = await page.evaluate(() => window.__patchCalls);
    const st = await page.evaluate(() => window.MECH.agentVerifyState());
    check('C1 零轮次零调用', p.rounds === 0 && calls === 0, JSON.stringify({ p, calls }));
    check('C2 自查通过', st.summary.error === 0, JSON.stringify(st.summary));
  });

  // ==== D. 修订服务失败：自动重试一次 → 钉死轮数，重跑自查不再烧 API ====
  await withPage(async (page) => {
    await drive(page, DIRTY, 'fail');
    await page.waitForFunction(() => {
      const p = window.MECH.agentPatchState();
      return p.rounds >= p.max && !p.busy;
    }, null, { timeout: 60000, polling: 300 });
    const callsAfterFail = await page.evaluate(() => window.__patchCalls);
    check('D1 失败自动重试（共 2 次调用）', callsAfterFail === 2, 'calls=' + callsAfterFail);
    await page.evaluate(() => document.getElementById('btnRerunVerify').click());
    await page.waitForFunction(() => window.MECH.agentVerifyState() && !window.MECH.agentBusy(), null, { timeout: 60000, polling: 300 });
    await page.waitForTimeout(400);
    const callsAfterRerun = await page.evaluate(() => window.__patchCalls);
    const p = await page.evaluate(() => window.MECH.agentPatchState());
    check('D2 重跑自查不再触发修订（钉死）', callsAfterRerun === 2 && p.rounds === 2, JSON.stringify({ callsAfterRerun, p }));
    const st = await page.evaluate(() => window.MECH.agentVerifyState());
    check('D3 失败不洗白报告', st.summary.error === 1, JSON.stringify(st.summary));
  });

  // ==== E. console 净 ====
  check('E1 无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

const fails = results.filter((r) => !r.ok);
console.log(`\n== 汇总 ==\nPASS ${results.length - fails.length}/${results.length}`);
process.exit(fails.length ? 1 : 0);
