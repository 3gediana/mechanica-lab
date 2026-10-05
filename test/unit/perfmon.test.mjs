// perfmon.test.mjs — 帧预算仪表纯逻辑单测（PL-50）：分位/1% low/尖峰计数/环形回绕。
// 运行：node --test test/unit/perfmon.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfMon } from '../../src/perfmon.js';

test('分位与最值：1..100 样本 p50/p95/max/1%low', () => {
  const m = new PerfMon(1000);
  for (let i = 1; i <= 100; i++) {
    m.commit({ frame: i, physics: i / 2, overlay: 0.1, render: i / 4, dom: 0.05, calls: 80, tris: 40000 });
  }
  const s = m.summary(1000);
  assert.equal(s.n, 100);
  assert.equal(s.frame.p50, 51);         // round(0.5*99)=50 → 有序样本[50]=51（邻近取整）
  assert.equal(s.frame.p95, 95);         // round(0.95*99)=94 → 95
  assert.equal(s.frame.max, 100);
  // 1% low = 最差 1% 帧均值（100 帧 → 最差 1 帧 = 100）
  assert.equal(s.frame.low1, 100);
  assert.equal(s.physics.p95, 47.5);     // physics=i/2
  assert.equal(s.render.p95, 23.75);     // render=i/4
  assert.equal(s.spike8, 92);            // >8ms 的帧：i=9..100
  assert.equal(s.calls, 80);
});

test('尖峰计数：>8 与 >20 分档', () => {
  const m = new PerfMon(100);
  const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 21];
  for (const f of vals) m.commit({ frame: f, physics: 0, overlay: 0, render: 0, dom: 0 });
  const s = m.summary(100);
  assert.equal(s.spike8, 2);             // 9、21
  assert.equal(s.spike20, 1);            // 21
});

test('环形回绕：提交 2×cap 后摘要只反映最近 cap 帧', () => {
  const m = new PerfMon(100);
  for (let i = 0; i < 100; i++) m.commit({ frame: 50, physics: 0, overlay: 0, render: 0, dom: 0 });
  for (let i = 1; i <= 100; i++) m.commit({ frame: i, physics: 0, overlay: 0, render: 0, dom: 0 });
  const s = m.summary(1000);
  assert.equal(s.frame.max, 100);        // 旧 50ms 帧已被冲走
  assert.equal(s.frame.p50, 51);
});

test('窗口裁剪：win < 已提交帧数时只统计最近 win 帧', () => {
  const m = new PerfMon(1000);
  for (let i = 0; i < 500; i++) m.commit({ frame: 20, physics: 0, overlay: 0, render: 0, dom: 0 });
  for (let i = 0; i < 100; i++) m.commit({ frame: 1, physics: 0, overlay: 0, render: 0, dom: 0 });
  const s = m.summary(100);
  assert.equal(s.n, 100);
  assert.equal(s.frame.max, 1);
  assert.equal(s.frame.p95, 1);
});

test('samples：新→旧顺序输出原始样本', () => {
  const m = new PerfMon(10);
  for (const f of [3, 1, 2]) m.commit({ frame: f, physics: 0, overlay: 0, render: 0, dom: 0 });
  assert.deepEqual(m.samples('frame', 10), [2, 1, 3]);
});

test('空样本 summary 返回 null', () => {
  const m = new PerfMon(10);
  assert.equal(m.summary(10), null);
});
