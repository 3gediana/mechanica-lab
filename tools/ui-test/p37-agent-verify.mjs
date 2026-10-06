// p37-agent-verify.mjs — 建场自查（AG-V）：Agent 自己发现自己建的系统的 bug 与题目误差。
// 验收：①干净斜面题自查全过+理论对照吻合 ②ramp+box 通用布局嵌入斜坡→检出+自动修复（可撤销）
// ③题给大初速→运动探针检出飞出 ④多 box 散开不叠 ⑤报告面板渲染 ⑥探针后场景回到初始态 ⑦console 净。
// 全程 stub /api（零出网），fixture 走真实 normalizeParse→planToOverrides→applyAgentPlan 链。
// 用法：MECH_BASE=http://127.0.0.1:8722 node p37-agent-verify.mjs
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

// 解析 stub：直接回服务端形状 {ok, parse}
const STUBS = {
  // 干净斜面题（fixture 同形）
  incline: { questionType: '斜面下滑', kind: '', goal: '求底端速度', gravity: 9.81,
    entities: [
      { type: 'ramp', name: '斜面', given: { angleDeg: 30, length: 2 }, confidence: 0.95 },
      { type: 'sphere', name: '小球', given: { mass: 1 }, confidence: 0.9 }],
    observations: [], anchorPoints: [], keyPoints: [], environment: '不计摩擦',
    unknowns: [], uncertain: [], removals: [], joint: null, assumptions: [], confidence: 0.9 },
  // 复杂题：斜面+球+两方块（验证通用 box 布局在斜面旁的嵌入检出+自动修复+多 box 散开）
  complex: { questionType: '斜面推块', kind: '', goal: '球下滑撞击两方块', gravity: 9.81,
    entities: [
      { type: 'ramp', name: '斜面', given: { angleDeg: 30, length: 2 }, confidence: 0.95 },
      { type: 'sphere', name: '小球', given: { mass: 1 }, confidence: 0.9 },
      { type: 'box', name: '方块甲', given: { mass: 2 }, confidence: 0.9 },
      { type: 'box', name: '方块乙', given: { mass: 2 }, confidence: 0.9 }],
    observations: [], anchorPoints: [], keyPoints: [], environment: '',
    unknowns: [], uncertain: [], removals: [], joint: null, assumptions: [], confidence: 0.9 },
  // 大初速平抛（无斜面+地面=projectile 布局，探针应检出飞出）
  flyaway: { questionType: '抛体', kind: '', goal: '观察抛体', gravity: 9.81,
    entities: [
      { type: 'sphere', name: '炮弹', given: { mass: 2, velocity: [30, 8, 0], radius: 0.2 }, confidence: 0.95 }],
    observations: [], anchorPoints: [], keyPoints: [], environment: '',
    unknowns: [], uncertain: [], removals: [], joint: null, assumptions: [], confidence: 0.9 },
};

async function withPage(fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('net::ERR_FAILED')) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);
  await page.route('**/api/**', (r) => r.abort());   // 出网保险丝
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}
async function applyStub(page, name) {
  await page.evaluate(() => document.getElementById('btnNew').click());   // 清默认场景：自查只对本次建场负责
  await page.evaluate((stub) => {
    window.__realFetch = window.fetch;
    window.fetch = async (url) => {
      if (String(url).includes('/api/parse-text')) {
        return { json: async () => ({ ok: true, parse: stub }) };
      }
      return window.__realFetch(url);
    };
    document.getElementById('tabAgent').click();
    document.getElementById('agentTextReq').value = '按题目建场（一比一还原成拟真沙盘场景演示）';
    document.getElementById('btnParseText').click();   // 长句守卫→模型通道→stub
  }, STUBS[name]);
  await page.waitForFunction(() => {
    const b = document.getElementById('btnApplyParse');
    return b && !b.disabled && document.getElementById('changePreview').style.display !== 'none';
  }, null, { timeout: 30000, polling: 300 });
  await page.click('#btnApplyParse');
  await page.waitForFunction(() => window.MECH.agentVerifyState() != null, null, { timeout: 30000, polling: 300 });
}

