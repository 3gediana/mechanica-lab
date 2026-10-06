// ux-audit 线程4：键盘路径/帮助浮层/首用视角 + F2/F3 修复复验
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8722';
const OUT = 'tools/ui-test/_audit/shots';
const manifest = [];
const consoleAll = [];
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
const log = (ok, act, sel, note = '') => manifest.push(`[${ok ? '✓' : '✗'}] ${ts()} ${act}${sel ? ' (' + sel + ')' : ''}${note ? ' — ' + note : ''}`);
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && !m.text().includes('GL Driver'))) consoleAll.push({ type: m.type(), text: m.text() }); });
page.on('pageerror', (e) => consoleAll.push({ type: 'pageerror', text: e.message }));
page.on('response', (r) => { if (r.status() >= 400) consoleAll.push({ type: 'HTTP ' + r.status(), text: r.url() }); });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

// F2 复验：搜索「斜面」能找到 斜坡 卡片
await page.fill('#catalogSearch', '斜面');
await page.waitForTimeout(300);
const f2 = await page.evaluate(() => [...document.querySelectorAll('#catalogList .comp-item .nm')].map((n) => n.textContent.trim()));
log(f2.includes('斜坡'), 'F2 复验: 搜索「斜面」命中「斜坡」', '#catalogSearch', JSON.stringify(f2));
await page.fill('#catalogSearch', '小球');
await page.waitForTimeout(300);
log((await page.evaluate(() => [...document.querySelectorAll('#catalogList .comp-item .nm')].some((n) => n.textContent.includes('球')))), 'F2 复验: 搜索「小球」命中球类', '');

// F3 复验：搜索后加件→焦点已出搜索框→Ctrl+Z 生效于场景
await page.evaluate(() => document.getElementById('btnNew').click());
await page.fill('#catalogSearch', '方块');
await page.waitForTimeout(300);
await page.click('#catalogList .comp-item');
await page.waitForTimeout(300);
const focusOut = await page.evaluate(() => document.activeElement?.id);
log(focusOut !== 'catalogSearch', 'F3 复验: 加件后焦点离开搜索框', '', 'activeElement=' + focusOut);
const n1 = await page.evaluate(() => window.MECH.doc().entities.length);
await page.keyboard.press('Control+z');
await page.waitForTimeout(250);
const n2 = await page.evaluate(() => window.MECH.doc().entities.length);
log(n2 === n1 - 1, 'F3 复验: Ctrl+Z 撤销掉刚加的方块', '', `${n1}→${n2}`);

// 帮助浮层：? 键开、Esc 关、内容包含快捷键
await page.keyboard.press('Escape');   // 确保无残留浮层
await page.keyboard.press('?');
await page.waitForTimeout(300);
const helpOn = await page.evaluate(() => document.getElementById('helpOverlay')?.classList.contains('on'));
log(helpOn, '帮助浮层 ? 键打开', '');
await page.screenshot({ path: `${OUT}/t4-01-help.png` });
const helpText = await page.evaluate(() => document.getElementById('helpOverlay')?.textContent || '');
log(helpText.includes('Ctrl') || helpText.includes('Z'), '帮助含快捷键说明', '', 'len=' + helpText.length);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
log(!(await page.evaluate(() => document.getElementById('helpOverlay')?.classList.contains('on'))), 'Esc 关闭帮助浮层', '');

// 键盘主链：空格运行? 检查实际绑定（读帮助文本里的键位）+ 方向键微调
await page.evaluate(() => document.getElementById('btnNew').click());
await page.evaluate(() => { window.MECH.addComponent && window.MECH.addComponent('sphere', {}); });
await page.waitForTimeout(300);
// 点选视口中心实体（真实点击而非 channel）——用 outline 列表点击（键盘用户的替代路径）
const outlineClicked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#outline .o-row, #outline [data-id], #outline *')];
  const row = rows.find((r) => r.textContent.includes('球'));
  if (row) { row.click(); return true; }
  return false;
});
log(outlineClicked, '场景对象列表点选球', '#outline');
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(200);
const moved = await page.evaluate(() => window.MECH.doc().entities.find((e) => e.type === 'sphere')?.transform.pos[1]);
log(moved != null && moved > 0.14, '方向键微调 y 抬升', '', 'y=' + moved);
await page.screenshot({ path: `${OUT}/t4-02-kbd.png` });

// Tab 焦点可达性抽查：真实键盘连按 15 次 Tab，记录焦点轨迹
const trail = [];
for (let i = 0; i < 15; i++) {
  await page.keyboard.press('Tab');
  trail.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || '?'));
}
const landed = trail.filter((t) => t && t !== 'BODY').length;
log(landed >= 10, 'Tab 连按焦点落在控件上', '', `${landed}/15 落控件: ${trail.slice(0, 8).join('→')}`);

console.log('==== INTERACTION MANIFEST (thread4) ====');
for (const m of manifest) console.log(m);
console.log('==== CONSOLE ERR/WARN(非GL) ====');
for (const c of consoleAll) console.log(`[${c.type}] ${c.text.slice(0, 160)}`);
if (!consoleAll.length) console.log('(none)');
await browser.close();
