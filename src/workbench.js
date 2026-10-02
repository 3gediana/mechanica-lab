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
import { getPreset } from './engine/presets.js';
import { createMaterials } from './materials.js';
import { normalizeParse, planToOverrides } from './engine/parse-schema.js';
import { explainRun } from './engine/explain.js';

const $ = (id) => document.getElementById(id);
const veil = $('veil'), veilStatus = $('veilStatus'), errbar = $('errbar');

function setLoad(msg) { veilStatus.textContent = msg; }
function fail(msg) {
  veilStatus.textContent = '加载失败：' + msg;
  veilStatus.classList.add('err');
  errbar.textContent = msg;
  errbar.style.display = 'block';
  veil.classList.remove('gone');
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
function commitChange(label) {
  history.commit(() => serializeDoc(doc), label);
  autosave();
  refreshHistoryButtons();
}

function rebuildAll(rerenderInspector = true) {
  runtime.rebuild(doc);
  selectedIds = selectedIds.filter((x) => runtime.binds.has(x));
  if (selectedId && !selectedIds.includes(selectedId)) {
    selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
  }
  viewport.setHighlights(selectedIds);
  renderOutline();
  if (rerenderInspector) renderInspector();
  updateSimbarStatic();
}

function applyDoc(doc0, label) {   // 整文档替换（预置/打开/新建/撤销重做）——运行态一并终结
  doc = doc0;
  mode = 'edit';
  paused = false;
  if (viewport) viewport.setGizmoEnabled(true);
  rebuildAll();
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
}

// ============ 实体操作（UI 与 Agent 共用） ============
function opAddComponent(typeId, overrides = {}) {
  const c = registry.getComponent(typeId);
  const n = doc.entities.length;
  const base = { transform: { pos: [((n % 3) - 1) * 0.8, c.spawnY(c.defaults.params) + 0.05, ((Math.floor(n / 3) % 3) - 1) * 0.8] } };
  const e = registry.createEntity(typeId, { ...base, ...overrides });
  addEntity(doc, e);
  rebuildAll();
  commitChange('添加 ' + c.label);
  selectEntity(e.id);
  return e.id;
}
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
  for (const tid of targets) {
    const e = getEntity(doc, tid);
    if (!e) continue;
    docRemove(doc, tid);
    names.push(e.name);
  }
  if (!names.length) return false;
  selectedIds = selectedIds.filter((x) => getEntity(doc, x));
  if (!getEntity(doc, selectedId)) selectedId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
  rebuildAll();
  commitChange('删除 ' + names.join('、'));
  return true;
}
function opDuplicate(id) {
  const copy = duplicateEntity(doc, id);
  if (!copy) return null;
  rebuildAll();
  commitChange('复制 ' + copy.name);
  selectEntity(copy.id);
  return copy.id;
}

// ============ 模拟控制 ============
function play() {
  if (mode === 'run' && !paused) return;
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
  chip.className = 'chip ' + (mode === 'edit' ? '' : (paused ? 'pause' : 'run'));
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
}
function redo() {
  const next = history.redo(() => serializeDoc(doc));
  if (!next) return;
  doc = next; autosave(); rebuildAll(); refreshHistoryButtons();
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
  $('selPreset').onchange = (e) => {
    if (!e.target.value) return;
    applyDoc(getPreset(e.target.value), '载入预置');
    $('sceneName').value = doc.name;
    if (e.target.value === 'momentum') { setVectors(true); setCons(true); }   // 教学默认开叠加层
    if (e.target.value === 'celestial') { setTrails(true); setCons(true); }
    if (e.target.value === 'spin') { setVectors(true); setTrails(true); setCons(true); }
    e.target.value = '';
  };
  $('btnSave').onclick = saveFile;
  $('btnUndo').onclick = undo;
  $('btnRedo').onclick = redo;

  $('btnModeMove').onclick = () => setGizmoMode('translate');
  $('btnModeRotate').onclick = () => setGizmoMode('rotate');
  $('btnBoxSel').onclick = () => {
    if (mode !== 'edit') { toast('框选仅编辑态可用'); return; }
    const on = !viewport.boxSelectMode;
    viewport.setBoxSelect(on);
    $('btnBoxSel').classList.toggle('hot', on);
  };
  $('btnSnap').onclick = () => {
    const on = !$('btnSnap').classList.contains('hot');
    $('btnSnap').classList.toggle('hot', on);
    viewport.setSnap(on);
  };
  $('btnViewReset').onclick = () => viewport.resetView();
  $('btnViewTop').onclick = () => viewport.setViewPreset('top');
  $('btnViewFront').onclick = () => viewport.setViewPreset('front');
  $('btnViewSide').onclick = () => viewport.setViewPreset('side');
  $('btnFocus').onclick = () => viewport.focus(selectedId ? runtime.binds.get(selectedId).mesh : null);

  $('btnPlay').onclick = play;
  $('btnPause').onclick = pauseToggle;
  $('btnStep').onclick = stepOnce;
  $('btnReset').onclick = resetSim;
  $('selSpeed').onchange = (e) => { timeScale = parseFloat(e.target.value); };
  $('btnVectors').onclick = () => setVectors(!vectorsOn);
  $('btnTrails').onclick = () => setTrails(!trailsOn);
  $('btnCons').onclick = () => setCons(!consOn);

  $('sceneName').onchange = (e) => { doc.name = e.target.value || '未命名场景'; e.target.value = doc.name; autosave(); };

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

  renderCatalog();
  refreshHistoryButtons();
}

