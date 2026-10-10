// walkthrough30.mjs — 30 分钟整体走查（游玩+教学混合，ux-audit 式）驱动器。
// 结构：S0 预检 + 主题回合循环（教师备课 / 学生玩 / 边界折腾，每回合 ~2.5-3min 真实交互+观察），
// 墙钟 ≥30min 后收尾门禁。出证：交互清单（时间戳）、filmstrip、console/network 门禁。
// 用法：MECH_BASE=http://127.0.0.1:8722 node walkthrough30.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const BUDGET_MIN = parseFloat(process.env.WT_MIN || '30');   // 走查墙钟预算（分钟）
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(outDir, { recursive: true });
const manifest = [];
const t0 = Date.now();
const elapsedMin = () => (Date.now() - t0) / 60000;
const ts = () => `[+${((Date.now() - t0) / 1000).toFixed(0)}s]`;
const log = (ok, step, detail = '') => { manifest.push(`${ok ? '[✓]' : '[!]'} ${ts()} ${step}${detail ? ' — ' + detail : ''}`); console.log(manifest[manifest.length - 1]); };
const nap = (page, ms) => page.waitForTimeout(ms);
const shot = (page, name) => page.screenshot({ path: join(outDir, `wt-${name}.png`) }).then(() => log(true, `截图 wt-${name}.png`));
const hotOn = (page, id) => page.evaluate((id) => { const b = document.getElementById(id); if (b && !b.classList.contains('hot')) b.click(); return b ? b.classList.contains('hot') : false; }, id);
const loadPreset = async (page, name, wait = 700) => { await page.evaluate((n) => window.MECH.loadPreset(n), name); await nap(page, wait); };
const roT = (page) => page.evaluate(() => parseFloat(document.getElementById('roT').textContent));

