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
import { getPreset, PRESETS } from './engine/presets.js';
import { createMaterials } from './materials.js';
import { normalizeParse, planToOverrides } from './engine/parse-schema.js';
import { explainRun } from './engine/explain.js';
import { renderThumb } from './engine/thumbs.js';

const $ = (id) => document.getElementById(id);
const veil = $('veil'), veilStatus = $('veilStatus'), errbar = $('errbar');

function setLoad(msg) { veilStatus.textContent = msg; }
function fail(msg) {
  veilStatus.textContent = '加载失败：' + msg;
  veilStatus.classList.add('err');
  errbar.textContent = msg;
  errbar.style.display = 'block';
  veil.classList.remove('gone');
  const retry = document.getElementById('btnVeilRetry');   // UI-13
  if (retry) retry.style.display = 'inline-block';
}
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
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
      onBoxSelect: (ids) => {
        selectedIds = ids;
        selectedId = ids.length ? ids[ids.length - 1] : null;
        syncSelectionUI();
        if (ids.length) toast('框选 ' + ids.length + ' 个实体');
      },
      onGizmoCommit: () => {
        const e = getEntity(doc, selectedId);
        if (!e) return;
        // 平移释放时按当前吸附档位归位（endpoint/surface/center；grid 档由 gizmo 拖动内建吸附）
        if (viewport.gizmoMode === 'translate') {
          const bind = runtime.binds.get(selectedId);
          if (bind) applySnapToMesh(bind.mesh);
        }
        viewport.applyGizmoToEntity(e);
        rebuildAll();
        commitChange('移动 ' + e.name);
        renderInspector();
      },
    });
    await viewport.init();

    setLoad('正在加载材质库');
    M = await createMaterials();

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
    rebuildAll();
    bindUI();

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
function autosave() {
  try { localStorage.setItem(AUTOSAVE_KEY, serializeDoc(doc)); } catch { /* 隐私模式等，静默 */ }
}

// ============ 文档变更主通道 ============
let historyBatchDepth = 0;   // Agent 建场批次：中间 commit 跳过入栈，结束时合并压一个终态快照（单 undo 单元）
let rebuildSuspend = 0;      // Agent 建场批内挂起全量重建：N 实体 N 次 Rapier 世界重建 → 批末一次（PER-5）

function commitChange(label) {
  if (historyBatchDepth > 0) { autosave(); return; }
  history.commit(() => serializeDoc(doc), label);
  autosave();
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
  for (const row of $('outline').querySelectorAll('.ol-row')) {
    row.classList.toggle('sel', selectedIds.includes(row.dataset.id));
  }
  // 成组入口随多选出现/消失（不重建表，避免打断行内改名）
  const box = $('outline');
  let btn = box.querySelector('.ol-group-btn');
  if (selectedIds.length >= 2) {
    if (!btn) {
      btn = document.createElement('div');
      btn.className = 'ol-group-btn';
      btn.style.cssText = 'cursor:pointer;font-size:10px;color:var(--accent);padding:4px 6px;border:1px dashed rgba(217,164,65,.4);margin:3px;border-radius:2px';
      btn.onclick = () => assignGroup([...selectedIds]);
      box.insertBefore(btn, box.firstChild);
    }
    btn.textContent = `⧉ 将 ${selectedIds.length} 个对象成组`;
  } else if (btn) btn.remove();
}

