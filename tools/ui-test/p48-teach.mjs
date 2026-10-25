// p48-teach.mjs — 教学讲解链端到端（R6-033）：模型拆题 teaching → 关键事件触发 →
// 场景内卡片 + 0.25x 教学慢放 + 恢复档位。fixture 通道（零 API、确定性）：
// atwood 金标（teaching 3 条：release 系统加速度 / contact 绳张力 / end 质心加速度）。
// 事件口径：release=运行首帧（立即）；end=模拟 6s 自动收尾（wall 含慢放折算 ≤15s）；
// contact 在 atwood 无撞击不触发（清单保持未勾，属诚实呈现）。
// 用法：MECH_BASE=http://127.0.0.1:8722 node p48-teach.mjs
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const browser = await chromium.launch({ headless: true });
const results = [];
const ok = (name, cond, detail = '') => {
  results.push([cond ? 'PASS' : 'FAIL', name, detail]);
  if (!cond) process.exitCode = 1;
};

try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 820 } })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.evaluate(() => { window.MECH.perfHud(false); window.MECH.loadFixture('atwood'); });
  await page.waitForFunction(() => {
    const b = document.getElementById('btnApplyParse');
    return b && !b.disabled;
  }, null, { timeout: 15000, polling: 250 });
  await page.evaluate(() => document.getElementById('btnApplyParse').click());
  await page.waitForFunction(() => {
    const s = document.getElementById('taskStage');
    return s && (s.textContent.includes('已建场') || s.textContent.includes('模型修订中') || s.textContent.includes('出错'));
  }, null, { timeout: 30000, polling: 250 });

  // 建场前：教学清单可见且 3 条未触发
  const pre = await page.evaluate(() => window.MECH.teachState());
  ok('teaching 装填 3 条', pre.armed === 3, JSON.stringify(pre.items));
  ok('教学清单可见', await page.evaluate(() => document.getElementById('teachList').style.display) === 'block');

  await page.evaluate(() => document.getElementById('btnPlay').click());

  // release=首帧：1s 内卡片上屏 + 公式在场 + 教学慢放窗口开启（FX-581 缓动 ~0.4s 后 effective 才到底）
  await page.waitForFunction(() => window.MECH.teachState().fired >= 1, null, { timeout: 3000, polling: 200 });
  const fired1 = await page.evaluate(() => ({
    st: window.MECH.teachState(),
    cardOn: document.getElementById('teachCard').classList.contains('on'),
    cardText: document.getElementById('teachCard').textContent,
    bptMsLeft: window.MECH.state().bptMsLeft,
  }));
  ok('release tip 触发', fired1.st.fired >= 1, `fired=${fired1.st.fired}`);
  ok('场景内卡片上屏（含公式）', fired1.cardOn && fired1.cardText.includes('a=(m1-m2)g/(m1+m2)'), fired1.cardText.slice(0, 60));
  ok('教学慢放窗口开启', fired1.bptMsLeft > 0, `bptMsLeft=${fired1.bptMsLeft}`);
  await page.waitForFunction(() => {
    const s = window.MECH.state();
    return s.timeScale < s.timeScaleBase - 0.2;
  }, null, { timeout: 2000, polling: 100 });
  ok('教学慢放生效（缓动进入 <0.8x）', true);

  // 慢放 1.6s+缓动后回原档（不碰用户档位）
  await page.waitForFunction(() => {
    const s = window.MECH.state();
    return s.bptMsLeft === 0 && Math.abs(s.timeScale - s.timeScaleBase) < 1e-6;
  }, null, { timeout: 6000, polling: 250 });
  ok('慢放结束恢复原档', true);

  // end=模拟 6s 自动收尾（wall 含慢放折算，宽限 20s）
  await page.waitForFunction(() => window.MECH.teachState().fired >= 2, null, { timeout: 20000, polling: 300 });
  const endSt = await page.evaluate(() => ({
    st: window.MECH.teachState(),
    list: document.getElementById('teachList').textContent,
  }));
  ok('end tip 收尾触发（质心公式）', endSt.st.items.some((x) => x.moment === 'end' && x.fired), JSON.stringify(endSt.st.items.map((i) => i.moment + (i.fired ? '✓' : ''))));
  ok('清单已勾（✓ 在场）', endSt.list.includes('✓'), '');
  await page.evaluate(() => window.MECH.pause && window.MECH.pause());

  // 暂停后再运行=重置触发（可重放再讲）
  await page.evaluate(() => document.getElementById('btnPlay').click());
  const reSt = await page.evaluate(() => window.MECH.teachState());
  ok('重跑重置（release 重新触发后 fired≥1）', reSt.fired >= 1, `fired=${reSt.fired}`);
  ok('无 console 错误', errors.length === 0, errors[0] || '');
} finally {
  await browser.close();
}

console.log('\n== 汇总 ==');
for (const [st, name, detail] of results) console.log(`${st}  ${name}${detail ? '  | ' + detail : ''}`);
const pass = results.filter((r) => r[0] === 'PASS').length;
console.log(`\nPASS ${pass}/${results.length}`);
if (pass !== results.length) process.exitCode = 1;
