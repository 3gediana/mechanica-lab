// agent-verify.js — Agent 建场自查（AG-V）：静态核对 + 运动探针检测器。
// 纯函数、零依赖（不 import three/Rapier）：workbench 传入建场上下文与探针采样，
// 这里只做判定。findings 统一形状 {sev:'ok'|'warn'|'error', cat, item, msg, repair?}。
// repair: 'lift'=抬出嵌入 | 'restore'=回到题给位置 | 'onramp'=重算坡面落点。
import { ballOnRamp } from './parse-schema.js';

// 斜面 override 参数 → ballOnRamp 需要的坡面几何（registry length=底边、height=高）
export function rampGeomFromParams(params) {
  const base = params.length ?? 2.0;
  const height = params.height ?? base * Math.tan(30 * Math.PI / 180);
  return { base, height, angleDeg: Math.atan2(height, base) * 180 / Math.PI };
}

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ============ 静态核对：建场完成即刻执行 ============
// ctx = {
//   kind: plan.kind,
//   items: [{ id, type, name, params, pos, rotY, isDynamic,
//             given: { position?, velocity? }, planIdx }],
//   ramp: { params } | null,                  // 斜面 override 参数（有斜面时）
//   attaches: [{ type, aName, bName, aPos, bPos, length, restLength }],
// }
export function auditStatic(ctx) {
  const F = [];
  const kind = ctx.kind || '';
  const LAYOUT_KINDS = ['spring', 'hinge', 'atwood', 'rotation'];   // 专用布局重摆位=设计行为，不按题给位置核对
  // 1. 嵌入核对（穿透方向数由 workbench 的 26 向射线算好传入，这里只判数目）
  for (const it of ctx.items) {
    const n = (ctx.penetrations || {})[it.id] || 0;
    if (n > 0) {
      F.push({
        sev: 'error', cat: '静态·嵌入', item: it.name,
        msg: `「${it.name}」与现有物体嵌入（${n} 个方向被埋）——求解器首帧会爆推或卡死`,
        repair: 'lift', id: it.id,
      });
    } else {
      F.push({ sev: 'ok', cat: '静态·嵌入', item: it.name, msg: `「${it.name}」放置干净` });
    }
  }
  // 2. 球-斜面语义核对：球心应满足坡面关系（用户实测过的「球没放在坡上」类缺口）
  const ramp = ctx.ramp && ctx.ramp.params ? rampGeomFromParams(ctx.ramp.params) : null;
  if (ramp) {
    for (const it of ctx.items) {
      if (it.type !== 'sphere' || !it.isDynamic) continue;
      if (LAYOUT_KINDS.includes(kind)) continue;
      const r = it.params.radius ?? 0.15;
      const expected = ballOnRamp(ramp, r);
      const dy = it.pos[1] - expected[1];
      const dxz = Math.hypot(it.pos[0] - expected[0], it.pos[2] - expected[2]);
      if (Math.abs(dy) > 0.10 || dxz > 0.35) {
        F.push({
          sev: it.given.position ? 'warn' : 'error', cat: '静态·斜面', item: it.name,
          msg: `「${it.name}」不在坡面上：预期 y≈${expected[1].toFixed(2)}，实际 y=${it.pos[1].toFixed(2)}（Δ${dy >= 0 ? '+' : ''}${dy.toFixed(2)}m）`,
          repair: 'onramp', id: it.id,
        });
      } else {
        F.push({ sev: 'ok', cat: '静态·斜面', item: it.name, msg: `「${it.name}」在坡面上（Δy=${dy.toFixed(3)}m）` });
      }
    }
  }
  // 3. 题给位置保真（通用布局、无专用布局时）：动体未落在题目要求的位置
  // RP-FIX（地上钉）：题给 y 低于静置高（模型把「从地面」写成球心 y=0）被钳位到贴面后
  // 不算失真——xz 一致且实际 y=静置高即视为落实（世界约定地面 y=0，贴面才是题意）。
  const restHeightOf = (it) => it.type === 'sphere' ? (it.params.radius ?? 0.15)
    : it.type === 'box' ? ((it.params.sy ?? 0.3) / 2)
      : it.type === 'cylinder' ? ((it.params.height ?? 0.3) / 2) : null;
  if (!LAYOUT_KINDS.includes(kind)) {
    for (const it of ctx.items) {
      if (!it.given.position || it.type === 'celestial') continue;
      const d = dist3(it.pos, it.given.position);
      if (d > 0.05) {
        const rh = restHeightOf(it);
        const surfaceClamped = rh != null
          && it.given.position[1] < rh - 0.01
          && Math.abs(it.pos[1] - (rh + 0.005)) < 0.02
          && Math.abs(it.pos[0] - it.given.position[0]) < 0.05
          && Math.abs(it.pos[2] - (it.given.position[2] ?? 0)) < 0.05;
        if (surfaceClamped) {
          F.push({ sev: 'ok', cat: '静态·题给位置', item: it.name, msg: `题给贴面位置已落实（钳位到静置高 y=${it.pos[1].toFixed(3)}）` });
        } else {
          F.push({
            sev: 'error', cat: '静态·题给位置', item: it.name,
            msg: `「${it.name}」未放在题目要求的位置：题给 [${it.given.position.map((v) => +v.toFixed(2)).join(', ')}]，实际 [${it.pos.map((v) => +v.toFixed(2)).join(', ')}]（偏 ${d.toFixed(2)}m）`,
            repair: 'restore', id: it.id,
          });
        }
      } else {
        F.push({ sev: 'ok', cat: '静态·题给位置', item: it.name, msg: `题给位置已落实（偏 ${d.toFixed(3)}m）` });
      }
    }
  }
  // 4. 连接初始状态：绳绷紧/弹簧大拉伸 = 首帧猛拉风险
  for (const at of ctx.attaches || []) {
    const d = dist3(at.aPos, at.bPos);
    if (at.type === 'rope' && at.length != null && d > at.length * 1.05 + 0.01) {   // 1.05=3% 标准松弛出生(AG-V2)+余量,不把正常松弛当绷紧
      F.push({
        sev: 'warn', cat: '静态·连接', item: `${at.aName}↔${at.bName}`,
        msg: `绳初始绷紧：两端距 ${d.toFixed(2)}m > 绳长 ${at.length.toFixed(2)}m，首帧会被猛拉`,
      });
    }
    if (at.type === 'spring' && at.restLength != null && at.restLength > 0.05) {
      const ratio = d / at.restLength;
      if (ratio > 3) {
        F.push({
          sev: 'warn', cat: '静态·连接', item: `${at.aName}↔${at.bName}`,
          msg: `弹簧初始拉伸 ${ratio.toFixed(1)} 倍静长（距 ${d.toFixed(2)}m / 静长 ${at.restLength.toFixed(2)}m），首帧弹力可能过猛`,
        });
      }
    }
  }
  return F;
}

