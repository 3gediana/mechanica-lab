// AG-V3 真实模型全链 E2E（首次真调）：真实 parse-text → 计划预览 → vivid 建场 → 真实自查 → 解释 → 导出
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = 'tools/ui-test/_audit/shots';
const manifest = [];
const consoleAll = [];
const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
const log = (ok, act, sel, note = '') => manifest.push(`[${ok ? '✓' : '✗'}] ${ts()} ${act}${sel ? ' (' + sel + ')' : ''}${note ? ' — ' + note : ''}`);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && !m.text().includes('GL Driver'))) consoleAll.push({ type: m.type(), text: m.text() }); });
page.on('pageerror', (e) => consoleAll.push({ type: 'pageerror', text: e.message }));
page.on('response', (r) => { if (r.status() >= 400) consoleAll.push({ type: 'HTTP ' + r.status(), text: r.url() }); });
await page.goto(BASE8722(), { waitUntil: 'domcontentloaded' });
function BASE8722() { return 'http://127.0.0.1:8722'; }
await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

await page.evaluate(() => document.getElementById('btnNew').click());
await page.click('#tabAgent');
await page.fill('#agentTextReq', '一个质量1kg的小球从长度2米、倾角30度的固定斜面顶端由静止下滑，斜面光滑，求小球滑到斜面底端时的速度');
log(true, '输入真实题目', '#agentTextReq');
await page.click('#btnParseText');
log(true, '触发真实模型解析', '#btnParseText');
await page.waitForFunction(() => {
  const b = document.getElementById('btnApplyParse');
  return b && !b.disabled && document.getElementById('changePreview').style.display !== 'none';
}, null, { timeout: 120000, polling: 500 });
const stTxt = await page.evaluate(() => document.getElementById('parseStatus')?.textContent);
log(true, '真实解析返回+预览就绪', '', stTxt);
await page.screenshot({ path: `${OUT}/t5-01-parsed.png` });
const planInfo = await page.evaluate(() => ({
  badge: document.getElementById('parseSrcBadge')?.textContent,
  meta: document.getElementById('parseMeta')?.textContent.slice(0, 120),
}));
log(true, '计划元信息', '', JSON.stringify(planInfo));
await page.click('#btnApplyParse');
log(true, '确认建场', '#btnApplyParse');
await page.waitForFunction(() => window.MECH.agentVerifyState() != null && !window.MECH.agentBusy(), null, { timeout: 90000, polling: 500 });
const verify = await page.evaluate(() => window.MECH.agentVerifyState());
log(true, '真实自查完成', '', JSON.stringify(verify.summary));
await page.screenshot({ path: `${OUT}/t5-02-built.png` });
const patch = await page.evaluate(() => window.MECH.agentPatchState ? window.MECH.agentPatchState() : null);
log(true, '修订状态（干净场景应 0 轮）', '', JSON.stringify(patch));
await page.click('#btnRunExplain');
await page.waitForFunction(() => { const b = document.getElementById('btnRunExplain'); return b && !b.disabled; }, null, { timeout: 90000 });
const ex = await page.evaluate(() => ({ len: document.getElementById('explainBody')?.textContent.length, badge: document.getElementById('explainBadge')?.textContent }));
log(ex.len > 100, '解释生成', '', JSON.stringify(ex));
const dl = page.waitForEvent('download', { timeout: 15000 });
await page.click('#btnExportCSV');
const d = await dl;
const csv = fs.readFileSync(await d.path(), 'utf-8');
log(true, '导出真实场景数据', '', `${d.suggestedFilename()} ${csv.trim().split('\n').length} 行`);

console.log('==== INTERACTION MANIFEST (thread5 真实模型) ====');
for (const m of manifest) console.log(m);
console.log('==== CONSOLE ERR/WARN(非GL) ====');
for (const c of consoleAll) console.log(`[${c.type}] ${c.text.slice(0, 160)}`);
if (!consoleAll.length) console.log('(none)');
await browser.close();
