# OPTIMIZATION-R4-PLAY — 运行态玩具手感（PL-1..58）

> Goal：把 MECHANICA 从"精确但沉默的演示软件"升级为"高帧率、有声音、可上手玩、有反馈的物理玩具"，
> 不损伤教学物理语义与验收基线（p0-p32 + 46 单测 + w 系列保持全绿）。
> 六层：性能地基 → 声音 → 抓取抛掷 → 碰撞 juice → 时间节奏 → 反馈打磨。
> 开发分支 `r4-play`（git worktree D:\mechanica-lab-r4；主工作区归另一 agent 的 R3 编辑态线，互不混支）。
> 状态列：☐ 待做 · ◐ 部分 · ☑ 完成有证据 · ✗ 决策不做（含原因）

## 前沿 0：性能地基

| # | 条目 | P | 落点 | 状态 | 证据/备注 |
|---|------|---|------|------|-----------|
| PL-50 | 帧预算仪表：perf HUD（fps/frame p50·p95·max·1%low/physics·overlay·render·dom 分段 p95/draw calls/tris/画质档），0.25s 节流+文本脏检查；topbar `perf` 按钮开关，localStorage 持久 | P0 | `src/perfmon.js`（新）；`src/workbench.js` tick 分段仪表 + `tickPerfHud`；`index.html` #perfHud/#btnPerf | ☑ | p34-perf 4 预置 headed 实测；HUD 截图 shots/p34-*.png；开关刷新持久断言 |
| PL-51 | 运行态 DOM 读数脏检查：setTxt/setSt 帮助函数，值不变零写入；liveGrid 读数元素缓存（原每项每轮 querySelector，随 renderInspector 重建失效） | P1 | `src/workbench.js` updateReadouts/updateConsbar/updateAstroCons/updateRotationCons/updateAtwoodCons/updateEnergyBar | ☑ | p 全量回归绿（读数断言全过）；实现即写入路径收口 |
| PL-52 | 曲线采样/重绘解耦节流：采样 0.15s（数据连续性）不变，canvas 全幅重绘 0.45s 节流（3:1）；总 E 线去 `ke.map()` 分配（取值闭包） | P1 | `src/workbench.js` sampleCurves/drawCurves/setCurves/setCurveMode | ☑ | 回归绿（curveState 断言全过） |
| PL-53 | 遥测零分配：`runtime.telemetryInto(id, out)` 写入复用对象；telemetry() 委托实现口径不变 | P0 | `src/engine/runtime.js` | ☑ | 回归绿；叠加层 tick 全部走池化遥测 |
| PL-54 | 叠加层箭头零分配：workbench tick 六个条目池（mkPool：TEL/NORM/FORCE/TENS/SPRING/JOINT）+ viewport 侧模块 scratch Vector3（force/spring/tension/vel/normal 五处箭头更新器）+ updateJointViz 定点 Float32Array 缓冲复用（原 setFromPoints 每帧新分配 attribute） | P0 | `src/workbench.js` tick；`src/engine/viewport.js` | ☑ | p34 无 >8ms 尖峰断言（GC 卫生） |
| PL-55 | 碰撞环对象池：共享 RingGeometry + mesh/材质回池复用（牛顿摆/碰撞链每步碰撞原每环建 geometry+材质再 dispose——GPU 缓冲反复建删） | P0 | `src/engine/viewport.js` spawnImpact/tickImpacts | ☑ | p34 newtonCradle/ballChain 无尖峰；视觉升级归层 3（PL-20） |
| PL-56 | 阴影质量档：`viewport.setQualityTier(0/1/2)` = shadow mapSize 512/1024/2048（dispose 重建） | P1 | `src/engine/viewport.js` | ☑ | 自适应档由 tickPerfHud 1s 窗口驱动（p95>5ms 降档，<2.2ms 且无尖峰 4s 升档，编辑态恒满档） |
| PL-57 | `_gravAccel` 预分配：乒乓双缓冲（velocity-Verlet 的 g.acc 持有上一轮引用，单缓冲会读零——必须双缓冲）；天体 480 次/s 的 map 分配清零 | P1 | `src/engine/runtime.js` _gravAccel/_gravStep | ☑ | binaryStar/threeBody 守恒量回归全绿（p19/p30/p31） |
| PL-58 | 自适应分辨率：并入 setQualityTier（pixelRatio clamp 2/1.5/1，下限 1——QUALITY BAR）；只动分辨率与阴影，不动几何/材质/叠加层 | P1 | `src/engine/viewport.js` | ☑ | p34 tier 字段入档；降档路径 headed 实测 |

### 前沿 0 验收数据（p34-perf，headed 真 GPU，RTX 5060 + 240Hz 屏，Chrome for Testing 153，1600×900，预热 3s 后墙钟采样 ≥30s/预置）

> 运行 `node tools/ui-test/p34-perf.mjs`（--quick 10s 冒烟）；原始数据落 `tools/ui-test/shots/p34-perf-raw.json`，截图 `shots/p34-<预置>.png`（HUD 在画取证）。
> 26/26 全绿（2026-10-05）。rAF 健康门 238fps；帧成本口径 = tick 内 physics+overlay+render+dom 分段之和（CPU 帧成本，不含 vsync 等待）。

