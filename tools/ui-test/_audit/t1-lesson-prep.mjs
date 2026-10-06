// ux-audit 线程1：备课主链——解析(fixture)→逐项检查→vivid 建场→自查→运行解释→导出数据
// 交互带截图+console 全程读取（manifest 纪律）。发现异常就地取证。
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8722';
const OUT = 'tools/ui-test/_audit/shots';
fs.mkdirSync(OUT, { recursive: true });
const manifest = [];
const consoleAll = [];
let step = 0;
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
const log = (ok, act, sel, note = '') => { manifest.push(`[${ok ? '✓' : '✗'}] ${ts()} ${act}${sel ? ' (' + sel + ')' : ''}${note ? ' — ' + note : ''}`); };
const consoleRead = async (page, tag) => { log(true, `console read @${tag}`, '', consoleAll.filter((c) => c.type === 'error' || c.type === 'warning').length + ' err/warn 累计'); };

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleAll.push({ t: Date.now(), type: m.type(), text: m.text() }); });
page.on('pageerror', (e) => consoleAll.push({ t: Date.now(), type: 'pageerror', text: e.message }));
page.on('response', (r) => { if (r.status() >= 400) consoleAll.push({ t: Date.now(), type: 'HTTP ' + r.status(), text: r.url() }); });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
log(true, '首屏加载完成', '', 'MECH.ready');
await page.screenshot({ path: `${OUT}/t1-00-first.png` });

// 1) 首用视角：默认场景是什么？Agent 页签长得清楚吗？
await page.click('#tabAgent');
await page.waitForTimeout(400);
log(true, '切到 Agent 页签', '#tabAgent');
await page.screenshot({ path: `${OUT}/t1-01-agent-tab.png` });
const firstUse = await page.evaluate(() => ({
  status: document.getElementById('parseStatus')?.textContent,
  stage: document.getElementById('taskStage')?.textContent,
  btnText: document.getElementById('btnApplyParse')?.textContent,
  btnDisabled: document.getElementById('btnApplyParse')?.disabled,
  fixtureVisible: !!document.getElementById('fixtureSel'),
}));
log(true, '首用视角读 Agent 面板', '', JSON.stringify(firstUse));

// 2) 老师用示例数据走通流程（fixture 通道）
await page.selectOption('#fixtureSel', 'incline');
await page.click('#btnFixtureParse');
await page.waitForTimeout(600);
log(true, '载入示例解析（斜面题）', '#btnFixtureParse');
await page.screenshot({ path: `${OUT}/t1-02-parsed.png` });
const preview = await page.evaluate(() => ({
  changes: [...document.querySelectorAll('#changePreviewList input[type=checkbox]')].length,
  entities: [...document.querySelectorAll('#parseEntities .pe-row')].length,
  status: document.getElementById('parseStatus')?.textContent,
}));
log(true, '计划预览可读', '', JSON.stringify(preview));

// 3) 勾选变更逐条看一遍（真实用户会核对题给数值）
const changeTexts = await page.evaluate(() => [...document.querySelectorAll('#changePreviewList li')].map((li) => li.textContent));
log(true, '变更清单条目', '', JSON.stringify(changeTexts));

// 4) 建场（vivid）+ 自查
await page.click('#btnApplyParse');
await page.waitForFunction(() => window.MECH.agentVerifyState() != null && !window.MECH.agentBusy(), null, { timeout: 60000, polling: 300 });
log(true, '建场+自查完成', '#btnApplyParse');
await page.screenshot({ path: `${OUT}/t1-03-built.png` });
const verify = await page.evaluate(() => window.MECH.agentVerifyState());
log(true, '自查报告', '', JSON.stringify(verify.summary));

// 5) 运行解释
await page.click('#btnRunExplain');
await page.waitForFunction(() => { const b = document.getElementById('btnRunExplain'); return b && !b.disabled; }, null, { timeout: 60000 });
log(true, '运行解释完成', '#btnRunExplain');
await page.screenshot({ path: `${OUT}/t1-04-explained.png` });
const explain = await page.evaluate(() => ({
  bodyLen: document.getElementById('explainBody')?.textContent.length,
  copyDisabled: document.getElementById('btnCopyExplain')?.disabled,
  badge: document.getElementById('explainBadge')?.textContent,
}));
log(true, '解释面板', '', JSON.stringify(explain));

// 6) 导出数据（下载）
const dl = page.waitForEvent('download', { timeout: 15000 });
await page.click('#btnExportCSV');
const d = await dl;
const dlPath = await d.path();
const csv = fs.readFileSync(dlPath, 'utf-8');
log(true, '导出 CSV', '#btnExportCSV', `${d.suggestedFilename()} ${csv.split('\n').length} 行`);
await consoleRead(page, 'thread1 主链尾');

// 7) CSV 边缘：撤销一次（回滚建场）再导出——数据标签还是斜面吗？内容合法吗？
await page.keyboard.press('Control+z');
await page.waitForTimeout(400);
const afterUndo = await page.evaluate(() => ({ n: window.MECH.doc().entities.length }));
log(true, 'Ctrl+Z 撤销建场', '', '实体数=' + afterUndo.n);
const dl2 = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
await page.click('#btnExportCSV');
const d2 = await dl2;
if (d2) {
  const csv2 = fs.readFileSync(await d2.path(), 'utf-8');
  log(true, '撤销后导出仍成功（数据是历史快照，合理）', '', `${d2.suggestedFilename()} 首行=${csv2.split('\n')[0].slice(0, 40)}`);
} else {
  log(false, '撤销后导出无下载事件', '#btnExportCSV', '需查：按钮是否还在面板里可见/可用');
}
await page.screenshot({ path: `${OUT}/t1-05-after-undo.png` });
await consoleRead(page, '撤销后');

// 8) 重做回来，场景恢复吗？
await page.keyboard.press('Control+z');   // 再撤一层（可能回滚自查修复层或清空）
const redoState = await page.evaluate(() => ({ n: window.MECH.doc().entities.length }));
log(true, '再撤一层', '', '实体数=' + redoState.n);
for (let i = 0; i < 4; i++) { await page.keyboard.press('Control+y'); await page.waitForTimeout(200); }
const afterRedo = await page.evaluate(() => ({ n: window.MECH.doc().entities.length }));
log(afterRedo.n === 2 || afterRedo.n >= 2, 'Ctrl+Y 重做恢复', '', '实体数=' + afterRedo.n);
await page.screenshot({ path: `${OUT}/t1-06-redo.png` });

await consoleRead(page, 'final');
console.log('==== INTERACTION MANIFEST (thread1) ====');
for (const m of manifest) console.log(m);
console.log('==== CONSOLE ERR/WARN ====');
for (const c of consoleAll) console.log(`[${c.type}] ${c.text.slice(0, 160)}`);
if (!consoleAll.length) console.log('(none)');
await browser.close();