// ============ 运动探针判定：采样序列上找卡死/飞出/NaN/能量爆炸 ============
// probe = {
//   sceneFlags: { hasGround },
//   entities: [{ id, name, isDynamic, gravitating, locked, v0 }],
//   samples: [{ t, states: { [id]: { p:[x,y,z], v:[vx,vy,vz] } } }],
//   ke: [数字…],                       // 与 samples 同频的系统动能
// }
export function auditMotion(probe) {
  const F = [];
  const { samples, ke, entities, sceneFlags } = probe;
  if (!samples.length) return F;
  const hasGround = !!(sceneFlags && sceneFlags.hasGround);
  for (const it of entities) {
    const track = samples.map((s) => s.states[it.id]).filter(Boolean);
    if (!track.length) continue;
    // NaN / 无穷：任何非有限值都是求解器或约束崩坏
    if (track.some((st) => !st.p.every(Number.isFinite) || !st.v.every(Number.isFinite))) {
      F.push({ sev: 'error', cat: '运动·数值', item: it.name, msg: `「${it.name}」出现 NaN/Inf（求解器或约束崩坏）` });
      continue;
    }
    // 飞出场景：侧向出界任何时候都算；竖直下坠只在有地面时算（无地面场景自由落体是合法教学演示）
    const last = track[track.length - 1];
    const outSide = Math.abs(last.p[0]) > 40 || Math.abs(last.p[2]) > 40 || last.p[1] > 60;
    const fell = hasGround && last.p[1] < -25;
    if (outSide || fell) {
      F.push({
        sev: 'error', cat: '运动·出界', item: it.name, id: it.id,
        msg: `「${it.name}」飞出场景：末位置 [${last.p.map((v) => +v.toFixed(1)).join(', ')}]${hasGround ? '' : '（本场景无地面，竖直下坠为合法演化则可忽略）'}`,
      });
      continue;
    }
    // 卡死：预期运动的体全程没动
    const p0 = track[0].p;
    const disp = dist3(p0, last.p);
    const maxV = Math.max(...track.map((st) => Math.hypot(st.v[0], st.v[1], st.v[2])));
    if (it.isDynamic && !it.locked && disp < 0.002 && maxV < 0.01) {
      const mustMove = Math.abs(it.v0 || 0) > 1e-9;
      F.push({
        sev: mustMove ? 'error' : 'warn', cat: '运动·卡滞', item: it.name,
        msg: mustMove
          ? `「${it.name}」题给初速 ${(it.v0).toFixed(2)}m/s 却全程未动（位移 ${disp.toFixed(4)}m）——大概率被卡死/嵌住`
          : `「${it.name}」全程未运动（若该体本应静止可忽略）`,
      });
    }
  }
  // 能量爆炸：动能相邻采样突跳（0.1s 内跳升 >3J 且 >20 倍）= 深嵌入被求解器弹出/发散的典型信号。
  // 不用「相对初值 40 倍」口径——从静止加速的系统（光滑斜面等）KE 合法增长几十倍，会整片误报。
  if (ke && ke.length > 12) {
    for (let i = 1; i < ke.length; i++) {
      if (ke[i] - ke[i - 1] > 3 && ke[i] > 0.05 && ke[i] > 20 * Math.max(ke[i - 1], 1e-6)) {
        F.push({
          sev: 'warn', cat: '运动·能量', item: '系统',
          msg: `系统动能突增（${ke[i - 1].toFixed(2)}J → ${ke[i].toFixed(1)}J，0.1s 内）——多为深嵌入被弹出或参数发散`,
        });
        break;
      }
    }
  }
  return F;
}