function setGizmoMode(m) {
  if (mode === 'run') return;
  viewport.setGizmoMode(m);
  $('btnModeMove').classList.toggle('hot', m === 'translate');
  $('btnModeRotate').classList.toggle('hot', m === 'rotate');
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
  if (e.code === 'Space') { e.preventDefault(); mode === 'run' ? pauseToggle() : play(); }
  else if (e.code === 'KeyW') setGizmoMode('translate');
  else if (e.code === 'KeyE') setGizmoMode('rotate');
  else if (e.code === 'KeyF') viewport.focus(selectedId ? runtime.binds.get(selectedId).mesh : null);
  else if (e.code === 'KeyR') resetSim();
  else if (e.code === 'Delete' || e.code === 'Backspace') { if (selectedId) opRemoveEntity(selectedId); }
}

// ============ 左侧目录 / 大纲 ============
function renderCatalog() {
  const box = $('catalogList');
  box.innerHTML = '';
  for (const cat of registry.catalog()) {
    const h = document.createElement('div');
    h.className = 'cat-head';
    h.textContent = cat.label;
    box.appendChild(h);
    for (const c of cat.items) {
      const row = document.createElement('div');
      row.className = 'comp-item';
      row.innerHTML = `<span class="nm"></span><span class="plus">+</span>`;
      row.querySelector('.nm').textContent = c.label;
      row.title = c.desc;
      row.onclick = () => opAddComponent(c.id);
      box.appendChild(row);
    }
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
  for (const e of doc.entities) {
    const c = registry.getComponent(e.type);
    const row = document.createElement('div');
    row.dataset.id = e.id;
    row.className = 'ol-row' + (selectedIds.includes(e.id) ? ' sel' : '');
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
    row.onclick = () => selectEntity(e.id);
    row.querySelector('.del').onclick = (ev) => { ev.stopPropagation(); opRemoveEntity(e.id); };
    box.appendChild(row);
  }
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
  box.innerHTML = '';
  const c = registry.getComponent(e.type);
  const dis = mode === 'run';

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
    opUpdateEntity(e.id, { visible: visCb.checked }, visCb.checked ? '显示' : '隐藏', { rebuild: false });
  };
  head.children[2].children[1].textContent = c.label;
  box.appendChild(head);

  // 变换组
  const grpT = grp('变换');
  triRow(grpT, '位置', 'm', e.transform.pos, 0.1, (vals) => patchTransform(e, { pos: vals }, '移动'));
  triRow(grpT, '旋转', '°', e.transform.rot.map((r) => +(r * 180 / Math.PI).toFixed(1)), 1,
    (vals) => patchTransform(e, { rot: vals.map((v) => +(v * Math.PI / 180).toFixed(4)) }, '旋转'));
  box.appendChild(grpT);

  // 参数组（schema 驱动）
  const grpP = grp('参数');
  for (const item of c.schema) {
    if (item.kind === 'rampAngle') continue;    // 斜坡倾角放最后展示当前值
    numRow(grpP, item.label, item.unit || '', e.params[item.key], item.step,
      (v) => { e.params[item.key] = v; patchParams(e, '调参数', false); }, { min: item.min, max: item.max, schema: item });
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

  numRow(grpPh, '质量', 'kg', e.physics.mass, 0.1, (v) => { e.physics.mass = v; patchPhysics(e, '改质量'); }, { min: 0.01, max: 10000 });
  numRow(grpPh, '摩擦系数', '', e.physics.friction, 0.05, (v) => { e.physics.friction = v; patchPhysics(e, '改摩擦'); }, { min: 0, max: 2 });
  numRow(grpPh, '弹性系数', '', e.physics.restitution, 0.05, (v) => { e.physics.restitution = v; patchPhysics(e, '改弹性'); }, { min: 0, max: 1 });
  if (e.physics.body === 'dynamic') {
    triRow(grpPh, '初速度', 'm/s', e.physics.linvel, 0.1, (vals) => { e.physics.linvel = vals; patchPhysics(e, '改初速度'); });
    triRow(grpPh, '初角速度', 'rad/s', e.physics.angvel, 0.1, (vals) => { e.physics.angvel = vals; patchPhysics(e, '改初角速度'); });
    numRow(grpPh, '重力缩放', 'x', e.physics.gravityScale, 0.1, (v) => { e.physics.gravityScale = v; patchPhysics(e, '改重力缩放'); }, { min: 0, max: 5 });
    numRow(grpPh, '线性阻尼', '', e.physics.linDamping, 0.01, (v) => { e.physics.linDamping = v; patchPhysics(e, '改阻尼'); }, { min: 0, max: 10 });
  }
  box.appendChild(grpPh);

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
    <div class="cell"><span class="k">最近碰撞</span><span class="v plain" data-lv="coll">--</span></div>
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
      if (!Number.isFinite(v)) { input.value = +Number(value).toFixed(3); return; }
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
let trailsOn = false;
let consOn = false;

function setVectors(on) {
  vectorsOn = on;
  viewport.setVelocityArrows(on);
  $('btnVectors').classList.toggle('hot', on);
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

function updateRotationCons() {
  const r = rotationInfo();
  if (!r) return;
  if (!rotationBase || rotationBase.epoch !== runtime.epoch) rotationBase = { epoch: runtime.epoch, L: r.Lz, KE: r.KE };
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

function updateEnergyBar(rate) {
  const pct = Math.max(0, Math.min(rate, 1.5)) * 100 / 1.5;   // 条量程 0-150%，66.7% 刻度=100%
  $('ebFill').style.width = pct + '%';
  $('ebFill').style.background = rate > 1.02 ? 'var(--text)' : 'var(--accent)';
  $('ebPct').textContent = (rate * 100).toFixed(1) + '%';
}

function updateConsbar() {
  if (!consOn) return;
  const astro = doc.entities.some((e) => e.physics.gravitating);
  const rotation = !astro && doc.kind === 'rotation';
  $('consMomentum').style.display = astro || rotation ? 'none' : 'grid';
  $('consAstro').style.display = astro ? 'grid' : 'none';
  $('consRotation').style.display = rotation ? 'grid' : 'none';
  if (astro) { updateAstroCons(); return; }
  if (rotation) { updateRotationCons(); return; }
  const live = runtime.systemTotals();
  if (!momentumBase || momentumBase.epoch !== runtime.epoch) momentumBase = { epoch: runtime.epoch, KE: live.ke };
  updateEnergyBar(live.ke / Math.max(momentumBase.KE, 1e-12));
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
  updateEnergyBar(a.E / astroBase.E);   // E 为负，比值仍为正 = 能量保持率
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
        set('vel', `[${t.vel.map((x) => x.toFixed(2)).join(', ')}]`);
        const col = runtime.lastCollisionFor(e.id);
        set('coll', col ? `t=${col.t.toFixed(2)}s` : '无');
      } else {
        ['speed', 'height', 'mass', 'momentum', 'keTrans', 'vel', 'coll'].forEach((k) => set(k, '--'));
      }
    }
  }
}

// ============ 主循环 ============
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  if (!appReady) return;
  const rawDt = Math.min(clock.getDelta(), 0.05);
  if (mode === 'run' && !paused) runtime.advance(rawDt * timeScale);
  if (vectorsOn) {
    // 编辑态显示初速度，运行/暂停显示当前速度（遥测即当前世界态）
    const items = [];
    for (const e of doc.entities) {
      if (e.physics.body !== 'dynamic' || e.visible === false) continue;
      const t = runtime.telemetry(e.id);
      if (t) items.push({ pos: t.pos, vel: t.vel });
    }
    viewport.updateVelocityArrows(items);
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
  viewport.render();
  viewport.tickImpacts(performance.now());
  roTimer += rawDt;
  if (roTimer > 0.15) { roTimer = 0; updateReadouts(); updateConsbar(); }
}

// ============ Agent 题目解析面板 ============
// 链路：上传/预览 → POST /api/parse-question（key 在服务端）→ normalizeParse 校验 →
// 用户查看/修正（全部可编辑，修改记录进 doc.meta.corrections）→ 确认后经 window.MECH 白名单建实体。
let agentImageDataUrl = null;
let agentPlan = null;
let agentCorrections = [];

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
  box: [['mass', '质量', 'kg', 1, [0.01, 10000]]],
  cylinder: [
    ['mass', '质量', 'kg', 1, [0.01, 10000]],
    ['radius', '半径', 'm', 0.12, [0.01, 2]],
  ],
  ground: [],
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
  $('dropZone').onclick = () => fileInput.click();
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
  $('btnFixtureParse').onclick = () => loadFixtureParse();
  $('btnApplyParse').onclick = () => applyAgentPlan();
  $('btnClearParse').onclick = () => { resetAgentPanel(); };
  $('btnRunExplain').onclick = () => runAndExplain();
  bindCropEvents();
}

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
  $('btnParse').disabled = busy;
}

