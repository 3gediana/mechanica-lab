// realspot.mjs — AG-90 真实模型抽查（计费提醒：每类题图 1 次真实调用，默认全套 7 次）
// 用法：node realspot.mjs [类名...]   类名缺省 = incline momentum celestial spin spring hinge atwood
// 断言走生产 normalizeParse 路径（与 UI 同一条零信任链），检查题型/实体/关键推断层行为。
// 前置：dev server 8721 已配置 key（服务端）。结果落盘 tools/ui-test/last-realspot.txt。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeParse } from '../src/engine/parse-schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:8721';
// 断言口径 = 布局层可消化的最小形状（与 parse-schema 布局函数对齐，非强求特定实体类型）：
// spring 需墙(box)+振子(sphere)；atwood 两球 sphere|box 皆可（atwoodLayout 同等支持）
const EXPECT = {
  incline: { types: ['ramp', 'sphere'], smooth: true },       // 光滑斜面：推断层应注入 friction=0
  momentum: { types: ['sphere', 'sphere'] },
  celestial: { types: ['celestial', 'celestial'], astro: true },
  spin: { types: ['cylinder', 'box'], rotation: true },
  spring: { types: ['box', 'sphere'], spring: true },
  hinge: { hinge: true, minEntities: 2 },                     // 锚点+杆（box/cylinder 组合不限）
  atwood: { types: ['pulley'], balls: 2, atwood: true },      // + 两个 sphere|box 摆球
};
const suites = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(EXPECT);

const rows = [];
let fails = 0;
for (const name of suites) {
  const img = readFileSync(join(HERE, 'fixtures', `question-${name}.png`));
  const dataUrl = `data:image/png;base64,${img.toString('base64')}`;
  const t0 = Date.now();
  try {
    const resp = await fetch(`${BASE}/api/parse-question`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl }),
    });
    const out = await resp.json();
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (!out.ok) {
      rows.push(`FAIL  ${name.padEnd(10)} ${dt}s  server: ${out.error}`);
      fails++;
      continue;
    }
    const n = normalizeParse(out.parse);
    if (!n.ok) {
      rows.push(`FAIL  ${name.padEnd(10)} ${dt}s  normalize 无效: ${n.errors.join('; ')}`);
      fails++;
      continue;
    }
    const plan = n.plan;
    const types = plan.entities.map((e) => e.type).sort();
    const exp = EXPECT[name];
    const problems = [];
    if (exp.types) {
      const typesOk = exp.types.every((t) => types.includes(t)) && types.length === exp.types.length;
      if (!typesOk) problems.push(`types=${JSON.stringify(types)} 期望=${JSON.stringify([...exp.types].sort())}`);
    }
    if (exp.minEntities && types.length < exp.minEntities) {
      problems.push(`实体不足 types=${JSON.stringify(types)}（布局层无法成场，客户端将诚实降级 0 实体）`);
    }
    if (exp.balls != null) {
      const balls = plan.entities.filter((e) => e.type === 'sphere' || e.type === 'box').length;
      if (balls !== exp.balls) problems.push(`摆球 ${balls} 个（sphere|box）期望 ${exp.balls}`);
    }
    // 原始输出落盘（供离线追溯；key 无关，模型 JSON）
    writeFileSync(join(HERE, 'ui-test', `realspot-raw-${name}.json`), JSON.stringify(out.parse, null, 1));
    if (exp.smooth) {
      const ball = plan.entities.find((e) => e.type === 'sphere');
      if (!ball || ball.given.friction !== 0) problems.push('光滑推断未生效');
    }
    if (exp.astro && plan.G == null) problems.push('astro 未给 G');
    if (exp.rotation && plan.kind !== 'rotation') problems.push(`kind=${plan.kind}`);
    if (exp.spring && !(plan.kind === 'spring' || plan.attaches.some((a) => a.type === 'spring'))) problems.push('spring 语义缺失');
    if (exp.hinge && plan.kind !== 'hinge') problems.push(`kind=${plan.kind}`);
    if (exp.atwood && !(plan.entities.some((e) => e.type === 'pulley'))) problems.push('缺 pulley');
    const ok = problems.length === 0;
    if (!ok) fails++;
    rows.push(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(10)} ${dt}s  conf=${(plan.confidence * 100).toFixed(0)}%` +
      (problems.length ? `  ${problems.join(' | ')}` : `  types=${JSON.stringify(types)}`));
  } catch (e) {
    rows.push(`FAIL  ${name.padEnd(10)} 网络异常: ${e.message}`);
    fails++;
  }
}
const report = [`AG-90 真实模型抽查  ${new Date().toISOString()}`, ...rows, `失败 ${fails}/${rows.length}`].join('\n');
console.log(report);
writeFileSync(join(HERE, 'ui-test', 'last-realspot.txt'), report + '\n');
process.exit(fails === 0 ? 0 : 1);
