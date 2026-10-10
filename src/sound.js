// sound.js — 运行态声音引擎（层 1，PL-1..8）：WebAudio 程序合成零资产。
// 设计口径：碰撞声 = 噪声瞬态（打击感）+ 模态共振体（body 共振，非谐泛音簇）——
// 禁裸方波哔哔声（廉价感红线）。三音色：wood（空心木质）/ ceramic（刚性瓷金属）/ rubber（软闷）。
// 限流三重：全局限速 + 配对冷却 + 主链 DynamicsCompressor；autoplay 合规 = AudioContext
// 只在可信手势（pointerdown/keydown）里创建与 resume，评估脚本触发的播放保持静默。
const MAT_TIMBRE = {
  wood: 'wood', chalk: 'wood',
  marble: 'ceramic', chrome: 'ceramic', steelDark: 'ceramic', brass: 'ceramic', mattePlastic: 'ceramic',
  rubber: 'rubber',
};
// 两体相碰取更软一方的音色：接触刚度由柔体主导（橡皮球砸大理石地是闷响不是瓷响），
// 木球撞石地是木芯空响——听感与接触力学一致
const TIMBRE_RANK = { ceramic: 0, wood: 1, rubber: 2 };

// 模态参数：modes.r = 基频比（板/杆非谐模态，参考真实敲击频谱），q = 共振品质因数，
// decay = 包络时长（s）。噪声瞬态给打击的"接触感"，模式给"材质感"。
const TIMBRES = {
  wood: {
    noise: { f: 320, q: 1.0, gain: 0.5, decay: 0.03, attack: 0.002 },
    modes: [{ r: 1.0, f: 165, q: 9, gain: 1.0 }, { r: 1.94, f: 330, q: 11, gain: 0.5 }],
    decay: 0.10,
  },
  ceramic: {
    noise: { f: 2400, q: 0.8, gain: 0.32, decay: 0.012, attack: 0.001 },
    modes: [{ r: 1.0, f: 1040, q: 22, gain: 1.0 }, { r: 2.32, f: 1040, q: 26, gain: 0.55 }, { r: 4.62, f: 1040, q: 30, gain: 0.26 }],
    decay: 0.30,
  },
  rubber: {
    noise: { f: 160, q: 0.6, gain: 0.7, decay: 0.05, attack: 0.006 },
    modes: [{ r: 1.0, f: 62, q: 3.5, gain: 1.0 }],
    decay: 0.11,
  },
};

const J_REF = 2.2;        // 冲量满标称（1kg·2.2m/s 撞击 = 满强度）； below 0.04 视为静默微接触
const J_MIN = 0.04;
const GLOBAL_MIN_GAP = 0.02;   // 全局最小区隔（s）：同帧碰撞风暴限速
const PAIR_COOLDOWN = 0.07;    // 同对实体冷却（s）：牛顿摆稳态接触不成机枪

