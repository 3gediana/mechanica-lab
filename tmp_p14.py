from pathlib import Path
p = Path('src/engine/parse-schema.js')
s = p.read_text(encoding='utf-8')
old = """    const pout = [];
    pout.push({
      type: 'sphere', name: e.name || '抛体', source: 'agent',
      params: { radius: r },
      physics: {"""
new = """    const pout = [];
    pout.push({
      type: 'sphere', name: e.name || '抛体', source: 'agent',
      params: { radius: r },
      transform: { pos: e.given.position ?? [0, 0.6, 0], rot: [0, 0, 0] },
      physics: {"""
assert old in s, 'ball pos anchor'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('ball pos ok')
PYEOF
