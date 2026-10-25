// workbench.js — 工作台主体：文档状态机 + UI 接线
// 单一数据流：UI/Agent → 修改 doc → rebuild（编辑态）→ commit 历史 + 自动保存。
// 运行态只推进物理不重建；重置 = 从文档全量重建回初始态。
import * as THREE from 'three';
import * as registry from './engine/registry.js';
import {
  History, serializeDoc, deserializeDoc, cloneDoc, createEmptyDoc,
  getEntity, addEntity, removeEntity as docRemove, duplicateEntity, updateEntity, newId,
} from './engine/scene-doc.js';
import { Runtime, FIXED_H, attachRegistry } from './engine/runtime.js';
import { Viewport } from './engine/viewport.js';
import { recorder } from './engine/recorder.js';
import { getPreset, PRESETS, PRESET_CAMERA } from './engine/presets.js';
import { createMaterials } from './materials.js';
import { normalizeParse, planToOverrides, ballOnRamp } from './engine/parse-schema.js';
import { explainRun } from './engine/explain.js';
import { auditStatic, auditMotion, summarize, rampGeomFromParams, patchBrief } from './engine/agent-verify.js';
import { renderThumb } from './engine/thumbs.js';
import { PerfMon } from './perfmon.js';
import { SoundEngine } from './sound.js';
import { JuiceFX } from './engine/juice.js';

const $ = (id) => document.getElementById(id);
// 图标钮文案只写 .lab span（直写 textContent 会抹掉内联 svg 图标）
const setBtnText = (id, txt) => {
  const b = $(id);
  if (!b) return;
  const lab = b.querySelector('.lab');
  (lab || b).textContent = txt;
};
const veil = $('veil'), veilStatus = $('veilStatus'), errbar = $('errbar');
veil.addEventListener('transitionend', () => { if (veil.classList.contains('gone')) veil.style.visibility = 'hidden'; });   // UI-586：退场后移出 AT 树

// PL-51 DOM 读数脏检查：textContent 只在文本真变时写（0.15s 节流后仍每帧比较，
// 但相同值零布局/零绘制提交——运行态读数是常驻 DOM 写入源）
function setTxt(el, s) {
  if (el && el.__t !== s) { el.__t = s; el.textContent = s; }
}
// 同口径的样式脏检查（守恒量条宽度/颜色是另一常驻样式写入源）
function setSt(el, prop, v) {
  const k = '__s' + prop;
  if (el && el[k] !== v) { el[k] = v; el.style[prop] = v; }
}

function setLoad(msg) { veilStatus.textContent = msg; }
// UI-503：场景名输入框多处赋值统一走这里，同步 title——长名截断时悬停可读全名
function setSceneNameInput(v) {
  const el = $('sceneName');
  el.value = v;
  el.title = v;
}
// UI-584：errbar 右端固定 × 钮，出错后可关不再只能刷新；UI-585：可见时 body.erropen 让 toast 下移避让
function showErr(msg) {
  $('errMsg').textContent = msg;
  errbar.style.display = 'flex';
  document.body.classList.add('erropen');
}
function hideErr() {
  errbar.style.display = 'none';
  document.body.classList.remove('erropen');
}
$('errClose').onclick = hideErr;
function fail(msg) {
  veilStatus.textContent = '加载失败：' + msg;
  veilStatus.classList.add('err');
  showErr(msg);
  veil.classList.remove('gone');
  veil.style.visibility = '';   // UI-586：重进可再次可见
  const retry = document.getElementById('btnVeilRetry');   // UI-13
  if (retry) retry.style.display = 'inline-block';
}
let toastTimer = 0;
let toastLastMsg = '', toastLastAt = 0;
// UI-581 长文案（「打开失败: …」「已导出 …csv」）1800ms 读不完 → 时长随字数，上限 4s
const toastMs = (msg) => 1800 + Math.min(2200, msg.length * 45);
function toast(msg, type) {
  const t = $('toast');
  const now = performance.now();
  // 同文案 1.2s 内重复触发（连点/连删）只续期不重弹，避免闪跳
  if (msg === toastLastMsg && now - toastLastAt < 1200) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), toastMs(msg));
    toastLastAt = now;
    return;
  }
  toastLastMsg = msg; toastLastAt = now;
  t.textContent = msg;
  // UI-582 类型语义：ok/warn/err 左缘色条（缺省中性）；UI-583 已在显示时重放上浮入场，避免文字原地瞬换
  t.classList.toggle('ok', type === 'ok');
  t.classList.toggle('warn', type === 'warn');
  t.classList.toggle('err', type === 'err');
  if (t.classList.contains('on')) {
    t.classList.remove('on');
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('on')));
  } else {
    t.classList.add('on');
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('on'); toastLastMsg = ''; }, toastMs(msg));
}

// UI-589/616：帮助浮层统一开关——记 opener 关时还焦点、开时移焦入卡；? 与 F1 同走这里
let helpOpener = null;
function toggleHelp() {
  const h = $('helpOverlay');
  const opening = !h.classList.contains('on');
  h.classList.toggle('on', opening);
  if (opening) {
    helpOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    h.querySelector('.card').focus();
  } else if (helpOpener) {
    helpOpener.focus();
    helpOpener = null;
  }
}

// ============ 全局状态 ============
let doc = null;                 // 当前场景文档（唯一事实源）
let selectedId = null;          // 主选中（gizmo/检查器对象）
let selectedIds = [];           // 多选集合（末位=主选中）
let mode = 'edit';              // edit | run
let paused = false;
let timeScale = 1;
let appReady = false;
const history = new History();
let RAPIER, M, runtime, viewport;
let gizmoDragCtx = null;        // 拖拽实时碰撞会话（onGizmoDragStart 建档 / End 清档）
let swatchPreviews = null;      // 材质选择器预览 { key: dataURL }，异步生成完成前色块降级

const AUTOSAVE_KEY = 'mechanica.autosave.v1';

// ============ 初始化 ============
(async function init() {
  try {
    setLoad('正在加载物理内核');
    RAPIER = await import('@dimforge/rapier3d-compat');
    await RAPIER.init();

    setLoad('正在初始化视口');
    viewport = new Viewport($('stage'), {
      onSelect: (id, additive) => selectEntity(id, additive),
      // 放置防穿模（用户需求）：ghost 跟随点的碰撞箱穿透探针（viewport 内节流），红色警示用
      ghostProbe: (pos, rotY) => {
        if (mode !== 'edit' || !viewport._ghostComponent) return false;
        const comp = viewport._ghostComponent;
        const isDynamic = comp.defaults.physics?.body === 'dynamic';
        return placementLiftFor(comp.id, comp.defaults.params, pos, rotY, null, isDynamic) !== 0;   // 原位被占=红
      },
      onBoxSelect: (ids) => {
        selectedIds = ids;
        selectedId = ids.length ? ids[ids.length - 1] : null;
        syncSelectionUI();
        if (ids.length) toast('框选 ' + ids.length + ' 个实体');
      },
      onGizmoCommit: () => {
        const e = getEntity(doc, selectedId);
        if (!e) return;
        // 暂停态 gizmo 摆姿势（PL-14）：只写物理体不进文档/undo，重置回初始文档。
        // 挪动=只拦「加深穿透」：候选嵌入方向数 ≥ 当前才弹回——允许朝逃逸方向挪出
        // （授权式嵌入体否则被永久冻结，w1 A4c 实测）
        if (mode === 'run') {
          const bind = runtime.binds.get(selectedId);
          if (bind && bind.mesh) {
            const bt = bind.body.translation();
            const curN = entityPoseBlocked(selectedId, [bt.x, bt.y, bt.z]);
            const candN = entityPoseBlocked(selectedId, bind.mesh.position.toArray());
            if (candN > 0 && candN >= curN) {
              bind.mesh.position.set(bt.x, bt.y, bt.z);
              viewport.markDirty();
              toast('不能加深穿透：当前位已与物体重叠');
              return;
            }
            runtime.setLivePose(selectedId, bind.mesh.position.toArray(), [bind.mesh.rotation.x, bind.mesh.rotation.y, bind.mesh.rotation.z]);
            renderInspector();   // UI-535：摆姿势/缩放后检查器读数行同步（此前只写 mesh，面板显示旧值与画面不符）
          }
          return;
        }
        // 平移释放时按当前吸附档位归位（endpoint/surface/center；grid 档由 gizmo 拖动内建吸附）
        const bind = runtime.binds.get(e.id);
        if (viewport.gizmoMode === 'translate' && bind) applySnapToMesh(bind.mesh);
        // 放置防穿模的挪动延伸（用户需求）：释放位比出发位更深嵌入=弹回不提交（深度口径，
        // 与拖拽实时钳制同规则——方向数口径在贴坡等贴面场景会误杀合法贴停）。缩放模式跳过
        // （视觉缩放不改碰撞体/位姿，无穿模含义；弹回须还原 pos+rot+scale 全套，scale 残留
        // 不清会滚雪球成 ±1e7——w1 A4 实测）。
        if (bind && viewport.gizmoMode !== 'scale') {
          const curD = entityPoseDepth(e.id, e.transform.pos);
          const candD = entityPoseDepth(e.id, bind.mesh.position.toArray());
          if (candD > Math.max(curD + 0.004, 0.01)) {
            bind.mesh.position.fromArray(e.transform.pos);
            bind.mesh.rotation.set(...e.transform.rot);
            if (e.transform.scale) bind.mesh.scale.fromArray(e.transform.scale);
            viewport.markDirty();
            toast('不能加深穿透：当前位已与物体重叠');
            return;
          }
        }
        viewport.applyGizmoToEntity(e);
        rebuildAll();
        commitChange('移动 ' + e.name);
        renderInspector();
      },
      // 自由摆放实时碰撞（用户需求「自由摆放时就该有碰撞体积」）：拖拽全程钳制，
      // 不等提交才弹回——拖进坡体=贴着坡面滑/停住，旋转嵌入=抬升解算到贴面高度。
      onGizmoDragStart: () => {
        gizmoDragCtx = null;
        if (mode !== 'edit') return;   // 运行/暂停态摆姿势保持 PL-14 语义（提交时只拦加深）
        const e = getEntity(doc, selectedId);
        if (!e) return;
        const bind = runtime.binds.get(e.id);
        if (!bind || !bind.mesh) return;
        const mesh = bind.mesh;
        gizmoDragCtx = {
          id: e.id, mesh, mode: viewport.gizmoMode,
          lastGoodPos: mesh.position.clone(),
          lastGoodRot: mesh.rotation.clone(),
          // 出发即嵌入体（如预设贴坡球）：不比出发更深即可（逃逸自由）；干净出发：≤10mm 接触皮
          startDepth: entityPoseDepth(e.id, mesh.position.toArray()),
        };
      },
      onGizmoLive: (gmode) => {
        const ctx = gizmoDragCtx;
        if (!ctx || ctx.mode !== gmode) return;
        const mesh = ctx.mesh;
        const okDepth = Math.max(ctx.startDepth + 0.004, 0.01);
        if (gmode === 'translate') {
          const p = mesh.position;
          if (entityPoseDepth(ctx.id, p.toArray()) <= okDepth) { ctx.lastGoodPos.copy(p); return; }
          // 整步被挡→滑动分解：先保高度平移、再单轴，能滑就滑（贴墙滑动而非冻死）
          const lg = ctx.lastGoodPos;
          for (const [x, y, z] of [[p.x, p.y, lg.z], [p.x, lg.y, p.z], [lg.x, p.y, p.z], [p.x, lg.y, lg.z], [lg.x, p.y, lg.z], [lg.x, lg.y, p.z]]) {
            if (entityPoseDepth(ctx.id, [x, y, z]) <= okDepth) { p.set(x, y, z); ctx.lastGoodPos.set(x, y, z); return; }
          }
          p.copy(lg);
        } else if (gmode === 'rotate') {
          if (entityPoseDepth(ctx.id, mesh.position.toArray()) <= okDepth) {
            ctx.lastGoodPos.copy(mesh.position); ctx.lastGoodRot.copy(mesh.rotation); return;
          }
          // 旋转嵌入（如地上盒子绕 Z 转出棱角入地）：抬升到新姿态的贴面高度；抬无可抬回滚
          for (const lift of [0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7]) {
            const y = mesh.position.y + lift;
            if (entityPoseDepth(ctx.id, [mesh.position.x, y, mesh.position.z]) <= okDepth) {
              mesh.position.y = y;
              ctx.lastGoodPos.copy(mesh.position); ctx.lastGoodRot.copy(mesh.rotation);
              return;
            }
          }
          mesh.position.copy(ctx.lastGoodPos);
          mesh.rotation.copy(ctx.lastGoodRot);
        }
      },
      onGizmoDragEnd: () => { gizmoDragCtx = null; },
    });
    await viewport.init();

    setLoad('正在加载材质库');
    M = await createMaterials();
    // 材质选择器真材质预览（用户反馈「全是纯色图案」）：离屏渲 12 枚材质球，完成后就地
    // 替换目录色块；生成期/失败期保持色块降级，不阻塞主流程
    viewport.renderMaterialSwatches(M).then((map) => {
      swatchPreviews = map;
      refreshMaterialSwatches();
    }).catch((e) => console.warn('[workbench] 材质预览生成失败，保持色块:', e && e.message));

    setLoad('正在构建场景');
    runtime = new Runtime(RAPIER, M, viewport.scene);
    attachRegistry(runtime, registry);
    viewport.setBindLookup((id) => runtime.binds.get(id));
    viewport.setGhostFactory((c) => {
      try { return c.buildGeometry(c.defaults.params); } catch (e) { return null; }
    });
    viewport.setGhostSnapMode(snapMode);   // ghost 吸附档位与大纲吸附循环同源

    const saved = loadAutosave();
    doc = saved || getPreset('incline');
    if (saved) queueMicrotask(() => toast(`已恢复上次会话：「${doc.name}」（${doc.entities.length} 实体）——重新开始请点「新建」`));
    rebuildAll();
    bindUI();
    bindRunGrab();
    juice = new JuiceFX(viewport.scene);
    setShake(juice.shakeOn);
    {
      let hudPref = true;
      try { hudPref = localStorage.getItem('mech.perfhud') !== '0'; } catch (e) { /* 隐私模式默认开 */ }
      setPerfHud(hudPref);
    }

    appReady = true;
    veil.classList.add('gone');
    tick();
  } catch (err) {
    console.error(err);
    fail(err && err.message ? err.message : String(err));
  }
})();

function loadAutosave() {
  try {
    const s = localStorage.getItem(AUTOSAVE_KEY);
    if (!s) return null;
    return deserializeDoc(s);
  } catch (e) {
    console.warn('[workbench] 自动保存不可用，忽略', e);
    return null;
  }
}
let _autosaveTimer = null;
function autosave() {
  // 尾沿防抖：连续小步（拖 gizmo/方向键连调）合并成 300ms 一次落盘，大场景不再每步写盘
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    try { localStorage.setItem(AUTOSAVE_KEY, serializeDoc(doc)); } catch { /* 隐私模式等，静默 */ }
  }, 300);
}

// ============ 文档变更主通道 ============
let historyBatchDepth = 0;   // Agent 建场批次：中间 commit 跳过入栈，结束时合并压一个终态快照（单 undo 单元）
let rebuildSuspend = 0;      // Agent 建场批内挂起全量重建：N 实体 N 次 Rapier 世界重建 → 批末一次（PER-5）

function commitChange(label) {
  markDirty();
  if (historyBatchDepth > 0) { autosave(); saveSceneSnap(); return; }
  history.commit(() => serializeDoc(doc), label);
  autosave();
  saveSceneSnap();
  refreshHistoryButtons();
}
function beginHistoryBatch() { historyBatchDepth++; }
function endHistoryBatch(label) {
  historyBatchDepth = Math.max(0, historyBatchDepth - 1);
  if (historyBatchDepth === 0) {
    history.commit(() => serializeDoc(doc), label);
    refreshHistoryButtons();
  }
}

function rebuildAll(rerenderInspector = true) {
  if (rebuildSuspend > 0) return;   // 批内挂起：suspendRebuild 收尾统一重建一次
  runtime.rebuild(doc);
  if (juice) juice.clear();         // 瞬时 FX 与计数随场景换代清空
  viewport.markDirty();   // 全量重建=视觉必然变化（静止帧跳渲染必须感知）
  rotationBase = null; momentumBase = null; astroBase = null;   // 基准必须在初始态重采
  selectedIds = selectedIds.filter((x) => runtime.binds.has(x));
  if (selectedId && !selectedIds.includes(selectedId)) {
    selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
  }
  viewport.setHighlights(selectedIds);
  renderOutline();
  if (rerenderInspector) renderInspector();
  updateSimbarStatic();
}

// 假设与修正记录面板（PHY-61）：doc.meta 里的解析假设/用户修正可见（存了不能看不见）
function refreshAssumpPanel() {
  const grp0 = document.getElementById('assumpGrp');
  const body = document.getElementById('assumpBody');
  if (!grp0 || !body) return;
  const asm = (doc.meta && doc.meta.assumptions) || [];
  const cor = (doc.meta && doc.meta.corrections) || [];
  if (!asm.length && !cor.length) { grp0.style.display = 'none'; return; }
  grp0.style.display = 'block';
  body.innerHTML = '';
  const mk = (txt, dim) => {
    const d = document.createElement('div');
    d.textContent = txt;
    d.style.color = dim ? 'var(--faint)' : 'var(--dim)';
    body.appendChild(d);
  };
  for (const a of asm.slice(0, 6)) mk('假设: ' + a, false);
  for (const c of cor.slice(-4)) mk(`修正: ${c.field} ${c.from} → ${c.to}`, true);
}

function applyDoc(doc0, label) {   // 整文档替换（预置/打开/新建/撤销重做）——运行态一并终结
  const hadAppliedPlan = agentPlanApplied;
  doc = doc0;
  mode = 'edit';
  paused = false;
  // 已建场的解析计划随场景切换作废（防拿旧 plan 对新场景生成解释）；
  // 「未应用」的 plan 保留——解析→换空场景→建场是合法流程（p9 用例锁定）
  if (hadAppliedPlan) { resetAgentPanel(); toast('已切换场景，原解析建场结果已清空'); }
  if (viewport) viewport.setGizmoEnabled(true);
  rebuildAll();
  refreshAssumpPanel();
  updateSimbarStatic();
  commitChange(label);
}

// ============ 选择（单选 + shift 加选 + 框选多选） ============
function selectEntity(id, additive = false) {
  if (additive && id) {
    const i = selectedIds.indexOf(id);
    if (i >= 0) selectedIds.splice(i, 1); else selectedIds.push(id);
  } else {
    selectedIds = id ? [id] : [];
  }
  selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
  syncSelectionUI();
}

function syncSelectionUI() {
  viewport.setHighlights(selectedIds.filter((x) => runtime.binds.has(x)));
  updateOutlineSelection();     // 只刷高亮，不重建（重建会打断行内改名）
  renderInspector();
}

function updateOutlineSelection() {
  let mainRow = null;
  for (const row of $('outline').querySelectorAll('.ol-row')) {
    row.classList.toggle('sel', selectedIds.includes(row.dataset.id));
    if (row.dataset.id === selectedId) mainRow = row;
  }
  // 视口点选/Agent 建场选中后，大纲滚到该行（长场景不找人）
  if (mainRow) mainRow.scrollIntoView({ block: 'nearest' });
  // 成组入口随多选出现/消失（不重建表，避免打断行内改名）
  const box = $('outline');
  let btn = box.querySelector('.ol-group-btn');
  if (selectedIds.length >= 2) {
    if (!btn) {
      btn = document.createElement('div');
      btn.className = 'ol-group-btn';
      btn.style.cssText = 'cursor:pointer;font-size: 11px;color:var(--accent);padding:4px 6px;border:1px dashed rgba(217,164,65,.4);margin:3px;border-radius:2px';
      btn.onclick = () => assignGroup([...selectedIds]);
      box.insertBefore(btn, box.firstChild);
    }
    btn.textContent = `⧉ 将 ${selectedIds.length} 个对象成组`;
  } else if (btn) btn.remove();
}

// ============ 实体操作（UI 与 Agent 共用） ============
// 放置防穿模（用户需求「根据物体碰撞箱阻挡」）：探测=viewport.meshPenetrates（26 向射线
// 自表面 vs 他表面相对口径——贴面停放放行、嵌入拦截，纯 three.js 几何、零 Rapier 查询）。
// 返回 0=原位可用；>0=需抬升该高度（放到占位物上方）；null=抬无可抬（拒绝）。
const _plcProbeCache = new Map();   // typeId+params JSON → geometry（探针复用，勿与 ghost 混用）
function placementLiftFor(typeId, params, pos, rotY, excludeId = null, isDynamic = false) {
  const key = typeId + '|' + JSON.stringify(params);
  let geo = _plcProbeCache.get(key);
  if (!geo) {
    const c = registry.getComponent(typeId);
    if (!c || !c.buildGeometry) return 0;
    try { geo = c.buildGeometry(params); } catch { return 0; }
    _plcProbeCache.set(key, geo);
  }
  const probe = new THREE.Mesh(geo);
  probe.position.set(pos[0], pos[1], pos[2]);
  probe.rotation.y = rotY;
  const hit = () => viewport.meshPenetrates(probe, excludeId, isDynamic);
  if (!hit()) return 0;
  for (const lift of [0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 0.9, 1.2]) {   // 高阶梯到 1.2m（高坡/墙顶也能解算落顶）
    probe.position.y = pos[1] + lift;
    if (!hit()) return lift;
  }
  return null;
}

// 编辑态挪动（gizmo 拖拽/方向键）的穿模阻挡检查：实体摆到 pos（旋转保持 mesh 现状）
// 走 26 向射线相对口径（viewport.meshPenetrates）——贴面停放放行、嵌入拦截。
function entityPoseBlocked(id, pos, isDynamicOverride = null) {
  const bind = runtime.binds.get(id);
  if (!bind || !bind.mesh) return false;
  const isDynamic = isDynamicOverride != null ? isDynamicOverride
    : (bind.entity.physics.body === 'dynamic');   // 缺省从实体自身推导：动态体被一切他体阻挡
  const savedP = bind.mesh.position.clone();
  bind.mesh.position.set(pos[0], pos[1], pos[2]);
  let count;
  try { count = viewport.meshPenetrates(bind.mesh, id, isDynamic); }
  finally { bind.mesh.position.copy(savedP); bind.mesh.updateMatrixWorld(true); }
  return count;   // 嵌入方向数（0=不嵌）
}

// 深度口径（拖拽实时碰撞用）：返回当前姿态（位置换成 pos，旋转保持 mesh 现状）对
// 他体的最深嵌入深度 m（0=不嵌）。方向数在贴坡等贴面场景噪声大，深度差才是稳定的
// 「不比出发更深」相对量——见 viewport._embedStats 双口径注释。
function entityPoseDepth(id, pos) {
  const bind = runtime.binds.get(id);
  if (!bind || !bind.mesh) return 0;
  const isDynamic = bind.entity.physics.body === 'dynamic';
  const savedP = bind.mesh.position.clone();
  bind.mesh.position.set(pos[0], pos[1], pos[2]);
  let depth;
  try { depth = viewport.meshPenetrationDepth(bind.mesh, id, isDynamic); }
  finally { bind.mesh.position.copy(savedP); bind.mesh.updateMatrixWorld(true); }
  return depth;
}

// 目录默认槽位的「最近空位」搜索：原位→抬升阶梯→周边 1.2m 环。全占= null（拒绝）。
// 保证「目录加一件」一键可用（槽位被场景体占住时自动挪到最近空位，如斜坡旁）。
// 探测同 placementLiftFor（26 向射线相对口径；固定体×固定体放行由调用方过滤）。
function placementFindSpot(typeId, params, pos, rotY, isDynamic = false) {
  const key = typeId + '|' + JSON.stringify(params);
  let geo = _plcProbeCache.get(key);
  if (!geo) {
    const c = registry.getComponent(typeId);
    if (!c || !c.buildGeometry) return [...pos];
    try { geo = c.buildGeometry(params); } catch { return [...pos]; }
    _plcProbeCache.set(key, geo);
  }
  const probe = new THREE.Mesh(geo);
  probe.rotation.y = rotY;
  const others = [];
  for (const [, bind] of runtime.binds) {
    const e = bind.entity;
    if (!bind.mesh || e.physics.body === 'none' || e.physics.gravitating) continue;
    if (e.params && e.params.noCollide) continue;
    if (!isDynamic && e.physics.body !== 'dynamic') continue;   // 固定×固定放行（与 placementLiftFor 同规则）
    others.push(bind.mesh);
  }
  const rings = [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [1.2, 1.2], [-1.2, 1.2], [1.2, -1.2], [-1.2, -1.2]];
  for (const [dx, dz] of rings) {
    for (const lift of (dx === 0 && dz === 0) ? [0, 0.02, 0.05, 0.1, 0.2, 0.35] : [0]) {
      probe.position.set(pos[0] + dx, pos[1] + lift, pos[2] + dz);
      if (!viewport.meshPenetrates(probe, null)) {
        return [+(pos[0] + dx).toFixed(3), +(pos[1] + lift).toFixed(3), +(pos[2] + dz).toFixed(3)];
      }
    }
  }
  return null;
}
function opAddComponent(typeId, overrides = {}, opts = {}) {
  const c = registry.getComponent(typeId);
  // 观察点（相机和观察点分类）：放置即保存当前相机位姿（位置→transform，注视点→params.target）
  if (c.isViewpoint) {
    const cp = viewport.camera.position, ct = viewport.controls.target;
    const e = registry.createEntity(typeId, {
      source: overrides.source || 'user',
      params: { height: c.defaults.params.height, target: [+ct.x.toFixed(3), +ct.y.toFixed(3), +ct.z.toFixed(3)] },
      transform: { pos: [+cp.x.toFixed(3), +cp.y.toFixed(3), +cp.z.toFixed(3)] },
    });
    addEntity(doc, e);
    rebuildAll();
    commitChange('保存观察点');
    selectEntity(e.id);
    noteRecentUse(typeId);
    toast('观察点已保存（选中后可一键飞回）');
    return e.id;
  }
  // 传感器类（速度传感器/计时器）：选 1 个动态体绑定，读数存 runtime 不进文档
  if (c.isSensor) {
    if (selectedIds.length !== 1) { toast('先选中 1 个动态实体，再添加' + c.label); return null; }
    const target = getEntity(doc, selectedIds[0]);
    if (!target || target.physics.body !== 'dynamic') { toast(c.label + ' 需绑定动态实体'); return null; }
    const spawn = c.spawnY ? c.spawnY(c.defaults.params) : 0.5;
    const e = registry.createEntity(typeId, {
      name: c.label + '→' + (target.name || target.type),
      attach: [target.id], source: overrides.source || 'user',
      transform: { pos: [target.transform.pos[0] + 0.6, spawn, target.transform.pos[2]] },
    });
    addEntity(doc, e);
    rebuildAll();
    commitChange('添加 ' + c.label);
    selectEntity(e.id);
    noteRecentUse(typeId);
    return e.id;
  }
  // 测量类（测量尺）：两实体语义（同 isLink），产静态测量标注（无 joint）
  if (c.isMeasure) {
    let attach = overrides.attach || null;
    if (!attach) {
      if (selectedIds.length !== 2) { toast('先选中两个实体，再添加' + c.label); return null; }
      attach = [...selectedIds];
    }
    const ea = getEntity(doc, attach[0]), eb = getEntity(doc, attach[1]);
    if (!ea || !eb) { toast('测量目标不存在'); return null; }
    const pa = ea.transform.pos, pb = eb.transform.pos;
    const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
    const e = registry.createEntity(typeId, {
      name: `${c.label} ${len.toFixed(2)}m`,
      attach, source: overrides.source || 'user',
      transform: { pos: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2 + 0.15, (pa[2] + pb[2]) / 2] },
    });
    addEntity(doc, e);
    rebuildAll();
    commitChange('添加 ' + c.label);
    selectEntity(e.id);
    noteRecentUse(typeId);
    return e.id;
  }
  // 连接类（绳/弹簧）：需选中两个实体，自动按当前距离定长
  if (c.isLink) {
    let attach = overrides.attach || null;
    let e;
    if (attach) {
      // 解析/Agent 路径：attach 已给（真实 id）
      const ea = getEntity(doc, attach[0]), eb = getEntity(doc, attach[1]);
      if (!ea || !eb) { toast('连接目标不存在'); return null; }
      const pa = ea.transform.pos, pb = eb.transform.pos;
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      e = registry.createEntity(typeId, {
        name: `${c.label} ${len.toFixed(2)}m`,
        params: { length: +len.toFixed(3), restLength: +len.toFixed(3), ...overrides.params },
        attach, source: overrides.source || 'user',
      });
    } else {
      if (selectedIds.length !== 2) { toast('先选中两个实体，再添加' + c.label); return null; }
      const [ida, idb] = selectedIds;
      const ea = getEntity(doc, ida), eb = getEntity(doc, idb);
      if (!ea || !eb) return null;
      const pa = ea.transform.pos, pb = eb.transform.pos;
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      e = registry.createEntity(typeId, {
        name: `${c.label} ${len.toFixed(2)}m`,
        params: { length: +len.toFixed(3), restLength: +len.toFixed(3) },
        attach: [ida, idb],
      });
    }
    addEntity(doc, e);
    rebuildAll();
    commitChange('添加 ' + c.label);
    selectEntity(e.id);
    noteRecentUse(typeId);
    if (forcesOn) viewport.setTensionArrows(true);   // 有绳时受力开=张力箭头也开
    return e.id;
  }
  const n = doc.entities.length;
  const base = { transform: { pos: [((n % 3) - 1) * 0.8, c.spawnY(c.defaults.params) + 0.05, ((Math.floor(n / 3) % 3) - 1) * 0.8] } };
  const e = registry.createEntity(typeId, { ...base, ...overrides });
  // 放置防穿模（仅手动放置通路）：碰撞箱（AABB，2mm 贴面容差）重叠检测。
  // ghost 落点：指哪放哪——被占先试抬到占位物上方，抬无可抬=拒绝并保留红色预览；
  // 目录默认槽位：被占自动搜最近空位（原位→抬升→周边环），保证「目录加一件」一键可用
  if (opts.resolvePlacement && c.buildCollider && e.physics && e.physics.body !== 'none' && !e.physics.gravitating) {
    const rotY = e.transform.rot[1] || 0;
    const isDynamic = e.physics.body === 'dynamic';
    if (opts.ghost) {
      const lift = placementLiftFor(typeId, e.params, e.transform.pos, rotY, null, isDynamic);
      if (lift === null) { toast('放置被阻挡：与现有物体碰撞，换个空位再放'); return null; }
      if (lift > 0) { e.transform.pos = [e.transform.pos[0], +(e.transform.pos[1] + lift).toFixed(3), e.transform.pos[2]]; toast('原位被占，已放在其上方'); }
    } else {
      const spot = placementFindSpot(typeId, e.params, e.transform.pos, rotY, isDynamic);
      if (!spot) { toast('放置被阻挡：与现有物体碰撞，换个空位再放'); return null; }
      if (spot[1] !== e.transform.pos[1] || spot[0] !== e.transform.pos[0] || spot[2] !== e.transform.pos[2]) {
        e.transform.pos = spot;
        toast('原位被占，已放在附近空位');
      }
    }
  }
  addEntity(doc, e);
  rebuildAll();
  commitChange('添加 ' + c.label);
  selectEntity(e.id);
  noteRecentUse(typeId);
  return e.id;
}

// 最近使用（localStorage，cap 5）
const RECENT_KEY = 'mechanica.recent.components';
function noteRecentUse(typeId) {
  try {
    let list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((x) => x !== typeId);
    list.unshift(typeId);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
    renderCatalog();
    $('catalogSearch').value = catalogFilter;   // renderCatalog 后恢复搜索词
  } catch { /* 隐私模式静默 */ }
}
const FAV_KEY = 'mechanica.favorites.components';
function favoriteComponents() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]').filter((x) => { try { registry.getComponent(x); return true; } catch { return false; } }); }
  catch { return []; }
}
function toggleFavorite(typeId) {
  try {
    let list = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    list = list.includes(typeId) ? list.filter((x) => x !== typeId) : [...list, typeId];
    localStorage.setItem(FAV_KEY, JSON.stringify(list));
    renderCatalog();
  } catch { /* 静默 */ }
}
function recentComponents() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((x) => { try { registry.getComponent(x); return true; } catch { return false; } }); }
  catch { return []; }
}
let catalogFilter = '';
let textReqHistory = [];     // Agent 文字框提交历史（↑ 取回）
let textReqHistPos = null;
function opUpdateEntity(id, patch, label, { rebuild = true, rerender = true } = {}) {
  const e = getEntity(doc, id);
  if (!e) return false;
  updateEntity(e, patch);
  // rerender=false：数值输入编辑中，保住焦点与 DOM（change 在 blur 时才触发，重建会吞掉后续输入）
  if (rebuild) rebuildAll(rerender);
  else renderOutline();
  commitChange(label);
  if (!rebuild && rerender) renderInspector();
  return true;
}
function opRemoveEntity(id) {
  const targets = selectedIds.includes(id) && selectedIds.length > 1 ? [...selectedIds] : [id];
  const names = [];
  const removed = new Set();
  const queue = [...targets];
  // 级联删除（PHY-5）：attach 引用被删实体的绳/弹簧/尺/传感器一并移除（留着必悬空）
  while (queue.length) {
    const tid = queue.shift();
    if (removed.has(tid)) continue;
    const e = getEntity(doc, tid);
    if (!e) continue;
    docRemove(doc, tid);
    removed.add(tid);
    names.push(e.name);
    for (const other of [...doc.entities]) {
      if (Array.isArray(other.attach) && other.attach.includes(tid) && !removed.has(other.id)) queue.push(other.id);
    }
  }
  if (!names.length) return false;
  // 悬空 joints 清理：target 已删除的约束条目剔除（否则重建时报缺目标）
  for (const e of doc.entities) {
    if (Array.isArray(e.joints) && e.joints.some((j) => removed.has(j.target))) {
      e.joints = e.joints.filter((j) => !removed.has(j.target));
    }
  }
  selectedIds = selectedIds.filter((x) => getEntity(doc, x));
  if (!getEntity(doc, selectedId)) selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
  rebuildAll();
  commitChange('删除 ' + names.join('、') + (names.length > targets.length ? `（含 ${names.length - targets.length} 个关联对象）` : ''));
  toast(`已删除 ${names.length} 个对象，Ctrl+Z 可撤销`);
  return true;
}
function opDuplicate(id) {
  const copy = duplicateEntity(doc, id);
  if (!copy) return null;
  // 错位摆放（FEEL-2）：与原件完全重叠时副本不可见、拖走会带偏直觉
  copy.transform.pos = [copy.transform.pos[0] + 0.25, copy.transform.pos[1], copy.transform.pos[2]];
  rebuildAll();
  commitChange('复制 ' + copy.name);
  selectEntity(copy.id);
  return copy.id;
}

// ============ 时间节奏（层 4，PL-30..32；收编 FEEL-17/18、FB-25/26 一套状态机） ============
const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4];
let _slowmoSaved = null;       // Shift+Space 互切记忆（原档位）
function setSpeed(v) {
  timeScale = v;
  const sel = $('selSpeed');
  if (sel && sel.value !== String(v)) sel.value = String(v);
  _slowmoSaved = null;         // 手动换档=退出慢动作互切态
  updateSimbarStatic();
}
function speedStep(dir) {
  const i = SPEEDS.indexOf(timeScale);
  const j = Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 3 : i) + dir));
  setSpeed(SPEEDS[j]);
  toast(`时间倍率 ${SPEEDS[j]}x`);
}
function toggleSlowmo() {
  if (_slowmoSaved == null) {
    if (timeScale === 0.1) { toast('已是慢动作（0.1x）'); return; }
    _slowmoSaved = timeScale;
    timeScale = 0.1;
    $('selSpeed').value = '0.1';
    setVectors(true);          // FB-26：切入慢动作自动开速度矢量（退出不关）
    toast('慢动作 0.1x（Shift+Space 恢复）');
  } else {
    setSpeed(_slowmoSaved);
    toast(`已恢复 ${_slowmoSaved}x`);
  }
  updateSimbarStatic();
}
// 4x 需要更多物理步预算（FEEL-18/142）：>2x 时步上限 8→16，仍欠载走既有背压丢步
function maxStepsPerFrame(ts = timeScale) { return ts > 2 ? 16 : 8; }

// ============ 惊喜预算（PL-23）：自动子弹时间 ============
// B 键开关（默认关）。开启后运行态遇强碰撞（强度≥0.45）自动 0.25x 慢放 1.2s 后回原档，
// 2.5s 冷却防连环触发；不碰用户档位（临时覆盖，state().timeScale 报生效值）。
let autoBPT = false;
let _bptUntil = 0, _bptLast = 0;
let _bptEase = 0;                 // FX-581：子弹时间进出缓动 0→1（每帧向目标 lerp 0.12≈0.4s）
let _hitUntil = 0, _hitLast = 0;  // FX-532：强撞 hitstop 微顿（0.35x×60ms，独立 0.8s 冷却）
function effectiveTimeScale() {
  const hit = performance.now() < _hitUntil ? 0.35 : 1;
  return (timeScale + (0.25 - timeScale) * _bptEase) * hit;   // 子弹时间目标 0.25x（缓动过渡）
}
function maybeBulletTime(strength) {
  if (!autoBPT || mode !== 'run' || paused) return;
  const now = performance.now();
  if (now < _bptLast + 2500 || now < _bptUntil) return;   // 冷却中/已在慢放
  if (strength < 0.45 || effectiveTimeScale() !== timeScale || timeScale !== 1) return;
  _bptLast = now;
  _bptUntil = now + 1600;   // 1.2s 全速慢放 + ~0.4s 缓动入出补偿（FX-581）：保证谷底 0.25x 真正停稳
  const chip = $('modeChip');
  chip.textContent += ' · 子弹时间';
  chip.classList.add('grab');       // 同款琥珀高亮（复用 grab 反白样式）
}
// FX-532：强撞微顿——0.7 以上强击瞬间 60ms 0.35x（打击感），与子弹时间互相独立
function maybeHitstop(strength) {
  if (juice && juice.state().reducedMotion) return;   // FX-590 同口径：减动效不顿帧
  const now = performance.now();
  if (strength < 0.7 || now < _hitLast + 800 || mode !== 'run' || paused) return;
  _hitLast = now;
  _hitUntil = now + 60;
}

// ============ 模拟控制 ============
function play() {
  if (mode === 'run' && !paused) return;
  if (doc.entities.length === 0) toast('空场景：无实体可演化，从目录添加组件后再运行');
  if (mode === 'edit') perfMon.reset();   // 运行态重开预算采样窗（启动尖峰不污染）
  mode = 'run'; paused = false;
  viewport.setGizmoEnabled(false);
  $('stage').classList.add('running');   // 运行态抓手光标：可抓动态体的暗示
  sound.ui('play');
  updateSimbarStatic();
}
function pauseToggle() {
  if (mode !== 'run') return;
  paused = !paused;
  // 暂停态 gizmo 摆姿势（PL-14）：暂停=接管摆位，继续=交还运行
  viewport.setGizmoEnabled(paused && !!selectedId);
  sound.ui('pause');
  updateSimbarStatic();
}
function stepOnce() {
  if (mode === 'edit') { mode = 'run'; paused = true; viewport.setGizmoEnabled(false); perfMon.reset(); }
  runtime.stepOnce();
  updateSimbarStatic();
}
function resetSim(silent = false) {
  mode = 'edit'; paused = false;
  _beatDots.length = 0; _beatAcc.t = 0;   // FX-524：节拍点随重置清空
  viewport.setGizmoEnabled(true);
  $('stage').classList.remove('running');
  rebuildAll();                    // 全量重建 = 回到文档初始态
  sound.ui('reset');
  updateSimbarStatic();
  if (!silent) toast('已重置到初始态');   // 探针等程序化重置走 silent（AG-V）
}
function updateSimbarStatic() {
  const runDis = mode === 'run';   // UI-24：gizmo/框选是编辑态专属，运行态明确禁用
  $('btnModeMove').disabled = runDis;
  $('btnModeRotate').disabled = runDis;
  $('btnModeScale').disabled = runDis;
  $('btnBoxSel').disabled = runDis;
  $('btnSnap').disabled = runDis;
  $('btnPlay').disabled = mode === 'run' && !paused;
  setBtnText('btnPlay', mode === 'run' && paused ? '继续' : '运行');
  $('btnPlay').classList.toggle('hot', mode === 'run' && paused);
  $('btnPause').disabled = mode !== 'run';
  $('btnPause').title = mode !== 'run' ? '运行后可用' : (paused ? '恢复自动推进' : '暂停模拟（空格同）');   // UI-570
  setBtnText('btnPause', paused ? '恢复' : '暂停');   // UI-565：与 btnPlay 的「继续」区分，避免同屏双「继续」
  $('btnPause').classList.toggle('hot', mode === 'run' && paused);
  $('btnStep').disabled = false;
  $('btnReset').disabled = false;
  if (mode !== 'edit' && viewport.boxSelectMode) {
    viewport.setBoxSelect(false);
    $('btnBoxSel').classList.remove('hot');
  }
  const dropped = runtime.dropped > 0.1;   // 性能欠载透明化（UI-61）
  const chip = $('modeChip');
  chip.textContent = (mode === 'edit' ? '编辑态' : (paused ? '暂停态' : '运行态')) + (timeScale !== 1 ? ` ${timeScale}x` : '') + (dropped ? ' ⚠' : '');   // UI-571：欠载加字形不只靠变色
  chip.className = 'chip ' + (mode === 'edit' ? '' : (paused ? 'pause' : 'run')) + (dropped ? ' warn' : '');
  chip.title = dropped
    ? `性能欠载：已丢弃 ${runtime.dropped.toFixed(2)}s 模拟步（可降低时间倍率或关闭叠加层）`
    : '';
  $('inspBody').querySelectorAll('input,select').forEach((el) => { el.disabled = mode === 'run'; });
}

// ============ 顶部工具 ============
function refreshHistoryButtons() {
  $('btnUndo').disabled = !history.canUndo();
  $('btnRedo').disabled = !history.canRedo();
  $('btnUndo').title = history.canUndo() ? '撤销: ' + history.label().undo : '没有可撤销的操作';   // UI-511
  $('btnRedo').title = history.canRedo() ? '重做: ' + history.label().redo : '没有可重做的操作';
  // 撤销/重做回到「与最近一次保存完全一致」的状态 → 脏点熄灭（诚实反映保存态）
  if (lastSavedJson != null) {
    const same = serializeDoc(doc) === lastSavedJson;
    if (same && dirtySinceSave) { dirtySinceSave = false; $('dirtyDot').style.display = 'none'; document.title = `MECHANICA · ${doc.name || '未命名场景'}`; }
    else if (!same && !dirtySinceSave) { dirtySinceSave = true; $('dirtyDot').style.display = 'inline-block'; document.title = `● ${doc.name || '未命名场景'} · MECHANICA`; }
  }
}
let lastSavedJson = null;   // 最近一次入库的正文快照（undo 后对比恢复脏态）
function undo() {
  const prev = history.undo(() => serializeDoc(doc));
  if (!prev) return;
  doc = prev; autosave(); rebuildAll(); refreshHistoryButtons();
  const lb = history.label().redo;   // undo 后当前态=被撤销的那一步
  toast('已撤销: ' + (lb || ''));
}
function redo() {
  const next = history.redo(() => serializeDoc(doc));
  if (!next) return;
  doc = next; autosave(); rebuildAll(); refreshHistoryButtons();
  toast('已重做: ' + (history.label().undo || ''));
}
// ============ 场景库（SCN）：localStorage 多场景 + 改名/标签/检索/缩略图 ============
const SCENES_KEY = 'mechanica.scenes.v1';
const SCENES_CAP = 40;   // 缩略图 jpeg≈10KB/张，40 场景远在 5MB 配额内

function loadScenes() {
  try { return JSON.parse(localStorage.getItem(SCENES_KEY) || '[]'); } catch { return []; }
}
function persistScenes(list) {
  try { localStorage.setItem(SCENES_KEY, JSON.stringify(list)); } catch { toast('场景库写入失败（存储空间不足？）'); }
}

// 当前视口截图 → 160×90 jpeg 缩略图（编辑态才有意义；渲染后调用）
function snapshotThumb() {
  try {
    viewport.render();   // WebGL 默认 present 后清背缓冲：先重画一帧再取（同 btnSnapshot 的做法）
    const src = viewport.renderer.domElement;
    const cv = document.createElement('canvas');
    cv.width = 160; cv.height = 90;
    const g = cv.getContext('2d');
    // UI-595：全视口 cover 主体太小——取中央 62%（等效 1.6x 变焦）再 cover，四周留白收掉
    const Z = 0.62;
    const sx = src.width * (1 - Z) / 2, sy = src.height * (1 - Z) / 2;
    const sw = src.width * Z, sh = src.height * Z;
    const k = Math.max(cv.width / sw, cv.height / sh);
    const w = sw * k, h = sh * k;
    g.drawImage(src, sx, sy, sw, sh, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
    return cv.toDataURL('image/jpeg', 0.72);
  } catch { return null; }
}

// Agent 自动标签（用户点名「Agent 给它生成标签」）：从解析计划确定性派生——题型词+实体
// 中文标签+环境/假设关键词。不走 API，零成本可复算；入库/建场时落到 doc.tags。
const TAG_KIND_MAP = { astro: '天体', rotation: '转台', atwood: '阿特伍德', spring: '弹簧', hinge: '复摆' };
const TAG_ENV_WORDS = [['光滑', '光滑'], ['摩擦', '摩擦'], ['弹性碰撞', '弹性碰撞'], ['非弹性', '非弹性碰撞'], ['完全非弹性', '完全非弹性碰撞'], ['恢复系数', '恢复系数'], ['空气阻力', '空气阻力'], ['子弹', '子弹'], ['板块', '板块'], ['传送带', '传送带'], ['椭圆', '椭圆轨道']];
function deriveTagsFromPlan(plan) {
  const tags = [];
  const push = (t) => { if (t && !tags.includes(t) && tags.length < 6) tags.push(t); };
  if (plan.kind && TAG_KIND_MAP[plan.kind]) push(TAG_KIND_MAP[plan.kind]);
  const qt = String(plan.questionType || '');
  for (const w of ['斜面', '抛体', '平抛', '斜抛', '碰撞', '对撞', '动量', '反弹', '自由落体', '上传', '反冲', '滚动', '单摆', '转台', '引力', '轨道', '弹簧', '传送带', '追及']) {
    if (qt.includes(w)) push(w);
  }
  const typeLabels = { ramp: '斜面', sphere: '球', box: '方块', cylinder: '圆柱', celestial: '天体', conveyor: '传送带', pulley: '滑轮' };
  const types = [...new Set(plan.entities.map((e) => e.type))];
  for (const t of types) push(typeLabels[t]);
  const envAll = [plan.environment || '', ...(plan.assumptions || [])].join(' ');
  for (const [w, tag] of TAG_ENV_WORDS) if (envAll.includes(w)) push(tag);
  return tags;
}

// 保存入库：upsert（按 doc.sceneId 绑定）；未入库过→新条目。返回条目 id。
function saveToLibrary() {
  if (mode !== 'edit') resetSim(true);   // 缩略图要编辑态画面：运行态保存先静默重置
  if (!doc.sceneId) doc.sceneId = 'scn-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const list = loadScenes();
  const now = Date.now();
  const entry = {
    id: doc.sceneId,
    name: doc.name || '未命名场景',
    tags: [...(doc.tags || [])],
    thumb: snapshotThumb(),
    updatedAt: now,
    entityCount: doc.entities.length,
    source: (doc.meta && doc.meta.source) || 'user',
  };
  const i = list.findIndex((x) => x.id === entry.id);
  if (i >= 0) {
    entry.saveCount = (list[i].saveCount || 0) + 1;
    list[i] = { ...list[i], ...entry };
  } else {
    entry.saveCount = 1;
    list.unshift(entry);
  }
  if (list.length > SCENES_CAP) {
    const removed = list.splice(SCENES_CAP).map((x) => x.name);
    toast('场景库超上限，最旧的已让位：' + removed.join('、'));
  }
  persistScenes(list);
  doc.savedAt = now;
  markSaved();
  if (entry.name === '未命名场景') setTimeout(() => toast('提示：场景还叫「未命名场景」——顶部点一下名字即可改名'), 1900);
  autosave();
  const tagNote = entry.tags.length ? '，标签 ' + entry.tags.map((t) => '#' + t).join('') : '';
  toast(i >= 0 ? `已更新场景库：「${entry.name}」${tagNote}` : `已存入场景库：「${entry.name}」${tagNote}`);
  return entry.id;
}

function exportSceneFile(d = doc) {
  const blob = new Blob([serializeDoc(d)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (d.name || '场景') + '.mechanica.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// 相对时间（库卡片 meta 行）：刚刚 / N 分钟前 / N 小时前 / 昨天前 / M月D日
function relTime(ts) {
  const dt = Date.now() - ts;
  if (dt < 60e3) return '刚刚';
  if (dt < 3600e3) return Math.floor(dt / 60e3) + ' 分钟前';
  if (dt < 86400e3) return Math.floor(dt / 3600e3) + ' 小时前';
  if (dt < 7 * 86400e3) return Math.floor(dt / 86400e3) + ' 天前';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

let libOpen = false, libQuery = '';
let libEditing = false;   // UI-606：行内改名/加标签输入进行中，跳过全量重建（否则输入被排序切换/自动刷新打断）
let libSort = (() => { try { return localStorage.getItem('mech.libSort') || 'recent'; } catch { return 'recent'; } })();   // 记住上次排序偏好
const LIB_SOURCE_LABEL = { user: '', agent: 'Agent', preset: '预置' };
function renderLibrary() {
  if (libEditing) return;
  const grid = $('libGrid');
  const q = libQuery.trim().toLowerCase();
  let list = loadScenes();
  if (q) list = list.filter((x) => x.name.toLowerCase().includes(q) || (x.tags || []).some((t) => t.toLowerCase().includes(q)));
  if (libSort === 'recent') list.sort((a, b) => b.updatedAt - a.updatedAt);
  else if (libSort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  else list.sort((a, b) => (b.entityCount || 0) - (a.entityCount || 0));
  const emptyEl = $('libEmpty');
  if (!list.length) {
    emptyEl.style.display = 'block';
    // UI-594：搜索无匹配不再误报「库里还没有场景」
    emptyEl.textContent = q ? `没有匹配「${libQuery.trim()}」的场景` : '库里还没有场景——布好场景后点「保存」入库（自动生成缩略图与标签）';
  } else {
    emptyEl.style.display = 'none';
  }
  grid.innerHTML = '';
  const curId = doc.sceneId;
  const firstHit = q ? 0 : -1;   // UI-601：搜索时首卡描边=回车目标（list 已按 q 过滤，首位即命中）
  list.forEach((sc, i) => {
    const card = document.createElement('div');
    card.className = 'lib-card' + (sc.id === curId ? ' on' : '') + (i === firstHit ? ' enter-hint' : '');
    const src = LIB_SOURCE_LABEL[sc.source] ? ` · ${LIB_SOURCE_LABEL[sc.source]}` : '';
    card.innerHTML = `
      ${sc.thumb ? `<img class="thumb" alt="" loading="lazy">` : `<div class="thumb" style="display:flex;align-items:center;justify-content:center;color:var(--faint);font-size: 11px">无缩略图</div>`}
      <div class="bd">
        <div class="nm" title="双击改名">${sc.id === curId ? '▶ ' : ''}</div>
        <div class="chips"></div>
        <div class="meta">${sc.entityCount || 0} 实体 · 存过 ${sc.saveCount || 1} 次 · ${relTime(sc.updatedAt)}${src}</div>
        <div class="ops">
          <button class="op-open">打开</button>
          <button class="op-dup" title="复制为一个新场景">副本</button>
          <button class="op-export" title="下载 JSON">导出</button>
          <button class="op-del danger" title="删除（需确认）">删除</button>
        </div>
      </div>`;
    card.ondblclick = (ev) => {
      if (ev.target.closest('button') || ev.target.closest('input') || ev.target.closest('.chips')) return;
      openScene();
    };
    const nm = card.querySelector('.nm');
    nm.appendChild(document.createTextNode(sc.name));
    const img = card.querySelector('img.thumb');
    if (img) { img.src = sc.thumb; img.title = '点击打开「' + sc.name + '」（双击卡片同）'; img.alt = `场景 ${sc.name} 缩略图`; }   // UI-600
    // 标签 chips：x 移除；+加标签（Enter 提交）
    const chips = card.querySelector('.chips');
    for (const t of sc.tags || []) {
      const c = document.createElement('span');
      c.className = 'chip-tag';
      c.textContent = '#' + t;
      const x = document.createElement('span');
      x.className = 'x';
      x.textContent = '×';
      x.title = '移除标签 ' + t;
      x.onclick = () => { sc.tags = sc.tags.filter((y) => y !== t); persistScenes(loadScenes().map((y) => (y.id === sc.id ? sc : y))); if (sc.id === curId) { doc.tags = [...sc.tags]; } renderLibrary(); };
      c.appendChild(x);
      chips.appendChild(c);
    }
    const add = document.createElement('button');
    add.className = 'chip-add';
    add.textContent = '+标签';
    add.title = '给这个场景加标签（Enter 提交）';
    add.onclick = () => {
      const inp = document.createElement('input');
      inp.placeholder = '标签名';
      libEditing = true;   // UI-606：加标签中冻结库重渲
      inp.style.cssText = 'width:64px;background:rgba(0,0,0,.3);border:1px solid rgba(217,164,65,.55);border-radius:2px;color:var(--text);font-size: 11px;padding:1px 4px';
      inp.onkeydown = (ev) => {
        if (ev.key === 'Enter') {
          const v = inp.value.trim().slice(0, 12);
          if (v && !(sc.tags || []).includes(v)) {
            sc.tags = [...(sc.tags || []), v];
            persistScenes(loadScenes().map((y) => (y.id === sc.id ? sc : y)));
            if (sc.id === curId) doc.tags = [...sc.tags];
          }
          libEditing = false;
          renderLibrary();
        } else if (ev.key === 'Escape') { libEditing = false; renderLibrary(); }
      };
      add.replaceWith(inp);
      inp.focus();
    };
    chips.appendChild(add);
    // 操作
    const openScene = () => {
      const full = loadScenes().find((x) => x.id === sc.id);
      const all = loadScenes();
      if (!all.find((x) => x.id === sc.id)) { toast('场景已不在库中'); renderLibrary(); return; }
      openSceneById(sc.id);
    };
    card.querySelector('.op-open').onclick = openScene;
    if (img) img.onclick = openScene;
    card.querySelector('.op-dup').onclick = () => {
      const nid = 'scn-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const all = loadScenes();
      const srcCard = all.find((x) => x.id === sc.id);
      all.unshift({ ...srcCard, id: nid, name: sc.name + ' 副本', updatedAt: Date.now() });
      persistScenes(all);
      toast(`已创建副本「${sc.name} 副本」`);
      renderLibrary();
    };
    card.querySelector('.op-export').onclick = async () => {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      // 导出库条目对应的完整文档：库只存元数据，正文以当前打开为准；未打开的用自动存档兜底
      if (sc.id === doc.sceneId) { exportSceneFile(doc); return; }
      exportSceneFile({ ...deserializeDoc(raw || '{}'), name: sc.name, sceneId: sc.id });
    };
    const del = card.querySelector('.op-del');
    del.onclick = () => {
      if (del.dataset.armed) {
        persistScenes(loadScenes().filter((x) => x.id !== sc.id));
        if (sc.id === doc.sceneId) doc.sceneId = null;
        renderLibrary();
        toast(`已删除「${sc.name}」`);
      } else {
        del.dataset.armed = '1';
        del.textContent = '确认删?';
        setTimeout(() => { if (del.isConnected) { del.dataset.armed = ''; del.textContent = '删除'; } }, 2600);
      }
    };
    // 双击改名（行内输入）
    nm.ondblclick = () => {
      const inp = document.createElement('input');
      inp.value = sc.name;
      libEditing = true;   // UI-606：改名中冻结库重渲
      inp.onkeydown = (ev) => {
        if (ev.key === 'Enter') {
          const v = inp.value.trim().slice(0, 40) || sc.name;
          const all = loadScenes();
          const target = all.find((x) => x.id === sc.id);
          if (target) { target.name = v; persistScenes(all); }
          if (sc.id === curId) { doc.name = v; setSceneNameInput(v); }
          libEditing = false;
          renderLibrary();
        } else if (ev.key === 'Escape') { libEditing = false; renderLibrary(); }
      };
      inp.onblur = () => { libEditing = false; renderLibrary(); };
      nm.textContent = '';
      nm.appendChild(inp);
      inp.focus();
      inp.select();
    };
    grid.appendChild(card);
  });
}
function openSceneById(id) {
  // 库条目只存元数据；正文 = 当前正在编辑的同一场景（sceneId 绑定）→ 已经是它就不动；
  // 否则从场景库正文库（=各场景的自动存档快照）恢复：场景正文快照随每次 autosave 按 sceneId 存
  const snaps = loadSceneSnaps();
  const snap = snaps[id];
  if (snap) {
    applyDoc(deserializeDoc(snap), '打开场景');
    setSceneNameInput(doc.name);
    markSaved();
    closeLibrary();
    toast(`已打开「${doc.name}」（${doc.entities.length} 实体）`);
  } else if (id === doc.sceneId) {
    closeLibrary();
    toast('这就是当前场景');
  } else {
    toast('场景正文缺失（旧条目）——保留元数据，可删除');
  }
}
// 场景正文快照：sceneId → serializeDoc（autosave 时同步写，库的打开才有所指）
const SCENE_SNAPS_KEY = 'mechanica.scene-snaps.v1';
function loadSceneSnaps() {
  try { return JSON.parse(localStorage.getItem(SCENE_SNAPS_KEY) || '{}'); } catch { return {}; }
}
function saveSceneSnap() {
  if (!doc.sceneId) return;
  try {
    const snaps = loadSceneSnaps();
    snaps[doc.sceneId] = serializeDoc(doc);
    // 快照库只保留现有场景条目引用的正文（条目删除后正文一并回收）
    const ids = new Set(loadScenes().map((x) => x.id));
    for (const k of Object.keys(snaps)) if (!ids.has(k)) delete snaps[k];
    localStorage.setItem(SCENE_SNAPS_KEY, JSON.stringify(snaps));
  } catch { /* 空间不足静默：自动存档仍是主通道 */ }
}

let libOpener = null;   // UI-590：关库还焦点给打开者
function openLibrary() {
  libOpen = true;
  libOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $('sceneLib').style.display = 'block';
  $('libSearch').value = libQuery;
  renderLibrary();
  $('libSearch').focus();
}
function closeLibrary() {
  libOpen = false;
  $('sceneLib').style.display = 'none';
  if (libOpener) { libOpener.focus(); libOpener = null; }
}
// UI-590：Tab 圈限在弹层内
$('sceneLib').addEventListener('keydown', (ev) => {
  if (ev.key !== 'Tab') return;
  const f = $('sceneLib').querySelectorAll('button, [href], input, select, [tabindex="0"]');
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
  else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
});

// 脏跟踪：任何 commitChange（=文档变了）→ 脏；保存/打开/新建入库动作 → 清
let dirtySinceSave = false;
function markDirty() {
  if (dirtySinceSave) return;
  dirtySinceSave = true;
  $('dirtyDot').style.display = 'inline-block';
  document.title = `● ${doc.name || '未命名场景'} · MECHANICA`;
}
function markSaved() {
  dirtySinceSave = false;
  lastSavedJson = serializeDoc(doc);
  $('dirtyDot').style.display = 'none';
  document.title = `MECHANICA · ${doc.name || '未命名场景'}`;
}

function saveFile() {
  saveToLibrary();
  saveSceneSnap();
  const bs = $('btnSave');
  // UI-501：图标钮不能 textContent 交换「已存」（会抹掉软盘图标且复原成空）——琥珀脉冲代替
  if (bs.querySelector('svg')) {
    bs.classList.remove('ok-flash');
    void bs.offsetWidth;   // 重启动画
    bs.classList.add('ok-flash');
    setTimeout(() => bs.classList.remove('ok-flash'), 900);
  } else {
    const prev = bs.textContent;
    bs.textContent = '已存';
    setTimeout(() => { bs.textContent = prev; }, 900);
  }
}
function openFile(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      applyDoc(deserializeDoc(String(r.result)), '打开场景');
      setSceneNameInput(doc.name);
      markSaved();
      autosave(); saveSceneSnap();
      toast(`场景已载入：「${doc.name}」（${doc.entities.length} 实体）——「保存」将继续更新它在库里的条目`);
    } catch (e) {
      toast('打开失败: ' + e.message);
    }
  };
  r.readAsText(file);
}

// ============ UI 绑定 ============
function bindUI() {
  $('btnNew').onclick = () => { applyDoc(createEmptyDoc('未命名场景'), '新建'); setSceneNameInput(doc.name); agentPatchRounds = 0; markSaved(); };
  // 预置下拉单源化（MDL-41）：选项由 PRESETS 自动生成，消除 index.html 手写双份漂移；
  // 分组只做归类，未列出的预置自动落「更多」组
  const PRESET_GROUPS = [
    ['基础经典', ['incline', 'momentum', 'momentum2d', 'projectile', 'classic', 'celestial', 'spin', 'atwood', 'hingePend']],
    ['振动', ['pendulum', 'conical', 'vertCircle', 'springSHM', 'springVert', 'coupled', 'springGun']],
    ['碰撞', ['collLab', 'bulletBlock', 'newtonCradle', 'ballChain', 'bounceCompare', 'blockOnBlock']],
    ['抛体对照', ['galileoDrop', 'rangeAngles']],
    ['转动·摩擦', ['rollRace', 'frictionLock', 'atwoodHeavy']],
    ['天体', ['binaryStar', 'threeBody']],
  ];
  const selPreset = $('selPreset');
  {
    const grouped = new Map(PRESET_GROUPS.map(([g]) => [g, []]));
    grouped.set('更多', []);
    for (const [id, p] of Object.entries(PRESETS)) {
      if (id === 'empty') continue;                       // 空场景走「新建」，不进下拉
      const g = PRESET_GROUPS.find(([, ids]) => ids.includes(id));
      grouped.get(g ? g[0] : '更多').push([id, p.label]);
    }
    const frag = document.createDocumentFragment();
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = '预置场景';
    frag.appendChild(ph);
    for (const [g, items] of grouped) {
      if (!items.length) continue;
      const og = document.createElement('optgroup');
      og.label = g;
      for (const [id, label] of items) {
        const o = document.createElement('option');
        o.value = id; o.textContent = label;
        o.title = (PRESETS[id] && PRESETS[id].desc) || label;   // 悬停预览这个预置讲什么
        og.appendChild(o);
      }
      frag.appendChild(og);
    }
    selPreset.innerHTML = '';
    selPreset.appendChild(frag);
  }
  // UI-512：Windows Chrome 关闭态下拉方向键每移一项就触发 change=连续 applyDoc 重建世界。
  // 关闭态方向键只移高亮不载入（弹层打开时按键被弹层吞掉，不会进到这里）；Enter 开弹层原生可用
  $('selPreset').onkeydown = (ev) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const sel = ev.target;
    const opts = sel.options;
    const dir = ev.key === 'ArrowDown' ? 1 : -1;
    let i = sel.selectedIndex + dir;
    while (i >= 0 && i < opts.length && opts[i].disabled) i += dir;
    if (i < 0 || i >= opts.length) return;
    sel.selectedIndex = i;
    if (opts[i].title) sel.title = opts[i].title;
  };
  $('selPreset').onchange = (e) => {
    const picked = e.target.value;
    e.target.value = '';   // 立刻回占位：同一条预置可反复重选（否则选同项不再触发 change）
    if (!picked) return;
    applyDoc(getPreset(picked), '载入预置');
    markSaved();
    setSceneNameInput(doc.name);
    if (picked === 'momentum') { setVectors(true); setCons(true); }   // 教学默认开叠加层
    if (picked === 'celestial') { setTrails(true); setCons(true); }
    if (picked === 'spin') { setVectors(true); setTrails(true); setCons(true); }
    if (picked === 'classic') { setVectors(true); setTrails(true); setCons(true); }
    if (picked === 'atwood') {
      setVectors(true); setCons(true);
      const pl = doc.entities.find((x) => x.type === 'pulley');   // 滑轮在 y=3，载入后聚焦
      if (pl && runtime.binds.has(pl.id)) viewport.focus(runtime.binds.get(pl.id).mesh);
    }
    // R2 新预置的教学默认叠加层：振动/轨道类开轨迹+守恒，碰撞类开矢量+守恒
    if (/^(pendulum|conical|vertCircle|springSHM|springVert|coupled|galileoDrop|rangeAngles|bounceCompare|binaryStar|threeBody|ballChain|newtonCradle)$/.test(e.target.value)) { setTrails(true); setCons(true); }
    if (/^(collLab|bulletBlock|blockOnBlock)$/.test(e.target.value)) { setVectors(true); setCons(true); }
    e.target.value = '';
  };
  $('btnSave').onclick = saveFile;
  $('btnUndo').onclick = undo;
  $('btnRedo').onclick = redo;

  $('btnModeMove').onclick = () => setGizmoMode('translate');
  $('btnModeRotate').onclick = () => setGizmoMode('rotate');
  $('btnModeScale').onclick = () => setGizmoMode('scale');
  $('btnOrtho').onclick = () => {
    const proj = viewport.toggleProjection();
    $('btnOrtho').classList.toggle('hot', proj === 'ortho');
  };
  // 网格显隐（截图/近景演示时不想要背景格）——偏好记忆
  {
    let gridOn = true;
    try { gridOn = localStorage.getItem('mech.grid') !== '0'; } catch { /* 隐私模式默认开 */ }
    const btnGrid = $('btnGrid');
    btnGrid.classList.toggle('hot', gridOn);
    viewport.setGridVisible(gridOn);
    btnGrid.onclick = () => {
      gridOn = !gridOn;
      viewport.setGridVisible(gridOn);
      btnGrid.classList.toggle('hot', gridOn);
      updateScaleReadout();   // UI-604：网格关了读数别再写「1 格 = N m」失真信息
      try { localStorage.setItem('mech.grid', gridOn ? '1' : '0'); } catch { /* 静默 */ }
    };
  }
  $('btnRec').onclick = () => toggleFrameRec();
  $('btnReplay').onclick = () => startReplay();
  // 回放时间轴：拖动中暂停自动推进、松手继续（拖动即逐帧 scrub）
  {
    const bar = $('replayBar');
    bar.addEventListener('input', () => {
      if (!replaying) return;
      scrubbing = true;
      replayIdx = Math.min(+bar.value, runtime.frames.length - 1);
      runtime.applyFrame(replayIdx);
      updateReplayFrameReadout();   // UI-567：拖动逐帧也有读数
      viewport.markDirty();
    });
    bar.addEventListener('change', () => { scrubbing = false; _replayAcc = 0; });
  }
  $('btnBoxSel').onclick = () => {
    if (mode !== 'edit') { toast('框选仅编辑态可用'); return; }
    const on = !viewport.boxSelectMode;
    viewport.setBoxSelect(on);
    $('btnBoxSel').classList.toggle('hot', on);
  };
  $('btnSnap').onclick = () => cycleSnap();
  // UI-508：视角切换瞬时脉冲反馈（不改布局，hot 样式一闪）
  const viewPulse = (btn, fn) => () => {
    fn();
    btn.classList.add('hot');
    setTimeout(() => btn.classList.remove('hot'), 160);
  };
  $('btnViewReset').onclick = viewPulse($('btnViewReset'), () => viewport.resetView());
  $('btnViewTop').onclick = viewPulse($('btnViewTop'), () => viewport.setViewPreset('top'));
  $('btnViewFront').onclick = viewPulse($('btnViewFront'), () => viewport.setViewPreset('front'));
  $('btnViewSide').onclick = viewPulse($('btnViewSide'), () => viewport.setViewPreset('side'));
  $('btnFocus').onclick = () => viewport.focusOn(selectedId ? runtime.binds.get(selectedId).mesh : null);
  // R6-F3：Home 键移除后全景取景的 UI 入口（双击=全部实体入画；单击聚焦不变）
  $('btnFocus').ondblclick = () => { viewport.focusScene(); toast('全景取景'); };
  // U-FLY 自由漫游：按钮切换，状态回写热态
  $('btnFly').onclick = () => viewport.setFlyMode(!(viewport._fly && viewport._fly.on));   // 常驻热态由 onFlyChange 管（viewPulse 的 160ms 移除会打架）
  viewport.onFlyChange = (on) => { $('btnFly').classList.toggle('hot', on); toast(on ? '漫游：WASD 平移 / Q E 升降 / 拖拽转视角 / Esc 退出' : '已回到轨道视角'); };
  // R6-F5 内置录屏：REC 切换——主视口 + Agent 字幕 + 原题图角标 合成为 WebM 下载
  $('btnRec').onclick = async () => {
    if (recorder.active) {
      const blob = await recorder.stop();
      if (blob && blob.size > 1024) {
        const name = recorder.saveBlob(blob);
        toast(`录像已保存 ${name}（${(blob.size / 1048576).toFixed(1)} MB）`);
      } else toast('录像为空（时长过短或编码不可用）', true);
      $('btnRec').classList.remove('rec');
      return;
    }
    const r = recorder.start(viewport.renderer.domElement);
    if (!r.ok) { toast(r.reason === 'busy' ? '已在录制中' : '此浏览器不支持内置录屏（需 MediaRecorder/WebM）', true); return; }
    recorder.caption('开始录屏');
    $('btnRec').classList.add('rec');
    toast('开始录屏：再点一次结束并自动下载 WebM');
  };
  // R6-F3：B 键移除后子弹时间的 UI 入口（simbar 开关钮）
  {
    const bb = $('btnBpt');
    if (bb) {
      const syncBpt = () => bb.classList.toggle('hot', autoBPT);
      bb.onclick = () => {
        autoBPT = !autoBPT;
        syncBpt();
        toast(autoBPT ? '自动子弹时间开：强碰撞自动 0.25x 慢放' : '自动子弹时间关');
      };
      syncBpt();
    }
  }

  $('btnPlay').onclick = play;
  $('btnPause').onclick = pauseToggle;
  $('btnStep').onclick = stepOnce;
  $('btnReset').onclick = resetSim;
  $('selSpeed').onchange = (e) => { setSpeed(parseFloat(e.target.value) || 1); };
  $('btnVectors').onclick = () => setVectors(!vectorsOn);
  $('btnForces').onclick = () => setForces(!forcesOn);
  $('btnDecompose').onclick = () => {
    if (!forcesOn) { toast('先开启"受力"再切换分解'); return; }
    viewport.setForceDecompose(!viewport.decompose);
    $('btnDecompose').classList.toggle('hot', viewport.decompose);
  };
  $('btnTrails').onclick = () => setTrails(!trailsOn);
  $('btnCurves').onclick = () => setCurves(!curvesOn);
  $('curveTabMotion').onclick = () => setCurveMode('motion');
  $('curveTabEnergy').onclick = () => setCurveMode('energy');
  $('btnCons').onclick = () => setCons(!consOn);
  $('btnPerf').onclick = () => setPerfHud(!perfHudOn);
  $('btnSound').onclick = () => { sound.unlock(); setSound(sound.muted); };
  setSound(!sound.muted);
  $('btnShake').onclick = () => setShake(!(juice && juice.shakeOn));
  // 视口截图（PNG）：preserveDrawingBuffer 未开时必须当场渲染一帧再取——渲染即得，不依赖脏区状态
  $('btnSnapshot').onclick = () => {
    viewport.render();   // 当场出一帧（preserveDrawingBuffer 未开，取前必须现渲）
    const url = viewport.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.name || '场景'}-${new Date().toISOString().slice(5, 16).replace('T', '_')}.png`;
    a.click();
    toast('已保存视口截图（下载）');
  };

  $('sceneName').onchange = (e) => { doc.name = e.target.value || '未命名场景'; e.target.value = doc.name; e.target.title = doc.name; autosave(); markDirty(); };   // UI-503 title 同步
  // 改名体验（SCN）：聚焦全选（改名高频，双击手选太磨）；Esc 还原未提交改动；空名回落原名
  $('sceneName').onfocus = (e) => { e.target.dataset.prev = e.target.value; requestAnimationFrame(() => e.target.select()); };
  $('sceneName').onkeydown = (e) => {
    if (e.key === 'Escape') { e.target.value = e.target.dataset.prev || doc.name; e.target.blur(); }
    if (e.key === 'Enter') e.target.blur();   // 回车=提交改名
  };
  $('sceneName').onblur = (e) => { if (e.target.value.trim() === '') e.target.value = doc.name; };
  $('helpOverlay').addEventListener('keydown', (ev) => {   // UI-589：Tab 圈限在弹层内
    if (ev.key !== 'Tab') return;
    const focusables = $('helpOverlay').querySelectorAll('button, [href], input, [tabindex="0"]');
    if (!focusables.length) { ev.preventDefault(); return; }
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  });
  $('dirtyDot').style.cursor = 'pointer';
  $('dirtyDot').onclick = () => saveFile();   // 点脏点=顺手保存（所见即所按）
  $('dirtyDot').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); saveFile(); } };   // UI-505 键盘可达
  $('btnHelpQuick').onclick = () => toggleHelp();

  const osb = document.getElementById('outlineSearch');
  if (osb) {
    osb.oninput = (e) => { outlineQuery = e.target.value; renderOutline(); };
    osb.onkeydown = (e) => {   // UI-603：对齐目录框——Esc 清词，空词再冒泡
      if (e.key === 'Escape' && osb.value) { e.stopPropagation(); osb.value = ''; outlineQuery = ''; renderOutline(); }
    };
  }
  $('catalogSearch').oninput = (e) => {
    catalogFilter = e.target.value;
    const pos = e.target.selectionStart;
    renderCatalog();
    const inp = $('catalogSearch');
    inp.value = catalogFilter;
    inp.setSelectionRange(pos, pos);
  };
  $('catalogSearch').onkeydown = (e) => {
    if (e.key === 'Enter' && catalogFilter.trim()) {
      // 放置第一个命中卡片（点目录行同一条链）；Shift+Enter=收藏它
      const first = $('catalogList').querySelector('.comp-item');
      if (first) {
        first.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
        first.click();
        e.target.blur();
      }
    }
  };
  $('tabInspector').onclick = () => selectTab('inspector');
  $('tabAgent').onclick = () => selectTab('agent');
  bindAgentPanel();

  // 「打开」唯一入口=场景库（文件导入走库内「导入文件」）
  $('btnOpen').onclick = () => openLibrary();
  // 场景库弹层内交互（SCN）
  $('libClose').onclick = closeLibrary;
  $('sceneLib').addEventListener('mousedown', (ev) => { if (ev.target === $('sceneLib')) closeLibrary(); });
  $('libSearch').oninput = (e) => { libQuery = e.target.value; renderLibrary(); };
  $('libSearch').onkeydown = (ev) => {
    if (ev.key === 'Enter') {
      const first = $('libGrid').querySelector('.lib-card .op-open');
      if (first) first.click();
      else toast('没有匹配的场景');
    } else if (ev.key === 'Escape') {
      // 两段式：有词先清词，空词才关库（手滑 Esc 不丢检索语境）
      if ($('libSearch').value) { $('libSearch').value = ''; libQuery = ''; renderLibrary(); }
      else closeLibrary();
    }
  };
  $('libSort').title = '排序方式（偏好会记住）';
  $('libSort').onchange = (e) => { libSort = e.target.value; try { localStorage.setItem('mech.libSort', libSort); } catch { /* 隐私模式 */ } renderLibrary(); };
  $('libExportCurrent').title = '把当前场景下载为 JSON 文件（与库条目无关，随时可用）';
  $('libExportCurrent').onclick = () => { exportSceneFile(); toast('已导出当前场景 JSON：' + (doc.name || '未命名场景')); };
  {
    const lfi = document.createElement('input');
    lfi.type = 'file'; lfi.accept = '.json,application/json'; lfi.style.display = 'none';
    lfi.onchange = () => { if (lfi.files[0]) openFile(lfi.files[0]); lfi.value = ''; };
    document.body.appendChild(lfi);
    $('libImport').onclick = () => lfi.click();
  }

  window.addEventListener('keydown', onKey);
  // 滚轮误触防护（FEEL-1）：聚焦 number 输入后滑动滚轮会悄悄改值，教学场景高频误操作
  document.addEventListener('wheel', (ev) => {
    const t = ev.target;
    if (t && t.tagName === 'INPUT' && t.type === 'number') ev.preventDefault();
  }, { passive: false });

  renderCatalog();
  refreshHistoryButtons();
}

// ============ 吸附类型（gizmo 释放时修正位置） ============
let snapMode = 'grid';   // off | grid | endpoint | surface | center
const SNAP_SEQ = ['off', 'grid', 'endpoint', 'surface', 'center'];
const SNAP_LABEL = { off: '吸附:关', grid: '吸附:网格', endpoint: '吸附:端点', surface: '吸附:表面', center: '吸附:中心' };

function cycleSnap() {
  snapMode = SNAP_SEQ[(SNAP_SEQ.indexOf(snapMode) + 1) % SNAP_SEQ.length];
  viewport.setSnap(snapMode === 'grid');
  viewport.setGhostSnapMode(snapMode);   // ghost 跟随联动同一吸附档位
  const btn = $('btnSnap');
  btn.classList.toggle('hot', snapMode !== 'off');
  setBtnText('btnSnap', SNAP_LABEL[snapMode]);
  toast(SNAP_LABEL[snapMode] + '（拖动 gizmo 释放时生效）');
}

function applySnapToMesh(mesh) {
  if (snapMode === 'off' || !mesh) return;
  const p = mesh.position;
  const others = [];
  for (const [id, b] of runtime.binds) {
    if (id === selectedId || !b.mesh) continue;
    others.push({ pos: b.mesh.position, mesh: b.mesh, id });
  }
  if (snapMode === 'endpoint') {
    let best = null, bd = 0.0625;   // 0.25m 平方
    for (const o of others) {
      const box = new THREE.Box3().setFromObject(o.mesh);
      for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
        const d = (p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2;
        if (d < bd) { bd = d; best = [cx, cy, cz]; }
      }
    }
    if (best) p.set(best[0], best[1], best[2]);
  } else if (snapMode === 'surface') {
    let bestTop = null;
    for (const o of others) {
      const box = new THREE.Box3().setFromObject(o.mesh);
      if (p.x >= box.min.x - 0.05 && p.x <= box.max.x + 0.05 && p.z >= box.min.z - 0.05 && p.z <= box.max.z + 0.05) {
        if (box.max.y <= p.y + 0.05 && (bestTop === null || box.max.y > bestTop)) bestTop = box.max.y;
      }
    }
    if (bestTop !== null) p.y = bestTop + meshHalfHeight(mesh);
  } else if (snapMode === 'center') {
    let best = null, bd = 0.09;   // 0.3m 平方
    for (const o of others) {
      const d = (p.x - o.pos.x) ** 2 + (p.z - o.pos.z) ** 2;
      if (d < bd) { bd = d; best = o.pos; }
    }
    if (best) { p.x = best.x; p.z = best.z; }
  }
}

function meshHalfHeight(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  return Math.max((box.max.y - box.min.y) / 2, 0.01);
}

function setGizmoMode(m) {
  if (mode === 'run') return;
  viewport.setGizmoMode(m);
  $('btnModeMove').classList.toggle('hot', m === 'translate');
  $('btnModeRotate').classList.toggle('hot', m === 'rotate');
  $('btnModeScale').classList.toggle('hot', m === 'scale');
}

function onKey(e) {
  const tag = (e.target && e.target.tagName) || '';
  if (!appReady) return;
  // 保存/打开是全局应急键：在输入框里打字时也要能用（改完名直接 Ctrl+S 顺手存）
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'o')) {
    e.preventDefault();
    if (e.key.toLowerCase() === 's') saveFile(); else openLibrary();
    return;
  }
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
    else if (k === 's') { e.preventDefault(); saveFile(); }
    else if (k === 'o') { e.preventDefault(); openLibrary(); }
    else if (k === 'd') { e.preventDefault(); if (selectedId) opDuplicate(selectedId); }
    return;
  }
  if (e.key === '?' || e.key === 'F1') {
    e.preventDefault();
    toggleHelp();   // UI-616：F1 同 ?（教学演示时投影上直接按 F1）
    return;
  }
  if (e.code === 'Escape') {
    if (document.body.classList.contains('erropen')) { hideErr(); return; }   // UI-615：错误条进 Esc 关闭链（最先；判定走类，inline display 初始是空串不可靠）
    if (libOpen) { closeLibrary(); return; }
    if (document.activeElement === $('catalogSearch') && catalogFilter) { $('catalogSearch').value = ''; catalogFilter = ''; renderCatalog(); return; }
    if (viewport.gizmo.dragging) { viewport.gizmo.reset(); viewport.markDirty(); return; }   // FZ-57：拖错当场 Esc 弹回，不产生提交
    const help = $('helpOverlay');
    if (help.classList.contains('on')) { toggleHelp(); return; }
    if (viewport.boxSelectMode) { viewport.setBoxSelect(false); $('btnBoxSel').classList.remove('hot'); return; }
    viewport.hideGhost();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (e.shiftKey) { if (mode === 'run' && !paused) toggleSlowmo(); }
    else mode === 'run' ? pauseToggle() : play();
    // FX-557：键盘触发与鼠标点击同款按钮反馈（100ms 脉冲——盲操作也能看见状态切了）
    {
      const btn = mode === 'run' && !paused ? $('btnPause') : $('btnPlay');
      if (btn) { btn.classList.add('ok-flash'); setTimeout(() => btn.classList.remove('ok-flash'), 100); }
    }
  }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); speedStep(-1); }
  else if (e.key === '=' || e.key === '+') { e.preventDefault(); speedStep(1); }
  else if (e.code === 'Period') {
    // FEEL-17/112 收编：`.` 单步——运行暂停态直接推进；编辑态与单步按钮同语义
    if (mode !== 'run' || paused) { e.preventDefault(); stepOnce(); }
  }
  else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {   // FZ-2：ghost 放置预览旋转
    if (viewport.ghostState().visible) {
      e.preventDefault();
      viewport.ghostRotate((e.code === 'BracketRight' ? 1 : -1) * (e.shiftKey ? 90 : 15));
    }
  }
  // R6-F3 快捷键收缩：删除 1/2/3 倍率档(selSpeed 下拉与 -/= 已覆盖)、W/E(gizmo 模式按钮
  // 已有)、F(聚焦按钮+双击实体已有)、Home(改为 btnFocus 双击)、B(子弹时间改 simbar 开关
  // 钮)、P(图钉改检查器运行态按钮)。功能全保留——只收敛隐蔽快捷键,发现性走 UI。
  else if (e.code === 'KeyR') resetSim();
  else if (e.code === 'Delete' || e.code === 'Backspace') {
    if (mode === 'run' && selectedId) {
      // 运行态删除（PL-12）：只拆运行时，重置回初始文档；有关联约束的体拒绝
      if (runtime.removeLive(selectedId)) {
        selectedIds = selectedIds.filter((x) => x !== selectedId);
        selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
        viewport.setHighlights(selectedIds);
        toast('已从运行中移除（重置后恢复）');
      } else {
        toast('该实体有绳/弹簧/约束关联，运行中不可移除（可暂停后在编辑态删）');
      }
      return;
    }
    if (selectedId) opRemoveEntity(selectedId);
  }
  else if (e.code.startsWith('Arrow') && selectedId && mode === 'edit') {
    // 方向键微调（FEEL-4）：0.1m 步进，Shift=1m；写回文档走 undo 主通道
    const step = e.shiftKey ? 1 : 0.1;
    const bind = runtime.binds.get(selectedId);
    const ent = getEntity(doc, selectedId);
    if (!bind || !ent) return;
    e.preventDefault();
    const p = bind.mesh.position;
    const cand = [p.x, p.y, p.z];
    if (e.code === 'ArrowLeft') cand[0] -= step;
    else if (e.code === 'ArrowRight') cand[0] += step;
    else if (e.code === 'ArrowUp') cand[2] -= step;
    else if (e.code === 'ArrowDown') cand[2] += step;
    // 放置防穿模的挪动延伸：微调只拦「加深穿透」——允许朝逃逸方向挪出
    const curN = entityPoseBlocked(selectedId, [p.x, p.y, p.z]);
    const candN = entityPoseBlocked(selectedId, cand);
    if (candN > 0 && candN >= curN) { toast(candN >= curN && curN > 0 ? '不能加深穿透：前方与现有物体重叠' : '不能穿模：前方与现有物体重叠'); return; }
    p.set(cand[0], cand[1], cand[2]);
    viewport.applyGizmoToEntity(ent);
    rebuildAll();
    commitChange('微调 ' + ent.name);
    renderInspector();
  }
}

// ============ 左侧目录 / 大纲 ============
function addCatalogRow(box, c, faved = false) {
  const row = document.createElement('div');
  row.className = 'comp-item';
  row.innerHTML = `<div class="thumbbox"><img class="thumb" alt=""><span class="fav" title="收藏/取消收藏"></span><span class="plus">+</span></div><span class="nm"></span>`;
  {
    const d = c.defaults && c.defaults.params ? c.defaults.params : {};
    const parts = Object.entries(d).slice(0, 3).map(([k, v]) => `${k} ${v}`);
    row.title = `${c.label}——${c.desc || ''}${parts.length ? `（默认：${parts.join(' · ')}）` : ''}`;
  }
  // 缩略图：按组件真实几何离屏渲染（失败时隐藏 img，卡片退化为纯文字）
  const url = renderThumb(registry.getComponent(c.id), M);
  const img = row.querySelector('.thumb');
  if (url) img.src = url; else img.style.display = 'none';
  const fav = row.querySelector('.fav');
  fav.textContent = faved ? '★' : '☆';   // 未收藏只在悬停显形：裸「收」字读作裁断徽标（视觉门 agent/scene 取证）
  fav.classList.toggle('on', faved);
  fav.style.color = faved ? 'var(--accent-hi)' : '';
  fav.onclick = (ev) => { ev.stopPropagation(); toggleFavorite(c.id); };
  row.querySelector('.nm').textContent = c.label;
  // 兼容性提示（Goal 第六章目录条文）：物理行为/放置要求进 tooltip + 两实体类徽标（压缩略图右下角）
  {
    const dp = c.defaults && c.defaults.params ? c.defaults.params : {};
    const parts = Object.entries(dp).slice(0, 3).map(([k, v]) => `${k}=${v}`);
    const nl = String.fromCharCode(10);
    row.title = `${c.desc || c.label}${parts.length ? `${nl}【默认】${parts.join(' · ')}` : ''}` + (c.compat ? `${nl}【兼容性】${c.compat}` : '');
  }
  if (c.isLink || c.isMeasure || c.isSensor) {
    const badge = document.createElement('span');
    badge.className = 'need2';
    badge.textContent = c.isSensor ? '绑 1 实体' : '需两实体';
    row.querySelector('.thumbbox').appendChild(badge);
  }
  row.onclick = () => {
    viewport.hideGhost(); opAddComponent(c.id, {}, { resolvePlacement: true });
    // UX-audit F3：搜索框焦点残留会吃掉 Ctrl+Z（文本撤销抢在场景撤销前）——加件即还焦点
    if (document.activeElement === $('catalogSearch')) $('catalogSearch').blur();
  };
  // ghost preview（Round 27 修复：此前 showGhost 从未被调用=死代码）。
  // sticky 语义：hover 选中组件后 ghost 持续跟随鼠标（吸附档位联动），
  // 直到点击放置（hideGhost）或 hover 其他组件替换——移出目录行不消失
  row.onmouseenter = () => {
    const comp = registry.getComponent(c.id);
    if (!comp || comp.isLink) return;   // 连接类两实体语义无单体预览；保持现有 ghost 不动
    viewport.showGhost(comp);
    viewport.setGhostFollow(true);
    // UI-612：旋转/取消快捷键发现成本高——首次激活提示一次（记忆防骚扰）
    if (!viewport.__ghostHintShown) {
      viewport.__ghostHintShown = true;
      let seen = false;
      try { seen = !!localStorage.getItem('mech.ghostHint'); } catch { /* 隐私模式 */ }
      if (!seen) {
        try { localStorage.setItem('mech.ghostHint', '1'); } catch { /* 隐私模式 */ }
        toast('放置提示：[ ] 旋转预览 · 左键放置 · 右键取消', 'ok');
      }
    }
  };
  // FZ-1/13：ghost 激活期视口左键=在 ghost 位放置（点击落点即所得，不再悄悄落 n%3 槽位）；
  // 右键轻点退出放置。目录行点击仍=默认摆位放置（两条通路并存）
  viewport.cb.onGhostPlace = (pos) => {
    const comp = viewport._ghostComponent;
    if (!comp) return;
    const rot = viewport._ghost ? viewport._ghost.rotation.y : 0;
    const id = opAddComponent(comp.id, {
      transform: { pos: [+pos.x.toFixed(3), +pos.y.toFixed(3), +pos.z.toFixed(3)], rot: [0, +rot.toFixed(3), 0] },
    }, { resolvePlacement: true, ghost: true });
    if (id) {
      viewport.spawnImpact([pos.x, pos.y, pos.z]);   // FZ-4：落点环闪
      toast(`已放置 ${comp.label} @ (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`, 'ok');
      viewport.hideGhost();   // 单次放置语义（连续放置 FZ-5 另批实施）
    } else {
      // UI-609：被防穿模拦截不再纯静默（ghost 红色态之外补一句去哪里）
      const now = performance.now();
      if (now - _ghostBlockToastAt > 2500) {
        _ghostBlockToastAt = now;
        toast('该位置被占用（红色预览）——挪到空地再点放置', 'warn');
      }
    }
    // 被阻挡（id=null，放置防穿模）：ghost 留在原地（红色警示态），用户挪到空位再点——不吞掉放置意图
  };
  viewport.cb.onGhostCancel = () => viewport.hideGhost();
  box.appendChild(row);
}
let _ghostBlockToastAt = 0;   // UI-609：防穿模拦截提示节流

// 目录搜索别名（UX-audit F2 首用视角）：教师口语词汇 → 卡片标签。
// 「斜面」搜不到叫「斜坡」的卡片=首用者卡死点；双向都收。
const CATALOG_SEARCH_ALIAS = {
  斜面: ['斜坡'], 斜坡: ['斜面'], 小球: ['球'], 物块: ['方块'], 块: ['方块'],
  定滑轮: ['滑轮'], 滑轮: ['定滑轮'], 绳子: ['绳'], 弹簧绳: ['弹簧', '绳'],
};
function catalogItemMatches(c, q) {
  if (c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)) return true;
  for (const [term, alts] of Object.entries(CATALOG_SEARCH_ALIAS)) {
    if (q.includes(term) && alts.some((a) => c.label.toLowerCase().includes(a))) return true;
  }
  return false;
}

function renderCatalog() {
  const box = $('catalogList');
  const keepTop = box.scrollTop;   // 重渲（搜索/收藏/最近）不跳顶
  box.innerHTML = '';
  const q = catalogFilter.trim().toLowerCase();
  const favs = favoriteComponents();
  // 每个区块（搜索/收藏/最近/分类）的卡片集合包进同一网格容器
  const grid = () => {
    const g = document.createElement('div');
    g.className = 'cat-grid';
    box.appendChild(g);
    return g;
  };
  if (q) {
    // 搜索：跨分类平铺匹配项（带收藏切换）
    const matches = [];
    for (const cat of registry.catalog()) {
      for (const c of cat.items) if (catalogItemMatches(c, q)) matches.push(c);
    }
    const h = document.createElement('div');
    h.className = 'cat-head';
    h.textContent = `搜索结果（${matches.length}）`;   // UI-515：命中计数
    box.appendChild(h);
    const g = grid();
    for (const c of matches) addCatalogRow(g, c, favs.includes(c.id));
    if (!matches.length) {
      const none = document.createElement('div');
      none.className = 'ol-empty';
      none.textContent = '无匹配组件';
      const hint = document.createElement('div');
      hint.className = 'ol-empty';
      hint.style.color = 'var(--faint)';
      hint.textContent = '试试：斜坡 / 球 / 方块 / 弹簧 / 传送带（口语词如「斜面」会自动对上）';
      box.appendChild(none, hint);
      box.appendChild(hint);
    }
    return;
  }
  if (favs.length) {
    const h = document.createElement('div');
    h.className = 'cat-head';
    h.textContent = '收藏';
    box.appendChild(h);
    const g = grid();
    for (const typeId of favs) addCatalogRow(g, registry.getComponent(typeId), true);
  }
  const recent = recentComponents();
  if (recent.length) {
    const h = document.createElement('div');
    h.className = 'cat-head';
    h.textContent = '最近使用';
    box.appendChild(h);
    const g = grid();
    for (const typeId of recent) addCatalogRow(g, registry.getComponent(typeId), favs.includes(typeId));
  }
  for (const cat of registry.catalog()) {
    const h = document.createElement('div');
    h.className = 'cat-head';
    h.textContent = cat.label;
    box.appendChild(h);
    const g = grid();
    for (const c of cat.items) addCatalogRow(g, c, favs.includes(c.id));
  }
  renderCatalogEnvMats(box, grid);
  box.scrollTop = keepTop;
}

// 环境与材质特殊段（Goal 六目录分类建议项）：非放置组件的场景级卡——
// 重力预设改 doc.gravity（世界重建生效），材质卡给选中实体换 render.material
function renderCatalogEnvMats(box, grid) {
  const head = (t) => {
    const h = document.createElement('div');
    h.className = 'cat-head';
    h.textContent = t;
    box.appendChild(h);
  };
  // 环境：重力预设（真实作用=改当前场景重力，世界重建）
  head('环境');
  const gg = grid();
  const grav = (label, g0) => {
    const card = document.createElement('div');
    card.className = 'comp-item';
    card.innerHTML = `<div class="thumbbox"><span class="gval"></span></div><span class="nm"></span>`;
    card.querySelector('.gval').textContent = g0 === 0 ? '0' : g0;
    card.querySelector('.gval').style.cssText = 'display:flex;align-items:center;justify-content:center;height:54px;width:54px;font-family:var(--mono);font-size: 15px;color:var(--accent);background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:3px';
    card.querySelector('.nm').textContent = label;
    card.title = `把当前场景重力设为 ${g0} m/s²（${g0 === 0 ? '完全失重演示' : '行星表面重力'}）`;
    card.onclick = () => {
      window.MECH.setGravity(g0);
      toast(`重力已设为 ${g0} m/s²`);
    };
    gg.appendChild(card);
  };
  grav('地球重力', 9.81);
  grav('月球重力', 1.62);
  grav('火星重力', 3.71);
  grav('零 g', 0);
  // 材质：给选中实体换 render.material（检查器同款材质库）
  head('材质');
  const mg = grid();
  for (const mo of registry.MATERIAL_OPTIONS) {
    const card = document.createElement('div');
    card.className = 'comp-item';
    card.innerHTML = `<div class="thumbbox"><span class="mswatch"></span></div><span class="nm"></span>`;
    const sw = card.querySelector('.mswatch');
    sw.dataset.mat = mo.key;
    // 真材质球预览优先（renderMaterialSwatches 异步产物），色块仅作生成期/失败期降级
    const pv = swatchPreviews && swatchPreviews[mo.key];
    sw.style.cssText = 'display:block;height:54px;width:54px;border-radius:3px;' + (pv
      ? 'border:1px solid var(--line);background:#0c0d0f url(' + pv + ') center/cover no-repeat'
      : 'border:1px dashed var(--line-strong);background:' + (M && M[mo.key] && M[mo.key].color ? '#' + M[mo.key].color.getHexString() : 'rgba(255,255,255,.06)'));   // UI-614 降级虚线
    if (!pv) sw.title = '真实材质预览生成中…';   // UI-614
    card.querySelector('.nm').textContent = mo.label;
    // UI-526：没选中实体先给前置状态（dim+title），不再点了才 toast
    const sel = !!window.MECH.selectionState().main;
    card.classList.toggle('dim', !sel);
    card.title = sel ? `把选中实体的材质换成${mo.label}` : '先选中一个实体（点场景或大纲），再来点材质卡';
    card.onclick = () => {
      const eid = window.MECH.selectionState().main;
      if (!eid) { toast('先选中一个实体，再点材质卡'); return; }
      const e = getEntity(doc, eid);
      if (!e) return;
      e.render.material = mo.key;
      const physTxt = applyMaterialPhysics(e, mo.key);     // U-MAT：材质→物理同源套用
      opUpdateEntity(e.id, { render: e.render, physics: e.physics },
        physTxt ? `换材质为${mo.label}·套用物理（${physTxt}）` : `换材质为${mo.label}`);
      toast(`${e.name} → ${mo.label}` + (physTxt ? '（已套用材质物理）' : ''));
    };
    mg.appendChild(card);
  }
}

// 材质预览异步完成后就地补挂到已渲染的色块上（目录随后重渲时走 renderCatalogEnvMats 同步读缓存）
function refreshMaterialSwatches() {
  if (!swatchPreviews) return;
  for (const el of document.querySelectorAll('.mswatch[data-mat]')) {
    const url = swatchPreviews[el.dataset.mat];
    if (url) el.style.background = '#0c0d0f url(' + url + ') center/cover no-repeat';
  }
}

let outlineEditing = false;   // 大纲行改名中：禁止重建（重建会吞掉正在编辑的 input）

let outlineQuery = '';
function renderOutline() {
  if (outlineEditing) return;
  const box = $('outline');
  const keepTop = box.scrollTop;
  box.innerHTML = '';
  // 大纲搜索（场景对象多时找人）：简单子串匹配，命中行保留、其余隐藏
  const wrap = document.getElementById('outlineWrap');
  const sbox = document.getElementById('outlineSearch');
  if (sbox) sbox.style.display = doc.entities.length > 6 ? 'block' : 'none';
  const oq = outlineQuery.trim().toLowerCase();
  const olPass = (e) => !oq || (e.name || '').toLowerCase().includes(oq) || e.type.includes(oq);
  const olTitle = document.getElementById('olCount');
  if (olTitle) olTitle.textContent = doc.entities.length ? `（${doc.entities.length}）` : '';
  if (!doc.entities.length) {
    const empty = document.createElement('div');
    empty.className = 'ol-empty';
    empty.textContent = '场景为空——从左侧组件目录添加，或在 Agent 页签解析题目自动建场';
    const go = document.createElement('button');   // UI-522：空态给行动入口
    go.className = 'link-btn';
    go.textContent = '打开组件目录';
    go.onclick = () => { const cs = document.getElementById('catalogSearch'); if (cs) { cs.focus(); cs.select(); } };
    empty.appendChild(document.createElement('br'));
    empty.appendChild(go);
    box.appendChild(empty);
    box.scrollTop = keepTop;
    return;
  }
  // 对象分组（Goal 第六章）：按实体 group 字段分桶渲染；「成组」入口由 updateOutlineSelection 统一管理
  const ungrouped = [];
  const groups = new Map();
  for (const e of doc.entities) {
    if (e.group) {
      if (!groups.has(e.group)) groups.set(e.group, []);
      groups.get(e.group).push(e);
    } else ungrouped.push(e);
  }
  for (const e of ungrouped) if (olPass(e)) renderOutlineRow(box, e);
  for (const [gname, members] of groups) {
    const head = document.createElement('div');
    head.className = 'ol-group';
    head.dataset.group = gname;
    head.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 6px;margin-top:3px;background:rgba(217,164,65,.08);border-left:2px solid rgba(217,164,65,.55);cursor:pointer;font-size: 12px;color:var(--accent)';
    const nm = document.createElement('span');
    nm.innerHTML = '<svg class="ic" style="width:11px;height:11px;vertical-align:-1px"><use href="#i-box-multiple"/></svg> ';   // UI-524：组头图标归队 sprite
    nm.appendChild(document.createTextNode(gname));
    const cnt = document.createElement('span');
    cnt.style.cssText = 'font-size: 10px;color:var(--faint)';
    cnt.textContent = `${members.length} 个对象`;
    const ungroupBtn = document.createElement('span');
    ungroupBtn.textContent = '解组';
    ungroupBtn.style.cssText = 'margin-left:auto;font-size: 10px;color:var(--faint);cursor:pointer;text-decoration:underline dotted';
    ungroupBtn.onclick = (ev) => { ev.stopPropagation(); ungroupMembers(members.map((m) => m.id)); };
    head.append(nm, cnt, ungroupBtn);
    head.onclick = () => {           // 点组头 = 整组选中
      selectedIds = members.map((m) => m.id);
      selectedId = selectedIds[selectedIds.length - 1];
      renderOutline();
      renderInspector();
    };
    box.appendChild(head);
    for (const e of members) if (olPass(e)) renderOutlineRow(box, e, true);
  }
  box.scrollTop = keepTop;
}

function renderOutlineRow(box, e, inGroup = false) {
    const c = registry.getComponent(e.type);
    const row = document.createElement('div');
    row.dataset.id = e.id;
    row.className = 'ol-row' + (selectedIds.includes(e.id) ? ' sel' : '');
    row.setAttribute('tabindex', '0');   // UI-518：大纲行键盘可达
    row.setAttribute('role', 'button');
    row.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectEntity(e.id); } };
    if (inGroup) row.style.borderLeft = '2px solid rgba(217,164,65,.25)';
    row.innerHTML = `<span class="nm"></span><span class="ty"></span><span class="vis" title="显示/隐藏（仅视觉隐藏，参与物理）"></span><span class="lock" title="锁定（防误选/防拖动）"></span><span class="del" title="删除" role="button" aria-label="删除该对象" tabindex="0">×</span>`;
    const vis = row.querySelector('.vis');
    vis.textContent = e.visible === false ? '隐' : '显';
    vis.style.cssText = 'cursor:pointer;font-size: 11px;color:' + (e.visible === false ? 'var(--danger)' : 'var(--faint)') + ';min-width:16px;display:inline-block;text-align:center';   // UI-521
    vis.onclick = (ev) => {
      ev.stopPropagation();
      opUpdateEntity(e.id, { visible: e.visible === false }, (e.visible === false ? '显示 ' : '隐藏 ') + e.name, { rebuild: false });
      const b = runtime.binds.get(e.id);
      if (b && b.mesh) b.mesh.visible = e.visible !== false;
      viewport.markDirty();
    };
    const nm = row.querySelector('.nm');
    nm.textContent = e.name;
    nm.ondblclick = () => {
      if (mode === 'run') { toast('运行态不可重命名，请先重置'); return; }
      outlineEditing = true;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = e.name;
      input.style.cssText = 'flex:1;min-width:0;background:rgba(255,255,255,.05);border:1px solid rgba(217,164,65,.5);color:var(--text);font-size: 12px;padding:1px 4px;border-radius:var(--r-ctl)';
      nm.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        outlineEditing = false;
        const v = input.value.trim();
        if (v && v !== e.name) opUpdateEntity(e.id, { name: v }, '重命名', { rebuild: false });
        else renderOutline();
      };
      input.onblur = commit;
      input.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); } if (ev.key === 'Escape') { input.value = e.name; input.blur(); } };
    };
    const lock = row.querySelector('.lock');
    lock.textContent = e.locked ? '已锁' : '锁';
    lock.style.cssText = 'cursor:pointer;font-size: 11px;color:' + (e.locked ? 'var(--accent)' : 'var(--faint)') + ';min-width:16px;display:inline-block;text-align:center';   // UI-521
    lock.onclick = (ev) => {
      ev.stopPropagation();
      if (mode === 'run') { toast('运行态不可锁定，请先重置'); return; }
      opUpdateEntity(e.id, { locked: !e.locked }, e.locked ? '解锁 ' + e.name : '锁定 ' + e.name, { rebuild: false });
      const mesh = runtime.binds.get(e.id);
      if (mesh) mesh.mesh.userData.locked = e.locked;   // opUpdate 后 e.locked 即新值
    };
    row.querySelector('.ty').textContent = c.label;
    // 约束关系徽标：joint（prismatic/revolute 滑槽/转轴）与连接（rope/spring）计数
    const nJ = (e.joints || []).length;
    const nL = Array.isArray(e.attach) && e.attach.length === 2 ? 1 : 0;
    const nT = doc.entities.filter((x) => (x.joints || []).some((j) => j.target === e.id)
      || (Array.isArray(x.attach) && x.attach.includes(e.id))).length;
    const nCons = nJ + nL + nT;
    if (nCons > 0) {
      const relNames = [];
      for (const x of doc.entities) {
        if (Array.isArray(x.attach) && x.attach.includes(e.id)) relNames.push(x.name + '→本體');
        if ((x.joints || []).some((j) => j.target === e.id)) relNames.push(x.name + '→本體(关节)');
      }
      if (nJ) relNames.push('自带关节×' + nJ);
      if (nL) relNames.push('连接两端');
      const cb = document.createElement('span');
      cb.className = 'cons-badge';
      cb.title = `约束 ${nCons} 条：${relNames.slice(0, 4).join('、') || '详见检查器'}`;
      cb.textContent = '⌁' + nCons;
      cb.style.cssText = 'font-size: 10px;color:var(--accent);margin-left:2px';
      row.querySelector('.ty').after(cb);
    }
    row.title = `类型 ${c.label} · 来源 ${e.source === 'agent' ? 'Agent 建场' : e.source === 'preset' ? '预置' : '手动添加'}`;
    row.onclick = () => selectEntity(e.id);
    const delBtn = row.querySelector('.del');
    delBtn.onclick = (ev) => { ev.stopPropagation(); opRemoveEntity(e.id); };   // opRemoveEntity 内 toast 自带 [撤销]
    delBtn.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); opRemoveEntity(e.id); } };   // UI-518
    // 选中对象定位：⌖ 把相机 target/距离平滑移向该实体（组内成员与链接实体同样可用）
    const focusBtn = document.createElement('span');
    focusBtn.className = 'focus-btn';
    focusBtn.innerHTML = '<svg class="ic" style="width:11px;height:11px"><use href="#i-focus-2"/></svg>';   // UI-525：字符形归队 sprite
    focusBtn.title = '在视口中定位（相机聚焦）';
    focusBtn.style.cssText = 'cursor:pointer;color:var(--faint);margin-right:2px;display:inline-flex';
    focusBtn.onclick = (ev) => {
      ev.stopPropagation();
      const b = runtime.binds.get(e.id);
      if (b && b.mesh) { viewport.focusOn(b.mesh); selectEntity(e.id); }
    };
    row.insertBefore(focusBtn, row.querySelector('.lock'));
    box.appendChild(row);
  }

// ============ 对象分组（Goal 第六章）：group 字段纯元数据，随场景文档序列化 ============
function assignGroup(ids) {
  if (mode === 'run') { toast('运行态不可分组，请先重置'); return; }
  if (!ids.length) return;
  const existing = new Set(doc.entities.map((e) => e.group).filter(Boolean));
  const groupName = `组${existing.size + 1}`;
  beginHistoryBatch();
  try {
    for (const id of ids) {
      if (getEntity(doc, id)) opUpdateEntity(id, { group: groupName }, '', { rebuild: false });
    }
  } finally {
    endHistoryBatch(`成组「${groupName}」（${ids.length} 个对象）`);
  }
  renderOutline();
  toast(`已成组「${groupName}」`);
}

function ungroupMembers(ids) {
  if (mode === 'run') { toast('运行态不可解组，请先重置'); return; }
  if (!ids.length) return;
  beginHistoryBatch();
  try {
    for (const id of ids) {
      if (getEntity(doc, id)) opUpdateEntity(id, { group: null }, '', { rebuild: false });
    }
  } finally {
    endHistoryBatch(`解组 ${ids.length} 个对象`);
  }
  renderOutline();
  toast('已解组');
}

// ============ 检查器 ============
function renderInspector() {
  _liveEls = null;   // liveGrid 随面板重建，读数元素缓存必须失效（PL-51）
  const box = $('inspBody'), empty = $('inspEmpty');
  const e = selectedId ? getEntity(doc, selectedId) : null;
  if (!e) {
    box.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  box.style.display = 'block';
  // UI-620：重建前记焦点（组内 label 文本定位）——paramsRebuild 类参数提交后面板重建不丢焦点
  const prevFocus = document.activeElement;
  let prevLabel = null;
  if (prevFocus instanceof HTMLElement && box.contains(prevFocus) && (prevFocus.tagName === 'INPUT' || prevFocus.tagName === 'SELECT')) {
    const row = prevFocus.closest('.frow, .cell');
    const lab = row ? row.querySelector('label') : null;
    prevLabel = lab ? lab.textContent : null;
  }
  // 面板重建保持滚动位置（UI-75）：参数多的实体在长面板里调参不该跳回顶部
  const rightPane = $('right');
  const keepScroll = rightPane.scrollTop;
  box.innerHTML = '';
  const c = registry.getComponent(e.type);
  const dis = mode === 'run';
  // 运行态横幅（一次说清，替代散在各输入上的 disabled 猜谜）
  if (dis) {
    const banner = document.createElement('div');
    banner.style.cssText = 'margin:0 0 8px;padding:6px 10px;background:rgba(217,164,65,.10);border:1px solid rgba(217,164,65,.35);border-radius:var(--r-ctl);font-size: 12px;color:var(--accent-hi)';   // UI-531 圆角归 token、字色提对比
    banner.textContent = '运行态只读——「重置」回编辑态后可修改参数';
    box.appendChild(banner);
    // R6-F3：P 键移除后图钉的 UI 入口（运行态横幅旁小钮,动态体才显示;物理体级操作,重置即消）
    if (e.physics.body === 'dynamic') {
      const pinBtn = document.createElement('button');
      pinBtn.textContent = runtime.pinned.has(e.id) ? '已图钉 · 点击放开' : '图钉（钉住当前位姿）';
      pinBtn.style.cssText = 'margin:0 0 10px;padding:5px 12px;background:transparent;border:1px solid var(--line-strong);border-radius:var(--r-ctl);color:var(--text);font-size: 12px;cursor:pointer;width:100%';
      pinBtn.onmouseenter = () => { pinBtn.style.borderColor = 'var(--accent)'; };
      pinBtn.onmouseleave = () => { pinBtn.style.borderColor = 'var(--line-strong)'; };
      pinBtn.onclick = () => {
        const pin = runtime.togglePin(e.id);
        pinBtn.textContent = pin ? '已图钉 · 点击放开' : '图钉（钉住当前位姿）';
        pinBtn.style.color = pin ? 'var(--accent-hi)' : 'var(--text)';
        pinBtn.style.borderColor = pin ? 'var(--accent)' : 'var(--line-strong)';
        toast(pin ? '已钉住（重置后恢复）' : '已放开图钉');
      };
      if (runtime.pinned.has(e.id)) { pinBtn.style.color = 'var(--accent-hi)'; pinBtn.style.borderColor = 'var(--accent)'; }
      box.appendChild(pinBtn);
    }
  }

  // 传感器读数（速度/计时/力）：运行态实时显示
  if ((e.type === 'speedSensor' || e.type === 'timer' || e.type === 'forceSensor') && Array.isArray(e.attach) && e.attach.length === 1) {
    const rec = runtime.sensorReadings.get(e.id) || {};
    const rows = [];
    if (e.type === 'speedSensor') {
      rows.push(['目标速度', rec.speed != null ? rec.speed.toFixed(3) + ' m/s' : '等待运行']);
      if (rec.speed != null) rows.push(['分量 vx/vy/vz', [rec.vx, rec.vy, rec.vz].map((v) => v.toFixed(2)).join(' / ') + ' m/s']);
    } else if (e.type === 'forceSensor') {
      rows.push(['目标接触合力', rec.fmag != null ? rec.fmag.toFixed(3) + ' N' : '等待运行']);
      if (rec.f != null) {
        rows.push(['竖直分量 Fy', rec.fy.toFixed(3) + ' N']);
        rows.push(['分量 Fx/Fy/Fz', rec.f.map((v) => v.toFixed(2)).join(' / ') + ' N']);
      }
    } else {
      rows.push(['光门状态', rec.crossedT != null ? `已通过 t=${rec.crossedT.toFixed(3)} s` : '等待穿过…']);
    }
    for (const [k, txt] of rows) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);font-size: 13px';
      const kl = document.createElement('span'); kl.textContent = k; kl.style.color = 'var(--dim)';
      const vl = document.createElement('span'); vl.textContent = txt;
      vl.style.cssText = 'font-family:var(--mono);color:var(--accent)';
      row.append(kl, vl);
      box.appendChild(row);
    }
  }

  // 测量尺：实时两端点距离（运行/编辑态均可读）
  if (e.type === 'ruler' && Array.isArray(e.attach) && e.attach.length === 2) {
    const ba = runtime.binds.get(e.attach[0]), bb = runtime.binds.get(e.attach[1]);
    if (ba?.mesh && bb?.mesh) {
      const d = ba.mesh.position.distanceTo(bb.mesh.position);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);font-size: 13px';
      const k = document.createElement('span'); k.textContent = '两端点距离'; k.style.color = 'var(--dim)';
      const v = document.createElement('span'); v.textContent = d.toFixed(3) + ' m';
      v.style.cssText = 'font-family:var(--mono);color:var(--accent)';
      row.append(k, v);
      box.appendChild(row);
    }
  }

  // 头部：名称 + 可见 + 类型/来源
  const head = document.createElement('div');
  head.className = 'grp';
  head.innerHTML = `
    <div class="frow"><label>名称</label><input type="text" data-k="name" value=""></div>
    <div class="frow"><label>可见</label><input type="checkbox" data-k="visible" style="flex:0"></div>
    <div class="frow"><label>类型</label><span style="font-size: 13px;color:var(--text)"></span>
      <span class="badge src-${e.source}" style="margin-left:auto">${e.source === 'agent' ? 'Agent' : (e.source === 'preset' ? '预置' : '用户')}</span></div>
    <div class="hint"></div>`;
  head.querySelector('.hint').textContent = c.desc;
  const nameInput = head.querySelector('[data-k=name]');
  nameInput.value = e.name;
  nameInput.disabled = dis;
  nameInput.onchange = () => opUpdateEntity(e.id, { name: nameInput.value || e.name }, '重命名', { rebuild: false });
  const visCb = head.querySelector('[data-k=visible]');
  visCb.checked = e.visible !== false;
  visCb.disabled = dis;
  visCb.onchange = () => {
    const mesh = runtime.binds.get(e.id).mesh;
    mesh.visible = visCb.checked;
    viewport.markDirty();
    opUpdateEntity(e.id, { visible: visCb.checked }, visCb.checked ? '显示' : '隐藏', { rebuild: false });
  };
  head.children[2].children[1].textContent = c.label;
  box.appendChild(head);

  // 变换组
  const grpT = grp('变换');
  triRow(grpT, '坐标', 'm', e.transform.pos, 0.1, (vals) => patchTransform(e, { pos: vals }, '移动'));   // U-READ：坐标（分量可负）≠里程（路程,见实时区）
  triRow(grpT, '旋转', '°', e.transform.rot.map((r) => +(r * 180 / Math.PI).toFixed(1)), 1,
    (vals) => patchTransform(e, { rot: vals.map((v) => +(v * Math.PI / 180).toFixed(4)) }, '旋转'));
  // 视觉缩放（缩放 gizmo 写 transform.scale）：只改显示网格，物理参数不变——必须让用户看得见这条边界
  const vs = e.transform.scale || [1, 1, 1];
  const vscaled = Math.abs(vs[0] - 1) > 1e-6 || Math.abs(vs[1] - 1) > 1e-6 || Math.abs(vs[2] - 1) > 1e-6;
  const vsRow = document.createElement('div');
  vsRow.className = 'frow';
  vsRow.innerHTML = `<label>视觉缩放</label><span class="v" style="font-family:var(--mono);font-size: 12px;color:var(--dim)" title="碰撞体同步缩放（球取均值/盒按轴/柱半径×kz）；质量不变">×${vs[0]} · 碰撞同步</span>`;   // B4：缩放体碰撞一致化后改标注
  vsRow.title = '缩放 gizmo 只改显示大小（0.25–4 倍）；碰撞体/质量/转动惯量不变。要改物理尺寸请编辑下方尺寸参数';
  grpT.appendChild(vsRow);
  box.appendChild(grpT);

  // 参数组（schema 驱动）
  const grpP = grp('参数');
  for (const item of c.schema) {
    if (item.kind === 'rampAngle') continue;    // 斜坡倾角放最后展示当前值
    numRow(grpP, item.label, item.unit || '', e.params[item.key], item.step,
      (v) => { e.params[item.key] = v; patchParams(e, '调参数', !!c.paramsRebuild); }, { min: item.min, max: item.max, schema: item });
  }
  if (c.computed) {
    for (const cv of c.computed(e.params)) {
      const row = document.createElement('div');
      row.className = 'frow';
      row.innerHTML = `<label>${cv.label}</label><span class="ro-inline"></span><span class="u">${cv.unit}</span>`;
      row.querySelector('.ro-inline').textContent = cv.value;
      row.querySelector('.ro-inline').style.cssText = 'flex:1;text-align:right;font-family:var(--mono);font-size: 13px;color:var(--accent)';
      grpP.appendChild(row);
    }
  }
  if (c.applySpecial) {
    const angItem = c.schema.find((s) => s.kind === 'rampAngle');
    numRow(grpP, angItem.label, angItem.unit, +(Math.atan2(e.params.height, e.params.length) * 180 / Math.PI).toFixed(1), angItem.step,
      (v) => { c.applySpecial(e.params, 'angle', v); patchParams(e, '调倾角'); }, { min: angItem.min, max: angItem.max, schema: angItem });
  }
  box.appendChild(grpP);

  // 观察组（Goal 六检查器硬清单）：per-entity 记录轨迹/显示速度向量（动态体，默认开）
  if (e.physics.body === 'dynamic' && !c.isLink && !c.isSensor && !c.isMeasure) {
    const grpO = grp('观察');
    const mkObs = (label, key, hint) => {
      const row = document.createElement('div');
      row.className = 'frow';
      row.innerHTML = `<label>${label}</label><input type="checkbox" style="flex:0">`;
      const cb = row.querySelector('input');
      cb.checked = e.params[key] !== false;    // 未设置视为开（兼容历史实体）
      cb.disabled = dis;
      cb.title = hint;
      cb.onchange = () => { e.params[key] = cb.checked; patchParams(e, `${cb.checked ? '开启' : '关闭'}${label}`, false); };
      grpO.appendChild(row);
    };
    mkObs('记录轨迹', 'recordTrail', '关闭后该体不采样轨迹线（全局「轨迹」开关仍是总闸）');
    mkObs('显示速度向量', 'showVel', '关闭后该体不画速度箭头（全局「矢量」开关仍是总闸）');
    box.appendChild(grpO);
  }
  // 测量组（Goal 六检查器硬清单，斜坡）：显示法线/参与测量
  if (e.type === 'ramp') {
    const grpMs = grp('测量');
    const mkMea = (label, key, def, hint) => {
      const row = document.createElement('div');
      row.className = 'frow';
      row.innerHTML = `<label>${label}</label><input type="checkbox" style="flex:0">`;
      const cb = row.querySelector('input');
      cb.checked = e.params[key] != null ? e.params[key] : def;
      cb.disabled = dis;
      cb.title = hint;
      cb.onchange = () => { e.params[key] = cb.checked; patchParams(e, `${cb.checked ? '开启' : '关闭'}${label}`, false); };
      grpMs.appendChild(row);
    };
    mkMea('显示法线', 'showNormals', false, '在坡面中心画出坡面法线方向（倾角教学的 θ 与法线）');
    mkMea('参与测量', 'inMeasure', true, '关闭后球在该坡面的接触不再进入受力分解（大场景降噪）');
    box.appendChild(grpMs);
  }

  // 观察点：一键飞回保存的视角（相机和观察点分类）
  if (e.type === 'viewpoint') {
    const grpV = grp('观察点');
    const brow = document.createElement('div');   // UI-537：套全站 btnrow 风格，不再裸 button
    brow.className = 'btnrow';
    const fly = document.createElement('button');
    fly.textContent = '飞到观察点';
    fly.onclick = () => viewport.flyToPose(e.transform.pos, e.params.target || [0, 0.5, 0]);
    brow.appendChild(fly);
    grpV.appendChild(brow);
    box.appendChild(grpV);
  }

  // 物理组
  const grpPh = grp('物理');
  const bodyRow = document.createElement('div');
  bodyRow.className = 'frow';
  bodyRow.innerHTML = `<label>刚体</label><select data-k="body"></select>`;
  const sel = bodyRow.querySelector('select');
  for (const o of registry.BODY_OPTIONS) {
    const op = document.createElement('option');
    op.value = o.key; op.textContent = o.label;
    if (e.physics.body === o.key) op.selected = true;
    sel.appendChild(op);
  }
  sel.disabled = dis;
  sel.onchange = () => { e.physics.body = sel.value; patchPhysics(e, '切换刚体类型'); renderInspector(); };
  grpPh.appendChild(bodyRow);

  numRow(grpPh, '质量', 'kg', e.physics.mass, 0.1, (v) => { e.physics.mass = v; patchPhysics(e, '改质量'); }, { min: 0.01, max: 1000000 });   // 上限与 Agent 评审表单对齐（AG-67）
  numRow(grpPh, '摩擦系数', '', e.physics.friction, 0.05, (v) => { e.physics.friction = v; patchPhysics(e, '改摩擦'); }, { min: 0, max: 2 });
  numRow(grpPh, '弹性系数', '', e.physics.restitution, 0.05, (v) => { e.physics.restitution = v; patchPhysics(e, '改弹性'); }, { min: 0, max: 1 });
  if (e.physics.body === 'dynamic') {
    triRow(grpPh, '初速度', 'm/s', e.physics.linvel, 0.1, (vals) => { e.physics.linvel = vals; patchPhysics(e, '改初速度'); });
    triRow(grpPh, '初角速度', 'rad/s', e.physics.angvel, 0.1, (vals) => { e.physics.angvel = vals; patchPhysics(e, '改初角速度'); });
    numRow(grpPh, '重力缩放', 'x', e.physics.gravityScale, 0.1, (v) => { e.physics.gravityScale = v; patchPhysics(e, '改重力缩放'); }, { min: 0, max: 5 });
    numRow(grpPh, '线性阻尼', '', e.physics.linDamping, 0.01, (v) => { e.physics.linDamping = v; patchPhysics(e, '改阻尼'); }, { min: 0, max: 10 });
  }
  // 隐藏物理标志只读说明（PHY-10）：这些字段由预置/Agent 布局写入，语义必须可见
  const physFlags = [];
  if (e.physics.spinLock) physFlags.push('理想轴承（锁平动、只绕 Y 转）');
  if (e.physics.gravitating) physFlags.push('天体：参与成对引力，不受世界重力');
  if (e.physics.onPulley) physFlags.push('阿特伍德绳约束（onPulley）');
  if (e.physics.onTrack) physFlags.push('管道轨道中心线约束（onTrack，光滑）');
  if (physFlags.length) {
    const fh = document.createElement('div');
    fh.className = 'hint';
    fh.textContent = '物理标志：' + physFlags.join('；');
    grpPh.appendChild(fh);
  }
  box.appendChild(grpPh);

  // 约束组（PHY-3）：e.joints 可见 + 单条删除（悬空由删除级联兜底）
  if (Array.isArray(e.joints) && e.joints.length) {
    const grpJ = grp('约束');
    e.joints.forEach((j, ji) => {
      const row = document.createElement('div');
      row.className = 'frow';
      const tgt = getEntity(doc, j.target);
      const jlabel = j.type === 'revolute' ? '转轴' : (j.type === 'prismatic' ? '滑槽' : j.type);
      row.innerHTML = `<label>${jlabel}</label><span style="flex:1;font-size: 12px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><button class="danger" style="flex:0 0 auto;appearance:none;background:none;border:1px solid var(--line);border-radius:var(--r-ctl);color:var(--dim);font-size: 11px;padding:2px 8px;cursor:pointer">删除</button>`;
      row.children[1].textContent = '→ ' + (tgt ? tgt.name : j.target);
      row.children[1].title = `axis=[${(j.axis || []).map((x) => +x.toFixed(2))}]`;
      row.querySelector('button').onclick = () => {
        if (mode === 'run') { toast('运行态不可删约束，请先重置'); return; }
        const next = e.joints.filter((_, k) => k !== ji);
        opUpdateEntity(e.id, { joints: next }, '删除' + jlabel + '约束');
        toast('已删除' + jlabel + '约束（Ctrl+Z 可撤销）');
      };
      grpJ.appendChild(row);
    });
    box.appendChild(grpJ);
  }

  // 材质组
  const grpM = grp('外观');
  const mrow = document.createElement('div');
  mrow.className = 'frow';
  mrow.innerHTML = `<label>材质</label><span class="mat-dot" style="width:14px;height:14px;border-radius:50%;flex:none;border:1px solid var(--line-strong);background-size:cover;background-position:center"></span><select data-k="mat"></select>`;
  const msel = mrow.querySelector('select');
  const mdot = mrow.querySelector('.mat-dot');
  const syncMatDot = () => {   // UI-536：材质色点（离屏渲的材质球缩略,未就绪时留空点）
    const pv = swatchPreviews && swatchPreviews[e.render.material];
    mdot.style.backgroundImage = pv ? `url(${pv})` : 'none';
  };
  syncMatDot();
  msel.addEventListener('change', () => { e.render.material = msel.value; syncMatDot(); });
  for (const o of registry.MATERIAL_OPTIONS) {
    const op = document.createElement('option');
    op.value = o.key; op.textContent = o.label;
    if (e.render.material === o.key) op.selected = true;
    msel.appendChild(op);
  }
  msel.disabled = dis;
  msel.onchange = () => {
    e.render.material = msel.value;
    const physTxt = applyMaterialPhysics(e, msel.value);   // U-MAT：材质→物理同源套用
    opUpdateEntity(e.id, { render: e.render, physics: e.physics },
      physTxt ? `换材质·套用物理（${physTxt}）` : '换材质');
  };

  // 检查器既有「操作」组（尾部 grpA）补聚焦按钮——见本函数尾部 
  grpM.appendChild(mrow);
  box.appendChild(grpM);

  // 实时遥测区（每帧刷新数字，不重建 DOM）
  const grpR = grp('实时数据');
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  grid.id = 'liveGrid';
  grid.innerHTML = `
    <div class="cell"><span class="k">速率</span><span class="v" data-lv="speed">--</span></div>
    <div class="cell"><span class="k">高度</span><span class="v" data-lv="height">--</span></div>
    <div class="cell"><span class="k">里程</span><span class="v" data-lv="dist">--</span></div>
    <div class="cell"><span class="k">质量</span><span class="v plain" data-lv="mass">--</span></div>
    <div class="cell"><span class="k">动量</span><span class="v" data-lv="momentum">--</span></div>
    <div class="cell"><span class="k">平动动能</span><span class="v" data-lv="keTrans">--</span></div>
    <div class="cell"><span class="k">角速度</span><span class="v" data-lv="omega">--</span></div>
    <div class="cell"><span class="k">最近碰撞</span><span class="v plain" data-lv="coll">--</span></div>
    <div class="cell"><span class="k">滚动状态</span><span class="v plain" data-lv="roll">--</span></div>
    <div class="cell" style="grid-column:1/-1"><span class="k">速度矢量</span><span class="v plain" data-lv="vel">--</span></div>`;
  grpR.appendChild(grid);
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = '数值由固定步长物理演化实时读出，单位: m/s、m、kg、kg·m/s、J、rad/s';   // UI-540 单位口径统一在 hint
  grpR.appendChild(hint);
  box.appendChild(grpR);

  // 操作
  const grpA = grp('操作');
  const br = document.createElement('div');
  br.className = 'btnrow';
  br.innerHTML = `<button data-a="dup">复制</button><button data-a="focus">聚焦</button><button data-a="del" class="danger">删除</button>`;
  br.querySelector('[data-a=dup]').onclick = () => opDuplicate(e.id);
  br.querySelector('[data-a=focus]').onclick = () => { const b = runtime.binds.get(e.id); if (b && b.mesh) viewport.focusOn(b.mesh); };
  br.querySelector('[data-a=focus]').title = '相机对准该实体（F 同）';
  br.querySelector('[data-a=dup]').title = '复制该实体（Ctrl+D 同）';
  br.querySelector('[data-a=del]').title = '删除该实体（级联删除其连接件；Ctrl+Z 可撤销）';
  br.querySelector('[data-a=del]').onclick = () => opRemoveEntity(e.id);
  grpA.appendChild(br);
  box.appendChild(grpA);
  rightPane.scrollTop = keepScroll;
  // UI-620：还原焦点到同 label 的输入件（重建后 DOM 全新）
  if (prevLabel) {
    const rows = box.querySelectorAll('.frow, .cell');
    for (const r of rows) {
      const lab = r.querySelector('label');
      if (lab && lab.textContent === prevLabel) {
        const inp = r.querySelector('input, select');
        if (inp && !inp.disabled) {
          inp.focus();
          requestAnimationFrame(() => { try { inp.select(); } catch { /* 非文本输入 */ } });
        }
        break;
      }
    }
  }
}

function patchTransform(e, t, label) { opUpdateEntity(e.id, { transform: t }, label, { rerender: false }); }
function patchParams(e, label, rerender = true) { opUpdateEntity(e.id, { params: e.params }, label, { rerender }); }
function patchPhysics(e, label) { opUpdateEntity(e.id, { physics: e.physics }, label, { rerender: false }); }
function patchRender(e, label) { opUpdateEntity(e.id, { render: e.render }, label, { rerender: false }); }

// U-MAT：材质影响物理——换材质自动套用预设（μ/e + 动态体 m=ρV 重算，固定体不重算质量）。
// 返回描述串供历史日志；无预设的材质返回 null（天体/水面等非实体材质）
function applyMaterialPhysics(e, matKey) {
  const mp = registry.MAT_PHYS[matKey];
  if (!mp) return null;
  e.physics.friction = mp.mu;
  e.physics.restitution = mp.e;
  let txt = `μ=${mp.mu} e=${mp.e}`;
  const vol = registry.volumeOf(e.type, e.params);
  if (vol != null && e.physics.body === 'dynamic') {
    const m = Math.max(0.01, +(mp.rho * vol).toFixed(3));
    e.physics.mass = m;
    txt += ` m=${m}kg`;
  }
  return txt;
}

function grp(title) {
  const g = document.createElement('div');
  g.className = 'grp';
  const h = document.createElement('div');
  h.className = 'grp-h';
  h.textContent = title;
  g.appendChild(h);
  return g;
}

// 常用参数的教学提示（悬停即知这个参数物理上管什么；schema 有专门 desc 时优先用 schema 的）
const PARAM_HINTS = {
  radius: '半径：碰撞体与渲染尺寸同步变化',
  mass: '质量：影响惯性（F=ma）与碰撞冲量分配',
  friction: '摩擦因数：0=光滑（冰面），0.5≈木-木，1≈高阻',
  restitution: '弹性系数：0=完全非弹性（碰后不弹），1=完全弹性（无动能损失）',
  height: '高度：碰撞体与渲染同步',
  width: '宽度：碰撞体与渲染同步',
  length: '长度：碰撞体与渲染同步',
  sx: '长（x 方向）', sy: '厚（y 方向）', sz: '宽（z 方向）',
  spokes: '辐条数：>0 时画出辐条，转台转动肉眼可见',
  speed: '带速：正=沿 +x 输运，负=反向',
  stiffness: '劲度系数 k（N/m）：越大弹簧越硬，振动越快',
  restLength: '原长（m）：弹簧不受力时的自然长度',
  damping: '阻尼：0=理想弹簧不耗能，>0 振幅逐渐衰减',
  rollResist: '滚动阻力 μr：纯滚动时的速度衰减强度',
  momentOfInertia: '转动惯量（题给）：角动量 L=Iω 的 I',
  gravityScale: '重力缩放：0=该物体不受重力（悬浮理想化）',
};
// UI(视觉门)：+Number(toFixed) 会把 -0.0004 变 -0，number 输入框显示「-0」破相——负零归零
const fmtNum = (v) => {
  const n = +Number(v).toFixed(3);
  return Object.is(n, -0) ? 0 : n;
};
function numRow(parent, label, unit, value, step, onCommit, { min, max, schema } = {}) {
  const row = document.createElement('div');
  row.className = 'frow';
  row.innerHTML = `<label></label><input type="number"><span class="u"></span>`;
  row.querySelector('label').textContent = label;
  row.querySelector('.u').textContent = unit;
  const input = row.querySelector('input');
  input.value = fmtNum(value);
  input.step = step;
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  input.disabled = mode === 'run';
  {
    const hint = (schema && PARAM_HINTS[schema.key]) || '';
    const range = (min !== undefined || max !== undefined) ? `允许范围 ${min !== undefined ? min : '-∞'} ~ ${max !== undefined ? max : '+∞'}${unit ? ' ' + unit : ''}` : '';
    const ro = mode === 'run' ? '（运行态只读）' : '';
    input.title = [hint, range].filter(Boolean).join('。') + ro;
  }
  input.onfocus = () => { if (input.classList.contains('bad')) clearErr(); requestAnimationFrame(() => input.select()); };   // UI-532：报错态先还原值再全选
  const err = document.createElement('div');
  err.className = 'errmsg';
  parent.appendChild(row);
  parent.appendChild(err);
  // UI-532：校验失败不再 1.6s 静默还原（文案读不完、不知被还原）——保持报错，到下次聚焦时值回填可见
  const clearErr = () => {
    input.classList.remove('bad');
    err.style.display = 'none';
    input.value = fmtNum(value);
  };
  const showNumErr = (msg) => {
    input.classList.add('bad');
    err.textContent = msg;
    err.style.display = 'block';
  };
  const commit = () => {
    if (schema) {
      const r = registry.validate(schema, input.value);
      if (!r.ok) {
        showNumErr(r.msg);
        return;
      }
      onCommit(r.value);
    } else {
      const v = Number(input.value);
      const lo = min !== undefined ? min : -Infinity;
      const hi = max !== undefined ? max : Infinity;
      // min/max 必须进 JS 校验：HTML 属性拦不住 fill/粘贴/科学计数（曾实测 mass=99999999、-5、
      // 溢出清空成 0 质量直入文档——0 质量动态体在物理上灾难性）。
      if (!Number.isFinite(v) || v < lo || v > hi) {
        showNumErr(min !== undefined && max !== undefined ? `允许范围 ${min} ~ ${max}` : '数值无效');
        return;
      }
      onCommit(v);
    }
  };
  input.onchange = commit;
  input.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); input.blur(); } };
  return row;
}

function triRow(parent, label, unit, values, step, onCommit) {
  const row = document.createElement('div');
  row.className = 'frow';
  row.innerHTML = `<label></label><div class="tri">
    <input type="number"><input type="number"><input type="number"></div><span class="u"></span>`;
  row.querySelector('label').textContent = label;
  row.querySelector('.u').textContent = unit;
  const inputs = [...row.querySelectorAll('input')];
  const AXES = ['X', 'Y', 'Z'];
  const AX_COLORS = ['#c97a6a', '#8fbf7a', '#6a8fbf'];   // 三轴习惯色（X红/Y绿/Z蓝，低饱和配深底）
  inputs.forEach((inp, i) => {
    inp.value = fmtNum(values[i]);
    inp.step = step;
    inp.disabled = mode === 'run';
    inp.title = `${label}·${AXES[i]} 轴${mode === 'run' ? '（运行态只读，重置后可改）' : ''}`;
    inp.style.borderBottom = `2px solid ${AX_COLORS[i]}55`;   // 轴色底标：不看标签也知道在改哪根轴
    inp.onfocus = () => requestAnimationFrame(() => inp.select());   // 双击/Tab 进入即全选，直接输新值
    inp.onchange = () => {
      const vals = inputs.map((x) => Number(x.value));
      if (vals.some((v) => !Number.isFinite(v))) { inputs.forEach((x, j) => { x.value = fmtNum(values[j]); }); return; }
      onCommit(vals);
    };
  });
  parent.appendChild(row);
}

// ============ 教学叠加层：速度向量 + 轨迹线 + 守恒量条 ============
let vectorsOn = false;
let forcesOn = false;
let springForceItems = [];   // 最近一次弹簧胡克力采样（springForceState 数值对照用）
let trailsOn = false;
let consOn = false;
let curvesOn = false;
const CURVE_PALETTE = ['#d9a441', '#7ba7d9', '#c96a5a', '#9fd8a8', '#b08cd9', '#d88a5a'];
const curveData = { t: [], byId: new Map(), ke: [], pe: [], epoch: -1, legendN: -1 };
let curveMode = 'motion';   // 'motion' 速率/高度 | 'energy' KE/PE/E 堆叠对照

function setVectors(on) {
  vectorsOn = on;
  viewport.setVelocityArrows(on);
  $('btnVectors').classList.toggle('hot', on);
}
function setForces(on) {
  forcesOn = on;
  viewport.setForceArrows(on, viewport.decompose);
  if (on) { viewport.setTensionArrows(true); viewport.setSpringArrows(true); }   // 有绳/弹簧时张力/弹力箭头随受力开
  $('btnForces').classList.toggle('hot', on);
  $('btnDecompose').disabled = !on;
  if (!on) { viewport.setTensionArrows(false); viewport.setSpringArrows(false); springForceItems = []; }
}
function posBtoArray(id) {
  const b = runtime.binds.get(id);
  return b && b.mesh ? b.mesh.position.toArray() : null;
}
function setCurves(on) {
  curvesOn = on;
  $('curvePanel').classList.toggle('on', on);
  $('btnCurves').classList.toggle('hot', on);
  if (on) {
    curveData.t.length = 0; curveData.ke.length = 0; curveData.pe.length = 0;
    curveData.byId.clear(); curveData.epoch = -1; curveData.legendN = -1;
    _curveDrawT = 1;               // 开关/换模式立即重绘一次（不等 0.45s 节流拍）
    drawCurves();
  }
}
function setCurveMode(m) {
  if (curveMode === m) return;
  curveMode = m;
  $('curveTabMotion').classList.toggle('hot', m === 'motion');
  $('curveTabEnergy').classList.toggle('hot', m === 'energy');
  // 切模式清数据重采（两模式量纲不同，不共轴）
  curveData.t.length = 0; curveData.ke.length = 0; curveData.pe.length = 0;
  curveData.byId.clear(); curveData.epoch = -1; curveData.legendN = -1;
  updateCurveLegend();
  drawCurves();
}
function setTrails(on) {
  trailsOn = on;
  runtime.setTrails(on);
  viewport.setTrailsVisible(on);
  $('btnTrails').classList.toggle('hot', on);
}
function setCons(on) {
  consOn = on;
  $('consbar').classList.toggle('on', on);
  $('btnCons').classList.toggle('hot', on);
}

// ---------- 阿特伍德面板（张力 T 与两侧加速度） ----------
function updateAtwoodCons() {
  const a = atwoodInfo();
  if (!a) return;
  const g = Math.abs(doc.gravity || -9.81);
  // 位移二次拟合在初始暂态期不稳定（t<1.2s），显示采样中
  if (a.simT < 1.2) {
    ['cwM', 'cwT', 'cwAT', 'cwAM'].forEach((id) => { const el = $(id); if (el) el.textContent = '采样中'; });
    ['cwErr', 'cwTime'].forEach((id) => { const el = $(id); if (el) el.textContent = '--'; });
    return;
  }
  const aT = (a.m1 - a.m2) * g / (a.m1 + a.m2);
  const T = 2 * a.m1 * a.m2 * g / (a.m1 + a.m2);
  const err = Math.abs(a.aMeasured - aT) / Math.max(Math.abs(aT), 1e-9) * 100;
  setTxt($('cwM'), a.m1 + ' / ' + a.m2 + ' kg');
  setTxt($('cwT'), T.toFixed(3) + ' N');
  setTxt($('cwAT'), aT.toFixed(3) + ' m/s²');
  setTxt($('cwAM'), a.aMeasured.toFixed(3) + ' m/s²');
  setTxt($('cwErr'), err.toFixed(2) + '%');
  setSt($('cwErr'), 'color', err < 8 ? 'var(--accent)' : 'var(--danger)');
  setTxt($('cwTime'), 't=' + a.simT.toFixed(1) + 's');
}

// ---------- 天体守恒量（系统 E/Lz + 相对轨道几何） ----------
let astroBase = null;   // 基准 {epoch, E, L}（rebuild 换代即重取）

function astroInfo() {
  const G = doc.G || 6.674e-11;
  const bodies = runtime.getGravState().map((g) => {
    const e = getEntity(doc, g.id);
    return { id: g.id, m: g.m, pos: g.pos, vel: g.vel, name: e ? e.name : g.id };
  });
  if (bodies.length < 2) return null;
  let KE = 0, Lz = 0;
  for (const b of bodies) {
    KE += 0.5 * b.m * (b.vel[0] ** 2 + b.vel[1] ** 2 + b.vel[2] ** 2);
    Lz += b.m * (b.pos[0] * b.vel[2] - b.pos[2] * b.vel[0]);
  }
  let PE = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], c = bodies[j];
      const r = Math.hypot(a.pos[0] - c.pos[0], a.pos[1] - c.pos[1], a.pos[2] - c.pos[2]);
      if (r > 1e-9) PE -= G * a.m * c.m / r;
    }
  }
  const E = KE + PE;
  // 轨道几何：质量最小者绕质量最大者（相对轨迹）
  const sat = bodies.reduce((a, b) => (b.m < a.m ? b : a), bodies[0]);
  const cen = bodies.reduce((a, b) => (b.m > a.m ? b : a), bodies[0]);
  const pts = runtime.trails.get(sat.id);
  const cpt = runtime.trails.get(cen.id);
  let ecc = null, period = null, rmin = null, rmax = null;
  if (pts && cpt && pts.length === cpt.length && pts.length > 10) {
    const rel = pts.map((p, k) => [p[0] - cpt[k][0], p[1] - cpt[k][1], p[2] - cpt[k][2]]);
    const rs = rel.map((d) => Math.hypot(d[0], d[1], d[2]));
    rmin = Math.min(...rs);
    rmax = Math.max(...rs);
    if (rmin > 1e-6) ecc = (rmax - rmin) / (rmax + rmin);
    // 周期：相对方位角每绕完一圈发生 ±π 跳变（顺/逆时针都检测），相邻两次跳变的时间差即周期
    const jumps = [];
    for (let k = 1; k < rel.length; k++) {
      const a0 = Math.atan2(rel[k - 1][2], rel[k - 1][0]);
      const a1 = Math.atan2(rel[k][2], rel[k][0]);
      if (Math.abs(a1 - a0) > Math.PI) jumps.push(k);
    }
    if (jumps.length >= 2 && jumps[jumps.length - 1] > jumps[0]) {
      // 首尾跳变差 / 间隔数 = 单圈周期（跳变每圈一次）
      period = (jumps[jumps.length - 1] - jumps[0]) / (jumps.length - 1) * 2 * FIXED_H;   // 每 trail 点 = 2 步
    }
  }
  return { G, E, KE, PE, Lz, bodies: bodies.length, ecc, period, rmin, rmax };
}

// ---------- 转动守恒量（rotation 模式：转台+径向滑块等绕 y 系统） ----------
let rotationBase = null;   // {epoch, L, KE}
let momentumBase = null;   // {epoch, KE}

function rotationInfo() {
  const items = [];
  for (const b of runtime.binds.values()) {
    if (!b.body || b.entity.physics.body !== 'dynamic') continue;
    const e = b.entity;
    const p = b.body.translation(), v = b.body.linvel(), w = b.body.angvel();
    const m = b.body.mass();
    items.push({
      id: e.id, m, Iself: registry.inertiaYOf(e.type, e.params, m),
      pos: [p.x, p.y, p.z], vel: [v.x, v.y, v.z], wy: w.y,
    });
  }
  if (!items.length) return null;
  let Lz = 0, KE = 0, I = 0, iMax = -1;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    Lz += it.Iself * it.wy + it.m * (it.pos[2] * it.vel[0] - it.pos[0] * it.vel[2]);
    KE += 0.5 * it.m * (it.vel[0] ** 2 + it.vel[1] ** 2 + it.vel[2] ** 2) + 0.5 * it.Iself * it.wy ** 2;
    it.Itot = it.Iself + it.m * (it.pos[0] ** 2 + it.pos[2] ** 2);
    I += it.Itot;
    if (iMax < 0 || it.Iself > items[iMax].Iself) iMax = i;
  }
  const omega = iMax >= 0 ? items[iMax].wy : 0;
  let sliderR = null;
  for (const e of doc.entities) {
    for (const j of (e.joints || [])) {
      const it = items.find((x) => x.id === j.target);
      if (it) sliderR = Math.hypot(it.pos[0], it.pos[2]);
    }
  }
  return { Lz, KE, I, omega, sliderR, torque: 0, simT: runtime.simT };
}

function rotationWithDrift() {
  const r = rotationInfo();
  if (!r) return null;
  if (!rotationBase || rotationBase.epoch !== runtime.epoch) {
    rotationBase = { epoch: runtime.epoch, L: r.Lz, KE: r.KE, I: r.I, omega: r.omega };
  }
  return {
    ...r,
    L: r.Lz,                                  // 兼容别名（守恒量条/p4 断言用 L）
    driftL: Math.abs(r.Lz - rotationBase.L) / Math.max(Math.abs(rotationBase.L), 1e-12) * 100,
    base: rotationBase,
  };
}

function updateRotationCons() {
  const r = rotationWithDrift();
  if (!r) return;
  updateEnergyBar(r.KE / Math.max(rotationBase.KE, 1e-12));
  const dL = Math.abs(r.Lz - rotationBase.L) / Math.max(Math.abs(rotationBase.L), 1e-12) * 100;
  setTxt($('crOmega'), `${r.omega.toFixed(3)} rad/s`);
  setTxt($('crI'), `${r.I.toFixed(3)} kg·m²`);
  setTxt($('crL'), `${r.Lz.toFixed(3)} kg·m²/s`);
  setTxt($('crLdrift'), `${dL.toFixed(3)}%`);
  setSt($('crLdrift'), 'color', dL < 1 ? 'var(--accent)' : 'var(--danger)');
  setTxt($('crKE'), `${r.KE.toFixed(3)} J`);
  setTxt($('crR'), r.sliderR != null ? `${r.sliderR.toFixed(3)} m` : '--');
  setTxt($('crTorque'), '0（无外力矩）');
  setTxt($('crTime'), `t=${r.simT.toFixed(1)}s`);
}

function updateEnergyBar(rate, keFrac = 1) {
  const pct = Math.max(0, Math.min(rate, 1.5)) * 100 / 1.5;   // 条量程 0-150%，66.7% 刻度=100%
  // transform 合成器动画（WIG-Anim 不动 width/left）：fill=KE 段压左，fillpe=PE 段平移到 KE 段右侧再展开
  const keW = pct * keFrac, peW = pct * (1 - keFrac);
  setSt($('ebFill'), 'transform', `scaleX(${keW / 100})`);
  setSt($('ebFillPE'), 'transform', `translateX(${keW}%) scaleX(${peW / 100})`);
  setSt($('ebFill'), 'background', rate > 1.02 ? 'var(--text)' : 'var(--accent)');
  setTxt($('ebPct'), (rate * 100).toFixed(1) + '%');
}

function updateConsbar() {
  if (!consOn) return;
  const astro = doc.entities.some((e) => e.physics.gravitating);
  const atwood = !astro && doc.entities.some((e) => e.type === 'pulley');
  const rotation = !astro && !atwood && (doc.kind === 'rotation' || doc.entities.some((e) => e.physics.spinLock));   // PHY-34
  $('consMomentum').style.display = astro || rotation || atwood ? 'none' : 'grid';
  $('consAstro').style.display = astro ? 'grid' : 'none';
  $('consRotation').style.display = rotation ? 'grid' : 'none';
  $('consAtwood').style.display = atwood ? 'grid' : 'none';
  if (astro) { updateAstroCons(); return; }
  if (rotation) { updateRotationCons(); return; }
  if (atwood) { updateAtwoodCons(); return; }
  const live = runtime.systemTotals();
  if (!momentumBase || momentumBase.epoch !== runtime.epoch) {
    const en0 = runtime.energyTotals();
    momentumBase = { epoch: runtime.epoch, KE: en0.ke, E: en0.ke + en0.pe };
  }
  // 能量保持口径=总机械能 E/E0（energyTotals：KE+重力势+弹性势，与曲线能量模式同源）：
  // 纯 KE/KE0 在斜面类增速场景会飙出荒谬读数（能量保持 3044%——视觉门实测），
  // E 守恒口径天然有界；悬浮对撞场景 PE 恒 0，退化为原 KE 口径不受影响
  const en = runtime.energyTotals();
  if (momentumBase.E < 0.05) {
    // 初始 E≈0（无动态体/全悬浮静止）：保持率无意义，隐藏比例条数字
    setSt($('ebFill'), 'transform', 'scaleX(0)');
    setTxt($('ebPct'), '基准≈0');
  } else {
    const keFrac = en.ke + en.pe > 0 ? Math.max(0, Math.min(1, en.ke / (en.ke + en.pe))) : 1;
    updateEnergyBar((en.ke + en.pe) / momentumBase.E, keFrac);   // KE/PE 分段随实时占比
  }
  setTxt($('cbP'), `${live.p[0].toFixed(3)} N·s`);
  setTxt($('cbKE'), `${live.ke.toFixed(3)} J`);
  const rep = runtime.collisionReports[runtime.collisionReports.length - 1];
  if (!rep) {
    setTxt($('cbT'), '尚无碰撞');
    setTxt($('cbPerr'), '--');
    ['cbPb', 'cbPa', 'cbKEb', 'cbKEa'].forEach((id) => { setTxt($(id), '--'); });
    return;
  }
  setTxt($('cbT'), `t=${rep.t.toFixed(3)}s`);
  const pB = rep.pBefore[0], pA = rep.pAfter[0];
  const err = Math.abs(pB) > 1e-9 ? Math.abs(pA - pB) / Math.abs(pB) * 100 : 0;
  setTxt($('cbPerr'), `${err.toFixed(3)}%`);
  setSt($('cbPerr'), 'color', err < 1 ? 'var(--accent)' : 'var(--danger)');
  setTxt($('cbPb'), `${pB.toFixed(3)} N·s`);
  setTxt($('cbPa'), `${pA.toFixed(3)} N·s`);
  setTxt($('cbKEb'), `${rep.keBefore.toFixed(3)} J`);
  setTxt($('cbKEa'), `${rep.keAfter.toFixed(3)} J`);
}

// 阿特伍德遥测：重侧位移二次拟合加速度（y = ½at² + v0t + y0，三点拟合足够）
function atwoodInfo() {
  const pairs = runtime._pulleyPairs || [];
  if (!pairs.length) return null;
  const pair = pairs[0];
  const [a, b] = pair.balls;
  const pa = a.body.translation(), pb = b.body.translation();
  const m1 = a.m, m2 = b.m;
  // 位移：重侧下降量 d = (y0_重 − y_重)（下落为正）
  const y0Heavy = m1 > m2 ? a.y0 : b.y0;
  const yHeavyNow = m1 > m2 ? pa.y : pb.y;
  const d = Math.max(y0Heavy - yHeavyNow, 1e-6);
  const aFit = 2 * d / Math.max(runtime.simT * runtime.simT, 1e-6);
  return {
    m1, m2, aMeasured: +aFit.toFixed(4), drop: +d.toFixed(4),
    g: Math.abs(doc.gravity || -9.81), simT: runtime.simT, heavyIsLeft: m1 > m2,
  };
}

function astroWithDrift() {
  const a = astroInfo();
  if (!a) return null;
  if (!astroBase || astroBase.epoch !== runtime.epoch) astroBase = { epoch: runtime.epoch, E: a.E, L: a.Lz };
  return {
    ...a, simT: runtime.simT,
    driftE: Math.abs(a.E - astroBase.E) / Math.max(Math.abs(astroBase.E), 1e-12) * 100,
    driftL: Math.abs(a.Lz - astroBase.L) / Math.max(Math.abs(astroBase.L), 1e-12) * 100,
  };
}

function updateAstroCons() {
  const a = astroWithDrift();
  if (!a) return;
  updateEnergyBar(a.E / astroBase.E, a.KE / Math.max(a.KE + Math.abs(a.PE), 1e-12));   // KE/PE 构成分色
  const dE = Math.abs(a.E - astroBase.E) / Math.max(Math.abs(astroBase.E), 1e-12) * 100;
  const dL = Math.abs(a.Lz - astroBase.L) / Math.max(Math.abs(astroBase.L), 1e-12) * 100;
  setTxt($('caE'), `${a.E.toFixed(3)} J`);
  setTxt($('caEdrift'), `${dE.toFixed(3)}%`);
  setSt($('caEdrift'), 'color', dE < 2 ? 'var(--accent)' : 'var(--danger)');
  setTxt($('caL'), `${a.Lz.toFixed(3)} kg·m²/s`);
  setTxt($('caLdrift'), `${dL.toFixed(3)}%`);
  setSt($('caLdrift'), 'color', dL < 2 ? 'var(--accent)' : 'var(--danger)');
  setTxt($('caEcc'), a.ecc != null ? a.ecc.toFixed(3) : '--');
  setTxt($('caT'), a.period != null ? `${a.period.toFixed(2)} s` : '采样中');
  setTxt($('caR'), a.rmin != null ? `${a.rmin.toFixed(2)} / ${a.rmax.toFixed(2)} m` : '--');
  setTxt($('caTime'), `t=${runtime.simT.toFixed(1)}s`);
}

// ============ 底栏读数 + 检查器实时区 ============
let roTimer = 0;
const _beatAcc = { t: 0 };
let _pcTrailsAuto = false;   // MOD-502：双摆解释临时开的轨迹   // FX-524 节拍累时
const _beatDots = [];        // FX-524 节拍点池(≤64)
function _measuredMainId() {
  for (const e of doc.entities) if (e.measured) return e.id;
  return null;
}
let _seenReports = 0;
let _liveEls = null;      // PL-51：liveGrid 读数元素缓存（原每项每轮 querySelector）
const _livePrev = {};       // FX-553：上一拍数值（变化率检测）
const _liveFlash = {};      // FX-553：脉冲计时器句柄
const _ropeTautT = new Map();   // FX-541：每绳绷紧音冷却时间戳
function liveEls() {
  if (_liveEls) return _liveEls;
  const grid = document.getElementById('liveGrid');
  _liveEls = { grid, map: new Map() };
  if (grid) {
    for (const el of grid.querySelectorAll('[data-lv]')) _liveEls.map.set(el.dataset.lv, el);
  }
  return _liveEls;
}
function updateReadouts() {
  setTxt($('roT'), runtime.simT.toFixed(3));
  setTxt($('roN'), String(doc.entities.length));
  const e = selectedId ? getEntity(doc, selectedId) : null;
  const roSel = $('roSel');
  if (!e) { setTxt(roSel, '未选中'); if (roSel) roSel.title = ''; }
  else {
    const t = runtime.telemetry(e.id);
    // UI-543：动量带单位（与其余读数口径一致）
    const selTxt = t
      ? `${e.name}  v=${t.speed.toFixed(2)}m/s  h=${t.height.toFixed(2)}m  |p|=${t.momentum.toFixed(2)}N·s`
      : `${e.name}  仅视觉`;
    setTxt(roSel, selTxt);
    if (roSel) roSel.title = selTxt;   // UI-542：截断时悬停读全文
    const { grid, map } = liveEls();
    if (grid) {
      // FX-553：数值流动高亮——变化率超阈值的行 150ms 琥珀脉冲（读数「活」了,静止=常态、突变=亮）
      const set = (k, v) => {
        const el = map.get(k);
        if (!el) return;
        setTxt(el, v);
        const pv = _livePrev[k];
        const nv = Number(v);
        if (pv != null && Number.isFinite(nv) && Math.abs(nv - pv) > Math.max(Math.abs(pv) * 0.05, 0.02)) {
          el.style.color = 'var(--accent-hi)';
          clearTimeout(_liveFlash[k]);
          _liveFlash[k] = setTimeout(() => { if (el.isConnected) el.style.color = ''; }, 150);
        }
        if (Number.isFinite(nv)) _livePrev[k] = nv;
      };
      if (t) {
        set('speed', t.speed.toFixed(3));
        set('height', t.height.toFixed(3));
        set('dist', (t.dist || 0).toFixed(3));   // U-READ：累计路程（标量,非位移）
        set('mass', t.mass.toFixed(2));
        set('momentum', t.momentum.toFixed(3));
        set('keTrans', t.keTrans.toFixed(3));
        set('omega', Math.hypot(t.angvel[0], t.angvel[1], t.angvel[2]).toFixed(2));   // UI-540：单位口径统一进格内（.u2）
        set('vel', `[${t.vel[0].toFixed(2)}, ${t.vel[1].toFixed(2)}, ${t.vel[2].toFixed(2)}]`);
        const col = runtime.lastCollisionFor(e.id);
        set('coll', col ? `t=${col.t.toFixed(2)}s` : '无');
        // 滚动状态（Goal 六「滚动或滑动状态」）：|v| vs |ω|r 判定（r 已知且角速度非零才有意义）
        const r = e.params && e.params.radius;
        const w = Math.hypot(t.angvel[0], t.angvel[1], t.angvel[2]);
        if (r > 0 && t.speed > 0.02) {
          const vr = w * r;
          const rel = Math.abs(t.speed - vr) / Math.max(t.speed, vr);
          set('roll', rel < 0.08 ? `纯滚动 (ωr=${vr.toFixed(2)})` : `滑动 (ωr=${vr.toFixed(2)})`);
        } else {
          set('roll', t.speed <= 0.02 ? '静止' : '—');
        }
      } else {
        // UI-539：编辑态「待运行」区别于真零值（运行中无数据仍是 --）
        const nd = mode === 'run' ? '--' : '待运行';
        ['speed', 'height', 'mass', 'momentum', 'keTrans', 'omega', 'vel', 'coll', 'roll'].forEach((k) => set(k, nd));
      }
    }
  }
}

// ============ 时间曲线（多实体速率/高度 + 系统KE） ============
function sampleCurves() {
  if (curveData.epoch !== runtime.epoch) {   // rebuild 后重采
    curveData.epoch = runtime.epoch;
    curveData.t.length = 0; curveData.ke.length = 0; curveData.pe.length = 0;
    curveData.byId.clear(); curveData.legendN = -1;
  }
  curveData.t.push(runtime.simT);
  const en = runtime.energyTotals();
  curveData.ke.push(en.ke);
  curveData.pe.push(en.pe);
  for (const e of doc.entities) {
    if (e.physics.body !== 'dynamic' || e.visible === false) continue;
    let sr = curveData.byId.get(e.id);
    if (!sr) { sr = { name: e.name, speed: [], height: [] }; curveData.byId.set(e.id, sr); }
    const t = runtime.telemetry(e.id);
    sr.speed.push(t ? t.speed : 0);
    sr.height.push(t ? t.height : 0);
  }
  if (curveData.t.length > 300) {
    curveData.t.shift(); curveData.ke.shift(); curveData.pe.shift();
    for (const sr of curveData.byId.values()) { sr.speed.shift(); sr.height.shift(); }
  }
  // 图例跟数据走（采样侧即时刷新——PL-52 解耦后画布 0.45s 节流不再携带图例更新）
  const legendKey = curveMode + ':' + curveData.byId.size;
  if (curveData.legendN !== legendKey) {
    curveData.legendN = legendKey;
    updateCurveLegend();
  }
  // PL-52：采样（0.15s，数据必须连续）与重绘（0.45s，canvas 全幅重画贵）解耦节流
  _curveDrawT += 0.15;
  if (_curveDrawT >= 0.45) { _curveDrawT = 0; drawCurves(); }
}

let _curveDrawT = 1;   // 初值 1：首次采样后立即出图

function drawCurves() {
  const cv = $('curveCanvas');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const n = curveData.t.length;
  if (n < 2) {
    // UI-577：空画布给说明，不再一块纯黑
    ctx.fillStyle = 'rgba(160, 168, 180, 0.7)';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('运行后记录曲线', W / 2, H / 2 + 4);
    return;
  }
  let vmax = 1e-9;
  for (const v of curveData.ke) if (Math.abs(v) > vmax) vmax = Math.abs(v);
  if (curveMode === 'energy') {
    for (const v of curveData.pe) if (Math.abs(v) > vmax) vmax = Math.abs(v);
  } else {
    for (const sr of curveData.byId.values()) {
      for (const v of sr.speed) if (Math.abs(v) > vmax) vmax = Math.abs(v);
      for (const v of sr.height) if (Math.abs(v) > vmax) vmax = Math.abs(v);
    }
  }
  const t0 = curveData.t[0], t1 = curveData.t[n - 1];
  const span = Math.max(t1 - t0, 1e-6);
  // PL-52：取值函数代替数组参数——能量总 E 线不再 ke.map() 新分配（每次重绘 300 元素数组）
  const trace = (get, color, dash) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = ((curveData.t[i] - t0) / span) * (W - 8) + 4;
      const y = H - 6 - (Math.abs(get(i)) / vmax) * (H - 12);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (curveMode === 'energy') {
    // 能量堆叠对照（Goal 第九章「能量曲线」）：KE 绿 / PE 蓝 / 总 E 金——
    // 光滑场景 E 平线（守恒可视），摩擦/非弹性碰撞场景 E 阶跃衰减
    trace((i) => curveData.ke[i], '#7dc87d');
    trace((i) => curveData.pe[i], '#5b8dd9');
    trace((i) => curveData.ke[i] + curveData.pe[i], '#d9a441');
  } else {
    let i = 0;
    for (const sr of curveData.byId.values()) {
      const c = CURVE_PALETTE[i % CURVE_PALETTE.length];
      trace((j) => sr.speed[j], c);              // 速率：实线
      trace((j) => sr.height[j], c, [3, 3]);     // 高度：同色虚线
      i++;
    }
    trace((j) => curveData.ke[j], '#7dc87d');    // 系统KE：绿实线
  }
  // FX-554：实时游标——当前时刻竖线+系统KE 末端圆点+最新值文本（扫一眼就知道「现在」在哪）
  {
    const xNow = ((curveData.t[n - 1] - t0) / span) * (W - 8) + 4;
    ctx.strokeStyle = 'rgba(231, 189, 104, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xNow, 2); ctx.lineTo(xNow, H - 2);
    ctx.stroke();
    const keNow = curveData.ke[n - 1];
    const yNow = H - 6 - (Math.abs(keNow) / vmax) * (H - 12);
    ctx.fillStyle = '#e7bd68';
    ctx.beginPath();
    ctx.arc(xNow, yNow, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = xNow > W - 64 ? 'right' : 'left';
    const label = curveMode === 'energy'
      ? `E=${(curveData.ke[n - 1] + curveData.pe[n - 1]).toFixed(2)}J`
      : `KE=${keNow.toFixed(2)}J`;
    ctx.fillText(label, xNow + (xNow > W - 64 ? -5 : 5), Math.max(12, yNow - 6));
  }
}

function updateCurveLegend() {
  const el = $('curveLegend');
  if (!el) return;
  el.innerHTML = '';
  // UI-578：色块用 span::before + currentColor 实现（不增 DOM 节点，p15/p22 的 span 计数与文案断言保持）
  if (curveMode === 'energy') {
    // 能量模式图例（量纲 J；重力势能基准 y=0，天体引力势能口径属守恒量条）
    for (const [txt, c] of [['动能KE', '#7dc87d'], ['势能PE', '#5b8dd9'], ['总能量E', '#d9a441']]) {
      const sp = document.createElement('span');
      sp.style.color = c;
      sp.textContent = txt;
      el.appendChild(sp);
    }
    return;
  }
  let i = 0;
  for (const sr of curveData.byId.values()) {
    const c = CURVE_PALETTE[i % CURVE_PALETTE.length];
    // 括号注记（如"入射球 (e=1)"）在图例里是复读噪声：只留主名，速率/高度关键词保留（p22 断言依赖）
    const base = sr.name.replace(/\s*\([^)]*\)\s*$/, '').trim() || sr.name;
    const sp = document.createElement('span');
    sp.style.color = c;
    sp.textContent = `${base}速率`;
    const hp = document.createElement('span');
    hp.style.color = c;
    hp.textContent = `${base}高度`;
    el.append(sp, hp);
    i++;
  }
  const ke = document.createElement('span');
  ke.style.color = '#7dc87d';
  ke.textContent = '系统KE';
  el.appendChild(ke);
}

// ============ 单位标尺动态刻度（档位 0.1/0.5/1/5 m 随视野自适应，网格视觉密度联动） ============
const GRID_STEPS = [0.1, 0.5, 1, 5];
let gridStep = 1;
function updateScaleReadout() {
  const el = $('scaleReadout');
  if (!el) return;
  // UI-611：ghost 跟随期的吸附状态条——独立小签(画布左下角),不占用 scaleReadout
  // (替换式曾让 p10 标尺断言误吃——标尺与吸附是并行的两件事,共存而非顶替)
  {
    const gs = viewport.ghostState();
    let tag = document.getElementById('snapTag');
    if (gs.visible && gs.follow) {
      if (!tag) {
        tag = document.createElement('div');
        tag.id = 'snapTag';
        tag.style.cssText = 'position:fixed;left:12px;bottom:calc(var(--simbar-h) + 12px);z-index:40;font-family:var(--mono);font-size:11px;color:var(--accent-hi);background:rgba(18,20,24,.88);border:1px solid var(--line);border-radius:6px;padding:2px 10px;pointer-events:none;white-space:nowrap';
        document.body.appendChild(tag);
      }
      const LBL = { grid: '网格 0.5m', surface: '表面', endpoint: '端点', center: '质心', off: '关闭' };
      tag.style.display = 'block';
      tag.textContent = `吸附：${LBL[gs.snapMode] || gs.snapMode}${gs.snapped ? ' · 已吸附' : ''}`;
    } else if (tag) tag.style.display = 'none';
  }
  // UI-604：网格隐藏时读数改说真话（网格/轴都被 setGridVisible 关掉）
  if (viewport._gridOn === false) { setTxt(el, '网格已隐藏'); return; }
  const cam = viewport.camera;
  const viewW = cam.isOrthographicCamera
    ? (cam.right - cam.left) / (cam.zoom || 1)
    : 2 * cam.position.distanceTo(viewport.controls.target) * Math.tan((cam.fov || 42) * Math.PI / 360);
  // 档位自适应（逐档收敛；阈值比 42/8=5.25 > 相邻档位比 5 → 无震荡区间）
  const idx = GRID_STEPS.indexOf(gridStep);
  const cells0 = viewW / gridStep;
  if (cells0 > 42 && idx < GRID_STEPS.length - 1) gridStep = GRID_STEPS[idx + 1];
  else if (cells0 < 8 && idx > 0) gridStep = GRID_STEPS[idx - 1];
  viewport.setGridScale(gridStep);
  const cells = viewW / gridStep;
  el.textContent = `网格 1 格 = ${gridStep} m · 视野宽约 ${viewW.toFixed(1)} m ≈ ${cells.toFixed(1)} 格`;   // UI-605：全角分隔换 ·，mono 等宽对齐
}

// ============ 录制 / 回放 ============
let replaying = false;
let replayIdx = 0;
let scrubbing = false;   // 回放时间轴拖动中：暂停自动推进，逐帧由 oninput 驱动
let _replayAcc = 0;      // FEEL-99 收编：帧数据 60Hz 采样（every:2×1/120s），墙钟配速推进——
                         // 旧 round(rawDt*60)+max(1) 钳制在高刷屏变倍速（240Hz=4x）

let _recTimer = 0;   // UI-566：录制时长读数
function toggleFrameRec() {
  if (replaying) { stopReplay(); return; }
  if (runtime.recFrames) {
    runtime.recFrames = false;
    clearInterval(_recTimer);
    $('btnRec').classList.remove('hot');
    setBtnText('btnRec', '录制');
    $('btnReplay').disabled = runtime.frames.length < 2;
    toast(`已录制 ${runtime.frames.length} 帧`);
  } else {
    if (mode !== 'edit') resetSim();
    runtime.frames = [];
    runtime.recFrames = true;
    $('btnRec').classList.add('hot');
    setBtnText('btnRec', '停止录制');
    const recStart = performance.now();
    clearInterval(_recTimer);
    _recTimer = setInterval(() => {   // UI-566：录制中有秒数反馈
      if (!runtime.recFrames) { clearInterval(_recTimer); return; }
      setBtnText('btnRec', `停止 ${((performance.now() - recStart) / 1000).toFixed(0)}s`);
    }, 1000);
    play();
    toast('录制中（最长约 30s）');
  }
}

function startReplay() {
  if (replaying) return;
  if (runtime.recFrames) { toast('正在录制——先点「停止录制」再回放', 'warn'); return; }   // UI-607：录制中回放会互踩
  if (runtime.frames.length < 2) { toast('请先录制'); return; }
  replaying = true;
  replayIdx = 0;
  scrubbing = false;
  _replayAcc = 0;
  mode = 'run';
  paused = false;
  perfMon.reset();
  viewport.setGizmoEnabled(false);
  $('btnReplay').classList.add('hot');
  const bar = $('replayBar');
  bar.max = Math.max(1, runtime.frames.length - 1);
  bar.value = 0;
  bar.style.display = 'block';
  const rf = $('roFrame');
  if (rf) rf.style.display = '';   // UI-567：逐帧检查要有帧号读数
  updateReplayFrameReadout();
  updateSimbarStatic();
  toast('回放中（拖动时间轴可逐帧检查，结束后自动恢复编辑态）');
}

// UI-567：帧号读数（拖动/自动推进共用）
function updateReplayFrameReadout() {
  const rf = $('roFrame');
  if (rf) setTxt(rf, `帧 ${replayIdx + 1}/${runtime.frames.length}`);
}

function stopReplay() {
  replaying = false;
  scrubbing = false;
  $('replayBar').style.display = 'none';
  const rf = $('roFrame');
  if (rf) rf.style.display = 'none';
  mode = 'edit';
  paused = false;
  viewport.setGizmoEnabled(true);
  $('btnReplay').classList.remove('hot');
  $('btnReplay').disabled = false;
  rebuildAll();
  updateSimbarStatic();
}

// ============ 声音（层 1，PL-1..8） ============
const sound = new SoundEngine();
// autoplay 合规：AudioContext 只在可信手势里创建/resume——评估脚本触发的 play() 保持静默
window.addEventListener('pointerdown', () => sound.unlock());
window.addEventListener('keydown', () => sound.unlock());
function setSound(on) {
  sound.setMuted(!on);
  const btn = $('btnSound');
  btn.classList.toggle('hot', sound.muted === false);
  setBtnText('btnSound', sound.muted ? '静音' : '音效');
  btn.title = sound.muted ? '声音已关——点击开启碰撞/状态音效' : '声音开启中——点击静音（状态会记住）';
}
// 碰撞 juice（层 3，PL-20..22）：粒子池 + 震屏 + 升级碰撞环；场景就绪后在 init 里构造
let juice = null;
function setShake(on) {
  if (juice) juice.setShake(on);
  const btn = $('btnShake');
  if (btn) {
    btn.classList.toggle('hot', juice ? juice.shakeOn === true : false);
    btn.title = juice && juice.shakeOn ? '震屏开启中——点击关闭（重击才抖）' : '震屏已关——点击开启碰撞镜头微震';   // UI-572 对齐 btnSound 动态开关文案
  }
}

// ============ 运行中交互（层 2，PL-10..14） ============
// 抓取：容器捕获级 pointerdown 先于 OrbitControls（canvas 子元素监听）——命中动态体即
// stopPropagation 独占手势；拖拽目标 = 指针射线与「过抓取点、法向=视线」平面的交点。
// 甩出：最近 ~80ms 指针轨迹速度 0.7 + 体当前速度 0.3 混合（按住不动松手=直掉对照组）。
let grab = null;          // {id, planeNormal, planePt}；runtime._grab 持物理态
let _ptrTrail = [];       // [{t, x,y,z}] 80ms 指针世界轨迹环
let lastThrow = null;     // 最近一次松手诊断 {vPtr, vBody, vFinal}（p33 断言/调参用）
const THROW_BLEND = 0.7;
const THROW_VMAX = 14;
function releaseGrabAt() {
  if (!grab) return;
  const g = grab;
  grab = null;
  viewport.container.style.cursor = '';
  document.getElementById('modeChip').classList.remove('grab');
  // 80ms 指针轨迹速度（采样跨度 ≥25ms 才有效；几乎没动=零操作继承，按住不动松手=直掉）
  const now = performance.now() / 1000;
  while (_ptrTrail.length && now - _ptrTrail[0].t > 0.08) _ptrTrail.shift();
  const tel = runtime.telemetry(g.id);
  const vb = tel ? tel.vel : [0, 0, 0];
  let vPtr = null;
  let vThrow = null;
  if (_ptrTrail.length >= 2) {
    const a = _ptrTrail[0], b = _ptrTrail[_ptrTrail.length - 1];
    const dt = b.t - a.t;
    if (dt >= 0.025) {
      const cand = [(b.x - a.x) / dt, (b.y - a.y) / dt, (b.z - a.z) / dt];
      const sp = Math.hypot(cand[0], cand[1], cand[2]);
      if (sp > THROW_VMAX) { const k = THROW_VMAX / sp; vPtr = [cand[0] * k, cand[1] * k, cand[2] * k]; }
      else if (sp >= 0.3) vPtr = cand;
      if (vPtr) vThrow = [0, 1, 2].map((i) => vPtr[i] * THROW_BLEND + vb[i] * (1 - THROW_BLEND));
    }
  }
  _ptrTrail = [];
  lastThrow = { vPtr, vBody: vb, vFinal: vThrow || vb, t: now };
  runtime.releaseGrab(vThrow);
  // 抓取高亮清掉，恢复选中高亮
  viewport.setHighlights(selectedIds.length ? selectedIds : []);
}
function onRunPointerDown(ev) {
  if (mode !== 'run' || paused || ev.button !== 0) return;
  const hit = viewport.pickDynamic(ev.clientX, ev.clientY);
  if (!hit) return;                                  // 空处拖拽=转视角（不拦截）
  const b = runtime.binds.get(hit.id);
  if (!b || !b.body || b.entity.physics.body !== 'dynamic') return;
  if (!runtime.grabBody(hit.id)) return;
  ev.stopPropagation();                              // 独占：本轮拖拽不转相机不触发选择
  ev.preventDefault();
  viewport.controls.enabled = false;
  const n = new THREE.Vector3();
  viewport.camera.getWorldDirection(n);
  const pt = new THREE.Vector3(hit.point[0], hit.point[1], hit.point[2]);
  grab = { id: hit.id, normal: n, planePt: pt };
  _ptrTrail = [];
  viewport.container.style.cursor = 'grabbing';
  document.getElementById('modeChip').classList.add('grab');
  viewport.setHighlights([hit.id]);
  const move = (e2) => {
    if (!grab) return;
    const p = viewport.rayOnPlane(e2.clientX, e2.clientY, grab.normal, grab.planePt);
    if (!p) return;
    runtime.moveGrabTarget(p);
    _ptrTrail.push({ t: performance.now() / 1000, x: p[0], y: p[1], z: p[2] });
    viewport.markDirty();
  };
  const up = (e2) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    viewport.controls.enabled = true;
    releaseGrabAt();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
function bindRunGrab() {
  viewport.container.addEventListener('pointerdown', onRunPointerDown, true);   // 捕获级：先于 canvas 上的 OrbitControls
}

// ============ 叠加层条目池（PL-53/54 零分配） ============
// tick 每帧为各叠加层构建 items——原先每帧 new 数组/对象/Vector3 是 GC 稳定来源，
// 表现为秒级周期性帧尖峰。池条目跨帧复用，帧首 reset、帧尾 trim。
function mkPool(shape) {
  const arr = [];
  let n = 0;
  return {
    list: arr,
    reset() { n = 0; },
    next() { if (n >= arr.length) arr.push(shape()); return arr[n++]; },
    retract() { n--; },                 // next 后发现无效（如遥测缺失）退回槽位
    trim() { arr.length = n; },
  };
}
const POOL_TEL = mkPool(() => ({ pos: [0, 0, 0], vel: [0, 0, 0], angvel: [0, 0, 0], speed: 0, mass: 0, momentum: 0, keTrans: 0, height: 0 }));
const POOL_NORM = mkPool(() => ({ pos: [0, 0, 0], dir: [0, 0, 0] }));
const POOL_FORCE = mkPool(() => ({ pos: null, contact: null, gravity: [0, 0, 0], accel: null, normal: [0, 0, 0], friction: [0, 0, 0] }));
const POOL_TENS = mkPool(() => ({ aPos: [0, 0, 0], bPos: [0, 0, 0], tA: 0, tB: 0 }));
const POOL_SPRING = mkPool(() => ({ aPos: [0, 0, 0], bPos: [0, 0, 0], fA: [0, 0, 0], k: 0, len: 0, stretch: 0, F: 0, aName: '', bName: '' }));
const POOL_JOINT = mkPool(() => ({ from: [0, 0, 0], to: [0, 0, 0], ok: true }));
const _ZERO3 = [0, 0, 0];
const _nvN = new THREE.Vector3(), _nvP = new THREE.Vector3();   // 斜坡法线 scratch

// ============ 帧预算仪表（PL-50） + 自适应画质档（PL-56/58） ============
const perfMon = new PerfMon(2400);   // 240Hz 屏 × 10s 全覆盖（30s 采样窗的最近 10s 样本）
let _fps = 60;                  // rAF 实测帧率 EMA
let _perfHudT = 0;
let perfHudOn = true;           // HUD 常开（验收形式），可关，localStorage 持久
let qTier = 2;                  // 自适应档（0/1/2），只动分辨率与阴影
let _tierT = 0, _tierUpStreak = 0;
let _bootFrames = 0;            // 启动预热帧计数（前 120 渲染帧不进预算样本）
function setPerfHud(on) {
  perfHudOn = !!on;
  try { localStorage.setItem('mech.perfhud', perfHudOn ? '1' : '0'); } catch (e) { /* 隐私模式忽略 */ }
  const el = $('perfHud');
  if (el) el.style.display = perfHudOn ? 'block' : 'none';
  const btn = $('btnPerf');
  if (btn) btn.classList.toggle('hot', perfHudOn);
}
// 每帧收口：渲染帧提交分段样本；HUD 0.25s 节流拼串（脏检查后才写 DOM）；1s 窗口评估降/升档
function tickPerfHud(rawDt, rendered, phys, ov, rnd, dom) {
  if (rendered) {
    if (_bootFrames < 60) { _bootFrames++; }   // 预热豁免：内核编译/首帧资源不进预算窗（60 帧=60fps 机 1s；弱机 6s 起即见数据）
    else perfMon.commit({ frame: phys + ov + rnd + dom, physics: phys, overlay: ov, render: rnd, dom, calls: viewport.drawCalls, tris: viewport.triangles });
  }
  _perfHudT += rawDt;
  if (_perfHudT < 0.25) return;
  _perfHudT = 0;
  _tierT += 0.25;
  if (_tierT >= 1) {
    _tierT = 0;
    if (mode === 'run' && !paused && perfMon.n > 120) {
      const s = perfMon.summary(240);
      if (s && qTier > 0 && s.frame.p95 > 5) {           // 欠载：降档（先降阴影后降分辨率，setQualityTier 内部实现）
        qTier--; viewport.setQualityTier(qTier); _tierUpStreak = 0;
      } else if (s && qTier < 2 && s.frame.p95 < 2.2 && s.spike8 === 0) {
        if (++_tierUpStreak >= 4) { qTier++; viewport.setQualityTier(qTier); _tierUpStreak = 0; }   // 余量充足 4s 后升档
      } else {
        _tierUpStreak = 0;
      }
    } else if (mode === 'edit' && qTier !== 2) {
      qTier = 2; viewport.setQualityTier(2);             // 编辑态永远满画质
    }
  }
  if (!perfHudOn) return;
  const s = perfMon.summary(600);
  let html;
  if (!s) {
    html = '<div class="ph-sec">PERF</div><div class="ph-row"><span class="k">状态</span><span class="v">待运行采样…</span></div>';
  } else {
    const row = (k, v, cls) => `<div class="ph-row"><span class="k">${k}</span><span class="v${cls || ''}">${v}</span></div>`;
    const spike = s.spike8 ? `<span class="warn">&gt;8ms×${s.spike8}</span>` : '';
    html = `<div class="ph-hd"><b>${Math.round(_fps)}</b><span class="u">FPS</span>${spike}</div>`
      + '<div class="ph-sec">帧预算</div>'
      + row('p50', `<b>${s.frame.p50.toFixed(2)}</b><span class="u2">ms</span>`)
      + row('p95', `<b>${s.frame.p95.toFixed(2)}</b><span class="u2">ms</span>`, s.frame.p95 > 5 ? ' bad' : '')
      + row('1%低', s.frame.low1.toFixed(2) + '<span class="u2">ms</span>')
      + row('峰值', s.frame.max.toFixed(2) + '<span class="u2">ms</span>', s.frame.max > 8 ? ' bad' : '')
      + '<div class="ph-sec">分段 p95</div>'
      + row('物理', s.physics.p95.toFixed(2) + '<span class="u2">ms</span>')
      + row('叠加', s.overlay.p95.toFixed(2) + '<span class="u2">ms</span>')
      + row('渲染', s.render.p95.toFixed(2) + '<span class="u2">ms</span>')
      + row('DOM', s.dom.p95.toFixed(2) + '<span class="u2">ms</span>')
      + (juice ? '<div class="ph-sec">FX</div>'
        + row('瞬时', `粒子 <b>${juice.state().alive}</b> · 环 ${juice.state().rings} · 震 ${juice.state().trauma}`) : '')
      + '<div class="ph-sec">画面</div>'
      + row('Draw', String(s.calls))
      + row('三角', (s.tris / 1000).toFixed(0) + 'k')
      + row('画质档', 'Q' + qTier);
  }
  const el = $('perfHud');
  if (el && el.__t !== html) { el.__t = html; el.innerHTML = html; }
}

// ============ 主循环 ============
let _lastFrameT = performance.now();   // 手动 delta（THREE.Clock r186 起弃用告警，语义等价）
function tick() {
  requestAnimationFrame(tick);
  const _now = performance.now();
  const rawDtRaw = (_now - _lastFrameT) / 1000;
  const rawDt = Math.min(rawDtRaw, 0.05);   // sim 步进钳 50ms：maxStepsPerFrame 饱和点不漂（慢放比率标定口径）
  _lastFrameT = _now;
  if (!appReady) return;
  if (rawDt > 0) _fps += (Math.min(1 / rawDt, 240) - _fps) * 0.06;
  const _t0 = performance.now();
  if (replaying) {
    if (!scrubbing) {
      // 墙钟配速用宽钳 100ms：SwiftShader/弱GPU 低至 10fps 仍守 60 帧/s 回放（FEEL-99）；
      // 只影响回放推进（帧数据应用无饱和问题），sim 步进仍走上面 50ms 钳
      _replayAcc += Math.min(rawDtRaw, 0.1) * 60;
      const adv = Math.floor(_replayAcc);
      _replayAcc -= adv;
      if (adv > 0) replayIdx += adv;
    }
    if (replayIdx >= runtime.frames.length) { stopReplay(); }
    else {
      runtime.applyFrame(replayIdx);
      $('replayBar').value = replayIdx;
      updateReplayFrameReadout();   // UI-567
    }
    viewport.markDirty();
  } else if (mode === 'run' && !paused) {
    // FX-581/531：子弹时间缓动 + 伪景深（雾近距收紧 + vignette 随缓动进出）
    {
      const bptTarget = (autoBPT && mode === 'run' && !paused && performance.now() < _bptUntil) ? 1 : 0;
      _bptEase += (bptTarget - _bptEase) * Math.min(1, rawDtRaw * 6);   // 时间驱动（帧率无关）：~0.5s 收敛，弱机低 fps 也来得及停稳 0.25x
      if (bptTarget === 0 && _bptEase < 0.01) _bptEase = 0;
      else if (bptTarget === 1 && _bptEase > 0.99) _bptEase = 1;
      viewport.setBptDepth(_bptEase);
      const vg = document.getElementById('vignette');
      if (vg) {
        const o = Math.round(_bptEase * 300) / 1000;
        if (vg.__o !== o) { vg.__o = o; vg.style.opacity = o; }
      }
    }
    const tsEff = effectiveTimeScale();
    runtime.advance(rawDt * tsEff, maxStepsPerFrame(tsEff));
    viewport.markDirty();
    // 子弹时间窗口收尾：恢复徽标
    if (_bptUntil && performance.now() >= _bptUntil) { _bptUntil = 0; updateSimbarStatic(); }
  }
  const _tPhys = performance.now();
  viewport.tickZoom();            // PL-42 平滑缩放收敛（在 controls.update 前，阻尼不冲突）
  if (!viewport.updateFly()) viewport.controls.update();   // 漫游态接管相机；阻尼收敛期持续触发 change→脏
  viewport.tickFocus();
  viewport.tickPose();
  if (viewport._focusAnim || viewport._poseAnim || (juice && juice.needsFrame())) viewport.markDirty();
  // 叠加层的状态字必须每帧同步（不能落进脏区：静止帧跳过会让 wantContactNormals 停摆）
  runtime.wantContactNormals = viewport.decompose;
  // 静止帧跳渲染仅限有焦点的真实窗口：headless/后台页无帧提交会被合成器降频，
  // 连 requestAnimationFrame 都被饿死（实测 p8/w1 物理推进掉到 ~1fps）
  const shouldRender = viewport.consumeDirty();
  if (document.hasFocus() && !shouldRender) {
    // 静止编辑帧：无任何视觉变更，跳过叠加层与 GPU 渲染（PER-1；读数节流照常）
    roTimer += rawDt;
    if (roTimer > 0.15) {
      roTimer = 0;
      updateReadouts();
      updateConsbar();
      if (curvesOn && mode === 'run') sampleCurves();
      updateScaleReadout();
    }
    tickPerfHud(rawDt, false, 0, 0, 0, 0);
    return;
  }
  if (vectorsOn) {
    // 编辑态显示初速度，运行/暂停显示当前速度（遥测即当前世界态）；
    // per-entity「显示速度向量」关闭的体不画（检查器观察组）
    POOL_TEL.reset();
    for (const e of doc.entities) {
      if (e.physics.body !== 'dynamic' || e.visible === false) continue;
      if (e.params && e.params.showVel === false) continue;
      const t = POOL_TEL.next();
      if (!runtime.telemetryInto(e.id, t)) POOL_TEL.retract();
    }
    POOL_TEL.trim();
    viewport.updateVelocityArrows(POOL_TEL.list);
  }
  // 斜坡法线可视化（Goal 六「是否显示法线」per-entity）：坡面中心沿法向青色箭头
  {
    POOL_NORM.reset();
    for (const e of doc.entities) {
      if (e.type !== 'ramp' || e.visible === false) continue;
      if (!(e.params && e.params.showNormals)) continue;
      const b = runtime.binds.get(e.id);
      if (!b || !b.mesh) continue;
      const H = e.params.height, L = e.params.length;
      _nvN.set(H, L, 0).normalize().applyQuaternion(b.mesh.quaternion);
      _nvP.set(0, H / 2, 0);
      b.mesh.localToWorld(_nvP);
      const it = POOL_NORM.next();
      it.pos[0] = _nvP.x; it.pos[1] = _nvP.y; it.pos[2] = _nvP.z;
      it.dir[0] = _nvN.x; it.dir[1] = _nvN.y; it.dir[2] = _nvN.z;
    }
    POOL_NORM.trim();
    viewport.updateNormalViz(POOL_NORM.list);
  }
  if (forcesOn) {
    // 通用接触法向：Rapier 接触对收集（任意面：地面/斜坡/墙面/曲轨），运行过才有；
    // 绳/弹簧类无接触对 → 不分解、显示接触合力（张力语义），不再依赖斜面几何特判
    // （wantContactNormals 已前移到主循环脏门槛之前，每帧同步）
    POOL_TEL.reset();
    POOL_FORCE.reset();
    const gMag = Math.abs(doc.gravity ?? -9.81);            // PAR-1：重力箭头随场景重力卡（月球卡曾画错）
    for (const e of doc.entities) {
      if (e.physics.body !== 'dynamic' || e.visible === false) continue;
      const t = POOL_TEL.next();
      if (!runtime.telemetryInto(e.id, t)) { POOL_TEL.retract(); continue; }
      const it = POOL_FORCE.next();
      it.pos = t.pos;
      it.contact = runtime.contactForces.get(e.id) || null;
      it.gravity[0] = 0;
      it.gravity[1] = gMag * (e.physics.gravityScale != null ? e.physics.gravityScale : 1) * t.mass;
      it.gravity[2] = 0;
      it.accel = runtime.accels.get(e.id) || _ZERO3;
      const nrm = runtime.contactNormals.get(e.id);
      if (viewport.decompose && it.contact && nrm) {
        const dot = it.contact[0] * nrm[0] + it.contact[1] * nrm[1] + it.contact[2] * nrm[2];
        it.normal[0] = dot * nrm[0]; it.normal[1] = dot * nrm[1]; it.normal[2] = dot * nrm[2];   // 支持力 = (F·n̂)n̂
        it.friction[0] = it.contact[0] - it.normal[0];
        it.friction[1] = it.contact[1] - it.normal[1];
        it.friction[2] = it.contact[2] - it.normal[2];   // 摩擦类 = F − N
        it.contact = null;                               // 分解模式不显示合力
      }
    }
    POOL_TEL.trim();
    POOL_FORCE.trim();
    viewport.updateForceArrows(POOL_FORCE.list);
    // 绳张力箭头：T = m·|a − g_vec|（轻绳端点物体受力 = 重力 + 张力，加速度差分反推）
    if (viewport.tensionsOn) {
      POOL_TENS.reset();
      for (const e of doc.entities) {
        if (e.type !== 'rope' || !Array.isArray(e.attach) || e.attach.length !== 2) continue;
        const ba = runtime.binds.get(e.attach[0]), bb = runtime.binds.get(e.attach[1]);
        if (!ba || !bb || !ba.mesh || !bb.mesh) continue;
        const t = POOL_TEL.next();
        if (!runtime.telemetryInto(e.attach[0], t)) { POOL_TEL.retract(); continue; }
        const acc = runtime.accels.get(e.attach[0]);
        const T = acc ? t.mass * Math.hypot(acc[0], acc[1] + gMag, acc[2]) : 0;
        // FX-541：绳绷紧音——张力首超 0.8mg 发短「绷」(每绳 0.4s 冷却,松弛绳落体张紧可闻)
        if (sound && t.mass > 0 && T > 0.8 * t.mass * gMag) {
          const now = performance.now();
          const last = _ropeTautT.get(e.id) || 0;
          if (now - last > 400) { _ropeTautT.set(e.id, now); sound.tautTone(T / (t.mass * gMag) - 0.8); }
        } else if (T < 0.3 * t.mass * gMag) _ropeTautT.set(e.id, 0);   // 松弛回落才允许下次触发
        const it = POOL_TENS.next();
        const pa = ba.mesh.position, pb = bb.mesh.position;
        it.aPos[0] = pa.x; it.aPos[1] = pa.y; it.aPos[2] = pa.z;
        it.bPos[0] = pb.x; it.bPos[1] = pb.y; it.bPos[2] = pb.z;
        it.tA = T; it.tB = T;
      }
      POOL_TEL.trim();
      POOL_TENS.trim();
      viewport.updateTensionArrows(POOL_TENS.list);
    }
    // 弹簧胡克力箭头（第九章「弹力」独立分列）：F = k·|Δx| 沿轴，拉=指向对方、压=推离；
    // 阻尼力不画（弹力语义=胡克项）；数据同时供 springForceState 数值对照
    if (viewport.springsOn) {
      POOL_SPRING.reset();
      for (const e of doc.entities) {
        if (e.type !== 'spring' || !Array.isArray(e.attach) || e.attach.length !== 2) continue;
        const ba = runtime.binds.get(e.attach[0]), bb = runtime.binds.get(e.attach[1]);
        if (!ba || !bb || !ba.mesh || !bb.mesh) continue;
        const pa = ba.mesh.position, pb = bb.mesh.position;
        const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
        const len = Math.hypot(dx, dy, dz) || 1e-9;
        const rest = e.params.restLength ?? 0.8;
        const k = e.params.stiffness ?? 20;
        const stretch = len - rest;
        const F = k * stretch;
        const ux = dx / len, uy = dy / len, uz = dz / len;
        const it = POOL_SPRING.next();
        it.aPos[0] = pa.x; it.aPos[1] = pa.y; it.aPos[2] = pa.z;
        it.bPos[0] = pb.x; it.bPos[1] = pb.y; it.bPos[2] = pb.z;
        it.fA[0] = F * ux; it.fA[1] = F * uy; it.fA[2] = F * uz;
        it.k = k; it.len = len; it.stretch = stretch; it.F = F;
        it.aName = ba.entity.name; it.bName = bb.entity.name;
      }
      POOL_SPRING.trim();
      viewport.updateSpringArrows(POOL_SPRING.list);
      springForceItems = POOL_SPRING.list;
    }
  }
  // 约束关系可视化：选中实体的 joints 连线（编辑/运行态均显示；多选也画）
  {
    POOL_JOINT.reset();
    for (const id of selectedIds.length ? selectedIds : (selectedId ? [selectedId] : [])) {
      const e = getEntity(doc, id);
      const b = runtime.binds.get(id);
      if (!e || !b || !b.mesh) continue;
      for (const j of (e.joints || [])) {
        const tb = runtime.binds.get(j.target);
        const it = POOL_JOINT.next();
        const p = b.mesh.position;
        it.from[0] = p.x; it.from[1] = p.y; it.from[2] = p.z;
        if (tb && tb.mesh) { it.to[0] = tb.mesh.position.x; it.to[1] = tb.mesh.position.y; it.to[2] = tb.mesh.position.z; }
        else { it.to[0] = p.x; it.to[1] = p.y; it.to[2] = p.z; }
        it.ok = !!tb;
      }
    }
    POOL_JOINT.trim();
    viewport.updateJointViz(POOL_JOINT.list);
  }
  if (trailsOn) viewport.updateTrails(runtime.trails);
  // FX-524：等时节拍点——主测量体每 0.5s 模拟时落一枚点(疏=快密=慢)
  if (trailsOn) {
    const mb = runtime.binds.get(_measuredMainId());
    if (mb && mb.body) {
      const p = mb.body.translation();
      _beatAcc.t += rawDt;
      if (_beatAcc.t >= 0.5) {
        _beatAcc.t = 0;
        _beatDots.push([p.x, p.y, p.z]);
        if (_beatDots.length > 64) _beatDots.shift();
      }
    }
    viewport.updateBeatDots(_beatDots);
  } else { _beatAcc.t = 0; viewport.updateBeatDots(null); }
  // 声音（层 1）+ 碰撞 juice（层 3）：撞击冲量 → 三音色合成 + 粒子/震屏/升级环。
  // 听点 = 相机 target（pan 按横偏、衰减按距离）；强度与音色两路共用一次冲量换算。
  {
    const nS = runtime.impactSounds.length;
    if (nS) {
      const target = viewport.controls.target;
      const span = Math.max(viewport.camera.position.distanceTo(target) * 0.9, 2);
      for (let i = 0; i < nS; i++) {
        const s = runtime.impactSounds[i];
        const ba = runtime.binds.get(s.a), bb = runtime.binds.get(s.b);
        const matA = ba ? ba.entity.render.material : null;
        const matB = bb ? bb.entity.render.material : null;
        const timbre = SoundEngine.timbreOf(matA, matB);
        const strength = Math.min(1, s.j / 2.2);
        // FX-507 接触法向（两体质心连线）+ FX-545 质量（几何平均）：环定向与音高随质量
        let normal = null, mass = 1;
        if (ba && bb && ba.body && bb.body) {
          const pa = ba.body.translation(), pb = bb.body.translation();
          const dx = pa.x - pb.x, dy = pa.y - pb.y, dz = pa.z - pb.z;
          const len = Math.hypot(dx, dy, dz);
          if (len > 1e-4) normal = [dx / len, dy / len, dz / len];
          try { mass = Math.sqrt(Math.max(0.01, ba.body.mass()) * Math.max(0.01, bb.body.mass())); } catch (e) { /* mass() 不可用不拦音 */ }
        }
        sound.impact({
          j: s.j,
          matA, matB,
          pair: s.a < s.b ? s.a + '|' + s.b : s.b + '|' + s.a,
          pan: (s.pos[0] - target.x) / span,
          att: 1 / (1 + Math.hypot(s.pos[0] - target.x, s.pos[1] - target.y, s.pos[2] - target.z) / (span * 1.2)),
          mass,
          slowFactor: Math.pow(2, -5 * Math.max(0, 1 - effectiveTimeScale())),   // FX-547：0.25x→-5 半音、0.1x→-7,1x 不变
        });
        if (juice) {
          juice.spawnImpact(s.pos, strength, timbre);
          if (strength > 0.08) juice.spawnRing(s.pos, strength, normal);
        }
        maybeBulletTime(strength);
        maybeHitstop(strength);
      }
      runtime.impactSounds.length = 0;
    }
  }
  // FX-539：滚动持续音——纯滚动体(|v|≈ωr)速度和喂共享声部(每帧,~0.1ms 遍历)
  if (sound && mode === 'run' && !paused) {
    let rollSum = 0;
    for (const [, b] of runtime.binds) {
      const e = b.entity;
      if (!b.body || e.physics.body !== 'dynamic' || !e.params || !e.params.radius) continue;
      const v = b.body.linvel(), w = b.body.angvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      if (sp < 0.3) continue;
      const wr = Math.hypot(w.x, w.y, w.z) * e.params.radius;
      if (Math.abs(sp - wr) / Math.max(sp, wr) < 0.08) rollSum += sp;   // 纯滚动
    }
    sound.rollLoop(rollSum);
  }
  const _tOv = performance.now();
  const shook = juice ? juice.applyShake(viewport.camera, _tOv / 1000) : false;
  viewport.render();     // tickFocus/tickPose 已在脏门槛前统一调用（FEEL-96/PER-83：此前双调致动画 2 倍速收敛）
  if (shook) juice.revertShake(viewport.camera);
  recorder.frame();      // R6-F5 内置录屏帧合成（未录制时零开销早退）
  const _tRnd = performance.now();
  if (juice) {
    juice.tick(rawDt);
    juice.tickRings(_tRnd / 1000);
  }
  roTimer += rawDt;
  if (roTimer > 0.15) {
    roTimer = 0;
    updateReadouts();
    updateConsbar();
    if (curvesOn && mode === 'run') sampleCurves();
    updateScaleReadout();
  }
  tickPerfHud(rawDt, true, _tPhys - _t0, _tOv - _tPhys, _tRnd - _tOv, performance.now() - _tRnd);
}

// ============ Agent 题目解析面板 ============
// 链路：上传/预览 → POST /api/parse-question（key 在服务端）→ normalizeParse 校验 →
// 用户查看/修正（全部可编辑，修改记录进 doc.meta.corrections）→ 确认后经 window.MECH 白名单建实体。
let agentOps = [];       // Agent 建场操作明细 [{op, target, ok}]
let agentPlanApplied = false;   // 当前 plan 是否已建场（换场景作废依据，AG-46）
let agentImageDataUrl = null;
let agentPlan = null;
let agentStandalone = false;   // R6-F5：本计划独立成题？题图/示例通道=true（建场前自清无关旧场景）；文字通道=混合搭建
let agentCorrections = [];
let agentChanges = [];   // 逐条接受/拒绝：待执行变更清单 [{type,idx,label,detail,skipped}]

const PEDIT = {
  conveyor: [
    ['length', '带长', 'm', 2.4, [0.5, 20]],
    ['speed', '带速', 'm/s', 0.8, [-8, 8]],
    ['friction', '带面μ', '', 0.2, [0, 2]],
  ],
  ramp: [
    ['angleDeg', '倾角', '°', 30, [1, 80]],
    ['length', '坡长', 'm', 2.0, [0.1, 12]],
    ['width', '坡宽', 'm', 0.5, [0.05, 6]],
  ],
  sphere: [
    ['mass', '质量', 'kg', 1, [0.01, 10000]],
    ['radius', '半径', 'm', 0.15, [0.01, 2]],
    ['friction', '摩擦', '', 0.3, [0, 2]],
  ],
  box: [
    ['mass', '质量', 'kg', 1, [0.01, 10000]],
    ['length', '长', 'm', 0.3, [0.02, 10]],
    ['width', '宽', 'm', 0.3, [0.02, 10]],
    ['height', '高', 'm', 0.3, [0.02, 10]],
  ],
  cylinder: [
    ['mass', '质量', 'kg', 1, [0.01, 10000]],
    ['radius', '半径', 'm', 0.12, [0.01, 2]],
    ['height', '高', 'm', 0.3, [0.02, 8]],
  ],
  curvedRamp: [
    ['curveExp', '曲率指数', '', 1.4, [0.3, 3]],
    ['length', '底边长', 'm', 2.4, [0.3, 12]],
    ['height', '落差', 'm', 1.0, [0.05, 6]],
    ['width', '宽', 'm', 0.5, [0.1, 6]],
  ],
  bowl: [
    ['radius', '碗口半径', 'm', 0.8, [0.3, 2.5]],
    ['depth', '碗深', 'm', 0.35, [0.05, 1.5]],
  ],
  waveFloor: [
    ['sx', '路长', 'm', 6, [1, 20]],
    ['sz', '路宽', 'm', 1.6, [0.4, 8]],
    ['waveLen', '波长', 'm', 0.8, [0.2, 3]],
    ['waveAmp', '波幅', 'm', 0.05, [0.005, 0.25]],
  ],
  tank: [
    ['density', '液体密度', 'kg/m³', 1000, [500, 3000]],
    ['sy', '水深', 'm', 1.2, [0.2, 4]],
  ],
  ground: [],
  pulley: [],
  celestial: [
    ['mass', '质量', 'kg', 100, [0.01, 1000000]],
    ['radius', '半径', 'm', 0.5, [0.05, 4]],
  ],
};

function selectTab(which) {
  const insp = which === 'inspector';
  $('tabInspector').classList.toggle('hot', insp);
  $('tabAgent').classList.toggle('hot', !insp);
  $('tabInspector').setAttribute('aria-selected', insp ? 'true' : 'false');   // UI-529
  $('tabAgent').setAttribute('aria-selected', insp ? 'false' : 'true');
  $('inspWrap').style.display = insp ? 'block' : 'none';
  $('agentWrap').style.display = insp ? 'none' : 'block';
}
// UI-530：两页签间方向键移动
$('rtabs').addEventListener('keydown', (ev) => {
  if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
  ev.preventDefault();
  const toAgent = (ev.key === 'ArrowRight') === ($('tabInspector').classList.contains('hot'));
  selectTab(toAgent ? 'agent' : 'inspector');
  (toAgent ? $('tabAgent') : $('tabInspector')).focus();
});

function bindAgentPanel() {
  const fileInput = $('agentFile');
  const dz = $('dropZone');
  // UI-562：字数计数（打满才截断不可见）——>90% 转琥珀提醒
  {
    const req = $('agentTextReq');
    const cnt = document.createElement('div');
    cnt.style.cssText = 'text-align:right;font-size: 10px;color:var(--faint);margin-top:2px;font-family:var(--mono)';
    const syncCnt = () => {
      const n = req.value.length;
      cnt.textContent = `${n}/4000`;
      cnt.style.color = n > 3600 ? 'var(--accent)' : 'var(--faint)';
    };
    req.addEventListener('input', syncCnt);
    req.after(cnt);
    syncCnt();
  }
  dz.onclick = () => fileInput.click();
  // UI-619：键盘可达上传（Enter/Space 触发选文件）
  dz.setAttribute('tabindex', '0');
  dz.setAttribute('role', 'button');
  dz.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fileInput.click(); } };
  // 拖拽上传（UI-3）：教师传题高频路径，drop 与点击同一条 readQuestionImage 链
  dz.addEventListener('dragover', (ev) => { ev.preventDefault(); dz.style.borderColor = 'rgba(217,164,65,.6)'; dz.style.color = 'var(--text)'; dz.style.background = 'rgba(217,164,65,.06)'; });   // UI-557 拖入底色反馈
  dz.addEventListener('dragleave', () => { dz.style.borderColor = ''; dz.style.color = ''; dz.style.background = ''; });
  dz.addEventListener('drop', (ev) => {
    ev.preventDefault();
    dz.style.borderColor = ''; dz.style.color = ''; dz.style.background = '';
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { setParseStatus('只支持图片文件（PNG/JPG）', true); return; }
    readQuestionImage(f);
  });
  // Ctrl+V 粘贴截图（UI-3）：截图工具/微信复制图片后直接粘贴
  window.addEventListener('paste', (ev) => {
    const items = ev.clipboardData && ev.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const blob = it.getAsFile();
        if (blob) { readQuestionImage(blob); ev.preventDefault(); }
        return;
      }
    }
  });
  $('btnCamera').onclick = () => startCamera();
  $('btnCapture').onclick = () => captureFrame();
  $('btnCamCancel').onclick = () => { stopCamera(); $('dropZone').style.display = 'block'; setParseStatus('已取消拍照'); };
  $('btnCropMode').onclick = () => toggleCropMode();
  $('btnCropClear').onclick = () => clearCrop();
  $('btnReUpload').onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const f = fileInput.files[0];
    if (f) readQuestionImage(f);
    fileInput.value = '';
  };
  $('btnParse').onclick = () => parseQuestion();
  $('btnParseText').onclick = () => { if (tryLocalAgentCommand($('agentTextReq').value)) return; parseTextQuestion(); };
  bindVoiceInput();
  $('btnRerunVerify').onclick = () => runAgentVerify(false);
  $('agentTextReq').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      const ta = $('agentTextReq');
      const txt = ta.value.trim();
      if (txt) {
        textReqHistory = textReqHistory.filter((x) => x !== txt);
        textReqHistory.push(txt);
        if (textReqHistory.length > 20) textReqHistory.shift();
        textReqHistPos = null;
      }
      if (!tryLocalAgentCommand(txt)) parseTextQuestion();
    } else if (ev.key === 'ArrowUp' && !$('agentTextReq').value && textReqHistory.length) {
      ev.preventDefault();
      textReqHistPos = textReqHistPos == null ? textReqHistory.length - 1 : Math.max(0, textReqHistPos - 1);
      $('agentTextReq').value = textReqHistory[textReqHistPos];
    } else if (ev.key === 'ArrowDown' && textReqHistPos != null) {
      ev.preventDefault();
      textReqHistPos = textReqHistPos + 1 >= textReqHistory.length ? null : textReqHistPos + 1;
      $('agentTextReq').value = textReqHistPos == null ? '' : textReqHistory[textReqHistPos];
    }
  });
  $('btnFixtureParse').onclick = () => loadFixtureParse();
  $('btnApplyParse').onclick = () => applyAgentPlan({ vivid: true });
  $('btnClearParse').onclick = () => {
    // UI-545：清空丢解析结果不可逆——两段式确认（2.6s 复原），与库删除钮同款交互
    const b = $('btnClearParse');
    if (b.dataset.armed) {
      delete b.dataset.armed;
      b.textContent = '清空';
      resetAgentPanel();
    } else {
      b.dataset.armed = '1';
      b.textContent = '确认清空?';
      setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = '清空'; } }, 2600);
    }
  };
  $('btnRunExplain').onclick = () => runAndExplain();
  $('btnExportCSV').onclick = exportSeriesCSV;
  $('btnVeilRetry').onclick = () => location.reload();
  $('btnCopyExplain').onclick = () => {
    const r = agentExplain;
    if (!r) return;
    const lines = [`MECHANICA 运行解释（${r.kind || 'n/a'}）`, r.summary];
    if (r.theoretical && r.theoretical.value != null) lines.push(`理论: ${r.theoretical.value} m/s`);
    if (r.measured && r.measured.value != null) lines.push(`实测: ${r.measured.value} m/s`);
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => toast('解释结果已复制'),
      () => toast('复制失败（浏览器剪贴板不可用）'),
    );
  };
  bindCropEvents();
  setAgentStage('idle', '未开始：上传/拍照题目图片，或用下方示例数据');
  // 无 Key 探针（AG-75）：boot 时问一次服务端，不回显 key 只拿布尔——首用教师不再对着 503 猜
  fetch('/api/status').then((r) => r.json()).then((st) => {
    if (st && st.ok && !st.key) {
      setAgentStage('idle', '未开始：未配置解析 Key，可手动搭建或载入示例数据（配置后可拍照解析）');
    }
  }).catch(() => { /* 服务不可用时保持默认文案（w3 断言依赖） */ });
}

// ============ Agent 面板当前任务（阶段徽标状态机） ============
function setAgentStage(stage, text) {
  const STAGES = { idle: '未开始', uploaded: '图片就绪', parsing: '解析中', parsed: '待确认', building: '建场中', built: '已建场', patching: '模型修订中', explaining: '运行解释中', explained: '已解释', error: '出错' };
  const el = $('taskStage'), tx = $('taskText');
  if (!el) return;
  el.innerHTML = (STAGES[stage] || stage) + (stage === 'parsing' || stage === 'explaining' || stage === 'patching' ? '<span class="spinner"></span>' : '');
  el.className = 'badge' + (stage === 'explained' ? ' given' : (stage === 'built' ? ' given' : (stage === 'error' ? ' bad' : (stage === 'parsing' ? ' given' : ''))));   // UI-546：出错红显
  if (text) tx.textContent = text;
  const opsEl = $('taskOps');
  if (opsEl) {
    opsEl.innerHTML = '';
    for (const o of agentOps.slice(-6)) {
      const li = document.createElement('div');
      li.textContent = (o.ok ? chrOk() : chrBad()) + ' ' + o.op + ': ' + o.target;
      li.style.color = o.ok ? 'var(--dim)' : 'var(--danger)';
      opsEl.appendChild(li);
    }
  }
}
function chrOk() { return String.fromCharCode(10003); }   // 对勾
function chrBad() { return String.fromCharCode(10007); }  // 叉

// ============ 拍照（getUserMedia → canvas 采帧） ============
let agentStream = null;

async function startCamera() {
  try {
    agentStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 } }, audio: false });
    $('camVideo').srcObject = agentStream;
    $('camWrap').style.display = 'block';
    $('dropZone').style.display = 'none';
    $('imgPrevWrap').style.display = 'none';
    setParseStatus('相机已开启，对准题目后点击"捕获此帧"');
  } catch (e) {
    setParseStatus('相机不可用: ' + (e.name === 'NotAllowedError' ? '权限被拒绝' : (e.name || e.message)), true);
  }
}

function stopCamera() {
  if (agentStream) {
    for (const t of agentStream.getTracks()) t.stop();
    agentStream = null;
  }
  $('camWrap').style.display = 'none';
}

function captureFrame() {
  const video = $('camVideo');
  if (!agentStream || !video.videoWidth) { setParseStatus('相机未就绪，请稍候', true); return; }
  const k = Math.min(1, 1400 / Math.max(video.videoWidth, video.videoHeight));
  const cv = document.createElement('canvas');
  cv.width = Math.round(video.videoWidth * k);
  cv.height = Math.round(video.videoHeight * k);
  cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
  setAgentImageFromCanvas(cv, '已捕获相机帧');
  setAgentStage('uploaded', '已拍照，可框选区域后解析');
}

// ============ 题目图片状态（原图 canvas + 归一化选区） ============
let agentImageCanvas = null;
let agentCrop = null;
let cropMode = false;
let cropDragStart = null;

function setAgentImageFromCanvas(cv, note = '') {
  agentImageCanvas = cv;
  agentImageDataUrl = cv.toDataURL('image/jpeg', 0.85);
  recorder.setPip(agentImageDataUrl);   // R6-F5：原题图进录屏角标
  agentCrop = null;
  stopCamera();
  const ip = $('imgPrev');
  // UI-558：大图解码期给状态底，不白板
  ip.style.background = 'var(--inset)';
  ip.style.opacity = '0.55';
  ip.onload = () => { ip.style.background = ''; ip.style.opacity = ''; };
  ip.src = agentImageDataUrl;
  $('cropRect').style.display = 'none';
  $('cropHint').style.display = 'none';
  $('dropZone').style.display = 'none';
  $('camWrap').style.display = 'none';
  $('imgPrevWrap').style.display = 'block';
  setParseStatus((note || `图片就绪 ${cv.width}x${cv.height}`) + `（${cv.width}x${cv.height}），可框选区域后解析`);
}

function readQuestionImage(file) {
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1400 / Math.max(img.width, img.height));   // 降采样控请求体
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k);
      cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      setAgentImageFromCanvas(cv, `已上传 ${img.width}x${img.height}`);
      setAgentStage('uploaded', '图片已上传，可框选区域后解析');
    };
    img.onerror = () => setParseStatus('图片读取失败，请换一张', true);
    img.src = String(r.result);
  };
  r.readAsDataURL(file);
}

// 解析时真正发送的图：有选区则裁剪原图（质量不受显示压缩影响）
function croppedCanvas() {
  if (!agentCrop || !agentImageCanvas) return agentImageCanvas;
  const c = agentImageCanvas;
  const sx = Math.round(agentCrop.x * c.width), sy = Math.round(agentCrop.y * c.height);
  const sw = Math.max(8, Math.round(agentCrop.w * c.width)), sh = Math.max(8, Math.round(agentCrop.h * c.height));
  const cv = document.createElement('canvas');
  cv.width = sw; cv.height = sh;
  cv.getContext('2d').drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh);
  return cv;
}

function toggleCropMode() {
  if (!agentImageCanvas) { setParseStatus('请先上传或拍照', true); return; }
  cropMode = !cropMode;
  cropDragStart = null;
  $('imgCropWrap').style.cursor = cropMode ? 'crosshair' : '';
  $('btnCropMode').classList.toggle('hot', cropMode);
  setParseStatus(cropMode ? '框选模式：在图上拖拽框出题目区域' : '框选结束');
}

function clearCrop() {
  agentCrop = null;
  $('cropRect').style.display = 'none';
  $('cropHint').style.display = 'none';
}

function bindCropEvents() {
  const wrap = $('imgCropWrap'), rect = $('cropRect'), img = $('imgPrev');
  wrap.addEventListener('pointerdown', (e) => {
    if (!cropMode) return;
    const r = img.getBoundingClientRect();
    cropDragStart = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!cropMode || !cropDragStart) return;
    const r = img.getBoundingClientRect();
    const cx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const cy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    agentCrop = {
      x: Math.min(cropDragStart.x, cx), y: Math.min(cropDragStart.y, cy),
      w: Math.abs(cx - cropDragStart.x), h: Math.abs(cy - cropDragStart.y),
    };
    rect.style.display = 'block';
    rect.style.left = (agentCrop.x * 100) + '%';
    rect.style.top = (agentCrop.y * 100) + '%';
    rect.style.width = (agentCrop.w * 100) + '%';
    rect.style.height = (agentCrop.h * 100) + '%';
  });
  window.addEventListener('pointerup', () => {
    if (!cropMode || !cropDragStart) return;
    cropDragStart = null;
    cropMode = false;
    wrap.style.cursor = '';
    $('btnCropMode').classList.remove('hot');
    if (agentCrop && agentCrop.w > 0.02 && agentCrop.h > 0.02) {
      $('cropHint').style.display = 'block';
      setParseStatus(`已框选区域 (${Math.round(agentCrop.w * 100)}x${Math.round(agentCrop.h * 100)}%)，点击"解析题目"只发送选区`);
    } else {
      clearCrop();
    }
  });
}

function setParseStatus(msg, isErr = false, busy = false) {
  $('parseStatusGrp').style.display = 'block';
  const el = $('parseStatus');
  el.textContent = (isErr ? chrBad() + ' ' : '') + msg;   // UI-561：错误加 ✗ 字形，不只靠颜色
  el.style.color = isErr ? 'var(--danger)' : 'var(--dim)';
  recorder.caption((isErr ? '✗ ' : '') + msg);   // R6-F5：Agent 状态进录屏字幕
  parseBusy = busy;   // 解析互斥（AG-72）：图片/文字/fixture 三通道任一进行中，其余禁点（防双计费）
  $('btnParse').disabled = busy;
  $('btnParseText').disabled = busy;
  $('btnFixtureParse').disabled = busy;
}
let parseBusy = false;

// 服务端解析结果采纳（图片/文字通道共用）：normalize → 渲染 → 变更预览
function adoptServerParse(out) {
  const n = normalizeParse(out.parse);
  if (!n.ok) {
    // 阶段必须流转到出错：否则徽标永远停在「解析中」（噪声图/模型输出无实体实测卡死 150s+）
    setAgentStage('error', '解析失败');
    setParseStatus('解析结果无效：' + n.errors.join('; ') + '（可重试，或换一张图）', true);
    return false;
  }
  agentPlan = n.plan;
  agentPlan.autoTags = deriveTagsFromPlan(n.plan);   // Agent 自动标签（入库/建场时落 doc.tags）
  agentPlanApplied = false;
  agentCorrections = [];
  agentPatchRounds = 0;   // 全新计划：修订轮数清零
  // 低置信警示（AG-39）：模型自报置信度低时明确提示逐项核对，不静默放行
  const warnings = [...n.errors];
  if (n.plan.confidence < 0.35) {
    warnings.push(`模型总体置信度低（${(n.plan.confidence * 100).toFixed(0)}%），请逐项核对题给数值后再建场`);
  }
  renderParseResult(warnings);
  setAgentStage('parsed', '解析完成，检查/修正后创建实体');
  setParseStatus('解析完成。请检查/修正下方各项后再创建实体');
  return true;
}

// fetch + 170s 超时（AG-38 收口；R6-F5 放宽）：step-5-preview 深推理实测量级 60~120s 波动，
// 服务端最坏 = 直连 90s 超时 + 代理兜底 90s；客户端上限须高于服务端最坏，否则服务端成功
// 响应写回已断开的 socket（白烧一次 key）
async function fetchParse(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 170000);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// 上游瞬时失败（502 族：5xx/网关/解析内容异常）自动重试一次；确定性失败（400/413/503 无 key）不重试
function isRetryableParseError(errMsg) {
  return typeof errMsg === 'string' && errMsg.startsWith('解析服务');
}
// AG-593：优先服务端结构化 {retryable}（401=false 绝不白等，429=true+退避），旧响应回退文案前缀判断
function parseRetryable(out) {
  if (!out || out.ok !== false) return { retry: false };
  if (out.retryable === true) return { retry: true, backoffMs: out.retryAfterMs || 0 };
  if (out.retryable === false) return { retry: false };
  return { retry: isRetryableParseError(out.error) };   // 旧版服务端无结构化字段
}
async function parseWithRetry(url, body, statusEl) {
  let out = await (await fetchParse(url, body)).json();
  const r = parseRetryable(out);
  if (r.retry) {
    if (r.backoffMs) await new Promise((res) => setTimeout(res, r.backoffMs));   // 429 退避
    if (statusEl) setParseStatus(`首次解析失败（${out.error}），自动重试一次…`, false, true);
    out = await (await fetchParse(url, body)).json();
  }
  return out;
}

async function parseQuestion(retried = false) {
  if (parseBusy) return;
  if (!agentImageDataUrl) { setParseStatus('请先上传或拍照题目图片', true); return; }
  const send = croppedCanvas();
  const dataUrl = send ? send.toDataURL('image/jpeg', 0.85) : agentImageDataUrl;
  const tag = agentCrop ? `（仅选区 ${send.width}x${send.height}）` : '';
  setAgentStage('parsing', '正在解析题目…');
  setParseStatus(`正在解析${tag}（step-5-preview 视觉模型）…`, false, true);
  try {
    const out = await parseWithRetry('/api/parse-question', { image: dataUrl }, true);
    if (!out.ok) { setAgentStage('error', '解析失败'); setParseStatus('解析失败：' + out.error + '（可重试，或用下方示例数据）', true); return; }
    agentStandalone = true;   // R6-F5：题图=独立成题（应用层语义，建场前自清无关旧场景）
    adoptServerParse(out);
  } catch (e) {
    // R6-F5 超时自愈：深推理模型实测量级 60~170s 波动，偶发超时自动补一枪（只补一次，不空转烧 key）
    if (e && e.name === 'AbortError' && !retried) {
      parseBusy = false;
      setParseStatus('解析超时（170s），上游偶发慢——自动重试一次…', false, true);
      return parseQuestion(true);
    }
    setAgentStage('error', '解析失败');   // AG-93：异常路径也要流转阶段，徽标不得停在「解析中」
    setParseStatus(e && e.name === 'AbortError'
      ? '解析超时（170s，已自动重试过一次），可再手动重试或换一张更清晰的图'
      : '解析请求失败（网络或服务不可用）。可重试，或用下方示例数据', true);
  }
}

// ============ Agent 本地快速指令（零 API 费的确定性通道，AG-L1） ============
// 文字要求先过本地动词表：运行/暂停/重置/删除/叠加层/倍速/视角等日常操控不烧钱不等待，
// 直接执行并 toast 反馈；未命中（搭建类长句）返回 false 落回 step-5-preview 解析通道。
const LOCAL_TYPE_ALIAS = {
  球: 'sphere', 小球: 'sphere', 钢球: 'sphere', 斜面: 'ramp', 斜坡: 'ramp', 楔块: 'ramp',
  方块: 'box', 滑块: 'box', 木块: 'box', 圆柱: 'cylinder', 转台: 'cylinder',
  地面: 'ground', 地板: 'ground', 滑轮: 'pulley', 天体: 'celestial', 行星: 'celestial', 恒星: 'celestial',
};
// 目标名 → 叠加层开关按钮 id（名称单词直接点按=翻转；配 显示/隐藏 动词走 set* 强制态）
const LOCAL_OVERLAY = {
  矢量: ['btnVectors', (on) => setVectors(on)], 受力: ['btnForces', (on) => setForces(on)],
  分解: ['btnDecompose', null], 轨迹: ['btnTrails', (on) => setTrails(on)],
  曲线: ['btnCurves', (on) => setCurves(on)], 守恒: ['btnCons', (on) => setCons(on)],
  音效: ['btnSound', (on) => setSound(on)], 震屏: ['btnShake', (on) => setShake(on)],
  性能: ['btnPerf', (on) => setPerfHud(on)], 帧率: ['btnPerf', (on) => setPerfHud(on)],
};
function tryLocalAgentCommand(raw) {
  const t = String(raw || '').trim().replace(/[。！!？?～~]+$/g, '');
  if (!t || t.length > 24) return false;               // 长句=搭建要求，交模型
  // 复合句（多步指令）本地通道做不了「先删再建」这类编排，整句交模型走评审链路
  if (/[，,；;：:]/.test(t) || /再|然后|并且|接着|同时|之后/.test(t)) return false;
  const wantsOn = /显示|打开|开启|看看/.test(t);
  const wantsOff = /隐藏|关闭|关掉/.test(t);
  // —— 叠加层 ——
  for (const [nm, [btnId, setFn]] of Object.entries(LOCAL_OVERLAY)) {
    if (!t.includes(nm)) continue;
    if (t.includes('解释')) return false;               // 「运行解释」类是模型通道的活
    if ((wantsOn || wantsOff) && setFn) {
      setFn(wantsOn);
      toast(`${wantsOn ? '显示' : '隐藏'}${nm}`);
    } else {
      if (btnId === 'btnDecompose' && !forcesOn) setForces(true);   // 分解依赖受力，先联动开启
      document.getElementById(btnId).click();           // 裸名称=翻转
    }
    setParseStatus(`本地指令已执行：${t}（未使用模型）`);
    return true;
  }
  // —— 运行控制 ——
  if (/^(运行|开始|跑起来|演示)$/.test(t)) { play(); }
  else if (/^(暂停|停一下|停止)$/.test(t)) { pauseToggle(); }
  else if (/^继续$/.test(t)) { pauseToggle(); }
  else if (/^(重置|复位|回到初始)$/.test(t)) { resetSim(); }
  else if (/^(单步|下一步)$/.test(t)) { stepOnce(); }
  // —— 倍速 ——
  else if (/慢(动作|放)|慢速/.test(t)) { setSpeed(0.1); toast('时间倍率 0.1x'); }
  else if (/原速|正常速度|一倍速|1倍速/.test(t)) { setSpeed(1); toast('时间倍率 1x'); }
  else if (/快进|加速|最快/.test(t)) { setSpeed(t.includes('最') ? 4 : 2); toast(`时间倍率 ${t.includes('最') ? 4 : 2}x`); }
  else if (/^(\d+(\.\d+)?)\s*倍速$/.test(t)) {
    const v = parseFloat(t) || 1;
    const near = SPEEDS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
    setSpeed(near); toast(`时间倍率 ${near}x`);
  }
  // —— 视角 ——
  else if (/全局|总览/.test(t)) { $('btnViewReset').click(); }
  else if (/顶视图?$/.test(t)) { $('btnViewTop').click(); }
  else if (/正视图?$|前视图?$/.test(t)) { $('btnViewFront').click(); }
  else if (/侧视图?$/.test(t)) { $('btnViewSide').click(); }
  else if (/^聚焦/.test(t)) {
    const kw = t.replace(/^聚焦/, '').trim();
    if (kw) {
      const hit = findLocalEntities(kw);
      if (hit.length) { selectEntity(hit[0].id); $('btnFocus').click(); }
      else { toast(`没找到「${kw}」`); setParseStatus(`本地指令：没找到名为「${kw}」的对象`, true); return true; }
    } else if (selectedIds.length) { $('btnFocus').click(); }
    else { toast('先选中一个对象再聚焦'); setParseStatus('本地指令：当前没有选中对象', true); return true; }
  }
  // —— 删除（经 opRemoveEntity 走 undo 栈，可 Ctrl+Z 撤销） ——
  else if (/^(删除|删掉|移除)/.test(t) || /删掉$/.test(t)) {
    if (mode !== 'edit') { toast('运行态不可删除，请先重置'); setParseStatus('本地指令：运行态不可删除，请先重置', true); return true; }
    if (/选中/.test(t)) {
      if (!selectedIds.length) { toast('先选中要删除的对象'); setParseStatus('本地指令：当前没有选中对象', true); return true; }
      const ids = [...selectedIds];
      for (const id of ids) opRemoveEntity(id);
      return true;                                       // opRemoveEntity 自带 toast
    }
    let kw = t.replace(/^(删除|删掉|移除)/, '').replace(/(所有|全部|每个|各个|这个|那个|该)/g, '').replace(/删掉$/, '').trim();
    // 「删除全部/清空场景」（剥完限定词后无具体目标）才清场；「删除全部小球」仍按类型删
    if ((!kw && /全部|所有/.test(t)) || kw === '场景') {
      const all = doc.entities.map((e) => e.id);
      if (!all.length) { toast('场景已是空的'); return true; }
      for (const id of all) opRemoveEntity(id);
      toast(`已清空场景（${all.length} 个，Ctrl+Z 可撤销）`);
      setParseStatus(`本地指令已执行：清空场景（${all.length} 个对象，可撤销）`);
      return true;
    }
    if (!kw) { toast('要删什么？例如「删除小球」或「删除选中」'); return true; }
    const hit = findLocalEntities(kw);
    if (!hit.length) { toast(`没找到「${kw}」`); setParseStatus(`本地指令：没找到名为「${kw}」的对象（类型或名字都不匹配）`, true); return true; }
    for (const e of hit) opRemoveEntity(e.id);
    toast(`已删除 ${hit.length} 个「${kw}」（Ctrl+Z 可撤销）`);
    setParseStatus(`本地指令已执行：删除 ${hit.length} 个「${kw}」（未使用模型，可撤销）`);
    return true;
  }
  else if (/^清空/.test(t)) { $('btnNew').click(); }
  else if (/^(新建|新场景)/.test(t)) { $('btnNew').click(); }
  else if (/^(保存|存档)$/.test(t)) { $('btnSave').click(); }
  else if (/^导出(数据|csv)$/i.test(t)) { exportSeriesCSV(); }
  else if (/^(帮助|快捷键|怎么用)$/.test(t)) { toggleHelp(); }
  else return false;
  setParseStatus(`本地指令已执行：${t}（未使用模型）`);
  return true;
}
function findLocalEntities(kw) {
  const type = LOCAL_TYPE_ALIAS[kw];
  return doc.entities.filter((e) => e.name.includes(kw) || (type && e.type === type));
}

// 语音口述（用户需求「向 Agent 口述题目」）：Web Speech API（浏览器原生，免 key）。
// 识别结果追加进文字框，可再编辑后解析；API 不支持→藏按钮，网络不通/拒权→如实
// toast 并引导键入（境内网络 Google 语音后端可能不可达——降级是常态路径不是异常）。
const voiceState = { rec: null, on: false };
function bindVoiceInput() {
  const btn = $('btnMic');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { btn.style.display = 'none'; return; }
  const stop = (note) => {
    voiceState.on = false;
    try { voiceState.rec && voiceState.rec.stop(); } catch { /* 已停 */ }
    btn.classList.remove('hot');
    btn.classList.remove('listening');
    btn.setAttribute('aria-pressed', 'false');   // UI-560
    btn.title = '点击开始聆听（Web Speech），说完再点一次结束';
    setBtnText('btnMic', '口述');
    const bp = $('btnParseText');
    if (bp) bp.disabled = false;
    $('agentTextReq').placeholder = '例：在现有斜面上放一个质量 2 kg 的小球，光滑无初速，从顶端释放…（Ctrl+Enter 直接解析；也可点「口述」用语音输入）';
    if (note) toast(note);
  };
  btn.onclick = () => {
    if (voiceState.on) { stop('口述已结束——检查文本后点「解析文字要求」'); return; }
    const rec = new SR();
    voiceState.rec = rec;
    rec.lang = 'zh-CN';
    rec.interimResults = false;   // 只收最终结果：textarea 编辑态插 interim 会和用户光标打架
    rec.continuous = true;        // 连续听写：题目一句话常说断，单次模式会听一半停
    rec.onresult = (ev) => {
      let chunk = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) chunk += ev.results[i][0].transcript;
      }
      if (!chunk) return;
      const ta = $('agentTextReq');
      ta.value = (ta.value ? ta.value.replace(/\s+$/, '') + '，' : '') + chunk.trim();
    };
    rec.onerror = (ev) => {
      const msg = {
        'not-allowed': '麦克风权限被拒绝（浏览器地址栏可重授权）',
        'service-not-allowed': '语音识别服务不可用（改用键入或拍照）',
        network: '语音识别服务网络不可达（境内网络常见）——改用键入或拍照',
        'no-speech': '没听到内容——点住「口述」后正常语速念题',
      }[ev.error] || '语音识别出错（' + ev.error + '）——改用键入或拍照';
      stop(msg);
    };
    rec.onend = () => { if (voiceState.on) stop('口述已结束——检查文本后点「解析文字要求」'); };
    if (parseBusy) { toast('正在解析中——等这一步完成再口述'); return; }
    try {
      rec.start();
      voiceState.on = true;
      setBtnText('btnMic', '口述中…（再点结束）');
      btn.setAttribute('aria-pressed', 'true');   // UI-560：聆听态语义（文案受测试保护不能改，状态走 ARIA+title）
      btn.title = '聆听中——点击结束聆听';
      btn.classList.add('hot');
      btn.classList.add('listening');
      $('btnParseText').disabled = true;   // 边听边解析会打架：听写完再解析
      $('agentTextReq').placeholder = '正在聆听…请念题目（识别结果会追加进来）';
      toast('正在聆听——请念题目，说完再点一次「口述中」结束');
    } catch (e) {
      stop('语音识别启动失败——改用键入或拍照');
    }
  };
}

// 文字要求通道（混合搭建）：文字 → 真实模型解析 → 与图片通道同一条评审/预览/建场链路
async function parseTextQuestion(retried = false) {
  if (parseBusy) return;
  const text = $('agentTextReq').value.trim();
  if (!text) { setParseStatus('请先输入题目或搭建要求的文字', true); return; }
  setAgentStage('parsing', '正在解析文字要求…');
  setParseStatus('正在解析文字要求（step-5-preview）…', false, true);
  const t0 = performance.now();
  try {
    const out = await parseWithRetry('/api/parse-text', { text }, true);
    if (!out.ok) { setAgentStage('error', '解析失败'); setParseStatus('解析失败：' + out.error + '（可重试）', true); return; }
    agentStandalone = false;   // R6-F5：文字通道=混合搭建语义（在当前场景上增删改，不整场重建）
    if (adoptServerParse(out)) {
      $('parseSrcBadge').textContent = 'step-5-preview·文字';
      setParseStatus(`文字要求解析完成（真实模型，耗时 ${((performance.now() - t0) / 1000).toFixed(1)}s）。请检查/修正/勾选变更后再创建实体`);
    }
  } catch (e) {
    if (e && e.name === 'AbortError' && !retried) {   // R6-F5 超时自愈（与题图通道同口径）
      parseBusy = false;
      setParseStatus('解析超时（170s），上游偶发慢——自动重试一次…', false, true);
      return parseTextQuestion(true);
    }
    setAgentStage('error', '解析失败');   // AG-93：同上
    setParseStatus(e && e.name === 'AbortError'
      ? '解析超时（170s，已自动重试过一次），可再手动重试或精简要求描述'
      : '解析请求失败（网络或服务不可用）。可重试', true);
  }
}

async function loadFixtureParse() {
  if (parseBusy) return;
  const sel = document.getElementById('fixtureSel');
  loadFixtureData((sel && sel.value) || 'incline');
}

async function loadFixtureData(name) {
  try {
    const resp = await fetch(`./tools/fixtures/parse-${name}.json`);
    const raw = await resp.json();
    const sel = document.getElementById('fixtureSel');
    if (sel && [...sel.options].some((o) => o.value === name)) sel.value = name;   // 下拉回显当前 fixture
    return adoptParse(raw, `已载入本地示例解析数据「${raw.questionType || name}」（fixture，非真实模型输出）`);
  } catch (e) {
    setParseStatus('示例数据读取失败', true);
    return null;
  }
}

// 外部喂入解析结果（真实模型输出回归用）：与 fixture 走同一条 normalizeParse 生产路径
function adoptParse(raw, statusLine) {
  const n = normalizeParse(raw);
  if (!n.ok) { setParseStatus('解析结果无效：' + n.errors.join('; '), true); return null; }
  agentPlan = n.plan;
  agentStandalone = true;   // R6-F5：示例数据=完整独立题目（与题图通道同语义）
  agentPlan.autoTags = deriveTagsFromPlan(n.plan);   // Agent 自动标签
  agentPlanApplied = false;
  agentCorrections = [];
  agentPatchRounds = 0;   // 全新计划：修订轮数清零
  renderParseResult(n.errors);
  setAgentStage('parsed', '解析完成，检查/修正后创建实体');
  setParseStatus(statusLine || '解析结果已载入，请检查/修正后再创建实体');
  return n.plan;
}

// 解析计划的实体匹配（预览与执行共用同一条路径，保证勾选清单与实际一致）
function matchOverrides(overrides) {
  const mixed = doc.entities.length > 0;
  const usedIds = new Set();
  return overrides.map((o, idx) => {
    let reuseId = null;
    if (mixed) {
      const cand = doc.entities.find((e) => e.type === o.type && !usedIds.has(e.id)
        && (e.physics.body || 'dynamic') === (o.physics.body || 'dynamic'));
      if (cand) { reuseId = cand.id; usedIds.add(cand.id); }
    }
    return { o, idx, reuseId };
  });
}

// 构建逐条接受/拒绝的变更清单（renderParseResult 尾部调用，agentPlan 三处来源统一覆盖）
function buildChangePreview() {
  const box = $('changePreview'), list = $('changePreviewList');
  if (!box || !list) return;
  agentChanges = [];
  if (!agentPlan) { box.style.display = 'none'; return; }
  if (!agentPlan.gravityDefault) {
    agentChanges.push({ type: 'gravity', idx: null, label: `调整重力 → ${agentPlan.gravity} m/s²`, skipped: false });
  }
  if (agentPlan.G != null) {
    agentChanges.push({ type: 'G', idx: null, label: `设置场景引力常数 G → ${agentPlan.G}`, skipped: false });
  }
  const matches = matchOverrides(planToOverrides(agentPlan));
  for (const { o, idx, reuseId } of matches) {
    if (reuseId) {
      const e = getEntity(doc, reuseId);
      const diffs = [];
      for (const sect of ['params', 'physics', 'transform']) {
        const oldS = e[sect] || {}, newS = o[sect] || {};
        for (const [k, v] of Object.entries(newS)) {
          if (k === 'linvel' || k === 'angvel') continue;   // 向量太长，摘要略
          const ov = oldS[k];
          if (ov !== undefined && ov !== v && typeof v !== 'object') diffs.push({ k, ov, v });   // AG-548：结构化,渲染层给样式
        }
      }
      agentChanges.push({
        type: 'entity', idx, reuseId,
        label: `更新已有 ${o.type}「${e.name || o.type}」`,
        detail: diffs.length ? '' : '位置/参数按题给重设',
        diffs: diffs.slice(0, 4),   // AG-548：diff 段数组（渲染旧值删除线/新值琥珀）
        skipped: false,
      });
    } else {
      agentChanges.push({ type: 'entity', idx, reuseId: null, label: `新建 ${o.type}「${o.name || o.type}」`, skipped: false });
    }
  }
  if (agentPlan.joint && (agentPlan.kind === 'rotation' || agentPlan.kind === 'hinge')) {
    const jn = agentPlan.joint.type === 'revolute' ? '铰链转轴' : '径向滑槽';
    agentChanges.push({
      type: 'joint', idx: null,
      label: `建立${jn}约束（${(agentPlan.entities[agentPlan.joint.from] || {}).name || `实体${agentPlan.joint.from}`} → ${(agentPlan.entities[agentPlan.joint.to] || {}).name || `实体${agentPlan.joint.to}`}）`,
      detail: '所依赖实体被拒绝时自动跳过', skipped: false,
    });
  }
  // 删除类变更（AG-R1）：removals 在建场前执行——「把小球换成方块」类指令先删后建才不会误删新建体
  let rSeq = 0;
  for (const rm of (agentPlan.removals || [])) {
    const hit = findLocalEntities(rm);
    agentChanges.push({
      type: 'remove', idx: rSeq++,
      targetIds: hit.map((e) => e.id),
      label: hit.length
        ? `删除已有 ${hit.length === 1 ? `「${hit[0].name}」` : `${hit.length} 个匹配「${rm}」的对象`}`
        : `删除「${rm}」（当前场景无匹配）`,
      // AG-532：未命中时列场景现有对象候选（前 3）辅助人工改词——「红色的球」类描述不命中时不再只给一句空话
      detail: hit.length ? '' : (() => {
        const cands = (doc.entities || []).slice(0, 8).map((x) => x.name).filter(Boolean).slice(0, 3);
        return cands.length ? `未找到匹配，将跳过。场景现有：${cands.join('、')}` : '未找到匹配对象，将跳过';
      })(),
      skipped: hit.length === 0,
    });
  }
  let aSeq = 0;
  for (const at of (agentPlan.attaches || [])) {
    agentChanges.push({
      type: 'attach', idx: aSeq++,
      label: `连接${at.type === 'rope' ? '绳' : '弹簧'}（`
        + ((agentPlan.entities[at.from] || {}).name || ('实体' + at.from)) + ' → '
        + ((agentPlan.entities[at.to] || {}).name || '（布局自动补墙）')
        + (at.type === 'spring'
          ? ('，k=' + (at.stiffness ?? '—') + ' N/m，原长 ' + (at.restLength ?? '—') + ' m')
          : ('，绳长 ' + (at.length ?? '—') + ' m')) + '）',
      detail: '所依赖实体被拒绝时自动跳过', skipped: false,
    });
  }
  // 渲染勾选清单
  list.innerHTML = '';
  agentChanges.forEach((c, i) => {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:flex-start;gap:6px;padding:3px 2px;cursor:pointer;font-size: 12px;color:var(--dim)';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !c.skipped;
    // UI-556：取消勾选的行要看得出来（整行降透明），勾回即恢复
    const syncDim = () => { row.style.opacity = cb.checked ? '1' : '.45'; };
    cb.onchange = () => { agentChanges[i].skipped = !cb.checked; syncDim(); };
    const txt = document.createElement('span');
    txt.textContent = c.label;
    if (c.diffs && c.diffs.length) {   // AG-548：旧值删除线灰、新值琥珀（全 textContent 零注入）
      const wrap = document.createElement('span');
      wrap.style.cssText = 'display:inline-flex;flex-wrap:wrap;gap:2px 8px;margin-left:4px';
      for (const d of c.diffs) {
        // 单 span 完整文本「k ov → v」:可选中复制+测试断言可匹配(p18 实锤,拆碎 span 破坏文本完整性)
        const seg = document.createElement('span');
        seg.style.cssText = 'font-family:var(--mono);font-size: 11px;color:var(--dim)';
        seg.textContent = `${d.k} ${d.ov}→${d.v}`;
        wrap.appendChild(seg);
      }
      row.append(cb, txt, wrap);
    } else {
      if (c.detail) txt.textContent += `（${c.detail}）`;
      row.append(cb, txt);
    }
    syncDim();
    list.appendChild(row);
  });
  // 全选/全不选工具行（条目多时逐个点很磨；默认全选语义不变）
  if (agentChanges.length >= 3) {
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;margin-bottom:4px';
    const mkToggle = (txt, on) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.style.cssText = 'font-size: 11px;padding:1px 8px';
      b.onclick = () => { for (const c of agentChanges) c.skipped = !on; buildChangePreview(); };
      return b;
    };
    bar.append(mkToggle('全选（全部应用）', true), mkToggle('全不选（都不应用）', false));
    list.appendChild(bar);
  }
  box.style.display = agentChanges.length ? 'block' : 'none';
}

function renderParseResult(warnings = []) {
  const plan = agentPlan;
  $('parseResultGrp').style.display = 'block';
  const badge = $('parseSrcBadge');
  badge.textContent = plan.fixture ? '示例数据' : 'step-5-preview';
  badge.className = 'badge' + (plan.fixture ? ' given' : '');

  // 元信息（模型字符串一律 textContent，不做 innerHTML）
  const meta = $('parseMeta');
  meta.innerHTML = '';
  const m1 = document.createElement('div');
  m1.className = 'pmeta';
  const typeCell = mrow('题型');
  const confCell = mrow('总体置信度');
  m1.append(typeCell, confCell);
  meta.appendChild(m1);
  typeCell.querySelector('.v').textContent = plan.questionType;
  const confV = confCell.querySelector('.v');
  confV.textContent = (plan.confidence * 100).toFixed(0) + '%';
  confV.title = '模型自报置信度：<70% 红=务必逐项核对，70~85% 琥珀=建议核对，≥85% 正常';
  // 置信度色阶：<70% 红（逐项核对）、70~85% 琥珀、≥85% 正常
  confV.style.color = plan.confidence < 0.7 ? 'var(--danger)' : (plan.confidence < 0.85 ? 'var(--accent)' : 'var(--text)');
  if (plan.goal) {
    const g = document.createElement('div');
    g.className = 'k';
    g.style.cssText = 'font-size: 11px;color:var(--faint)';
    g.textContent = '目标';
    const gv = document.createElement('div');
    gv.style.cssText = 'font-size: 12px;color:var(--dim);margin:2px 0 8px';
    gv.textContent = plan.goal;
    meta.append(g, gv);
  }
  // 重力（可编辑）
  const grow = document.createElement('div');
  grow.className = 'frow';
  grow.innerHTML = `<label style="flex:0 0 auto;font-size: 11px;color:var(--dim)">重力</label>
    <input type="number" step="0.1" min="0" max="50" style="flex:1"><span class="u">m/s²</span>
    <span class="badge" style="margin-left:6px"></span>`;
  const gInput = grow.querySelector('input');
  gInput.value = plan.gravity;
  gInput.onchange = () => {
    const v = Number(gInput.value);
    if (!Number.isFinite(v) || v < 0 || v > 50) {
      // UI-553：重力行同款 .bad 反馈（与 numRow 双标准问题一并收口）
      gInput.classList.add('bad');
      setTimeout(() => { if (gInput.isConnected) { gInput.classList.remove('bad'); gInput.value = plan.gravity; } }, 2200);
      return;
    }
    gInput.classList.remove('bad');
    recordCorrection('gravity', plan.gravity, v);
    plan.gravity = v;
  };
  grow.querySelector('.badge').textContent = plan.gravityDefault ? '默认' : '题给';
  grow.querySelector('.badge').className = 'badge' + (plan.gravityDefault ? '' : ' given');
  // AG-529：国内教材大量题按 g=10 出题——gravityDefault(9.81)时给一键切换,理论对照不再系统性偏 ~2%
  if (plan.gravityDefault) {
    const g10 = document.createElement('button');
    g10.textContent = '按 g=10';
    g10.title = '题目按 g=10 m/s² 出题时一键切换（国内教材常用值），也可直接在输入框改任意值';
    g10.style.cssText = 'flex:none;padding:1px 8px;font-size: 11px;background:transparent;border:1px solid var(--line-strong);border-radius:var(--r-ctl);color:var(--dim);cursor:pointer';
    g10.onmouseenter = () => { g10.style.borderColor = 'var(--accent)'; g10.style.color = 'var(--accent-hi)'; };
    g10.onmouseleave = () => { g10.style.borderColor = 'var(--line-strong)'; g10.style.color = 'var(--dim)'; };
    g10.onclick = () => {
      const v = Number(gInput.value) === 10 ? 9.81 : 10;
      gInput.value = v;
      recordCorrection('gravity', plan.gravity, v);
      plan.gravity = v;
      plan.gravityDefault = false;
      grow.querySelector('.badge').textContent = '题给';
      grow.querySelector('.badge').className = 'badge given';
      toast(`重力按 g=${v} m/s²（理论对照将用此值）`);
    };
    grow.appendChild(g10);
  }
  meta.appendChild(grow);
  // 环境条件（Goal 七：环境条件字段，非空才显示）
  if (plan.environment) {
    const erow = document.createElement('div');
    erow.className = 'k';
    erow.style.cssText = 'font-size: 11px;color:var(--faint)';
    erow.textContent = '环境条件';
    const ev = document.createElement('div');
    ev.style.cssText = 'font-size: 12px;color:var(--dim);margin:2px 0 8px';
    ev.textContent = plan.environment;
    meta.append(erow, ev);
  }
  if (warnings.length) {
    const w = document.createElement('div');
    w.className = 'hint';
    w.style.color = 'var(--danger)';
    w.textContent = '警告: ' + warnings.join('; ');
    meta.appendChild(w);
  }

  // 实体行
  const box = $('parseEntities');
  box.innerHTML = '';
  // 摩擦是成对属性：球未显式给摩擦时，默认值取两侧显式摩擦的最小值（与 planToOverrides 建场一致）
  const rampEnt = plan.entities.find((x) => x.type === 'ramp');
  const ballEnt0 = plan.entities.find((x) => x.type === 'sphere');
  const pairF = [ballEnt0 ? ballEnt0.given.friction : null, rampEnt ? rampEnt.given.friction : null].filter((v) => v != null);
  const pairFriction = pairF.length ? Math.min(...pairF) : null;
  plan.entities.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'pe-row';
    const head = document.createElement('div');
    head.className = 'pe-head';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = e.name;
    const ty = document.createElement('span');
    ty.className = 'ty';
    ty.style.cssText = 'font-family:var(--mono);font-size: 11px;color:var(--dim)';
    ty.textContent = registry.getComponent(e.type).label;
    const conf = document.createElement('span');
    conf.className = 'conf';
    conf.textContent = e.confidence != null ? (e.confidence * 100).toFixed(0) + '%' : '--';
    // UI-552：单实体置信度复用总体同款色阶，弱项可扫读
    if (e.confidence != null) conf.style.color = e.confidence < 0.7 ? 'var(--danger)' : (e.confidence < 0.85 ? 'var(--accent)' : 'var(--faint)');
    head.append(nm, ty, conf);
    // AG-547：多实体评审折叠——16 实体×4 字段超长难扫;头行点击 toggle,非首实体默认收起
    if (plan.entities.length > 4) {   // >4 才折叠:2~3 实体全展开更好改(p1 实锤),16 实体才需要收起扫读
      head.style.cursor = 'pointer';
      head.title = '点击展开/收起该实体的可编辑字段';
      const caret = document.createElement('span');
      caret.textContent = '▸';
      caret.style.cssText = 'color:var(--faint);font-size: 10px;transition:transform .15s;flex:none';
      head.appendChild(caret);
      const collapsed = i !== 0;
      let open = !collapsed;
      const syncFold = () => {
        grid.style.display = open ? '' : 'none';
        caret.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
      };
      head.onclick = (ev) => {
        if (ev.target.closest('input,select,button')) return;   // 表单控件点击不折叠
        open = !open; syncFold();
      };
      requestAnimationFrame(syncFold);
    }
    row.appendChild(head);
    const grid = document.createElement('div');
    grid.className = 'pgrid';
    for (const [key, label, unit, def, range] of PEDIT[e.type]) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const lab = document.createElement('label');
      lab.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = 'any';
      const given = plan.entities[i].given;
      const inferredKeys = Array.isArray(plan.entities[i].inferred) ? plan.entities[i].inferred : [];
      const defVal = (e.type === 'sphere' && key === 'friction' && pairFriction != null) ? pairFriction : def;
      const val = given[key] !== undefined ? given[key] : defVal;
      inp.value = fmtNum(val);
      const src = document.createElement('span');
      const isInferred = given[key] !== undefined && inferredKeys.includes(key);
      src.className = 'badge' + (given[key] !== undefined ? ' given' : '');
      src.textContent = isInferred ? '推断' : (given[key] !== undefined ? '题给' : '默认');
      // UI-554：归因徽标给教师解释（题给/默认/推断各是什么口径）
      src.title = isInferred ? '推断：模型推算值，建议核对（改动后自动转为题给）'
        : (given[key] !== undefined ? '题给：题目原文明示的数值' : '默认：组件缺省值（题目未给出）');
      inp.onchange = () => {
        const v = Number(inp.value);
        if (!Number.isFinite(v) || v < range[0] || v > range[1]) {
          // UI-553：与检查器 numRow 同款反馈，不再静默还原
          inp.classList.add('bad');
          inp.title = `允许范围 ${range[0]} ~ ${range[1]}${unit ? ' ' + unit : ''}`;
          setTimeout(() => { if (inp.isConnected) { inp.classList.remove('bad'); inp.value = val; } }, 2200);
          return;
        }
        inp.classList.remove('bad');
        recordCorrection(`entities[${i}].${key}`, val, v);
        plan.entities[i].given[key] = v;
        if (inferredKeys.includes(key)) inferredKeys.splice(inferredKeys.indexOf(key), 1);   // 用户改过=接管归因
        src.textContent = '题给';
        src.className = 'badge given';
      };
      cell.append(lab, inp);
      if (unit) { const u = document.createElement('span'); u.className = 'u'; u.textContent = unit; cell.appendChild(u); }
      cell.appendChild(src);
      grid.appendChild(cell);
    }
    row.appendChild(grid);
    box.appendChild(row);
  });

  // 观察 / 固定点 / 关键点 / 未知 / 无法确定 / 假设（Goal 七字段清单逐项落点）
  const lists = $('parseLists');
  lists.innerHTML = '';
  appendList(lists, '要求观察', plan.observations);
  appendList(lists, '固定点', plan.anchorPoints);
  appendList(lists, '关键点', plan.keyPoints);
  appendList(lists, '未知量', plan.unknowns);
  appendList(lists, '无法确定（需确认）', plan.uncertain);
  appendList(lists, '假设', plan.assumptions);
  buildChangePreview();
}

function mrow(k) {
  const d = document.createElement('div');
  d.innerHTML = `<div class="k"></div><div class="v" style="font-family:var(--mono);font-size: 13px;color:var(--accent)"></div>`;
  d.querySelector('.k').textContent = k;
  return d;
}

function appendList(parent, title, items) {
  if (!items || !items.length) return;
  const t = document.createElement('div');
  t.className = 'k';
  t.style.cssText = 'font-size: 11px;color:var(--faint);margin-top:8px';
  t.textContent = title;
  const ol = document.createElement('ol');
  ol.className = 'plist';
  for (const it of items) {
    const li = document.createElement('li');
    li.textContent = it;
    ol.appendChild(li);
  }
  parent.append(t, ol);
}

function recordCorrection(field, from, to) {
  if (from === to) return;
  agentCorrections.push({ field, from, to, at: new Date().toISOString() });
}

// 确认建场：全部经 window.MECH 白名单操作（与目录添加/Agent 未来调用同一条路径）。
// opts.vivid（面板「创建场景实体」按钮）：分批落场+分块探针，用户全程看得到搭建过程（AG-V2）；
// 默认（MECH.loadParse 等程序通道）：同步一次落场，行为与历史版本一致（测试兼容）。
let applyAgentBusy = false;   // UX-audit F1：vivid 建场分批 await 期间双击会交错重入（实测双击=双份弹簧）
async function applyAgentPlan(opts = {}) {
  // agentPatchBusy 通行：patch 重放链自身单飞（agentPatchBusy 守卫），且它由 verify 的
  // finally 同步调度——此刻外层建的锁还没走到 finally 释放（微任务竞态实测吞掉 patch 的
  // apply→verify 不重跑→多烧一轮）。锁只挡用户双击。
  if (applyAgentBusy && !agentPatchBusy) { toast('正在建场，请等这一批完成'); return; }
  if (!agentPlan) { toast('没有可用的解析结果'); return; }
  if (mode !== 'edit') { toast('运行态不可建场，请先重置'); return; }
  applyAgentBusy = true;
  const ap = $('btnApplyParse');   // UI-544：vivid 分批建场期间禁手+进度文案（双击此前只靠 toast 事后拦）
  if (ap) { ap.disabled = true; setBtnText('btnApplyParse', '建场中…'); }
  try {
    await applyAgentPlanGuarded(opts);
  } finally {
    applyAgentBusy = false;
    if (ap) { ap.disabled = false; setBtnText('btnApplyParse', '创建场景实体'); }
  }
}

async function applyAgentPlanGuarded(opts = {}) {
  const M = window.MECH;
  // R6-F5 独立成题自清场（agent 鲁棒性）：题图/示例通道的解析是「一道完整的题」，
  // 旧场景（上次演示/预置残留）与新题无关——混合复用会把新体埋进旧装置（实测：
  // 3kg 挂球落在残留斜坡上动弹不得，a 从 1.96 掉到 0.15）。建场前自清，独立成
  // 一条历史可单独撤销；文字通道（"往这个场景加…"混合搭建语义）不触发。
  if (agentStandalone && doc.entities.length > 0) {
    const names = doc.entities.map((e) => e.name || e.type).join('、');
    beginHistoryBatch();
    try {
      for (const ent of [...doc.entities]) docRemove(doc, ent.id);
      selectedIds = [];
      selectedId = null;
      rebuildAll();
    } finally {
      endHistoryBatch('Agent 清空旧场景（独立成题）');
    }
    agentOps.push({ op: '清空旧场景', target: names, ok: true });
    toast('题图独立成题：已清空旧场景后重建');
  }
  const wasEmpty = doc.entities.length === 0;
  if (!opts.vivid) {
    let batchReused = 0, batchCreated = 0, batchRemoved = 0;
    beginHistoryBatch();
    rebuildSuspend++;   // 批内 N 次 addComponent 不再各自重建 Rapier 世界，收尾一次（PER-5）
    try {
      applyAgentPlanInner(M, (r, c, rm) => { batchReused = r; batchCreated = c; batchRemoved = rm || 0; });
    } finally {
      rebuildSuspend--;
      rebuildAll();
      endHistoryBatch(wasEmpty ? 'Agent 按解析建场' : `Agent 混合建场（更新 ${batchReused}+新增 ${batchCreated}${batchRemoved ? `+删除 ${batchRemoved}` : ''}）`);
    }
    // AG-V：建场完成自动自查（静态→修复→探针→理论），报告进 Agent 页签
    if (agentVerifyCtx && agentVerifyCtx.items.length) runAgentVerify(true);
    return;
  }
  await applyAgentPlanVivid(M, wasEmpty, opts);
}

// vivid 分批建场（AG-V2）：删除先行，实体逐件落场（每件重建→出生下落立刻可见），
// 连接件/关节在共享后处理收尾，整批一条历史。节奏自适应：总量压在 ~1s 内（测试 sleep 兼容）。
async function applyAgentPlanVivid(M, wasEmpty, opts = {}) {
  const rejected = new Set(agentChanges.filter((c) => c.skipped)
    .map((c) => c.type + (c.idx != null ? ':' + c.idx : '')));
  beginHistoryBatch();
  let batchReused = 0, batchCreated = 0, batchRemoved = 0;
  try {
    if (!agentPlan.gravityDefault && !rejected.has('gravity')) M.setGravity(agentPlan.gravity);
    if (agentPlan.G != null && !rejected.has('G')) M.setG(agentPlan.G);
    if (doc.entities.some((e) => e.physics.gravitating) && !trailsOn) setTrails(true);
    if (agentPlan.kind === 'rotation') doc.kind = 'rotation';
    const created = [];
    agentOps.length = 0;
    // 删除先行（AG-R1）：先删后建才不会「换成X」误删新建体
    let nRemoved = 0;
    let remSeq = 0;
    for (const rm of (agentPlan.removals || [])) {
      const c = agentChanges.find((x) => x.type === 'remove' && x.idx === remSeq);
      remSeq++;
      if (!c || c.skipped) continue;
      for (const id of (c.targetIds || [])) {
        const e = getEntity(doc, id);
        if (!e) continue;
        removeInBatch(id);
        nRemoved++;
        agentOps.push({ op: '删除', target: e.name, ok: true });
      }
    }
    if (nRemoved) {
      selectedIds = selectedIds.filter((x) => getEntity(doc, x));
      if (!getEntity(doc, selectedId)) selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
      rebuildAll();
    }
    batchRemoved = nRemoved;
    const overrides = planToOverrides(agentPlan);
    const matches = matchOverrides(overrides);
    const mixed = doc.entities.length > 0;
    let nReused = 0, nCreated = 0;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Playwright/webdriver 下节奏归零：套件的固定 sleep 与条件等待都按同步建场写——
    // 生动分批只给真人浏览器（AG-V2 呈现层节奏与行为正确性解耦）
    const delay = (typeof navigator !== 'undefined' && navigator.webdriver) ? 0
      : Math.max(40, Math.min(150, Math.round(900 / Math.max(matches.length, 1))));
    for (let i = 0; i < matches.length; i++) {
      const { o, idx, reuseId } = matches[i];
      setAgentStage('building', `搭场景 ${i + 1}/${matches.length}：${o.name || o.type}`);
      if (rejected.has('entity:' + idx)) {
        created.push(null);
        agentOps.push({ op: '跳过 ' + o.type, target: o.name || o.type, ok: true });
        continue;
      }
      let id = null;
      if (reuseId) {
        const cand = getEntity(doc, reuseId);
        if (cand) {
          const patch = { params: o.params, transform: o.transform, physics: o.physics, source: 'agent' };
          if (M.updateEntity(cand.id, patch, `Agent 按「${agentPlan.questionType}」更新 ${cand.name || o.type}（混合）`)) {
            id = cand.id; nReused++;
            agentOps.push({ op: '更新 ' + o.type, target: cand.name || o.type, ok: true });
          } else {
            agentOps.push({ op: '更新 ' + o.type, target: cand.name || o.type, ok: false });
          }
        }
      }
      if (!id) {
        id = M.addComponent(o.type, o);
        if (id) { nCreated++; agentOps.push({ op: '创建 ' + o.type, target: o.name || o.type, ok: true }); }
        else agentOps.push({ op: '创建 ' + o.type, target: o.name || o.type, ok: false });
      }
      created.push(id);
      rebuildAll();
      if (id) selectEntity(id);
      if (delay) await sleep(delay);   // webdriver=0:完全同步完成(测试读档不落在建场中态)
    }
    batchReused = nReused; batchCreated = nCreated;
    agentPostPass(M, created, rejected, mixed, nReused, nCreated, matches);
  } finally {
    endHistoryBatch(opts.patch
      ? `Agent 模型修订重建（第 ${agentPatchRounds} 轮，自查未过自动触发）`
      : (wasEmpty ? 'Agent 按解析建场' : `Agent 混合建场（更新 ${batchReused}+新增 ${batchCreated}${batchRemoved ? `+删除 ${batchRemoved}` : ''}）`));
  }
  if (agentVerifyCtx && agentVerifyCtx.items.length) await runAgentVerify(true);
}

// 批内删除（Agent 建场历史批次专用）：级联 attach/joint 清理，不 rebuild 不进历史（外层 endHistoryBatch 统一记账）
function removeInBatch(id) {
  const removed = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const tid = queue.shift();
    const e = getEntity(doc, tid);
    if (!e) continue;
    docRemove(doc, tid);
    for (const other of [...doc.entities]) {
      if (Array.isArray(other.attach) && other.attach.includes(tid) && !removed.has(other.id)) {
        removed.add(other.id);
        queue.push(other.id);
      }
    }
  }
  for (const e of doc.entities) {
    if (Array.isArray(e.joints) && e.joints.some((j) => removed.has(j.target))) {
      e.joints = e.joints.filter((j) => !removed.has(j.target));
    }
  }
}

function applyAgentPlanInner(M, reportCounts) {
  // 逐条接受/拒绝：用户取消勾选的变更跳过（gravity/G/单条实体/约束）
  const rejected = new Set(agentChanges.filter((c) => c.skipped)
    .map((c) => c.type + (c.idx != null ? ':' + c.idx : '')));
  if (!agentPlan.gravityDefault && !rejected.has('gravity')) M.setGravity(agentPlan.gravity);
  if (agentPlan.G != null && !rejected.has('G')) M.setG(agentPlan.G);
  if (doc.entities.some((e) => e.physics.gravitating) && !trailsOn) setTrails(true);   // 天体场景轨道线是观察必需
  if (agentPlan.kind === 'rotation') doc.kind = 'rotation';
  const overrides = planToOverrides(agentPlan);
  const created = [];
  agentOps.length = 0;
  // 删除类变更先行（AG-R1）：预览阶段解析好的 targetIds 逐一复核存在性（用户可能在评审间隙手动改过场景）。
  // 批内不走 opRemoveEntity（它自带 commitChange/rebuild 会嵌套历史批次），手动做级联清理，收尾统一 rebuild。
  let remSeq = 0;
  let nRemoved = 0;
  for (const rm of (agentPlan.removals || [])) {
    const c = agentChanges.find((x) => x.type === 'remove' && x.idx === remSeq);
    remSeq++;
    if (!c || c.skipped) continue;
    for (const id of (c.targetIds || [])) {
      const e = getEntity(doc, id);
      if (!e) continue;
      removeInBatch(id);
      nRemoved++;
      agentOps.push({ op: '删除', target: e.name, ok: true });
    }
  }
  if (nRemoved) {
    selectedIds = selectedIds.filter((x) => getEntity(doc, x));
    if (!getEntity(doc, selectedId)) selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
  }
  // 混合搭建：场景非空时优先复用同类型+同刚体类型的已有实体（尊重用户已有对象，
  // 不推翻重建；保留用户命名与材质，仅按题目更新几何/位姿/物理参数）
  const matches = matchOverrides(overrides);
  const mixed = doc.entities.length > 0;
  let nReused = 0, nCreated = 0;
  for (const { o, idx, reuseId } of matches) {
    if (rejected.has('entity:' + idx)) {
      created.push(null);
      agentOps.push({ op: '跳过 ' + o.type, target: o.name || o.type, ok: true });
      continue;
    }
    let id = null;
    if (reuseId) {
      const cand = getEntity(doc, reuseId);
      if (cand) {
        const patch = { params: o.params, transform: o.transform, physics: o.physics, source: 'agent' };
        if (M.updateEntity(cand.id, patch, `Agent 按「${agentPlan.questionType}」更新 ${cand.name || o.type}（混合）`)) {
          id = cand.id; nReused++;
          agentOps.push({ op: '更新 ' + o.type, target: cand.name || o.type, ok: true });
        } else {
          agentOps.push({ op: '更新 ' + o.type, target: cand.name || o.type, ok: false });
        }
      }
    }
    if (!id) {
      id = M.addComponent(o.type, o);
      if (id) { nCreated++; agentOps.push({ op: '创建 ' + o.type, target: o.name || o.type, ok: true }); }
      else agentOps.push({ op: '创建 ' + o.type, target: o.name || o.type, ok: false });
    }
    created.push(id);
  }
  reportCounts(nReused, nCreated, nRemoved);
  setAgentStage('building', (mixed
    ? `混合模式：更新 ${nReused} 个已有实体，新增 ${nCreated} 个`
    : '按解析计划创建实体…') + (nRemoved ? `，删除 ${nRemoved} 个` : ''));
  if (mixed) setParseStatus(`混合建场：复用已有同类型实体（保留命名/材质，参数按题给更新）+ 新增 ${nCreated} 个${agentPlan.gravityDefault ? '' : '；重力已按题给调整'}`);
  agentPostPass(M, created, rejected, mixed, nReused, nCreated, matches);
}
// Agent 建场共享后处理（同步/vivid 两路径共用）：滑轮回填、关节、元数据、连接件、
// 自查上下文快照、收尾 UI。连接绳长=端距×1.03（AG-V2，长于端距才有垂坠）：挂重物
// 落下绷紧接住→垂一垂→摆动（rope joint 单侧拉紧不弹射）；模型显式题给绳长忠实不动。
function agentPostPass(M, created, rejected, mixed, nReused, nCreated, matches) {
  // atwood 类：onPulley 占位符回填真实滑轮 id，并重建使约束收集生效
  if (agentPlan.entities.some((e) => e.type === 'pulley')) {
    const pi = agentPlan.entities.findIndex((e) => e.type === 'pulley');
    const pulleyId = created[pi];
    if (pulleyId) {
      for (const e of doc.entities) if (e.physics.onPulley === '__PULLEY__') e.physics.onPulley = pulleyId;
      rebuildAll();
    }
  }
  // rotation 类：plan.joint 的 from/to 为实体索引，建场后映射为真实 id 建滑槽约束
  if (agentPlan.joint && (agentPlan.kind === 'rotation' || agentPlan.kind === 'hinge')
    && !rejected.has('joint')) {
    const fromId = created[agentPlan.joint.from], toId = created[agentPlan.joint.to];
    if (fromId && toId) {
      let jd = null;
      if (agentPlan.joint.type === 'revolute') {
        // 铰链锚点 = 杆近端：anchor2 沿杆局部 -x 半长（杆绕近端摆）
        const rodE = getEntity(doc, toId);
        const halfLen = rodE ? (rodE.params.sx || 0.5) / 2 : 0.5;
        jd = { type: 'revolute', target: toId, axis: agentPlan.joint.axis || [0, 0, 1],
          anchor1: agentPlan.joint.anchor1 || [0, 0, 0], anchor2: [-halfLen, 0, 0] };
      } else {
        // 滑槽锚点：模型常省略 anchor → 按「滑块实际位置−转台位置」推导（即滑块挂点），
        // 缺省 [0,0,0] 会让约束初始错位（猛拉注入能量，L 守恒崩坏）
        const eFrom = getEntity(doc, fromId), eTo = getEntity(doc, toId);
        const p1 = eFrom ? eFrom.transform.pos : [0, 0, 0], p2 = eTo ? eTo.transform.pos : [0, 0, 0];
        const a1 = agentPlan.joint.anchor1 && agentPlan.joint.anchor1.some((v) => Math.abs(v) > 1e-9)
          ? agentPlan.joint.anchor1 : [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
        jd = { type: 'prismatic', target: toId, axis: agentPlan.joint.axis, limits: agentPlan.joint.limits,
          anchor1: a1, anchor2: agentPlan.joint.anchor2 || [0, 0, 0] };
      }
      M.updateEntity(fromId, { joints: [jd] },
        agentPlan.joint.type === 'revolute' ? '建立铰链转轴' : '建立径向滑槽约束');
    }
  }
  M.setAgentMeta({
    assumptions: [...agentPlan.assumptions],
    corrections: [...agentCorrections],
    origin: {
      questionType: agentPlan.questionType,
      goal: agentPlan.goal,
      fixture: agentPlan.fixture,
      observations: [...agentPlan.observations],
      unknowns: [...agentPlan.unknowns],
      confidence: agentPlan.confidence,
      mixed,
      reused: nReused,
      created: nCreated,
      at: new Date().toISOString(),
    },
  });
  refreshAssumpPanel();
  // 连接类（绳/弹簧）：plan.attaches 的 from/to 索引 → 真实 id
  let attachSeq = 0;
  for (const at of (agentPlan.attaches || [])) {
    if (rejected.has('attach:' + attachSeq)) {
      attachSeq++;
      agentOps.push({ op: '跳过 连接 ' + at.type, target: '#' + at.from + ' ' + '#' + at.to, ok: true });
      continue;
    }
    attachSeq++;
    const fromId = created[at.from], toId = created[at.to];
    if (!fromId || !toId) { agentOps.push({ op: '连接 ' + at.type, target: '#' + at.from + ' ' + '#' + at.to, ok: false }); continue; }
    const ea = getEntity(doc, fromId), eb = getEntity(doc, toId);
    if (!ea || !eb) continue;
    // UX-audit F1：同类型+同端对的连接件已存在则跳过——重复应用同一计划（双击/改勾选重放）
    // 不再翻倍弹簧/绳（实测双击 btnApplyParse = 2 根弹簧）
    const dup = doc.entities.find((e) => e.type === at.type && Array.isArray(e.attach) && e.attach.length === 2
      && ((e.attach[0] === fromId && e.attach[1] === toId) || (e.attach[0] === toId && e.attach[1] === fromId)));
    if (dup) { agentOps.push({ op: '连接已存在，跳过 ' + at.type, target: ea.name + ' 与 ' + eb.name, ok: true }); continue; }
    const pa = ea.transform.pos, pb = eb.transform.pos;
    const dist = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
    const params = at.type === 'rope'
      ? { length: at.length ?? +(dist * 1.03).toFixed(3) }   // AG-V2：长于端距 3%=有松弛,挂重物落下绷紧才垂坠摆动
      : { stiffness: at.stiffness ?? 20, restLength: at.restLength ?? +dist.toFixed(3), damping: at.damping ?? 0.5 };
    const id = M.addComponent(at.type, { name: (at.type === 'rope' ? '绳 ' : '弹簧 ') + dist.toFixed(2) + 'm', params, attach: [fromId, toId], source: 'agent' });
    if (id) { created.push(id); agentOps.push({ op: '连接 ' + at.type, target: ea.name + ' 与 ' + eb.name, ok: true }); }
    else agentOps.push({ op: '连接 ' + at.type, target: ea.name + ' 与 ' + eb.name, ok: false });
  }
  // Agent 自动标签落场（SCN）：空场景/未命名场景首建时，题型派生标签进 doc（保存入库可检索）
  if ((doc.tags || []).length === 0 && (agentPlan.autoTags || []).length) {
    doc.tags = [...agentPlan.autoTags];
    toast(`已按解析创建 ${created.length} 个实体 · 自动标签 ${doc.tags.map((t) => '#' + t).join('')}`);
  } else {
    toast(`已按解析创建 ${created.length} 个实体${agentPlan.fixture ? '（示例数据）' : ''}`);
  }
  markDirty();
  agentPlanApplied = true;
  setAgentStage('built', `已建场 ${created.length} 实体，可运行并生成解释`);
  // 建场成功即开放"运行并生成解释"（解释体在运行后填充）。
  // 不再强制跳检查器页签（UI-48）：操作明细就在本页签，跳走会打断核对；相机自动取景代偿（UI-49）
  $('explainGrp').style.display = 'block';
  viewport.focusScene();
  // AG-V 自查上下文：本次解析建出的实体/连接快照（探针与静核只对 Agent 建的东西负责，
  // 用户手动加的对象不进核对范围）；rewrites 在混合复用时取建场后的实际位姿
  agentVerifyCtx = {
    plan: agentPlan,
    kind: agentPlan.kind || '',
    items: [],
    attaches: [],
  };
  const rampOv = matches.map((m) => m.o).find((o) => o.type === 'ramp');
  agentVerifyCtx.ramp = rampOv ? { params: rampOv.params } : null;
  for (const { o, idx, reuseId } of matches) {
    const id = created[idx];
    const e = id != null ? getEntity(doc, id) : null;
    if (!e) continue;
    agentVerifyCtx.items.push({
      id: e.id, type: e.type, name: e.name,
      params: e.params || {}, pos: [...e.transform.pos], rotY: (e.transform.rot || [0, 0, 0])[1] || 0,
      isDynamic: e.physics.body === 'dynamic',
      given: agentPlan.entities[idx] ? agentPlan.entities[idx].given : {},
      planIdx: idx,
    });
  }
  let avSeq = 0;
  for (const at of (agentPlan.attaches || [])) {
    if ((agentChanges.find((c) => c.type === 'attach' && c.idx === avSeq) || {}).skipped) { avSeq++; continue; }
    avSeq++;
    const ea = getEntity(doc, created[at.from]), eb = getEntity(doc, created[at.to]);
    if (!ea || !eb) continue;
    agentVerifyCtx.attaches.push({
      type: at.type, aName: ea.name, bName: eb.name,
      aPos: [...ea.transform.pos], bPos: [...eb.transform.pos],
      length: at.length ?? null, restLength: at.restLength ?? null,
    });
  }
}


// ============ 建场自查（AG-V）：静态核对 → 自动修复 → 运动探针 → 理论对照 ============
// 用户需求：Agent 要能自己发现自己建的系统与题目的误差、自身的 bug（球没放对位置/卡死等）。
// 探针=同步确定性步进（rAF 不介入），跑完重置回初始态，不脏文档不进历史（修复走独立批次）。
let agentVerifyCtx = null;
let agentVerifyState = null;
let verifyBusy = false;
// AG-V3 语义自修正：自查剩余 error 时把报告回喂模型出修订计划→重建→复验。
// 上限 2 轮防打转；失败（网络/无效输出）后钉死轮数，宁可交给手动也不无限烧 API。
let agentPatchBusy = false;
let agentPatchRounds = 0;
const AGENT_PATCH_MAX = 2;

async function runAgentVerify(auto = true) {
  if (verifyBusy) return;
  if (!agentVerifyCtx) { if (!auto) toast('没有可自查的建场记录'); return; }
  verifyBusy = true;
  const rb = $('btnRerunVerify');   // UI-549：自查秒级可完成但可连点 → busy 态禁手
  if (rb) { rb.disabled = true; setBtnText('btnRerunVerify', '自查中…'); }
  try {
    await runAgentVerifyInner();
  } finally {
    verifyBusy = false;
    if (rb) { rb.disabled = false; setBtnText('btnRerunVerify', '重跑自查'); }
    // 修订触发放在 verify 闭周期外：patch 内部会重放完整建场+verify，
    // 若在 verifyBusy=true 时递归会被自锁挡掉（首版设计踩过）。
    scheduleAgentPatch();
  }
}

function scheduleAgentPatch() {
  const st = agentVerifyState;
  if (!st || !st.summary.error) return;
  if (agentPatchBusy || agentPatchRounds >= AGENT_PATCH_MAX) return;
  if (!agentPlan || parseBusy || mode !== 'edit') return;
  maybeAgentPatch().catch(() => { setAgentStage('built', '自查未过；模型修订失败'); agentPatchBusy = false; });
}

async function maybeAgentPatch() {
  const st = agentVerifyState;
  if (!st || agentPatchBusy || agentPatchRounds >= AGENT_PATCH_MAX) return;
  agentPatchBusy = true;
  const rnd = agentPatchRounds + 1;
  const fail = (msg) => {
    setAgentStage('built', `自查未过；${msg}`);
    setParseStatus(msg + '（可手动调整后重跑自查）', true);
    agentPatchRounds = AGENT_PATCH_MAX;   // 失败即停：不让静默的重试循环烧 key
  };
  setAgentStage('patching', `自查未过，模型修订中（第 ${rnd}/${AGENT_PATCH_MAX} 轮）…`);
  setParseStatus(`自查发现 ${st.summary.error} 处未解决问题，正在请模型修订计划（第 ${rnd}/${AGENT_PATCH_MAX} 轮）…`, false, true);
  try {
    const out = await parseWithRetry('/api/parse-patch', {
      text: ($('agentTextReq') && $('agentTextReq').value.trim()) || '',
      plan: agentPlan,
      verify: { summary: st.summary, issues: patchBrief(st.findings) },
    });
    if (!out.ok || !out.parse) { fail('模型修订失败：' + (out.error || '空响应')); return; }
    const n = normalizeParse(out.parse);
    if (!n.ok) { fail('修订计划无效：' + n.errors.join('; ')); return; }
    agentPlan = n.plan;
    agentPlan.autoTags = deriveTagsFromPlan(n.plan);
    agentPlanApplied = false;
    agentPatchRounds = rnd;
    renderParseResult([`第 ${rnd} 轮模型修订（自查未过自动触发）`]);
    setParseStatus(`模型已修订计划（第 ${rnd} 轮），重新建场验证…`, false, true);
    await applyAgentPlan({ vivid: true, patch: true });   // 尾部自带完整复验→可再触发下一轮
    // 关互斥（AG-72）：上面那句把 parseBusy 置真后没人收尾，重武装 schedule 会被 parseBusy 卡死（实测）
    setParseStatus(`模型修订第 ${rnd} 轮已重建并复验，结果见自查报告`, false);
  } catch (e) {
    // AG-599：网络类失败（超时/连接失败）不计入修订轮数——瞬断不该永久放弃修订；
    // 只有模型真的回了话（out.ok=false / 计划无效）才钉死轮数
    const netFail = e && (e.name === 'AbortError' || e.name === 'TypeError');
    if (netFail) {
      setAgentStage('built', '自查未过；修订请求网络失败（未计轮数）');
      setParseStatus('修订请求网络失败（未计入修订轮数）——网络恢复后点「重跑自查」可再试', true);
    } else {
      fail('模型修订请求失败' + (e && e.message ? '：' + String(e.message).slice(0, 120) : ''));
    }
  } finally {
    agentPatchBusy = false;
    // 再武装：本轮重建后的场景若仍有 error，schedule 在这里补触发（V2 finally 时 busy 还挂着
    // 会被挡掉——不补这条，第 2 轮永远不会来，脏修订计划的封顶路径实测卡死）。轮数上限在
    // schedule 内判定，天然收敛到 ≤AGENT_PATCH_MAX。
    scheduleAgentPatch();
  }
}

async function runAgentVerifyInner() {
  const ctx = agentVerifyCtx;
  // ---- 1. 静态核对：穿透（26 向射线）+ 坡面语义/题给位置/连接（纯函数） ----
  const penetrations = {};
  for (const it of ctx.items) {
    // bowl=开放薄壳：自心 26 向射线必穿自家开口打到腔内物体，误判「碗嵌球」并把碗阶梯
    // 抬成悬空（B5 双次实锤）。凹腔内的球由球自身嵌入核对兜底（球的射线只扫到局部碗壁）。
    // bowl=开放薄壳/绳·弹簧=连接件 mesh(悬链穿过端物体是常态,无碰撞体)——都不参与嵌入口径(MOD-504 竖直圆实锤:正下方球被绳段误判抬飞)
    penetrations[it.id] = (it.type === 'bowl' || it.type === 'rope' || it.type === 'spring' || it.type === 'tank') ? 0 : (entityPoseBlocked(it.id, it.pos) || 0);
  }
  let findings = auditStatic({ ...ctx, penetrations });
  // ---- 2. 自动修复（一轮 ≤6 处）：嵌入抬升 / 坡面重算落点 / 题给位置还原 ----
  let repaired = 0;
  const fixables = findings.filter((f) => f.sev === 'error' && f.repair);
  if (fixables.length) {
    const fixes = [];
    for (const f of fixables.slice(0, 6)) {
      const it = ctx.items.find((x) => x.id === f.id);
      if (!it) continue;
      let np = null;
      // 修复候选位必须过实机网格口径（entityPoseBlocked，与定罪的同一把尺）才落地——
      // 探针网格/实机网格在斜坡楔体边缘会有分叉，双尺必翻车（complex 场景实测）。
      // 阶梯到 1.2m 管深嵌（方块嵌斜坡要 >0.5m）；环搜搬家兜底（己身占位不干扰）。
      const spotOk = (c) => entityPoseBlocked(it.id, c) === 0;
      if (f.repair === 'lift') {
        const cands = [0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.8, 1.2].map((lift) => [it.pos[0], it.pos[1] + lift, it.pos[2]]);
        const spot = placementFindSpot(it.type, it.params, it.pos, it.rotY, it.isDynamic);
        if (spot) cands.push(spot);
        np = cands.find(spotOk) || null;
      } else if (f.repair === 'onramp' && ctx.ramp) {
        np = ballOnRamp(rampGeomFromParams(ctx.ramp.params), it.params.radius ?? 0.15);
        if (!spotOk(np)) {
          const cands = [0.02, 0.05, 0.1, 0.2].map((lift) => [np[0], np[1] + lift, np[2]]);
          np = cands.find(spotOk) || np;
        }
      } else if (f.repair === 'restore' && it.given.position) {
        const gp = [...it.given.position];
        const cands = [gp, ...[0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.8, 1.2].map((lift) => [gp[0], gp[1] + lift, gp[2]])];
        const spot = placementFindSpot(it.type, it.params, gp, it.rotY, it.isDynamic);
        if (spot) cands.push(spot);
        np = cands.find(spotOk) || null;
      }
      if (np) fixes.push({ id: it.id, name: it.name, to: np });
    }
    if (fixes.length) {
      beginHistoryBatch();
      try {
        for (const fx of fixes) {
          opUpdateEntity(fx.id, { transform: { pos: fx.to.map((v) => +v.toFixed(3)) } },
            'Agent 自查修正 ' + fx.name, { rebuild: false, rerender: false });
          const it = ctx.items.find((x) => x.id === fx.id);
          if (it) it.pos = [...fx.to];
        }
      } finally {
        rebuildAll();
        endHistoryBatch(`Agent 自查自动修正 ${fixes.length} 处放置`);
      }
      repaired = fixes.length;
      // 修复后重算静态：修好的不再列（换一条修复注记），没修好的保留原样
      const pen2 = {};
      for (const it of ctx.items) pen2[it.id] = entityPoseBlocked(it.id, it.pos) || 0;
      const reaudit = auditStatic({ ...ctx, penetrations: pen2 });
      const stillBad = reaudit.filter((f) => f.sev === 'error');
      findings = [
        ...reaudit.filter((f) => f.sev !== 'ok'),
        ...findings.filter((f) => f.sev !== 'error' || !f.repair),
        stillBad.length
          ? { sev: 'warn', cat: '静态·修复', item: '自动修复', msg: `尝试自动修正 ${repaired} 处放置，仍有 ${stillBad.length} 处未解决（可手动调整后重跑自查）` }
          : { sev: 'ok', cat: '静态·修复', item: '自动修复', msg: `已自动修正 ${repaired} 处放置（独立历史条目，Ctrl+Z 可撤销）` },
      ];
    }
  }
  // ---- 3. 运动探针 + 理论对照（需要动态体才有意义；理论要在重置前算——报告/碰撞数据活在 runtime） ----
  if (mode !== 'edit') resetSim(true);
  if (doc.entities.some((e) => e.physics.body === 'dynamic' || e.physics.gravitating)) {
    setAgentStage('verifying', '自查：运行探针…');
    const probe = await motionProbe();
    snapshotSeries(probe.series, (probe.entities[0] || {}).name, agentVerifyCtx && agentVerifyCtx.plan.questionType);   // DE-1：探针数据也可导出
    findings.push(...auditMotion(probe));
    const tf = verifyTheory(probe);
    if (tf) findings.push(tf);
    resetSim(true);   // 探针跑完回初始态（在理论提取之后——collisionReports 随重置清空）
  }
  agentVerifyState = { findings, summary: summarize(findings), repaired, at: Date.now() };
  renderAgentVerify();
  setAgentStage('built', `已建场，自查 ${agentVerifyState.summary.ok}✓ ${agentVerifyState.summary.warn}⚠ ${agentVerifyState.summary.error}✗`);
  const s = agentVerifyState.summary;
  toast(s.error ? `自查发现 ${s.error} 处问题（见 Agent 页签）`
    : s.warn ? `自查通过，${s.warn} 处提醒（见 Agent 页签）` : '自查全部通过');
}

// 确定性运动探针：同步步进 needT 秒（照抄 runAndExplain 的题型窗口与预采基准），
// 每 12 步（0.1s）采全体位姿 + 系统动能；解释器主体系列复用 runtime.startRecording。
async function motionProbe() {
  const hasRamp = doc.entities.some((e) => e.type === 'ramp');
  const isAstro = doc.entities.some((e) => e.physics.gravitating);
  const isRotation = doc.kind === 'rotation';
  const isSpring = doc.entities.some((e) => e.type === 'spring');
  const isAtwood = doc.entities.some((e) => e.type === 'pulley');
  const isHinge = doc.entities.some((e) => e.joints && e.joints.some((j) => j.type === 'revolute'));
  const hasGround = doc.entities.some((e) => e.type === 'ground');
  // 单摆（MOD-501）：绳连接+恰好一个动态球（须在 momentum 兜底前判）
  const isPendulum = !hasRamp && !isSpring && !isAtwood && !isHinge && !isAstro
    && doc.entities.some((e) => e.type === 'rope')
    && doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic').length === 1;
  // MOD-502 双摆对照：2 绳 2 球——窗口 5s（≥2 周期）+ 临时开 trails（逐球周期采样依赖）
  const isPendulumCompare = !hasRamp && !isSpring && !isAtwood && !isHinge && !isAstro
    && doc.entities.filter((e) => e.type === 'rope').length === 2
    && doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic').length === 2;
  if (isPendulumCompare && !trailsOn) { setTrails(true); _pcTrailsAuto = true; }
  // MOD-504 竖直圆周：单球+绳+大水平初速——窗口 6s（≥3 圈）
  const _rope0 = doc.entities.find((e) => e.type === 'rope');
  const _ball0 = doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic');
  const _v0h = _ball0.length === 1 && _ball0[0].physics.linvel ? Math.hypot(_ball0[0].physics.linvel[0], _ball0[0].physics.linvel[2]) : 0;
  const isVertCircle = !hasRamp && !isSpring && !isAtwood && !isHinge && !isAstro && _rope0 && _ball0.length === 1 && _v0h * _v0h >= 4.5 * Math.abs(doc.gravity || 9.81);
  // MOD-505 水平圆周：绳系单球+小水平初速+贴地（有 ground）——窗口 7.5s（≥2 周期）
  const isHorizCircle = !hasRamp && !isSpring && !isAtwood && !isHinge && !isAstro && _rope0 && _ball0.length === 1
    && _v0h > 0.3 && _v0h * _v0h < 4.5 * Math.abs(doc.gravity || 9.81) && doc.entities.some((e) => e.type === 'ground');
  // MOD-510 弹开双车：双球+弹簧——窗口 2.5s + 临时开 trails（双球差分测速依赖）
  const isSpringPair = isSpring && !hasRamp && !isAtwood && !isHinge && !isAstro
    && doc.entities.some((e) => e.type === 'spring')
    && doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic').length === 2
    // 耦合双振子(一球带初速驱动)不是弹开双车——排除,窗口/解释各归各(coupled 实锤)
    && doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic')
      .every((e) => !e.physics.linvel || e.physics.linvel.every((v) => Math.abs(v) < 1e-9));
  if (isSpringPair && !trailsOn) { setTrails(true); _pcTrailsAuto = true; }
  // 曲面族（B5）：碗震荡 T≈2s 需 ≥2 周期（6s）；曲面下滑 3.5s 够到坡底+捕获。
  // 须在 isProjectile 前摘走——曲面+单球+地面长得像抛体，会被拿去按滞空算窗口
  const isBowl = !isPendulum && doc.entities.some((e) => e.type === 'bowl');
  const isCurved = !isPendulum && (isBowl || doc.entities.some((e) => e.type === 'curvedRamp'));
  const isProjectile = !hasRamp && !isSpring && !isAtwood && !isHinge && !isAstro && !isPendulum && !isCurved && hasGround
    && doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic').length === 1;
  const isMomentum = !hasRamp && !isAstro && !isRotation && !isSpring && !isAtwood && !isHinge && !isProjectile && !isPendulum && !isCurved;
  let needT = (isHorizCircle ? 7.5 : (isVertCircle ? 6 : (isSpringPair ? 2.5 : (isProjectile ? 2.5 : (isHinge ? 5.5 : (isAtwood ? 1.6 : (isSpring ? 6.5 : (isAstro ? 11 : (isRotation ? 3.5 : (isMomentum ? 2.0 : (isPendulumCompare ? 5 : (isPendulum ? 5 : (isBowl ? 6 : (isCurved ? 3.5 : 4))))))))))))));
  if (isProjectile) {
    // AG-568：抛体固定 2.5s 窗口在低重力/长滞空误判（月面斜抛滞空 6.25s → 理论对照假阳 44.4%）。
    // 窗口按真实滞空动态给：t=(vy0+√(vy0²+2g·h0))/g 再留 35% 采样余量，上限 14s
    const g = Math.max(0.3, Math.abs(doc.gravity) || 9.81);
    const pb = doc.entities.find((e) => e.type === 'sphere' && e.physics.body === 'dynamic');
    const y0 = pb ? Math.max(0.2, pb.transform.pos[1]) : 1;
    const vy0 = pb && pb.physics.linvel ? pb.physics.linvel[1] : 0;
    const tFly = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * y0)) / g;
    needT = Math.min(14, Math.max(2.5, tFly * 1.35 + 0.4));
  }
  const ball = doc.entities.find((e) => (e.type === 'sphere' || e.type === 'celestial') && e.physics.body === 'dynamic')
    || doc.entities.find((e) => e.physics.body === 'dynamic');
  if (isRotation) rotationWithDrift();
  if (isAstro) { astroWithDrift(); if (!trailsOn) setTrails(true); }
  if (isMomentum) {
    const en0 = runtime.energyTotals();
    if (!momentumBase || momentumBase.epoch !== runtime.epoch) {
      momentumBase = { epoch: runtime.epoch, KE: en0.ke, E: en0.ke + en0.pe };
    }
  }
  if (ball) runtime.startRecording(ball.id);
  play();
  const entities = [];
  for (const [id] of runtime.binds) {
    const e = getEntity(doc, id);
    if (!e || (e.physics.body !== 'dynamic' && !e.physics.gravitating)) continue;
    entities.push({
      id, name: e.name,
      isDynamic: e.physics.body === 'dynamic',
      gravitating: !!e.physics.gravitating,
      locked: !!e.locked,
      v0: e.physics.linvel ? Math.hypot(e.physics.linvel[0], e.physics.linvel[1], e.physics.linvel[2]) : 0,
    });
  }
  const samples = [];
  const ke = [];
  const every = 12;
  const total = Math.ceil(needT * 120);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isTest = typeof navigator !== 'undefined' && navigator.webdriver;
  for (let s = 1; s <= total; s++) {
    runtime.stepOnce();
    if (!isTest && s % 4 === 0) {   // 分块让帧（AG-V2）：探针运动肉眼可见（webdriver 走同步路径不interleave）
      setAgentStage('verifying', `自查：探针运行 t=${runtime.simT.toFixed(1)}/${needT}s`);
      await sleep(8);
    }
    if (s % every === 0) {
      const states = {};
      for (const it of entities) {
        const t = runtime.telemetry(it.id);   // 全字段遥测（telemetryInto 的 out 有形状契约，直接用分配版）
        if (t) states[it.id] = { p: [...t.pos], v: [...t.vel] };
      }
      samples.push({ t: runtime.simT, states });
      ke.push(runtime.energyTotals().ke);
    }
  }
  const series = runtime.stopRecording();
  const flags = { isAstro, isRotation, isHinge, isAtwood };
  return { samples, ke, entities, sceneFlags: { hasGround }, series, flags };
}

function verifyTheory({ series, flags }) {
  if (!series || series.length < 5) return null;
  const r = explainRun(agentVerifyCtx.plan, doc, series, runtime.collisionReports,
    flags.isAstro ? astroWithDrift() : null,
    flags.isRotation ? rotationWithDrift() : null,
    flags.isAtwood ? atwoodInfo() : null, runtime.trails);   // MOD-502：双摆对照走全体轨迹通道
  if (!r) return null;
  if (!r.supported) {
    return { sev: 'ok', cat: '理论对照', item: '题型', msg: `${r.reason || '该题型暂无确定性解释器'}（已做运动健全性检查）` };
  }
  if (r.pass === false) {
    // 「测不出偏差」（errPct=null，如球被挡没走完测量段）≠「与理论不符」——前者提醒后者定罪
    if (r.errPct == null) {
      return { sev: 'warn', cat: '理论对照', item: agentVerifyCtx.plan.questionType,
        msg: '无法完成理论对照（预期运动段未走完或测量量缺失），若演示符合题意可忽略' };
    }
    return { sev: 'error', cat: '理论对照', item: agentVerifyCtx.plan.questionType,
      msg: `与题目理论不符（偏差 ${r.errPct.toFixed(1)}%）——建场可能与题意有出入` };
  }
  if (r.pass === true) {
    return { sev: 'ok', cat: '理论对照', item: agentVerifyCtx.plan.questionType,
      msg: `实测与理论吻合（偏差 ${r.errPct != null ? r.errPct.toFixed(2) + '%' : '—'}）` };
  }
  return { sev: 'ok', cat: '理论对照', item: agentVerifyCtx.plan.questionType,
    msg: (r.summary || '解释器已运行').slice(0, 90) };
}

function renderAgentVerify() {
  const grp = $('verifyGrp'), body = $('verifyBody'), badge = $('verifyBadge');
  if (!grp || !agentVerifyState) return;
  const { findings, summary } = agentVerifyState;
  grp.style.display = 'block';
  // UI-547：三计数分色可扫读（绿=过/琥珀=警/红=错），不再一串同色
  badge.innerHTML = '';
  const cOk = document.createElement('span'); cOk.className = 'c-ok'; cOk.textContent = `${summary.ok}✓`;
  const cWa = document.createElement('span'); cWa.className = 'c-warn'; cWa.textContent = ` ${summary.warn}⚠`;
  const cEr = document.createElement('span'); cEr.className = 'c-err'; cEr.textContent = ` ${summary.error}✗`;
  badge.appendChild(cOk); badge.appendChild(cWa); badge.appendChild(cEr);
  badge.className = 'badge ' + (summary.error ? 'given' : summary.warn ? 'given' : '');
  body.innerHTML = '';
  const notable = findings.filter((f) => f.sev !== 'ok');
  const oks = findings.filter((f) => f.sev === 'ok');
  const row = (f) => {
    const el = document.createElement('div');
    el.className = 'vrow v-' + f.sev;
    const mark = f.sev === 'error' ? '✗' : f.sev === 'warn' ? '⚠' : '✓';
    el.innerHTML = `<span class="mk"></span><span class="cat"></span><span class="tx"></span>`;
    el.querySelector('.mk').textContent = mark;
    el.querySelector('.cat').textContent = `[${f.cat}] `;   // UI-548：分类拆弱化色，正文可扫读
    el.querySelector('.tx').textContent = f.msg;
    return el;
  };
  for (const f of notable) body.appendChild(row(f));
  if (oks.length) {
    body.appendChild(row(oks[0]));
    if (oks.length > 1) {
      const more = document.createElement('div');
      more.className = 'vrow v-ok';
      more.innerHTML = '<span class="mk"></span><span class="tx"></span>';
      more.querySelector('.mk').textContent = '✓';
      more.querySelector('.tx').textContent = `其余 ${oks.length - 1} 项正常`;
      body.appendChild(more);
    }
  }
  if (!findings.length) {
    const el = document.createElement('div');
    el.className = 'hint';
    el.textContent = '本次建场没有可核对的 Agent 实体（全部被拒绝或复用未变）。';
    body.appendChild(el);
  }
}

function resetAgentPanel() {
  stopCamera();
  agentImageDataUrl = null;
  recorder.setPip(null);   // R6-F5：摘录屏角标
  agentImageCanvas = null;
  agentCrop = null;
  agentStandalone = false;   // R6-F5：通道语义随面板复位
  cropMode = false;
  agentPlan = null;
  agentPlanApplied = false;
  agentCorrections = [];
  agentChanges = [];
  agentExplain = null;
  agentVerifyCtx = null;
  agentVerifyState = null;
  $('dropZone').style.display = 'block';
  $('camWrap').style.display = 'none';
  $('imgPrevWrap').style.display = 'none';
  $('parseStatusGrp').style.display = 'none';
  $('parseResultGrp').style.display = 'none';
  $('explainGrp').style.display = 'none';
  $('verifyGrp').style.display = 'none';
  setAgentStage('idle', '未开始：上传/拍照题目图片，或用下方示例数据');
}

// ============ 运行后解释（确定性物理计算，非模型生成） ============
let agentExplain = null;
let explainBusy = false;

async function runAndExplain() {
  if (explainBusy) return;
  if (!agentPlan) { toast('请先完成解析并创建场景实体'); return; }
  const ball = doc.entities.find((e) => (e.type === 'sphere' || e.type === 'celestial') && e.physics.body === 'dynamic')
    || doc.entities.find((e) => e.physics.body === 'dynamic');
  if (!ball) { setParseStatus('解释器需要场景中存在动态实体，请先创建实体', true); return; }
  const hasRamp = doc.entities.some((e) => e.type === 'ramp');
  const isAstro = doc.entities.some((e) => e.physics.gravitating);
  const isRotation = doc.kind === 'rotation';
  const isSpring = doc.entities.some((e) => e.type === 'spring');
  const isAtwood = doc.entities.some((e) => e.type === 'pulley');
  const isHinge = doc.entities.some((e) => e.joints && e.joints.some((j) => j.type === 'revolute'));
  const hasGround = doc.entities.some((e) => e.type === 'ground');
  // 单摆（MOD-501）：绳连接+恰好一个动态球（与 motionProbe 同口径）
  const isPendulum = !hasRamp && !isSpring && !isAtwood && !isHinge && !isAstro
    && doc.entities.some((e) => e.type === 'rope')
    && doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic').length === 1;
  // MOD-502 双摆对照：2 绳 2 球——窗口 5s（≥2 周期）+ 临时开 trails（逐球周期采样依赖）
  const isPendulumCompare = !hasRamp && !isSpring && !isAtwood && !isHinge && !isAstro
    && doc.entities.filter((e) => e.type === 'rope').length === 2
    && doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic').length === 2;
  if (isPendulumCompare && !trailsOn) { setTrails(true); _pcTrailsAuto = true; }
  // MOD-504 竖直圆周：单球+绳+大水平初速——窗口 6s（≥3 圈）
  const _rope0 = doc.entities.find((e) => e.type === 'rope');
  const _ball0 = doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic');
  const _v0h = _ball0.length === 1 && _ball0[0].physics.linvel ? Math.hypot(_ball0[0].physics.linvel[0], _ball0[0].physics.linvel[2]) : 0;
  const isVertCircle = !hasRamp && !isSpring && !isAtwood && !isHinge && !isAstro && _rope0 && _ball0.length === 1 && _v0h * _v0h >= 4.5 * Math.abs(doc.gravity || 9.81);
  // MOD-505 水平圆周：绳系单球+小水平初速+贴地（有 ground）——窗口 7.5s（≥2 周期）
  const isHorizCircle = !hasRamp && !isSpring && !isAtwood && !isHinge && !isAstro && _rope0 && _ball0.length === 1
    && _v0h > 0.3 && _v0h * _v0h < 4.5 * Math.abs(doc.gravity || 9.81) && doc.entities.some((e) => e.type === 'ground');
  // MOD-510 弹开双车：双球+弹簧——窗口 2.5s + 临时开 trails（双球差分测速依赖）
  const isSpringPair = isSpring && !hasRamp && !isAtwood && !isHinge && !isAstro
    && doc.entities.some((e) => e.type === 'spring')
    && doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic').length === 2
    // 耦合双振子(一球带初速驱动)不是弹开双车——排除,窗口/解释各归各(coupled 实锤)
    && doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic')
      .every((e) => !e.physics.linvel || e.physics.linvel.every((v) => Math.abs(v) < 1e-9));
  if (isSpringPair && !trailsOn) { setTrails(true); _pcTrailsAuto = true; }
  // 曲面族（B5）：碗震荡 T≈2s 需 ≥2 周期（6s）；曲面下滑 3.5s 够到坡底+捕获。
  // 须在 isProjectile 前摘走——曲面+单球+地面长得像抛体，会被拿去按滞空算窗口
  const isBowl = !isPendulum && doc.entities.some((e) => e.type === 'bowl');
  const isCurved = !isPendulum && (isBowl || doc.entities.some((e) => e.type === 'curvedRamp'));
  const isProjectile = !hasRamp && !isSpring && !isAtwood && !isHinge && !isAstro && !isPendulum && !isCurved
    && hasGround && doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic').length === 1;
  if (mode !== 'edit') resetSim();

  setAgentStage('explaining', '运行并记录数据中…');
  explainBusy = true;
  const btn = $('btnRunExplain');
  btn.disabled = true;
  setBtnText('btnRunExplain', '运行并记录中…');
  const isMomentum = !hasRamp && !isAstro && !isRotation && !isSpring && !isAtwood && !isHinge && !isProjectile && !isPendulum && !isCurved;
  let needT = (isHorizCircle ? 7.5 : (isVertCircle ? 6 : (isSpringPair ? 2.5 : (isProjectile ? 2.5 : (isHinge ? 5.5 : (isAtwood ? 1.6 : (isSpring ? 6.5 : (isAstro ? 11 : (isRotation ? 3.5 : (isMomentum ? 2.0 : (isPendulumCompare ? 5 : (isPendulum ? 5 : (isBowl ? 6 : (isCurved ? 3.5 : 4))))))))))))));
  if (isProjectile) {
    // AG-568：抛体窗口按真实滞空动态给（同 motionProbe），月面/低重力不再假阳
    const g = Math.max(0.3, Math.abs(doc.gravity) || 9.81);
    const pb = doc.entities.find((e) => e.type === 'sphere' && e.physics.body === 'dynamic');
    const y0 = pb ? Math.max(0.2, pb.transform.pos[1]) : 1;
    const vy0 = pb && pb.physics.linvel ? pb.physics.linvel[1] : 0;
    const tFly = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * y0)) / g;
    needT = Math.min(14, Math.max(2.5, tFly * 1.35 + 0.4));
  }
  const u0 = ball.physics.linvel[0];
  // 运行前预采守恒基准（初始态），避免首采落在演化中
  if (isRotation) rotationWithDrift();
  if (isAstro) { astroWithDrift(); if (!trailsOn) setTrails(true); }   // 周期/偏心率采样依赖轨迹数据
  if (isMomentum) { const en0 = runtime.energyTotals(); if (!momentumBase || momentumBase.epoch !== runtime.epoch) momentumBase = { epoch: runtime.epoch, KE: en0.ke, E: en0.ke + en0.pe }; }
  runtime.startRecording(ball.id);
  play();
  const ramp = doc.entities.find((e) => e.type === 'ramp');
  const exitX = ramp ? ramp.transform.pos[0] + ramp.params.length / 2 : Infinity;
  await new Promise((resolve) => {
    // 终止条件：斜面=球越过底边；对撞=出现使球速改变的碰撞报告（跳过出生触地）；天体=跑满时长；通用=超时
    const iv = setInterval(() => {
      if (mode === 'run' && !paused) {
        const tt = $('taskText');   // UI-47：长运行（天体 11s）给进度
        if (tt) tt.textContent = `运行并记录数据中… t=${runtime.simT.toFixed(1)}s / 目标约 ${needT}s`;
      }
      const tel = runtime.telemetry(ball.id);
      const done = isAstro || isRotation || isHinge || isProjectile
        ? runtime.simT > needT
        : isMomentum
          ? runtime.collisionReports.some((r) => r.postVels && r.postVels[ball.id]
            && Math.abs(r.postVels[ball.id][0] - u0) > 0.05)
          : (!runtime.world || !tel || tel.pos[0] > exitX);
      if (done || runtime.simT > needT || !runtime.world) {
        clearInterval(iv);
        resolve();
      }
    }, 40);
  });
  if (isMomentum) await new Promise((res) => setTimeout(res, 300));   // 缓冲几步让报告速度稳定
  if (mode === 'run' && !paused) pauseToggle();
  const series = runtime.stopRecording();
  snapshotSeries(series, ball.name, agentPlan.questionType);   // DE-1：导出数据源快照（重置不丢）
  agentExplain = explainRun(agentPlan, doc, series, runtime.collisionReports,
    isAstro ? astroWithDrift() : null, isRotation ? rotationWithDrift() : null, isAtwood ? atwoodInfo() : null, runtime.trails);   // MOD-502
  renderExplanation();
  setAgentStage(agentExplain && agentExplain.supported ? 'explained' : 'built', agentExplain && agentExplain.supported ? '解释已生成' : '暂无该题型解释器');
  $('btnCopyExplain').disabled = !(agentExplain && agentExplain.supported);
  btn.disabled = false;
  setBtnText('btnRunExplain', '重新运行解释');
  explainBusy = false;
}

// ============ 数据导出（DE-1）：最近一次运行/自查探针的采样 → CSV ============
// 解释/探针跑完 runtime 都会重置，recording 随之清空——快照成 lastSeries 才能导出。
let lastSeries = null;   // { points:[{t,pos,vel,speed,rotz}], entityName, label, at }
function snapshotSeries(points, entityName, label) {
  if (!points || !points.length) return;
  lastSeries = {
    points: points.map((p) => ({ t: p.t, pos: [...p.pos], vel: [...(p.vel || [0, 0, 0])], speed: p.speed, rotz: p.rotz })),
    entityName: entityName || '动态体', label: label || '', at: Date.now(),
  };
  const be = $('btnExportCSV');
  if (be) { be.disabled = false; be.title = ''; }   // UI-551：有数据才亮
}
function exportSeriesCSV() {
  if (!lastSeries || !lastSeries.points.length) {
    toast('还没有可导出的数据——先「运行并生成解释」或建场自查');
    return;
  }
  const rows = [['t_s', 'x_m', 'y_m', 'z_m', 'vx_mps', 'vy_mps', 'vz_mps', 'speed_mps', 'rotz_rad']];
  for (const p of lastSeries.points) {
    rows.push([p.t, p.pos[0], p.pos[1], p.pos[2], p.vel[0], p.vel[1], p.vel[2], p.speed, p.rotz ?? '']);
  }
  const csv = '\uFEFF' + rows.map((r) => r.map((v) => (typeof v === 'number' ? +v.toFixed(5) : v)).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mechanica-${(doc.name ? doc.name.replace(/[\/:*?"<>|]/g, '') + '-' : '')}${(lastSeries.label || 'data').replace(/[\/:*?"<>|]/g, '')}-`
    + `${new Date(lastSeries.at).toISOString().slice(0, 19).replace(/[T:]/g, '')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`已导出 ${lastSeries.points.length} 行采样 → ${a.download}`, 'ok');   // UI-608：两条同帧顶掉合并为一条
}

function renderAstroExplain(r, box) {
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  const rows = [
    ['轨道半长轴 a', r.theoretical.vcirc != null ? `${a_of(r).toFixed(3)} m` : '--'],
    ['周期（理论 2π√(a³/GM)）', r.theoretical.period != null ? `${r.theoretical.period.toFixed(2)} s` : '--'],
    ['周期（实测）', r.measured.period != null ? `${r.measured.period.toFixed(2)} s` : '采样中'],
    ['偏心率 e', r.measured.ecc != null ? r.measured.ecc.toFixed(4) : '--'],
    ['机械能漂移', r.driftE.toExponential(1)],
    ['角动量漂移', r.driftL.toExponential(1)],
    ['判定', r.pass ? '通过（近圆、闭合、守恒）' : '未通过'],
  ];
  grid.innerHTML = rows.map(([k], i) =>
    `<div class="cell" style="grid-column:1/-1"><span class="k">${k}</span><span class="v ${i >= 4 && i <= 6 ? 'acc' : 'plain'}"></span></div>`
  ).join('');
  [...grid.querySelectorAll('.v')].forEach((el, i) => { el.textContent = rows[i][1]; });
  box.appendChild(grid);
  const p = document.createElement('div');
  p.className = 'hint';
  p.style.marginTop = '8px';
  p.textContent = r.summary;
  box.appendChild(p);
}
function a_of(r) {
  return (r.measured.rmin + r.measured.rmax) / 2;
}

function renderProjectileExplain(r, box) {
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  const rows = [
    ['理论最大高度', r.theoretical.maxHeight.toFixed(3) + ' m'],
    ['实测最大高度', r.measured.maxHeight.toFixed(3) + ' m'],
    ['理论射程', r.theoretical.range.toFixed(3) + ' m'],
    ['实测射程（落点 x）', r.measured.range.toFixed(3) + ' m'],
    ['射程偏差', r.errPct != null ? r.errPct.toFixed(2) + '%' : '--'],
    ['判定', r.pass ? '通过（抛体运动学验证）' : '未通过'],
  ];
  grid.innerHTML = rows.map(function (kv, i) {
    return '<div class="cell" style="grid-column:1/-1"><span class="k">' + kv[0] + '</span><span class="v ' + (i === 5 ? 'acc' : 'plain') + '"></span></div>';
  }).join('');
  const els = Array.from(grid.querySelectorAll('.v'));
  rows.forEach(function (rw, i) { els[i].textContent = rw[1]; });
  box.appendChild(grid);
  const p = document.createElement('div');
  p.className = 'hint';
  p.style.marginTop = '8px';
  p.textContent = r.summary;
  box.appendChild(p);
}

function renderHingeExplain(r, box) {
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  const rows = [
    ['杆长 L', r.theoretical.L + ' m'],
    ['周期（理论 2π√(2L/(3g))）', r.theoretical.period.toFixed(3) + ' s'],
    ['周期（实测·角位置峰间隔）', r.measured.period != null ? r.measured.period.toFixed(3) + ' s' : '采样中'],
    ['周期偏差', r.errPct != null ? r.errPct.toFixed(2) + '%' : '--'],
    ['摆角幅度', r.measured.swing.toFixed(3) + ' rad'],
    ['判定', r.pass ? '通过（复摆公式验证）' : '未通过'],
  ];
  grid.innerHTML = rows.map(([k], i) =>
    '<div class="cell" style="grid-column:1/-1"><span class="k">' + k + '</span><span class="v ' + (i === 5 ? 'acc' : 'plain') + '"></span></div>'
  ).join('');
  const els = [...grid.querySelectorAll('.v')];
  rows.forEach((rw, i) => { els[i].textContent = rw[1]; });
  box.appendChild(grid);
  const p = document.createElement('div');
  p.className = 'hint';
  p.style.marginTop = '8px';
  p.textContent = r.summary;
  box.appendChild(p);
}

function renderAtwoodExplain(r, box) {
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  const rows = [
    ['质量 m1（重侧）/ m2', r.theoretical.m1 + ' / ' + r.theoretical.m2 + ' kg'],
    ['加速度（理论 a=(m1−m2)g/(m1+m2)）', r.theoretical.a.toFixed(3) + ' m/s²'],
    ['加速度（实测·位移拟合）', r.measured.a.toFixed(3) + ' m/s²'],
    ['加速度偏差', r.errPct.toFixed(2) + '%'],
    ['绳张力 T', r.theoretical.tension.toFixed(3) + ' N'],
    ['判定', r.pass ? '通过（连接体动力学验证）' : '未通过'],
  ];
  grid.innerHTML = rows.map(([k], i) =>
    '<div class="cell" style="grid-column:1/-1"><span class="k">' + k + '</span><span class="v ' + (i === 5 ? 'acc' : 'plain') + '"></span></div>'
  ).join('');
  const els = [...grid.querySelectorAll('.v')];
  rows.forEach((rw, i) => { els[i].textContent = rw[1]; });
  box.appendChild(grid);
  const p = document.createElement('div');
  p.className = 'hint';
  p.style.marginTop = '8px';
  p.textContent = r.summary;
  box.appendChild(p);
}

// 单摆解释渲染（MOD-501）：与弹簧同款网格——摆长/周期理论/实测/偏差/摆角/判定
function renderPendulumExplain(r, box) {
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  const rows = [
    ['摆长 L', `${r.theoretical.L.toFixed(3)} m`],
    ['重力 g', `${r.theoretical.g} m/s²`],
    ['周期（理论 2π√(L/g)）', `${r.theoretical.period.toFixed(3)} s`],
    ['周期（实测·峰值间隔法）', r.measured.period != null ? `${r.measured.period.toFixed(3)} s` : '采样中'],
    ['周期偏差', r.errPct != null ? `${r.errPct.toFixed(2)}%` : '--'],
    ['初始摆角', `${r.measured.angle0deg.toFixed(1)}°`],
    ['判定', r.pass ? '通过（T=2π√(L/g) 验证，与质量无关）' : '未通过'],
  ];
  grid.innerHTML = rows.map(([k], i) =>
    `<div class="cell" style="grid-column:1/-1"><span class="k">${k}</span><span class="v ${i === 6 ? 'acc' : 'plain'}"></span></div>`
  ).join('');
  [...grid.querySelectorAll('.v')].forEach((el, i) => { el.textContent = rows[i][1]; });
  box.appendChild(grid);
  const p = document.createElement('div');
  p.className = 'hint';
  p.textContent = r.summary;
  box.appendChild(p);
}

function renderPendulumCompareExplain(r, box) {
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  const rows = [
    ['摆长 L₁ / L₂', `${r.theoretical.L1.toFixed(3)} / ${r.theoretical.L2.toFixed(3)} m`],
    ['周期比（理论 √(L₁/L₂)）', `${r.theoretical.ratio.toFixed(4)}`],
    ['周期比（实测 T₁/T₂）', `${r.measured.ratio.toFixed(4)}`],
    ['各摆实测 T', `${r.measured.T1.toFixed(3)} s / ${r.measured.T2.toFixed(3)} s`],
    ['比值偏差', `${r.errPct.toFixed(2)}%`],
    ['判定', r.pass ? '通过（T∝√L：摆长减半，周期缩到 1/√2）' : '未通过'],
  ];
  grid.innerHTML = rows.map(([k], i) =>
    `<div class="cell" style="grid-column:1/-1"><span class="k">${k}</span><span class="v ${i === 5 ? 'acc' : 'plain'}"></span></div>`
  ).join('');
  [...grid.querySelectorAll('.v')].forEach((el, i) => { el.textContent = rows[i][1]; });
  box.appendChild(grid);
  const p = document.createElement('div');
  p.className = 'hint';
  p.style.marginTop = '8px';
  p.textContent = r.summary;
  box.appendChild(p);
}

function renderBowlExplain(r, box) {
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  const rows = [
    ['球面半径 Rs=(R²+D²)/(2D)', `${r.theoretical.Rs.toFixed(3)} m`],
    ['等效摆长 Rs−r', `${(r.theoretical.Rs - r.theoretical.r).toFixed(3)} m`],
    ['周期（理论 2π√((Rs−r)/g)）', `${r.theoretical.period.toFixed(3)} s`],
    ['周期（实测·峰值间隔法）', r.measured.period != null ? `${r.measured.period.toFixed(3)} s` : '采样中'],
    ['周期偏差', r.errPct != null ? `${r.errPct.toFixed(2)}%` : '--'],
    ['释放幅度', `${r.measured.angle0deg.toFixed(1)}°`],
    ['判定', r.pass ? '通过（曲面版单摆公式验证）' : '未通过'],
  ];
  grid.innerHTML = rows.map(([k], i) =>
    `<div class="cell" style="grid-column:1/-1"><span class="k">${k}</span><span class="v ${i === 6 ? 'acc' : 'plain'}"></span></div>`
  ).join('');
  [...grid.querySelectorAll('.v')].forEach((el, i) => { el.textContent = rows[i][1]; });
  box.appendChild(grid);
  const p = document.createElement('div');
  p.className = 'hint';
  p.style.marginTop = '8px';
  p.textContent = r.summary;
  box.appendChild(p);
}

function renderCurvedExplain(r, box) {
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  const rows = [
    ['有效落差 H', `${r.theoretical.drop.toFixed(3)} m`],
    ['重力 g', `${r.theoretical.g} m/s²`],
    ['坡底速度（理论 √(2gH)）', `${r.theoretical.speed.toFixed(3)} m/s`],
    ['坡底速度（实测·能量口径）', r.measured.speed != null ? `${r.measured.speed.toFixed(3)} m/s` : '未捕获'],
    ['速度偏差', r.errPct != null ? `${r.errPct.toFixed(2)}%` : '--'],
    ['下滑耗时（实测/理论积分）', r.measured.duration != null && r.theoretical.duration != null
      ? `${r.measured.duration.toFixed(3)} / ${r.theoretical.duration.toFixed(3)} s` : '--'],
    ['判定', r.pass ? '通过（末速只由落差决定，与滑道形状无关）' : '未通过'],
  ];
  grid.innerHTML = rows.map(([k], i) =>
    `<div class="cell" style="grid-column:1/-1"><span class="k">${k}</span><span class="v ${i === 6 ? 'acc' : 'plain'}"></span></div>`
  ).join('');
  [...grid.querySelectorAll('.v')].forEach((el, i) => { el.textContent = rows[i][1]; });
  box.appendChild(grid);
  const p = document.createElement('div');
  p.className = 'hint';
  p.style.marginTop = '8px';
  p.textContent = r.summary;
  box.appendChild(p);
}

function renderSpringExplain(r, box) {
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  const rows = [
    ['劲度系数 k', `${r.theoretical.k} N/m`],
    ['振子质量 m', `${r.theoretical.m} kg`],
    ['周期（理论 2π√(m/k)）', `${r.theoretical.period.toFixed(3)} s`],
    ['周期（实测·峰值间隔法）', r.measured.period != null ? `${r.measured.period.toFixed(3)} s` : '采样中'],
    ['周期偏差', r.errPct != null ? `${r.errPct.toFixed(2)}%` : '--'],
    ['初始振幅', `${r.measured.amplitude.toFixed(3)} m`],
    ['判定', r.pass ? '通过（T=2π√(m/k) 验证）' : '未通过'],
  ];
  grid.innerHTML = rows.map(([k], i) =>
    `<div class="cell" style="grid-column:1/-1"><span class="k">${k}</span><span class="v ${i === 6 ? 'acc' : 'plain'}"></span></div>`
  ).join('');
  [...grid.querySelectorAll('.v')].forEach((el, i) => { el.textContent = rows[i][1]; });
  box.appendChild(grid);
  const p = document.createElement('div');
  p.className = 'hint';
  p.style.marginTop = '8px';
  p.textContent = r.summary;
  box.appendChild(p);
}

function renderRotationExplain(r, box) {
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  const rows = [
    ['角速度 ω', `${r.omega0.toFixed(3)} → ${r.omegaNow.toFixed(3)} rad/s`],
    ['转动惯量 I', `${r.I0.toFixed(3)} → ${r.INow.toFixed(3)} kg·m²`],
    ['角动量 L', `${r.L.toFixed(3)} kg·m²/s（漂移 ${r.driftL.toFixed(3)}%）`],
    ['滑块半径 r', `${r.sliderR.toFixed(3)} m`],
    ['ω 理论（L/I(r) 反推）', `${r.theoryOmega.toFixed(3)} rad/s（偏差 ${r.errPct.toFixed(2)}%）`],
    ['外力矩', '0（理想轴承）'],
    ['判定', r.pass ? '通过' : '未通过'],
  ];
  grid.innerHTML = rows.map(([k], i) =>
    `<div class="cell" style="grid-column:1/-1"><span class="k">${k}</span><span class="v ${i === 6 ? 'acc' : 'plain'}"></span></div>`
  ).join('');
  [...grid.querySelectorAll('.v')].forEach((el, i) => { el.textContent = rows[i][1]; });
  box.appendChild(grid);
  const p = document.createElement('div');
  p.className = 'hint';
  p.style.marginTop = '8px';
  p.textContent = r.summary;
  box.appendChild(p);
}

function renderMomentumExplain(r, box) {
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  const rows = [
    ['恢复系数 e', r.e.toFixed(2)],
    ...r.pairs.map((p) => [`${p.name} 碰后速度`, `${p.vMeasured.toFixed(3)} m/s（理论 ${p.vTheory.toFixed(3)}，偏差 ${p.errPct.toFixed(1)}%）`]),
    ['动量 前→后', `${r.momentum.before.toFixed(3)} → ${r.momentum.after.toFixed(3)} N·s（误差 ${r.momentum.errPct.toFixed(2)}%）`],
    ['动能 前→后', `${r.ke.before.toFixed(3)} → ${r.ke.measuredAfter.toFixed(3)} J（理论 ${r.ke.theoryAfter.toFixed(3)} J）`],
  ];
  grid.innerHTML = rows.map(([k, v], i) =>
    `<div class="cell" style="grid-column:1/-1"><span class="k">${k}</span><span class="v ${i === 2 ? 'acc' : 'plain'}"></span></div>`
  ).join('');
  [...grid.querySelectorAll('.v')].forEach((el, i) => { el.textContent = rows[i][1]; });
  box.appendChild(grid);
  const p = document.createElement('div');
  p.className = 'hint';
  p.style.marginTop = '8px';
  p.textContent = r.summary;
  box.appendChild(p);
}

function renderExplanation() {
  const r = agentExplain;
  const grp = $('explainGrp');
  grp.style.display = 'block';
  const badge = $('explainBadge');
  badge.textContent = r.supported ? '确定性计算' : '不支持该题型';
  badge.classList.toggle('given', !!r.supported);   // UI-550：生成后才高亮，初始素徽标
  const box = $('explainBody');
  box.innerHTML = '';
  if (!r.supported) {
    const p = document.createElement('div');
    p.className = 'hint';
    p.style.color = 'var(--danger)';
    p.textContent = r.reason;
    box.appendChild(p);
    const s = document.createElement('div');
    s.className = 'hint';
    s.textContent = r.summary;
    box.appendChild(s);
    return;
  }
// 二维斜碰解释渲染：动量矢量 x/z 分量对照 + 散开速度 + 动能账
function renderMomentum2DExplain(r, box) {
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  grid.innerHTML = [
    '<div class="cell"><span class="k">动量 x 分量</span><span class="v" data-ev="px"></span></div>',
    '<div class="cell"><span class="k">动量 z 分量</span><span class="v" data-ev="pz"></span></div>',
    '<div class="cell"><span class="k">散开速度</span><span class="v" data-ev="v"></span></div>',
    '<div class="cell"><span class="k">动能变化</span><span class="v" data-ev="ke"></span></div>',
  ].join('');
  box.appendChild(grid);
  const set = (k, txt) => { box.querySelector(`[data-ev="${k}"]`).textContent = txt; };
  set('px', `${r.momentum2d.p0x.toFixed(3)} → ${r.momentum2d.p1x.toFixed(3)} N·s（偏差 ${r.momentum2d.errX.toFixed(2)}%）`);
  set('pz', `${r.momentum2d.p0z.toFixed(3)} → ${r.momentum2d.p1z.toFixed(3)} N·s（偏差 ${r.momentum2d.errZ.toFixed(2)}%）`);
  set('v', r.pairs.map((p) => `${p.name} ${p.vMeasured.toFixed(2)} m/s`).join('，'));
  set('ke', `${r.ke.before.toFixed(3)} → ${r.ke.measuredAfter.toFixed(3)} J（损失 ${r.ke.lossPct.toFixed(1)}%——切向分量保持）`);
  const pass = document.createElement('div');
  pass.className = 'hint';
  pass.textContent = r.summary;
  box.appendChild(pass);
}

  if (r.kind === 'momentum-1d') { renderMomentumExplain(r, box); return; }
  if (r.kind === 'momentum-2d') { renderMomentum2DExplain(r, box); return; }
  if (r.kind === 'astro') { renderAstroExplain(r, box); return; }
  if (r.kind === 'rotation') { renderRotationExplain(r, box); return; }
  if (r.kind === 'spring') { renderSpringExplain(r, box); return; }
  if (r.kind === 'spring-pair') {
    const grid2 = document.createElement('div');
    grid2.className = 'ro-grid';
    const rows = [
      ['速率比（理论 m₂/m₁）', `${r.theoretical.ratio.toFixed(3)}`],
      ['速率比（实测 v₁/v₂）', `${r.measured.ratio.toFixed(3)}`],
      ['末速 v₁ / v₂', `${r.measured.v1.toFixed(3)} / ${r.measured.v2.toFixed(3)} m/s`],
      ['总动量（实测）', `${r.measured.pTotal.toFixed(4)} kg·m/s（≈0）`],
      ['能量账（势能→动能）', `${r.theoretical.eP.toFixed(2)} → ${r.measured.eK.toFixed(2)} J`],
      ['判定', r.pass ? '通过（p 守恒+速率反比质量+储能全转动能）' : '未通过'],
    ];
    grid2.innerHTML = rows.map(([k2], i) =>
      `<div class="cell" style="grid-column:1/-1"><span class="k">${k2}</span><span class="v ${i === 5 ? 'acc' : 'plain'}"></span></div>`
    ).join('');
    [...grid2.querySelectorAll('.v')].forEach((el, i) => { el.textContent = rows[i][1]; });
    box.appendChild(grid2);
    const p2 = document.createElement('div');
    p2.className = 'hint';
    p2.style.marginTop = '8px';
    p2.textContent = r.summary;
    box.appendChild(p2);
    return;
  }
  if (r.kind === 'hooke-static') {
    const grid2 = document.createElement('div');
    grid2.className = 'ro-grid';
    const rows2 = [
      ['劲度 k / 砝码 m', `${r.theoretical.k} N/m / ${r.theoretical.m} kg`],
      ['理论伸长（x=mg/k）', `${r.theoretical.x.toFixed(3)} m`],
      ['实测伸长（末段均值）', `${r.measured.x.toFixed(3)} m`],
      ['偏差', `${r.errPct.toFixed(2)}%`],
      ['判定', r.pass ? '通过（k=mg/x——弹簧测力计原理）' : '未通过'],
    ];
    grid2.innerHTML = rows2.map(([k2], i) =>
      `<div class="cell" style="grid-column:1/-1"><span class="k">${k2}</span><span class="v ${i === 4 ? 'acc' : 'plain'}"></span></div>`
    ).join('');
    [...grid2.querySelectorAll('.v')].forEach((el, i) => { el.textContent = rows2[i][1]; });
    box.appendChild(grid2);
    const p2 = document.createElement('div');
    p2.className = 'hint';
    p2.style.marginTop = '8px';
    p2.textContent = r.summary;
    box.appendChild(p2);
    return;
  }
  if (r.kind === 'pendulum') { renderPendulumExplain(r, box); return; }
  if (r.kind === 'pendulum-compare') { renderPendulumCompareExplain(r, box); return; }
  if (r.kind === 'horiz-circle') {
    const gh = document.createElement('div');
    gh.className = 'ro-grid';
    const rows = [
      ['半径 r / 初速 v', `${r.measured.rho.toFixed(3)} m / ${r.measured.v.toFixed(2)} m/s`],
      ['周期（理论 2πr/v）', `${r.theoretical.period.toFixed(3)} s`],
      ['周期（实测·峰值间隔法）', `${r.measured.period.toFixed(3)} s`],
      ['周期偏差', `${r.errPct.toFixed(2)}%`],
      ['向心力 F=mv²/r', `${r.theoretical.F.toFixed(2)} N`],
      ['判定', r.pass ? '通过（绳张力维持向心加速度 a=v²/r）' : '未通过'],
    ];
    gh.innerHTML = rows.map(([k2], i) =>
      `<div class="cell" style="grid-column:1/-1"><span class="k">${k2}</span><span class="v ${i === 5 ? 'acc' : 'plain'}"></span></div>`
    ).join('');
    [...gh.querySelectorAll('.v')].forEach((el, i) => { el.textContent = rows[i][1]; });
    box.appendChild(gh);
    const ph = document.createElement('div');
    ph.className = 'hint';
    ph.style.marginTop = '8px';
    ph.textContent = r.summary;
    box.appendChild(ph);
    return;
  }
  if (r.kind === 'vert-circle') {
    const gv = document.createElement('div');
    gv.className = 'ro-grid';
    const rows = [
      ['顶点临界速度 √(gL)', `${r.theoretical.vTopCrit.toFixed(2)} m/s`],
      ['顶点速度（理论 √(v0²−4gL)）', `${r.theoretical.vTop.toFixed(2)} m/s`],
      ['顶点速度（实测·最高点）', `${r.measured.vTop.toFixed(2)} m/s`],
      ['过顶判定', r.measured.crossedOver ? `已过顶（最高点 ${r.measured.topY.toFixed(2)} m ≈ L）` : `未过顶（最高点 ${r.measured.topY.toFixed(2)} m < L）`],
      ['张力差 T底−T顶=6mg', `${r.theoretical.dT.toFixed(1)} N`],
      ['判定', r.pass ? '通过（临界速度过顶,绳保持张紧）' : '未通过'],
    ];
    gv.innerHTML = rows.map(([k2], i) =>
      `<div class="cell" style="grid-column:1/-1"><span class="k">${k2}</span><span class="v ${i === 5 ? 'acc' : 'plain'}"></span></div>`
    ).join('');
    [...gv.querySelectorAll('.v')].forEach((el, i) => { el.textContent = rows[i][1]; });
    box.appendChild(gv);
    const pv = document.createElement('div');
    pv.className = 'hint';
    pv.style.marginTop = '8px';
    pv.textContent = r.summary;
    box.appendChild(pv);
    return;
  }
  if (r.kind === 'conical') {
    const grid2 = document.createElement('div');
    grid2.className = 'ro-grid';
    const rows = [
      ['摆长 L / 稳态锥角 θ', `${r.theoretical.L.toFixed(3)} m / ${r.theoretical.thetaDeg.toFixed(1)}°`],
      ['周期（理论 2π√(L·cosθ/g)）', `${r.theoretical.period.toFixed(3)} s`],
      ['周期（实测·峰值间隔法）', `${r.measured.period.toFixed(3)} s`],
      ['稳态水平半径（实测）', `${r.measured.rho.toFixed(3)} m`],
      ['向心力 F=mg·tanθ', `${r.theoretical.Fc.toFixed(2)} N`],
      ['判定', r.pass ? '通过（周期由 L·cosθ 决定,比同长单摆快）' : '未通过'],
    ];
    grid2.innerHTML = rows.map(([k2], i) =>
      `<div class="cell" style="grid-column:1/-1"><span class="k">${k2}</span><span class="v ${i === 5 ? 'acc' : 'plain'}"></span></div>`
    ).join('');
    [...grid2.querySelectorAll('.v')].forEach((el, i) => { el.textContent = rows[i][1]; });
    box.appendChild(grid2);
    const p2 = document.createElement('div');
    p2.className = 'hint';
    p2.style.marginTop = '8px';
    p2.textContent = r.summary;
    box.appendChild(p2);
    return;
  }
  if (r.kind === 'bowl-osc') { renderBowlExplain(r, box); return; }
  if (r.kind === 'curved-descent') { renderCurvedExplain(r, box); return; }
  if (r.kind === 'atwood') { renderAtwoodExplain(r, box); return; }
  if (r.kind === 'hinge') { renderHingeExplain(r, box); return; }
  if (r.kind === 'projectile') { renderProjectileExplain(r, box); return; }
  // 观察项对比表（斜面）
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  grid.innerHTML = `
    <div class="cell" style="grid-column:1/-1"><span class="k">观察项</span><span class="v plain" data-ev="obs" style="max-width:170px;text-align:right"></span></div>
    <div class="cell"><span class="k">理论值</span><span class="v" data-ev="theo"></span></div>
    <div class="cell"><span class="k">实测值</span><span class="v" data-ev="meas"></span></div>
    <div class="cell"><span class="k">偏差</span><span class="v" data-ev="err"></span></div>
    <div class="cell"><span class="k">判定</span><span class="v" data-ev="pass"></span></div>
    <div class="cell"><span class="k">机械能初</span><span class="v plain" data-ev="e0"></span></div>
    <div class="cell"><span class="k">机械能末</span><span class="v plain" data-ev="e1"></span></div>
    <div class="cell" style="grid-column:1/-1"><span class="k">守恒漂移</span><span class="v" data-ev="drift"></span></div>
    ${r.reference ? `<div class="cell" style="grid-column:1/-1"><span class="k">${r.reference.label}</span><span class="v plain" data-ev="ref"></span></div>` : ''}`;
  box.appendChild(grid);
  const set = (k, v) => { const el = grid.querySelector(`[data-ev=${k}]`); if (el) el.textContent = v; };
  set('obs', r.observation);
  set('theo', `${r.theoretical.value.toFixed(3)} m/s`);
  set('meas', `${r.measured.value.toFixed(3)} m/s`);
  set('err', `${r.errorPct.toFixed(2)}%`);
  set('pass', r.pass ? '通过(<3%)' : '未通过');
  grid.querySelector('[data-ev=pass]').style.color = r.pass ? 'var(--accent)' : 'var(--danger)';
  set('e0', `${r.energy.initial.toFixed(2)} J`);
  set('e1', `${r.energy.final.toFixed(2)} J`);
  set('drift', `${r.energy.driftPct.toFixed(2)}%`);
  if (r.reference) set('ref', `${r.reference.value.toFixed(3)} m/s (H=${r.reference.h.toFixed(3)} m)`);
  const note = document.createElement('div');
  note.className = 'hint';
  note.textContent = `公式 ${r.theoretical.formula}（h = ${r.theoretical.h.toFixed(3)} m）。${r.energy.note}`;
  box.appendChild(note);
  // 假设核对
  const t = document.createElement('div');
  t.className = 'k';
  t.style.cssText = 'font-size: 11px;color:var(--faint);margin-top:8px';
  t.textContent = '假设核对';
  const ul = document.createElement('ul');
  ul.className = 'plist';
  for (const c of r.checks) {
    const li = document.createElement('li');
    li.textContent = `${c.ok ? '成立' : '不成立'}: ${c.text}`;
    li.style.color = c.ok ? 'var(--dim)' : 'var(--danger)';
    ul.appendChild(li);
  }
  box.append(t, ul);
  // 解释文本
  const p = document.createElement('div');
  p.className = 'hint';
  p.style.marginTop = '8px';
  p.textContent = r.summary;
  box.appendChild(p);
}

// ============ Agent / 自动化只读接口（白名单操作的编程入口，P1 复用） ============
window.MECH = {
  ready: () => appReady,
  doc: () => cloneDoc(doc),
  entities: () => doc.entities.map((e) => ({ id: e.id, type: e.type, name: e.name, source: e.source })),
  selectedId: () => selectedId,
  select: (id, additive) => selectEntity(id, additive),
  addComponent: (type, overrides) => opAddComponent(type, overrides),
  updateEntity: (id, patch, label) => opUpdateEntity(id, patch, label || 'Agent 修改'),
  removeEntity: (id) => opRemoveEntity(id),
  duplicate: (id) => opDuplicate(id),
  play, pause: pauseToggle, step: stepOnce, resetSim,
  saveFile, openLibrary, closeLibrary, exportSceneFile,
  undo, redo,
  loadPreset: (id) => {
    applyDoc(getPreset(id), '载入预置');
    // PL-43 预置相机位：显式 pose 优先，无则自动取景（全实体包围盒平滑飞行）
    const cam = PRESET_CAMERA[id];
    if (cam) viewport.flyToPose(cam.pos, cam.target);
    else viewport.focusScene();
  },
  // 重力用正数表示向下的模长（存 doc.gravity 为负）；越界抛错由调用方处理
  setG: (g) => {
    const v = Number(g);
    if (!Number.isFinite(v) || v <= 0 || v > 1e6) throw new Error('引力常数无效: ' + g);
    doc.G = v;
    rebuildAll();
    commitChange('设引力常数 G=' + v);
    return doc.G;
  },
  setGravity: (g) => {
    const v = Number(g);
    if (!Number.isFinite(v) || v < 0 || v > 50) throw new Error('重力值无效: ' + g);
    doc.gravity = v > 0 ? -v : v;
    rebuildAll();
    commitChange('设重力 ' + v);
    return doc.gravity;
  },
  setAgentMeta: ({ assumptions, corrections, origin }) => {
    doc.meta.source = 'agent';
    if (assumptions) doc.meta.assumptions = assumptions;
    if (corrections) doc.meta.corrections = corrections;
    if (origin) doc.meta.origin = origin;
    autosave();
    commitChange('记录 Agent 解析元数据');
    return cloneDoc(doc.meta);
  },
  state: () => ({ mode, paused, simT: runtime.simT, timeScale: effectiveTimeScale(), timeScaleBase: timeScale, autoBPT, bptEase: +_bptEase.toFixed(2), bptMsLeft: Math.max(0, _bptUntil - performance.now()) | 0, hitMsLeft: Math.max(0, _hitUntil - performance.now()) | 0, count: doc.entities.length, fixedH: FIXED_H }),
  telemetry: (id) => runtime.telemetry(id || selectedId),
  stepOnce: () => stepOnce(),   // 诊断通道（p46 逐步采样用）
  accel: (id) => runtime.accels.get(id || selectedId) || null,
  collisions: () => [...runtime.collisions],
  agentState: () => ({
    hasPlan: !!agentPlan,    fixture: agentPlan ? agentPlan.fixture : null,
    gravity: agentPlan ? agentPlan.gravity : null,
    correctionCount: agentCorrections.length,
    entities: agentPlan ? agentPlan.entities.map((e) => ({ type: e.type, given: { ...e.given } })) : [],
    // Goal 七结构化解析字段清单（逐项可断言）
    questionType: agentPlan ? agentPlan.questionType : null,
    goal: agentPlan ? agentPlan.goal : null,
    environment: agentPlan ? agentPlan.environment : null,
    anchorPoints: agentPlan ? [...agentPlan.anchorPoints] : [],
    keyPoints: agentPlan ? [...agentPlan.keyPoints] : [],
    observations: agentPlan ? [...agentPlan.observations] : [],
    unknowns: agentPlan ? [...agentPlan.unknowns] : [],
    uncertain: agentPlan ? [...agentPlan.uncertain] : [],
    assumptions: agentPlan ? [...agentPlan.assumptions] : [],
    confidence: agentPlan ? agentPlan.confidence : null,
    joint: agentPlan && agentPlan.joint ? { type: agentPlan.joint.type, from: agentPlan.joint.from, to: agentPlan.joint.to } : null,
    attaches: agentPlan ? agentPlan.attaches.map((a) => ({ ...a })) : [],
  }),
  agentOpsState: () => ({ ops: agentOps.map((o) => ({ ...o })) }),
  explainState: () => agentExplain ? JSON.parse(JSON.stringify(agentExplain)) : null,
  consState: () => ({
    live: runtime.systemTotals(),
    reports: runtime.collisionReports.map((r) => ({
      t: r.t, pBefore: r.pBefore, pAfter: r.pAfter, keBefore: r.keBefore, keAfter: r.keAfter, postVels: r.postVels,
    })),
  }),
  vectorState: () => ({ on: vectorsOn, ...viewport.arrowStats() }),
  selectionState: () => ({ ids: [...selectedIds], main: selectedId }),
  impactCount: () => (juice ? juice.state().rings : 0),
  juiceState: () => (juice ? juice.state() : null),
  setShake: (on) => { setShake(!!on); return juice ? juice.shakeOn : null; },
  get __juice() { return juice; },   // 诊断通道（同步直测 juice 机制用）
  // PL-50 帧预算仪表（p34-perf 断言通道）：分段分位摘要 + 原始样本
  perf: (win) => {
    const s = perfMon.summary(win || 600);
    return s ? { ...s, fps: Math.round(_fps), tier: qTier } : null;
  },
  perfSamples: (key, win) => perfMon.samples(key || 'frame', win || 1200),
  setQualityTier: (t) => { qTier = Math.max(0, Math.min(2, t | 0)); viewport.setQualityTier(qTier); return qTier; },
  qualityTier: () => qTier,
  perfHud: (on) => setPerfHud(on == null ? !perfHudOn : !!on),
  // 层1 声音（p33 断言通道）：引擎状态含 voices 最近发声记录（strength/gain/timbre/pan）
  soundState: () => sound.state(),
  juiceState: () => (juice ? juice.state() : null),
  clearSoundLog: () => sound.clearLog(),
  // 离线渲染撞击样本（听感机器代理 + wav 导出，与实时同路径）
  renderSample: (timbre, j) => sound.renderSample(timbre, j),
  // 层2 运行中交互（p33 断言通道）
  grabState: () => {
    const g = runtime.grabState();
    return g ? { ...g, trailN: _ptrTrail.length, trailSpan: _ptrTrail.length > 1 ? +(_ptrTrail[_ptrTrail.length - 1].t - _ptrTrail[0].t).toFixed(3) : 0 } : null;
  },
  lastThrowState: () => lastThrow ? { vPtr: lastThrow.vPtr, vBody: lastThrow.vBody, vFinal: lastThrow.vFinal } : null,
  pinState: () => runtime.pinState(),
  togglePin: (id) => runtime.togglePin(id || selectedId),
  liveAdd: (type, overrides) => {
    // 运行态增量添加（PL-11）：直接建进现有世界，不重建不进 undo；重置即消
    const e = registry.createEntity(type, overrides || {});
    return runtime.addLive(e) ? e.id : null;
  },
  liveRemove: (id) => runtime.removeLive(id || selectedId),
  // 层4/5 断言通道
  setAutoBPT: (on) => { autoBPT = !!on; return autoBPT; },
  hoverState: () => viewport.hoverState(),
  setMuted: (m) => { sound.setMuted(!!m); setSound(!sound.muted); return sound.state().muted; },
  tensionState: () => ({ on: viewport.tensionsOn, ...viewport.tensionStats() }),
  forceState: () => ({ on: forcesOn, decompose: viewport.decompose, normals: runtime.contactNormals.size, ...viewport.forceArrowStats() }),
  springForceState: () => ({
    on: viewport.springsOn, ...viewport.springArrowStats(),
    springs: springForceItems.map((s) => ({ k: s.k, len: +s.len.toFixed(4), stretch: +s.stretch.toFixed(4), F: +s.F.toFixed(4), a: s.aName, b: s.bName })),
  }),
  jointVizState: () => ({ lines: viewport.jointVizCount() }),
  groups: () => doc.entities.map((e) => ({ id: e.id, name: e.name, group: e.group || null })),
  cameraTarget: () => viewport.controls.target.toArray(),
  scaleState: () => ({ step: gridStep, ...viewport.gridInfo(),
    text: document.getElementById('scaleReadout') ? document.getElementById('scaleReadout').textContent : '' }),
  ghostState: () => viewport.ghostState(),
  materialSwatchState: () => ({ ready: !!swatchPreviews, n: swatchPreviews ? Object.keys(swatchPreviews).length : 0 }),
  poseBlocked: (id, pos) => entityPoseBlocked(id || selectedId, pos),   // 挪动防穿模探针
  poseDepth: (id, pos) => entityPoseDepth(id || selectedId, pos),       // 深度口径探针（测试/调试）
  // AG-V 建场自查通道（p37 断言用）
  agentVerifyState: () => agentVerifyState,
  runAgentVerify: () => runAgentVerify(false),
  agentBusy: () => verifyBusy || agentPatchBusy,   // 自查/模型修订进行中（建场分批/探针/回喂），测试屏障用
  agentPatchState: () => ({ rounds: agentPatchRounds, busy: agentPatchBusy, max: AGENT_PATCH_MAX }),   // AG-V3 修订轮次（测试断言用）
  __recDump: () => runtime.recording && runtime.recording.points.map((p) => +p.pos[0].toFixed(4)),   // TEMP-DEBUG
  lastSeriesInfo: () => lastSeries && { n: lastSeries.points.length, entityName: lastSeries.entityName, label: lastSeries.label },   // DE-1
  // 放置防穿模测试探针：已存在实体按其 type/params/位姿重建假想体，返回当前穿透深度（0=不嵌）

  sensorState: (id) => runtime.sensorReadings.get(id) || null,
  __rollDbg: () => runtime._rollLast || null,
  get __vp() { return viewport; },   // 诊断通道（非 Agent 白名单，实时引用）
  get __rt() { return runtime; },    // 诊断通道（非 Agent 白名单，实时引用）
  cameraPos: () => viewport.camera.position.toArray(),
  forceDecompose: (id) => {
    // 斜面场景支持力/摩擦力数值（理论对照：N=mg·cosθ, f=μN 或实测差分）
    const b = runtime.binds.get(id || selectedId);
    const ramp = doc.entities.find((e) => e.type === 'ramp');
    if (!b || !b.body || !ramp) return null;
    const th = Math.atan2(ramp.params.height, ramp.params.length);
    const m = b.body.mass();
    const c = runtime.contactForces.get(id || selectedId) || [0, 0, 0];
    const nrm = [Math.sin(th), Math.cos(th), 0];
    const dot = c[0] * nrm[0] + c[1] * nrm[1] + c[2] * nrm[2];
    const N = [dot * nrm[0], dot * nrm[1], dot * nrm[2]];
    const f = [c[0] - N[0], c[1] - N[1], c[2] - N[2]];
    const gMag = Math.abs(doc.gravity ?? -9.81);            // PAR-1：理论值随场景重力卡
    return {
      thetaDeg: +(th * 180 / Math.PI).toFixed(2),
      N: { measured: +Math.hypot(...N).toFixed(4), theory: +(m * gMag * Math.cos(th)).toFixed(4) },
      f: { measured: +Math.hypot(...f).toFixed(4), muEff: +(Math.hypot(...f) / Math.max(dot, 1e-9)).toFixed(4) },
      gravity: +(m * gMag).toFixed(4),
      contactMag: +Math.hypot(c[0], c[1], c[2]).toFixed(4),
    };
  },
  curveState: () => ({
    on: curvesOn, mode: curveMode, samples: curveData.t.length, entities: [...curveData.byId.keys()],
    energy: curveMode === 'energy' && curveData.ke.length
      ? { ke: +curveData.ke[curveData.ke.length - 1].toFixed(4), pe: +curveData.pe[curveData.pe.length - 1].toFixed(4),
          e0: +curveData.ke[0].toFixed(4) + +curveData.pe[0].toFixed(4),
          e1: +(curveData.ke[curveData.ke.length - 1] + curveData.pe[curveData.pe.length - 1]).toFixed(4) }
      : null,
  }),
  frameState: () => ({ recording: runtime.recFrames, frames: runtime.frames.length, replaying }),
  trailState: () => ({ on: trailsOn, lines: viewport.trailStats(), points: [...runtime.trails.values()].map((a) => a.length) }),
  trailsDump: () => [...runtime.trails.entries()].map(([id, pts]) => ({ id, pts: pts.map((p) => [...p]) })),
  agentImageState: () => ({
    hasImage: !!agentImageDataUrl,
    hasCrop: !!agentCrop,
    crop: agentCrop ? { ...agentCrop } : null,
    src: agentImageCanvas ? { w: agentImageCanvas.width, h: agentImageCanvas.height } : null,
  }),
  loadFixture: (name) => loadFixtureData(name || 'incline'),
  loadParse: (obj) => (obj && typeof obj === 'object') ? adoptParse(obj, '已载入外部解析结果（回归用，走生产 normalizeParse 路径）') : null,
  astroState: () => astroWithDrift(),
  rotationState: () => rotationWithDrift(),
  atwoodState: () => atwoodInfo(),
  dbg: () => ({
    joints: runtime.world ? runtime.world.impulseJoints.len() : -1, epoch: runtime.epoch,
    jointFailures: [...runtime.jointFailures],
    bodies: [...runtime.binds.entries()].map(([id, b]) => ({
      id, name: b.entity.name,
      pos: b.body ? b.body.translation() : null,
      rot: b.body ? b.body.rotation() : null,
      w: b.body ? b.body.angvel() : null,
    })),
  }),
  // 物理自检：UI 同路径构造斜面场景，同步步进 5s，验证真实演化（非预录）
  selftest() {
    const prev = cloneDoc(doc);
    try {
      applyDocQuiet(getPreset('incline'));
      const ball = doc.entities.find((x) => x.type === 'sphere');
      const y0 = runtime.telemetry(ball.id).height;
      for (let i = 0; i < 600; i++) runtime.stepOnce();   // 5s 模拟
      const t = runtime.telemetry(ball.id);
      const dropped = y0 - t.height > 0.5;                // 高度显著下降
      const moved = t.pos[0] > 0.8;                       // 已离开斜坡（坡底在 x=0.8）
      const hadSpeed = t.speed > 0.5;
      const physicsRan = runtime.simT >= 5 - 1e-6;
      return {
        pass: dropped && moved && hadSpeed && physicsRan,
        checks: { dropped, moved, hadSpeed, physicsRan },
        y0, final: t,
      };
    } finally {
      applyDocQuiet(prev);
    }
  },
};

function applyDocQuiet(d) {   // 内部切换，不进历史（自检用）
  doc = d;
  rebuildAll();
}
