from pathlib import Path

p = Path('src/workbench.js')
s = p.read_text(encoding='utf-8')
old = '''function updateAtwoodCons() {
  const a = atwoodInfo();
  if (!a) return;
  const g = 9.81;'''
new = '''function updateAtwoodCons() {
  const a = atwoodInfo();
  if (!a) return;
  const g = 9.81;
  // 位移二次拟合在初始暂态期不稳定（t<1.2s），显示采样中
  if (a.simT < 1.2) {
    ['cwM', 'cwT', 'cwAT', 'cwAM'].forEach((id) => { const el = $(id); if (el) el.textContent = '采样中'; });
    ['cwErr', 'cwTime'].forEach((id) => { const el = $(id); if (el) el.textContent = '--'; });
    return;
  }'''
assert old in s, 'atwood guard'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('atwood guard ok')

p = Path('tools/ui-test/p14.mjs')
s = p.read_text(encoding='utf-8')
old = """  await page.click('#btnPlay');
  await page.waitForTimeout(1200);
  const cw = await page.evaluate"""
new = """  await page.click('#btnPlay');
  await page.waitForTimeout(2200);
  const cw = await page.evaluate"""
assert old in s, 'p14 wait'
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('p14 wait ok')
PYEOF