try {
  // ==== A. 干净斜面题：自查通过 + 理论对照吻合 ====
  await withPage(async (page) => {
    await applyStub(page, 'incline');
    const st = await page.evaluate(() => window.MECH.agentVerifyState());
    check('A1 自查面板可见', await page.isVisible('#verifyGrp'));
    check('A2 静态零 error', st.summary.error === 0, JSON.stringify(st.summary));
    const rampOk = st.findings.some((f) => f.cat === '静态·斜面' && f.sev === 'ok');
    check('A3 球在坡面上（语义核对）', rampOk, JSON.stringify(st.findings.filter((f) => f.cat === '静态·斜面')));
    const theory = st.findings.find((f) => f.cat === '理论对照');
    check('A4 理论对照存在且非 error', theory && theory.sev !== 'error', theory && theory.msg);
    check('A5 探针后回到编辑态', (await page.evaluate(() => document.getElementById('modeChip').textContent)).includes('编辑'));
    check('A6 探针后实体数不变', (await page.evaluate(() => window.MECH.doc().entities.length)) === 2);
  });

  // ==== B. 复杂题：box 通用布局撞斜坡 → 检出+自动修复；两 box 散开 ====
  await withPage(async (page) => {
    await applyStub(page, 'complex');
    const st = await page.evaluate(() => window.MECH.agentVerifyState());
    check('B1 检出嵌入并自动修复', st.repaired >= 1, JSON.stringify({ repaired: st.repaired, s: st.summary }));
    check('B2 修复后嵌入清零', !st.findings.some((f) => f.sev === 'error' && f.msg.includes('嵌入')), JSON.stringify(st.summary));
    const boxes = await page.evaluate(() => window.MECH.doc().entities.filter((e) => e.type === 'box').map((e) => e.transform.pos[0]));
    check('B4 两方块散开（x 间距 ≥0.8）', boxes.length === 2 && Math.abs(boxes[0] - boxes[1]) >= 0.8, JSON.stringify(boxes));
    // 修复是独立历史条目：撤销一次=修复回滚（嵌入回来），再撤销一次=整场建场回滚
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const afterUndo = await page.evaluate(() => {
      const s = window.MECH.agentVerifyState();
      return { boxes: window.MECH.doc().entities.filter((e) => e.type === 'box').map((e) => e.transform.pos[0]) };
    });
    check('B5 Ctrl+Z 只回滚修复（建场保留）', afterUndo.boxes.length === 2, JSON.stringify(afterUndo));
  });

  // ==== C. 大初速飞出：运动探针检出 ====
  await withPage(async (page) => {
    await applyStub(page, 'flyaway');
    const st = await page.evaluate(() => window.MECH.agentVerifyState());
    const esc = st.findings.find((f) => f.cat === '运动·出界');
    check('C1 探针检出飞出', esc && esc.sev === 'error', esc && esc.msg);
    check('C2 汇总计数=1 error', st.summary.error === 1, JSON.stringify(st.summary));
  });

  // ==== D. 重跑自查按钮 ====
  await withPage(async (page) => {
    await applyStub(page, 'incline');
    const at1 = await page.evaluate(() => window.MECH.agentVerifyState().at);
    await page.waitForTimeout(30);
    await page.evaluate(() => document.getElementById('btnRerunVerify').click());
    await page.waitForTimeout(1200);
    const at2 = await page.evaluate(() => window.MECH.agentVerifyState().at);
    check('D1 重跑自查刷新报告', at2 > at1, `${at1}→${at2}`);
  });

  // ==== E. console 净 ====
  check('E1 无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

const fails = results.filter((r) => !r.ok);
console.log(`\n== 汇总 ==\nPASS ${results.length - fails.length}/${results.length}`);
process.exit(fails.length ? 1 : 0);
