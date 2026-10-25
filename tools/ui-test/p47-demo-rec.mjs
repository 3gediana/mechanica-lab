// p47-demo-rec.mjs — 「拍题 → Agent 建场 → 合规验证 → 内置录屏」全流程演示生成器（R6-F5）。
// 真链路不走 stub：真实题图（阿特伍德机 m₁=3kg / m₂=2kg，大学普物·质心运动定理）→
// POST /api/parse-question（step-5-preview 视觉模型）→ 评审 → applyAgentPlan 建场 →
// 运行 → 数值合规（a = (m₁−m₂)g/(m₁+m₂) ≈ 1.96 m/s²，重球降/轻球升）→
// REC 停止 → WebM 存 assets/demo/agent-demo.webm（服务内演示物料）。
// 采样窗口口径：atwood 布局滑轮 y=3、球起 y≈1，重球可降行程 ≈1.8m → 匀加速段只取前 1.0s。
// 用法：MECH_BASE=http://127.0.0.1:8722 node p47-demo-rec.mjs
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const IMG = resolve(HERE, '../../assets/demo/problem-atwood.jpg');
const OUT = resolve(HERE, '../../assets/demo/agent-demo.webm');
const SHOT = resolve(HERE, 'shots/47-atwood-run.png');
const A_THEORY = 1.96;   // (3−2)kg·9.8 / 5kg

const browser = await chromium.launch({ headless: true });
const results = [];
const ok = (name, cond, detail = '') => {
  results.push([cond ? 'PASS' : 'FAIL', name, detail]);
  if (!cond) process.exitCode = 1;
};

