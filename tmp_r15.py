from pathlib import Path

# ===== viewport: ghost follow =====
p = Path('src/engine/viewport.js')
s = p.read_text(encoding='utf-8')
old = '  setGhostFactory(fn) { this._ghostFactory = fn; }'
new = '''  setGhostFactory(fn) { this._ghostFactory = fn; }

  // ghost 跟随鼠标：指针在网格平面（y=ghostY）上的投射位置
  setGhostFollow(on) {
    this._ghostFollow = on;
  }

  _updateGhostFollow(clientX, clientY) {
    if (!this._ghostFollow || !this._ghost) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const denom = this.raycaster.ray.direction.y;
    const t = denom !== 0 ? -this.raycaster.ray.origin.y / denom : -1;
    if (t > 0) {
      const pt = this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, t);
      this._ghost.position.set(pt.x, this._ghost.position.y, pt.z);
    }
  }'''
assert old in s, 'ghost follow fn'
s = s.replace(old, new, 1)

old = '''    window.addEventListener('pointermove', (e) => {
      if (this.boxSelectMode && this._boxSel) {'''
new = '''    window.addEventListener('pointermove', (e) => {
      if (this._ghostFollow && this._ghost) this._updateGhostFollow(e.clientX, e.clientY);
      if (this.boxSelectMode && this._boxSel) {'''
assert old in s, 'pointermove anchor'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('viewport ghost follow ok')

# ===== workbench: ghost factory/follow 注入 + tick 张力驱动 =====
p = Path('src/workbench.js')
s = p.read_text(encoding='utf-8')
old = '    viewport.setBindLookup((id) => runtime.binds.get(id));'
new = '''    viewport.setBindLookup((id) => runtime.binds.get(id));
    viewport.setGhostFactory((c) => {
      try { return c.buildGeometry(c.defaults.params); } catch (e) { return null; }
    });
    viewport.setGhostFollow(true);'''
assert old in s, 'factory inject'
s = s.replace(old, new, 1)

old = '''    viewport.updateForceArrows(items);
  }'''
new = '''    viewport.updateForceArrows(items);
    // 绳张力箭头：T = m·|a − g_vec|（轻绳端点物体受力 = 重力 + 张力，加速度差分反推）
    if (viewport.tensionsOn) {
      const tItems = [];
      for (const e of doc.entities) {
        if (e.type !== 'rope' || !Array.isArray(e.attach) || e.attach.length !== 2) continue;
        const ba = runtime.binds.get(e.attach[0]), bb = runtime.binds.get(e.attach[1]);
        if (!ba || !bb || !ba.mesh || !bb.mesh) continue;
        const tel = runtime.telemetry(e.attach[0]);
        const acc = runtime.accels.get(e.attach[0]);
        const T = tel && acc ? tel.mass * Math.hypot(acc[0], acc[1] + 9.81, acc[2]) : 0;
        tItems.push({ aPos: ba.mesh.position.toArray(), bPos: bb.mesh.position.toArray(), tA: T, tB: T });
      }
      viewport.updateTensionArrows(tItems);
    }
  }'''
assert old in s, 'tick tension'
s = s.replace(old, new, 1)

# setForces 开关联动张力显示（张力只在受力开时显示）
old = '''function setForces(on) {
  forcesOn = on;
  viewport.setForceArrows(on, viewport.decompose);
  $('btnForces').classList.toggle('hot', on);
  $('btnDecompose').disabled = !on;
}'''
new = '''function setForces(on) {
  forcesOn = on;
  viewport.setForceArrows(on, viewport.decompose);
  $('btnForces').classList.toggle('hot', on);
  $('btnDecompose').disabled = !on;
  if (!on) viewport.setTensionArrows(false);
}'''
assert old in s, 'setForces'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('workbench ok')
PYEOF