export function summarize(findings) {
  const s = { ok: 0, warn: 0, error: 0 };
  for (const f of findings) s[f.sev]++;
  return s;
}

// AG-V3：自查发现 → 模型修订简报（纯函数）。error 全量携带、warn 截前 maxWarn 条——
// 修订提示词里 error 是必须消除的靶子，warn 是参考；全量塞会稀释重点还烧 token。
export function patchBrief(findings, maxWarn = 6) {
  const errs = findings.filter((f) => f.sev === 'error' && !f.skipPatch);
  const warns = findings.filter((f) => f.sev === 'warn').slice(0, maxWarn);
  return [...errs, ...warns].map((f) =>
    `[${f.sev === 'error' ? '错误' : '提醒'}] ${f.cat}·${f.item}: ${f.msg}`
  );
}

// ============ 渲染-物理一致性审计（RP-AUDIT）：不用看图，用数算 ============
// 用户需求原话：「它既然能在前端显示出来，那么你肯定能够通过代码的计算，判断出它
// 在前端实际的表现，以及后端引擎计算出来的表现的一些差异」。
// 事实由 runtime.renderAuditFacts() 产（渲染树/物理体直读），这里纯判定。
// 偏差性质结论（z-devprobe 实测）：引擎固定步长完全确定性（同场景三次重跑轨迹哈希
// 全同），一切偏差都是系统性（结构性代码缺陷），不是随机噪声——所以每条都能按根因修。
//
// facts 形状：
//   t0     = renderAuditFacts()（探针首步前/编辑态：出生跳变 + 编辑态链接摆放）
//   frames = [renderAuditFacts()…]（探针途中定期采样：渲染漂移 + 端点间隙 + 幽灵碰撞）
export function auditRenderPhysics({ t0, frames = [] }, opt = {}) {
  const F = [];
  const spawnTol = opt.spawnTol ?? 0.012;    // 出生位 vs 文档位（扣除合法上抛后）>1.2cm = 跳变
  const meshTol = opt.meshTol ?? 0.002;      // 网格 vs 体 >2mm = 渲染漂移
  const linkTol = opt.linkTol ?? 0.006;      // 链接端点 vs 被连体表面 >6mm = 悬空/深埋
  const ghostTol = opt.ghostTol ?? 0.01;     // dyn 碰撞事件时视觉间隙 >1cm = 幽灵碰撞

  // R1 出生跳变：运行第一瞬间物体从编辑态位置瞬移（含未豁免的 spawnDrop/嵌入弹射）
  if (t0) {
    const jumped = [];
    for (const b of t0.bodies) {
      if (b.docDelta == null) continue;
      const excess = Math.abs(b.docDelta - (b.spawnLift || 0));
      if (excess > spawnTol) jumped.push({ name: b.name, d: b.docDelta, lift: b.spawnLift || 0 });
    }
    if (jumped.length) {
      F.push({
        sev: 'error', cat: '渲染·出生', item: jumped.map((j) => j.name).join('、'), ids: [],
        msg: `${jumped.map((j) => `「${j.name}」`).join('')}运行瞬间从编辑态位置跳变（最大偏 ${Math.max(...jumped.map((j) => j.d)).toFixed(3)}m）——画面第一步就与编辑态不一致`,
        repair: 'restore', skipPatch: true,
      });
    } else {
      F.push({ sev: 'ok', cat: '渲染·出生', item: '出生位姿', msg: '运行动画首帧与编辑态一致（无出生跳变）' });
    }
  }

  // R2 渲染漂移：网格必须逐步贴着物理体（>2mm 即渲染与物理分叉）
  let worstMesh = null;
  for (const fr of frames) {
    for (const b of fr.bodies) {
      if (b.delta == null) continue;
      if (!worstMesh || b.delta > worstMesh.delta) worstMesh = { name: b.name, delta: b.delta, t: fr.t };
    }
  }
  if (worstMesh && worstMesh.delta > meshTol) {
    F.push({
      sev: 'error', cat: '渲染·漂移', item: worstMesh.name, skipPatch: true,
      msg: `「${worstMesh.name}」网格与物理体位置分叉 ${worstMesh.delta.toFixed(4)}m（t=${worstMesh.t.toFixed(2)}s）——画面里它不在引擎算出的位置`,
    });
  } else if (worstMesh) {
    F.push({ sev: 'ok', cat: '渲染·漂移', item: '网格跟随', msg: `全程网格贴合物理体（最大偏差 ${(worstMesh.delta * 1000).toFixed(1)}mm）` });
  }

  // R3/R4 链接件：弹簧/绳端点必须贴在被连体表面（悬空=「凭空一段空气」，深埋=穿模）
  let worstLink = null, invisible = [];
  const allFrames = t0 ? [t0, ...frames] : frames;
  for (const fr of allFrames) {
    for (const l of fr.links) {
      if (l.visible === false) { if (!invisible.includes(l.name)) invisible.push(l.name); continue; }
      const g = Math.max(l.gapA ?? 0, l.gapB ?? 0);
      if (worstLink == null || g > worstLink.g) worstLink = { name: l.name, type: l.type, g, side: (l.gapA ?? 0) >= (l.gapB ?? 0) ? l.aName : l.bName, t: fr.t };
    }
  }
  if (invisible.length) {
    F.push({
      sev: 'error', cat: '渲染·连接件', item: invisible.join('、'), skipPatch: true,
      msg: `${invisible.map((n) => `「${n}」`).join('')}不可见——绳/弹簧在画面里消失`,
    });
  }
  if (worstLink && worstLink.g > linkTol) {
    F.push({
      sev: 'error', cat: '渲染·连接件', item: worstLink.name, skipPatch: true,
      msg: `「${worstLink.name}」端点没贴上「${worstLink.side}」（最大间隙 ${(worstLink.g * 100).toFixed(1)}cm，t=${worstLink.t.toFixed(2)}s）——画面里${worstLink.type === 'rope' ? '绳' : '弹簧'}与物体之间有空隙或穿模`,
    });
  } else if (worstLink) {
    F.push({ sev: 'ok', cat: '渲染·连接件', item: '端点贴合', msg: `弹簧/绳端点全程贴住被连体表面（最大偏差 ${((worstLink.g || 0) * 1000).toFixed(1)}mm）` });
  }

  // R5 幽灵碰撞：两动态体碰撞事件发生时，画面上两物体表面必须有接触。
  // 余量=推测接触（speculative contact）物理前移量 rel·h + 常规容差——Rapier 会在
  // 接触面前最多一步位移处提前触发事件，这是引擎语义不是渲染漂移，放行。
  // 骑行/连续接触对（转台滑块等）的接触反复启停是求解器抖动，同一对 1s 内的重复
  // 接触事件不做幽灵判定（首次接触才是真正的「撞上没」时刻）。
  let ghost = null, nEv = 0;
  const h = (frames[0] && frames[0].h) || (t0 && t0.h) || 1 / 120;
  const evAll = [];
  for (const fr of frames) for (const ev of fr.events) { nEv++; evAll.push(ev); }
  evAll.sort((x, y) => x.t - y.t);
  const lastT = new Map();
  for (const ev of evAll) {
    const key = [ev.a, ev.b].sort().join('§');
    const prev = lastT.get(key);
    lastT.set(key, ev.t);
    if (prev != null && ev.t - prev < 1.0) continue;   // 骑行重启：非首次接触，跳过幽灵判定
    const excess = ev.visualGap - (ev.rel || 0) * h - ghostTol;
    if (ghost == null || excess > ghost.excess) ghost = { ...ev, excess };
  }
  if (ghost && ghost.excess > 0) {
    F.push({
      sev: 'error', cat: '渲染·碰撞', item: `${ghost.a}↔${ghost.b}`, skipPatch: true,
      msg: `「${ghost.a}」与「${ghost.b}」碰撞事件触发时画面上还隔着 ${(ghost.visualGap * 100).toFixed(1)}cm（t=${ghost.t.toFixed(2)}s，已扣除一步推测接触余量）——看得见的没撞上却弹开了`,
    });
  } else if (nEv) {
    F.push({ sev: 'ok', cat: '渲染·碰撞', item: '碰撞可见性', msg: `${nEv} 次物体间碰撞全部发生在画面上看得见的接触（最大视觉间隙 ${nEv && ghost ? (ghost.visualGap * 1000).toFixed(1) : 0}mm）` });
  }
  return F;
}

