// ux-audit 线程2：手工搭场景（目录加实体/改参数/撤销重做/删除）
// ux-audit 线程3：预置+运行态交叉（运行中切预置/删实体/双击竞态）
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8722';
const OUT = 'tools/ui-test/_audit/shots';
const manifest = [];
const consoleAll = [];
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
const log = (ok, act, sel, note = '') => manifest.push(`[${ok ? '✓' : '✗'}] ${ts()} ${act}${sel ? ' (' + sel + ')' : ''}${note ? ' — ' + note : ''}`);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleAll.push({ type: m.type(), text: m.text() }); });
page.on('pageerror', (e) => consoleAll.push({ type: 'pageerror', text: e.message }));
page.on('response', (r) => { if (r.status() >= 400) consoleAll.push({ type: 'HTTP ' + r.status(), text: r.url() }); });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

// ============ 线程 2：手工搭 ============
await page.evaluate(() => document.getElementById('btnNew').click());
log(true, '新建空场景', '#btnNew');
await page.waitForTimeout(300);
const addBtns = await page.evaluate(() => [...document.querySelectorAll('#catalogList .comp-item .nm')].map((b) => b.textContent.trim()));
log(true, '组件目录盘点', '#catalogList', JSON.stringify(addBtns));
await page.screenshot({ path: `${OUT}/t2-00-add-tab.png` });
for (const t of ['球', '方块', '斜面']) {
  await page.fill('#catalogSearch', t);
  await page.waitForTimeout(300);
  const did = await page.evaluate((label) => {
    const item = [...document.querySelectorAll('#catalogList .comp-item')].find((c) => c.querySelector('.nm')?.textContent.trim() === label);
    if (item) { item.click(); return true; }
    return false;
  }, t);
  await page.waitForTimeout(300);
  log(did, `搜索+添加「${t}」`, '#catalogSearch', did ? '' : '没找到卡片');
}
await page.fill('#catalogSearch', '');
await page.waitForTimeout(200);
const built = await page.evaluate(() => window.MECH.doc().entities.map((e) => e.type + ':' + e.name));
log(built.length >= 3, '三实体落场', '', JSON.stringify(built));
await page.screenshot({ path: `${OUT}/t2-01-added.png` });

// 选中+改参数（检查器质量）
await page.evaluate(() => { const s = window.MECH.doc().entities.find((e) => e.type === 'sphere'); window.MECH.select && window.MECH.select(s.id); });
await page.waitForTimeout(300);
const insp = await page.evaluate(() => ({
  inspVisible: !!document.querySelector('#inspGrp, #inspector'),
  inspText: (document.querySelector('#inspGrp, #inspector') || {}).textContent?.slice(0, 80),
}));
log(true, '检查器状态', '', JSON.stringify(insp).slice(0, 140));

// 撤销/重做链：加 3 个实体→连撤 3→连重做 3
const n0 = await page.evaluate(() => window.MECH.doc().entities.length);
for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+z'); await page.waitForTimeout(150); }
const nUndo = await page.evaluate(() => window.MECH.doc().entities.length);
log(nUndo < n0, '连撤 3 层', '', `${n0}→${nUndo}`);
for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+y'); await page.waitForTimeout(150); }
const nRedo = await page.evaluate(() => window.MECH.doc().entities.length);
log(nRedo === n0, '连重做 3 层回到原状', '', `${nUndo}→${nRedo}（期望 ${n0}）`);

