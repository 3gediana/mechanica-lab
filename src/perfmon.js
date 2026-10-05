// perfmon.js — 帧预算仪表（PL-50）：渲染帧的分段耗时环形缓冲 + 纯数值摘要。
// 只记「真实渲染帧」（运行态每帧都渲染；编辑静止帧跳过不进样本），
// 百分位/1% low/尖峰计数全部在预分配缓冲上计算，HUD 文本拼装与 DOM 脏检查在 workbench 侧。
export class PerfMon {
  constructor(cap = 1200) {
    this.cap = cap;
    this.n = 0;                        // 累计提交帧数（取模进环）
    this._frame = new Float32Array(cap);
    this._physics = new Float32Array(cap);
    this._overlay = new Float32Array(cap);
    this._render = new Float32Array(cap);
    this._dom = new Float32Array(cap);
    this._scratch = new Float32Array(cap);
    this.calls = 0; this.tris = 0;     // 最近一次 renderer.info（DC/三角数）
  }

  // 清空采样窗：进入运行态时重开预算窗口——启动期的编译/HDRI 毫秒级尖峰不属于运行态预算
  reset() {
    this.n = 0;
  }

  // s: {frame, physics, overlay, render, dom, calls, tris}（毫秒）
  commit(s) {
    const i = this.n % this.cap;
    this._frame[i] = s.frame;
    this._physics[i] = s.physics;
    this._overlay[i] = s.overlay;
    this._render[i] = s.render;
    this._dom[i] = s.dom;
    this.n++;
    if (s.calls != null) this.calls = s.calls;
    if (s.tris != null) this.tris = s.tris;
  }

  // 最近 win 帧某通道的原始样本（测试/回归自算分位用；新→旧）
  samples(key, win = 600) {
    const out = [];
    const n = Math.min(this.n, win, this.cap);
    for (let k = 0; k < n; k++) {
      out.push(this['_' + key][(this.n - 1 - k) % this.cap]);
    }
    return out;
  }

  _pct(arr, p, n) {
    // 升序分位（最近邻）：把窗口复制进 scratch 再排序（4Hz HUD 调用，1200 元素排序 <0.1ms）
    const sc = this._scratch;
    for (let i = 0; i < n; i++) sc[i] = arr[(this.n - n + i) % this.cap];
    const view = sc.subarray(0, n);
    view.sort();
    return view[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
  }

  _worst1Avg(arr, n) {
    // 1% low（帧耗时口径 = 最差 1% 帧的均值，fps 惯例的倒数语义）
    const sc = this._scratch;
    for (let i = 0; i < n; i++) sc[i] = arr[(this.n - n + i) % this.cap];
    const view = sc.subarray(0, n);
    view.sort();
    const k = Math.max(1, Math.round(n * 0.01));
    let s = 0;
    for (let i = n - k; i < n; i++) s += view[i];
    return s / k;
  }

  // 摘要（win 帧窗口）；无样本返回 null。spike8/20 = 帧耗 >8/20ms 帧数（GC 卫生指标）
  summary(win = 600) {
    const n = Math.min(this.n, win, this.cap);
    if (!n) return null;
    let spike8 = 0, spike20 = 0, fmax = 0;
    for (let i = 0; i < n; i++) {
      const f = this._frame[(this.n - n + i) % this.cap];
      if (f > fmax) fmax = f;
      if (f > 8) spike8++;
      if (f > 20) spike20++;
    }
    return {
      n,
      total: this.n,      // 真实累计提交帧数（不钳窗口；p34 采样窗对账用）
      frame: {
        p50: r(this._pct(this._frame, 0.50, n)),
        p95: r(this._pct(this._frame, 0.95, n)),
        max: r(fmax),
        low1: r(this._worst1Avg(this._frame, n)),
      },
      physics: { p95: r(this._pct(this._physics, 0.95, n)) },
      overlay: { p95: r(this._pct(this._overlay, 0.95, n)) },
      render: { p95: r(this._pct(this._render, 0.95, n)) },
      dom: { p95: r(this._pct(this._dom, 0.95, n)) },
      spike8, spike20,
      calls: this.calls, tris: this.tris,
    };
  }
}

function r(v) { return Math.round(v * 100) / 100; }
