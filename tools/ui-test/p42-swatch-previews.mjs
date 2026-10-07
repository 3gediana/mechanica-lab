// p42-swatch-previews.mjs — 材质选择器真材质预览（用户反馈「材质选择全是纯色图案」）。
// 断言：①离屏渲染完成（materialSwatchState.ready，n≥8）②目录全部 .mswitch[data-mat] 色块
// 就地替换为 dataURL 材质球（background 含 data:image/png）③全程无 console 错误。
// 零出网。用法：MECH_BASE=http://127.0.0.1:8722 node p42-swatch-previews.mjs
import { chromium } from 'playwright';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8722';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

  // ①离屏材质球渲染完成（启动即生成，不阻塞主流程）
  const st = await page.waitForFunction(() => {
    const s = window.MECH.materialSwatchState();
    return s.ready ? s : null;
  }, null, { timeout: 20000, polling: 250 }).then((h) => h.jsonValue()).catch(() => null);
  check('离屏材质球渲染完成（ready 且 ≥8 个）', !!st && st.n >= 8, JSON.stringify(st));

  // ②目录色块全部就地替换为真材质球（覆盖 renderCatalogEnvMats 同步读缓存 + 异步 refresh 两条路径）
  const dom = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.mswatch[data-mat]')];
    return {
      n: els.length,
      withUrl: els.filter((e) => (e.style.background || '').includes('data:image/png')).length,
      mats: els.map((e) => e.dataset.mat),
      dark: els.filter((e) => (e.style.background || '').includes('rgb(12, 13, 15)')).length,
    };
  });
  check('目录色块全部替换为材质球（n≥8 且全部 dataURL）', dom.n >= 8 && dom.withUrl === dom.n,
    `n=${dom.n} withUrl=${dom.withUrl} mats=${dom.mats.join(',')}`);
  check('材质球底色为深色摄影棚（rgb(12,13,15) 规范化形式）', dom.dark === dom.n, `dark=${dom.dark}/${dom.n}`);

  // ③目录重渲后仍直接命中缓存（清空搜索触发 renderCatalog → renderCatalogEnvMats 同步读 swatchPreviews）
  await page.fill('#catalogSearch', '');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.mswatch[data-mat]')];
    return { n: els.length, withUrl: els.filter((e) => (e.style.background || '').includes('data:image/png')).length };
  });
  check('目录重渲后材质球直读缓存', after.n >= 1 && after.withUrl === after.n, JSON.stringify(after));

  // ④无 console 错误
  check('全程无 console 错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await page.close();
  await context.close();
} finally {
  await browser.close();
}

console.log('\n== 汇总 ==');
const nFail = results.filter((r) => !r.ok).length;
console.log(`PASS ${results.length - nFail}/${results.length}`);
process.exit(nFail === 0 && consoleErrors.length === 0 ? 0 : 1);