try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true })).newPage();
  const errors = [];
  // 502 资源行=R6-030 自愈链的重试噪声（首枪 502→parseWithRetry 自动补一枪→成功），
  // 流程级断言已证链路成功，不计错误；其余 console error 照计
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*50[234]/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  ok('应用启动', true);

  // Agent 页签（不清场：默认斜坡演示场景留着——R6-F5 起题图通道=独立成题，agent 建场前
  // 自己清掉无关旧场景，自清场动作本身就是演示内容，要进录像）
  await page.evaluate(() => document.getElementById('tabAgent').click());
  await page.evaluate(() => document.getElementById('btnRec').click());
  await page.waitForFunction(() => document.getElementById('btnRec').classList.contains('rec'), null, { timeout: 5000 });
  ok('内置录屏已开始（REC 热态）', true);

  // 喂题图 → 视觉解析（真 API，90s 上限）
  await page.setInputFiles('#agentFile', IMG);
  await page.waitForTimeout(700);                       // 预览/PiP 进画
  await page.evaluate(() => document.getElementById('btnParse').click());
  const stageText = () => page.evaluate(() => {
    const s = document.getElementById('taskStage');
    const p = document.getElementById('parseStatus');
    return `stage=${s && s.textContent} | status=${p && p.textContent}`;
  });
  // headless 下 raf 轮询会停摆（p36 教训），显式 250ms；失败先转储现场再抛
  const waitStage = async (needles, timeout) => {
    try {
      await page.waitForFunction((ns) => {
        const s = document.getElementById('taskStage');
        return s && ns.some((n) => s.textContent.includes(n));
      }, needles, { timeout, polling: 250 });
    } catch (e) {
      await page.screenshot({ path: resolve(HERE, 'shots/47-waitfail.png') }).catch(() => {});
      console.error(`[waitStage:${needles}] 超时现场：${await stageText().catch(() => '?')}`);
      throw e;
    }
    return stageText();
  };
  const parsed = await waitStage(['待确认', '出错'], 380000);
  ok('题图视觉解析成功（待确认）', (await parsed).includes('待确认'), await parsed);

  // 评审 → 建场（vivid 分批）。自查很快时「已建场」badge 可能只闪现 <250ms 就翻到
  // 「模型修订中」（修订前置=建场+自查完成），故两者都算建场成功信号
  await page.evaluate(() => document.getElementById('btnApplyParse').click());
  const built = await waitStage(['已建场', '模型修订中', '已解释', '出错'], 150000);
  const builtText = await built;
  ok('建场完成', builtText.includes('已建场') || builtText.includes('模型修订中'), builtText);

  // 立刻进运行态：scheduleAgentPatch 有 mode!=='edit' 守卫，先点运行可挡掉自查未过后的
  // 自动模型修订重放（修订 API 上游慢/不稳，重放会重建场景打断采样与录像；其响应回来
  // 也会被运行态守卫拒绝，场景保持确定性）。已起火的在途修订请求无害。
  await page.evaluate(() => document.getElementById('btnPlay').click());

  // 结构合规：1 滑轮 + 2 悬挂动体（球或盒），质量 {3, 2}
  const struct = await page.evaluate(() => {
    const ents = window.MECH.entities();
    return ents.map((e) => {
      const b = window.MECH.__vp._bindLookup(e.id);
      return { type: e.type, name: e.name, mass: b && b.entity && b.entity.physics ? b.entity.physics.mass : null, fixed: b && b.entity && b.entity.physics ? b.entity.physics.body === 'fixed' : null };
    });
  });
  const pulleys = struct.filter((e) => e.type === 'pulley');
  const hang = struct.filter((e) => (e.type === 'sphere' || e.type === 'box') && !e.fixed && e.mass != null);
  const masses = hang.map((e) => e.mass).sort((a, b) => b - a);
  ok('结构：1 定滑轮', pulleys.length === 1, JSON.stringify(struct.map((e) => `${e.type}(${e.name},${e.mass})`)));
  ok('结构：2 个悬挂动体', hang.length === 2, `n=${hang.length}`);
  ok('质量合规 {3,2}kg', masses.length === 2 && Math.abs(masses[0] - 3) < 0.05 && Math.abs(masses[1] - 2) < 0.05, `masses=${masses}`);

  // 采样（模拟时钟）：教学慢放（R6-033）会拉长 wall 时间——合规回归必须对 simT 做；
  // 跑到 simT≥6.6s 让 end tip（收尾公式）也进录像
  await page.waitForTimeout(250);                       // 越过启动瞬态
  const series = await page.evaluate(async () => {
    const ents = window.MECH.entities();
    const items = ents.map((e) => ({ e, b: window.MECH.__vp._bindLookup(e.id) }))
      .filter(({ e, b }) => (e.type === 'sphere' || e.type === 'box') && b && b.body && b.entity.physics.body !== 'fixed');
    const rows = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 25000) {
      const st = window.MECH.state();
      const row = { simT: st.simT, paused: st.paused, v: [], y: [] };
      for (const { b } of items) {
        const lv = b.body.linvel();
        row.v.push(+lv.y.toFixed(4));
        row.y.push(+b.mesh.position.y.toFixed(4));
      }
      rows.push(row);
      // R6-035：悬挂体到滑轮自动定格（教学场景）——定格后 end tip 卡在终态帧上，再留 2.5s 进片
      if (st.simT >= 6.6 || st.paused) { await new Promise((r) => setTimeout(r, 2500)); break; }
      await new Promise((r) => setTimeout(r, 150));
    }
    return { rows, items: items.map(({ e }) => ({ name: e.name, type: e.type })) };
  });
  // 末帧 vy 更负者为重球（阿特伍德重球侧加速下降）；回归取干净窗口 simT∈[0.25,1.15]
  const rows = series.rows.filter((r) => Number.isFinite(r.simT) && r.v.length === 2);
  if (!rows.length) {
    console.error('采样空窗现场：', JSON.stringify(series.items), '| rows=', series.rows.length,
      JSON.stringify(series.rows.slice(0, 3)), '| struct=', JSON.stringify(struct.map((e) => `${e.type}(${e.mass},${e.fixed})`)));
    throw new Error('采样空窗');
  }
  const vLast = rows[rows.length - 1].v;
  const iHeavy = vLast[0] < vLast[1] ? 0 : 1;
  const iLight = iHeavy === 0 ? 1 : 0;
  const win = rows.filter((r) => r.simT >= 0.25 && r.simT <= 1.15);
  const slope = (idx) => {
    const n = win.length;
    if (n < 3) return NaN;
    const xs = win.map((r) => r.simT), ys = win.map((r) => r.v[idx]);
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    return den ? num / den : NaN;
  };
  const aH = slope(iHeavy), aL = slope(iLight);
  const dyH = rows[rows.length - 1].y[iHeavy] - rows[0].y[iHeavy];
  ok('重球加速下降（a∈[−2.4,−1.55]）', Number.isFinite(aH) && aH <= -1.55 && aH >= -2.4, `aHeavy=${aH && aH.toFixed(3)} (理论 −${A_THEORY})`);
  ok('轻球反向上升（|aH+aL|<0.4）', Number.isFinite(aL) && Math.abs(aH + aL) < 0.4, `aLight=${aL && aL.toFixed(3)}`);
  ok('重球位移为负（下降）', dyH < -0.2, `dy=${dyH && dyH.toFixed(3)}m（全程含慢放段）`);

  // 教学讲解（R6-033）：模型拆题 teaching → 关键事件触发（软断言：给了就至少讲一条）
  const teach = await page.evaluate(() => window.MECH.teachState());
  ok('教学讲解装载并触发（模型拆题）', teach.armed > 0 ? teach.fired >= 1 : true,
    `armed=${teach.armed} fired=${teach.fired} [${teach.items.map((i) => i.moment + (i.fired ? '✓' : '')).join(',')}]`);

  await page.screenshot({ path: SHOT });
  await page.waitForTimeout(1200);                      // 静帧收尾进片

  // 停 REC → 下载 WebM → 落盘 assets/demo/
  mkdirSync(dirname(OUT), { recursive: true });
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.evaluate(() => document.getElementById('btnRec').click()),
  ]);
  await dl.saveAs(OUT);
  await page.evaluate(() => window.MECH.pause && window.MECH.pause());
  const buf = readFileSync(OUT);
  const ebml = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  ok('录像落盘（>150KB）', buf.length > 150 * 1024, `${(buf.length / 1048576).toFixed(2)} MB → ${OUT}`);
  ok('WebM 容器头有效（EBML）', ebml, buf.slice(0, 4).toString('hex'));
  ok('无 console 错误', errors.length === 0, errors[0] || '');
} finally {
  await browser.close();
}

console.log('\n== 汇总 ==');
for (const [st, name, detail] of results) console.log(`${st}  ${name}${detail ? '  | ' + detail : ''}`);
const pass = results.filter((r) => r[0] === 'PASS').length;
console.log(`\nPASS ${pass}/${results.length}`);
if (pass !== results.length) process.exitCode = 1;