async function parseQuestion() {
  if (!agentImageDataUrl) { setParseStatus('请先上传或拍照题目图片', true); return; }
  const send = croppedCanvas();
  const dataUrl = send ? send.toDataURL('image/jpeg', 0.85) : agentImageDataUrl;
  const tag = agentCrop ? `（仅选区 ${send.width}x${send.height}）` : '';
  setParseStatus(`正在解析${tag}（step-5-preview 视觉模型）…`, false, true);
  try {
    const resp = await fetch('/api/parse-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    const out = await resp.json();
    if (!out.ok) { setParseStatus('解析失败：' + out.error + '（可重试，或用下方示例数据）', true); return; }
    const n = normalizeParse(out.parse);
    if (!n.ok) { setParseStatus('解析结果无效：' + n.errors.join('; '), true); return; }
    agentPlan = n.plan;
    agentCorrections = [];
    renderParseResult(n.errors);
    setParseStatus('解析完成。请检查/修正下方各项后再创建实体');
  } catch (e) {
    setParseStatus('解析请求失败（网络或服务不可用）。可重试，或用下方示例数据', true);
  }
}

async function loadFixtureParse() { loadFixtureData('incline'); }

async function loadFixtureData(name) {
  try {
    const resp = await fetch(`./tools/fixtures/parse-${name}.json`);
    const raw = await resp.json();
    const n = normalizeParse(raw);
    if (!n.ok) { setParseStatus('示例数据无效：' + n.errors.join('; '), true); return null; }
    agentPlan = n.plan;
    agentCorrections = [];
    renderParseResult(n.errors);
    setParseStatus(`已载入本地示例解析数据「${n.plan.questionType}」（fixture，非真实模型输出）`);
    return n.plan;
  } catch (e) {
    setParseStatus('示例数据读取失败', true);
    return null;
  }
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
      const defVal = (e.type === 'sphere' && key === 'friction' && pairFriction != null) ? pairFriction : def;
      const val = given[key] !== undefined ? given[key] : defVal;
      inp.value = val;
      const src = document.createElement('span');
      src.className = 'badge' + (given[key] !== undefined ? ' given' : '');
      src.textContent = given[key] !== undefined ? '题给' : '默认';
      inp.onchange = () => {
        const v = Number(inp.value);
        if (!Number.isFinite(v) || v < range[0] || v > range[1]) { inp.value = val; return; }
        recordCorrection(`entities[${i}].${key}`, val, v);
        plan.entities[i].given[key] = v;
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

  // 观察 / 未知 / 假设
  const lists = $('parseLists');
  lists.innerHTML = '';
  appendList(lists, '要求观察', plan.observations);
  appendList(lists, '未知量', plan.unknowns);
  appendList(lists, '假设', plan.assumptions);
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
  if (!agentPlan.gravityDefault) M.setGravity(agentPlan.gravity);
  if (agentPlan.G != null) M.setG(agentPlan.G);
  if (doc.entities.some((e) => e.physics.gravitating) && !trailsOn) setTrails(true);   // 天体场景轨道线是观察必需
  const overrides = planToOverrides(agentPlan);
  const created = [];
  for (const o of overrides) created.push(M.addComponent(o.type, o));
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
      at: new Date().toISOString(),
    },
  });
  toast(`已按解析创建 ${created.length} 个实体${agentPlan.fixture ? '（示例数据）' : ''}`);
  // 建场成功即开放"运行并生成解释"（解释体在运行后填充）
  $('explainGrp').style.display = 'block';
  selectTab('inspector');
}

