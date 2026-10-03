from pathlib import Path
p = Path('src/workbench.js')
s = p.read_text(encoding='utf-8')

old = "  if (r.kind === 'hinge') { renderHingeExplain(r, box); return; }"
new = """  if (r.kind === 'hinge') { renderHingeExplain(r, box); return; }
  if (r.kind === 'projectile') { renderProjectileExplain(r, box); return; }"""
assert old in s, 'dispatch'
s = s.replace(old, new, 1)

old = 'function renderHingeExplain(r, box) {'
new = '''function renderProjectileExplain(r, box) {
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

function renderHingeExplain(r, box) {'''
assert old in s, 'render fn'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('render projectile ok')
PYEOF
