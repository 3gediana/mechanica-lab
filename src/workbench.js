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
let selectedId = null;
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
      onSelect: (id) => selectEntity(id),
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
  if (selectedId && !runtime.binds.has(selectedId)) selectedId = null;
  viewport.setSelected(selectedId ? runtime.binds.get(selectedId).mesh : null);
  renderOutline();
  if (rerenderInspector) renderInspector();
  updateSimbarStatic();
}

function applyDoc(doc0, label) {   // 整文档替换（预置/打开/新建/撤销重做）
  doc = doc0;
  rebuildAll();
  commitChange(label);
}

// ============ 选择 ============
function selectEntity(id) {
  selectedId = id;
  viewport.setSelected(id ? runtime.binds.get(id).mesh : null);
  renderOutline();
  renderInspector();
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
  const e = getEntity(doc, id);
  if (!e) return false;
  docRemove(doc, id);
  if (selectedId === id) selectedId = null;
  rebuildAll();
  commitChange('删除 ' + e.name);
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
    e.target.value = '';
  };
  $('btnSave').onclick = saveFile;
  $('btnUndo').onclick = undo;
  $('btnRedo').onclick = redo;

  $('btnModeMove').onclick = () => setGizmoMode('translate');
  $('btnModeRotate').onclick = () => setGizmoMode('rotate');
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

  $('sceneName').onchange = (e) => { doc.name = e.target.value || '未命名场景'; e.target.value = doc.name; autosave(); };

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

function renderOutline() {
  const box = $('outline');
  box.innerHTML = '';
  if (!doc.entities.length) {
    box.innerHTML = '<div class="ol-empty">场景为空</div>';
    return;
  }
  for (const e of doc.entities) {
    const c = registry.getComponent(e.type);
    const row = document.createElement('div');
    row.className = 'ol-row' + (e.id === selectedId ? ' sel' : '');
    row.innerHTML = `<span class="nm"></span><span class="ty"></span><span class="del" title="删除">×</span>`;
    row.querySelector('.nm').textContent = e.name;
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

// ============ 底栏读数 + 检查器实时区 ============
let roTimer = 0;
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
  viewport.render();
  roTimer += rawDt;
  if (roTimer > 0.15) { roTimer = 0; updateReadouts(); }
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
  state: () => ({ mode, paused, simT: runtime.simT, timeScale, count: doc.entities.length, fixedH: FIXED_H }),
  telemetry: (id) => runtime.telemetry(id || selectedId),
  collisions: () => [...runtime.collisions],
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
