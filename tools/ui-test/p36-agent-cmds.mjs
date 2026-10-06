// p36-agent-cmds.mjs — Agent 本地快速指令（AG-L1，零 API 费通道）+ plan.removals 删除链路（AG-R1）。
// 验收：①叠加层 显示/隐藏/裸名翻转 ②运行控制与倍速 ③帮助浮层 ④删除走 undo 栈 ⑤聚焦选中
// ⑥复合句回落模型通道（stub fetch，不出网）→ removals 预览勾选 → 建场删除+新建 ⑦Ctrl+Enter 提交。
// 用法：MECH_BASE=http://127.0.0.1:8722 node p36-agent-cmds.mjs
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);

  // 出网保险丝：除页面自身资源外，任何 /api/* 请求直接失败（本套件必须零 API 依赖）
  await page.route('**/api/**', (r) => r.abort());

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.evaluate(() => window.MECH.loadPreset('incline'));
  await page.waitForFunction(() => {
    const vp = window.MECH.__vp;
    return vp._poseAnim == null && vp._focusAnim == null && vp._zoomTarget == null;
  }, null, { timeout: 8000, polling: 200 });

  const nEntities = () => page.evaluate(() => window.MECH.doc().entities.length);
  // 打开 Agent tab 并在文字框下指令（走真实 UI 通路：按钮点击）
  const cmd = async (text, viaEnter = false) => {
    await page.evaluate(() => document.getElementById('tabAgent').click());
    await page.fill('#agentTextReq', text);
    if (viaEnter) {
      await page.focus('#agentTextReq');
      await page.keyboard.press('Control+Enter');
    } else {
      await page.click('#btnParseText');
    }
    await page.waitForTimeout(250);
  };

  // ==== A. 叠加层：显示/隐藏/裸名翻转 ====
  await cmd('显示受力');
  let hot = await page.evaluate(() => document.getElementById('btnForces').classList.contains('hot'));
  const statusLocal = await page.evaluate(() => document.getElementById('parseStatus').textContent);
  check('A1 显示受力 → 按钮热态 + 本地指令回执', hot && statusLocal.includes('本地指令'), statusLocal);
  await cmd('隐藏受力');
  hot = await page.evaluate(() => document.getElementById('btnForces').classList.contains('hot'));
  check('A2 隐藏受力 → 热态解除', !hot);
  await cmd('矢量');
  hot = await page.evaluate(() => document.getElementById('btnVectors').classList.contains('hot'));
  check('A3 裸名「矢量」= 翻转开启', hot);
  await cmd('隐藏矢量');
  hot = await page.evaluate(() => document.getElementById('btnVectors').classList.contains('hot'));
  check('A4 隐藏矢量', !hot);
  await cmd('曲线');
  hot = await page.evaluate(() => document.getElementById('btnCurves').classList.contains('hot'));
  check('A5 曲线开启（分解依赖受力联动属按钮内逻辑，此处验通用翻转）', hot);
  await cmd('隐藏曲线');
  // 「运行并生成解释」不得被本地通道截胡（含 解释 → 回落模型；API 被 route abort → 报错路径，但本地未执行）
  await cmd('运行并生成解释');
  const notLocal = await page.evaluate(() => !document.getElementById('parseStatus').textContent.includes('本地指令'));
  check('A6 「运行并生成解释」不落本地通道', notLocal);

  // ==== B. 运行控制与倍速 ====
  await cmd('运行');
  let chip = await page.evaluate(() => document.getElementById('modeChip').textContent);
  check('B1 运行 → 运行态', chip.includes('运行'), chip);
  await cmd('重置');
  chip = await page.evaluate(() => document.getElementById('modeChip').textContent);
  check('B2 重置 → 编辑态', chip.includes('编辑'), chip);
  await cmd('慢放');
  let spd = await page.evaluate(() => document.getElementById('selSpeed').value);
  check('B3 慢放 → 0.1x', spd === '0.1', spd);
  await cmd('原速');
  spd = await page.evaluate(() => document.getElementById('selSpeed').value);
  check('B4 原速 → 1x', spd === '1', spd);
  await cmd('2倍速');
  spd = await page.evaluate(() => document.getElementById('selSpeed').value);
  check('B5 「2倍速」→ 2', spd === '2', spd);
  await cmd('原速');

  // ==== C. 帮助浮层（浮层全屏拦截点击，关闭走文档承诺的 Esc 路径） ====
  await cmd('帮助');
  let helpOn = await page.evaluate(() => document.getElementById('helpOverlay').classList.contains('on'));
  check('C1 帮助 → 浮层开', helpOn);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  helpOn = await page.evaluate(() => document.getElementById('helpOverlay').classList.contains('on'));
  check('C2 Esc 关闭浮层', !helpOn);

  // ==== D. 删除走 undo 栈 + 聚焦 ====
  const n0 = await nEntities();
  await cmd('删除斜面');
  const n1 = await nEntities();
  check('D1 删除斜面 → 3→2', n0 === 3 && n1 === 2, `${n0}→${n1}`);
  await page.click('#tabInspector');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const n2 = await nEntities();
  check('D2 Ctrl+Z 撤销恢复', n2 === 3, `${n1}→${n2}`);
  await cmd('聚焦小球');
  const selNm = await page.evaluate(() => {
    const el = document.querySelector('#outline .ol-row.sel .nm');
    return el ? el.textContent.trim() : '';
  });
  check('D3 聚焦小球 → 选中行=小球', selNm.startsWith('小球'), selNm);

  // ==== E. Ctrl+Enter 提交本地指令 ====
  await cmd('显示守恒', true);
  hot = await page.evaluate(() => document.getElementById('btnCons').classList.contains('hot'));
  check('E1 Ctrl+Enter 触发本地指令（显示守恒）', hot);

  // ==== F. 复合句回落模型通道 + removals 建场（stub fetch，零出网） ====
  await page.evaluate(() => {
    window.__realFetch = window.fetch;
    window.fetch = async (url) => {
      if (String(url).includes('/api/parse-text')) {
        return { json: async () => ({ ok: true, parse: {
          questionType: '混合搭建', kind: '', goal: '删除小球并放一个方块', gravity: 9.81,
          removals: ['小球'],
          entities: [{ type: 'box', name: '方块', given: { mass: 2 }, confidence: 0.9 }],
          observations: [], anchorPoints: [], keyPoints: [], environment: '', unknowns: [], uncertain: [],
          joint: null, assumptions: [], confidence: 0.9 } }) };
      }
      return window.__realFetch(url);
    };
  });
  await cmd('把小球删掉，再放一个质量2kg的方块');
  // 预览清单应出现「删除已有「小球」」勾选行（removals 链路核心证据）
  const previewTxt = await page.evaluate(() => document.getElementById('changePreviewList').textContent);
  check('F1 复合句走模型通道且预览含删除项', previewTxt.includes('删除') && previewTxt.includes('小球'), previewTxt.slice(0, 60));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => {
    const es = window.MECH.doc().entities;
    return { n: es.length, sphere: es.some((e) => e.type === 'sphere'), box: es.some((e) => e.type === 'box') };
  });
  check('F2 建场：小球已删、方块已建', !after.sphere && after.box, JSON.stringify(after));
  // 整批撤销（endHistoryBatch 记账）：AG-V 上线后 box 建进斜坡会触发自查自动修复=第二个历史
  // 条目（修复层），一次 Ctrl+Z 只回滚修复——逐次撤销直到球回来，验「整场可回退」本质。
  let undone = { sphere: false, box: true };
  for (let i = 0; i < 4 && !undone.sphere; i++) {
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(350);
    undone = await page.evaluate(() => {
      const es = window.MECH.doc().entities;
      return { sphere: es.some((e) => e.type === 'sphere'), box: es.some((e) => e.type === 'box') };
    });
  }
  check('F3 Ctrl+Z 撤销整场（球回、方块消）', undone.sphere && !undone.box, JSON.stringify(undone));

  // ==== G. 全程无 console 错误（net::ERR_FAILED=本套件 /api 保险丝的预期中止噪音，不计） ====
  const realErrors = consoleErrors.filter((e) => !e.includes('net::ERR_FAILED'));
  check('G1 无 console 错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

const fails = results.filter((r) => !r.ok);
console.log(`\n== 汇总 ==\nPASS ${results.length - fails.length}/${results.length}`);
process.exit(fails.length ? 1 : 0);