| 预置 | 叠加层 | 窗口帧 | p50 ms | p95 ms | max ms | >8ms 尖峰 | 1%low ms | dc | 结论 |
|------|--------|--------|--------|--------|--------|-----------|----------|----|------|
| threeBody | 轨迹+守恒+曲线 | 2400 | 0.20 | 0.40 | 0.90 | 0 | 0.57 | 9 | ✓ 预算 5ms 的 ~1/12 |
| newtonCradle | 矢量+守恒+曲线 | 2400 | 0.30 | 0.50 | 1.30 | 0 | 0.85 | 46 | ✓ 碰撞风暴无 GC 尖峰（PL-55 池化） |
| ballChain | 矢量+轨迹+守恒 | 2400 | 0.20 | 0.40 | 1.00 | 0 | 0.67 | 14 | ✓ |
| collLab | 矢量+受力+守恒 | 2400 | 0.20 | 0.40 | 0.70 | 0 | 0.55 | 16 | ✓ 力箭头满载 |

**实测教训（进 LEDGER）**：
1. `git worktree add` 初次签出漏 `assets/`（HDRI/贴图，git 索引有但未落盘）→ HDRI 404 静默降级 RoomEnvironment，性能数字口径失真。新 worktree 必须 `git checkout -- .` + 核对 assets/。
2. headed 窗口失焦被 Chrome 节流 ~20fps：帧样本是"低帧率大步长"口径不作数——p34 加 rAF 健康门（≥45fps）+ 禁节流 flag + bringToFront。
3. `waitForFunction` 默认 rAF 轮询 = 每帧一次 CDP evaluate：30s×240fps 往返风暴把主线程打到 ~13fps 并制造 780ms 周期假尖峰。长等待必须 `polling: 500`，且断言函数严禁引用 Node 侧闭包变量（页面上下文 ReferenceError 风暴）。

## 层 1：声音（PL-1..8）

| # | 条目 | P | 落点 | 状态 | 证据/备注 |
|---|------|---|------|------|-----------|
| PL-1..8 | 碰撞音（ΔKE→音量、材质三音色、限流/衰减/pan）、状态音、静音开关持久化、autoplay 合规 | — | 待实施 | ☐ | 廉价感红线：禁裸方波，body 共振+瞬态包络；人耳走查入 LEDGER |

## 层 2：运行中交互（PL-10..14）

| # | 条目 | P | 落点 | 状态 | 证据/备注 |
|---|------|---|------|------|-----------|
| PL-10 | 抓取拖拽：速度伺服（禁 setTranslation 跟手），松手零操作速度继承；~80ms 指针轨迹惯性混入；力上限按质量缩放 | P0 | 待实施 | ☐ | p33 断言：甩出方向/量级、松手仅重力、按住不动松手直掉对照 |
| PL-11..14 | 运行态增量添加（动态体+传感器白名单）、图钉/运行态删除、暂停态 gizmo 摆姿势；运行态操作不进 undo | — | 待实施 | ☐ | |

## 层 3：碰撞 juice（PL-20..23）

| # | 条目 | P | 落点 | 状态 | 证据/备注 |
|---|------|---|------|------|-----------|
| PL-20/21 | 粒子（对象池，禁像素方块直喷）、镜头微震（可关） | P1 | 待实施 | ☐ | 样张先行双轮评审 |
| PL-22 | 碰撞环视觉升级（池化地基已落 PL-55） | P2 | 待实施 | ☐ | 同上 |
| PL-23 | 自动子弹时间（惊喜预算，深试后可删） | P3 | 待实施 | ☐ | |

## 层 4：时间节奏（PL-30..32）

| # | 条目 | P | 落点 | 状态 | 证据/备注 |
|---|------|---|------|------|-----------|
| PL-30/31 | `-`/`=` 连续倍率档、`.` 单步（收编 FEEL-17/18、FB-25/26 一套状态机） | P1 | 待实施 | ☐ | p33 时标断言 |
| PL-32 | 慢动作语义统一 | P2 | 待实施 | ☐ | |

## 层 5：反馈打磨（PL-40..44）

| # | 条目 | P | 落点 | 状态 | 证据/备注 |
|---|------|---|------|------|-----------|
| PL-40 | maxPolarAngle 放开 | P2 | viewport.js controls（现 1.54） | ☐ | |
| PL-41 | zoomToCursor 收编（FZ-45） | P2 | viewport.js controls | ☐ | 主工作区未提交改动已含（另一 agent R3 线）；本分支自行落地 |
| PL-42 | 缩放平滑 | P2 | 待实施 | ☐ | |
| PL-43 | 预置带相机位 flyToPose | P2 | presets.js + flyToPose（已有动画机制） | ☐ | |
| PL-44 | 选中/hover 三态视觉语言统一 | P2 | 待实施 | ☐ | 视觉门 |

## 环境与约定（本轮新增）

- 测试套件支持 `MECH_BASE` 环境变量覆盖服务地址（默认 8721 不变）——双 agent 并行开发各用各的服务端口，互不干扰。
- p34-perf 必须 headed（headless rAF 饿死是已验证坑）；chromium headed 二进制需 `npx.cmd playwright install chromium`。
- `tools/server/step_key.txt` 不入库：新 worktree 跑含 API 套件（p1/w2/w4/w7）前需从主工作区复制。
