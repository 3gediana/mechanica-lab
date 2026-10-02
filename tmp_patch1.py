from pathlib import Path
p = Path('src/workbench.js')
s = p.read_text(encoding='utf-8')

# B 吸附循环函数
old = 'function setGizmoMode(m) {'
new = '''// ============ 吸附类型（gizmo 释放时修正位置） ============
let snapMode = 'grid';   // off | grid | endpoint | surface | center
const SNAP_SEQ = ['off', 'grid', 'endpoint', 'surface', 'center'];
const SNAP_LABEL = { off: '吸附:关', grid: '吸附:网格', endpoint: '吸附:端点', surface: '吸附:表面', center: '吸附:中心' };

function cycleSnap() {
  snapMode = SNAP_SEQ[(SNAP_SEQ.indexOf(snapMode) + 1) % SNAP_SEQ.length];
  viewport.setSnap(snapMode === 'grid');
  const btn = $('btnSnap');
  btn.classList.toggle('hot', snapMode !== 'off');
  btn.textContent = SNAP_LABEL[snapMode];
  if (selectedId) {
    const bind = runtime.binds.get(selectedId);
    if (bind) applySnapToMesh(bind.mesh);
  }
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

function setGizmoMode(m) {'''
assert old in s, 'snap funcs'
s = s.replace(old, new, 1)

# btnSnap 循环
old = "  $('btnSnap').onclick = () => {\n    const on = !viewport.boxSelectMode;\n    viewport.setBoxSelect(on);\n    $('btnBoxSel').classList.toggle('hot', on);\n  };"
new = "  $('btnSnap').onclick = () => cycleSnap();"
assert old in s, 'btnSnap'
s = s.replace(old, new)

# gizmo commit 前吸附
old = '''      onGizmoCommit: () => {
        const e = getEntity(doc, selectedId);
        if (!e) return;
        viewport.applyGizmoToEntity(e);'''
new = '''      onGizmoCommit: () => {
        const e = getEntity(doc, selectedId);
        if (!e) return;
        const bind = runtime.binds.get(selectedId);
        if (bind) applySnapToMesh(bind.mesh);
        viewport.applyGizmoToEntity(e);'''
assert old in s, 'gizmo commit'
s = s.replace(old, new)

# 初始文案
old = '''  renderCatalog();
  refreshHistoryButtons();
}'''
new = '''  $('btnSnap').textContent = SNAP_LABEL[snapMode];
  renderCatalog();
  refreshHistoryButtons();
}'''
assert old in s, 'init label'
s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
print('snap ok')
