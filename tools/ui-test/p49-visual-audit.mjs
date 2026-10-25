// p49-visual-audit.mjs — 交付前视觉自检闸门（R6-037）。
// 背景教训：三轮用户实锤（球穿轮飞出画框/绳完全不可见/滑轮轮面躺平成圆盘）全发生在
// 「用户看得见」的层——物理/断言层全绿证明不了用户看到的东西对。本闸门把问题类做成
// 确定性探针，覆盖全部预置场景 + Agent atwood 建场链，交付任何视觉物料前必跑：
//   A 出画检测：加载取景后 + 运行 3s 后，所有动态体须留在取景框内（NDC |x|,|y| ≤ 1.35 裕度）
//   B 连接可视化覆盖：onPulley 球对必须有跨绳网格（atwoodRope ≥ 3）；rope/spring 连接件必须有网格
//   C 画面非退化：渲染画布下采样 160×90 灰度 mean/std 非黑非平（mean>4 且 std>6）
// 已知豁免：无（豁免必须显式写进 EXEMPT 并注明原因，不许静默）。
// 用法：MECH_BASE=http://127.0.0.1:8722 node p49-visual-audit.mjs
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const NDC_LIMIT = 1.35;

const browser = await chromium.launch({ headless: true });
const results = [];
const ok = (name, cond, detail = '') => {
  results.push([cond ? 'PASS' : 'FAIL', name, detail]);
  if (!cond) process.exitCode = 1;
};

// 页内探针：动态体 NDC 坐标 + 网格存在性 + 画布灰度统计（一次 evaluate 全取）
const PROBE = `(() => {
  const vp = window.MECH.__vp;
  const r = vp.renderer.domElement.getBoundingClientRect();
  const bodies = [];
  for (const e of window.MECH.entities()) {
    const b = vp._bindLookup(e.id);
    if (!b) continue;
    bodies.push({ name: e.name || e.type, type: e.type, hasMesh: !!b.mesh,
      dyn: !!(b.entity && b.entity.physics && b.entity.physics.body === 'dynamic'),
      ndc: b.mesh ? (() => {
        const [sx, sy] = vp.screenPosOf(b.mesh.position.x, b.mesh.position.y, b.mesh.position.z);
        return [ +(((sx - r.left) / r.width) * 2 - 1).toFixed(3), +(-(((sy - r.top) / r.height) * 2 - 1)).toFixed(3) ];
      })() : null });
  }
  let ropes = 0;
  vp.scene.traverse((o) => { if (o.name === 'atwoodRope') ropes++; });
  // 主渲染器 preserveDrawingBuffer 未开（viewport.js:837）：页外读回前必须现渲一帧，
  // 否则拿到清空后的空缓冲（btnSnapshot 同款套路「取前必须现渲」）
  vp.render();
  // 采样分辨率 320×180：160×90 会把小物件高光与暗背景平均掉（galileoDrop 全分辨率
  // 2.9 万亮像素缩到 160×90 后 <45 的只剩 0——阈值误报实锤）
  const c2 = document.createElement('canvas'); c2.width = 320; c2.height = 180;
  const ctx = c2.getContext('2d');
  ctx.drawImage(vp.renderer.domElement, 0, 0, 320, 180);
  const d = ctx.getImageData(0, 0, 320, 180).data;
  let sum = 0, bright = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    sum += g;
    if (g >= 40) bright++;
  }
  const n = d.length / 4;
  return { bodies, ropes, mean: +(sum / n).toFixed(1), bright, paused: window.MECH.state().paused };
})()`;

try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.evaluate(() => { window.MECH.perfHud(false); });

  const presets = await page.evaluate(() => {
    const sel = document.getElementById('selPreset');
    return sel ? [...sel.options].map((o) => o.value).filter((v) => v && v !== 'empty') : [];
  });
  ok(`预置清单可枚举（${presets.length} 个）`, presets.length >= 20, presets.join(','));

  const checkFrame = (label, probe) => {
    const out = probe.bodies.filter((b) => b.dyn && b.hasMesh && b.ndc)
      .filter((b) => Math.abs(b.ndc[0]) > NDC_LIMIT || Math.abs(b.ndc[1]) > NDC_LIMIT);
    ok(`A 出画｜${label}`, out.length === 0, out.map((b) => `${b.name}@(${b.ndc})`).join(' ') || '全动态体在框内');
    const noMesh = probe.bodies.filter((b) => !b.hasMesh);
    ok(`B 网格｜${label}`, noMesh.length === 0, noMesh.map((b) => b.name).join(',') || '全实体有网格');
    ok(`C 画面｜${label}`, probe.mean > 4 && probe.bright >= 50, `mean=${probe.mean} 亮像素=${probe.bright}(≥40@320×180)`);
    return probe;
  };

  for (const pid of presets) {
    await page.evaluate((p) => window.MECH.loadPreset(p), pid);
    await page.waitForTimeout(1300);   // 预置相机飞行动画收敛
    const p0 = await page.evaluate(PROBE);
    checkFrame(`${pid}·初始`, p0);
    const hasRopePair = p0.bodies.some((b) => b.type === 'sphere') && await page.evaluate(() =>
      window.MECH.entities().some((e) => e.physics && e.physics.onPulley));
    await page.evaluate(() => document.getElementById('btnPlay').click());
    await page.waitForTimeout(3200);
    const p1 = await page.evaluate(PROBE);
    checkFrame(`${pid}·运行3s`, p1);
    if (hasRopePair) ok(`B 跨绳｜${pid}`, p1.ropes >= 3, `atwoodRope=${p1.ropes}`);
    await page.evaluate(() => window.MECH.pause && window.MECH.pause());
  }

  // Agent 建场链（fixture atwood：真实 applyAgentPlan 路径 + 教学装填 → 定格）
  await page.evaluate(() => document.getElementById('btnReset').click());   // 预置轮转停在运行态，建场要求编辑态
  await page.evaluate(() => document.getElementById('tabAgent').click());
  await page.evaluate(() => window.MECH.loadFixture('atwood'));
  await page.waitForFunction(() => {
    const b = document.getElementById('btnApplyParse');
    return b && !b.disabled;
  }, null, { timeout: 15000, polling: 250 });
  await page.evaluate(() => document.getElementById('btnApplyParse').click());
  await page.waitForFunction(() => {
    const s = document.getElementById('taskStage');
    return s && (s.textContent.includes('已建场') || s.textContent.includes('模型修订中') || s.textContent.includes('出错'));
  }, null, { timeout: 30000, polling: 250 });
  await page.waitForTimeout(800);
  const a0 = await page.evaluate(PROBE);
  checkFrame('agent-atwood·建场后', a0);
  ok('B 跨绳｜agent-atwood', a0.ropes >= 3, `atwoodRope=${a0.ropes}`);
  await page.evaluate(() => document.getElementById('btnPlay').click());
  await page.waitForTimeout(4200);   // 1.37s sim 行程到端定格 + 慢放折算
  const a1 = await page.evaluate(PROBE);
  checkFrame('agent-atwood·定格后', a1);

  ok('无 console 错误', errors.length === 0, errors[0] || '');
} finally {
  await browser.close();
}

console.log('\n== 汇总 ==');
for (const [st, name, detail] of results) console.log(`${st}  ${name}${detail ? '  | ' + detail : ''}`);
const pass = results.filter((r) => r[0] === 'PASS').length;
console.log(`\nPASS ${pass}/${results.length}`);
if (pass !== results.length) process.exitCode = 1;