// 删除选中 + 级联：删除被 attach 的对象?（简单：删方块）
await page.evaluate(() => { const b = window.MECH.doc().entities.find((e) => e.type === 'box'); window.MECH.select && window.MECH.select(b.id); });
await page.keyboard.press('Delete');
await page.waitForTimeout(250);
const afterDel = await page.evaluate(() => window.MECH.doc().entities.length);
log(afterDel === n0 - 1, 'Delete 删除选中', '', `${n0}→${afterDel}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(250);
log((await page.evaluate(() => window.MECH.doc().entities.length)) === n0, '撤销删除恢复', '');
await consoleReadAll();

// ============ 线程 3：预置+运行态交叉+竞态 ============
await page.selectOption('#selPreset', 'momentum');
await page.waitForTimeout(500);
await page.click('#btnPlay');
await page.waitForTimeout(600);
// 运行中切预置——该给拦截提示还是正常？观察是否崩
await page.selectOption('#selPreset', 'incline');
await page.waitForTimeout(600);
const midSwitch = await page.evaluate(() => ({ mode: document.getElementById('modeChip')?.textContent, n: window.MECH.doc().entities.length }));
log(true, '运行中切预置后的状态', '', JSON.stringify(midSwitch));
await page.screenshot({ path: `${OUT}/t3-01-mid-switch.png` });
await consoleReadAll();

// 竞态：btnReset 连点三下（重置期间再重置）；btnPause 双击
await page.click('#btnPlay');
await page.waitForTimeout(300);
for (let i = 0; i < 3; i++) { await page.click('#btnReset'); await page.waitForTimeout(80); }
await page.waitForTimeout(400);
const dbl = await page.evaluate(() => ({ mode: document.getElementById('modeChip')?.textContent, n: window.MECH.doc().entities.length }));
log(dbl.mode && dbl.mode.includes('编辑'), 'btnReset 三连点收敛编辑态', '', JSON.stringify(dbl));
await page.click('#btnPlay');
await page.waitForTimeout(200);
await page.click('#btnPause');
await page.click('#btnPause');   // 双击暂停=继续
await page.waitForTimeout(300);
const pauseDbl = await page.evaluate(() => ({ chip: document.getElementById('modeChip')?.textContent }));
log(true, 'btnPause 双击（暂停→继续）', '', JSON.stringify(pauseDbl));
await page.click('#btnReset');
await page.waitForTimeout(300);
// 双击建场（fixture 就绪时连点 btnApplyParse）
await page.click('#tabAgent');
await page.waitForTimeout(200);
await page.evaluate(() => window.MECH.loadFixture('spring'));
await page.waitForFunction(() => document.getElementById('btnApplyParse') && document.getElementById('btnApplyParse').offsetParent !== null, null, { timeout: 15000 });
await page.waitForTimeout(300);
await page.dblclick('#btnApplyParse');
await page.waitForTimeout(800);
const dblApply = await page.evaluate(() => ({ n: window.MECH.doc().entities.length, springN: window.MECH.doc().entities.filter((e) => e.type === 'spring').length }));
log(dblApply.springN === 1, 'btnApplyParse 双击（防双建）', '', JSON.stringify(dblApply));
// 运行中删除实体
await page.click('#btnReset');
await page.waitForTimeout(300);
await page.selectOption('#selPreset', 'momentum');
await page.waitForTimeout(400);
await page.click('#btnPlay');
await page.waitForTimeout(500);
await page.evaluate(() => { const s = window.MECH.doc().entities.find((e) => e.type === 'sphere'); window.MECH.opRemoveEntity && window.MECH.opRemoveEntity(s.id); });
await page.waitForTimeout(500);
const delRun = await page.evaluate(() => ({ n: window.MECH.doc().entities.length, mode: document.getElementById('modeChip')?.textContent }));
log(true, '运行中删除实体', '', JSON.stringify(delRun));
await page.screenshot({ path: `${OUT}/t3-02-del-run.png` });
await page.click('#btnReset');
await consoleReadAll();
await page.waitForTimeout(500);

console.log('==== INTERACTION MANIFEST (thread2+3) ====');
for (const m of manifest) console.log(m);
console.log('==== CONSOLE ERR/WARN/HTTP>=400 ====');
const uniq = [...new Map(consoleAll.map((c) => [c.type + '|' + c.text.slice(0, 80), c])).values()];
for (const c of uniq) console.log(`[${c.type}] ${c.text.slice(0, 160)}`);
if (!uniq.length) console.log('(none)');
await browser.close();
function consoleReadAll() { log(true, 'console read', '', uniq_()); function uniq_() { return consoleAll.filter((c) => c.type !== 'warning' || !c.text.includes('GL Driver')).length + ' 条非 GL 噪音'; } }
