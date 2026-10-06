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
  if (!LAYOUT_KINDS.includes(kind)) {
    for (const it of ctx.items) {
      if (!it.given.position || it.type === 'celestial') continue;
      const d = dist3(it.pos, it.given.position);
      if (d > 0.05) {
        F.push({
          sev: 'error', cat: '静态·题给位置', item: it.name,
          msg: `「${it.name}」未放在题目要求的位置：题给 [${it.given.position.map((v) => +v.toFixed(2)).join(', ')}]，实际 [${it.pos.map((v) => +v.toFixed(2)).join(', ')}]（偏 ${d.toFixed(2)}m）`,
          repair: 'restore', id: it.id,
        });
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
        sev: 'error', cat: '运动·出界', item: it.name,
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
