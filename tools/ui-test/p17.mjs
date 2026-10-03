// p17.mjs — Round 20 验收：弹簧胡克力箭头分列（第九章「弹力」）+ 约束关系可视化（joint 连线/大纲徽标）
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

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

  // ==== A. 弹簧场景（fixture 九步建场）→ 胡克力箭头 ====
  await page.click('#tabAgent');
  const plan = await page.evaluate(() => window.MECH.loadFixture('spring'));
  check('弹簧 fixture 载入', plan && plan.kind === 'spring');
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(400);
  const scene = await page.evaluate(() => {
    const d = window.MECH.doc();
    const sp = d.entities.find((e) => e.type === 'spring');
    return { total: d.entities.length, types: d.entities.map((e) => e.type),
      springK: sp ? sp.params.stiffness : null, springRest: sp ? sp.params.restLength : null };
  });
  check('弹簧建场(墙+球+弹簧)', scene.total === 3 && scene.types.includes('spring'),
    JSON.stringify(scene.types));
  check('弹簧参数(k=20 rest=0.8)', scene.springK === 20 && scene.springRest === 0.8,
    `k=${scene.springK} rest=${scene.springRest}`);

  await page.click('#btnForces');
  await page.click('#btnPlay');
  await page.waitForTimeout(1500);        // 起振后（拉伸/压缩振荡中）
  const sf = await page.evaluate(() => window.MECH.springForceState());
  check('弹力箭头随受力开(springsOn)', sf.on === true, JSON.stringify({ on: sf.on, total: sf.total }));
  check('弹簧一条×两端箭=2', sf.total === 2, `total=${sf.total}`);
  check('弹力箭头可见(拉伸中)', sf.visible >= 1, `visible=${sf.visible}`);
  const phys = await page.evaluate(() => {
    const s = window.MECH.springForceState().springs[0];
    const ball = window.MECH.doc().entities.find((e) => e.type === 'sphere');
    // 独立差分通道对照：水平弹簧+失重球，唯一水平合力 = 弹簧力 → m·|a| ≈ |F|
    const acc = window.MECH.accel(ball.id);
    const aMag = acc ? Math.hypot(acc[0], acc[1], acc[2]) : null;
    return { ...s, m: ball.physics.mass, aMag };
  });
  const Fdiff = phys.m * phys.aMag;
  const errPct = Math.abs(Fdiff - Math.abs(phys.F)) / Math.max(Math.abs(phys.F), 1e-9) * 100;
  check('胡克数值: F=k·|Δx|', Math.abs(Math.abs(phys.F) - phys.k * Math.abs(phys.stretch)) < 0.15,
    `k=${phys.k} dx=${phys.stretch} F=${phys.F}`);
  check('弹力 vs 差分合力对照(<8%)', errPct < 8, `|F|=${Math.abs(phys.F).toFixed(3)} m·|a|=${Fdiff.toFixed(3)} err=${errPct.toFixed(2)}%`);
  await page.screenshot({ path: 'shots/170-spring-force-arrows.png' });

  // ==== B. 约束关系可视化：spin 场景 joint 连线 + 大纲徽标 ====
  await page.click('#tabAgent');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.MECH.loadFixture('spin'));
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.click('#btnApplyParse');
  await page.waitForTimeout(400);
  const spinDoc = await page.evaluate(() => {
    const d = window.MECH.doc();
    return { table: d.entities.find((e) => e.name.includes('转台')), slider: d.entities[1] };
  });
  check('spin 建场(转台带 prismatic joint)', spinDoc.table && spinDoc.table.joints
    && spinDoc.table.joints[0].type === 'prismatic');

  // 未选中：无线
  const none0 = await page.evaluate(() => window.MECH.jointVizState());
  // 选中转台：一条虚线
  await page.evaluate((id) => window.MECH.select(id), spinDoc.table.id);
  await page.waitForTimeout(250);
  const one = await page.evaluate(() => window.MECH.jointVizState());
  // 取消选中：无线
  await page.evaluate(() => window.MECH.select(null));
  await page.waitForTimeout(250);
  const none1 = await page.evaluate(() => window.MECH.jointVizState());
  check('joint 连线: 未选中无线', none0.lines === 0, `lines=${none0.lines}`);
  check('joint 连线: 选中转台显示 1 条', one.lines === 1, `lines=${one.lines}`);
  check('joint 连线: 取消选中消失', none1.lines === 0, `lines=${none1.lines}`);
  await page.evaluate((id) => window.MECH.select(id), spinDoc.table.id);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'shots/171-joint-viz.png' });

  // 大纲徽标：转台（有 joint+被滑块 joint 引用）与滑块（被引用）均有 ⌁ 徽标
  const badges = await page.evaluate((ids) => {
    const out = {};
    for (const [key, id] of Object.entries(ids)) {
      const row = document.querySelector(`.ol-row[data-id="${id}"]`);
      out[key] = row ? (row.querySelector('.cons-badge') ? row.querySelector('.cons-badge').textContent : null) : 'NO-ROW';
    }
    return out;
  }, { table: spinDoc.table.id, slider: spinDoc.slider.id });
  check('大纲约束徽标: 转台/滑块均有', badges.table && badges.table.startsWith('⌁')
    && badges.slider && badges.slider.startsWith('⌁'), JSON.stringify(badges));

  // ==== C. 关受力后弹力箭头关闭 ====
  await page.selectOption('#selPreset', 'incline');
  await page.waitForTimeout(300);
  const off = await page.evaluate(() => window.MECH.springForceState());
  check('无弹簧场景弹力箭头正确清零(无残留)', off.springs.length === 0 && off.visible === 0, JSON.stringify(off));

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