// ============ 实体操作（UI 与 Agent 共用） ============
function opAddComponent(typeId, overrides = {}) {
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

// ============ 模拟控制 ============
function play() {
  if (mode === 'run' && !paused) return;
  if (doc.entities.length === 0) toast('空场景：无实体可演化，从目录添加组件后再运行');
  mode = 'run'; paused = false;
  viewport.setGizmoEnabled(false);
  updateSimbarStatic();
}
function pauseToggle() {
  if (mode !== 'run') return;
  paused = !paused;
  updateSimbarStatic();
}
function stepOnce() {
  if (mode === 'edit') { mode = 'run'; paused = true; viewport.setGizmoEnabled(false); }
  runtime.stepOnce();
  updateSimbarStatic();
}
function resetSim() {
  mode = 'edit'; paused = false;
  viewport.setGizmoEnabled(true);
  rebuildAll();                    // 全量重建 = 回到文档初始态
  updateSimbarStatic();
  toast('已重置到初始态');
}
function updateSimbarStatic() {
  const runDis = mode === 'run';   // UI-24：gizmo/框选是编辑态专属，运行态明确禁用
  $('btnModeMove').disabled = runDis;
  $('btnModeRotate').disabled = runDis;
  $('btnModeScale').disabled = runDis;
  $('btnBoxSel').disabled = runDis;
  $('btnSnap').disabled = runDis;
  $('btnPlay').disabled = mode === 'run' && !paused;
  $('btnPlay').textContent = mode === 'run' && paused ? '继续' : '运行';
  $('btnPlay').classList.toggle('hot', mode === 'run' && paused);
  $('btnPause').disabled = mode !== 'run';
  $('btnPause').textContent = paused ? '继续' : '暂停';
  $('btnPause').classList.toggle('hot', mode === 'run' && paused);
  $('btnStep').disabled = false;
  $('btnReset').disabled = false;
  if (mode !== 'edit' && viewport.boxSelectMode) {
    viewport.setBoxSelect(false);
    $('btnBoxSel').classList.remove('hot');
  }
  const chip = $('modeChip');
  chip.textContent = mode === 'edit' ? '编辑态' : (paused ? '暂停态' : '运行态');
  const dropped = runtime.dropped > 0.1;   // 性能欠载透明化（UI-61）
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
  $('btnUndo').title = history.canUndo() ? '撤销: ' + history.label().undo : '撤销';
  $('btnRedo').title = history.canRedo() ? '重做: ' + history.label().redo : '重做';
}
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
function saveFile() {
  const blob = new Blob([serializeDoc(doc)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (doc.name || '场景') + '.mechanica.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('场景已保存');
}
function openFile(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      applyDoc(deserializeDoc(String(r.result)), '打开场景');
      $('sceneName').value = doc.name;
      toast('场景已载入');
    } catch (e) {
      toast('打开失败: ' + e.message);
    }
  };
  r.readAsText(file);
}

// ============ UI 绑定 ============
function bindUI() {
  $('btnNew').onclick = () => { applyDoc(createEmptyDoc('未命名场景'), '新建'); $('sceneName').value = doc.name; };
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
        og.appendChild(o);
      }
      frag.appendChild(og);
    }
    selPreset.innerHTML = '';
    selPreset.appendChild(frag);
  }
  $('selPreset').onchange = (e) => {
    if (!e.target.value) return;
    applyDoc(getPreset(e.target.value), '载入预置');
    $('sceneName').value = doc.name;
    if (e.target.value === 'momentum') { setVectors(true); setCons(true); }   // 教学默认开叠加层
    if (e.target.value === 'celestial') { setTrails(true); setCons(true); }
    if (e.target.value === 'spin') { setVectors(true); setTrails(true); setCons(true); }
    if (e.target.value === 'classic') { setVectors(true); setTrails(true); setCons(true); }
    if (e.target.value === 'atwood') {
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
      viewport.markDirty();
    });
    bar.addEventListener('change', () => { scrubbing = false; });
  }
  $('btnBoxSel').onclick = () => {
    if (mode !== 'edit') { toast('框选仅编辑态可用'); return; }
    const on = !viewport.boxSelectMode;
    viewport.setBoxSelect(on);
    $('btnBoxSel').classList.toggle('hot', on);
  };
  $('btnSnap').onclick = () => cycleSnap();
  $('btnViewReset').onclick = () => viewport.resetView();
  $('btnViewTop').onclick = () => viewport.setViewPreset('top');
  $('btnViewFront').onclick = () => viewport.setViewPreset('front');
  $('btnViewSide').onclick = () => viewport.setViewPreset('side');
  $('btnFocus').onclick = () => viewport.focusOn(selectedId ? runtime.binds.get(selectedId).mesh : null);

  $('btnPlay').onclick = play;
  $('btnPause').onclick = pauseToggle;
  $('btnStep').onclick = stepOnce;
  $('btnReset').onclick = resetSim;
  $('selSpeed').onchange = (e) => { timeScale = parseFloat(e.target.value); };
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

  $('sceneName').onchange = (e) => { doc.name = e.target.value || '未命名场景'; e.target.value = doc.name; autosave(); };

  $('catalogSearch').oninput = (e) => {
    catalogFilter = e.target.value;
    const pos = e.target.selectionStart;
    renderCatalog();
    const inp = $('catalogSearch');
    inp.value = catalogFilter;
    inp.setSelectionRange(pos, pos);
  };
  $('tabInspector').onclick = () => selectTab('inspector');
  $('tabAgent').onclick = () => selectTab('agent');
  bindAgentPanel();

  // 隐藏文件输入（动态挂载）
  const fi = document.createElement('input');
  fi.type = 'file'; fi.accept = '.json,application/json'; fi.style.display = 'none';
  fi.onchange = () => { if (fi.files[0]) openFile(fi.files[0]); fi.value = ''; };
  document.body.appendChild(fi);
  $('btnOpen').onclick = () => fi.click();

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
  btn.textContent = SNAP_LABEL[snapMode];
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
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (!appReady) return;
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
    else if (k === 's') { e.preventDefault(); saveFile(); }
    else if (k === 'd') { e.preventDefault(); if (selectedId) opDuplicate(selectedId); }
    return;
  }
  if (e.key === '?') {
    e.preventDefault();
    $('helpOverlay').classList.toggle('on');
    return;
  }
  if (e.code === 'Escape') {
    const help = $('helpOverlay');
    if (help.classList.contains('on')) { help.classList.remove('on'); return; }
    if (viewport.boxSelectMode) { viewport.setBoxSelect(false); $('btnBoxSel').classList.remove('hot'); return; }
    viewport.hideGhost();
    return;
  }
  if (e.code === 'Space') { e.preventDefault(); mode === 'run' ? pauseToggle() : play(); }
  else if (e.code === 'KeyW') setGizmoMode('translate');
  else if (e.code === 'KeyE') setGizmoMode('rotate');
  else if (e.code === 'KeyF') viewport.focusOn(selectedId ? runtime.binds.get(selectedId).mesh : null);
  else if (e.code === 'KeyR') resetSim();
  else if (e.code === 'Delete' || e.code === 'Backspace') { if (selectedId) opRemoveEntity(selectedId); }
  else if (e.code.startsWith('Arrow') && selectedId && mode === 'edit') {
    // 方向键微调（FEEL-4）：0.1m 步进，Shift=1m；写回文档走 undo 主通道
    const step = e.shiftKey ? 1 : 0.1;
    const bind = runtime.binds.get(selectedId);
    const ent = getEntity(doc, selectedId);
    if (!bind || !ent) return;
    e.preventDefault();
    const p = bind.mesh.position;
    if (e.code === 'ArrowLeft') p.x -= step;
    else if (e.code === 'ArrowRight') p.x += step;
    else if (e.code === 'ArrowUp') p.z -= step;
    else if (e.code === 'ArrowDown') p.z += step;
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
  // 缩略图：按组件真实几何离屏渲染（失败时隐藏 img，卡片退化为纯文字）
  const url = renderThumb(registry.getComponent(c.id), M);
  const img = row.querySelector('.thumb');
  if (url) img.src = url; else img.style.display = 'none';
  const fav = row.querySelector('.fav');
  fav.textContent = faved ? '已藏' : '收';
  fav.style.color = faved ? 'var(--accent)' : 'var(--faint)';
  fav.onclick = (ev) => { ev.stopPropagation(); toggleFavorite(c.id); };
  row.querySelector('.nm').textContent = c.label;
  // 兼容性提示（Goal 第六章目录条文）：物理行为/放置要求进 tooltip + 两实体类徽标（压缩略图右下角）
  row.title = c.desc + (c.compat ? '\n【兼容性】' + c.compat : '');
  if (c.isLink || c.isMeasure || c.isSensor) {
    const badge = document.createElement('span');
    badge.className = 'need2';
    badge.textContent = c.isSensor ? '绑 1 实体' : '需两实体';
    row.querySelector('.thumbbox').appendChild(badge);
  }
  row.onclick = () => { viewport.hideGhost(); opAddComponent(c.id); };
  // ghost preview（Round 27 修复：此前 showGhost 从未被调用=死代码）。
  // sticky 语义：hover 选中组件后 ghost 持续跟随鼠标（吸附档位联动），
  // 直到点击放置（hideGhost）或 hover 其他组件替换——移出目录行不消失
  row.onmouseenter = () => {
    const comp = registry.getComponent(c.id);
    if (!comp || comp.isLink) return;   // 连接类两实体语义无单体预览；保持现有 ghost 不动
    viewport.showGhost(comp);
    viewport.setGhostFollow(true);
  };
  box.appendChild(row);
}

function renderCatalog() {
  const box = $('catalogList');
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
    const h = document.createElement('div');
    h.className = 'cat-head';
    h.textContent = '搜索结果';
    box.appendChild(h);
    const g = grid();
    let hit = 0;
    for (const cat of registry.catalog()) {
      for (const c of cat.items) {
        if (c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)) {
          addCatalogRow(g, c, favs.includes(c.id));
          hit++;
        }
      }
    }
    if (!hit) {
      const none = document.createElement('div');
      none.className = 'ol-empty';
      none.textContent = '无匹配组件';
      box.appendChild(none);
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
    card.querySelector('.gval').style.cssText = 'display:flex;align-items:center;justify-content:center;height:54px;width:54px;font-family:var(--mono);font-size:15px;color:var(--accent);background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:3px';
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
    sw.style.cssText = 'display:block;height:54px;width:54px;border-radius:3px;border:1px solid var(--line);background:' + (M && M[mo.key] && M[mo.key].color ? '#' + M[mo.key].color.getHexString() : 'rgba(255,255,255,.06)');
    card.querySelector('.nm').textContent = mo.label;
    card.title = `把选中实体的材质换成${mo.label}（未选中实体时无效）`;
    card.onclick = () => {
      const eid = window.MECH.selectionState().main;
      if (!eid) { toast('先选中一个实体，再点材质卡'); return; }
      const e = getEntity(doc, eid);
      if (!e) return;
      e.render.material = mo.key;
      patchRender(e, '换材质为' + mo.label);
      toast(`${e.name} → ${mo.label}`);
    };
    mg.appendChild(card);
  }
}

