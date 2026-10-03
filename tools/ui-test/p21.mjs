// p21.mjs — Round 24 验收：组件目录缩略图（离屏 WebGL 按真实几何渲染，接入分类/搜索/收藏视图）
// 纪律：单浏览器 / 单 context / 单标签；总时长上限约 3 分钟。
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8721';
mkdirSync('shots', { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const consoleErrors = [];
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.setDefaultTimeout(20000);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
  await page.waitForTimeout(600);   // 目录已渲染

  // ==== A. 分类视图：目录卡片带缩略图且与组件对应 ====
  // （Round 33 起目录含「环境/材质」场景级特殊卡：色卡设计本无缩略图，覆盖率只统计组件卡）
  const cat = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#catalogList .comp-item')];
    const compCards = items.filter((r) => r.querySelector('img.thumb'));
    return {
      n: items.length,
      compN: compCards.length,
      withThumb: compCards.filter((r) => r.querySelector('.thumb').src.startsWith('data:image/png')).length,
      hidden: compCards.filter((r) => r.querySelector('.thumb').style.display === 'none').length,
      sample: compCards.slice(0, 3).map((r) => ({
        name: r.querySelector('.nm').textContent,
        srcLen: r.querySelector('.thumb') ? r.querySelector('.thumb').src.length : 0,
      })),
    };
  });
  check('目录卡片数量合理(>=10)', cat.n >= 10, `n=${cat.n}`);
  check('缩略图覆盖率(全部组件卡有 dataURL 图)', cat.withThumb === cat.compN && cat.compN >= 18,
    `with=${cat.withThumb}/${cat.compN} (总卡 ${cat.n} 含环境/材质特殊卡) hidden=${cat.hidden}`);
  check('缩略图非空白(dataURL 有体量)', cat.sample.every((s) => s.srcLen > 2000), JSON.stringify(cat.sample.map((s) => s.name)));
  await page.screenshot({ path: 'shots/210-catalog-thumbs.png' });

  // ==== B. 缩略图与组件类型对应：不同组件图不同 ====
  const distinct = await page.evaluate(() => {
    const urls = [...document.querySelectorAll('#catalogList .comp-item .thumb')]
      .filter((i) => i.style.display !== 'none')
      .map((i) => i.src);
    return { total: urls.length, unique: new Set(urls).size };
  });
  check('不同组件缩略图互不相同', distinct.unique === distinct.total,
    `unique=${distinct.unique}/${distinct.total}`);

  // ==== C. 搜索视图同样带缩略图 ====
  await page.fill('#catalogSearch', '球');
  await page.waitForTimeout(350);
  const search = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#catalogList .comp-item')];
    return {
      n: items.length,
      withThumb: items.filter((r) => r.querySelector('.thumb')?.src.startsWith('data:image/png')).length,
    };
  });
  check('搜索结果带缩略图', search.n >= 1 && search.withThumb === search.n,
    `with=${search.withThumb}/${search.n}`);

  // ==== D. 收藏视图同样带缩略图 ====
  await page.fill('#catalogSearch', '');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    // 收藏「斜坡」（fav 按钮在第一张斜面卡片上）
    const rows = [...document.querySelectorAll('#catalogList .comp-item')];
    const ramp = rows.find((r) => r.querySelector('.nm')?.textContent === '斜坡');
    ramp.querySelector('.fav').click();
  });
  await page.waitForTimeout(300);
  const favs = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#catalogList .cat-head')].map((h) => h.textContent);
    const favZone = [...document.querySelectorAll('#catalogList .comp-item')].slice(0, 1);
    return {
      heads,
      firstThumb: favZone[0]?.querySelector('.thumb')?.src.startsWith('data:image/png') || false,
    };
  });
  check('收藏区置顶且带缩略图', favs.heads[0] === '收藏' && favs.firstThumb, JSON.stringify(favs.heads.slice(0, 2)));

  // ==== E. 缩略图功能回归：点击卡片照常放置组件 ====
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#catalogList .comp-item')];
    const sphere = rows.find((r) => r.querySelector('.nm')?.textContent === '球');
    sphere.click();
  });
  await page.waitForTimeout(300);
  const placed = await page.evaluate(() => window.MECH.entities().some((e) => e.type === 'sphere'));
  check('点击卡片照常放置组件(缩略图不挡交互)', placed === true);

  await page.close();
  await context.close();
} finally {
  await browser.close();
}

console.log('\n== 汇总 ==');
const nFail = results.filter((r) => !r.ok).length;
console.log(`PASS ${results.length - nFail}/${results.length}`);
if (consoleErrors.length) {
  console.log('浏览器 console/page 错误:');
  for (const e of consoleErrors.slice(0, 12)) console.log('  ', e.slice(0, 300));
}
process.exit(nFail === 0 && consoleErrors.length === 0 ? 0 : 1);