// ============ 视觉自检（R7-B1）：p49 四类探针移植进应用本体 ============
// 三轮用户实锤（球穿轮飞出画框/绳不可见/滑轮躺平）全发生在「用户看得见」的层，
// 物理/断言层全绿证明不了用户看到的东西对。采样在 workbench（相机投影/渲染像素
// 统计/网格清点是页内事），判定在这里——纯函数可单测。阈值与 p49-visual-audit 同源：
// NDC 裕度 1.35 / 灰度 mean>4 且亮像素≥50@320×180。

// V1 出画：动态体 NDC 轨迹越限。skipIds=已被「运动·出界」定罪的体——世界级飞出的
// 场景谈取景没有意义，同一问题不重复定罪（p37 C 计数依赖这条去重）。
export function auditVisualNdc({ tracks, skipIds = [], limit = 1.35 }) {
  const bad = [];
  for (const tr of tracks) {
    if (!tr.pts || !tr.pts.length || skipIds.includes(tr.id)) continue;
    let worst = null;
    for (const p of tr.pts) {
      const m = Math.max(Math.abs(p[0]), Math.abs(p[1]));
      if (m > limit && (!worst || m > worst.m)) worst = { m };
    }
    if (worst) bad.push({ id: tr.id, name: tr.name, m: worst.m });
  }
  if (bad.length) {
    return [{
      sev: 'error', cat: '视觉·出画', item: bad.map((b) => b.name).join('、'), ids: bad.map((b) => b.id),
      msg: `${bad.map((b) => `「${b.name}」`).join('')}运行中离开取景框（NDC 最远 ${Math.max(...bad.map((b) => b.m)).toFixed(2)}，阈值 ${limit}）——关键过程观众看不到`,
      repair: 'reframe',
    }];
  }
  return [{ sev: 'ok', cat: '视觉·出画', item: '取景', msg: '动态体全程在取景框内' }];
}

