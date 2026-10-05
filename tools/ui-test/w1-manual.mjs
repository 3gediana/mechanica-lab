// w1-manual.mjs — 独立接管审计：真实用户路径走查（E3/E5 证据）
// 与 p 系列的区别：不走 fixture/开发者建场 API；断言读 MECH 仅作观测，所有操作走真实 UI。
// 覆盖：空场景手动搭建 / gizmo 缩放语义 / 运行控制 / 撤销重做删复制 / 保存打开 / 刷新恢复
//      / 三大预置（改参数+运行+守恒量） / 坏 JSON / 空场景运行 / 连续建场
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
mkdirSync('shots/w1', { recursive: true });

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

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.waitForTimeout(1200);
  check('A0 启动: MECH.ready（无操作直接进入）', true);

  // ===== A. 手动工作台：空场景起步，只用 UI =====
  await page.click('#btnNew');
  await page.waitForTimeout(250);
  check('A1 新建空场景: 实体=0', (await page.textContent('#roN')).trim() === '0');

  for (const [label, type] of [['斜坡', 'ramp'], ['地面板', 'ground'], ['球', 'sphere']]) {
    await page.locator('.comp-item', { hasText: label }).first().click();
    await page.waitForTimeout(250);
  }
  const ents = await page.evaluate(() => window.MECH.entities().map((e) => ({ t: e.type, n: e.name })));
  check('A2 目录连放斜坡+地面板+球', ents.length === 3 && ents[0].t === 'ramp' && ents[1].t === 'ground' && ents[2].t === 'sphere',
    JSON.stringify(ents));
  await page.screenshot({ path: 'shots/w1/01-three-parts.png' });

  // 检查器改球：质量/半径/初速度（大纲点击选中球）
  await page.locator('#outline .ol-row', { hasText: '球' }).first().click();
  await page.waitForTimeout(250);
  const setRow = async (label, values) => {
    const row = page.locator('#inspBody .frow', { has: page.locator('label', { hasText: label }) }).first();
    const inputs = row.locator('input');
    const n = await inputs.count();
    for (let i = 0; i < Math.min(n, values.length); i++) { await inputs.nth(i).fill(String(values[i])); }
    await inputs.nth(Math.min(n, values.length) - 1).press('Enter');
    await page.waitForTimeout(250);
  };
  await setRow('质量', [2]);
  await setRow('半径', [0.3]);
  await setRow('初速度', [1.5, 0, 0]);
  const ballDoc = (await page.evaluate(() => window.MECH.doc())).entities[2];
  check('A3 检查器: 质量=2/半径=0.3/初速度vx=1.5',
    Math.abs(ballDoc.physics.mass - 2) < 1e-6 && Math.abs(ballDoc.params.radius - 0.3) < 1e-6 && Math.abs(ballDoc.physics.linvel[0] - 1.5) < 1e-6,
    `mass=${ballDoc.physics.mass} r=${ballDoc.params.radius} v=${JSON.stringify(ballDoc.physics.linvel)}`);

  // ===== A4 缩放 gizmo 语义（疑似：松手弹回死控件）=====
  // 真实用户路径：选中球 → 点「缩放」→ 从球心屏幕位置沿 +x 拖拽（scale 模式中心手柄=均匀缩放）
  await page.click('#btnModeScale');
  await page.waitForTimeout(200);
  const ballScr = await page.evaluate(() => {
    const vp = window.MECH.__vp;
    const e = window.MECH.entities()[2];
    const mesh = vp.binds ? null : null;
    // gizmo 挂在选中 mesh 上；用相机把其位置投到屏幕
    const obj = vp.selectedMesh;
    const p = obj ? obj.position.clone().project(vp.camera) : null;
    if (!p) return null;
    const c = vp.renderer.domElement.getBoundingClientRect();
    return { x: c.left + (p.x + 1) / 2 * c.width, y: c.top + (1 - p.y) / 2 * c.height };
  });
  check('A4-预 投影到选中球屏幕坐标', !!ballScr && Number.isFinite(ballScr.x), JSON.stringify(ballScr));
  const posBeforeScale = (await page.evaluate(() => window.MECH.doc())).entities[2].transform.pos;
  // 拖拽中抓取 mesh.scale（阳性对照：证明 scale 手柄确实被拖到）
  let midDragScale = null;
  await page.mouse.move(ballScr.x, ballScr.y);
  await page.mouse.down();
  await page.mouse.move(ballScr.x + 40, ballScr.y, { steps: 6 });
  await page.mouse.move(ballScr.x + 90, ballScr.y, { steps: 6 });
  midDragScale = await page.evaluate(() => {
    const obj = window.MECH.__vp.selectedMesh;
    return obj ? obj.scale.x : null;
  });
  await page.mouse.up();
  await page.waitForTimeout(500);   // commit + rebuild
  const afterScale = (await page.evaluate(() => window.MECH.doc())).entities[2];
  await page.screenshot({ path: 'shots/w1/02-after-scale-drag.png' });
  check('A4-拖 拖拽中 scale 手柄被抓住(mesh.scale 变化)', midDragScale != null && Math.abs(midDragScale - 1) > 0.05,
    `midDragScale=${midDragScale}`);
  check('A4a 松手后 doc.scale 持久化=均匀钳制值[0.25,4]',
    Array.isArray(afterScale.transform.scale) && afterScale.transform.scale.length === 3
    && afterScale.transform.scale.every((v) => v >= 0.25 && v <= 4)
    && afterScale.transform.scale[0] === afterScale.transform.scale[1]
    && afterScale.transform.scale[1] === afterScale.transform.scale[2]
    && Math.abs(afterScale.transform.scale[0] - 1) > 0.02,
    `scale=${JSON.stringify(afterScale.transform.scale)}`);
  // 物理不变式：视觉缩放不碰质量/碰撞（质量仍 2kg）
  check('A4a-2 视觉缩放不改物理(质量仍2kg/半径仍0.3)',
    Math.abs(afterScale.physics.mass - 2) < 1e-6 && Math.abs(afterScale.params.radius - 0.3) < 1e-6,
    `mass=${afterScale.physics.mass} r=${afterScale.params.radius}`);
  // 检查器标注可见（视觉缩放行 + 仅视觉字样）
  const inspNote = await page.evaluate(() => {
    const b = document.querySelector('#inspBody');
    return b ? b.textContent : '';
  });
  check('A4a-3 检查器显示「视觉缩放·仅视觉」标注', /视觉缩放/.test(inspNote) && /仅视觉/.test(inspNote));
  // mesh 视觉缩放松手后保持（不再弹回）——rebuild 从 doc.scale 重建
  const meshScaleAfter = await page.evaluate(() => {
    const vp = window.MECH.__vp;
    const obj = vp.selectedMesh;
    return obj ? obj.scale.x : null;
  });
  check('A4b 松手后视觉缩放保留(rebuild 从 doc.scale 重建,不弹回)',
    meshScaleAfter != null && Math.abs(meshScaleAfter - 1) > 0.02 && meshScaleAfter >= 0.25 && meshScaleAfter <= 4,
    `mesh.scale.x=${meshScaleAfter}`);
  // 对照组：同一路径移动 gizmo 生效（证明拖拽方法本身有效）
  await page.click('#btnModeMove');
  await page.waitForTimeout(200);
  const scr2 = await page.evaluate(() => {
    const vp = window.MECH.__vp;
    const obj = vp.selectedMesh;
    const p = obj.position.clone().project(vp.camera);
    const c = vp.renderer.domElement.getBoundingClientRect();
    return { x: c.left + (p.x + 1) / 2 * c.width, y: c.top + (1 - p.y) / 2 * c.height };
  });
  await page.mouse.move(scr2.x, scr2.y);
  await page.mouse.down();
  await page.mouse.move(scr2.x - 60, scr2.y + 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const afterMove = (await page.evaluate(() => window.MECH.doc())).entities[2].transform.pos;
  const moved = Math.abs(afterMove[0] - posBeforeScale[0]) + Math.abs(afterMove[1] - posBeforeScale[1]) > 0.02;
  check('A4c 对照: 同一路径移动 gizmo 生效', moved, `before=${JSON.stringify(posBeforeScale)} after=${JSON.stringify(afterMove)}`);

  // ===== A5 运行控制 + 叠加层 =====
  await page.click('#btnVectors');
  await page.click('#btnTrails');
  await page.waitForTimeout(150);
  await page.click('#btnPlay');
  // 固定 sleep 会受 headless 吞吐抖动摆布（实测同代码 simT 0.77~0.82 横跨阈值）：
  // 改为等待 simT 达标（语义不弱化，只是不吃机器方差）
  await page.waitForFunction(() => window.MECH.state().simT > 0.8, null, { timeout: 6000 });
  const run1 = await page.evaluate(() => {
    const s = window.MECH.state();
    const ball = window.MECH.entities().find((e) => e.type === 'sphere');
    return { s, tel: window.MECH.telemetry(ball.id) };
  });
  await page.screenshot({ path: 'shots/w1/03-running-vectors.png' });
  check('A5 运行: 时间推进+球体运动+箭头/轨迹开启', run1.s.simT > 0.8 && run1.tel.speed > 0.05,
    `simT=${run1.s.simT.toFixed(2)} v=${run1.tel.speed.toFixed(2)}`);
  await page.click('#btnPause');
  await page.waitForTimeout(200);
  const p1 = await page.evaluate(() => window.MECH.state().simT);
  await page.waitForTimeout(350);
  const p2 = await page.evaluate(() => window.MECH.state().simT);
  check('A6 暂停: 冻结', Math.abs(p1 - p2) < 1e-9);
  await page.click('#btnStep');
  await page.click('#btnStep');
  await page.waitForTimeout(150);
  const p3 = await page.evaluate(() => window.MECH.state().simT);
  check('A7 单步x2: 2/120s', Math.abs((p3 - p2) - 2 / 120) < 1e-9, `delta=${(p3 - p2).toFixed(5)}`);
  await page.click('#btnReset');
  await page.waitForTimeout(300);
  const rst = await page.evaluate(() => {
    const s = window.MECH.state();
    return { s, doc: window.MECH.doc().entities[2] };
  });
  check('A8 重置: 回初始态+初速度保留', rst.s.mode === 'edit' && rst.s.simT === 0 && Math.abs(rst.doc.physics.linvel[0] - 1.5) < 1e-6);

  // ===== A9 撤销/重做（撤销改的是最近提交=参数/位置，比对文档串而非实体数）=====
  const beforeUndoDoc = await page.evaluate(() => JSON.stringify(window.MECH.doc()));
  await page.click('#btnUndo');
  await page.waitForTimeout(250);
  const afterUndoDoc = await page.evaluate(() => JSON.stringify(window.MECH.doc()));
  await page.click('#btnRedo');
  await page.waitForTimeout(250);
  const afterRedoDoc = await page.evaluate(() => JSON.stringify(window.MECH.doc()));
  check('A9 撤销改变文档+重做还原', beforeUndoDoc !== afterUndoDoc && afterRedoDoc === beforeUndoDoc);

  // ===== A10/A11 复制/删除 =====
  await page.locator('#outline .ol-row', { hasText: '球' }).first().click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(350);
  const dupN = (await page.evaluate(() => window.MECH.doc())).entities.length;
  check('A10 Ctrl+D 复制球', dupN === 4, `n=${dupN}`);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(350);
  const delN = (await page.evaluate(() => window.MECH.doc())).entities.length;
  check('A11 Del 删除', delN === 3, `n=${delN}`);

  // ===== A12 保存 JSON（真实下载） =====
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.click('#btnSave'),
  ]);
  const savedPath = 'shots/w1/saved-scene.mechanica.json';
  await download.saveAs(savedPath);
  const savedJson = JSON.parse(readFileSync(savedPath, 'utf8'));
  check('A12 保存下载 .mechanica.json（3实体+版本+初速度）',
    savedJson.entities?.length === 3 && savedJson.version != null
    && Math.abs(savedJson.entities[2].physics.linvel[0] - 1.5) < 1e-6,
    `file=${download.suggestedFilename()}`);

  // ===== A13/A14 清空→打开恢复 =====
  await page.click('#btnNew');
  await page.waitForTimeout(250);
  check('A13 清空: 实体=0', (await page.textContent('#roN')).trim() === '0');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#btnOpen'),
  ]);
  await chooser.setFiles(savedPath);
  await page.waitForTimeout(500);
  const reopened = await page.evaluate(() => window.MECH.doc());
  check('A14 打开 JSON 恢复（3实体+初速度）', reopened.entities.length === 3
    && Math.abs(reopened.entities[2].physics.linvel[0] - 1.5) < 1e-6, `n=${reopened.entities.length}`);

  // ===== A15 坏 JSON 走真实打开入口 =====
  const badPath = 'shots/w1/bad.json';
  writeFileSync(badPath, '{"entities": "not-an-array", "version": 1}');
  const [chooser2] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#btnOpen'),
  ]);
  await chooser2.setFiles(badPath);
  await page.waitForTimeout(500);
  const toastText = await page.evaluate(() => (document.querySelector('#toast') || {}).textContent || '');
  const stillN = (await page.evaluate(() => window.MECH.doc())).entities.length;
  check('A15 坏 JSON: 用户可见提示+场景未被破坏', /打开失败/.test(toastText) && stillN === 3,
    `toast="${toastText}" n=${stillN}`);

  // ===== A16 刷新自动保存恢复 =====
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.waitForTimeout(1200);
  const reN = (await page.evaluate(() => window.MECH.doc())).entities.length;
  check('A16 刷新后自动保存恢复', reN === 3, `n=${reN}`);

  // ===== A17 空场景运行（失败路径: 无实体不崩溃）=====
  await page.click('#btnNew');
  await page.waitForTimeout(200);
  await page.click('#btnPlay');
  await page.waitForTimeout(900);
  const emptyRun = await page.evaluate(() => window.MECH.state());
  check('A17 空场景运行: 不崩溃+时间推进', emptyRun.mode === 'run' && emptyRun.simT > 0.5, `simT=${emptyRun.simT.toFixed(2)}`);
  await page.click('#btnReset');
  await page.waitForTimeout(200);

  // ===== A18 连续建第二/第三个场景（重复使用）=====
  await page.locator('.comp-item', { hasText: '斜坡' }).first().click();
  await page.waitForTimeout(200);
  await page.locator('.comp-item', { hasText: '球' }).first().click();
  await page.waitForTimeout(200);
  const scene2N = (await page.evaluate(() => window.MECH.doc())).entities.length;
  await page.click('#btnNew');
  await page.waitForTimeout(200);
  await page.locator('.comp-item', { hasText: '方块' }).first().click();
  await page.waitForTimeout(200);
  const scene3N = (await page.evaluate(() => window.MECH.doc())).entities.length;
  check('A18 连续第二/第三场景创建', scene2N === 2 && scene3N === 1, `s2=${scene2N} s3=${scene3N}`);

  // ===== B. 三大教学预置（打开→改参数→运行→暂停/单步/重置→守恒量→保存重开）=====
  // 动量守恒（预置自动开矢量/守恒条）
  await page.selectOption('#selPreset', 'momentum');
  await page.waitForTimeout(500);
  const momN = (await page.evaluate(() => window.MECH.doc())).entities.length;
  await page.locator('#outline .ol-row', { hasText: '球 A' }).first().click();
  await page.waitForTimeout(200);
  await setRow('质量', [3]);
  // 运行 → 碰撞 → 读守恒条
  await page.click('#btnPlay');
  await page.waitForTimeout(2600);
  const momData = await page.evaluate(() => {
    const bar = document.querySelector('#consbar');
    return {
      text: bar ? bar.textContent : '',
      simT: window.MECH.state().simT,
      on: !!(bar && bar.classList.contains('on')),
    };
  });
  await page.screenshot({ path: 'shots/w1/04-momentum.png' });
  check('B1 动量守恒: 载入+质量改3kg+运行+守恒条可见有读数',
    momN === 3 && momData.simT > 1.5 && momData.on && /动量误差0\.000%/.test(momData.text) && /p 后4\.500/.test(momData.text),
    `n=${momN} simT=${momData.simT.toFixed(2)} on=${momData.on}`);
  console.log('  [守恒条] ' + momData.text.replace(/\s+/g, ' ').slice(0, 200));
  await page.click('#btnPause');
  await page.waitForTimeout(150);
  await page.click('#btnStep');
  await page.waitForTimeout(150);
  const momStep = await page.evaluate(() => window.MECH.state().simT);
  await page.click('#btnReset');
  await page.waitForTimeout(300);
  check('B1b 动量: 暂停/单步/重置可用', momStep > 0, `stepT=${momStep.toFixed(3)}`);

  // 天体运动（预置自动开轨迹/守恒条）
  await page.selectOption('#selPreset', 'celestial');
  await page.waitForTimeout(600);
  await page.click('#btnPlay');
  await page.waitForTimeout(4500);
  const astro = await page.evaluate(() => {
    const bar = document.querySelector('#consbar');
    return {
      text: bar ? bar.textContent : '',
      simT: window.MECH.state().simT,
      n: window.MECH.entities().length,
    };
  });
  await page.screenshot({ path: 'shots/w1/05-celestial.png' });
  check('B2 天体运动: 运行+守恒条(本模式数值非--: E漂移/Lz漂移/偏心率)',
    astro.n === 2 && astro.simT > 2
    && /E 漂移0\.000%/.test(astro.text) && /Lz 漂移0\.000%/.test(astro.text)
    && /偏心率 e0\.\d+/.test(astro.text),
    `simT=${astro.simT.toFixed(2)}`);
  console.log('  [天体守恒] ' + astro.text.replace(/\s+/g, ' ').slice(0, 220));
  await page.click('#btnReset');
  await page.waitForTimeout(300);

  // 角动量守恒
  await page.selectOption('#selPreset', 'spin');
  await page.waitForTimeout(600);
  await page.click('#btnPlay');
  await page.waitForTimeout(3200);
  const spin = await page.evaluate(() => {
    const bar = document.querySelector('#consbar');
    const crOmega = document.querySelector('#crOmega');
    const crLdrift = document.querySelector('#crLdrift');
    return {
      text: bar ? bar.textContent : '',
      simT: window.MECH.state().simT,
      omega: crOmega ? crOmega.textContent : '--',
      ldrift: crLdrift ? crLdrift.textContent : '--',
    };
  });
  await page.screenshot({ path: 'shots/w1/06-spin.png' });
  // 转动模式本模式字段：crOmega/crLdrift 出现真实数值（非 --）才算
  const spinActive = /\d/.test(spin.omega) && /\d/.test(spin.ldrift);
  check('B3 角动量守恒: 运行+守恒条(本模式 ω/L漂移 数值非--)', spin.simT > 1.5 && spinActive,
    `simT=${spin.simT.toFixed(2)} ω=${spin.omega} L漂移=${spin.ldrift}`);
  console.log('  [转动守恒] ' + spin.text.replace(/\s+/g, ' ').slice(0, 260));
  await page.click('#btnReset');
  await page.waitForTimeout(300);

  // B4 预置保存→重开
  await page.selectOption('#selPreset', 'momentum');
  await page.waitForTimeout(500);
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.click('#btnSave'),
  ]);
  const momPath = 'shots/w1/momentum-saved.json';
  await dl2.saveAs(momPath);
  await page.click('#btnNew');
  await page.waitForTimeout(200);
  const [ch3] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#btnOpen'),
  ]);
  await ch3.setFiles(momPath);
  await page.waitForTimeout(500);
  const momRe = await page.evaluate(() => window.MECH.doc());
  check('B4 动量预置保存→重开', momRe.entities.length === 3,
    `n=${momRe.entities.length} name=${momRe.name}`);

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
