// juice.js — 碰撞反馈（层 3，PL-20..22）：软粒子池 + trauma² 镜头微震 + 碰撞环升级。
// 廉价感红线：粒子不是像素方块直喷——径向渐变软精灵（canvas 生成贴图），速度/重力/拖拽/
// 收缩/淡出全参数化；震屏用 trauma² 曲线（小撞不抖大撞短抖），可一键关。
import * as THREE from 'three';

// FX-507 复用向量（模块级零分配）
const _nrm = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _gold = new THREE.Color(0xd9a441);
const _goldHot = new THREE.Color(0xfff0d0);

const P_MAX = 320;             // 粒子池容量（固定，零分配循环）
const RING_POOL = 24;

// FX-590 红线：系统「减弱动态效果」时 JS 侧瞬时 FX（粒子/环/震屏）整体禁发——
// 既有 CSS media 冻结只盖 CSS 动画，这里补 JS 动效层。数据层（轨迹/箭头/读数）不受影响。
export const REDUCED_MOTION = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

// 材质音色 → 粒子观感（与声音三音色同源映射，同一碰撞同一"材质语言"）。
// 加法混合下「颜色即亮度」：尘雾系必须用中亮暖色才在暗背景可感；贴地系低 up 短滞空。
const TINT = {
  // 火花：高速四散、亮暖白、短命
  ceramic: { color: 0xffe9b8, n: [10, 20], radial: [1.0, 2.6], up: [0.5, 2.0], life: [0.3, 0.6], fadeExp: 2.0, grav: 6.5 },
  // 木质尘雾：饱和暖棕（调暗保色相——加法混合+无色调映射下亮色会糊白）、贴地翻滚、长命雾感
  wood: { color: 0xb08444, n: [20, 30], radial: [0.3, 1.2], up: [0.2, 0.9], life: [0.8, 1.25], fadeExp: 1.0, grav: 4.0 },
  // 橡胶闷噗：低速小尘、暖灰、几乎不离地、较快沉降
  rubber: { color: 0x9a8b7a, n: [9, 16], radial: [0.15, 0.6], up: [0.1, 0.4], life: [0.5, 0.85], fadeExp: 1.3, grav: 3.5 },
};

function makeSoftTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  // 中心 0.72 起（全亮核心会在加法混合下饱和成白——终审教训），软边出雾感
  const grad = g.createRadialGradient(32, 32, 3, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,0.72)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.42)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class JuiceFX {
  constructor(scene) {
    this.scene = scene;
    this.on = true;            // 总开关（震屏+粒子同属"碰撞反馈"，分别可关见 setShake）
    this.shakeOn = true;
    try { this.shakeOn = localStorage.getItem('mech.shake') !== '0'; } catch (e) { /* 默认开 */ }
    this.trauma = 0;           // 0..1，震屏能量（decay 1.4/s，shake=trauma²）
    this.spawnedTotal = 0;

    // ---- 粒子池：Points + 预分配属性，按 alive 段落回收 ----
    this._pos = new Float32Array(P_MAX * 3);
    this._vel = new Float32Array(P_MAX * 3);
    this._age = new Float32Array(P_MAX);      // >=0 存活秒数，-1=死
    this._life = new Float32Array(P_MAX);
    this._fadeExp = new Float32Array(P_MAX);  // 每粒子淡出指数（材质衰减曲线）
    const col = new Float32Array(P_MAX * 3);
    this._baseCol = new Float32Array(P_MAX * 3);   // 粒子基色（spawn 时写，淡出乘 f²）
    for (let i = 0; i < P_MAX; i++) { this._age[i] = -1; col[i * 3] = 1; col[i * 3 + 1] = 1; col[i * 3 + 2] = 1; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setDrawRange(0, 0);
    this._pgeo = geo;
    this._pcol = col;
    const mat = new THREE.PointsMaterial({
      size: 0.13, map: makeSoftTexture(), vertexColors: true, transparent: true,
      opacity: 0.85, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    // ACES 会把加法混合的亮粒子滚降成白色（色相被裁——wood 终审教训），粒子绕过色调映射；
    // depthTest 关闭：尘雾像烟一样穿读（球体遮挡会让撞击点正下方尘雾 2/3 不可见——终审教训）
    mat.toneMapped = false;
    this._pmat = mat;
    this._points = new THREE.Points(geo, mat);
    this._points.frustumCulled = false;
    this._points.visible = false;
    this._points.renderOrder = 20;   // 叠加层之上（尘雾穿读语义）
    scene.add(this._points);
    this._cursor = 0;           // 环形分配

    // ---- 碰撞环池（升级版：闪光芯 + 外环两段淡出） ----
    this._rings = [];
    this._ringPool = [];
    this._ringGeo = new THREE.RingGeometry(0.42, 0.5, 48);
    this._flashGeo = new THREE.CircleGeometry(0.16, 32);
  }

  setShake(on) {
    this.shakeOn = !!on;
    try { localStorage.setItem('mech.shake', on ? '1' : '0'); } catch (e) { /* 忽略 */ }
  }

  // 场景重建时清空瞬时 FX 与计数（spawnedTotal 跨场景累积会让回归等待条件秒过——评审教训）
  clear() {
    this._age.fill(-1);
    this._points.visible = false;
    for (const g of this._rings) {
      this.scene.remove(g.ring);
      this.scene.remove(g.flash);
      this._ringPool.push(g);
    }
    this._rings.length = 0;
    this.trauma = 0;
    this.spawnedTotal = 0;
  }

  // 碰撞入参：pos[3]（世界）、strength 0..1（与声音同源的冲量标度）、timbre（材质音色键）
  spawnImpact(pos, strength, timbre) {
    if (!this.on || REDUCED_MOTION || strength < 0.03) return;
    const T = TINT[timbre] || TINT.ceramic;
    const n = Math.round(T.n[0] + (T.n[1] - T.n[0]) * Math.min(1, strength));
    const c = new THREE.Color(T.color);
    for (let k = 0; k < n; k++) {
      const i = this._cursor;
      this._cursor = (this._cursor + 1) % P_MAX;
      const a = Math.random() * Math.PI * 2;
      const r01 = Math.random();
      // 环形偏移出生（0.05~0.2m）：正下方出生会被球体遮住——终审取证 2/3 粒子不可见的根因
      const ringR = 0.05 + Math.random() * 0.15;
      this._pos[i * 3] = pos[0] + Math.cos(a) * ringR;
      this._pos[i * 3 + 1] = pos[1] + 0.02 + Math.random() * 0.03;
      this._pos[i * 3 + 2] = pos[2] + Math.sin(a) * ringR;
      const radial = T.radial[0] + (T.radial[1] - T.radial[0]) * r01 * (0.5 + strength * 0.7);
      this._vel[i * 3] = Math.cos(a) * radial;
      this._vel[i * 3 + 1] = T.up[0] + (T.up[1] - T.up[0]) * Math.random() * (0.5 + strength * 0.7);
      this._vel[i * 3 + 2] = Math.sin(a) * radial;
      this._age[i] = 0;
      this._life[i] = T.life[0] + Math.random() * (T.life[1] - T.life[0]);
      this._fadeExp[i] = T.fadeExp;
      this._baseCol[i * 3] = c.r; this._baseCol[i * 3 + 1] = c.g; this._baseCol[i * 3 + 2] = c.b;
      this._pcol[i * 3] = c.r; this._pcol[i * 3 + 1] = c.g; this._pcol[i * 3 + 2] = c.b;
    }
    this.spawnedTotal += n;
    if (this.shakeOn && strength > 0.12) this.trauma = Math.min(1, this.trauma + strength * 0.45);
  }

  tick(dt) {
    // freezeAt：诊断时钟（样张取证用）——冻结粒子演化，画面停在指定相位
    if (this.freezeAt != null) return;
    // 粒子演化（重力 + 线性拖拽 + 淡出收缩），写回预分配属性
    let alive = 0;
    if (dt > 0) {
      for (let i = 0; i < P_MAX; i++) {
        if (this._age[i] < 0) continue;
        this._age[i] += dt;
        if (this._age[i] >= this._life[i]) { this._age[i] = -1; this._pcol[i * 3] = 0; this._pcol[i * 3 + 1] = 0; this._pcol[i * 3 + 2] = 0; continue; }
        const drag = 1 - 2.2 * dt;
        this._vel[i * 3] *= drag;
        this._vel[i * 3 + 2] *= drag;
        this._vel[i * 3 + 1] = this._vel[i * 3 + 1] * drag - 6.5 * dt;   // 重力（比世界 g 柔，尘雾感）
        this._pos[i * 3] += this._vel[i * 3] * dt;
        this._pos[i * 3 + 1] += this._vel[i * 3 + 1] * dt;
        this._pos[i * 3 + 2] += this._vel[i * 3 + 2] * dt;
        alive++;
      }
    }
    this._points.visible = alive > 0;
    if (alive) this._pgeo.setDrawRange(0, P_MAX);
    this._pgeo.attributes.position.needsUpdate = true;
    this._fadeWrite();
    // trauma 衰减
    if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - 1.4 * dt);
  }

  // 淡出写回：基色 × f^fadeExp（加法混合下平滑熄灭；每粒子存自己的衰减指数）
  _fadeWrite() {
    const base = this._baseCol, col = this._pcol;
    for (let i = 0; i < P_MAX; i++) {
      if (this._age[i] < 0) { col[i * 3] = 0; col[i * 3 + 1] = 0; col[i * 3 + 2] = 0; continue; }
      const f = Math.pow(1 - this._age[i] / this._life[i], this._fadeExp[i]);
      col[i * 3] = base[i * 3] * f;
      col[i * 3 + 1] = base[i * 3 + 1] * f;
      col[i * 3 + 2] = base[i * 3 + 2] * f;
    }
    this._pgeo.attributes.color.needsUpdate = true;
  }

  // ---- 镜头微震：渲染前叠加、渲染后还原（不污染 controls 状态） ----
  _savedPos = null;
  _savedRoll = 0;
  applyShake(camera, now) {
    if (!this.shakeOn || REDUCED_MOTION || this.trauma <= 0.001) return false;
    const s = this.trauma * this.trauma;
    if (!this._savedPos) this._savedPos = new THREE.Vector3();
    this._savedPos.copy(camera.position);
    this._savedRoll = camera.rotation.z;
    // FX-528 震频分级：大撞低频大幅（闷锤）、小撞高频小幅（碎碰），trauma 作强度代理查表
    const freq = this.trauma > 0.55 ? 22 : this.trauma > 0.3 ? 40 : 60;
    const t = now * freq;    // 高频抖动种子
    const mag = 0.055 * s;
    camera.position.x += Math.sin(t * 1.1) * mag;
    camera.position.y += Math.sin(t * 1.7 + 1.3) * mag * 0.7;
    camera.position.z += Math.cos(t * 1.3 + 2.1) * mag;
    // 轻微滚转
    camera.rotation.z += Math.sin(t * 0.9 + 0.7) * 0.004 * s;
    return true;
  }

  revertShake(camera) {
    if (this._savedPos) {
      camera.position.copy(this._savedPos);
      camera.rotation.z = this._savedRoll;
    }
  }

  // ---- 升级碰撞环（PL-22）：闪光芯（150ms 快闪）+ 外环（cubic-out 扩张 0.7s） ----
  // freezeAt：诊断时钟（样张取证）——非 null 时环/闪光/震屏冻结在指定时刻的画面
  freezeAt = null;
  spawnRing(pos, strength, normal) {
    if (REDUCED_MOTION) return;
    let grp = this._ringPool.pop();
    if (!grp) {
      const ring = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({ color: 0xd9a441, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }));
      const flash = new THREE.Mesh(this._flashGeo, new THREE.MeshBasicMaterial({ color: 0xfff3d0, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
      grp = { ring, flash };
    }
    grp.ring.position.set(pos[0], pos[1] + 0.015, pos[2]);
    grp.flash.position.copy(grp.ring.position);
    // FX-507 环贴接触法向：给法向就立起来（墙面碰撞环垂直贴墙），缺省保持地面档
    if (normal && (normal[0] || normal[1] || normal[2])) {
      _nrm.set(normal[0], normal[1], normal[2]).normalize();
      if (_nrm.y < 0.99) {   // 近水平面仍走 rotation.x 档（等价且省一次四元数）
        grp.ring.rotation.set(0, 0, 0);
        grp.ring.quaternion.setFromUnitVectors(_zAxis, _nrm);
        grp.flash.quaternion.copy(grp.ring.quaternion);
      } else {
        grp.ring.rotation.set(-Math.PI / 2, 0, 0);
        grp.flash.rotation.copy(grp.ring.rotation);
      }
    } else {
      grp.ring.rotation.set(-Math.PI / 2, 0, 0);
      grp.flash.rotation.copy(grp.ring.rotation);
    }
    // FX-501 环随冲击缩放+色阶：小撞细环淡金、大撞粗环亮白金
    grp.ring.material.color.copy(_gold).lerp(_goldHot, Math.min(1, strength));
    grp.ring.scale.setScalar(0.25);
    grp.ring.material.opacity = 0.78 * (0.55 + 0.45 * Math.min(1, strength));
    grp.flash.scale.setScalar((0.4 + strength * 0.8) * (0.6 + strength));
    grp.flash.material.opacity = 0.95;
    grp.birth = performance.now() / 1000;
    grp.strength = strength;
    this.scene.add(grp.ring);
    this.scene.add(grp.flash);
    this._rings.push(grp);
  }

  tickRings(now) {
    const t = this.freezeAt != null ? this.freezeAt : now;
    for (let i = this._rings.length - 1; i >= 0; i--) {
      const g = this._rings[i];
      const age = t - g.birth;
      if (age > 0.7) {
        this.scene.remove(g.ring);
        this.scene.remove(g.flash);
        this._ringPool.push(g);
        this._rings.splice(i, 1);
        continue;
      }
      // 外环 cubic-out 扩张（FX-501：终径随冲击放大）+ 淡出（峰值已按 strength 降）
      const k = Math.min(1, age / 0.7);
      const ease = 1 - Math.pow(1 - k, 3);
      g.ring.scale.setScalar((0.25 + ease * (0.9 + g.strength * 1.3)) * (0.6 + g.strength * 0.8));
      g.ring.material.opacity = (0.78 * (0.55 + 0.45 * Math.min(1, g.strength))) * (1 - k);
      // 闪光芯 150ms 快闪
      const fk = Math.min(1, age / 0.15);
      g.flash.material.opacity = 0.95 * (1 - fk) * (1 - fk);
      g.flash.scale.setScalar((0.4 + g.strength * 0.8) * (1 + fk * 1.2));
    }
  }

  state() {
    let alive = 0;
    for (let i = 0; i < P_MAX; i++) if (this._age[i] >= 0) alive++;
    return { alive, spawnedTotal: this.spawnedTotal, trauma: +this.trauma.toFixed(3), shakeOn: this.shakeOn, rings: this._rings.length, reducedMotion: REDUCED_MOTION };
  }

  // 脏门槛快查（每帧调用，禁遍历）：震屏余能/粒子活着/有环 → 必须继续渲染
  needsFrame() {
    return this.trauma > 0.001 || this._points.visible || this._rings.length > 0;
  }
}
