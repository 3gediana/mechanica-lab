// w2-agent.mjs — 独立接管审计：真实图片上传→真实模型解析→建场→运行→解释 E2E（E4 证据）
// 与 p5 的区别：p5 用 fake 相机流+fixture 数据；本脚本走真实文件上传 + 真实 /api/parse-question（step-5-preview 视觉模型）。
// 纪律：单浏览器/单 context/单标签；真实 API 调用仅 1 次（图片通道）。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
const QUESTION_IMG = '../fixtures/question-incline.png';   // 相对 tools/ui-test 的真实题目图片

mkdirSync('shots/w2', { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    permissions: [],   // 不授予相机权限（本机 headless 也无摄像头）
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.waitForTimeout(1000);

  // ===== C0. 相机不可用失败路径（无设备/无权限 → 用户可见文案）=====
  await page.click('#tabAgent');
  await page.waitForTimeout(200);
  await page.click('#btnCamera');
  await page.waitForTimeout(1200);
  const camStatus = await page.evaluate(() => (document.querySelector('#parseStatus') || {}).textContent || '');
  const camWrapShown = await page.evaluate(() => {
    const w = document.querySelector('#camWrap');
    return !!(w && getComputedStyle(w).display !== 'none');
  });
  check('C0 无相机: 用户可见错误文案+不弹相机界面', /相机不可用/.test(camStatus) && !camWrapShown,
    `status="${camStatus.trim()}" camWrap=${camWrapShown}`);

  // ===== C1. 真实上传题目图片（真实文件 → 预览）=====
  await page.click('#btnNew');
  await page.waitForTimeout(200);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#dropZone'),
  ]);
  await chooser.setFiles(QUESTION_IMG);
  await page.waitForTimeout(800);
  const upState = await page.evaluate(() => {
    const prev = document.querySelector('#imgPrev');
    const w = document.querySelector('#imgPrevWrap');
    return {
      shown: !!(w && getComputedStyle(w).display !== 'none'),
      src: prev ? prev.src.slice(0, 30) : '',
      stage: (document.querySelector('#taskStage') || {}).textContent || '',
    };
  });
  check('C1 真实图片上传: 预览显示+阶段徽标=图片就绪', upState.shown && upState.src.startsWith('data:image') && /图片就绪/.test(upState.stage),
    `stage=${upState.stage}`);
  await page.screenshot({ path: 'shots/w2/01-uploaded.png' });

  // ===== C2. 真实模型解析（step-5-preview 视觉通道，1 次调用）=====
  await page.click('#btnParse');
  const parseOutcome = await page.evaluate(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 95000) {
      const stage = (document.querySelector('#taskStage') || {}).textContent || '';
      if (/待确认|出错/.test(stage)) {
        return {
          stage,
          status: (document.querySelector('#parseStatus') || {}).textContent || '',
          badge: (document.querySelector('#parseSrcBadge') || {}).textContent || '',
          panelText: (document.querySelector('#parseResultGrp') || document.querySelector('#agentWrap') || {}).textContent || '',
        };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { stage: 'timeout', status: '', badge: '', panelText: '' };
  });
  check('C2 真实图片解析: 阶段=待确认（真实模型返回）', /待确认/.test(parseOutcome.stage),
    `stage=${parseOutcome.stage} status=${parseOutcome.status.slice(0, 80)}`);
  check('C2b 解析来源徽标=真实模型（非 fixture）', /step-5-preview/.test(parseOutcome.badge) && !/fixture|示例/.test(parseOutcome.badge),
    `badge=${parseOutcome.badge}`);
  await page.screenshot({ path: 'shots/w2/02-parsed.png' });
  console.log('  [解析面板] ' + parseOutcome.panelText.replace(/\s+/g, ' ').slice(0, 300));

  // 结构化解析内容抽查（实体/参数/置信度出现在面板）
  const panel = parseOutcome.panelText;
  check('C2c 结构化内容: 实体+ramp+质量/角度字段出现',
    /实体/.test(panel) && /ramp|斜/.test(panel) && /质量/.test(panel) && /角度|倾角/.test(panel));

  // ===== C3. 接受变更 → 创建真实场景实体 =====
  await page.click('#btnApplyParse');
  await page.waitForTimeout(900);
  const built = await page.evaluate(() => {
    const d = window.MECH.doc();
    return {
      n: d.entities.length,
      types: d.entities.map((e) => e.type),
      stage: (document.querySelector('#taskStage') || {}).textContent || '',
      ramp: d.entities.find((e) => e.type === 'ramp'),
      ball: d.entities.find((e) => e.type === 'sphere'),
    };
  });
  check('C3 建场: 实体创建(ramp+sphere)+阶段=已建场', built.n >= 2 && built.types.includes('ramp') && built.types.includes('sphere') && /已建场/.test(built.stage),
    `n=${built.n} types=${JSON.stringify(built.types)} stage=${built.stage}`);
  const rampP = built.ramp ? built.ramp.params : {};
  const ballP = built.ball ? built.ball.physics : {};
  // 斜坡不存 angleDeg（computed=atan2(h,L)），按 length/height 反算验证题给 30°
  const rampAngle = rampP.length ? Math.atan2(rampP.height, rampP.length) * 180 / Math.PI : null;
  check('C3b 解析参数落进实体(斜坡角度≈30°/球质量=1/球摩擦=0)',
    rampAngle != null && Math.abs(rampAngle - 30) < 0.5 && Math.abs(ballP.mass - 1) < 1e-6 && ballP.friction === 0,
    `angle=${rampAngle && rampAngle.toFixed(1)} mass=${ballP.mass} friction=${ballP.friction}`);
  await page.screenshot({ path: 'shots/w2/03-built.png' });

  // ===== C4. 运行真实物理 + 运行解释（实测 vs 理论）=====
  // 建场后 UI 自动切到检查器标签（产品行为）；真实用户回到 Agent 标签点「运行并生成解释」
  await page.click('#tabAgent');
  await page.waitForTimeout(300);
  await page.click('#btnRunExplain');
  const explain = await page.evaluate(async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const btn = document.querySelector('#btnRunExplain');
      const stage = (document.querySelector('#taskStage') || {}).textContent || '';
      if (stage === '已解释' && btn && !btn.disabled) {
        const block = document.querySelector('#explainBlock') || document.querySelector('#parseResult');
        return {
          stage,
          text: block ? block.textContent : (document.querySelector('#agentWrap') || {}).textContent || '',
          agentState: window.MECH.agentState ? window.MECH.agentState() : null,
          explainState: window.MECH.explainState ? window.MECH.explainState() : null,
        };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { stage: 'timeout', text: '', agentState: null, explainState: null };
  });
  check('C4 运行解释: 阶段=已解释', explain.stage === '已解释', `stage=${explain.stage}`);
  const ex = explain.explainState;
  check('C4b 解释: 确定性计算+理论值与实测值接近(<5%)',
    !!ex && ex.supported === true && ex.theoretical && ex.measured
    && Math.abs(ex.theoretical.value - ex.measured.value) / Math.abs(ex.theoretical.value) < 0.05,
    ex ? `kind=${ex.kind} th=${ex.theoretical && ex.theoretical.value} obs=${ex.measured && ex.measured.value} err%=${ex.errorPct}` : 'explainState=null');
  await page.screenshot({ path: 'shots/w2/04-explained.png' });
  console.log('  [解释块] ' + explain.text.replace(/\s+/g, ' ').slice(0, 300));

  // ===== C5. 用户修正解析 → 场景差异（混合链路最小验证：改质量→重建）=====
  // 在解析评审表单里改质量值（若表单存在）再建场，验证用户修正通道
  // （p1 已覆盖修正记录 meta.corrections；此处只验证真实模型解析后表单可编辑）
  const editables = await page.evaluate(() => {
    const insp = document.querySelector('#parseResult') || document.querySelector('#agentWrap');
    return insp ? insp.querySelectorAll('input[type=number], input[type=text]').length : 0;
  });
  check('C5 解析评审表单可编辑(input>0)', editables > 0, `inputs=${editables}`);

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