let outlineEditing = false;   // 大纲行改名中：禁止重建（重建会吞掉正在编辑的 input）

function renderOutline() {
  if (outlineEditing) return;
  const box = $('outline');
  box.innerHTML = '';
  if (!doc.entities.length) {
    box.innerHTML = '<div class="ol-empty">场景为空</div>';
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
  for (const e of ungrouped) renderOutlineRow(box, e);
  for (const [gname, members] of groups) {
    const head = document.createElement('div');
    head.className = 'ol-group';
    head.dataset.group = gname;
    head.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 6px;margin-top:3px;background:rgba(217,164,65,.08);border-left:2px solid rgba(217,164,65,.55);cursor:pointer;font-size:11px;color:var(--accent)';
    const nm = document.createElement('span');
    nm.textContent = `▦ ${gname}`;
    const cnt = document.createElement('span');
    cnt.style.cssText = 'font-size:9px;color:var(--faint)';
    cnt.textContent = `${members.length} 个对象`;
    const ungroupBtn = document.createElement('span');
    ungroupBtn.textContent = '解组';
    ungroupBtn.style.cssText = 'margin-left:auto;font-size:9px;color:var(--faint);cursor:pointer;text-decoration:underline dotted';
    ungroupBtn.onclick = (ev) => { ev.stopPropagation(); ungroupMembers(members.map((m) => m.id)); };
    head.append(nm, cnt, ungroupBtn);
    head.onclick = () => {           // 点组头 = 整组选中
      selectedIds = members.map((m) => m.id);
      selectedId = selectedIds[selectedIds.length - 1];
      renderOutline();
      renderInspector();
    };
    box.appendChild(head);
    for (const e of members) renderOutlineRow(box, e, true);
  }
}

function renderOutlineRow(box, e, inGroup = false) {
    const c = registry.getComponent(e.type);
    const row = document.createElement('div');
    row.dataset.id = e.id;
    row.className = 'ol-row' + (selectedIds.includes(e.id) ? ' sel' : '');
    if (inGroup) row.style.borderLeft = '2px solid rgba(217,164,65,.25)';
    row.innerHTML = `<span class="nm"></span><span class="ty"></span><span class="lock" title="锁定（防误选/防拖动）"></span><span class="del" title="删除">×</span>`;
    const nm = row.querySelector('.nm');
    nm.textContent = e.name;
    nm.ondblclick = () => {
      if (mode === 'run') { toast('运行态不可重命名，请先重置'); return; }
      outlineEditing = true;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = e.name;
      input.style.cssText = 'flex:1;min-width:0;background:rgba(255,255,255,.05);border:1px solid rgba(217,164,65,.5);color:var(--text);font-size:11px;padding:1px 4px;border-radius:2px';
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
    lock.style.cssText = 'cursor:pointer;font-size:9px;color:' + (e.locked ? 'var(--accent)' : 'var(--faint)');
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
      const cb = document.createElement('span');
      cb.className = 'cons-badge';
      cb.title = `约束关系 ${nCons} 条（含被连接）`;
      cb.textContent = '⌁' + nCons;
      cb.style.cssText = 'font-size:9px;color:var(--accent);margin-left:2px';
      row.querySelector('.ty').after(cb);
    }
    row.onclick = () => selectEntity(e.id);
    row.querySelector('.del').onclick = (ev) => { ev.stopPropagation(); opRemoveEntity(e.id); };
    // 选中对象定位：⌖ 把相机 target/距离平滑移向该实体（组内成员与链接实体同样可用）
    const focusBtn = document.createElement('span');
    focusBtn.className = 'focus-btn';
    focusBtn.textContent = '⌖';
    focusBtn.title = '在视口中定位（相机聚焦）';
    focusBtn.style.cssText = 'cursor:pointer;font-size:10px;color:var(--faint);margin-right:2px';
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
  const box = $('inspBody'), empty = $('inspEmpty');
  const e = selectedId ? getEntity(doc, selectedId) : null;
  if (!e) {
    box.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  box.style.display = 'block';
  // 面板重建保持滚动位置（UI-75）：参数多的实体在长面板里调参不该跳回顶部
  const rightPane = $('right');
  const keepScroll = rightPane.scrollTop;
  box.innerHTML = '';
  const c = registry.getComponent(e.type);
  const dis = mode === 'run';

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
      row.style.cssText = 'display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);font-size:12px';
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
      row.style.cssText = 'display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);font-size:12px';
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
    <div class="frow"><label>类型</label><span style="font-size:12px;color:var(--text)"></span>
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
  triRow(grpT, '位置', 'm', e.transform.pos, 0.1, (vals) => patchTransform(e, { pos: vals }, '移动'));
  triRow(grpT, '旋转', '°', e.transform.rot.map((r) => +(r * 180 / Math.PI).toFixed(1)), 1,
    (vals) => patchTransform(e, { rot: vals.map((v) => +(v * Math.PI / 180).toFixed(4)) }, '旋转'));
  // 视觉缩放（缩放 gizmo 写 transform.scale）：只改显示网格，物理参数不变——必须让用户看得见这条边界
  const vs = e.transform.scale || [1, 1, 1];
  const vscaled = Math.abs(vs[0] - 1) > 1e-6 || Math.abs(vs[1] - 1) > 1e-6 || Math.abs(vs[2] - 1) > 1e-6;
  const vsRow = document.createElement('div');
  vsRow.className = 'frow';
  vsRow.innerHTML = `<label>视觉缩放</label><span class="v" style="font-family:var(--mono);font-size:11px;color:var(--dim)">×${vs[0]} · 仅视觉</span>`;
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
      row.querySelector('.ro-inline').style.cssText = 'flex:1;text-align:right;font-family:var(--mono);font-size:12px;color:var(--accent)';
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
    const fly = document.createElement('button');
    fly.textContent = '✈ 飞到观察点';
    fly.style.cssText = 'width:100%;padding:6px;cursor:pointer';
    fly.onclick = () => viewport.flyToPose(e.transform.pos, e.params.target || [0, 0.5, 0]);
    grpV.appendChild(fly);
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
      row.innerHTML = `<label>${jlabel}</label><span style="flex:1;font-size:11px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><button class="danger" style="flex:0 0 auto;appearance:none;background:none;border:1px solid var(--line);border-radius:2px;color:var(--dim);font-size:10px;padding:2px 8px;cursor:pointer">删除</button>`;
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
  mrow.innerHTML = `<label>材质</label><select data-k="mat"></select>`;
  const msel = mrow.querySelector('select');
  for (const o of registry.MATERIAL_OPTIONS) {
    const op = document.createElement('option');
    op.value = o.key; op.textContent = o.label;
    if (e.render.material === o.key) op.selected = true;
    msel.appendChild(op);
  }
  msel.disabled = dis;
  msel.onchange = () => { e.render.material = msel.value; patchRender(e, '换材质'); };
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
  hint.textContent = '数值由固定步长物理演化实时读出，单位: m/s、m、kg、kg·m/s、J';
  grpR.appendChild(hint);
  box.appendChild(grpR);

  // 操作
  const grpA = grp('操作');
  const br = document.createElement('div');
  br.className = 'btnrow';
  br.innerHTML = `<button data-a="dup">复制</button><button data-a="del" class="danger">删除</button>`;
  br.querySelector('[data-a=dup]').onclick = () => opDuplicate(e.id);
  br.querySelector('[data-a=del]').onclick = () => opRemoveEntity(e.id);
  grpA.appendChild(br);
  box.appendChild(grpA);
  rightPane.scrollTop = keepScroll;
}

function patchTransform(e, t, label) { opUpdateEntity(e.id, { transform: t }, label, { rerender: false }); }
function patchParams(e, label, rerender = true) { opUpdateEntity(e.id, { params: e.params }, label, { rerender }); }
function patchPhysics(e, label) { opUpdateEntity(e.id, { physics: e.physics }, label, { rerender: false }); }
function patchRender(e, label) { opUpdateEntity(e.id, { render: e.render }, label, { rerender: false }); }

function grp(title) {
  const g = document.createElement('div');
  g.className = 'grp';
  const h = document.createElement('div');
  h.className = 'grp-h';
  h.textContent = title;
  g.appendChild(h);
  return g;
}

function numRow(parent, label, unit, value, step, onCommit, { min, max, schema } = {}) {
  const row = document.createElement('div');
  row.className = 'frow';
  row.innerHTML = `<label></label><input type="number"><span class="u"></span>`;
  row.querySelector('label').textContent = label;
  row.querySelector('.u').textContent = unit;
  const input = row.querySelector('input');
  input.value = +Number(value).toFixed(3);
  input.step = step;
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  input.disabled = mode === 'run';
  const err = document.createElement('div');
  err.className = 'errmsg';
  parent.appendChild(row);
  parent.appendChild(err);
  const commit = () => {
    if (schema) {
      const r = registry.validate(schema, input.value);
      if (!r.ok) {
        input.classList.add('bad');
        err.textContent = r.msg;
        err.style.display = 'block';
        setTimeout(() => { input.classList.remove('bad'); err.style.display = 'none'; input.value = +Number(value).toFixed(3); }, 1600);
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
        input.classList.add('bad');
        err.textContent = min !== undefined && max !== undefined ? `允许范围 ${min} ~ ${max}` : '数值无效';
        err.style.display = 'block';
        setTimeout(() => { input.classList.remove('bad'); err.style.display = 'none'; input.value = +Number(value).toFixed(3); }, 1600);
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
  inputs.forEach((inp, i) => {
    inp.value = +Number(values[i]).toFixed(3);
    inp.step = step;
    inp.disabled = mode === 'run';
    inp.onchange = () => {
      const vals = inputs.map((x) => Number(x.value));
      if (vals.some((v) => !Number.isFinite(v))) { inputs.forEach((x, j) => { x.value = +Number(values[j]).toFixed(3); }); return; }
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
  $('cwM').textContent = a.m1 + ' / ' + a.m2 + ' kg';
  $('cwT').textContent = T.toFixed(3) + ' N';
  $('cwAT').textContent = aT.toFixed(3) + ' m/s²';
  $('cwAM').textContent = a.aMeasured.toFixed(3) + ' m/s²';
  $('cwErr').textContent = err.toFixed(2) + '%';
  $('cwErr').style.color = err < 8 ? 'var(--accent)' : 'var(--danger)';
  $('cwTime').textContent = 't=' + a.simT.toFixed(1) + 's';
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
  $('crOmega').textContent = `${r.omega.toFixed(3)} rad/s`;
  $('crI').textContent = `${r.I.toFixed(3)} kg·m²`;
  $('crL').textContent = `${r.Lz.toFixed(3)} kg·m²/s`;
  $('crLdrift').textContent = `${dL.toFixed(3)}%`;
  $('crLdrift').style.color = dL < 1 ? 'var(--accent)' : 'var(--danger)';
  $('crKE').textContent = `${r.KE.toFixed(3)} J`;
  $('crR').textContent = r.sliderR != null ? `${r.sliderR.toFixed(3)} m` : '--';
  $('crTorque').textContent = '0（无外力矩）';
  $('crTime').textContent = `t=${r.simT.toFixed(1)}s`;
}

function updateEnergyBar(rate, keFrac = 1) {
  const pct = Math.max(0, Math.min(rate, 1.5)) * 100 / 1.5;   // 条量程 0-150%，66.7% 刻度=100%
  $('ebFill').style.width = (pct * keFrac) + '%';              // KE 段（琥珀）
  $('ebFillPE').style.width = (pct * (1 - keFrac)) + '%';      // PE 段（蓝，堆叠）
  $('ebFillPE').style.left = (pct * keFrac) + '%';
  $('ebFill').style.background = rate > 1.02 ? 'var(--text)' : 'var(--accent)';
  $('ebPct').textContent = (rate * 100).toFixed(1) + '%';
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
  if (!momentumBase || momentumBase.epoch !== runtime.epoch) momentumBase = { epoch: runtime.epoch, KE: live.ke };
  if (momentumBase.KE < 0.05) {
    // 初始静止场景（KE0≈0）：保持率无意义，隐藏比例条数字
    $('ebFill').style.width = '0%';
    $('ebPct').textContent = '基准≈0';
  } else {
    updateEnergyBar(live.ke / momentumBase.KE);
  }
  $('cbP').textContent = `${live.p[0].toFixed(3)} N·s`;
  $('cbKE').textContent = `${live.ke.toFixed(3)} J`;
  const rep = runtime.collisionReports[runtime.collisionReports.length - 1];
  if (!rep) {
    $('cbT').textContent = '尚无碰撞';
    $('cbPerr').textContent = '--';
    ['cbPb', 'cbPa', 'cbKEb', 'cbKEa'].forEach((id) => { $(id).textContent = '--'; });
    return;
  }
  $('cbT').textContent = `t=${rep.t.toFixed(3)}s`;
  const pB = rep.pBefore[0], pA = rep.pAfter[0];
  const err = Math.abs(pB) > 1e-9 ? Math.abs(pA - pB) / Math.abs(pB) * 100 : 0;
  $('cbPerr').textContent = `${err.toFixed(3)}%`;
  $('cbPerr').style.color = err < 1 ? 'var(--accent)' : 'var(--danger)';
  $('cbPb').textContent = `${pB.toFixed(3)} N·s`;
  $('cbPa').textContent = `${pA.toFixed(3)} N·s`;
  $('cbKEb').textContent = `${rep.keBefore.toFixed(3)} J`;
  $('cbKEa').textContent = `${rep.keAfter.toFixed(3)} J`;
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
  $('caE').textContent = `${a.E.toFixed(3)} J`;
  $('caEdrift').textContent = `${dE.toFixed(3)}%`;
  $('caEdrift').style.color = dE < 2 ? 'var(--accent)' : 'var(--danger)';
  $('caL').textContent = `${a.Lz.toFixed(3)} kg·m²/s`;
  $('caLdrift').textContent = `${dL.toFixed(3)}%`;
  $('caLdrift').style.color = dL < 2 ? 'var(--accent)' : 'var(--danger)';
  $('caEcc').textContent = a.ecc != null ? a.ecc.toFixed(3) : '--';
  $('caT').textContent = a.period != null ? `${a.period.toFixed(2)} s` : '采样中';
  $('caR').textContent = a.rmin != null ? `${a.rmin.toFixed(2)} / ${a.rmax.toFixed(2)} m` : '--';
  $('caTime').textContent = `t=${runtime.simT.toFixed(1)}s`;
}

// ============ 底栏读数 + 检查器实时区 ============
let roTimer = 0;
let _seenReports = 0;
function updateReadouts() {
  $('roT').textContent = runtime.simT.toFixed(3);
  $('roN').textContent = doc.entities.length;
  const e = selectedId ? getEntity(doc, selectedId) : null;
  const roSel = $('roSel');
  if (!e) { roSel.textContent = '未选中'; }
  else {
    const t = runtime.telemetry(e.id);
    roSel.textContent = t
      ? `${e.name}  v=${t.speed.toFixed(2)}m/s  h=${t.height.toFixed(2)}m  |p|=${t.momentum.toFixed(2)}`
      : `${e.name}  仅视觉`;
    const grid = document.getElementById('liveGrid');
    if (grid) {
      const set = (k, v) => { const el = grid.querySelector(`[data-lv=${k}]`); if (el) el.textContent = v; };
      if (t) {
        set('speed', t.speed.toFixed(3));
        set('height', t.height.toFixed(3));
        set('mass', t.mass.toFixed(2));
        set('momentum', t.momentum.toFixed(3));
        set('keTrans', t.keTrans.toFixed(3));
        set('omega', `${Math.hypot(t.angvel[0], t.angvel[1], t.angvel[2]).toFixed(2)} rad/s`);
        set('vel', `[${t.vel.map((x) => x.toFixed(2)).join(', ')}]`);
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
        ['speed', 'height', 'mass', 'momentum', 'keTrans', 'omega', 'vel', 'coll', 'roll'].forEach((k) => set(k, '--'));
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
  drawCurves();
}

function drawCurves() {
  const cv = $('curveCanvas');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const n = curveData.t.length;
  if (n < 2) return;
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
  const trace = (data, color, dash) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = ((curveData.t[i] - t0) / span) * (W - 8) + 4;
      const y = H - 6 - (Math.abs(data[i]) / vmax) * (H - 12);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (curveMode === 'energy') {
    // 能量堆叠对照（Goal 第九章「能量曲线」）：KE 绿 / PE 蓝 / 总 E 金——
    // 光滑场景 E 平线（守恒可视），摩擦/非弹性碰撞场景 E 阶跃衰减
    trace(curveData.ke, '#7dc87d');
    trace(curveData.pe, '#5b8dd9');
    trace(curveData.ke.map((v, i) => v + curveData.pe[i]), '#d9a441');
  } else {
    let i = 0;
    for (const sr of curveData.byId.values()) {
      const c = CURVE_PALETTE[i % CURVE_PALETTE.length];
      trace(sr.speed, c);              // 速率：实线
      trace(sr.height, c, [3, 3]);     // 高度：同色虚线
      i++;
    }
    trace(curveData.ke, '#7dc87d');    // 系统KE：绿实线
  }
  const legendKey = curveMode + ':' + curveData.byId.size;
  if (curveData.legendN !== legendKey) {
    curveData.legendN = legendKey;
    updateCurveLegend();
  }
}

function updateCurveLegend() {
  const el = $('curveLegend');
  if (!el) return;
  el.innerHTML = '';
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
    const sp = document.createElement('span');
    sp.style.color = c;
    sp.textContent = `${sr.name}速率`;
    const hp = document.createElement('span');
    hp.style.color = c;
    hp.textContent = `${sr.name}高度`;
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
  el.textContent = `网格 1 格 = ${gridStep} m　|　视野宽约 ${viewW.toFixed(1)} m ≈ ${cells.toFixed(1)} 格`;
}

// ============ 录制 / 回放 ============
let replaying = false;
let replayIdx = 0;
let scrubbing = false;   // 回放时间轴拖动中：暂停自动推进，逐帧由 oninput 驱动

function toggleFrameRec() {
  if (replaying) { stopReplay(); return; }
  if (runtime.recFrames) {
    runtime.recFrames = false;
    $('btnRec').classList.remove('hot');
    $('btnRec').textContent = '录制';
    $('btnReplay').disabled = runtime.frames.length < 2;
    toast(`已录制 ${runtime.frames.length} 帧`);
  } else {
    if (mode !== 'edit') resetSim();
    runtime.frames = [];
    runtime.recFrames = true;
    $('btnRec').classList.add('hot');
    $('btnRec').textContent = '停止录制';
    play();
    toast('录制中（最长约 30s）');
  }
}

function startReplay() {
  if (replaying) return;
  if (runtime.frames.length < 2) { toast('请先录制'); return; }
  replaying = true;
  replayIdx = 0;
  scrubbing = false;
  mode = 'run';
  paused = false;
  viewport.setGizmoEnabled(false);
  $('btnReplay').classList.add('hot');
  const bar = $('replayBar');
  bar.max = Math.max(1, runtime.frames.length - 1);
  bar.value = 0;
  bar.style.display = 'block';
  updateSimbarStatic();
  toast('回放中（拖动时间轴可逐帧检查，结束后自动恢复编辑态）');
}

function stopReplay() {
  replaying = false;
  scrubbing = false;
  $('replayBar').style.display = 'none';
  mode = 'edit';
  paused = false;
  viewport.setGizmoEnabled(true);
  $('btnReplay').classList.remove('hot');
  $('btnReplay').disabled = false;
  rebuildAll();
  updateSimbarStatic();
}

// ============ 主循环 ============
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  if (!appReady) return;
  const rawDt = Math.min(clock.getDelta(), 0.05);
  if (replaying) {
    if (!scrubbing) replayIdx += Math.max(1, Math.round(rawDt * 60));   // 60 帧/s 回放速率（拖动时逐帧）
    if (replayIdx >= runtime.frames.length) { stopReplay(); }
    else {
      runtime.applyFrame(replayIdx);
      $('replayBar').value = replayIdx;
    }
    viewport.markDirty();
  } else if (mode === 'run' && !paused) {
    runtime.advance(rawDt * timeScale);
    viewport.markDirty();
  }
  viewport.controls.update();     // 阻尼收敛期持续触发 change→脏（render 内不再重复调用）
  viewport.tickFocus();
  viewport.tickPose();
  if (viewport._focusAnim || viewport._poseAnim || viewport.impactCount() > 0) viewport.markDirty();
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
    return;
  }
  if (vectorsOn) {
    // 编辑态显示初速度，运行/暂停显示当前速度（遥测即当前世界态）；
    // per-entity「显示速度向量」关闭的体不画（检查器观察组）
    const items = [];
    for (const e of doc.entities) {
      if (e.physics.body !== 'dynamic' || e.visible === false) continue;
      if (e.params && e.params.showVel === false) continue;
      const t = runtime.telemetry(e.id);
      if (t) items.push({ pos: t.pos, vel: t.vel });
    }
    viewport.updateVelocityArrows(items);
  }
  // 斜坡法线可视化（Goal 六「是否显示法线」per-entity）：坡面中心沿法向青色箭头
  {
    const nitems = [];
    for (const e of doc.entities) {
      if (e.type !== 'ramp' || e.visible === false) continue;
      if (!(e.params && e.params.showNormals)) continue;
      const b = runtime.binds.get(e.id);
      if (!b || !b.mesh) continue;
      const H = e.params.height, L = e.params.length;
      const n = new THREE.Vector3(H, L, 0).normalize().applyQuaternion(b.mesh.quaternion);
      const p = b.mesh.localToWorld(new THREE.Vector3(0, H / 2, 0));
      nitems.push({ pos: [p.x, p.y, p.z], dir: [n.x, n.y, n.z] });
    }
    viewport.updateNormalViz(nitems);
  }
  if (forcesOn) {
    // 通用接触法向：Rapier 接触对收集（任意面：地面/斜坡/墙面/曲轨），运行过才有；
    // 绳/弹簧类无接触对 → 不分解、显示接触合力（张力语义），不再依赖斜面几何特判
    // （wantContactNormals 已前移到主循环脏门槛之前，每帧同步）
    const items = [];
    const gMag = Math.abs(doc.gravity ?? -9.81);            // PAR-1：重力箭头随场景重力卡（月球卡曾画错）
    for (const e of doc.entities) {
      if (e.physics.body !== 'dynamic' || e.visible === false) continue;
      const t = runtime.telemetry(e.id);
      if (!t) continue;
      const contact = runtime.contactForces.get(e.id) || null;
      const gravity = [0, gMag * (e.physics.gravityScale != null ? e.physics.gravityScale : 1) * t.mass, 0];
      const item = { pos: t.pos, contact, gravity, accel: runtime.accels.get(e.id) || [0, 0, 0] };
      const nrm = runtime.contactNormals.get(e.id);
      if (viewport.decompose && contact && nrm) {
        const dot = contact[0] * nrm[0] + contact[1] * nrm[1] + contact[2] * nrm[2];
        const normal = [dot * nrm[0], dot * nrm[1], dot * nrm[2]];         // 支持力 = (F·n̂)n̂
        const friction = [contact[0] - normal[0], contact[1] - normal[1], contact[2] - normal[2]];   // 摩擦类 = F − N
        item.normal = normal;
        item.friction = friction;
        item.contact = null;                                                // 分解模式不显示合力
      }
      items.push(item);
    }
    viewport.updateForceArrows(items);
    // 绳张力箭头：T = m·|a − g_vec|（轻绳端点物体受力 = 重力 + 张力，加速度差分反推）
    if (viewport.tensionsOn) {
      const tItems = [];
      for (const e of doc.entities) {
        if (e.type !== 'rope' || !Array.isArray(e.attach) || e.attach.length !== 2) continue;
        const ba = runtime.binds.get(e.attach[0]), bb = runtime.binds.get(e.attach[1]);
        if (!ba || !bb || !ba.mesh || !bb.mesh) continue;
        const tel = runtime.telemetry(e.attach[0]);
        const acc = runtime.accels.get(e.attach[0]);
        const T = tel && acc ? tel.mass * Math.hypot(acc[0], acc[1] + gMag, acc[2]) : 0;
        tItems.push({ aPos: ba.mesh.position.toArray(), bPos: bb.mesh.position.toArray(), tA: T, tB: T });
      }
      viewport.updateTensionArrows(tItems);
    }
    // 弹簧胡克力箭头（第九章「弹力」独立分列）：F = k·|Δx| 沿轴，拉=指向对方、压=推离；
    // 阻尼力不画（弹力语义=胡克项）；数据同时供 springForceState 数值对照
    if (viewport.springsOn) {
      const sItems = [];
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
        sItems.push({
          aPos: pa.toArray(), bPos: pb.toArray(),
          fA: [F * ux, F * uy, F * uz],
          k, len, stretch, F,
          aName: ba.entity.name, bName: bb.entity.name,
        });
      }
      viewport.updateSpringArrows(sItems);
      springForceItems = sItems;
    }
  }
  // 约束关系可视化：选中实体的 joints 连线（编辑/运行态均显示；多选也画）
  {
    const jItems = [];
    for (const id of selectedIds.length ? selectedIds : (selectedId ? [selectedId] : [])) {
      const e = getEntity(doc, id);
      const b = runtime.binds.get(id);
      if (!e || !b || !b.mesh) continue;
      for (const j of (e.joints || [])) {
        const tb = runtime.binds.get(j.target);
        jItems.push({
          from: b.mesh.position.toArray(),
          to: tb && tb.mesh ? tb.mesh.position.toArray() : b.mesh.position.toArray(),
          ok: !!tb,
        });
      }
    }
    viewport.updateJointViz(jItems);
  }
  if (trailsOn) viewport.updateTrails(runtime.trails);
  const nRep = runtime.collisionReports.length;
  if (nRep < _seenReports) _seenReports = 0;
  if (nRep > _seenReports) {
    for (let i = _seenReports; i < nRep; i++) {
      const r = runtime.collisionReports[i];
      if (r.pos) viewport.spawnImpact(r.pos);
    }
    _seenReports = nRep;
  }
  viewport.render();     // tickFocus/tickPose 已在脏门槛前统一调用（FEEL-96/PER-83：此前双调致动画 2 倍速收敛）
  viewport.tickImpacts(performance.now());
  roTimer += rawDt;
  if (roTimer > 0.15) {
    roTimer = 0;
    updateReadouts();
    updateConsbar();
    if (curvesOn && mode === 'run') sampleCurves();
    updateScaleReadout();
  }
}

// ============ Agent 题目解析面板 ============
// 链路：上传/预览 → POST /api/parse-question（key 在服务端）→ normalizeParse 校验 →
// 用户查看/修正（全部可编辑，修改记录进 doc.meta.corrections）→ 确认后经 window.MECH 白名单建实体。
let agentOps = [];       // Agent 建场操作明细 [{op, target, ok}]
let agentPlanApplied = false;   // 当前 plan 是否已建场（换场景作废依据，AG-46）
let agentImageDataUrl = null;
let agentPlan = null;
let agentCorrections = [];
let agentChanges = [];   // 逐条接受/拒绝：待执行变更清单 [{type,idx,label,detail,skipped}]

const PEDIT = {
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
  $('inspWrap').style.display = insp ? 'block' : 'none';
  $('agentWrap').style.display = insp ? 'none' : 'block';
}

function bindAgentPanel() {
  const fileInput = $('agentFile');
  const dz = $('dropZone');
  dz.onclick = () => fileInput.click();
  // 拖拽上传（UI-3）：教师传题高频路径，drop 与点击同一条 readQuestionImage 链
  dz.addEventListener('dragover', (ev) => { ev.preventDefault(); dz.style.borderColor = 'rgba(217,164,65,.6)'; dz.style.color = 'var(--text)'; });
  dz.addEventListener('dragleave', () => { dz.style.borderColor = ''; dz.style.color = ''; });
  dz.addEventListener('drop', (ev) => {
    ev.preventDefault();
    dz.style.borderColor = ''; dz.style.color = '';
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
  $('btnParseText').onclick = () => parseTextQuestion();
  $('btnFixtureParse').onclick = () => loadFixtureParse();
  $('btnApplyParse').onclick = () => applyAgentPlan();
  $('btnClearParse').onclick = () => { resetAgentPanel(); };
  $('btnRunExplain').onclick = () => runAndExplain();
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
  const STAGES = { idle: '未开始', uploaded: '图片就绪', parsing: '解析中', parsed: '待确认', building: '建场中', built: '已建场', explaining: '运行解释中', explained: '已解释', error: '出错' };
  const el = $('taskStage'), tx = $('taskText');
  if (!el) return;
  el.innerHTML = (STAGES[stage] || stage) + (stage === 'parsing' || stage === 'explaining' ? '<span class="spinner"></span>' : '');
  el.className = 'badge' + (stage === 'explained' ? ' given' : (stage === 'built' ? ' given' : (stage === 'error' ? '' : (stage === 'parsing' ? ' given' : ''))));
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
  agentCrop = null;
  stopCamera();
  $('imgPrev').src = agentImageDataUrl;
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
  el.textContent = msg;
  el.style.color = isErr ? 'var(--danger)' : 'var(--dim)';
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
  agentPlanApplied = false;
  agentCorrections = [];
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

// fetch + 100s 超时（AG-38）：浏览器默认超时远长于服务端 90s，AbortController 收口
async function fetchParse(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 100000);
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

async function parseQuestion() {
  if (parseBusy) return;
  if (!agentImageDataUrl) { setParseStatus('请先上传或拍照题目图片', true); return; }
  const send = croppedCanvas();
  const dataUrl = send ? send.toDataURL('image/jpeg', 0.85) : agentImageDataUrl;
  const tag = agentCrop ? `（仅选区 ${send.width}x${send.height}）` : '';
  setAgentStage('parsing', '正在解析题目…');
  setParseStatus(`正在解析${tag}（step-5-preview 视觉模型）…`, false, true);
  try {
    let out = await (await fetchParse('/api/parse-question', { image: dataUrl })).json();
    if (!out.ok && isRetryableParseError(out.error)) {
      setParseStatus(`首次解析失败（${out.error}），自动重试一次…`, false, true);
      out = await (await fetchParse('/api/parse-question', { image: dataUrl })).json();
    }
    if (!out.ok) { setAgentStage('error', '解析失败'); setParseStatus('解析失败：' + out.error + '（可重试，或用下方示例数据）', true); return; }
    adoptServerParse(out);
  } catch (e) {
    setAgentStage('error', '解析失败');   // AG-93：异常路径也要流转阶段，徽标不得停在「解析中」
    setParseStatus(e && e.name === 'AbortError'
      ? '解析超时（100s），可重试或换一张更清晰的图'
      : '解析请求失败（网络或服务不可用）。可重试，或用下方示例数据', true);
  }
}

// 文字要求通道（混合搭建）：文字 → 真实模型解析 → 与图片通道同一条评审/预览/建场链路
async function parseTextQuestion() {
  if (parseBusy) return;
  const text = $('agentTextReq').value.trim();
  if (!text) { setParseStatus('请先输入题目或搭建要求的文字', true); return; }
  setAgentStage('parsing', '正在解析文字要求…');
  setParseStatus('正在解析文字要求（step-5-preview）…', false, true);
  try {
    let out = await (await fetchParse('/api/parse-text', { text })).json();
    if (!out.ok && isRetryableParseError(out.error)) {
      setParseStatus(`首次解析失败（${out.error}），自动重试一次…`, false, true);
      out = await (await fetchParse('/api/parse-text', { text })).json();
    }
    if (!out.ok) { setAgentStage('error', '解析失败'); setParseStatus('解析失败：' + out.error + '（可重试）', true); return; }
    if (adoptServerParse(out)) {
      $('parseSrcBadge').textContent = 'step-5-preview·文字';
      setParseStatus('文字要求解析完成（真实模型）。请检查/修正/勾选变更后再创建实体');
    }
  } catch (e) {
    setAgentStage('error', '解析失败');   // AG-93：同上
    setParseStatus(e && e.name === 'AbortError'
      ? '解析超时（100s），可重试或精简要求描述'
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
  agentPlanApplied = false;
  agentCorrections = [];
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
          if (ov !== undefined && ov !== v && typeof v !== 'object') diffs.push(`${k} ${ov}→${v}`);
        }
      }
      agentChanges.push({
        type: 'entity', idx, reuseId,
        label: `更新已有 ${o.type}「${e.name || o.type}」`,
        detail: diffs.length ? diffs.slice(0, 4).join('，') : '位置/参数按题给重设',
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
      label: `建立${jn}约束（实体 ${agentPlan.joint.from}→${agentPlan.joint.to}）`,
      detail: '所依赖实体被拒绝时自动跳过', skipped: false,
    });
  }
  let aSeq = 0;
  for (const at of (agentPlan.attaches || [])) {
    agentChanges.push({
      type: 'attach', idx: aSeq++,
      label: `连接${at.type === 'rope' ? '绳' : '弹簧'}（实体 ${at.from}→${at.to}，k=${at.stiffness ?? '—'}）`,
      detail: '所依赖实体被拒绝时自动跳过', skipped: false,
    });
  }
  // 渲染勾选清单
  list.innerHTML = '';
  agentChanges.forEach((c, i) => {
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:flex-start;gap:6px;padding:3px 2px;cursor:pointer;font-size:11px;color:var(--dim)';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !c.skipped;
    cb.onchange = () => { agentChanges[i].skipped = !cb.checked; };
    const txt = document.createElement('span');
    txt.textContent = c.label + (c.detail ? `（${c.detail}）` : '');
    row.append(cb, txt);
    list.appendChild(row);
  });
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
  confCell.querySelector('.v').textContent = (plan.confidence * 100).toFixed(0) + '%';
  if (plan.goal) {
    const g = document.createElement('div');
    g.className = 'k';
    g.style.cssText = 'font-size:10px;color:var(--faint)';
    g.textContent = '目标';
    const gv = document.createElement('div');
    gv.style.cssText = 'font-size:11px;color:var(--dim);margin:2px 0 8px';
    gv.textContent = plan.goal;
    meta.append(g, gv);
  }
  // 重力（可编辑）
  const grow = document.createElement('div');
  grow.className = 'frow';
  grow.innerHTML = `<label style="flex:0 0 auto;font-size:10px;color:var(--dim)">重力</label>
    <input type="number" step="0.1" min="0" max="50" style="flex:1"><span class="u">m/s²</span>
    <span class="badge" style="margin-left:6px"></span>`;
  const gInput = grow.querySelector('input');
  gInput.value = plan.gravity;
  gInput.onchange = () => {
    const v = Number(gInput.value);
    if (!Number.isFinite(v) || v < 0 || v > 50) { gInput.value = plan.gravity; return; }
    recordCorrection('gravity', plan.gravity, v);
    plan.gravity = v;
  };
  grow.querySelector('.badge').textContent = plan.gravityDefault ? '默认' : '题给';
  grow.querySelector('.badge').className = 'badge' + (plan.gravityDefault ? '' : ' given');
  meta.appendChild(grow);
  // 环境条件（Goal 七：环境条件字段，非空才显示）
  if (plan.environment) {
    const erow = document.createElement('div');
    erow.className = 'k';
    erow.style.cssText = 'font-size:10px;color:var(--faint)';
    erow.textContent = '环境条件';
    const ev = document.createElement('div');
    ev.style.cssText = 'font-size:11px;color:var(--dim);margin:2px 0 8px';
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
    ty.style.cssText = 'font-family:var(--mono);font-size:10px;color:var(--dim)';
    ty.textContent = registry.getComponent(e.type).label;
    const conf = document.createElement('span');
    conf.className = 'conf';
    conf.textContent = e.confidence != null ? (e.confidence * 100).toFixed(0) + '%' : '--';
    head.append(nm, ty, conf);
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
      inp.value = val;
      const src = document.createElement('span');
      const isInferred = given[key] !== undefined && inferredKeys.includes(key);
      src.className = 'badge' + (given[key] !== undefined ? ' given' : '');
      src.textContent = isInferred ? '推断' : (given[key] !== undefined ? '题给' : '默认');
      inp.onchange = () => {
        const v = Number(inp.value);
        if (!Number.isFinite(v) || v < range[0] || v > range[1]) { inp.value = val; return; }
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
  d.innerHTML = `<div class="k"></div><div class="v" style="font-family:var(--mono);font-size:12px;color:var(--accent)"></div>`;
  d.querySelector('.k').textContent = k;
  return d;
}

function appendList(parent, title, items) {
  if (!items || !items.length) return;
  const t = document.createElement('div');
  t.className = 'k';
  t.style.cssText = 'font-size:10px;color:var(--faint);margin-top:8px';
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

// 确认建场：全部经 window.MECH 白名单操作（与目录添加/Agent 未来调用同一条路径）
function applyAgentPlan() {
  if (!agentPlan) { toast('没有可用的解析结果'); return; }
  if (mode !== 'edit') { toast('运行态不可建场，请先重置'); return; }
  const M = window.MECH;
  const wasEmpty = doc.entities.length === 0;
  let batchReused = 0, batchCreated = 0;
  beginHistoryBatch();
  rebuildSuspend++;   // 批内 N 次 addComponent 不再各自重建 Rapier 世界，收尾一次（PER-5）
  try {
    applyAgentPlanInner(M, (r, c) => { batchReused = r; batchCreated = c; });
  } finally {
    rebuildSuspend--;
    rebuildAll();
    endHistoryBatch(wasEmpty ? 'Agent 按解析建场' : `Agent 混合建场（更新 ${batchReused}+新增 ${batchCreated}）`);
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
  reportCounts(nReused, nCreated);
  setAgentStage('building', mixed
    ? `混合模式：更新 ${nReused} 个已有实体，新增 ${nCreated} 个，其余对象不动`
    : '按解析计划创建实体…');
  if (mixed) setParseStatus(`混合建场：复用已有同类型实体（保留命名/材质，参数按题给更新）+ 新增 ${nCreated} 个${agentPlan.gravityDefault ? '' : '；重力已按题给调整'}`);
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
    const pa = ea.transform.pos, pb = eb.transform.pos;
    const dist = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
    const params = at.type === 'rope'
      ? { length: at.length ?? +dist.toFixed(3) }
      : { stiffness: at.stiffness ?? 20, restLength: at.restLength ?? +dist.toFixed(3), damping: at.damping ?? 0.5 };
    const id = M.addComponent(at.type, { name: (at.type === 'rope' ? '绳 ' : '弹簧 ') + dist.toFixed(2) + 'm', params, attach: [fromId, toId], source: 'agent' });
    if (id) { created.push(id); agentOps.push({ op: '连接 ' + at.type, target: ea.name + ' 与 ' + eb.name, ok: true }); }
    else agentOps.push({ op: '连接 ' + at.type, target: ea.name + ' 与 ' + eb.name, ok: false });
  }
  toast(`已按解析创建 ${created.length} 个实体${agentPlan.fixture ? '（示例数据）' : ''}`);
  agentPlanApplied = true;
  setAgentStage('built', `已建场 ${created.length} 实体，可运行并生成解释`);
  // 建场成功即开放"运行并生成解释"（解释体在运行后填充）。
  // 不再强制跳检查器页签（UI-48）：操作明细就在本页签，跳走会打断核对；相机自动取景代偿（UI-49）
  $('explainGrp').style.display = 'block';
  viewport.focusScene();
}

function resetAgentPanel() {
  stopCamera();
  agentImageDataUrl = null;
  agentImageCanvas = null;
  agentCrop = null;
  cropMode = false;
  agentPlan = null;
  agentPlanApplied = false;
  agentCorrections = [];
  agentChanges = [];
  agentExplain = null;
  $('dropZone').style.display = 'block';
  $('camWrap').style.display = 'none';
  $('imgPrevWrap').style.display = 'none';
  $('parseStatusGrp').style.display = 'none';
  $('parseResultGrp').style.display = 'none';
  $('explainGrp').style.display = 'none';
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
  const isProjectile = !hasRamp && !isSpring && !isAtwood && !isHinge && !isAstro
    && hasGround && doc.entities.filter((e) => e.type === 'sphere' && e.physics.body === 'dynamic').length === 1;
  if (mode !== 'edit') resetSim();

  setAgentStage('explaining', '运行并记录数据中…');
  explainBusy = true;
  const btn = $('btnRunExplain');
  btn.disabled = true;
  btn.textContent = '运行并记录中…';
  const isMomentum = !hasRamp && !isAstro && !isRotation && !isSpring && !isAtwood && !isHinge && !isProjectile;
  const needT = isProjectile ? 2.5 : (isHinge ? 5.5 : (isAtwood ? 1.6 : (isSpring ? 6.5 : (isAstro ? 11 : (isRotation ? 3.5 : 4)))));
  const u0 = ball.physics.linvel[0];
  // 运行前预采守恒基准（初始态），避免首采落在演化中
  if (isRotation) rotationWithDrift();
  if (isAstro) { astroWithDrift(); if (!trailsOn) setTrails(true); }   // 周期/偏心率采样依赖轨迹数据
  if (isMomentum) { const lv = runtime.systemTotals(); if (!momentumBase || momentumBase.epoch !== runtime.epoch) momentumBase = { epoch: runtime.epoch, KE: lv.ke }; }
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
  agentExplain = explainRun(agentPlan, doc, series, runtime.collisionReports,
    isAstro ? astroWithDrift() : null, isRotation ? rotationWithDrift() : null, isAtwood ? atwoodInfo() : null);
  renderExplanation();
  setAgentStage(agentExplain && agentExplain.supported ? 'explained' : 'built', agentExplain && agentExplain.supported ? '解释已生成' : '暂无该题型解释器');
  $('btnCopyExplain').disabled = !(agentExplain && agentExplain.supported);
  btn.disabled = false;
  btn.textContent = '重新运行解释';
  explainBusy = false;
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
  t.style.cssText = 'font-size:10px;color:var(--faint);margin-top:8px';
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
  undo, redo,
  loadPreset: (id) => applyDoc(getPreset(id), '载入预置'),
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
  state: () => ({ mode, paused, simT: runtime.simT, timeScale, count: doc.entities.length, fixedH: FIXED_H }),
  telemetry: (id) => runtime.telemetry(id || selectedId),
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
  impactCount: () => viewport.impactCount(),
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
  sensorState: (id) => runtime.sensorReadings.get(id) || null,
  __rollDbg: () => runtime._rollLast || null,
  get __vp() { return viewport; },   // 诊断通道（非 Agent 白名单，实时引用）
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