// V2 可视化覆盖：实体必有可见网格；滑轮绳对必有跨绳可视化（R6-036 实锤类）。
// skipPatch：网格缺失是渲染层问题，回喂模型修订救不了（白烧一轮 key）。
export function auditVisualCoverage({ bodies, ropeSegs = 0, hasPulleyPair = false }) {
  const F = [];
  const noMesh = bodies.filter((b) => !b.hasMesh);
  if (noMesh.length) {
    F.push({
      sev: 'error', cat: '视觉·网格', item: '实体网格', ids: noMesh.map((b) => b.id),
      msg: `${noMesh.map((b) => `「${b.name}」`).join('')}没有可见网格——画面里完全看不到`, skipPatch: true,
    });
  }
  if (hasPulleyPair && ropeSegs < 1) {
    F.push({
      sev: 'error', cat: '视觉·绳', item: '滑轮跨绳', skipPatch: true,
      msg: '滑轮场景没有跨绳可视化（孤轮+双球视觉悬浮，R6-036 实锤类）',
    });
  }
  if (!F.length) {
    F.push({
      sev: 'ok', cat: '视觉·覆盖', item: '可视化',
      msg: `全部 ${bodies.length} 个实体有可见网格${hasPulleyPair ? `，跨绳 ${ropeSegs} 段` : ''}`,
    });
  }
  return F;
}

