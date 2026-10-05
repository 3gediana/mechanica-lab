// p33-play.mjs — 运行态"玩起来"行为黑盒（层 1 声音起步，层 2 抓取抛掷落地后追加其断言）。
// 声音：autoplay 合规（无手势不出声）、手势解锁、碰撞触发发声节点、gain 随冲量单调、
// 三音色映射、限流生效（牛顿摆碰撞风暴）、静音持久化。
// 前置：MECH_BASE（默认 http://127.0.0.1:8721）服务存活。
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.MECH_BASE || 'http://127.0.0.1:8721';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 860 } })).newPage();
  page.setDefaultTimeout(20000);
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !(m.location()?.url || '').includes('/api/')) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });

  // ---- 1. autoplay 合规：无可信手势时引擎保持静默（ctx 不创建） ----
  await page.evaluate(() => {
    window.MECH.loadPreset('momentum');
    window.MECH.setMuted(false);
    window.MECH.play();          // 评估脚本触发 = 非可信手势
  });
  await page.waitForFunction(() => window.MECH.state().simT > 1.2, null, { timeout: 15000, polling: 200 });
  {
    const st = await page.evaluate(() => window.MECH.soundState());
    check('autoplay 合规：无手势不出声', st.ctx === 'none' && st.emitted === 0, `ctx=${st.ctx} emitted=${st.emitted}`);
  }

  // ---- 2. 手势解锁：可信点击后 AudioContext running ----
  await page.mouse.click(640, 300);            // 视口中央（可信 pointerdown）
  await sleep(150);
  {
    const st = await page.evaluate(() => window.MECH.soundState());
    check('手势解锁：ctx=running', st.ctx === 'running', `ctx=${st.ctx}`);
  }

  // ---- 3. 碰撞发声 + gain 随冲量单调（同速度变质量：j=m·v 线性） ----
  // 场景：地面 + 球（y=1.2，v=-2m/s 自由下落）；轻球 m=0.4 vs 重球 m=1.0（冲量差 2.5 倍）
  const dropVoice = async (mass, material = 'marble') => {
    await page.evaluate(() => { window.MECH.resetSim(); window.MECH.setMuted(false); window.MECH.clearSoundLog(); });
    await page.evaluate(({ m, mat }) => {
      const M = window.MECH;
      M.loadPreset('empty');
      M.addComponent('ground');
      M.addComponent('sphere', {
        transform: { pos: [0, 1.2, 0] },
        physics: { mass: m, linvel: [0, -2, 0], restitution: 0.1 },
        render: { material: mat },
      });
    }, { m: mass, mat: material });
    await page.evaluate(() => document.getElementById('btnPlay').click());   // 可信手势路径
    const ok = await page.waitForFunction(() => window.MECH.soundState().voices.length > 0, null, { timeout: 8000, polling: 100 })
      .then(() => true).catch(() => false);
    if (!ok) return null;
    // 取前 1.2s 内最强声（多次弹跳里首次落地主导）
    return await page.evaluate(() => {
      const vs = window.MECH.soundState().voices;
      return vs.reduce((a, v) => (v.strength > a.strength ? v : a), vs[0]);
    });
  };
  {
    const light = await dropVoice(0.15);
    check('碰撞触发发声（节点创建 + 记录）', !!light, light ? `timbre=${light.timbre} strength=${light.strength} gain=${light.gain}` : '超时无声');
    const heavy = await dropVoice(0.6);
    check('gain 随冲量单调（m0.15 → m0.6 变强）', !!light && !!heavy && heavy.strength > light.strength && heavy.gain > light.gain,
      light && heavy ? `s ${light.strength}→${heavy.strength}, g ${light.gain}→${heavy.gain}` : '缺样本');
  }

  // ---- 4. 三音色映射（更软方主导：木球/胶球落大理石地 → wood/rubber 音色） ----
  {
    const woodVoice = await dropVoice(1.0, 'wood');
    check('木质音色（wood 材质）', woodVoice?.timbre === 'wood', `timbre=${woodVoice?.timbre}`);
    const rubVoice = await dropVoice(1.0, 'rubber');
    check('软胶音色（rubber 材质）', rubVoice?.timbre === 'rubber', `timbre=${rubVoice?.timbre}`);
  }

  // ---- 5. 限流：10 球同落风暴（同时刻碰撞 > 全局限速窗口），dropped > 0 且速率封顶 ----
  {
    await page.evaluate(() => { window.MECH.resetSim(); window.MECH.setMuted(false); window.MECH.clearSoundLog(); });
    await page.evaluate(() => {
      const M = window.MECH;
      M.loadPreset('empty');
      M.addComponent('ground');
      for (let i = 0; i < 10; i++) {
        M.addComponent('sphere', {
          transform: { pos: [(i % 5) * 0.5 - 1, 2.2 + Math.floor(i / 5) * 0.55, 0] },
          physics: { mass: 0.5, linvel: [0, -4, 0], restitution: 0.85 },
          render: { material: 'rubber' },
        });
      }
    });
    await page.evaluate(() => document.getElementById('btnPlay').click());
    await page.waitForFunction(() => window.MECH.state().simT > 3, null, { timeout: 20000, polling: 200 });
    const st = await page.evaluate(() => window.MECH.soundState());
    check('限流生效（风暴期 dropped>0 且速率封顶）', st.dropped > 0 && st.emitted < 3 / 0.02 + 5,
      `emitted=${st.emitted} dropped=${st.dropped} (上限~155)`);
  }

  // ---- 6. 静音开关：UI 切换 + localStorage 持久化 + 静音期零发声 ----
  {
    await page.evaluate(() => window.MECH.resetSim());
    await page.click('#btnSound');
    const label = await page.evaluate(() => document.getElementById('btnSound').textContent);
    const ls = await page.evaluate(() => localStorage.getItem('mech.sound'));
    check('静音按钮：文案切换 + 持久化', label === '静音' && ls === '0', `label=${label} ls=${ls}`);
    const before = await page.evaluate(() => { window.MECH.loadPreset('momentum'); window.MECH.play(); return window.MECH.soundState().emitted; });
    await page.waitForFunction(() => window.MECH.state().simT > 1.5, null, { timeout: 15000, polling: 200 });
    const after = await page.evaluate(() => window.MECH.soundState().emitted);
    check('静音期零发声', before === after, `emitted ${before}→${after}`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.MECH && window.MECH.ready(), null, { timeout: 25000 });
    const st = await page.evaluate(() => window.MECH.soundState());
    check('静音刷新后保持', st.muted === true, `muted=${st.muted}`);
    await page.evaluate(() => window.MECH.setMuted(false));
  }

  // ---- 7. 听感机器代理：离线渲染三音色（与实时同路径），验证包络/频谱 + wav 落盘供人耳抽听 ----
  // 廉价感红线 = 禁裸方波哔哔声。机器可证：瞬态攻击 <15ms 达峰、衰减尾 <35% 峰、
  // 频谱多峰（共振体非单音）。wav 落 shots/ 供人工抽听（E4）。
  {
    const rawDirSound = join(dirname(fileURLToPath(import.meta.url)), 'shots');
    mkdirSync(rawDirSound, { recursive: true });
    await page.mouse.click(640, 300);   // 确保解锁（renderSample 依赖实时 ctx 的采样率/噪声缓冲）
    await sleep(120);
    const wav = (samples, sr) => {
      const n = samples.length;
      const buf = new ArrayBuffer(44 + n * 2);
      const v = new DataView(buf);
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVEfmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true);
      v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
      return Buffer.from(buf);
    };
    const analyze = (s, sr) => {
      let peak = 0, peakIdx = 0;
      for (let i = 0; i < s.length; i++) if (Math.abs(s[i]) > peak) { peak = Math.abs(s[i]); peakIdx = i; }
      const tail0 = peakIdx + Math.floor((s.length - peakIdx) * 0.5);
      let tailE = 0; for (let i = tail0; i < s.length; i++) tailE += s[i] * s[i];
      const tailRms = Math.sqrt(tailE / Math.max(1, s.length - tail0));
      // 频带提取（粗 DFT 0-6kHz，stride2）：局部极大且 > 10% 最大 bin 记显著频带；
      // 质心用功率加权（spec²）——均匀频底（衰减泄漏）不参与加权，哑音/亮音判别才成立
      const bins = 512, spec = new Array(bins).fill(0);
      for (let k = 1; k < bins; k++) {
        const f = (k / bins) * (sr / 2);
        if (f > 6000) break;
        let re = 0, im = 0;
        for (let i = 0; i < s.length; i += 2) { const ph = (2 * Math.PI * f * i) / sr; re += s[i] * Math.cos(ph); im += s[i] * Math.sin(ph); }
        spec[k] = Math.hypot(re, im);
      }
      let maxSpec = 0;
      for (const v of spec) if (v > maxSpec) maxSpec = v;
      const bandFreqs = [];
      let centroidE = 0, centroidW = 0;
      for (let k = 2; k < bins - 2; k++) {
        centroidE += spec[k] * spec[k] * ((k / bins) * (sr / 2)); centroidW += spec[k] * spec[k];
        const local = (spec[k - 2] + spec[k - 1] + spec[k + 1] + spec[k + 2]) / 4;
        if (spec[k] > maxSpec * 0.10 && spec[k] > local * 1.3 && spec[k] > spec[k - 1] && spec[k] >= spec[k + 1]) {
          bandFreqs.push((k / bins) * (sr / 2));
        }
      }
      return {
        peakMs: (peakIdx / sr) * 1000,
        tailRatio: tailRms / Math.max(peak, 1e-9),
        bands: bandFreqs,
        centroid: centroidW > 0 ? centroidE / centroidW : 0,
      };
    };
    // 廉价感红线按音色各自的真实特征断言（合成设计口径）：
    // ceramic=哔哔声高风险档 → ≥3 显著频带 + 含非谐比 ≈2.32 的模态对（方波/哔哔谐波串给不出）；
    // wood=双模态空响 ≥2 频带；rubber=单模态闷噗 → 频谱质心 <260Hz（哑音非哔哔）
    for (const timbre of ['wood', 'ceramic', 'rubber']) {
      const r = await page.evaluate((t) => window.MECH.renderSample(t), timbre);
      check(`${timbre}: 离线渲染出波形`, !!r && r.samples.length > 100, r ? `n=${r.samples.length} sr=${r.sampleRate}` : 'null');
      if (!r) continue;
      const a = analyze(r.samples, r.sampleRate);
      check(`${timbre}: 包络（瞬态 ${a.peakMs.toFixed(1)}ms 达峰 <15，衰减尾比 ${a.tailRatio.toFixed(3)} <0.35）`,
        a.peakMs < 15 && a.tailRatio < 0.35);
      let timbreOk, timbreDetail;
      if (timbre === 'ceramic') {
        const inharm = a.bands.some((f) => a.bands.some((g) => g > f && g / f > 2.1 && g / f < 2.6));
        timbreOk = a.bands.length >= 3 && inharm;
        timbreDetail = `bands=[${a.bands.map((f) => f.toFixed(0)).join(',')}Hz] 非谐对=${inharm}`;
      } else if (timbre === 'wood') {
        timbreOk = a.bands.length >= 2;
        timbreDetail = `bands=[${a.bands.map((f) => f.toFixed(0)).join(',')}Hz]`;
      } else {
        timbreOk = a.centroid > 0 && a.centroid < 260;
        timbreDetail = `质心=${a.centroid.toFixed(0)}Hz (<260 闷噗)`;
      }
      check(`${timbre}: 音色特征（${timbreDetail}）`, timbreOk);
      writeFileSync(join(rawDirSound, `sound-${timbre}.wav`), wav(r.samples, r.sampleRate));
    }
  }

  // ---- 8. 抓取抛掷（层 2，PL-10）：真实鼠标手势驱动 ----
  // 铁律断言：抓取=速度伺服（跟手）、松手瞬间速度=指针切向（方向+量级）、松手后仅受重力、
  // 按住不动松手=直掉对照。
  const vp = () => page.evaluate(() => {
    const v = window.MECH.__vp;
    return { w: v.renderer.domElement.getBoundingClientRect().width, h: v.renderer.domElement.getBoundingClientRect().height };
  });
  const screenOf = (x, y, z) => page.evaluate(([px, py, pz]) => window.MECH.__vp.screenPosOf(px, py, pz), [x, y, z]);
  const setupBall = async () => {
    await page.evaluate(() => {
      window.MECH.resetSim();
      window.MECH.clearSoundLog();
      const M = window.MECH;
      M.loadPreset('empty');
      M.addComponent('ground');
      M.addComponent('sphere', { transform: { pos: [0, 0.35, 0] }, physics: { mass: 0.5, linvel: [0, 0, 0], restitution: 0.1 } });
    });
    await page.evaluate(() => document.getElementById('btnPlay').click());
    await page.waitForFunction(() => window.MECH.state().simT > 0.6, null, { timeout: 10000, polling: 100 });
    const id = await page.evaluate(() => window.MECH.entities().find((e) => e.type === 'sphere').id);
    return id;
  };
  {
    const id = await setupBall();
    const [sx, sy] = await screenOf(0, 0.35, 0);
    await page.mouse.move(sx, sy, { steps: 2 });
    await page.mouse.down();
    // 抓取态生效（伺服接管）
    const gs = await page.evaluate(() => window.MECH.grabState());
    check('抓取启动（伺服接管，非瞬移）', !!gs && gs.id === id, gs ? `id=${gs.id.slice(0, 8)}…` : 'null');
    // 慢拖到 A 并停顿：伺服跟手 = 体位置收敛"伺服自身 target"（拖拽平面投影与屏幕点
    // 存在视角偏移是正确行为，跟手误差只应对伺服认定的目标量）
    const A = [0.7, 1.3, 0];
    const [ax, ay] = await screenOf(...A);
    await page.mouse.move(ax, ay, { steps: 10 });
    await page.waitForTimeout(220);
    {
      const st = await page.evaluate((eid) => ({ t: window.MECH.telemetry(eid), g: window.MECH.grabState() }), id);
      const err = Math.hypot(st.t.pos[0] - st.g.target[0], st.t.pos[1] - st.g.target[1]);
      check('伺服跟手（拖到 A 停顿后 |pos−target|<0.2）', err < 0.2, `err=${err.toFixed(3)}m`);
    }
    // 快速甩向上方并立刻松手（上抛=长滞空，给"仅重力"断言留无碰撞窗口）；
    // 用页面内合成 PointerEvent 序列（一次 evaluate、页面时序控制）：本机 playwright
    // CDP 每调用 ~200ms 延迟会把事件间隔拉稀到 80ms 尾窗外（实测教训），合成序列不受此限。
    const C = [A[0] + 0.35, A[1] + 1.4, 0];
    const [cx, cy] = await screenOf(...C);
    await page.evaluate(async ({ ax, ay, cx, cy }) => {
      const c = window.MECH.__vp.container;
      // 自旋等真实时间（隐藏页 setTimeout 链会被钳到 1s/次；dispatchEvent 同步派发，
      // 自旋让 handler 里的 performance.now() 轨迹时间戳真实拉开，96ms 阻塞无害）
      const spin = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* 忙等 */ } };
      const pev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 7 }));
      // 快甩（页面时序：6 点 × 16ms ≈ 96ms 轨迹，尾窗 80ms 有效）然后立刻松手
      for (let i = 1; i <= 6; i++) {
        pev('pointermove', ax + (cx - ax) * i / 6, ay + (cy - ay) * i / 6);
        spin(16);
      }
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, bubbles: true, pointerId: 7 }));
    }, { ax, ay, cx, cy });
    {
      const th = await page.evaluate(() => window.MECH.lastThrowState());
      check('指针轨迹速度被捕获（|vPtr|≥1.5）', !!th?.vPtr && Math.hypot(...th.vPtr) >= 1.5, th?.vPtr ? `|vPtr|=${Math.hypot(...th.vPtr).toFixed(2)}` : 'null');
      const cosP = (th.vFinal[0] * th.vPtr[0] + th.vFinal[1] * th.vPtr[1] + th.vFinal[2] * th.vPtr[2])
        / ((Math.hypot(...th.vFinal) * Math.hypot(...th.vPtr)) || 1);
      const angPtr = Math.acos(Math.max(-1, Math.min(1, cosP))) * 180 / Math.PI;
      check(`松手速度=指针切向（夹角 ${angPtr.toFixed(1)}° <25）`, angPtr < 25, `vFinal=[${th.vFinal.map((x) => x.toFixed(2))}]`);
      const ratio = Math.hypot(...th.vFinal) / Math.max(0.01, Math.hypot(...th.vPtr));
      check(`甩出量级混合生效（|vFinal|/|vPtr| ${ratio.toFixed(2)} ∈ [0.35, 1.15]）`, ratio > 0.35 && ratio < 1.15, `vFinal=${Math.hypot(...th.vFinal).toFixed(2)}`);
    }
    // 松手后仅受重力（空中无碰撞段）：Δv = g·Δt_sim（headless 节流下墙钟≠sim 时钟，
    // dt 必须取 simT 差），水平分量不变
    {
      const s1 = await page.evaluate((eid) => ({ v: window.MECH.telemetry(eid).vel, simT: window.MECH.state().simT }), id);
      await page.waitForTimeout(200);
      const s2 = await page.evaluate((eid) => ({ v: window.MECH.telemetry(eid).vel, simT: window.MECH.state().simT }), id);
      const dt = s2.simT - s1.simT;
      const dvx = s2.v[0] - s1.v[0], dvy = s2.v[1] - s1.v[1], dvz = s2.v[2] - s1.v[2];
      check(`松手后仅受重力（Δv≈[0,−gΔt,0]，dt=${dt.toFixed(2)}s，水平零变）`,
        dt > 0.05 && Math.abs(dvy + 9.81 * dt) < 0.45 && Math.abs(dvx) < 0.22 && Math.abs(dvz) < 0.22,
        `Δv=[${dvx.toFixed(2)}, ${dvy.toFixed(2)}, ${dvz.toFixed(2)}]`);
      await page.waitForTimeout(500);   // 落地静止，供下一段抓取
    }
    // 按住不动松手 → 直掉（对照组）：整个抓-持-放在一次 evaluate 里用页面内合成事件完成
    // （读球位置与 pointerdown 零间隔必然命中；CDP ~200ms 延迟下抓飞行中的球会扑空——实测教训）。
    // 单层 setTimeout 不触发隐藏页 1s 钳制；400ms 按住期间 rAF 正常跑、伺服把速度压到≈0。
    {
      const hold = await page.evaluate((eid) => new Promise((resolve) => {
        const M = window.MECH, vp = M.__vp;
        const t = M.telemetry(eid);
        const [sx, sy] = vp.screenPosOf(t.pos[0], t.pos[1], t.pos[2]);
        const c = vp.container;
        const pev = (type, x, y) => (type === 'pointerup'
          ? window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 7 }))
          : c.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 7 })));
        pev('pointerdown', sx, sy);
        const vAtGrab = M.telemetry(eid).vel;
        setTimeout(() => {
          const vHold = M.telemetry(eid).vel;
          pev('pointerup', sx, sy);
          const vRel = M.telemetry(eid).vel;
          const pRel = M.telemetry(eid).pos;
          setTimeout(() => resolve({
            vAtGrab, vHold, vRel, pRel,
            p1: M.telemetry(eid).pos,
          }), 350);
        }, 400);
      }), id);
      const drop = hold.p1[1] < hold.pRel[1] - 0.2;
      const drift = Math.hypot(hold.p1[0] - hold.pRel[0], hold.p1[2] - hold.pRel[2]);
      check('按住不动：伺服速度≈0（|v|<0.6）', Math.hypot(hold.vHold[0], hold.vHold[1], hold.vHold[2]) < 0.6,
        `|v|=${Math.hypot(...hold.vHold).toFixed(3)}（抓取时 |v|=${Math.hypot(...hold.vAtGrab).toFixed(2)}）`);
      check('松手直掉（释放 |v|<0.7，松手后水平漂移<0.12）', Math.hypot(hold.vRel[0], hold.vRel[1], hold.vRel[2]) < 0.7 && drift < 0.12,
        `|v|=${Math.hypot(...hold.vRel).toFixed(3)} drift=${drift.toFixed(3)}`);
      check('下落发生（对照）', drop, `y ${hold.pRel[1].toFixed(2)}→${hold.p1[1].toFixed(2)}`);
    }
  }

  // ---- 9. 运行态增量添加 / 图钉 / 运行态删除 / 重置语义（PL-11/12） ----
  {
    await page.evaluate(() => { window.MECH.resetSim(); });
    const before = await page.evaluate(() => window.MECH.entities().length);
    const lid = await page.evaluate(() => window.MECH.liveAdd('sphere', { transform: { pos: [3, 2, 0] }, physics: { mass: 1, linvel: [0, -2, 0] } }));
    const afterAdd = await page.evaluate(() => { window.MECH.play(); return window.MECH.entities().length; });
    const tel = await page.evaluate((x) => window.MECH.telemetry(x), lid);
    check('运行态增量添加（文档不进、物理体在跑）', !!lid && afterAdd === before && !!tel, `doc ${before}→${afterAdd}, tel=${!!tel}`);
    // 图钉：钉住后静止
    await page.waitForFunction((x) => window.MECH.telemetry(x) && window.MECH.telemetry(x).pos[1] < 1.5, lid, { timeout: 8000, polling: 100 });
    await page.evaluate((x) => window.MECH.togglePin(x), lid);
    const p1 = await page.evaluate((x) => window.MECH.telemetry(x).pos, lid);
    await page.waitForTimeout(350);
    const p2 = await page.evaluate((x) => window.MECH.telemetry(x).pos, lid);
    const pinned = await page.evaluate((x) => window.MECH.pinState().includes(x), lid);
    check('图钉：钉住后静止（重置即消的运行态操作）', pinned && Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < 0.01,
      `drift=${Math.hypot(p2[0] - p1[0], p2[1] - p1[1]).toFixed(4)}`);
    // 运行态删除
    const rm = await page.evaluate((x) => window.MECH.liveRemove(x), lid);
    const telAfter = await page.evaluate((x) => window.MECH.telemetry(x), lid);
    check('运行态删除（只拆运行时）', rm && !telAfter);
    // 重置回初始文档：liveAdd 的体消失
    await page.evaluate(() => window.MECH.resetSim());
    const telReset = await page.evaluate((x) => window.MECH.telemetry(x), lid);
    const afterReset = await page.evaluate(() => window.MECH.entities().length);
    check('重置回初始文档（运行态添加被清）', !telReset && afterReset === before, `doc=${afterReset}`);
  }

  // ---- 10. 暂停态 gizmo 摆姿势（PL-14）：暂停=gizmo 接管，继续=交还 ----
  {
    await page.evaluate(() => { window.MECH.resetSim(); });
    const id = await page.evaluate(() => window.MECH.entities().find((e) => e.type === 'sphere')?.id || null);
    await page.evaluate(() => window.MECH.play());
    await page.evaluate(() => window.MECH.pause());
    const gizmoOn = await page.evaluate((x) => {
      window.MECH.select(x);
      return window.MECH.__vp.gizmo.enabled;
    }, id);
    await page.evaluate(() => window.MECH.pause());   // 继续
    const gizmoOff = await page.evaluate(() => !window.MECH.__vp.gizmo.enabled);
    check('暂停态 gizmo 接管/继续交还（PL-14）', gizmoOn && gizmoOff, `pause=${gizmoOn} resume-off=${gizmoOff}`);
    await page.evaluate(() => window.MECH.resetSim());
  }

  // ---- 11. 碰撞 juice（层 3，PL-20..22）：粒子生成、升级环出现/淡出、震屏开关持久化 ----
  {
    await page.evaluate(() => {
      const M = window.MECH;
      M.resetSim();
      M.setShake(true);       // 上一轮可能持久化了关闭态——先显式开（trauma 累积被 shakeOn 门控）
      M.loadPreset('empty');
      M.addComponent('ground');
      M.addComponent('sphere', { transform: { pos: [0, 2.2, 0] }, physics: { mass: 1, linvel: [0, -4, 0] } });
    });
    await page.evaluate(() => document.getElementById('btnPlay').click());
    const spawned = await page.waitForFunction(() => window.MECH.juiceState().spawnedTotal > 0, null, { timeout: 10000, polling: 100 })
      .then(() => page.evaluate(() => window.MECH.juiceState())).catch(() => null);
    check('碰撞生成粒子（软精灵池）', !!spawned && spawned.spawnedTotal >= 4, spawned ? `spawned=${spawned.spawnedTotal}` : 'null');
    const rings = await page.waitForFunction(() => window.MECH.impactCount() > 0, null, { timeout: 10000, polling: 100 })
      .then(() => page.evaluate(() => window.MECH.impactCount())).catch(() => 0);
    check('升级碰撞环出现', rings >= 1, `rings=${rings}`);
    await page.waitForFunction(() => window.MECH.state().simT > 1.6, null, { timeout: 10000, polling: 200 });
    const ringsGone = await page.evaluate(() => window.MECH.impactCount());
    check('碰撞环 0.7s 后淡出', ringsGone === 0, `rings=${ringsGone}`);
    // 震屏机制同步直测（trauma 半衰期 0.3s，headless 饿 rAF 下瞬态采样必然竞态——
    // E2E 链路已由 spawnedTotal 证明，这里同步验证 spawnImpact 累积/开关门控/衰减）。
    // 上面真实碰撞段已采样 trauma1（尽力而为，不作硬断言）。
    {
      const mech = await page.evaluate(() => {
        const J = window.MECH.__juice;
        J.setShake(true);
        const t0 = J.state().trauma;
        J.spawnImpact([0, 0.05, 0], 1, 'ceramic');
        const on = J.state().trauma;
        J.setShake(false);
        J.spawnImpact([0, 0.05, 0], 1, 'ceramic');
        const off = J.state().trauma;
        J.tick(1);                       // 1s 衰减步进
        const decayed = J.state().trauma;
        J.setShake(true);
        return { t0, on, off, decayed };
      });
      check('震屏 trauma：重击累积 + 关闭门控 + 时间衰减', mech.on > mech.t0 && mech.off === mech.on && mech.decayed === 0,
        `t0=${mech.t0} on=${mech.on.toFixed(2)} off=${mech.off.toFixed(2)} decayed=${mech.decayed}`);
    }
    await page.evaluate(() => window.MECH.setShake(false));
    const ls = await page.evaluate(() => localStorage.getItem('mech.shake'));
    check('震屏开关持久化（ls=0）', ls === '0', `ls=${ls}`);
    // 关闭期真实碰撞：粒子照常生成、trauma 保持 0（trauma 累积被 shakeOn 门控）
    await page.evaluate(() => { window.MECH.resetSim(); window.MECH.play(); });
    const spawned2 = await page.waitForFunction(() => window.MECH.juiceState().spawnedTotal > 0, null, { timeout: 10000, polling: 100 })
      .then(() => page.evaluate(() => window.MECH.juiceState())).catch(() => null);
    const trauma2 = await page.evaluate(() => window.MECH.juiceState().trauma);
    check('震屏关闭期 trauma=0（粒子照常生成）', trauma2 === 0 && !!spawned2 && spawned2.spawnedTotal >= 4,
      `trauma=${trauma2} spawned=${spawned2 ? spawned2.spawnedTotal : 'null'}`);
    await page.evaluate(() => window.MECH.setShake(true));
    await page.evaluate(() => window.MECH.resetSim());
  }

  // ---- 12. 时间节奏（层 4，PL-30..32）：-/= 倍率档、. 单步、Shift+Space 慢动作、自动子弹时间 ----
  {
    await page.evaluate(() => { window.MECH.resetSim(); });
    // -/= 连续档位
    const seq = await page.evaluate(() => {
      const M = window.MECH;
      const out = [];
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '=', bubbles: true }));
      out.push(M.state().timeScale);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '=', bubbles: true }));
      out.push(M.state().timeScale);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
      out.push(M.state().timeScale);
      return out;
    });
    check('-/= 倍率档（1→2→4→2）', JSON.stringify(seq) === '[2,4,2]', `seq=${seq}`);
    // selSpeed UI 同步
    const selVal = await page.evaluate(() => document.getElementById('selSpeed').value);
    check('倍率档与下拉同步', selVal === '2', `sel=${selVal}`);
    await page.evaluate(() => {
      document.getElementById('selSpeed').value = '1';
      document.getElementById('selSpeed').dispatchEvent(new Event('change'));
    });
    // Shift+Space 慢动作互切 + 自动开矢量
    const slow = await page.evaluate(() => {
      const M = window.MECH;
      M.play();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', shiftKey: true, bubbles: true }));
      return { ts: M.state().timeScale, vecOn: M.vectorState().on };
    });
    check('慢动作切入（0.1x + 矢量自动开）', slow.ts === 0.1 && slow.vecOn === true, `ts=${slow.ts} vec=${slow.vecOn}`);
    const restored = await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', shiftKey: true, bubbles: true }));
      return window.MECH.state().timeScale;
    });
    check('慢动作恢复原档', restored === 1, `ts=${restored}`);
    // 慢放语义生效：0.5x/1x 同会话相对速率（绝对速率吃全局 rAF 节流——负载敏感，相对口径稳）
    const rate = await page.evaluate(() => new Promise((resolve) => {
      const M = window.MECH;
      const setSpd = (v) => { const s = document.getElementById('selSpeed'); s.value = String(v); s.dispatchEvent(new Event('change')); };
      const measure = (dur) => new Promise((res) => {
        const t0 = M.state().simT; const w0 = performance.now();
        setTimeout(() => res((M.state().simT - t0) / ((performance.now() - w0) / 1000)), dur);
      });
      (async () => {
        setSpd(1);
        await new Promise((r) => setTimeout(r, 250));
        const r1 = await measure(800);
        setSpd(0.5);
        await new Promise((r) => setTimeout(r, 250));
        const r05 = await measure(1000);
        setSpd(1);
        resolve(r05 / Math.max(r1, 0.01));
      })();
    }));
    check(`慢放速率（0.5x/1x 相对比 ${rate.toFixed(2)} ∈ [0.35, 0.7]）`, rate > 0.35 && rate < 0.7, `ratio=${rate.toFixed(2)}`);
    await page.evaluate(() => {
      document.getElementById('selSpeed').value = '1';
      document.getElementById('selSpeed').dispatchEvent(new Event('change'));
      window.MECH.resetSim();
    });
    // 自动子弹时间（惊喜预算 PL-23）：强碰撞自动 0.25x 后回 1x
    const bpt = await page.evaluate(() => new Promise((resolve) => {
      const M = window.MECH;
      M.setAutoBPT(true);
      M.loadPreset('empty');
      M.addComponent('ground');
      M.addComponent('sphere', { transform: { pos: [0, 2.5, 0] }, physics: { mass: 2, linvel: [0, -6, 0] } });
      document.getElementById('btnPlay').click();
      const out = { sawSlow: false, restored: false };
      const iv = setInterval(() => {
        const ts = M.state().timeScale;
        if (ts === 0.25) out.sawSlow = true;
        if (out.sawSlow && ts === 1) {
          out.restored = true;
          clearInterval(iv);
          M.setAutoBPT(false);
          M.resetSim();
          resolve(out);
        }
      }, 60);
      setTimeout(() => { clearInterval(iv); M.setAutoBPT(false); M.resetSim(); resolve(out); }, 9000);
    }));
    check('自动子弹时间（强碰撞 0.25x 慢放后回 1x）', bpt.sawSlow && bpt.restored, JSON.stringify(bpt));
  }

  // ---- 13. 反馈打磨（层 5，PL-40..44）：相机位飞行、hover 三态 ----
  {
    await page.evaluate(() => { window.MECH.resetSim(); });
    // PL-43 预置相机位：载入后相机平滑飞向预置 pose
    await page.evaluate(() => window.MECH.loadPreset('pendulum'));
    await page.waitForFunction(() => {
      const c = window.MECH.__vp;
      return c._poseAnim == null;   // 飞行完成
    }, null, { timeout: 8000, polling: 100 });
    const [pos, tgt] = await page.evaluate(() => [window.MECH.cameraPos().map((v) => +v.toFixed(1)), window.MECH.cameraTarget().map((v) => +v.toFixed(1))]);
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.4;
    check('预置相机位 flyToPose（pendulum）', near(pos, [1.6, 1.8, 3.2]) && near(tgt, [0, 1.0, 0]), `pos=[${pos}] tgt=[${tgt}]`);
    // PL-44 hover 三态：未选中体 hover 出淡灰盒
    const id = await page.evaluate(() => window.MECH.entities().find((e) => e.type === 'sphere')?.id);
    await page.evaluate(() => window.MECH.resetSim());
    await page.evaluate(() => window.MECH.loadPreset('collLab'));
    await page.waitForTimeout(400);
    const hover = await page.evaluate((eid) => {
      const M = window.MECH;
      const e = M.doc().entities.find((x) => x.id === eid) || M.doc().entities.find((x) => x.type === 'sphere');
      const t = M.telemetry(e.id);
      const [sx, sy] = M.__vp.screenPosOf(t.pos[0], t.pos[1], t.pos[2]);
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: sx, clientY: sy, bubbles: true }));
      return new Promise((r) => setTimeout(() => r({ hover: M.hoverState().id, eid: e.id }), 200));
    }, id);
    check('hover 三态（悬停未选中体出现 hover 高亮）', hover.hover === hover.eid, `hover=${hover.hover === hover.eid}`);
    await page.evaluate(() => { window.MECH.resetSim(); });
  }

  check('全程无 console 错误/页面异常', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  await page.screenshot({ path: 'shots/p33-final.png' });

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n== 汇总 ==\nPASS ${pass}/${results.length}`);
  if (pass !== results.length) process.exit(1);
} finally {
  await browser.close();
}