export class SoundEngine {
  constructor() {
    this.ctx = null;             // 惰性：首个可信手势才创建（autoplay 合规）
    this.master = null;
    this._noiseBuf = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('mech.sound') === '0'; } catch (e) { /* 隐私模式默认开 */ }
    this.emitted = 0;            // 已发声数（p33 断言）
    this.dropped = 0;            // 被限流/静音丢弃数
    this.voices = [];            // 最近 8 条发声记录 [{strength,gain,timbre,pan,t}]
    this._lastGlobal = -1;
    this._pairLast = new Map();  // 'a|b' -> 上次发声钟
    this._clock = () => performance.now() / 1000;
  }

  // 可信手势入口（workbench 在 pointerdown/keydown 上 once 接线）
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this._installMaster(this.ctx);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // 主链：voice → master → 压缩器（碰撞风暴限幅护耳）→ destination；噪声缓冲挂 ctx 上
  _installMaster(ctx) {
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    // 共享白噪声缓冲（1s）：所有瞬态的源，随机偏移取读避免机械感
    const len = ctx.sampleRate;
    this._noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  // 单个撞击 voice 的完整构建（噪声瞬态 + 非谐模态共振簇）。
  // impact()（实时）与 renderSample()（离线听感验证/wav 导出）共用同一条路径，
  // 保证"测到的波形 = 听到的波形"。lpFreq：距离低通截止 Hz（FX-548，缺省近场不滤）。
  _scheduleVoice(ctx, dest, noiseBuf, timbre, gain, t0, detune, pan = 0, lpFreq = 0) {
    const T = TIMBRES[timbre];
    const out = ctx.createGain();
    out.gain.value = gain;
    // FX-548 距离低通：远撞发闷近撞清脆（每 voice 1 个 BiquadFilter，att 驱动）
    let tail = out;
    if (lpFreq && lpFreq < 15000) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = lpFreq;
      lp.Q.value = 0.4;
      out.connect(lp);
      tail = lp;
    }
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) {
      // FX-543：pan 平滑——同对上一声 pan 突变>0.3 时用 0.1s 时间常数滑向目标(声像跳变刺耳)
      const pTarget = Math.max(-0.85, Math.min(0.85, pan));
      const prev = this._panPrev != null ? this._panPrev : pTarget;
      if (Math.abs(pTarget - prev) > 0.3) panner.pan.setTargetAtTime(pTarget, t0, 0.1);
      else panner.pan.value = pTarget;
      this._panPrev = pTarget;
      tail.connect(panner);
      panner.connect(dest);
    } else {
      tail.connect(dest);
    }

    // 瞬态：带通噪声短爆
    {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = T.noise.f * detune;
      bp.Q.value = T.noise.q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(T.noise.gain, t0 + T.noise.attack);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + T.noise.decay);
      src.connect(bp); bp.connect(g); g.connect(out);
      src.start(t0, Math.random() * 0.8);
      src.stop(t0 + T.noise.decay + 0.02);
    }
    // 共振体：非谐模态正弦簇（body 共振——材质感所在）
    for (const m of T.modes) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = m.f * m.r * detune;
      const g = ctx.createGain();
      const peak = m.gain * 0.6;
      const atk = timbre === 'ceramic' ? 0.0015 : 0.003;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + atk);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + T.decay);
      osc.connect(g); g.connect(out);
      osc.start(t0);
      osc.stop(t0 + T.decay + 0.05);
    }
  }

  setMuted(m) {
    this.muted = !!m;
    try { localStorage.setItem('mech.sound', this.muted ? '0' : '1'); } catch (e) { /* 忽略 */ }
  }

  // 强度 → 峰值增益：单调（p33 断言口径）、幂压缩（小撞可闻、大撞不炸耳）
  static gainOf(j) {
    const s = Math.min(1, Math.max(0, j / J_REF));
    return Math.pow(s, 0.7) * 0.55;
  }

  static timbreOf(matA, matB) {
    const a = MAT_TIMBRE[matA] || 'ceramic';
    const b = MAT_TIMBRE[matB] || 'ceramic';
    return TIMBRE_RANK[a] >= TIMBRE_RANK[b] ? a : b;
  }

  // 清空发声记录/计数（诊断与回归口径重置；不影响音频图）
  clearLog() {
    this.voices.length = 0;
    this.emitted = 0;
    this.dropped = 0;
  }

  // 碰撞入参：{ j(冲量 kg·m/s), matA, matB, pair(实体对键,可选), pan(-1..1), att(距离衰减 0..1),
  //   mass(两体几何平均质量 kg,可选 FX-545 音高随质量) }
  // 返回 true = 实际发声（限流通过）
  impact({ j, matA, matB, pair, pan = 0, att = 1, mass = 1, slowFactor = 1 }) {   // slowFactor=FX-547 慢动作音高因子
    if (this.muted || !this.ctx || this.ctx.state !== 'running' || j < J_MIN) { this.dropped++; return false; }
    const now = this._clock();
    if (now - this._lastGlobal < GLOBAL_MIN_GAP) { this.dropped++; return false; }
    const pairKey = pair || (matA < matB ? matA + '|' + matB : matB + '|' + matA);
    const last = this._pairLast.get(pairKey) || -1;
    if (now - last < PAIR_COOLDOWN) { this.dropped++; return false; }
    this._lastGlobal = now;
    this._pairLast.set(pairKey, now);

    const timbre = SoundEngine.timbreOf(matA, matB);
    const gain = SoundEngine.gainOf(j) * att;
    if (gain < 0.004) { this.dropped++; return false; }
    const t0 = this.ctx.currentTime;
    // ±6% 随机音高：同型碰撞不成机枪音；FX-545 质量因子：轻 10 倍升/重 10 倍降（钳 ±8%）
    const massFactor = Math.max(0.92, Math.min(1.08, Math.pow(1 / Math.max(0.05, mass), 0.12)));
    const detune = (0.94 + Math.random() * 0.12) * massFactor * slowFactor;   // FX-547：慢动作音高同步下移(0.25x→-5 半音口径由调用方算)
    // FX-548 距离低通：att 1=近场 12kHz 不滤，0=远场 2.2kHz 发闷
    const lpFreq = att >= 0.98 ? 0 : 2200 + att * 9800;
    this._scheduleVoice(this.ctx, this.master, this._noiseBuf, timbre, gain, t0, detune, pan, lpFreq);
    this.emitted++;
    this.voices.push({ strength: +(j / J_REF).toFixed(4), gain: +gain.toFixed(4), timbre, pan: +pan.toFixed(3), t: +now.toFixed(3) });
    if (this.voices.length > 8) this.voices.shift();
    return true;
  }

  // 离线渲染一个撞击样本（听感机器代理 + wav 导出）：与 impact() 同一条 _scheduleVoice 路径。
  // 返回 { samples: Float32Array, sampleRate }；须在用户手势解锁后的页面上下文调用。
  async renderSample(timbre, j = 1.2) {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC || !this.ctx || !this._noiseBuf) return null;
    const sr = this.ctx.sampleRate;
    const dur = TIMBRES[timbre].decay + 0.15;
    const off = new AC(1, Math.ceil(sr * dur), sr);
    const master = off.createGain();
    master.gain.value = 0.7;
    master.connect(off.destination);
    this._scheduleVoice(off, master, this._noiseBuf, timbre, SoundEngine.gainOf(j), 0.01, 1.0);
    const buf = await off.startRendering();
    return { samples: buf.getChannelData(0).slice(), sampleRate: sr };
  }

  // 状态音（run/pause/reset）：安静的瓷音短 tick，同禁裸哔哔口径（模态短包络）
  // FX-539：滚动摩擦持续音——纯滚动体共 1 个共享声部(带通白噪 250Hz+lowpass 800),
  // gain 随总滚动速度封顶 0.12;停滚 0.2s 淡出。workbench 每帧调 rollLoop(speedSum)
  rollLoop(speedSum = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    if (this.muted) speedSum = 0;
    const target = Math.min(0.12, speedSum * 0.045);
    if (target > 0.004) {
      if (!this._rollSrc) {
        const src = this.ctx.createBufferSource();
        src.buffer = this._noiseBuf;
        src.loop = true;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 250; bp.Q.value = 0.8;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 800;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(this.master);
        src.start();
        this._rollSrc = src; this._rollGain = g;
      }
      this._rollTarget = target;
      this._rollLastT = performance.now();
    } else {
      this._rollTarget = 0;
    }
    if (this._rollGain) {
      const now = performance.now();
      const faded = now - (this._rollLastT || 0) > 200 ? 0 : (this._rollTarget || 0);   // 停滚 0.2s 淡出
      const cur = this._rollGain.gain.value;
      const next = cur + (faded - cur) * 0.12;
      this._rollGain.gain.setTargetAtTime(next, this.ctx.currentTime, 0.05);
      if (faded === 0 && cur < 0.003 && this._rollSrc) {   // 完全静默后拆源(不留常驻节点)
        try { this._rollSrc.stop(); } catch (e) { /* 已停 */ }
        this._rollSrc = null; this._rollGain = null;
      }
    }
    return true;
  }

  // FX-541：绳绷紧音——松弛绳突然张紧(张力首超阈值)的「绷」:1200Hz 高 Q 单模态,
  // attack 1ms decay 0.08s,gain 随 T/(mg) 封顶 0.08;每绳独立 0.4s 冷却(workbench 传入)
  tautTone(strength = 1) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return false;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1180, t0);
    osc.frequency.exponentialRampToValueAtTime(1240, t0 + 0.08);
    const g = this.ctx.createGain();
    const peak = Math.min(0.08, 0.02 + 0.06 * Math.min(1, strength));
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0006, t0 + 0.08);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + 0.1);
    return true;
  }

  ui(kind) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return false;
    const base = { play: 720, pause: 500, reset: 600 }[kind];
    if (!base) return false;
    const t0 = this.ctx.currentTime;
    const tick = (f, dt, g0) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t0 + dt);
      g.gain.linearRampToValueAtTime(g0, t0 + dt + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dt + 0.06);
      osc.connect(g); g.connect(this.master);
      osc.start(t0 + dt);
      osc.stop(t0 + dt + 0.08);
    };
    tick(base, 0, 0.10);
    if (kind === 'reset') tick(base * 1.25, 0.07, 0.08);
    return true;
  }

  state() {
    return {
      muted: this.muted,
      ctx: this.ctx ? this.ctx.state : 'none',
      emitted: this.emitted,
      dropped: this.dropped,
      voices: this.voices.map((v) => ({ ...v })),
    };
  }
}
