// z-agentquality.mjs — Agent 建场质量与速度画像（真实模型 deepseek-flash，7 题图 + 3 文字题）
// 每题：真实解析 API → loadParse → 一键建场 → 自动自查（渲染/物理/理论全链）
// 度量：解析耗时 / 建场+自查墙钟 / 实体数 / 自查 error 数 / 是否触发模型修订
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
const IMGS = ['incline', 'momentum', 'spring', 'hinge', 'celestial', 'atwood', 'spin'];
const TEXTS = [
  '光滑水平面上，质量2kg的球A以3m/s撞上静止的1kg球B，弹性正碰，求碰后两球速度',
  '竖直上抛：小球以初速度20m/s从地面竖直向上抛出，求最大高度（g=10m/s²）',
  '轻绳跨过定滑轮，m1=3kg、m2=2kg，求两物加速度与绳的张力（g=10m/s²，绳不可伸长、不计滑轮质量）',
];

const parseCall = async (endpoint, body) => {
  const t0 = Date.now();
  const res = await fetch(BASE + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  return { out, ms: Date.now() - t0 };
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

const report = [];
const runOne = async (label, endpoint, body) => {
  const rec = { label };
  const { out, ms } = await parseCall(endpoint, body);
  rec.parseMs = ms;
  rec.parseOk = out.ok;
  if (!out.ok) { rec.error = out.error; report.push(rec); console.log(`${label}: 解析失败 ${out.error}`); return; }
  rec.questionType = out.parse.questionType;
  rec.nEntities = (out.parse.entities || []).length;
  rec.nAttaches = (out.parse.attaches || []).length;
  rec.confidence = out.parse.confidence;
  // 浏览器内：清场 → 载计划 → 建场+自查
  const t1 = Date.now();
  const applied = await page.evaluate(async (p) => {
    const M = window.MECH;
    M.loadParse(p);
    document.getElementById('btnApplyParse').click();
    // 等 verify 收敛（findings 出来且 busy 结束）
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      const busy = M.agentBusy();
      const st = M.agentVerifyState();
      if (!busy && st && st.findings) {
        return {
          n: M.doc().entities.length,
          errors: st.summary.error, warns: st.summary.warn,
          rp: st.findings.filter((f) => String(f.cat).startsWith('渲染·')).map((f) => `${f.cat}:${f.sev}`),
          badCats: [...new Set(st.findings.filter((f) => f.sev === 'error').map((f) => f.cat))],
        };
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    return { timeout: true, n: M.doc().entities.length };
  }, out.parse);
  rec.applyVerifyMs = Date.now() - t1;
  Object.assign(rec, applied);
  report.push(rec);
  console.log(`${label}: parse ${ms / 1000}s | apply+verify ${rec.applyVerifyMs / 1000}s | 实体 ${rec.n ?? '-'} | error ${rec.errors ?? '-'} | ${rec.badCats ? rec.badCats.join(',') : ''}${rec.timeout ? 'TIMEOUT' : ''}`);
};

for (const name of IMGS) {
  const b64 = readFileSync(new URL(`../fixtures/question-${name}.png`, import.meta.url)).toString('base64');
  await page.click('#btnNew'); await page.waitForTimeout(120);
  await runOne(`img:${name}`, '/api/parse-question', { image: `data:image/png;base64,${b64}` });
}
for (let i = 0; i < TEXTS.length; i++) {
  await page.click('#btnNew'); await page.waitForTimeout(120);
  await runOne(`text:${i + 1}`, '/api/parse-text', { text: TEXTS[i] });
}

await browser.close();
const okParse = report.filter((r) => r.parseOk).length;
const zeroErr = report.filter((r) => r.errors === 0).length;
console.log(`\n汇总: 解析 ${okParse}/${report.length} · 自查零error ${zeroErr}/${report.length} · 平均解析 ${(report.reduce((a, r) => a + (r.parseMs || 0), 0) / report.length / 1000).toFixed(1)}s · 平均建场+自查 ${(report.reduce((a, r) => a + (r.applyVerifyMs || 0), 0) / report.length / 1000).toFixed(1)}s`);
writeFileSyncSafe();
function writeFileSyncSafe(reps) {
  try { require('node:fs').writeFileSync('agentquality-report.json', JSON.stringify(reps, null, 1)); } catch { /* opt */ }
}
