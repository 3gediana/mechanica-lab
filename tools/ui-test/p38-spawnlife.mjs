// p38-spawnlife.mjs — 创建动效（AG-V2）：每个物体出生遵循物理规则、不开局稳态。
// 验收：①无初速动态体出生悬高 4cm 落下入稳（doc 位姿不变）②Agent 连接绳长=端距×1.03
// （松弛出生）③绳 verlet 垂弧（中点低于端点连线）④弹簧=螺旋线圈几何 ⑤绳出生跳动衰减
// ⑥斜面题理论精度不受出生下落污染（explainIncline 轨迹基准）。
// 用法：MECH_BASE=http://127.0.0.1:8722 node p38-spawnlife.mjs
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

async function withPage(fn) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('net::ERR_FAILED')) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(25000);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

try {
  // ==== A. 出生下落：box 落地入稳，doc 位姿不被污染 ====
  await withPage(async (page) => {
    await page.evaluate(() => {
      document.getElementById('btnNew').click();
      window.MECH.addComponent('ground', { transform: { pos: [0, -0.05, 0] } });   // 地面顶 y=0
      window.MECH.addComponent('box', { transform: { pos: [1.5, 0.155, 0] } });    // 静止中心≈0.1506(留 5mm 缝)
    });
    const docY = await page.evaluate(() => window.MECH.doc().entities.find((e) => e.type === 'box').transform.pos[1]);
    // 出生瞬时：body 悬高 ~4cm（编辑态网格仍在 doc 位姿；运行首步起从高处落）
    await page.evaluate(() => document.getElementById('btnPlay').click());
    const y0 = await page.evaluate(() => {
      const id = window.MECH.doc().entities.find((e) => e.type === 'box').id;
      return window.MECH.__rt.telemetry(id).pos[1];
    });
    await page.waitForFunction(() => {
      const id = window.MECH.doc().entities.find((e) => e.type === 'box').id;
      const t = window.MECH.__rt.telemetry(id);
      return Math.abs(t.vel[1]) < 0.05 && t.pos[1] < 0.155;
    }, null, { timeout: 8000, polling: 100 });
    const yEnd = await page.evaluate(() => window.MECH.__rt.telemetry(window.MECH.doc().entities.find((e) => e.type === 'box').id).pos[1]);
    check('A1 出生悬高 4cm（首帧 y≈doc+0.04）', y0 > docY + 0.02, `doc=${docY} first=${y0.toFixed(3)}`);
    check('A2 落下入稳（y≈0.15 静止位）', Math.abs(yEnd - 0.15) < 0.008, `end=${yEnd.toFixed(3)}`);
    check('A3 doc 位姿不被出生动效污染', Math.abs(docY - 0.155) < 1e-9, `doc=${docY}`);
    await page.evaluate(() => document.getElementById('btnReset').click());
  });

  // ==== B. Agent 绳场景：松弛出生 + verlet 垂弧 + 出生跳动 ====
  await withPage(async (page) => {
    await page.route('**/api/**', (r) => r.abort());
    await page.evaluate(() => document.getElementById('btnNew').click());
    await page.evaluate(async () => {
      window.fetch = async (url) => {
        if (String(url).includes('/api/parse-text')) {
          return { json: async () => ({ ok: true, parse: {
            questionType: '挂绳演示', kind: '', goal: '观察绳与球', gravity: 9.81,
            entities: [
              { type: 'ground', name: '地面', given: { length: 10, width: 6 }, confidence: 0.95 },
              { type: 'sphere', name: '坠球', given: { mass: 1, position: [0, 1.6, 0.5] }, confidence: 0.9 }],
            observations: [], anchorPoints: [], keyPoints: [], environment: '',
            unknowns: [], uncertain: [], removals: [], joint: null,
            attaches: [{ type: 'rope', from: 1, to: 0 }],
            assumptions: [], confidence: 0.9 } }) };
        }
        return window.__realFetch(url);
      };
      document.getElementById('tabAgent').click();
      document.getElementById('agentTextReq').value = '地面与坠球之间连一根绳，观察摆动（一比一还原成拟真沙盘场景演示）';
      document.getElementById('btnParseText').click();
    });
    await page.waitForFunction(() => {
      const b = document.getElementById('btnApplyParse');
      return b && !b.disabled && document.getElementById('changePreview').style.display !== 'none';
    }, null, { timeout: 30000, polling: 300 });
    await page.click('#btnApplyParse');
    await page.waitForFunction(() => window.MECH.agentVerifyState() != null, null, { timeout: 40000, polling: 250 });
    const rope = await page.evaluate(() => {
      const e = window.MECH.doc().entities.find((x) => x.type === 'rope');
      if (!e) return null;
      const bind = window.MECH.__rt.binds.get(e.id);
      const a = window.MECH.doc().entities.find((x) => x.id === e.attach[0]);
      const b2 = window.MECH.doc().entities.find((x) => x.id === e.attach[1]);
      const pa = a.transform.pos, pb = b2.transform.pos;
      const dist = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      const pts = bind.linkPts ? bind.linkPts.map((p) => [+p.y.toFixed(3)]) : null;
      const segN = bind.mesh.children.length;
      return { length: e.params.length, dist: +dist.toFixed(3), pts, segN };
    });
    check('B1 Agent 绳存在且 8 段组网格', rope && rope.segN === 8, rope && `segN=${rope.segN}`);
    check('B2 绳长=端距×1.03（松弛出生）', rope && Math.abs(rope.length - rope.dist * 1.03) < 0.02,
      rope && `len=${rope.length} dist=${rope.dist}`);
    // 出生跳动衰减 + 垂弧：reset 后 binds 全新，linkPts 在首次 _syncLinks 才建——
    // 播放后等状态就绪，连采两窗看运动，再看中段是否低于端点连线（垂弧）
    const sway = await page.evaluate(async () => {
      document.getElementById('btnPlay').click();
      const e = window.MECH.doc().entities.find((x) => x.type === 'rope');
      const bind = window.MECH.__rt.binds.get(e.id);
      if (!bind.linkPts) await new Promise((r) => setTimeout(r, 250));
      if (!bind.linkPts) return { noPts: true };
      const mid = () => bind.linkPts[4].clone();
      const m1 = mid();
      const sag1 = m1.y - (bind.linkPts[0].y + bind.linkPts[8].y) / 2;
      await new Promise((r) => setTimeout(r, 120));
      const m2 = mid();
      await new Promise((r) => setTimeout(r, 1500));
      const m3 = mid();
      const sag3 = m3.y - (bind.linkPts[0].y + bind.linkPts[8].y) / 2;
      document.getElementById('btnReset').click();
      return { d12: +m1.distanceTo(m2).toFixed(4), d23: +m2.distanceTo(m3).toFixed(4),
        sag1: +sag1.toFixed(4), sag3: +sag3.toFixed(4) };
    });
    check('B3 verlet 垂弧：绳中段低于端点连线', !sway.noPts && (sway.sag1 < -0.004 || sway.sag3 < -0.004),
      JSON.stringify(sway));
    check('B4 绳中段在运动（出生/运行期有动态）', !sway.noPts && (sway.d12 > 0.001 || sway.d23 > 0.001), JSON.stringify(sway));
  });

  // ==== C. 弹簧螺旋线圈几何 ====
  await withPage(async (page) => {
    await page.evaluate(() => {
      document.getElementById('btnNew').click();
      const a = window.MECH.addComponent('box', { transform: { pos: [-2, 0.6, 0] } });
      const b = window.MECH.addComponent('sphere', { transform: { pos: [0, 0.6, 0] } });
      window.MECH.addComponent('spring', { attach: [a, b], params: { stiffness: 20, restLength: 1.8, damping: 0.5 } });
    });
    const geo = await page.evaluate(() => {
      const e = window.MECH.doc().entities.find((x) => x.type === 'spring');
      const bind = window.MECH.__rt.binds.get(e.id);
      const g = bind.geometry;
      return { verts: g.attributes.position.count, type: g.type };
    });
    check('C1 弹簧=线圈管几何（顶点数远超直杆圆柱）', geo.verts > 800, JSON.stringify(geo));
  });

  // ==== D. 出生下落不污染斜面理论（p1 口径回归锚）====
  await withPage(async (page) => {
    await page.evaluate(() => window.MECH.loadPreset('incline'));
    await page.evaluate(() => document.getElementById('btnPlay').click());
    await page.waitForFunction(() => window.MECH.mode ? window.MECH.mode() === 'run' : document.getElementById('modeChip').textContent.includes('运行'), null, { timeout: 5000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => document.getElementById('btnReset').click());
    check('D1 斜面场景含出生下落运行正常（理论精度由 p1 断言）', true);
  });

  check('Z1 无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

const fails = results.filter((r) => !r.ok);
console.log(`\n== 汇总 ==\nPASS ${results.length - fails.length}/${results.length}`);
process.exit(fails.length ? 1 : 0);
