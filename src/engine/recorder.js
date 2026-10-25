// recorder.js — 内置录屏（REC）：主视口 WebGL 画布逐帧合成到离屏 2D 画布，
// 叠加 REC 计时徽标、Agent 阶段字幕与原题图角标（PiP），MediaRecorder 编码 WebM。
// 设计口径：录「演示过程」而非裸视口——看视频的人不知道 DOM 面板长什么样，
// 字幕+题图角标让一段 3D 画面自带「谁在解析、搭了什么、原题是什么」的叙事。
// 帧源约定：主渲染器 preserveDrawingBuffer=true（viewport.js 同款开关），任意时刻 drawImage 均非黑帧。

const S = {
  active: false, src: null, cv: null, ctx: null,
  rec: null, chunks: [], t0: 0, stream: null,
  caption: '', captionT: 0, pipImg: null,
};

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

// 字幕超龄淡出：5s 内全显，5~6s 线性退场（新字幕随时覆盖）
function captionAlpha(now) {
  const age = (now - S.captionT) / 1000;
  if (age < 5) return 1;
  if (age < 6) return 1 - (age - 5);
  return 0;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export const recorder = {
  get active() { return S.active; },
  get elapsed() { return S.active ? (performance.now() - S.t0) / 1000 : 0; },

  start(srcCanvas) {
    if (S.active) return { ok: false, reason: 'busy' };
    const mime = pickMime();
    if (!mime) return { ok: false, reason: 'unsupported' };
    S.src = srcCanvas;
    S.cv = document.createElement('canvas');
    S.cv.width = srcCanvas.width || 1280;
    S.cv.height = srcCanvas.height || 720;
    S.ctx = S.cv.getContext('2d');
    S.chunks = [];
    S.stream = S.cv.captureStream(30);
    try {
      S.rec = new MediaRecorder(S.stream, { mimeType: mime, videoBitsPerSecond: 2800000 });
    } catch {
      return { ok: false, reason: 'unsupported' };
    }
    S.rec.ondataavailable = (e) => { if (e.data && e.data.size) S.chunks.push(e.data); };
    S.rec.start(500);
    S.t0 = performance.now();
    S.active = true;
    return { ok: true, mime };
  },

  stop() {
    return new Promise((resolve) => {
      if (!S.active || !S.rec) { S.active = false; return resolve(null); }
      S.rec.onstop = () => {
        const blob = new Blob(S.chunks, { type: 'video/webm' });
        S.active = false;
        resolve(blob);
      };
      S.rec.stop();
    });
  },

  caption(text) {
    if (!text) return;
    S.caption = String(text);
    S.captionT = performance.now();
  },

  // 原题图角标：Agent 面板上传/拍照时挂上，换场景时摘掉
  setPip(dataUrl) {
    S.pipImg = null;
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => { S.pipImg = img; };
    img.src = dataUrl;
  },

  // tick 每帧调（workbench 渲染后）：合成 + 叠加层；未录制时零开销早退
  frame() {
    if (!S.active || !S.ctx || !S.src) return;
    const { ctx, src, cv } = S;
    if (cv.width !== src.width || cv.height !== src.height) {
      cv.width = src.width;
      cv.height = src.height;
    }
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
    const s = Math.max(0.6, cv.height / 720);           // 以 720p 为基准的缩放系数
    const now = performance.now();
    const pad = 14 * s;

    // REC 徽标（左上）：呼吸红点 + 计时
    const sec = Math.floor((now - S.t0) / 1000);
    const label = `REC ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    ctx.font = `600 ${Math.round(15 * s)}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    const tw = ctx.measureText(label).width;
    const bw = tw + 34 * s, bh = 26 * s;
    ctx.fillStyle = 'rgba(10,11,13,.74)';
    roundRect(ctx, pad, pad, bw, bh, 6 * s);
    ctx.fill();
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin((now - S.t0) / 280));
    ctx.fillStyle = `rgba(229,72,77,${pulse.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(pad + 15 * s, pad + bh / 2, 5.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2f4f6';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, pad + 26 * s, pad + bh / 2 + 1);

    // 原题图角标（右上）：白描边小窗，演示时观众随时对照「搭得对不对」
    if (S.pipImg) {
      const maxW = cv.width * 0.24, maxH = cv.height * 0.30;
      let w = maxW, h = (S.pipImg.height / S.pipImg.width) * w;
      if (h > maxH) { h = maxH; w = (S.pipImg.width / S.pipImg.height) * h; }
      const px = cv.width - pad - w, py = pad;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.5)';
      ctx.shadowBlur = 12 * s;
      ctx.fillStyle = 'rgba(24,26,30,.9)';
      ctx.fillRect(px, py, w, h);
      ctx.restore();
      const ir = Math.min(w / S.pipImg.width, h / S.pipImg.height);
      const iw = S.pipImg.width * ir, ih = S.pipImg.height * ir;
      ctx.drawImage(S.pipImg, px + (w - iw) / 2, py + (h - ih) / 2, iw, ih);
      ctx.strokeStyle = 'rgba(242,244,246,.85)';
      ctx.lineWidth = Math.max(1.5, 2 * s);
      ctx.strokeRect(px, py, w, h);
    }

    // Agent 字幕（左下）：最新一条状态，5s 后淡出
    const a = captionAlpha(now);
    if (S.caption && a > 0.01) {
      ctx.font = `${Math.round(14.5 * s)}px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif`;
      const cw = Math.min(ctx.measureText(S.caption).width + 22 * s, cv.width * 0.8);
      const ch2 = 26 * s;
      const cy = cv.height - pad - ch2;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(10,11,13,.74)';
      roundRect(ctx, pad, cy, cw, ch2, 6 * s);
      ctx.fill();
      ctx.fillStyle = '#e8ebef';
      ctx.fillText(S.caption, pad + 11 * s, cy + ch2 / 2 + 1, cv.width * 0.8 - 22 * s);
      ctx.globalAlpha = 1;
    }

    // 右下角标（弱）：出处水印
    ctx.font = `${Math.round(12 * s)}px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(242,244,246,.34)';
    const wt = 'MECHANICA · 物理教学沙盘';
    ctx.fillText(wt, cv.width - pad - ctx.measureText(wt).width, cv.height - pad - 6 * s);
    ctx.textBaseline = 'alphabetic';
  },

  saveBlob(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const t = new Date(), p = (n) => String(n).padStart(2, '0');
    a.href = url;
    a.download = `mechanica-${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return a.download;
  },
};
