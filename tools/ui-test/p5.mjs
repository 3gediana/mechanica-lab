// p5.mjs — P1 输入扩展验收：拍照（fake 摄像头采帧）→ 区域框选 → 动量题 fixture 解析 → 建场 → 碰撞 → momentum 解释
// 纪律：单浏览器 / 单 context / 单标签；fake media flags 提供合成视频流，无需真实摄像头。
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
const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.click('#tabAgent');

  // ---- 拍照：getUserMedia fake 流 → 捕获帧
  await page.click('#btnCamera');
  await page.waitForSelector('#camWrap', { state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => { const v = document.getElementById('camVideo'); return v && v.videoWidth > 0; }, null, { timeout: 10000 });
  check('相机开启(fake 流有帧)', true, `videoWidth=${await page.evaluate(() => document.getElementById('camVideo').videoWidth)}`);
  await page.click('#btnCapture');
  await page.waitForSelector('#imgPrevWrap', { state: 'visible' });
  const imgState = await page.evaluate(() => window.MECH.agentImageState());
  check('采帧→预览', imgState.hasImage && !imgState.hasCrop && imgState.src.w > 0, JSON.stringify(imgState.src));

  // ---- 框选题目区域（进入框选模式后在预览图上拖 20%-80%）
  await page.click('#btnCropMode');
  await page.waitForTimeout(150);
  const imgBox = await page.locator('#imgPrev').boundingBox();
  const x0 = imgBox.x + imgBox.width * 0.20, y0 = imgBox.y + imgBox.height * 0.20;
  const x1 = imgBox.x + imgBox.width * 0.80, y1 = imgBox.y + imgBox.height * 0.80;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const cropState = await page.evaluate(() => window.MECH.agentImageState());
  check('框选选区记录(归一化)', cropState.hasCrop
    && Math.abs(cropState.crop.w - 0.6) < 0.05 && Math.abs(cropState.crop.h - 0.6) < 0.06,
    JSON.stringify(cropState.crop));
  check('选区高亮可见', await page.isVisible('#cropRect') && await page.isVisible('#cropHint'));
  await page.screenshot({ path: 'shots/50-camera-crop.png' });

  // ---- 清除选区再重框（交互闭环）＋ 动量题 fixture 解析
  await page.click('#btnCropClear');
  const cleared = await page.evaluate(() => window.MECH.agentImageState().hasCrop);
  check('清除选区', cleared === false);

  const plan = await page.evaluate(() => window.MECH.loadFixture('momentum'));
  check('动量题 fixture 载入', plan && plan.questionType.includes('对撞') && plan.entities.length === 2,
    JSON.stringify(plan && plan.entities.map((e) => ({ t: e.type, v: e.given.velocity || null }))));

  // ---- 建场（无斜面两球 → 自动补光滑地面，共 3 实体）
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(300);
  const doc = await page.evaluate(() => window.MECH.doc());
  check('对撞建场: 两球+光滑地面', doc.entities.length === 3
    && doc.entities.filter((e) => e.type === 'sphere').length === 2
    && doc.entities.some((e) => e.type === 'ground' && e.physics.friction === 0),
    JSON.stringify(doc.entities.map((e) => e.type)));
  const ballA = doc.entities.find((e) => e.name.includes('球 A'));
  check('初速度来自解析(v=1.5,0,0)', JSON.stringify(ballA.physics.linvel) === '[1.5,0,0]',
    JSON.stringify(ballA.physics.linvel));

  // ---- 运行碰撞 → momentum 解释
  await page.click('#tabAgent');           // 建场后面板自动切回检查器
  await page.waitForTimeout(150);
  await page.click('#btnRunExplain');
  await page.waitForFunction(() => {
    const g = document.getElementById('explainGrp');
    return g && g.style.display !== 'none' && document.getElementById('explainBody').textContent.length > 60;
  }, null, { timeout: 25000 });
  const ex = await page.evaluate(() => window.MECH.explainState());
  check('momentum 解释器: 结构化输出', ex && ex.supported && ex.kind === 'momentum-1d', ex ? `kind=${ex.kind}` : 'null');
  check('momentum: 动量守恒误差<2%', ex.momentum.errPct < 2, `p ${ex.momentum.before.toFixed(3)}→${ex.momentum.after.toFixed(3)} err=${ex.momentum.errPct.toFixed(2)}%`);
  check('momentum: 球速度理论vs实测<8%', ex.pairs.every((p) => p.errPct < 8),
    JSON.stringify(ex.pairs.map((p) => ({ v: +p.vMeasured.toFixed(3), th: +p.vTheory.toFixed(3), e: +p.errPct.toFixed(1) }))));
  check('momentum: 判定通过', ex.pass === true);
  await page.screenshot({ path: 'shots/51-momentum-explain.png' });

  // ---- 理论核对（fixture 数值手算）：m1=2 v1=1.5, m2=1 v2=0, e=0.8
  // v1' = (3 + 0.8·1·(0−1.5))/3 = 0.6；v2' = (3 + 0.8·2·1.5)/3 = 1.8
  const th = ex.pairs.map((p) => p.vTheory);
  check('momentum: 理论值=手算(0.6, 1.8)', Math.abs(th[0] - 0.6) < 0.01 && Math.abs(th[1] - 1.8) < 0.01,
    JSON.stringify(th.map((v) => +v.toFixed(3))));

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