const consoleMsgs = [], netFails = [];
const browser = await chromium.launch({
  headless: false,
  args: ['--window-size=1560,950', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const t = m.text();
    // 允许清单：ANGLE/D3D 着色器编译精度告警——three 内置 chunk 在 D3D 后端的编译噪音（上游 known noise）
    if (/X4122|cannot be represented accurately|WebGLProgram: Program Info Log/.test(t)) return;
    consoleMsgs.push(`${m.type()}: ${t.slice(0, 160)} @${(m.location()?.url || '').split('/').pop()}`);
  });
  page.on('pageerror', (e) => consoleMsgs.push('pageerror: ' + String(e)));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) netFails.push(`HTTP ${r.status()} ${r.url()}`); });

  // ==== S0 预检 ====
  const navT0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 30000 });
  log(true, 'S0 工作台加载就绪', `${((Date.now() - navT0) / 1000).toFixed(1)}s`);
  await shot(page, '00-landing');
  await nap(page, 6000);

  // ==== 主题回合 ====
  let pass = 0, findings = 0;
  while (elapsedMin() < BUDGET_MIN) {
    pass++;
    const theme = pass % 3 === 1 ? '教师备课' : (pass % 3 === 2 ? '学生玩' : '边界折腾');
    const pt = Date.now();
    log(true, `—— 回合 ${pass}（${theme}）开始 ——`);
    try {
      if (theme === '教师备课') {
        const preset = ['incline', 'momentum2d', 'atwood', 'springSHM', 'projectile'][pass % 5];
        await loadPreset(page, preset);
        for (const id of ['btnVectors', 'btnForces', 'btnTrails', 'btnCurves', 'btnCons']) await hotOn(page, id);
        await page.click('#btnPlay');
        await nap(page, 22000);                       // 以教师视角完整观察一段演化
        const t1 = await roT(page);
        await nap(page, 10000);
        const t2 = await roT(page);
        log(t2 > t1, `回合${pass} 演化观察（32s 窗）`, `${preset} t ${t1}→${t2}`);
        if (pass % 2 === 1) {
          // 解析 fixture → 运行解释（教学交付物链路）
          await page.keyboard.press('KeyR');
          await page.click('#tabAgent');
          await page.click('#btnFixtureParse');
          await nap(page, 500);
          await page.evaluate(() => { const b = document.getElementById('btnApplyParse'); if (b && !b.disabled) b.click(); });
          await nap(page, 600);
          // 注意：不要在 apply 后 loadPreset——预置载入会 resetAgentPanel 清掉 agentPlan，
          // 解释按钮会空转（toast 提示在 Agent 页签可见）。解释就跑在建好的场景上。
          await page.evaluate(() => { const b = document.getElementById('btnRunExplain'); if (b) b.click(); });
          await nap(page, 9000);
          const explain = await page.evaluate(() => (document.getElementById('explainBody') || {}).textContent?.length || 0);
          log(explain > 80, `回合${pass} 运行解释生成`, `len=${explain}`);
          await page.click('#tabInspector');
        }
        await shot(page, `pass${pass}-teach`);
        await page.keyboard.press('KeyR');
      } else if (theme === '学生玩') {
        const preset = ['ballChain', 'collLab', 'newtonCradle', 'momentum'][pass % 4];
        await loadPreset(page, preset);
        await page.click('#btnBpt');                  // 子弹时间开（R6-F3：B 键移除改 UI）
        await page.click('#btnPlay');
        await nap(page, 1500);
        // targeted 抓抛（真鼠标，两连抛）
        for (let g = 0; g < 2; g++) {
          const tgt = await page.evaluate(() => {
            for (const e of window.MECH.doc().entities) {
              const t = window.MECH.telemetry(e.id);
              if (t && e.physics?.body === 'dynamic' && t.pos[1] > 0.05) {
                const [sx, sy] = window.MECH.__vp.screenPosOf(t.pos[0], t.pos[1], t.pos[2]);
                return { sx, sy };
              }
            }
            return null;
          });
          if (tgt) {
            await page.mouse.move(tgt.sx, tgt.sy);
            await page.mouse.down();
            const grabbed = await page.evaluate(() => window.MECH.grabState() != null);
            for (const [dx, dy] of [[-60, -40], [-140, -100], [-230, -180]]) await page.mouse.move(tgt.sx + dx, tgt.sy + dy, { steps: 3 });
            await page.mouse.up();
            log(true, `回合${pass} 抓抛#${g + 1}`, `grabbed=${grabbed}`);
            await nap(page, 2500);                    // 看碰撞反馈（粒子/环/音/震）
          } else {
            log(false, `回合${pass} 抓抛#${g + 1} 无目标`, '');
            await nap(page, 800);
          }
        }
        const juice = await page.evaluate(() => window.MECH.__juice.state());
        const sound = await page.evaluate(() => window.MECH.soundState());
        log(juice.spawnedTotal > 0 || sound.emitted > 0, `回合${pass} 反馈在发生`, `particles=${juice.spawnedTotal} rings=${juice.rings} sound=${sound.emitted}/${sound.dropped}`);
        await page.keyboard.press('Shift+Space');     // 慢放看一会
        await nap(page, 5000);
        await page.keyboard.press('Shift+Space');
        await page.keyboard.press('.');               // 单步两帧
        await page.keyboard.press('.');
        await nap(page, 3500);                        // 观察窗
        await shot(page, `pass${pass}-play`);
        await page.click('#btnBpt');
        await page.keyboard.press('KeyR');
      } else {
        // 边界折腾：相机/视图/视口/新建搭建/往返
        await loadPreset(page, 'pendulum');
        await page.mouse.move(700, 450);
        for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -140); await nap(page, 90); }
        await nap(page, 600);
        await page.mouse.wheel(0, 560);
        await nap(page, 600);
        for (const id of ['btnViewTop', 'btnViewFront', 'btnViewSide', 'btnViewReset']) { await page.click(`#${id}`); await nap(page, 320); }
        await page.click('#btnOrtho'); await nap(page, 350); await page.click('#btnOrtho');
        log(true, `回合${pass} 相机/视图循环`);
        if (pass % 2 === 0) {
          // 搭建回合：新建 → 加件 → 微调 → 逐级 undo/redo →（blur 后）Ctrl+S
          await page.click('#btnNew');
          await nap(page, 350);
          for (const nm of ['斜坡', '球']) {
            await page.evaluate((nm) => { [...document.querySelectorAll('.comp-item .nm')].find((x) => x.textContent.includes(nm))?.closest('.comp-item').click(); }, nm);
            await nap(page, 320);
          }
          const nAdd = await page.evaluate(() => window.MECH.doc().entities.length);
          await page.keyboard.press('ArrowRight');
          await nap(page, 200);
          await page.keyboard.press('Control+z');     // 撤微调
          await nap(page, 200);
          const undoTitle = await page.evaluate(() => document.getElementById('btnUndo').title);
          await page.keyboard.press('Control+z');     // 撤加球
          await nap(page, 200);
          const nUndo = await page.evaluate(() => window.MECH.doc().entities.length);
          await page.keyboard.press('Control+Shift+z');
          await nap(page, 200);
          const nRedo = await page.evaluate(() => window.MECH.doc().entities.length);
          log(nAdd === 2 && nUndo === 1 && nRedo === 2, `回合${pass} 搭建+undo/redo`, `add=${nAdd} undo→${nUndo}(栈顶:${undoTitle.replace('撤销: ', '')}) redo→${nRedo}`);
          await page.evaluate(() => document.getElementById('sceneName').blur());
          await page.fill('#sceneName', `走查场景 ${pass}`);
          await page.evaluate(() => document.getElementById('sceneName').blur());
          const dl = page.waitForEvent('download', { timeout: 6000 }).catch(() => null);
          await page.keyboard.press('Control+s');
          const download = await dl;
          log(!!download, `回合${pass} Ctrl+S 保存`, download ? download.suggestedFilename() : 'no-download');
        }
        if (pass % 3 === 0) {
          // 1280 三面板挤压 + classic 往返
          await page.setViewportSize({ width: 1280, height: 800 });
          await hotOn(page, 'btnCons'); await hotOn(page, 'btnCurves');
          await page.evaluate(() => window.MECH.perfHud(true));
          await nap(page, 600);
          const ov = await page.evaluate(() => {
            const r = (id) => { const e = document.getElementById(id); if (!e) return null; const cs = getComputedStyle(e); if (cs.display === 'none') return null; const b = e.getBoundingClientRect(); return b.width > 0 ? b : null; };
            const hit = (a, b) => a && b && !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
            return { cc: hit(r('consbar'), r('curvePanel')), ch: hit(r('consbar'), r('perfHud')), cu: hit(r('curvePanel'), r('perfHud')) };
          });
          log(!ov.cc && !ov.ch && !ov.cu, `回合${pass} 1280 三面板无重叠`, JSON.stringify(ov));
          await page.setViewportSize({ width: 1440, height: 900 });
        }
        if (pass % 4 === 0) {
          await page.click('#linkClassic');
          await page.waitForURL(/classic\.html/);
          await page.waitForFunction(() => { const c = document.querySelector('#console'); return c && c.classList.contains('on'); }, null, { timeout: 15000 });
          // R6-F3：KeyG 无绑定(死键),移除
          await nap(page, 6000);
          await page.keyboard.press('KeyF');
          await nap(page, 4000);
          await shot(page, `pass${pass}-classic`);
          const cl = await page.evaluate(() => ({ t: document.getElementById('roT').textContent, x: document.getElementById('roX').textContent }));
          await page.keyboard.press('KeyR');
          await nap(page, 400);
          await page.keyboard.press('Escape');
          await page.waitForURL((u) => !/classic\.html/.test(u.pathname), { timeout: 8000 });
          await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 30000 });
          log(true, `回合${pass} classic 往返`, JSON.stringify(cl));
        }
      }
    } catch (e) {
      findings++;
      log(false, `回合${pass} 异常`, String(e).slice(0, 160));
      // 回到已知态继续
      try { await page.setViewportSize({ width: 1440, height: 900 }); } catch { /* ignore */ }
      try { await page.goto(BASE, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 30000 }); } catch { /* ignore */ }
    }
    log(true, `—— 回合 ${pass} 结束（${((Date.now() - pt) / 1000).toFixed(0)}s）——`);
  }

  // ==== 长跑稳态（收尾前）：threeBody 4x 60s ====
  await loadPreset(page, 'threeBody');
  await hotOn(page, 'btnTrails'); await hotOn(page, 'btnCons'); await hotOn(page, 'btnCurves');
  await page.keyboard.press('='); await page.keyboard.press('=');
  await page.click('#btnPlay');
  log(true, '收尾长跑：threeBody 4x+满叠加 60s');
  for (let k = 0; k < 6; k++) {
    await nap(page, 10000);
    const st = await page.evaluate(() => {
      const s = window.MECH.perf(600);
      return { t: document.getElementById('roT').textContent, p95: s ? s.frame.p95.toFixed(2) : '-', spike: s ? s.spike8 : -1, fps: document.querySelector('#perfHud .ph-hd b')?.textContent || '-' };
    });
    log(true, `长跑窗 ${k + 1}/6`, JSON.stringify(st));
  }
  await shot(page, 'final-longrun');
  await page.keyboard.press('KeyR');
  await page.keyboard.press('=');

  // ==== 持久化抽查 ====
  await page.evaluate(() => window.MECH.setMuted(true));
  await page.evaluate(() => window.MECH.setShake(false));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 30000 });
  const persisted = await page.evaluate(() => ({ muted: window.MECH.soundState().muted, shake: window.MECH.__juice.state().shakeOn }));
  log(persisted.muted === true && persisted.shake === false, '持久化抽查：静音/震屏刷新保持', JSON.stringify(persisted));

  // ==== 门禁 ====
  log(consoleMsgs.length === 0, '门禁 console 错误/警告（vendor 着色器噪音已允许）', consoleMsgs.length ? consoleMsgs.slice(0, 6).join(' | ') : '0 条');
  log(netFails.length === 0, '门禁 网络 ≥400', netFails.length ? netFails.slice(0, 5).join(' | ') : '0 条');
  writeFileSync(join(outDir, 'walkthrough-manifest.txt'), manifest.join('\n') + '\n');
  console.log(`\n== 走查完成：${manifest.length} 条清单 · ${pass} 回合 · console ${consoleMsgs.length} · 网络 ${netFails.length} · 总耗时 ${((Date.now() - t0) / 60000).toFixed(1)}min ==`);
} finally {
  await browser.close();
}
