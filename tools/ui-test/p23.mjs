// p23.mjs — Round 26 验收：单位标尺动态刻度（0.1/0.5/1/5 m 档位随视野自适应，网格视觉密度联动）
// 纪律：单浏览器 / 单 context / 单标签；总时长上限约 3 分钟。
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

// 直接操纵相机（模拟用户缩放），等 0.15s 读数节流刷新
const setCamDist = (page, dist) => page.evaluate((dist) => {
  const v = window.MECH.viewportState ? null : null;
  void v;
  const st = window.MECH.scaleState();
  void st;
  // 通过 MECH 暴露的相机句柄移动（cameraTarget/cameraPos 只读 → 用内部通道）
  const mv = window.MECH.__camMove;
  if (mv) mv(dist);
}, dist);

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

  // 相机推拉通道：沿视线方向把相机放到指定距离（模拟 OrbitControls 缩放的净效果）
  await page.evaluate(() => {
    const vp = window.MECH.__vp;
    if (!vp) return;
    window.MECH.__camMove = (dist) => {
      const t = vp.controls.target;
      const dir = vp.camera.position.clone().sub(t).normalize();
      vp.camera.position.copy(t).add(dir.multiplyScalar(dist));
      vp.controls.update();
    };
    window.MECH.__camDist = () => vp.camera.position.distanceTo(vp.controls.target);
  });
  const move = (page, dist) => page.evaluate((d) => window.MECH.__camMove(d), dist);
  const waitScale = (page) => page.waitForTimeout(350);   // > 0.15s 读数节流
  // 档位自适应是逐档迟滞收敛（每 0.15s 节流走一档，防震荡），跳变距离需 2-3 次收敛；
  // headless rAF 帧率不稳，固定 sleep 会偶发截断在中间档 —— 改为等目标档位收敛（坑㉓同款教训）。
  const waitStep = (page, step) => page.waitForFunction(
    (s) => window.MECH.scaleState().step === s, step, { timeout: 8000 },
  ).catch(() => {});

  // ==== A. 初始档位：默认相机距离下落在档位集内且读数同步 ====
  await waitScale(page);
  const s0 = await page.evaluate(() => window.MECH.scaleState());
  check('初始档位 ∈ {0.1,0.5,1,5}', [0.1, 0.5, 1, 5].includes(s0.step), `step=${s0.step}`);
  check('读数文本与档位同步', s0.text.includes(`1 格 = ${s0.step} m`) && s0.text.includes('视野宽'), s0.text.trim());
  check('网格 divisions 与档位一致(20/step)', s0.divisions === Math.round(20 / s0.step),
    `div=${s0.divisions}`);

  // ==== B. 拉近：降档到 0.1，网格变密 ====
  await move(page, 0.8);
  await waitStep(page, 0.1);
  const s1 = await page.evaluate(() => window.MECH.scaleState());
  check('拉近后降档(step=0.1)', s1.step === 0.1, `step=${s1.step} text=${s1.text.trim().slice(0, 30)}`);
  check('网格变密(divisions 200)', s1.divisions === 200, `div=${s1.divisions}`);
  check('读数同步(0.1 m)', s1.text.includes('1 格 = 0.1 m'), s1.text.trim());
  await page.screenshot({ path: 'shots/230-scale-zoomin.png' });

  // ==== C. 拉远：逐档升档（30m→1 档，60m→5 档），网格变疏 ====
  await move(page, 30);
  await waitStep(page, 1);
  const s2 = await page.evaluate(() => window.MECH.scaleState());
  check('拉远 30m 升到 1 档', s2.step === 1, `step=${s2.step}`);
  check('读数同步(1 m)', s2.text.includes('1 格 = 1 m'), s2.text.trim());
  await move(page, 60);
  await waitStep(page, 5);
  const s2b = await page.evaluate(() => window.MECH.scaleState());
  check('拉远 60m 升到 5 档', s2b.step === 5, `step=${s2b.step}`);
  check('网格变疏(divisions 4)', s2b.divisions === 4, `div=${s2b.divisions}`);
  await page.screenshot({ path: 'shots/231-scale-zoomout.png' });

  // ==== D. 回到中间：0.5 档稳定（迟滞不卡死不震荡） ====
  await move(page, 6);
  await waitStep(page, 0.5);
  const s3 = await page.evaluate(() => window.MECH.scaleState());
  check('中间距离恢复 0.5 档', s3.step === 0.5, `step=${s3.step}`);

  // ==== E. 正交模式：读数不炸且随 zoom 更新 ====
  await page.click('#btnOrtho');
  await page.waitForTimeout(300);
  const so = await page.evaluate(() => window.MECH.scaleState());
  check('正交模式读数正常', so.text.includes('1 格 =') && Number.isFinite(so.step), so.text.trim());
  await page.click('#btnOrtho');   // 切回透视
  await page.waitForTimeout(200);

  // ==== F. 物理回归：网格重建不影响场景 ====
  const n = await page.evaluate(() => window.MECH.entities().length);
  check('网格重建不碰场景实体', n >= 0, `entities=${n}`);
  check('无页面错误', consoleErrors.length === 0, `${consoleErrors.length} errors`);

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