// V3 画面非退化：建场定格帧 t0（修理入口）与探针末帧 tEnd（只提醒——末帧退化多与
// 出画/出界同源，重取景救不了离场）。stats={mean, bright}。
// 实测校准（atwood 场景）：环境球柔光条在任何距离贡献 ~81 亮像素——mean/bright 阈值
// 只能抓「渲染全黑」，抓不到「相机过远主体芝麻」。主体芝麻由 V3b 份额探针负责。
export function auditVisualFrame({ t0, tEnd = null }) {
  const F = [];
  const degenerate = (s) => !s || s.mean <= 4 || s.bright < 50;
  if (degenerate(t0)) {
    F.push({
      sev: 'error', cat: '视觉·画面', item: '建场定格帧',
      msg: `画面退化（灰度 mean=${t0 ? t0.mean : '—'} 亮像素=${t0 ? t0.bright : '—'}，阈值 4/50）——主体可能小成芝麻或全黑`,
      repair: 'tightframe',
    });
  } else {
    F.push({ sev: 'ok', cat: '视觉·画面', item: '建场定格帧', msg: `画面可读（mean=${t0.mean}，亮像素 ${t0.bright}）` });
  }
  if (tEnd && degenerate(tEnd) && !degenerate(t0)) {
    F.push({ sev: 'warn', cat: '视觉·画面', item: '探针末帧', msg: '运行末帧画面退化（动态体可能已离场）——见出画/出界条目' });
  }
  return F;
}

// V3b 主体份额（⑨类主判据）：动态轨迹 NDC 外接框对角线 / 全画布 NDC 对角线（2√2）。
// 被无关大物（超大地板/大道具）挤压、或相机拉到百米外，主体份额趋零；而宽抛体这类
// 「轨迹本身撑满画面」的合法宽取景份额天然大——不误伤。实测：atwood 正常 22%、
// 宽抛体 47%、故障态（260m 远/40m 巨道具）≤3%。
export function auditVisualSubject({ tracks, minRatio = 0.08 }) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, any = false;
  for (const tr of tracks) {
    for (const p of (tr.pts || [])) {
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
      any = true;
    }
  }
  if (!any) return [{ sev: 'ok', cat: '视觉·主体', item: '主体可读性', msg: '无动态轨迹（静态场景不查主体份额）' }];
  const ratio = Math.hypot(maxX - minX, maxY - minY) / (2 * Math.SQRT2);
  if (ratio < minRatio) {
    return [{
      sev: 'error', cat: '视觉·主体', item: '主体可读性', repair: 'tightframe', skipPatch: true,
      msg: `动态主体仅占画面 ${(ratio * 100).toFixed(1)}%（阈值 ${minRatio * 100}%）——取景被无关大物挤压或相机过远，主体小成芝麻`,
    }];
  }
  return [{ sev: 'ok', cat: '视觉·主体', item: '主体可读性', msg: `主体画面份额 ${(ratio * 100).toFixed(0)}%` }];
}