function resetAgentPanel() {
  stopCamera();
  agentImageDataUrl = null;
  agentImageCanvas = null;
  agentCrop = null;
  cropMode = false;
  agentPlan = null;
  agentCorrections = [];
  agentExplain = null;
  $('dropZone').style.display = 'block';
  $('camWrap').style.display = 'none';
  $('imgPrevWrap').style.display = 'none';
  $('parseStatusGrp').style.display = 'none';
  $('parseResultGrp').style.display = 'none';
  $('explainGrp').style.display = 'none';
}

// ============ 运行后解释（确定性物理计算，非模型生成） ============
let agentExplain = null;
let explainBusy = false;

async function runAndExplain() {
  if (explainBusy) return;
  if (!agentPlan) { toast('请先完成解析并创建场景实体'); return; }
  const ball = doc.entities.find((e) => (e.type === 'sphere' || e.type === 'celestial') && e.physics.body === 'dynamic');
  if (!ball) { setParseStatus('解释器需要场景中存在动态小球/天体，请先创建实体', true); return; }
  const hasRamp = doc.entities.some((e) => e.type === 'ramp');
  const isAstro = doc.entities.some((e) => e.physics.gravitating);
  if (mode !== 'edit') resetSim();

  explainBusy = true;
  const btn = $('btnRunExplain');
  btn.disabled = true;
  btn.textContent = '运行并记录中…';
  runtime.startRecording(ball.id);
  play();
  const ramp = doc.entities.find((e) => e.type === 'ramp');
  const exitX = ramp ? ramp.transform.pos[0] + ramp.params.length / 2 : Infinity;
  const isMomentum = !hasRamp && !isAstro;
  const needT = isAstro ? 11 : 4;              // 天体需跑满两圈（两个方位角跳变才可测周期，T≈5s）
  const u0 = ball.physics.linvel[0];
  await new Promise((resolve) => {
    // 终止条件：斜面=球越过底边；对撞=出现使球速改变的碰撞报告（跳过出生触地）；天体=跑满时长；通用=超时
    const iv = setInterval(() => {
      const tel = runtime.telemetry(ball.id);
      const done = isAstro
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
  agentExplain = explainRun(agentPlan, doc, series, runtime.collisionReports, isAstro ? astroWithDrift() : null);
  renderExplanation();
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
  if (r.kind === 'momentum-1d') { renderMomentumExplain(r, box); return; }
  if (r.kind === 'astro') { renderAstroExplain(r, box); return; }
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
  select: (id) => selectEntity(id),
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
  collisions: () => [...runtime.collisions],
  agentState: () => ({
    hasPlan: !!agentPlan,
    fixture: agentPlan ? agentPlan.fixture : null,
    gravity: agentPlan ? agentPlan.gravity : null,
    correctionCount: agentCorrections.length,
    entities: agentPlan ? agentPlan.entities.map((e) => ({ type: e.type, given: { ...e.given } })) : [],
  }),
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
  trailState: () => ({ on: trailsOn, lines: viewport.trailStats(), points: [...runtime.trails.values()].map((a) => a.length) }),
  trailsDump: () => [...runtime.trails.entries()].map(([id, pts]) => ({ id, pts: pts.map((p) => [...p]) })),
  agentImageState: () => ({
    hasImage: !!agentImageDataUrl,
    hasCrop: !!agentCrop,
    crop: agentCrop ? { ...agentCrop } : null,
    src: agentImageCanvas ? { w: agentImageCanvas.width, h: agentImageCanvas.height } : null,
  }),
  loadFixture: (name) => loadFixtureData(name || 'incline'),
  astroState: () => astroWithDrift(),
  rotationState: () => {
    const r = rotationInfo();
    if (!r) return null;
    if (!rotationBase || rotationBase.epoch !== runtime.epoch) rotationBase = { epoch: runtime.epoch, L: r.Lz };
    return {
      omega: r.omega, I: r.I, L: r.Lz, KE: r.KE, sliderR: r.sliderR, torque: r.torque,
      driftL: Math.abs(r.Lz - rotationBase.L) / Math.max(Math.abs(rotationBase.L), 1e-12) * 100,
      simT: runtime.simT,
    };
  },
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
