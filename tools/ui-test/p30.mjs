// p30.mjs — Round 33 验收：Goal 六检查器 per-entity 硬清单 + 录制时间轴 + 目录四分类
// （观察：记录轨迹/显示速度向量/滚动状态；测量：显示法线/参与测量；回放 scrub；环境/材质/光源/观察点）
// 纪律：单浏览器 / 单 context / 单标签；总时长上限约 3 分钟。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
mkdirSync('shots', { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

  // ==== A. 检查器观察/测量组（per-entity 硬清单） ====
  await page.evaluate(() => window.MECH.loadPreset('incline'));
  await page.waitForTimeout(350);
  const grp = await page.evaluate(() => {
    const ball = window.MECH.doc().entities.find((e) => e.type === 'sphere');
    window.MECH.select(ball.id);
    const boxes = [...document.querySelectorAll('#inspBody input[type=checkbox]')].length;
    return { boxes };
  });
  check('球检查器含观察组(记录轨迹/显示速度向量 checkbox)', grp.boxes >= 3, `checkbox=${grp.boxes}`);
  // 球A关两项；加对照球（保持默认：记录+显示）；开全局轨迹+矢量总闸
  const ids = await page.evaluate(() => {
    const ball = window.MECH.doc().entities.find((e) => e.type === 'sphere');
    window.MECH.updateEntity(ball.id, { params: { ...ball.params, recordTrail: false, showVel: false } }, '关');
    const b2 = window.MECH.addComponent('sphere', { name: '对照球', transform: { pos: [-0.45, 0.78, 0] }, params: { radius: 0.15 }, physics: { mass: 1, friction: 0.3, restitution: 0.1, linvel: [0, 0, 0] } });
    return { off: ball.id, on: b2 };
  });
  await page.waitForTimeout(200);
  await page.click('#btnTrails');
  await page.click('#btnVectors');
  await page.waitForTimeout(150);
  await page.click('#btnPlay');
  await page.waitForTimeout(1600);
  await page.click('#btnPause');
  const trail = await page.evaluate(() => window.MECH.trailState());
  check('per-entity 记录轨迹: 关闭球不采样(仅对照球 1 条)', trail.lines === 1 && trail.points.length === 1,
    `lines=${trail.lines} points=${JSON.stringify(trail.points)}`);
  const arrows = await page.evaluate(() => window.MECH.vectorState());
  check('per-entity 显示速度向量: 关闭球不画箭(可见=1)', arrows.on && arrows.visible === 1,
    `visible=${arrows.visible}/${arrows.total}`);
  await page.screenshot({ path: 'shots/300-pere-entity.png' });

  // 滚动状态行（telemetry 真实角速度）
  const roll = await page.evaluate((ids) => {
    const t = window.MECH.telemetry(ids.on);
    const grid = document.getElementById('liveGrid');
    // 选中对照球读实时区
    window.MECH.select(ids.on);
    return { ang: t.angvel, w: Math.hypot(t.angvel[0], t.angvel[1], t.angvel[2]) };
  }, ids);
  check('telemetry 真实角速度(对照球 ω>0.5 rad/s)', roll.w > 0.5, `ω=${roll.w.toFixed(2)} rad/s`);
  await page.waitForTimeout(300);
  const rollTxt = await page.evaluate(() => {
    const el = document.querySelector('#liveGrid [data-lv=roll]');
    return el ? el.textContent : null;
  });
  check('检查器「滚动状态」行有判定(纯滚动/滑动/静止)', rollTxt && rollTxt !== '--' && rollTxt.length > 1,
    `roll="${rollTxt}"`);
  // 动量/动能行（硬清单已有项核对）
  const momKe = await page.evaluate(() => {
    const g = (k) => document.querySelector(`#liveGrid [data-lv=${k}]`)?.textContent;
    return { p: g('momentum'), ke: g('keTrans') };
  });
  check('动量/动能实时行非空', momKe.p !== '--' && momKe.ke !== '--', `p=${momKe.p} KE=${momKe.ke}`);

  // ==== B. 斜坡测量组 ====
  await page.evaluate(() => window.MECH.loadPreset('incline'));
  await page.waitForTimeout(300);
  const mea = await page.evaluate(() => {
    const ramp = window.MECH.doc().entities.find((e) => e.type === 'ramp');
    window.MECH.select(ramp.id);
    const boxes = [...document.querySelectorAll('#inspBody input[type=checkbox]')];
    return { n: boxes.length };
  });
  check('斜坡检查器含测量组(2 checkbox)', mea.n >= 2, `checkbox=${mea.n}`);
  // 开显示法线
  await page.evaluate(() => {
    const ramp = window.MECH.doc().entities.find((e) => e.type === 'ramp');
    window.MECH.updateEntity(ramp.id, { params: { ...ramp.params, showNormals: true } }, '开法线');
  });
  await page.waitForTimeout(400);
  const nv = await page.evaluate(() => window.MECH.__vp.normalVizCount());
  check('显示法线: 坡面法向箭头出现', nv >= 1, `normViz=${nv}`);
  await page.screenshot({ path: 'shots/301-ramp-normal.png' });
  // 关参与测量 → 受力+分解开着，坡面接触不再进受力分解（须先开「受力」总闸）；
  // 用 btnStep 步进 20 步（0.17s）保证球仍在坡面上（真实时钟播放会滑到坡底接触地面污染读数）
  await page.click('#btnForces');
  await page.click('#btnDecompose');
  await page.click('#btnStep');
  await page.evaluate(() => { for (let i = 0; i < 19; i++) document.getElementById('btnStep').click(); });
  await page.waitForTimeout(200);
  const withM = await page.evaluate(() => window.MECH.forceState().normals);
  await page.evaluate(() => {
    const ramp = window.MECH.doc().entities.find((e) => e.type === 'ramp');
    window.MECH.updateEntity(ramp.id, { params: { ...ramp.params, inMeasure: false } }, '关参与测量');
  });
  await page.waitForTimeout(300);
  await page.click('#btnReset');
  await page.click('#btnStep');
  await page.evaluate(() => { for (let i = 0; i < 19; i++) document.getElementById('btnStep').click(); });
  await page.waitForTimeout(200);
  const noM = await page.evaluate(() => window.MECH.forceState().normals);
  check('参与测量开关: 关闭后坡面接触不进受力分解', withM >= 1 && noM === 0, `开=${withM} 关=${noM}`);
  await page.click('#btnDecompose');

  // ==== C. 录制回放时间轴拖拽 ====
  await page.evaluate(() => window.MECH.loadPreset('incline'));
  await page.waitForTimeout(300);
  await page.click('#btnRec');
  await page.waitForTimeout(1800);
  await page.click('#btnRec');      // 停止录制
  await page.click('#btnReplay');   // 进入回放
  await page.waitForTimeout(400);
  const barVis = await page.evaluate(() => {
    const bar = document.getElementById('replayBar');
    return bar && bar.style.display !== 'none' && +bar.max > 1;
  });
  check('回放中时间轴可见(随帧数)', barVis === true);
  // 拖到中点：pose 应跳变，roT 变化
  const scrub = await page.evaluate(() => {
    const bar = document.getElementById('replayBar');
    // 跳到「离当前回放位置最远」的端点帧：固定跳中点会与自动推进位置随机重合（差值塌缩竞态）
    const mid = Math.round((+bar.min + +bar.max) / 2);
    const before = window.MECH.state().simT;
    const curIdx = +bar.value;
    // 四分位帧：离当前位置足够远，且不是尾帧（跳尾帧会让回放立即到头触发 stopReplay）
    const q1 = Math.max(2, Math.round(+bar.max / 4)), q3 = Math.min(+bar.max - 2, Math.round(3 * +bar.max / 4));
    const target = curIdx > mid ? q1 : q3;
    bar.value = target;
    bar.dispatchEvent(new Event('input', { bubbles: true }));
    const after = window.MECH.state().simT;
    bar.dispatchEvent(new Event('change', { bubbles: true }));
    return { mid, target, before, after, val: bar.value };
  });
  check('拖动时间轴逐帧 scrub(simT 跳到远端帧)', scrub.after > 0.3 && Math.abs(scrub.after - scrub.before) > 0.05,
    `t=${scrub.before.toFixed(2)}→${scrub.after.toFixed(2)} @frame${scrub.mid}`);
  // 松手后推进判定（事件式）：simT 越过 scrub 时刻即算推进；若先到尾帧结束则如实报
  // （固定 500ms 采样会因短录像+60fps 自动推进在窗口内到头而随机失真）
  const advanced = await page.waitForFunction((tAfter) => {
    const s = window.MECH.state();
    if (s.simT > tAfter + 1e-9) return 'up';
    return s.mode === 'edit' ? 'ended' : false;
  }, scrub.after, { timeout: 2500 }).then((r) => r.jsonValue());
  check('松手后回放继续推进', advanced === 'up', advanced === 'ended' ? '回放已到尾(未及采样)' : '未推进');
  await page.screenshot({ path: 'shots/302-replay-scrub.png' });
  await page.evaluate(() => window.MECH.loadPreset('empty'));
  await page.waitForTimeout(300);

  // ==== D. 目录四分类（环境/材质/光源/相机和观察点） ====
  const heads = await page.evaluate(() => [...document.querySelectorAll('#catalogList .cat-head')].map((h) => h.textContent));
  check('目录含 环境/材质/光源/相机和观察点 分类',
    ['环境', '材质', '光源', '相机和观察点'].every((t) => heads.includes(t)), heads.join('|'));
  // 重力卡：零 g → 地球
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#catalogList .comp-item')];
    cards.find((c) => c.querySelector('.nm')?.textContent === '零 g')?.click();
  });
  await page.waitForTimeout(300);
  const gz = await page.evaluate(() => window.MECH.doc().gravity);
  check('环境卡: 零 g 写入场景重力', gz === 0, `gravity=${gz}`);
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#catalogList .comp-item')];
    cards.find((c) => c.querySelector('.nm')?.textContent === '地球重力')?.click();
  });
  await page.waitForTimeout(300);
  const ge = await page.evaluate(() => window.MECH.doc().gravity);
  check('环境卡: 地球重力恢复', Math.abs(ge + 9.81) < 1e-6, `gravity=${ge}`);
  // 材质卡：选中球点橡胶
  await page.evaluate(() => {
    window.MECH.addComponent('sphere', { name: '材质球', transform: { pos: [0, 0.2, 0] }, params: { radius: 0.15 } });
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const b = window.MECH.doc().entities.find((e) => e.name.includes('材质球'));
    window.MECH.select(b.id);
  });
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#catalogList .comp-item')];
    cards.find((c) => c.querySelector('.nm')?.textContent === '橡胶')?.click();
  });
  await page.waitForTimeout(250);
  const mat = await page.evaluate(() => {
    const b = window.MECH.doc().entities.find((e) => e.name.includes('材质球'));
    return b.render.material;
  });
  check('材质卡: 选中实体换橡胶', mat === 'rubber', `material=${mat}`);
  // 光源组件
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#catalogList .comp-item')];
    cards.find((c) => c.querySelector('.nm')?.textContent === '点光源')?.click();
  });
  await page.waitForTimeout(250);
  const lightOk = await page.evaluate(() => {
    const l = window.MECH.doc().entities.find((e) => e.type === 'light');
    return l && l.physics.body === 'fixed';
  });
  check('光源组件: 放置成功(fixed 无碰撞)', lightOk === true);
  // 观察点：摆相机 → 放置 → 移相机 → 飞回
  await page.evaluate(() => {
    const vp = window.MECH.__vp;
    vp.camera.position.set(6, 4, 7);
    vp.controls.target.set(0.5, 0.2, 0);
    vp.controls.update();
  });
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#catalogList .comp-item')];
    cards.find((c) => c.querySelector('.nm')?.textContent === '观察点')?.click();
  });
  await page.waitForTimeout(250);
  const vp = await page.evaluate(() => {
    const v = window.MECH.doc().entities.find((e) => e.type === 'viewpoint');
    return v ? { pos: v.transform.pos, target: v.params.target } : null;
  });
  check('观察点: 放置保存相机位姿', vp && Math.abs(vp.pos[0] - 6) < 0.01 && Math.abs(vp.target[2]) < 0.01,
    vp && `pos=[${vp.pos}] target=[${vp.target}]`);
  await page.evaluate(() => {
    const v = window.MECH.__vp;
    v.camera.position.set(2, 1.5, 3);
    v.controls.target.set(0, 0, 0);
    v.controls.update();
  });
  await page.evaluate((vid) => {
    window.MECH.select(vid);
    const btn = [...document.querySelectorAll('#inspBody button')].find((b) => b.textContent.includes('飞到观察点'));
    if (btn) btn.click();
  }, (await page.evaluate(() => window.MECH.doc().entities.find((e) => e.type === 'viewpoint'))).id);
  await page.waitForFunction(() => {
    const v = window.MECH.__vp;
    return v.camera.position.distanceTo(new (v.camera.position.constructor)(6, 4, 7)) < 0.05;
  }, null, { timeout: 5000 });
  check('观察点: 一键飞回保存视角(平滑收敛)', true, 'camera→(6,4,7)');
  await page.screenshot({ path: 'shots/303-viewpoint.png' });
  // light 运行无错（渲染 + 物理）
  await page.click('#btnPlay');
  await page.waitForTimeout(700);
  await page.click('#btnPause');
  check('光源场景运行无异常', await page.evaluate(() => window.MECH.state().simT > 0.3));

  await page.close();
  await context.close();
} finally {
  await browser.close();
}

console.log('\n== 汇总 ==');
const nFail = results.filter((r) => !r.ok).length;
console.log(`PASS ${results.length - nFail}/${results.length}`);
if (consoleErrors.length) {
  console.log('浏览器 console/page 错误:');
  for (const e of consoleErrors.slice(0, 12)) console.log('  ', e.slice(0, 300));
}
process.exit(nFail === 0 && consoleErrors.length === 0 ? 0 : 1);