// V4 物理粗对账（观察量 vs 理论量级）：解释器不支持的题型兜底，30% 量级口径。
// 拟合：跳过前 skipT 秒（求解器安定/绳松弛绷紧段），速度序列线性回归斜率=加速度。
export function fitAccel(samples, id, axis = 1, skipT = 0.2) {
  let n = 0, st = 0, sv = 0, stt = 0, stv = 0;
  for (const s of samples) {
    const e = s.states[id];
    if (!e || s.t < skipT) continue;
    const v = e.v[axis];
    st += s.t; sv += v; stt += s.t * s.t; stv += s.t * v; n++;
  }
  if (n < 4) return null;
  const d = n * stt - st * st;
  if (Math.abs(d) < 1e-9) return null;
  return (n * stv - st * sv) / d;
}

// docInfo = { g, topology: 'atwoodLike'|'freefallLike'|null, masses: { [id]: m }, pairIds: [idA, idB] }
export function auditPhysicsCoarse({ samples, docInfo }) {
  const topo = docInfo && docInfo.topology;
  if (!topo) return null;
  const g = Math.abs(docInfo.g || 9.81);
  if (topo === 'atwoodLike') {
    const [ia, ib] = docInfo.pairIds || [];
    const m1 = docInfo.masses[ia], m2 = docInfo.masses[ib];
    if (m1 == null || m2 == null) return null;
    const aExp = Math.abs((m1 - m2) * g / (m1 + m2));
    if (aExp < 0.05) return { sev: 'ok', cat: '物理·粗对账', item: '连接体', msg: `两侧质量接近平衡（理论 a≈0），无可对账的量级` };
    const fa = fitAccel(samples, ia), fb = fitAccel(samples, ib);
    if (fa == null || fb == null) return null;
    // 两侧同绳同加速度：取量级均值对账（方向一升一降）
    const aObs = (Math.abs(fa) + Math.abs(fb)) / 2;
    const dev = Math.abs(aObs - aExp) / aExp;
    if (dev > 0.3) {
      return {
        sev: 'error', cat: '物理·粗对账', item: '连接体',
        msg: `实测加速度 ${aObs.toFixed(2)} m/s² 与理论 (m₁−m₂)g/(m₁+m₂)=${aExp.toFixed(2)} m/s² 偏差 ${(dev * 100).toFixed(0)}%（>30%）——建场参数可能与题意有出入`,
      };
    }
    return { sev: 'ok', cat: '物理·粗对账', item: '连接体', msg: `量级吻合：实测 a≈${aObs.toFixed(2)}，理论 ${aExp.toFixed(2)} m/s²（偏差 ${(dev * 100).toFixed(0)}%）` };
  }
  if (topo === 'freefallLike') {
    const id = (docInfo.pairIds || [])[0];
    if (id == null) return null;
    const a = fitAccel(samples, id);
    if (a == null) return null;
    const dev = Math.abs(Math.abs(a) - g) / g;
    if (dev > 0.3) {
      return {
        sev: 'error', cat: '物理·粗对账', item: '自由落体',
        msg: `实测竖直加速度 ${Math.abs(a).toFixed(2)} m/s² 与重力 g=${g.toFixed(2)} 偏差 ${(dev * 100).toFixed(0)}%（>30%）`,
      };
    }
    return { sev: 'ok', cat: '物理·粗对账', item: '自由落体', msg: `量级吻合：|a|≈${Math.abs(a).toFixed(2)} ≈ g=${g.toFixed(2)} m/s²` };
  }
  return null;
}
