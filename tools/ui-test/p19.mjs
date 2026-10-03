// p19.mjs — Round 22 验收：混合搭建文字要求输入通道（文字→真实模型解析→评审→混合建场→运行→解释）
// 纪律：单浏览器 / 单 context / 单标签；总时长上限约 4 分钟（真实 LLM 调用）。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8721';
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

  // ==== A. 空输入错误分支 ====
  await page.click('#tabAgent');
  await page.click('#btnParseText');
  await page.waitForTimeout(200);
  const emptyMsg = await page.evaluate(() => document.getElementById('parseStatus').textContent);
  check('空输入提示', emptyMsg.includes('请先输入'), emptyMsg);

  // ==== B. 手动场景（已有斜面）→ 文字要求补充小球 → 真实解析 → 评审 → 混合建场 ====
  await page.evaluate(() => {
    window.MECH.loadPreset('empty');
    window.MECH.addComponent('ramp', { name: '我的斜面',
      params: { length: 1.6, height: 0.8, width: 0.5 }, physics: { body: 'fixed' } });
  });
  await page.waitForTimeout(250);
  const TEXT_REQ = '在现有斜面上放一个质量 2 kg 的小球，斜面与球均光滑（摩擦不计），小球从斜面顶端由静止释放，观察它滑到底端的过程。斜面倾角约 26.6 度（高 0.8 米、坡长 1.789 米）。';
  await page.fill('#agentTextReq', TEXT_REQ);
  await page.click('#btnParseText');
  await page.waitForFunction(() => {
    const st = document.getElementById('parseStatus').textContent;
    return st.includes('解析完成') || st.includes('解析失败');
  }, null, { timeout: 120000 });
  const st1 = await page.evaluate(() => ({
    status: document.getElementById('parseStatus').textContent,
    badge: document.getElementById('parseSrcBadge').textContent,
    hasPlan: !!window.MECH.agentState && !!document.getElementById('parseEntities').children.length,
  }));
  check('文字解析完成（真实模型）', st1.status.includes('解析完成'), st1.status.slice(0, 80));
  check('来源徽标标注文字通道', st1.badge.includes('文字'), st1.badge);

  const planInfo = await page.evaluate(() => {
    const ents = [...document.querySelectorAll('#parseEntities .prow, #parseEntities > div')]
      .map((r) => r.textContent).slice(0, 6);
    const pv = [...document.querySelectorAll('#changePreviewList label span')].map((r) => r.textContent);
    return { ents, preview: pv, previewVis: document.getElementById('changePreview').style.display !== 'none' };
  });
  check('变更预览可见（混合复用斜面）', planInfo.previewVis
    && planInfo.preview.some((l) => l.includes('更新已有 ramp')), JSON.stringify(planInfo.preview));

  // 确认建场（默认全勾）
  await page.click('#btnApplyParse');
  await page.waitForTimeout(400);
  const scene = await page.evaluate(() => {
    const d = window.MECH.doc();
    return {
      total: d.entities.length,
      types: d.entities.map((e) => e.type),
      rampName: (d.entities.find((e) => e.type === 'ramp') || {}).name,
      ballMass: (d.entities.find((e) => e.type === 'sphere') || { physics: {} }).physics.mass,
    };
  });
  check('混合建场: 斜面复用保留命名', scene.rampName === '我的斜面', scene.rampName);
  check('文字题给球质量落地(m=2)', scene.ballMass === 2, `m=${scene.ballMass}`);
  check('实体构成(ramp+sphere)', scene.total === 2
    && scene.types.includes('ramp') && scene.types.includes('sphere'), JSON.stringify(scene.types));
  await page.screenshot({ path: 'shots/190-text-mixed-build.png' });

  // ==== C. 运行 + 斜面解释链路 ====
  await page.click('#btnPlay');
  await page.waitForTimeout(2600);
  await page.click('#btnPause');
  await page.click('#tabAgent');
  await page.click('#btnRunExplain');
  await page.waitForFunction(() => {
    const b = document.getElementById('explainBody');
    return b && b.textContent.length > 80;
  }, null, { timeout: 25000 });
  const ex = await page.evaluate(() => window.MECH.explainState());
  check('文字通道建场解释链路(斜面分支)', ex && ex.supported, ex ? `kind=${ex.kind}` : 'null');
  check('解释数值合理(err<15%)', ex && (ex.errPct == null || ex.errPct < 15),
    ex && JSON.stringify({ err: ex.errPct, pass: ex.pass }));
  await page.screenshot({ path: 'shots/191-text-explain.png' });

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
