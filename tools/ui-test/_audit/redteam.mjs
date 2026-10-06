// 红队轮：20 道真实 curriculum 题（初中3/高中8/大学6/混合3）真打 step-5-preview，
// 每题走完整生产链：parse-text → 计划预览 → vivid 建场 → 自查（含模型修订回喂）。
// 记录每题：解析耗时/题型/实体/自查结论/修订轮次 → redteam-results.json。盲点=失败题。
import { chromium } from 'playwright';
import fs from 'node:fs';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'redteam-results.json');
const BASE = 'http://127.0.0.1:8722';
const CASES = [
  { id: 'C1-freefall', lvl: '初中', q: '质量5kg的铁球和质量1kg的木球从2米高的同一高度同时由静止释放，不考虑空气阻力，请演示它们同时落地' },
  { id: 'C2-friction', lvl: '初中', q: '水平地面上有两个相同的木箱都以2m/s向右滑动，一个地面摩擦系数0.1，另一个0.6，对比它们的滑行距离' },
  { id: 'C3-inertia', lvl: '初中', q: '在光滑无摩擦的水平面上放一个1kg的小球，给它1.5m/s的初速度，演示牛顿第一定律的匀速直线运动' },
  { id: 'H1-vthrow', lvl: '高中', q: '以8m/s的初速度竖直上抛一个质量0.5kg的小球，g取10，演示它上升、到达最高点、落回的全过程' },
  { id: 'H2-inelastic', lvl: '高中', q: '两个1kg的小球在光滑水平面上，左边的以2m/s向右运动撞上右边静止的小球，碰撞是完全非弹性的，恢复系数为0' },
  { id: 'H3-recoil', lvl: '高中', q: '反冲实验：两个1kg的物体原来静止在一起，分开后以1.5m/s的速率向相反方向运动，验证系统动量守恒' },
  { id: 'H4-bullet', lvl: '高中', q: '质量20g的子弹以15m/s的水平速度射中质量1kg的静止木块（恢复系数0），演示嵌入过程与动量守恒' },
  { id: 'H5-plank', lvl: '高中', q: '板块模型：质量2kg的长木板放在光滑水平地面上，质量0.5kg的滑块放在木板上面，滑块以1.5m/s初速相对木板滑动，两者之间摩擦系数0.35，演示滑块减速、木板加速的过程' },
  { id: 'H6-pendulum', lvl: '高中', q: '用1米长的轻杆一端固定悬挂一个1kg的小球，拉开30度后由静止释放，演示机械能守恒（动能与势能转化）' },
  { id: 'H7-kepler', lvl: '高中', q: '中心行星质量100，一颗卫星在半径4米的轨道上以圆轨道速度的0.8倍运行，形成椭圆轨道，观察近日点和远日点的速度变化' },
  { id: 'H8-ramp-ground', lvl: '高中', q: '1kg的小球从高0.8米、倾角30度的粗糙斜面（摩擦0.2）顶端由静止滑下，滑到斜面底端后在水平地面上继续滑行直到停下' },
  { id: 'M1-roll', lvl: '大学', q: '质量1kg半径0.12m的均质圆柱从倾角30度、长2.5米的斜面顶端由静止纯滚下来，演示刚体滚动（摩擦力不做功）' },
  { id: 'M2-race', lvl: '大学', q: '斜面赛跑：倾角30度长2.5米的斜面上，一个1kg的光滑小球滑动，一个1kg的圆柱纯滚动，同时从顶端释放，比较谁先到底' },
  { id: 'M3-coupled', lvl: '大学', q: '光滑水平面上两个1kg的小球，中间用劲度系数15N/m的弹簧连接（弹簧原长等于两球间距），左边小球以1m/s向右运动，演示弹簧耦合振动的能量交换' },
  { id: 'M4-damped', lvl: '大学', q: '弹簧振子：一端固定在墙上，另一端接1.5kg的振子，劲度系数20N/m，阻尼系数0.8，把振子拉开后释放，演示振幅逐渐衰减的阻尼振动' },
  { id: 'M5-launcher', lvl: '大学', q: '弹簧弹射器：水平面上小球被一根压缩状态的弹簧顶住（弹簧原长1.2m但安装距离只有0.8m，劲度系数20N/m），释放后把0.5kg的小球弹出去' },
  { id: 'M6-atwood', lvl: '大学', q: '阿特伍德机：定滑轮两侧分别挂2kg和3kg的物体，由静止释放，求系统加速度并演示运动' },
  { id: 'X1-spring', lvl: '混合', q: '演示胡克定律和简谐运动：0.5kg的滑块连在劲度系数10N/m的水平弹簧上，拉开后振动' },
  { id: 'X2-projectile', lvl: '混合', q: '平抛运动演示：0.3kg的小球从1米高处以3m/s水平速度抛出，落在地面上' },
  { id: 'X3-mixed', lvl: '混合', q: '把场景里所有东西清掉，重新搭一个：斜面上一个小球滑下来撞到地面上静止的2kg方块，斜面30度长2米，光滑' },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrs = [];
page.on('pageerror', (e) => consoleErrs.push(e.message.slice(0, 120)));
page.setDefaultTimeout(30000);
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

const results = [];
for (const c of CASES) {
  const rec = { id: c.id, lvl: c.lvl, q: c.q };
  try {
    await page.evaluate(() => {
      document.getElementById('btnNew').click();
      document.getElementById('tabAgent').click();
      document.getElementById('agentTextReq').value = '';
    });
    await page.fill('#agentTextReq', c.q);
    const t0 = Date.now();
    let parsed = false;
    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
      try {
        await page.waitForFunction(() => !document.getElementById('btnParseText').disabled, null, { timeout: 120000, polling: 500 });
        await page.click('#btnParseText');
      } catch (e) { console.log('  click-skip:', String(e.message).slice(0, 60)); continue; }
      try {
        await page.waitForFunction(() => {
          const b = document.getElementById('btnApplyParse');
          const st = document.getElementById('parseStatus')?.textContent || '';
          return (b && !b.disabled && document.getElementById('changePreview').style.display !== 'none') || (st.includes('失败') && !st.includes('重试'));
        }, null, { timeout: 200000, polling: 500 });
        const st = await page.evaluate(() => document.getElementById('parseStatus')?.textContent || '');
        parsed = st.includes('完成');
      } catch { /* 下一轮重试 */ }
    }
    rec.parseMs = Date.now() - t0;
    const status = await page.evaluate(() => document.getElementById('parseStatus')?.textContent || '');
    rec.parseStatus = status.slice(0, 80);
    if (!parsed || status.includes('失败') || status.includes('超时')) {
      rec.verdict = 'PARSE_FAIL'; results.push(rec); console.log(JSON.stringify(rec)); fs.writeFileSync(RESULTS, JSON.stringify(results, null, 1)); continue;
    }
    const plan = await page.evaluate(() => ({
      type: document.querySelector('#parseMeta .pmeta .v')?.textContent,
      ents: [...document.querySelectorAll('#parseEntities .pe-row .ty')].map((e) => e.textContent),
    }));
    rec.plan = plan;
    await page.click('#btnApplyParse');
    let built = true;
    try {
      await page.waitForFunction(() => window.MECH.agentVerifyState() != null && !window.MECH.agentBusy(),
        null, { timeout: 200000, polling: 500 });
    } catch { built = false; }
    if (!built) { rec.verdict = 'BUILD_TIMEOUT'; results.push(rec); console.log(JSON.stringify(rec)); fs.writeFileSync(RESULTS, JSON.stringify(results, null, 1)); continue; }
    const out = await page.evaluate(() => ({
      verify: window.MECH.agentVerifyState().summary,
      bad: (window.MECH.agentVerifyState().findings || []).filter((f) => f.sev !== 'ok').map((f) => `[${f.sev}]${f.cat}:${f.msg.slice(0, 70)}`),
      patch: window.MECH.agentPatchState ? window.MECH.agentPatchState() : null,
      ents: window.MECH.doc().entities.map((e) => e.type).join(','),
    }));
    rec.verify = out.verify; rec.bad = out.bad; rec.patchRounds = out.patch && out.patch.rounds; rec.docEnts = out.ents;
    rec.verdict = out.verify.error === 0 ? (out.patch && out.patch.rounds > 0 ? 'PASS_AFTER_PATCH' : 'PASS') : 'VERIFY_ERROR';
  } catch (e) {
    rec.verdict = 'EXC: ' + String(e.message).slice(0, 80);
  }
  results.push(rec);
  console.log(JSON.stringify(rec));
  fs.writeFileSync(RESULTS, JSON.stringify(results, null, 1));
  await page.evaluate(() => document.getElementById('btnNew').click());
  await new Promise((r) => setTimeout(r, 12000));   // 题间限速：防触发上游配额
}
fs.writeFileSync('tools/ui-test/_audit/redteam-results.json', JSON.stringify(results, null, 1));
const fails = results.filter((r) => r.verdict !== 'PASS' && r.verdict !== 'PASS_AFTER_PATCH');
console.log(`\n== 红队汇总 == 总 ${results.length}，一次过 ${results.filter((r) => r.verdict === 'PASS').length}，修补后过 ${results.filter((r) => r.verdict === 'PASS_AFTER_PATCH').length}，失败 ${fails.length}`);
console.log('失败题:', fails.map((f) => `${f.id}[${f.verdict}]`).join(' '));
console.log('pageerror:', consoleErrs.slice(0, 5).join(' | ') || '(none)');
await browser.close();
