// p29.mjs — Round 32 验收：Goal 十五审计弱项补齐
// （前/侧视图切换、时间倍率慢速播放、正交相机下功能可用、保存 JSON 下载+打开恢复）
// 纪律：单浏览器 / 单 context / 单标签；总时长上限约 3 分钟。
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
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
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 45000 });

  // ==== A. 三视图切换（Goal 六「顶视图/侧视图/正视图」——此前仅 top 有断言） ====
  await page.evaluate(() => window.MECH.loadPreset('incline'));
  await page.waitForTimeout(350);
  await page.evaluate(() => window.MECH.__vp.resetView());
  await page.waitForTimeout(250);
  const camDir = () => page.evaluate(() => {
    const vp = window.MECH.__vp;
    const d = vp.camera.position.clone().sub(vp.controls.target).normalize();
    return { x: Math.abs(d.x), y: Math.abs(d.y), z: Math.abs(d.z) };
  });
  await page.click('#btnViewFront');
  await page.waitForTimeout(300);
  let d = await camDir();
  check('前视图: 视线 z 主导', d.z > 0.9 && d.z > d.x && d.z > d.y, `dir=(${d.x.toFixed(2)},${d.y.toFixed(2)},${d.z.toFixed(2)})`);
  await page.screenshot({ path: 'shots/290-view-front.png' });
  await page.click('#btnViewSide');
  await page.waitForTimeout(300);
  d = await camDir();
  check('侧视图: 视线 x 主导', d.x > 0.9 && d.x > d.y && d.x > d.z, `dir=(${d.x.toFixed(2)},${d.y.toFixed(2)},${d.z.toFixed(2)})`);
  await page.screenshot({ path: 'shots/291-view-side.png' });
  await page.click('#btnViewTop');
  await page.waitForTimeout(300);
  d = await camDir();
  check('顶视图: 视线 y 主导', d.y > 0.9 && d.y > d.x && d.y > d.z, `dir=(${d.x.toFixed(2)},${d.y.toFixed(2)},${d.z.toFixed(2)})`);
  await page.click('#btnViewReset');
  await page.waitForTimeout(250);

  // ==== B. 时间倍率/慢速播放（Goal 六「慢速播放；时间倍率」） ====
  await page.click('#btnPlay');
  await page.waitForTimeout(1200);
  await page.click('#btnPause');
  const t1 = await page.evaluate(() => window.MECH.state().simT);
  await page.click('#btnReset');
  await page.selectOption('#selSpeed', '0.1');
  await page.click('#btnPlay');
  await page.waitForTimeout(1200);
  await page.click('#btnPause');
  const t2 = await page.evaluate(() => window.MECH.state().simT);
  check('1x 基准推进>0.5s', t1 > 0.5, `t1=${t1.toFixed(3)}s`);
  check('0.1x 慢速推进显著变慢(<1x/4)', t2 > 0.02 && t2 < t1 / 4, `t2=${t2.toFixed(3)}s (t1/4=${(t1 / 4).toFixed(3)})`);
  await page.selectOption('#selSpeed', '1');
  await page.click('#btnReset');
  await page.screenshot({ path: 'shots/292-slowmo.png' });

  // ==== C. 正交相机下功能可用（此前仅切换断言） ====
  await page.click('#btnOrtho');
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const ball = window.MECH.doc().entities.find((e) => e.type === 'sphere');
    window.MECH.select(ball.id);
  });
  await page.waitForTimeout(200);
  const orthoSel = await page.evaluate(() => window.MECH.selectionState().ids.length === 1);
  check('正交下选中实体', orthoSel === true);
  await page.click('#btnPlay');
  await page.waitForTimeout(1100);
  await page.click('#btnPause');
  const orthoRun = await page.evaluate(() => {
    const ball = window.MECH.doc().entities.find((e) => e.type === 'sphere');
    return { simT: window.MECH.state().simT, pos: window.MECH.telemetry(ball.id).pos[0] };
  });
  check('正交下物理演化正常(simT 推进+球位移)', orthoRun.simT > 0.4 && Math.abs(orthoRun.pos) > 0.05,
    `simT=${orthoRun.simT.toFixed(2)} x=${orthoRun.pos.toFixed(3)}`);
  await page.screenshot({ path: 'shots/293-ortho-run.png' });
  await page.click('#btnOrtho');
  await page.waitForTimeout(200);
  check('切回透视无异常', await page.evaluate(() => window.MECH.state().mode === 'run'));

  // ==== D. 保存 JSON 下载 + 打开恢复（Goal 十五「对象可保存和恢复」的显式链路） ====
  await page.click('#btnReset');
  await page.waitForTimeout(300);
  const fname = await page.evaluate(() => window.MECH.doc().entities.filter((e) => e.type === 'sphere').length);
  await page.click('#btnSave');   // 保存=入库（场景库语义）
  await page.waitForTimeout(300);
  await page.click('#btnOpen');          // 开库
  await page.waitForTimeout(250);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.click('#libExportCurrent'),     // 下载走库内「导出当前」
  ]);
  await page.keyboard.press('Escape');   // 关库
  await page.waitForTimeout(250);
  const dlPath = await download.path();
  const saved = JSON.parse(readFileSync(dlPath, 'utf8'));
  check('存档含完整实体与版本', saved.version != null && saved.entities.length === 3
    && saved.entities.some((e) => e.type === 'sphere'), `entities=${saved.entities.length} v=${saved.version}`);
  // 清空场景后用打开链路恢复存档
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.waitForTimeout(250);
  const emptied = await page.evaluate(() => window.MECH.state().count);
  await page.click('#btnOpen');          // 开库 → 导入文件
  await page.waitForTimeout(250);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 8000 }),
    page.click('#libImport'),
  ]);
  await chooser.setFiles(dlPath);
  await page.waitForTimeout(400);
  const restored = await page.evaluate(() => window.MECH.state().count);
  check('打开存档恢复场景(空→3 实体)', emptied === 0 && restored === 3, `before=${emptied} after=${restored}`);
  await page.screenshot({ path: 'shots/294-open-restore.png' });

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
