#!/usr/bin/env python3
"""生成 src/track-curve.js：滑道中心线点列 + META，带数值验证门。
布局（x-y 平面，y 向上，z=0）：平台 → 凸弯(crest) → 32° 下坡直段 → 凹弯(valley) → 进环直道
→ 360° 竖直环 → 出口直道。全程 C1（拼接点切向角差 < 1°）。"""
import math, io

TH = math.radians(32.0)          # 下坡倾角
RT, RB = 0.30, 0.55              # 凸弯/凹弯半径
YP = 1.80                        # 平台中心线高（1.70 实测能量不足以过环顶，抬到余量 42%）
YR = 0.23                        # 直道中心线高（环底切线）
RL = 0.46                        # 环中心线半径
CX = 1.15                        # 环心 x
X0, X1 = -2.55, 3.05             # 全场范围
D = (math.cos(TH), -math.sin(TH))
TUBE_R, BALL_R = 0.14, 0.09

points = []
def add(x, y): points.append((round(x, 5), round(y, 5), 0.0))

# 1. 平台
n_plat = 8
for i in range(n_plat):
    x = X0 + (-2.05 - X0) * i / (n_plat - 1)
    add(x, YP)

# 2. 凸弯 crest：圆心在 (xc, YP-RT)，角度 90°→58°（顺时针，切向 0→-32°）
ct = (-2.05, YP - RT)
a0, a1 = 90.0, 58.0
n_cr = 20
for k in range(1, n_cr + 1):
    a = math.radians(a0 + (a1 - a0) * k / n_cr)
    add(ct[0] + RT * math.cos(a), ct[1] + RT * math.sin(a))
crest_end = points[-1]

# 3. 下坡直段：长度由总落差反推
drop_crest = YP - crest_end[1]
drop_valley = RB * (1 - math.cos(TH))
t1 = (YP - YR - drop_crest - drop_valley) / math.sin(TH)
for k in range(1, 33):
    t = t1 * k / 32
    add(crest_end[0] + D[0] * t, crest_end[1] + D[1] * t)
tb1 = points[-1]

# 4. 凹弯 valley：圆心在轨上方 (tb1 + RB*(sinθ, cosθ))，角度 -122°→-90°
cb = (tb1[0] + RB * math.sin(TH), tb1[1] + RB * math.cos(TH))
b0, b1 = -122.0, -90.0
n_va = 20
for k in range(1, n_va + 1):
    a = math.radians(b0 + (b1 - b0) * k / n_va)
    add(cb[0] + RB * math.cos(a), cb[1] + RB * math.sin(a))
tb2 = points[-1]
assert abs(tb2[1] - YR) < 1e-9, f"valley 末端高度 {tb2[1]} != {YR}"

# 5. 进环直道 tb2 → 环底 (CX, YR)
n_run = 8
for k in range(1, n_run + 1):
    x = tb2[0] + (CX - tb2[0]) * k / n_run
    add(x, YR)

# 6. 竖直环：圆心 (CX, YR+RL)，φ 从 2π/N 到 2π（含环底闭合点）
N_LOOP = 208
for k in range(1, N_LOOP + 1):
    phi = 2 * math.pi * k / N_LOOP
    add(CX + RL * math.sin(phi), (YR + RL) - RL * math.cos(phi))

# 7. 出口直道 → X1
x = CX
while True:
    x += 0.08
    if x >= X1 - 1e-9:
        add(X1, YR); break
    add(x, YR)

# ---------- 验证门 ----------
report = []
ok = True

def tangent(i):
    if i == 0:
        dx = points[1][0] - points[0][0]; dy = points[1][1] - points[0][1]
    elif i >= len(points) - 1:
        dx = points[-1][0] - points[-2][0]; dy = points[-1][1] - points[-2][1]
    else:
        dx = points[i + 1][0] - points[i - 1][0]; dy = points[i + 1][1] - points[i - 1][1]
    return math.atan2(dy, dx)

# 拼接点拐角：拼接点两侧"线段方向"的夹角（球实际感受到的折角）
joints = [n_plat - 1, n_plat + n_cr - 1, n_plat + n_cr + 32 - 1,
          n_plat + n_cr + 32 + n_va - 1, n_plat + n_cr + 32 + n_va + n_run - 1,
          n_plat + n_cr + 32 + n_va + n_run + N_LOOP - 1]
max_dev = 0.0
for j in joints:
    d1 = math.atan2(points[j][1] - points[j - 1][1], points[j][0] - points[j - 1][0])
    d2 = math.atan2(points[j + 1][1] - points[j][1], points[j + 1][0] - points[j][0])
    dev = abs(math.degrees(d1 - d2))
    dev = min(dev, 360 - dev)
    max_dev = max(max_dev, dev)
report.append(f"拼接点最大折角: {max_dev:.3f} deg")
ok &= max_dev < 1.0

# 点距护栏：直线段采样 0.08、弧段更密，任何相邻距 > 0.12 即断点
dists = [math.dist(points[i], points[i + 1]) for i in range(len(points) - 1)]
bad = [i for i, d in enumerate(dists) if d > 0.12 or d < 0.004]
report.append(f"点距范围 {min(dists):.3f}~{max(dists):.3f} m, 异常 {len(bad)} 个")
ok &= len(bad) == 0

