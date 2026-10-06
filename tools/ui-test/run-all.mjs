// run-all.mjs — 全量回归聚合 runner（ENG-63）：顺序跑 p0-p31 + w 系列走查，
// 汇总 PASS/FAIL/耗时，结果落盘 last-run.txt。用法：
//   node run-all.mjs            # 全量 p0-p31 + w1 w5 w6（无 API 走查）
//   node run-all.mjs --with-api # 追加 w2 w4 w7（真实模型调用，计入 API 预算）
//   node run-all.mjs p3 p4      # 只跑指定套件
// 前置：dev server 已存活（复用，不代起；w3 需专用环境不含在内）。
// **必须显式 export MECH_BASE**（如 http://127.0.0.1:8722）：老套件默认 8721、新套件默认 8722，
// 不设会导致一次回归打到两个树（实测：5 个假失败全是对着别的 worktree 的旧代码跑出来的）。
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const P_ALL = [...Array.from({ length: 33 }, (_, i) => `p${i}`), 'p33-play', 'p35-placement', 'p36-agent-cmds', 'p37-agent-verify', 'p38-spawnlife', 'p39-agent-patch', 'p40-data-export', 'p41-model-coverage'];   // +p36 Agent指令 +p37 建场自查 +p39 语义自修正 +p40 数据导出（p34-perf headed 单独跑不入聚合）
const W_NOAPI = ['w1-manual', 'w5-journey', 'w6-depth'];
const W_API = ['w2-agent', 'w4-mixed', 'w7-presets-explain'];

const args = process.argv.slice(2);
const withApi = args.includes('--with-api');
if (!process.env.MECH_BASE) console.log('⚠ 未设 MECH_BASE：老套件默认 8721、新套件默认 8722，一次回归会打到两个树（假失败）。建议 export MECH_BASE 后重跑。');
let suites;
if (args.some((a) => !a.startsWith('--'))) {
  suites = args.filter((a) => !a.startsWith('--'));
} else {
  suites = [...P_ALL, ...W_NOAPI, ...(withApi ? W_API : [])];
}

const t0 = Date.now();
const rows = [];
let fails = 0;
for (const s of suites) {
  const st = Date.now();
  const r = spawnSync(process.execPath, [join(HERE, `${s}.mjs`)], { encoding: 'utf8', timeout: 300000 });
  const dt = ((Date.now() - st) / 1000).toFixed(1);
  const tail = (r.stdout || '').trim().split('\n').filter((l) => l.startsWith('PASS ') || l.startsWith('FAIL') || l.startsWith('EXIT'));
  const summary = tail.find((l) => /^PASS \d+/.test(l)) || (r.status === 0 ? 'PASS ?' : 'FAIL');
  const ok = r.status === 0;
  if (!ok) fails++;
  rows.push(`${ok ? 'OK  ' : 'FAIL'}  ${s.padEnd(20)} ${String(dt).padStart(6)}s  ${summary}`);
  console.log(rows[rows.length - 1]);
  if (!ok) {
    for (const l of tail.filter((l) => l.startsWith('FAIL '))) console.log('     ' + l);   // 失败套件保留逐条断言明细
    if (r.stderr) console.log(r.stderr.split('\n').slice(0, 5).join('\n'));
  }
}
const total = ((Date.now() - t0) / 1000).toFixed(1);
const report = [
  `MECHANICA 全量回归  ${new Date().toISOString()}`,
  `套件 ${rows.length} · 失败 ${fails} · 总耗时 ${total}s`,
  ...rows,
].join('\n');
writeFileSync(join(HERE, 'last-run.txt'), report + '\n');
console.log(`\n== ${fails === 0 ? 'ALL GREEN' : `${fails} FAILED`} (${total}s)，报告: tools/ui-test/last-run.txt ==`);
process.exit(fails === 0 ? 0 : 1);