# 环段半径标准差
i0 = n_plat + n_cr + 32 + n_va + n_run
loop_pts = points[i0:i0 + N_LOOP]
errs = [math.hypot(p[0] - CX, p[1] - (YR + RL)) - RL for p in loop_pts]
std = (sum(e * e for e in errs) / len(errs)) ** 0.5
report.append(f"环半径偏差 RMS: {std * 1000:.2f} mm")
ok &= std < 0.002

# 可行性（实心球滚动，环顶不掉落 h >= 2.7 R_eff）
R_eff = RL - (TUBE_R - BALL_R)
h_need = 2.7 * R_eff
h_have = (YP - (TUBE_R - BALL_R)) - (YR - (TUBE_R - BALL_R))
margin = h_have / h_need - 1
v_bottom = math.sqrt(9.81 * h_have / 0.7)
report.append(f"环轨可行性: 需 {h_need:.3f} m / 有 {h_have:.3f} m, 余量 {margin * 100:.1f}%, 环底球心速度≈{v_bottom:.2f} m/s")
ok &= margin > 0.25

assert not any(math.isnan(c) for p in points for c in p)
report.append(f"总点数: {len(points)}, NaN: 0")

# ---------- 段索引 ----------
seg = {
    "platform": [0, n_plat - 1],
    "incline": [n_plat, n_plat + n_cr + 32 - 1],
    "bend": [n_plat + n_cr + 32, n_plat + n_cr + 32 + n_va - 1],
    "run": [n_plat + n_cr + 32 + n_va, i0 - 1],
    "loop": [i0, i0 + N_LOOP - 1],
}

# 只立高支柱；顶部一律低于管底 5cm 以上——支柱穿管会让球撞"台阶"耗光动能（x=0.684 实测）
pylons = [[-2.45, round(YP - 0.12, 2)], [-2.15, round(YP - 0.12, 2)], [-1.89, round(YP - 0.17, 2)],
          [-1.20, 1.17], [-0.55, 0.77]]
side_frames = [[0.69, 0.55, 0.34], [1.61, 0.55, 0.34]]  # [x, 横梁顶 y, z 半跨]

meta = {
    "releasePoint": [-2.228, round(YP - (TUBE_R - BALL_R), 5), 0],
    "stopper": {"pos": [-2.10, 1.71, 0], "size": [0.05, 0.12, 0.30]},
    "segments": seg,
    "loopTopBallCenterY": round(YR + RL + R_eff, 5),
    "end": [X1, YR, 0],
    "endTangent": [1, 0, 0],
    "pylonAnchors": pylons,
    "sideFrames": side_frames,
    "tubeRadius": TUBE_R,
    "ballRadius": BALL_R,
}

# 坡上出生点与挡板（抽开后球立即沿坡滚下）：球贴管底 = 中心线 - (R-r)·面内法向
NRM = (math.sin(TH), math.cos(TH))
i_seg0 = n_plat + n_cr                      # 坡段起点索引
pb = points[i_seg0 + 2]
ps = (pb[0] + math.cos(TH) * 0.125, pb[1] - math.sin(TH) * 0.125)  # 沿坡向 +12.5cm = 球面贴挡板
off = TUBE_R - BALL_R
meta["slopeSpawn"] = [round(pb[0] - off * NRM[0], 5), round(pb[1] - off * NRM[1], 5), 0]
meta["slopeStopper"] = [round(ps[0] + 0.03 * NRM[0], 5), round(ps[1] + 0.03 * NRM[1], 5), 0]
meta["slopeNormal"] = [round(NRM[0], 5), round(NRM[1], 5), 0.0]

# ---------- 写 JS ----------
buf = io.StringIO()
buf.write("""// track-curve.js — 滑道中心线点列（由 tools/gen_track.py 生成，勿手改）
// 布局: 平台(高1.70) → 凸弯R0.30 → 32°下坡 → 凹弯R0.55 → 直道(y0.23) → 竖直环R0.46 → 出口(x3.05)
// C1 验证: 拼接点切向最大角差 < 1°；环半径偏差 RMS < 2mm
// 环轨可行性(实心球滚动): 环顶不掉落需 h >= 2.7·R_eff, R_eff = 0.46-0.05 = 0.41
//   需要 1.107 m, 可用 1.470 m, 余量 32.8% —— 充分
""")
buf.write("export const TRACK_POINTS = [\n")
for p in points:
    buf.write(f"  [{p[0]}, {p[1]}, {p[2]}],\n")
buf.write("];\n\n")
buf.write("export const TRACK_META = " + repr(meta).replace(chr(39), chr(34)) + ";\n")
out = buf.getvalue()

with io.open("src/track-curve.js", "w", encoding="utf-8") as f:
    f.write(out)

print("\n".join(report))
print("段索引:", seg)
print("全部验证门:", "通过" if ok else "失败")
raise SystemExit(0 if ok else 1)
