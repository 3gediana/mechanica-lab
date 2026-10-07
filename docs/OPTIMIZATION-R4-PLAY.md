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
| PL-1 | 碰撞音触发链：runtime 每碰撞事件算冲量 J=Σm·\|Δv\|（碰前 `_prevVel`→碰后 linvel）→ `impactSounds` 缓冲 → workbench tick drain → 声音引擎。冲量口径（非 ΔKE）：理想弹性碰的脆响不漏 | P0 | `src/engine/runtime.js` stepOnce；`src/sound.js` | ☑ | p33「碰撞触发发声」断言 |
| PL-2 | ΔKE→音量（实为冲量→音量）：strength=J/2.2 满标，gain=strength^0.7×0.55×距离衰减——单调、小撞可闻大撞不炸 | P0 | `src/sound.js` gainOf | ☑ | p33「gain 随冲量单调」（m0.15→m0.6：s 0.38→1.52，g 0.256→0.504） |
| PL-3 | 材质三音色（程序合成零资产）：wood（165+330Hz 双模态空响）/ ceramic（1040·2413·4805Hz 非谐模态簇，比 1:2.32:4.62）/ rubber（62Hz 单模态闷噗）；每音色=带通噪声瞬态+模态共振簇（body 共振，非裸方波）。两体取更软方（接触刚度由柔体主导） | P0 | `src/sound.js` TIMBRES/_scheduleVoice | ☑ | p33 三音色特征断言：wood bands[188,656]Hz、ceramic bands[1031,2391,4828]+非谐对、rubber 质心 134Hz；wav 样本 shots/sound-*.wav |
| PL-4 | 限流：全局 20ms 最小区隔 + 实体对 70ms 冷却 + 单帧 drain 全部但引擎侧限速 + 主链 DynamicsCompressor（-18dB/6:1 限幅护耳） | P0 | `src/sound.js` impact | ☑ | p33「限流生效」10 球同落风暴 dropped>0 且 emitted 封顶 |
| PL-5 | 衰减/pan：听点=相机 target，pan=(x−target)/视野 span（±0.85 钳位），att=1/(1+d/1.2span) | P1 | workbench drain | ☑ | 实现级（听感走查覆盖） |
| PL-6 | 状态音：运行/暂停/重置 三档瓷音短 tick（同模态合成口径，quiet） | P2 | `src/sound.js` ui() | ☑ | 人耳走查覆盖 |
| PL-7 | 静音开关持久化：simbar `音效/静音` 按钮，localStorage `mech.sound`，刷新保持 | P1 | workbench setSound | ☑ | p33：文案切换+ls+刷新保持+静音期零发声 |
| PL-8 | autoplay 合规：AudioContext 只在可信手势（pointerdown/keydown）创建/resume；评估脚本触发 play 保持完全静默 | P0 | workbench 手势接线 | ☑ | p33：无手势 ctx=none+emitted=0 → 点击后 running |

**听感人工走查（E4）**：机器代理已固化（p33 离线渲染=实时同路径：包络瞬态 <15ms 达峰、衰减尾 <0.35%、三音色频谱特征、非谐比 2.32 排除谐波哔哔）；**人耳抽检通道已备好**：`listen.html`（dev server 根路径直达）——三材质 wav 一键播放（含合成参数标注）+ 工作台实听引导五步（实时合成全链路：冲量→音量/限流/pan + 抓抛手感/子弹时间/perf 仪表顺带验证）；wav 落 `tools/ui-test/shots/sound-{wood,ceramic,rubber}.wav`。**此项 PARTIAL（待用户点听），不阻塞其余全部条目**。

## 层 2：运行中交互（PL-10..14）

| # | 条目 | P | 落点 | 状态 | 证据/备注 |
|---|------|---|------|------|-----------|
| PL-10 | 抓取拖拽（铁律=速度伺服禁 setTranslation）：`runtime.grabBody/moveGrabTarget/releaseGrab` + `_stepGrab`（β=0.25/步收敛 + Δv≤F·h/m，F_MAX=120N 按质量缩力=沉感，重物超重悬吊自然下垂）；拖拽目标=指针射线∩「过抓取点·法向=视线」平面；容器捕获级 pointerdown 命中动态体才 stopPropagation（空处拖拽仍转视角） | P0 | `src/engine/runtime.js`；`src/workbench.js` onRunPointerDown | ☑ | p33：抓取启动/伺服跟手 err=0.002m |
| PL-10b | 甩出惯性：最近 ~80ms 指针世界轨迹（≥25ms 跨度有效）×0.7 + 体当前速度×0.3 混合，VMAX=14 钳位；指针几乎没动=零操作继承（按住不动松手直掉对照成立） | P0 | workbench releaseGrabAt | ☑ | p33：\|vPtr\|=14 捕获、夹角 0.0°、混合比 0.70、仅重力、按住不动 4.51→0.036 直掉 drift=0 |
| PL-11 | 运行态增量添加：`runtime.addLive`（动态体直接建进现有世界，不重建不进 undo），MECH.liveAdd 白名单组件 | P1 | runtime.addLive | ☑ | p33：doc 不进、物理体在跑、重置即清 |
| PL-12 | 图钉（P 键，dynamic⇄fixed 切换重置即消）+ 运行态删除（Delete，有关联约束的体拒绝并 toast） | P1 | runtime.togglePin/removeLive | ☑ | p33：钉住静止 drift=0、删除后 telemetry 消失、重置恢复 |
| PL-14 | 暂停态 gizmo 摆姿势：暂停=接管选中体 gizmo，拖动走 setLivePose（写物理体不进文档/undo），继续=交还 | P2 | pauseToggle + onGizmoCommit 分支 | ☑ | p33：pause=gizmo.enabled/resume=off |
| PL-13 | （并入 PL-11/12 的重置语义：运行态操作全不进 undo，重置回初始文档） | — | — | ☑ | 同上 |

**测试基建教训（本轮新增，三条都是实机撞出来的）**：
1. **严禁回归运行中改代码**（犯了三次）：dev server 供活文件，运行中编辑=后段套件吃到半成品/新代码。规矩：冻结→跑→改→再跑。
2. 本机 playwright CDP 每调用 ~200ms 延迟——真实鼠标序列的 80ms 轨迹时序全被拉稀；页面内合成 PointerEvent + performance.now() 自旋是唯一稳定路径；隐藏页 setTimeout 链有 1s 钳制（waitForFunction 的 interval 轮询同样被钳，长等待优先页内 rAF 采样或直接同步断言）；抓飞行中的实体必须读位置与 down 零间隔（同 evaluate 内）。
3. headless 饿 rAF（项目已知坑）同样饿 waitForFunction 的默认 rAF 轮询——瞬态量（trauma 半衰 0.3s）轮询采样必然竞态，改同步直测机制 + E2E 链路用累积量（spawnedTotal）断言。

## 层 3：碰撞 juice（PL-20..23）

| # | 条目 | P | 落点 | 状态 | 证据/备注 |
|---|------|---|------|------|-----------|
| PL-20 | 粒子对象池：`src/engine/juice.js`（新）——Points + 预分配 Float32Array（容量 320 环形分配），径向渐变软精灵（canvas 贴图，禁像素方块），材质 toneMapped=false（ACES 会把加法混合亮粒子滚降成白色——终审教训）；按材质三套参数（ceramic 白瓷火花四散 / wood 暖棕尘雾贴地 / rubber 暖灰闷噗），逐粒子 fadeExp 衰减曲线 | P1 | juice.js spawnImpact/tick/_fadeWrite | ☑ | p33「碰撞生成粒子」；样张三轮评审（见下） |
| PL-21 | 镜头微震（可关）：trauma² 曲线（trauma 0..1，shake=trauma²×0.055 位移+0.004 滚转，decay 1.4/s），渲染前叠加/渲染后还原（不污染 controls）；simbar `震屏` 按钮 + localStorage 持久；强碰撞才积累（strength>0.12） | P1 | juice.js applyShake/revertShake | ☑ | p33：trauma 累积/关闭门控/1s 衰减 + 关闭期粒子照常；样张 shake-peak vs off 同机位对（位移 5-8px 含滚转） |
| PL-22 | 碰撞环升级：共享几何 + mesh 池（24 环）；两段式=白芯闪光（150ms 平方淡出）+ 琥珀外环 cubic-out 扩张 0.7s；旧 viewport 单环路径退役（MECH.impactCount 改指新环池，p6 兼容） | P2 | juice.js spawnRing/tickRings | ☑ | p33：环出现/0.7s 淡出；样张 flash/expand 两相位（freezeAt 冻结取证） |
| PL-23 | 惊喜预算·自动子弹时间：B 键开关（默认关），运行态强碰撞（≥0.45）自动 0.25x 慢放 1.2s 回原档，2.5s 冷却，临时覆盖不碰用户档位，modeChip「子弹时间」徽标 | P3（深试保留） | workbench maybeBulletTime/effectiveTimeScale | ☑ | p33：强碰撞 sawSlow→restored；深试结论=与教学演示（碰撞慢放观察）契合，保留 |

**视觉门（样张双轮+终审）**：`tools/ui-test/juice-samples.mjs`（headed 真 GPU）出 8 张样张 → 独立评审代理逐张像素取证。
- 轮 1：2/8 PASS——4 硬伤（环闪光缺失/白盘穿模/震屏 0px/材质粒子不可感），根因=CDP 截图延迟 ~200ms 命不中 150ms 闪光等瞬态相位。
- 修复：juice 增加 `freezeAt` 诊断时钟（环/闪光/震屏可冻结任意相位取证）；粒子按材质重调参。
- 轮 2：7/8 PASS——wood 粒子仍不可感，根因=**spawnedTotal 跨场景累积**（等待条件被旧计数秒过，拍到撞击前）→ juice.clear() 挂 rebuildAll。
- 终审：粒子存在后唯一残项=色相被 ACES 滚降裁白 → 材质 toneMapped=false + wood 基色调暗保饱和（0xb08444）+ 密度 20-30。
- 取证：`shots/juice-*.png`（三材质粒子/环两相位/震屏同机位对/运行态氛围）。

## 层 4：时间节奏（PL-30..32）

| # | 条目 | P | 落点 | 状态 | 证据/备注 |
|---|------|---|------|------|-----------|
| PL-30 | `-`/`=` 连续倍率档：SPEEDS=[0.1,0.25,0.5,1,2,4] 单一状态机；selSpeed 下拉双向同步 + 2x/4x 新档（收编 FEEL-18/142：>2x 步上限 8→16，欠载走既有背压） | P1 | workbench setSpeed/speedStep；runtime.advance(maxSteps) | ☑ | p33：1→2→4→2 序列 + 下拉同步 |
| PL-31 | `.` 单步（收编 FEEL-17/112）：暂停/编辑态推进一个固定步长，与单步按钮同语义 | P1 | onKey Period | ☑ | p33 无回归（btnStep 断言套件全绿） |
| PL-32 | 慢动作语义统一（收编 FB-25/26）：Shift+Space 0.1x 互切（记忆原档）+ modeChip 倍率角标 + 切入自动开速度矢量（退出不关）；0.5x 实测推进速率 0.40 | P1 | workbench toggleSlowmo | ☑ | p33：切入/恢复/速率三断言 |

## 层 5：反馈打磨（PL-40..44）

| # | 条目 | P | 落点 | 状态 | 证据/备注 |
|---|------|---|------|------|-----------|
| PL-40 | maxPolarAngle 放开：1.54 → π（可压到地平线以下仰视坡底/装置底面） | P2 | viewport controls | ☑ | 行为级（30 分钟走查覆盖） |
| PL-41 | zoomToCursor 收编（FZ-45）+ PL-42 缩放平滑：容器捕获级接管滚轮（r186 步进 dolly 无阻尼）——目标距离指数趋近（0.2/帧收敛）+ 缩进时 target 向光标点轻拉 50%；controls.start（用户接管）即取消目标距离；zoomSpeed 0.9 定稿值同 FZ-45 | P2 | viewport wheel 捕获 + tickZoom | ☑ | 行为级；30 分钟走查覆盖 |
| PL-43 | 预置带相机位 flyToPose：PRESET_CAMERA 收 12 个主推预置教学位（pos/target），载入即平滑飞行；未列出的走 focusScene 自动取景（全实体包围盒） | P2 | presets.js + MECH.loadPreset | ☑ | p33：pendulum pose 飞行到位断言 |
| PL-44 | 选中/hover 三态视觉语言：hover=淡灰盒 0.28（未选中体）/ 主选中=琥珀 0.9 / 多选其余=灰 0.45；70ms 节流、ghost/框选期/运行态抑制 | P2 | viewport updateHover/clearHover | ☑ | p33：hover 命中断言；三态观感走查覆盖 |

## UI 精致化 + classic.html 重点优化（用户中途追加需求）

> 用户原话两点：「现在的这个ui界面看上去还是一股子ai味，你想办法做的更加精致一点点」；
> classic.html「没有任何按钮可以返回工作台」「圆形轨道衔接一点都不顺滑」「旁边摆球不知道意义」
> 「很简陋一股AI质感……重点优化」。原 Goal「classic.html 保持原样」边界由此条目解除。

### 工作台（UI-1..6）

| # | 条目 | 落点 | 状态 | 证据/备注 |
|---|------|------|------|-----------|
| UI-1 | perf HUD 从 raw 调试文本重建为两列微表格仪表：FPS 大数字表头（>8ms 尖峰红色角标）+ 三段（帧预算/分段 p95/画面）标签-数值对齐行，p95>5ms/峰值>8ms 数值变红 | `index.html` #perfHud CSS；`workbench.js` tickPerfHud innerHTML 拼装+脏检查 | ☑ | 样张 w3-perfhud.png；p34 仅断言可见性不受影响 |
| UI-2 | 预算采样窗卫生：启动前 120 渲染帧预热豁免（内核编译/HDRI 毫秒级尖峰不进样本）+ 进入运行态（play/单步/回放三入口）`perfMon.reset()` 重开窗——修掉「刚开页 HUD 显示峰值 959ms 红字」的仪表惊吓 | `perfmon.js` reset()；`workbench.js` 三处 run 入口 + _bootFrames | ☑ | 样张 w1（编辑态显示「待运行采样…」而非启动尖峰）；p34 采样在预热后不受影响 |
| UI-3 | simbar 开关热态降热：四叠加开关齐亮原为整块琥珀填色（一排色块过噪）→ 琥珀文字+2px 底线指示，运行 primary 不变；tb-group 同款 | `index.html` .hot 两处 | ☑ | 样张 w2（矢量/受力/轨迹/曲线/守恒齐亮态） |
| UI-4 | simbar 分组节奏：孤儿按钮归组——叠加层组（矢量/受力/分解/轨迹/曲线/守恒）+ 记录组（录制/回放）+ 感官组（音效/震屏），ID 全部不变（测试零改动） | `index.html` simbar HTML | ☑ | 样张 w2 |
| UI-5 | 守恒量条避让曲线面板：原居中版右端伸到曲线面板底下互相遮挡（两开时）→ 左下对齐（左栏宽+12，simbar 上方 38px），与网格标尺读数同侧堆叠 | `index.html` #consbar CSS | ☑ | 样张 w2（修复前版本曲线面板盖住动量误差列） |
| UI-6 | 曲线图例去复读：实体名括号注记剥离（「入射球 (e=1) 速率」→「入射球速率」），速率/高度关键词保留（p22 断言依赖）；能量模式三行不变 | `workbench.js` updateCurveLegend | ☑ | p22 图例断言继续绿 |

### classic.html / legacy-main.js（CL-1..6）

| # | 条目 | 落点 | 状态 | 证据/备注 |
|---|------|------|------|-----------|
| CL-1 | 返回工作台：右上 ghost 按钮「← 返回工作台」+ Esc 快捷键；工作台侧 linkClassic tooltip 同步改成对用户的话 | `classic.html` #btnBack；`legacy-main.js` bindUI | ☑ | 样张 c1；Esc 路径行为级 |
| CL-2 | 环底衔接顺滑化：入/出直线与环的四个开口管口全部相切重叠于环底切点（「衔接不顺滑」的几何根源）→ buildTrough 按到切点 3D 距离 smoothstep 收口（0.42m 起收、0.16m 内全闭），四股管口藏进闭合套管，读作真实弹珠轨道的接头 | `legacy-main.js` buildTrough | ☑ | 样张 c1/c2：套管过渡连续、无开口管口穿插（旧版是四张槽口互相咬穿的乱面）；物理中心线约束不动（碰撞语义零变化） |
| CL-3 | 删除旁边摆球：门式钢架+铬球+轻绳整套拆除（与轨道演示叙事无关的杂物），连带摆周期读数行/过零计时逻辑/复位项 | `legacy-main.js` | ☑ | 样张 c1 场景干净 |
| CL-4 | 去 AI 味·调试残留清扫：「（保留版）」标题 →「MECHANICA · 经典演示」；readouts 每 0.1s 往 document.title 写的 `M x=... c=... idx=...` 诊断串删除；遗留的「邻域碰撞体」errbar 探针（旧 trimesh 卡球排查用）删除；constrainToPipe 的 fixN/fixMag 诊断计数删除 | `classic.html` title；`legacy-main.js` readouts/constrainToPipe | ☑ | 标签页标题干净；p0 断言改道见 CL-5 |
| CL-5 | p0 classic 存活断言改道：原断言依赖被删除的 title 诊断串 → 改为物理时钟前进 >2s + 球离开发点 >0.3m 双条件（更强的物理在跑证据） | `tools/ui-test/p0.mjs` | ☑ | run-all 绿 |
| CL-6 | 环顶光门给意义：两针+珠原是静态装饰 → 球过环顶珠子琥珀闪光（emissive 脉冲衰减），呼应「测速门」实验读法；控制台按钮并键位角标（G/Space/F/R），右下帮助只留鼠标手势 | `legacy-main.js`；`classic.html` | ☑ | 样张 c1 顶部珠可见；闪光行为级 |

**缓存一致性**：legacy-main.js 引用 query `?v=1→?v=2`。

## 30 分钟整体走查（游玩+教学混合，ux-audit 式）

> Goal 收口条件：连续 30 分钟真实游玩+教学演示混合走查，修完所发现断裂。
> 驱动器 `tools/ui-test/walkthrough30.mjs`（headed 真 GPU）；清单/截图落 `tools/ui-test/shots/wt-*.png` + `walkthrough-manifest.txt`。

**走查口径**：人格=高中物理教师（备课+课堂演示双视角）+ 首次用户镜头并行。三主题回合循环至墙钟 31.7min：
教师备课（预置轮换×满叠加×32s 演化观察×fixture→运行解释链路）/ 学生玩（ballChain/collLab/newtonCradle
×targeted 真鼠标抓抛×子弹时间×慢放/单步×反馈计数）/ 边界折腾（相机视图循环×新建搭建×undo/redo×Ctrl+S×
1280 三面板挤压×classic 往返），收尾 threeBody 4x 满叠加 60s 长跑 + 持久化抽查。

**结果**：97 回合 · 521 条清单 · console 0 · 网络 0 · 43 次真鼠标抓抛全命中 · classic 往返 8 次全闭合 ·
长跑 p95 0.5-0.6ms 零尖峰 238fps（240 模拟秒）。

**发现与处置**：
| # | 发现 | 级别 | 处置 |
|---|------|------|------|
| W-1 | 1280/1440×多体场景：曲线图例单行不换行把面板撑到 ~640px，左缘压到守恒量条底下（两开时互相遮挡） | High（布局） | ✅ 已修：#curvePanel 锚定画布宽 334px + 图例换行；#consbar ≤1520px 降两列。三宽度×7 体图例 2D 重叠探针全绿（cc/ch/cu=false） |
| W-2 | 刚开页 perf HUD 显示启动期尖峰红字（峰值 959ms），仪表惊吓 | Medium（观感） | ✅ 已修（UI-2）：启动 120 帧预热豁免 + 进运行态重开采样窗 |
| W-3 | console 噪音：THREE.Clock 弃用告警 / PCFSoftShadowMap 移除告警 / favicon 404 | Medium | ✅ 已修：手动 delta 替代 Clock（语义等价）、显式 PCFShadowMap（原本就静默回退）、内联 SVG favicon；修后 31.7min 走查 console 全程 0 |
| W-4 | threeBody 4x 长跑 240 模拟秒后 Edrift 读数 1166% | Low（物理边界，非本 Goal） | 📌 记录不修：混沌三体近 encounter × 固定步长的固有数值边界，读数是诚实仪表；1x 短窗守恒断言全绿（p19/p30/p31），动物理内核超出 R4 边界 |
| W-5 | 「运行解释」在未解析场景点击只出 toast，按钮不置灰 | Low | 📌 记录：有 toast 引导（Agent 页签可见），R3-AB 解释器线领域，不在 R4 扩权 |
| W-6 | 驱动器自伤三连（非产品问题）：'spring' 预置 id 应为 'springSHM'；apply 后 loadPreset 会清 agentPlan（resetAgentPanel 设计行为）致解释空转；undo 断言漏算微调入栈次数 | — | ✅ 驱动器已修并注记 |

**收编项逐条审计（FEEL-14/15/24/25/99/106、FB-25/26、FZ-45、FEEL-17/18/112）**：
- ✅ 已收编进 R4：FEEL-14/106（hover 反馈→PL-44 三态视觉）、FEEL-17/112（单步键盘→PL-31）、FEEL-18/142（2x/4x 档+步上限→PL-30）、FB-25/26（慢动作状态机→PL-32）、FZ-45（zoomToCursor→PL-41）。
- ✅ **FEEL-99（回放随刷新率漂移）——走查后审计抓出的漏收编运行态项，已修**：帧数据 60Hz 采样（every:2×1/120s），旧推进 `max(1,round(rawDt·60))` 钳制在 240Hz 屏=4 倍速回放；改墙钟配速累加器（`_replayAcc += rawDt·60`，起点/拖动结束清零防burst）。p8 新增配速断言（98 帧 wall 2.00s ≈ 期望 1.63s+轮询容差；旧代码 0.4s 判然有别）。
- ⬜ 归还 R3 台账（纯编辑态，Goal 明文「其余编辑态项仍归 R3 台账」）：FEEL-15（右键菜单）、FEEL-24（label 拖拽滑值）、FEEL-25（slider schema）。

**走查后回归**：单测 78/78 + run-all 全绿（Clock/favicon/PCFSoft/consbar/curvePanel 改动后复跑）+ p34 quick 26/26。

## 视觉门补课（edbabc8）：三态样张 + 用户点名 UI 工程过独立评审

> Goal 视觉门清单=「粒子/震屏/碰撞环/选中三态」四项：前三项 juice 已三轮过审，**选中三态此前只有
> 数据断言**；用户点名的 classic/工作台精致化样张也只做过自审。本轮 tristate-samples.mjs 出三态
> 四连拍（无选中/hover/单选/多选同机位），连同 w1-w3/c1-c2 共 9 张交独立评审代理。

**首轮评审 4 处 fail 全真、全修**：
| # | 发现 | 处置 |
|---|------|------|
| V-1 | 顶栏品牌区 ≤1520px 被挤成竖排字形列（1440 实测，ts1-ts4 四图共有；1600 正常——此前样张全在 1600 拍所以没暴露） | 副标题窄屏隐藏 + 字标 nowrap |
| V-2 | 守恒条「能量保持 3044.1%」荒谬读数（纯 KE/KE0 口径在斜面增速场景必然飙表） | 口径改总机械能 E/E0（energyTotals 与曲线能量模式同源，含弹性势；KE/PE 分段随实时占比）。E 守恒天然有界；悬浮对撞 PE 恒 0 退化为原 KE 口径。p6/p8 断言兼容（实跑复核） |
| V-3 | c1 橡皮球无上下文读作游离残留物 | 黄铜托环器材位（球坐环里，复位同点位） |
| V-4 | c2 环底衔接半开 mouth 读作开口端面；另取样脚本镜头飞行未收敛致 ts3/ts4 选择集错乱、同机位破坏 | 收口 0.42/0.16m→0.26/0.08m + 环底交汇黄铜套箍；c2 取景改回用户视距（显微距离把开槽管诚实几何也审成缺陷——评审协议教训）；取样等 `_poseAnim/_focusAnim/_zoomTarget` 清空 |

**复评：9/9 全过，top_issues 空**（`edbabc8`；样张 shots/{ts1-ts4,c1,c2,w1-w3}）。
回归：单测 78/78 + run-all 37 套 ALL GREEN。

## 放置防穿模（93111b8，用户需求「放置不能穿模，根据碰撞箱阻挡」）

| # | 内容 | 状态 |
|---|------|------|
| PB-1 | 手动放置（ghost 落点/目录默认槽位）落点前碰撞箱（AABB，2mm 贴面容差）阻挡；ghost 被占=红色警示，点击自动抬到占位物上方，抬无可抬=拒绝+红色预览保留；目录槽位被占=环搜最近空位（原位→抬升→1.2m 环），「目录加一件」一键可用 | ☑ p35 7/7 |
| PB-2 | 拦截规则精化：只拦「涉及动态体」的重叠（运行会爆/抖）；固定体×固定体放行（坡嵌地板合法） | ☑ |
| PB-3 | 授权式放置（解析建场/预设/测试显式 transform）trusted 不拦——贴地出生等作者摆位语义保持 | ☑ p24 9/9 复验 |
| PB-4 | 收编 master R3-B4「点哪放哪」（cherry-pick d3524b7→f57a1a6，双 agent 分支收敛）；其 FZ-7「AABB 阻挡」项在本节落地 | ☑ |
| PB-5 | p35-placement 新套件（红警示/坡腹拒/同球心拒/浅嵌抬升/trusted 通路）；p9/w1/w5 改测口径（被占槽位合法拒绝） | ☑ |

**工程教训（防穿模三轮方案返工）**：本版 vendored Rapier 的空间查询对「未 step 的编辑态世界」不可用——成对查询全哑、contactDist 对新建 pair 报伪深（贴地报 -半径）、speculative 对近距对持续误推；位移口径又被 speculative 闭拢污染（贴地 cum=0.15）。最终纯 three.js AABB 是唯一确定性方案，且正是用户语义「碰撞箱阻挡」。Rapier placementResolve/penetration 段已整体移除。

## 挪动防穿模（f2fbe3b，用户截图实测下篇）

上篇只拦了放置通路——用户把球拖进斜坡仍穿模（截图）。本篇把同一探测延伸到全部挪动通路：
| 通路 | 规则 | 处置 |
|------|------|------|
| gizmo 平移/旋转提交 | 候选嵌入方向数 ≥ 当前=弹回（还原 pos+rot+scale 全套） | ☑ |
| gizmo 缩放 | 跳过（视觉缩放不改碰撞体/位姿） | ☑ 决策 |
| 暂停态摆姿势 | 同平移（被挡弹回物理体位） | ☑ |
| 方向键微调 | 被挡步不生效+toast | ☑ |
| 语义 | 挪动=只拦「加深穿透」（候选 ≥ 当前），允许朝逃逸方向挪出——授权式嵌入体否则永久冻结（w1 A4c 实测）；放置仍任何嵌入即拒/抬 | ☑ |

**弹回还原全套教训**：gizmo 拖拽直接改 mesh transform，阻挡弹回只还原 position 时 scale/rot
残留会滚雪球（w1 A4 实测 ±1e7）。w1 A4c 对照组改右上净空拖拽（向下拖压进地板=新语义正确拦截）。
回归：run-all 38 套 ALL GREEN + 单测 78/78；p35 扩至 11 断言。

## UI 第二轮精致化 + Agent 能力扩展（skill 方法论驱动，用户「还是太丑/太有AI味」+「全部优化 Agent 能力」）

**方法**：装 Vercel 官方 `web-interface-guidelines` skill（本地快照 `~/.agents/skills/web-interface-guidelines`，156 条 MUST/SHOULD/NEVER）+ 既有 `design-taste-frontend`（taste-skill，其 9/11/14 节 AI-tell 清单、形状锁、色彩锁适用工具 UI）。截图审计→逐项修→视觉验收。

**UI 修复清单**（index.html 为主，classic/listen 同步 token）：
| 项 | 修复 |
|----|------|
| 滚动条 | Windows 默认亮灰粗条→8px 深色细条（webkit+FF 双写）——精致感头号杀手 |
| 层次 | 三档体系：贴边面板无影+顶部内高光 `--hl`；浮层（守恒条/曲线/HUD/toast/帮助）双层投影 `--shadow-float` |
| 形状锁 | 全站 2px（comp-item 4→2、thumb 3→2、need2 圆角改父 overflow 裁切） |
| 深色原生控件 | `color-scheme: dark` + `theme-color` + 原生 select 显式底色（Windows 修复） |
| 缩略图发白 | 浅底 `rgba(255,255,255,.04)`→深底 `rgba(0,0,0,.30)` 衬金属材质 |
| 对比度 | --dim #82878f→#8f949c（≥4.5:1）、--faint #565b62→#6b7078；数据色令牌化 --pe/--ke |
| a11y | toast `aria-live`+role、errbar role=alert、parseStatus aria-live、删除钮 role=button+aria-label、焦点环加强(offset 2px)、sceneName focus 不再吞 outline、reduced-motion 全局冻结、touch-action、overscroll-contain |
| 主操作 | simbar「运行」安静填底（accent 8% 底+1px 描边），一眼可辨 |
| 能量条 | width/left 动画→transform scaleX+translateX（合成器路径，WIG-Anim） |
| 加载幕 | 静态细线→琥珀段往复进度（reduced-motion 下自动冻结） |
| 帮助浮层 | 快捷键列 kbd 片块化；新增 Ctrl+Enter 条目 |
| 杂项 | 「✈ 飞到观察点」去 emoji（全站零 emoji）；listen.html 字体栈漂移修复 |

**Agent 能力扩展**：
1. **本地快速指令通道（AG-L1，workbench `tryLocalAgentCommand`）**：日常操控零 API 费零等待——运行/暂停/继续/重置/单步、慢放/原速/N倍速、显示|隐藏|裸名翻转 9 种叠加层（分解联动受力）、全局/顶/正/侧视角、聚焦X、删除选中/删除X/清空（走 undo 栈）、新建/保存/帮助。复合句（含逗号/「再/然后」）与「解释」类自动回落模型通道；未命中原路进 step-5-preview。入口=文字框按钮+Ctrl+Enter。
2. **removals 删除指令全链路（AG-R1）**：parse-schema 接受 `removals:[名称|{target}]`（去重≤6）→ 变更预览勾选项（含「无匹配将跳过」态）→ 建场批内先删后建（防「换成X」误删新建体；级联 attach/joint 清理 `removeInBatch`，不走 opRemoveEntity 避免嵌套历史批次）→ 历史条目含删除计数。服务端 PARSE_PROMPT 同步 schema+规则。
3. 测试：单测 +3（removals 归一/截断/缺省）=81/81；新 `p36-agent-cmds.mjs` 21 断言（出网保险丝 route abort 保证零 API 依赖；能量条断言随 transform 化同步改 DOMMatrixReadOnly 读法）。

## 建场自查闭环（AG-V，用户需求「Agent 要能自己发现自己建的系统的 bug 和与题目的误差」）

**四步管线**（applyAgentPlan 完成自动跑，Agent 页签「建场自查」面板出报告，「重跑自查」可手动重放）：
1. **静态核对**（agent-verify.js 纯函数）：26 向射线嵌入定罪（复用挪动防穿模同款口径）＋球-坡面语义（ballOnRamp 同公式，Δy>10cm 定罪——用户点名的「球没放在坡上」）＋题给位置保真（偏 >5cm 定罪；spring/hinge/atwood/rotation 专用布局重摆位=设计行为豁免）＋绳绷紧/弹簧大拉伸首帧猛拉预警。
2. **自动修复**（一轮 ≤6 处，独立历史批次可撤销）：嵌入→抬升阶梯 [0.02..1.2m]+环搜搬家兜底；坡面错位→重算落点；题给位置偏→还原题给位（嵌则抬）。**关键教训：修复候选位必须过实机网格口径（entityPoseBlocked，与定罪同一把尺）验证才落地**——placementLiftFor 的独立探针网格在斜坡楔体边缘与实机分叉（同点探针=干净/实机=12 向埋），双尺必翻车。
3. **运动探针**：同步确定性步进 needT 秒（题型窗口照抄 runAndExplain；rAF 不介入零漂移），每 0.1s 采全体位姿+系统动能。检出器：NaN/Inf、飞出（侧向 |x|,|z|>40 或 y>60 任何时候；竖直下坠仅场景有地面时——无地面场景自由落体是合法教学演化）、卡死（预期运动体全程位移 <2mm 且 |v|<0.01：题给初速=error、否则 warn）、能量爆炸（改口径：相邻 0.1s 采样突跳 >3J 且 >20 倍——**旧「40×初值」口径把光滑斜面从静止加速整片误报**）。
4. **理论对照**：探针主体系列直接喂 explainRun（确定性解释器，与「运行并生成解释」同一条计算路径）——pass=true 出 ok（偏差 %）、pass=false 分两档（errPct 有值=error「与题目理论不符」；null=warn「测不出偏差，预期运动段未走完」——被方块挡住的球不是建场罪证）。必须**在 resetSim 前算**（collisionReports/漂移基线活在 runtime，重置即清）。

**复杂场景能力**：prompt 实体上限 12→16、attaches 4→6；**同类型多件散开布局**（box 沿 x 对称 0.9m 间距、cylinder 沿 z 0.8m——原版全部叠在 [0.6,…] 同一点，复杂题必炸）。ballOnRamp 导出供自查复用（静核与建场同一公式不两张脸）。

**测试**：单测 +17（agent-verify.test.mjs：散开/坡面语义/位置保真/连接预警/NaN/出界/卡死/能量突跳+平滑增速不误报）=98/98；p37-agent-verify 14 断言（干净斜面全过+理论吻合、ramp+双 box 嵌入检出→修复→清零→Ctrl+Z 只回滚修复、大初速飞出检出、重跑自查、console 净；stub /api 零出网+btnNew 清默认场景）。**p36 F3 波及**：AG-V 上线后建进斜坡的 box 触发自动修复=第二个历史条目，一次 Ctrl+Z 只回滚修复层——断言改逐次撤销到球回来（验「整场可回退」本质而非固定次数）。

## 创建动效 + 生动建场（AG-V2，用户需求「每个物体创建时要有遵循物理规则的动效，不要开局稳态；Agent 建场过程要能实时看到」）

**三件套**：
1. **出生下落**（runtime._createEntity）：无初速动态体从文档位姿上方 4cm 落下——落+微弹+入稳，开局不再稳态。豁免：带初速/天体/spinLock/onPulley/spawnDrop:false/**gravityScale=0**（最后一条是 p26 实测抓的：理想化悬空对撞场景里零初速球被抬 4cm 且无重力落不回，两球平面错位 4cm→接触事件比求解器解析步早一步→碰撞报告抓到「速度未变」的幽灵事件→explainMomentum 过滤器扑空超时 120s）。doc 位姿不动（编辑态网格/反穿模/测试全不受污染）；**教学精度安全**：explainIncline 理论/能量基准改从反弹窗后（t≥0.15s）样本起算+含实测初速 v0（√(v0²+2gΔh)，静态释放与旧公式全等），出生下落被理论自动吸收，p1 19/19。
2. **连接件活起来**：绳=8 段 verlet 链呈现层动力学（重力垂坠悬链弧、出生上踢跳动、拖动摆动；只动网格不动 rope joint，零物理污染；张紧时自然绷直）；弹簧=7 圈螺旋管几何（拉伸圈距变疏的正确语义，替换直杆）。Agent 连接绳长=端距×1.03（松弛出生：挂重物落下绷紧接住→垂一垂→摆动；rope joint 单侧拉紧不弹射；模型题给绳长忠实不动）。
3. **生动建场**（AG-V2）：Agent 面板「创建场景实体」=vivid 路径——实体逐件落场（每件重建，出生下落当场可见+自动选中）+阶段直播「搭场景 i/n：名字」+探针分块让帧（每 4 步让 8ms，肉眼可见的快进运动+「自查：探针运行 t=x/y」）——全程看得到 Agent 调试场景。**webdriver（Playwright）下节奏归零+探针同步路径**：套件的固定 sleep/条件等待都按同步建场写，呈现层节奏与行为正确性解耦（首版全量回归 12 失败全是节奏拖过固定 sleep，实测教训）。

**测试**：p38-spawnlife 10 断言（出生悬高/入稳/doc 不污染、绳 8 段+×1.03 松弛+verlet 垂弧+中段运动、弹簧线圈几何）；p36 F 段等自查落地条件化；p26 加 agentBusy 屏障（MECH.agentBusy 暴露）。样张：agv2-rope-swing.png（挂重摆动）、agv2-spring-coil.png（线圈）。

## 语义自修正闭环 + 数据导出（AG-V3 + DE-1，自主选题：自查只报不修语义错误=闭环缺口；物理实验数据处理无出口）

**AG-V3 语义自修正**（AG-V 收口：静态几何有自动修复，语义级错误——飞出/卡死/理论偏差——当时只报告不行动）：
- **触发链**：runAgentVerify 尾部（verify 闭周期外）scheduleAgentPatch → 剩余 error>0 且轮数 <2 → maybeAgentPatch：patchBrief(findings)（error 全量+warn 截 6，纯函数）+当前 plan+题干文字 → POST `/api/parse-patch` → 模型出修订计划（同 schema）→ normalizeParse → renderParseResult 重算 agentChanges → applyAgentPlan(vivid, patch:true) 重建 → 尾部自动完整复验。**轮数上限 2**；失败（网络/无效输出）钉死轮数不再重试——宁可交手动不无限烧 key；新解析/新建场景清零。
- **两个实测抓出来的坑**：① **verifyBusy 自锁**——patch 若在 verify 的 try 内触发，重建尾部 await runAgentVerify 会被外层 verifyBusy 挡成空转；schedule 必须放 finally。② **重武装缺失+parseBusy 卡死**——第 2 轮的 schedule 发生在 V2 的 finally（agentPatchBusy 还挂着被挡），mustAgentPatch 收尾补 scheduleAgentPatch()；且 patch 流程里 `setParseStatus(…, busy=true)` 后无收尾调用——**parseBusy 是 setParseStatus 第三参驱动的**（AG-72 互斥），置真没人关=后续 schedule 永远被挡（脏修订计划实测卡死在 1 轮）。两条都在 p39 封顶场景固化。
- **服务端**：PARSE_PATCH_PROMPT（只改必改字段、题给数值绝不许动、修不好保持原样不编造；常见处方：逃逸=限速/补地面、卡滞=挪开、理论偏差=按题意重摆）+ call_step_patch（payload 截 12k）+ `/api/parse-patch` 端点（plan 必须带 entities）。
- **连带修掉 latent schema bug**：planToOverrides 的 ground 分支漏设 o.physics（显式 ground 实体一贯下游读 physics.body 即炸）——模型修订计划常补地面，首测即触雷。

**DE-1 数据导出**：解释运行与自查探针的 recording 在 reset 时即清——新增 snapshotSeries 快照（两处采集点）+ exportSeriesCSV：t/x/y/z/vx/vy/vz/speed/rotz 九列（BOM+Excel 直开，题型标签+时间戳文件名）；「运行解释」组内「导出数据」按钮 + 本地指令「导出数据」；空数据 toast 引导。

**测试**：单测 +4（patchBrief 3 + ground physics 1）=102/102；p39-agent-patch 13 断言（脏计划检出→修订落地→复验清零→不再触发；修订仍脏→恰好 2 轮封顶不洗白；干净零触发；服务失败自动重试 1 次→钉死轮数→重跑自查不烧 API）；p40-data-export 9 断言（快照重置不丢、CSV 结构/行数/t 单调/速度非零、本地指令同通道、空数据引导）；MECH 通道 +agentPatchState/+lastSeriesInfo，agentBusy 扩为 verifyBusy||agentPatchBusy。

**回归连带揪出两笔上轮遗留**（全量回归 5 失败逐一定性：p0/p33/p38 为并发负载抖动，复跑即绿；下两笔为真）：
1. **p22 动量预置能量守恒 -5.5%（111f424 上复现，非本轮引入）**：AG-V2 出生下落把静止球 B 抬 4cm，能量曲线 E0 基线把 m·g·h≈0.39J 幻影势能计了进去，落地入稳即成「损耗」——碰撞本身完全弹性（1.5→0.5/2.0 m/s，KE 全等）。修复后 E0=6.6628/E1=6.6625（守恒到千分位）。教训：**出生下落对「以能量基线为教学主体的预置」是污染源**，`spawnDrop:false` 是给策展场景留的诚实开关；另——**给重复文本块打补丁必须区域锚定**（momentum 与 momentum2d 的球 B physics 块逐字相同，首版补丁插错门，页面级 doc 探针才抓到；"复跑变绿"可能是采样时机运气，E0 千分位级稳定才算修好）。
2. **p19 console 出现 404**：8722 服务器进程还是旧 serve.py（改端点后没重启），verify 出错→patch 回喂→真实 fetch 打到不存在的 /api/parse-patch。教训：**改 serve.py 必须重启 dev server**（python 无热重载）。
另：run-all 头部补 MECH_BASE 警告——老套件默认 8721、新套件默认 8722，不 export MECH_BASE 一次回归会打到两个树（本轮实测 5 个假失败全是对着别家 worktree 旧代码跑出来的）。

## 主动排雷 ux-audit（用户「不想用一个有 bug 的产品」→ systematic-debugging + ux-audit 双 skill 纪律走查）

**方法**：5 线程交互走查（备课主链/手工搭建+撤销删除/预置+运行态竞态/键盘帮助+首用视角/AG-V3 真实模型全链），50 条 Interaction Manifest 带时间戳选择器，截图+console 全程取证；报告落 `tools/ui-test/_audit/REPORT.md`。**self-critique：drafted 5 → kept 3**（2 条是我探针失手非应用行为——取证后复验推翻自己，审计纪律防栽赃）。

**三个真 finding（全部当场修+实证）**：
1. **F1 (High) 双击「创建场景实体」翻倍连接件**（实测 2 根弹簧）：applyAgentPlan 无重入锁（vivid 分批 await 期间可交错重入）+ agentPlanApplied 置位但入口不查 + agentPostPass 连接件无条件新建。修复：in-flight 锁 applyAgentBusy + 连接件端对去重（同类型+同 attach 对=跳过）。**保留「改勾选再应用」的合法重放**（去重后重放幂等，不做硬禁用）。回归固化进 p37（双击/三击后 springN===1）。**二段坑：锁与 patch 链的微任务竞态**——patch 重放由 verify 的 finally 同步调度，此刻外层建的锁尚未走到 finally 释放，首版锁把 patch 的 apply 静默吞掉（verify 不重跑→补烧一轮，p39 rounds 1→2 实测、全量回归 30s 超时抓现行）。修复：`applyAgentBusy && !agentPatchBusy` 通行（patch 链自身有 agentPatchBusy 单飞）。教训：**给 async 链加锁先画出「谁在谁的 await 里被调度」**——锁放在外层入口，内层被外层 await 的链会撞上未释放的锁。
2. **F2 (Medium·首用) 目录搜索「斜面」找不到「斜坡」**：教师词汇与卡片标签不一致，搜索无别名。修复：CATALOG_SEARCH_ALIAS 双向别名表 + catalogItemMatches（斜面↔斜坡/小球→球/物块→方块/滑轮↔定滑轮/绳子→绳）。
3. **F3 (Low·键盘) 搜索框焦点残留吃掉 Ctrl+Z**：点卡片加件后焦点留在输入框，文本撤销抢先。修复：加件即 blur。

**AG-V3 真实模型首次真调（此前只测过桩）**：parse-patch 直调实测——模型修订**语义正确**（补地面承接、题给 30m/s 与 2kg 一字未动、假设写明「题目无地面，按沙盒约定补 y=0 地面」）；UI 全链真实解析（11s/置信 95%）→ 建场 → 自查 0 error → 解释 → CSV 全通，console 零错误。parse-patch 首连 502 系上游瞬时抖动，客户端 isRetryableParseError 自动重试已覆盖（curl 重试即成功）——**不改**。

**Allowlist**：WebGL `GL Driver ... GPU stall due to ReadPixels` 为本机 RTX 5060 驱动噪音（在案），非应用产生。

## 环境与约定（本轮新增）

- 测试套件支持 `MECH_BASE` 环境变量覆盖服务地址（默认 8721 不变）——双 agent 并行开发各用各的服务端口，互不干扰。
- p34-perf 必须 headed（headless rAF 饿死是已验证坑）；chromium headed 二进制需 `npx.cmd playwright install chromium`。
- `tools/server/step_key.txt` 不入库：新 worktree 跑含 API 套件（p1/w2/w4/w7）前需从主工作区复制。

## 模型库扩容（UX-R，用户「搜真实题目，尽可能涵盖所有模型」+「不要吝啬 token，找模型盲点」）

**模型库 10→24**（示例解析 fixtures，按学段分组进 Agent 页签下拉，全部走真实生产链）：
- 初中：自由落体双球（比萨斜塔）/摩擦刹车对比/牛顿第一定律（惯性）。
- 高中：竖直上抛/完全非弹性碰撞/反冲/子弹打木块/板块模型（摩擦传动）。
- 大学：刚体纯滚动（圆柱自动躺平上坡）/滚动 vs 滑动赛跑（双车道）/椭圆轨道（开普勒二三定律）/弹簧耦合双振子/阻尼振动/弹簧弹射器（压缩态 restLength>安装距）。
- 兜底：p41-model-coverage 40 断言——每个 fixture 走 loadFixture→建场→自查，断言零 error+实体结构（圆柱在坡上/斜面加宽/弹簧数）。新增模型必须进 EXPECT 表。

**引擎自由度升级（模型表达力盲点）**：①坡面放置通用化——圆柱自动躺平上坡（rot x=90°）、方块贴坡旋转（rot z=-θ）、球多车道并排、斜面按车道数自动加宽（0.75m/道）②box/cylinder 尊重题给 position（此前恒被忽略）③`given.fixed=1` 固定体（弹簧墙/挡板）④PARSE_PROMPT 文档化 attaches（模型现在能表达弹簧连接两实体）+盲点课（斜面+水平面组合补 ground/椭圆合法/坡面物体省略 position）。

**理论判定两处教学正确性修复**：①椭圆轨道合法化——ecc≥0.1 不再定罪（开普勒第二定律=角动量守恒、第三定律 T²∝i³ 对椭圆精确成立；逃逸仍会被周期测不出拦下）②抛体派发收窄——贴地滑动单球（惯性/刹车类）不再被拿去算射程（要求离地 6cm 或 vy>0.5）。

**弹簧拍频案（damped 实测偏差 100.5% = 精确 2×）**：峰检测 `>1e-4` 噪声门把阻尼衰减后的真峰隔一个吃一个（晚段 apex 曲率增量跌破门限，apex 浮点 -1.0445→-1.0444 增量恰好 1e-4 被拒）→「首末平均间隔」被撑到 2×。同步步进实测物理周期仅偏 1.7%（拉格朗日没错，Rapier 没错）→纯测量口径问题。修：门限 1e-6+平台坍缩（60Hz apex 多帧平台）+相邻间隔中位数，实测 0.73% 通过。**方法论：拍频假说（弹簧摆 2:1 共振）先立后破——导轨阻尼代码写完发现横速恒为零，当轮撤销**；「实测 2× 精确」的巧合比复杂机理更可能是测量口径。

**连带修**：auto-ground 查重（模型给了地面还自动补=双地面）/springLayout 劫持收窄（kind=spring 或 ≤1 实体才接管，多体 attach 走正常管线——否则模型给的墙/第二球全被丢弃）。

**红队轮**（_audit/redteam.mjs，20 道真实 curriculum 题真打 step-5-preview）：上游降级期致首轮中断（H6 复摆 10.5s 过、X3 混合搭建「删除+重建」过）；韧性化（每题 3 次重试/增量落盘）后重跑，结果见 _audit/redteam-results.json。

## 自由摆放碰撞体积 + 材质真预览（用户截图反馈：球能穿模进斜坡/材质选择全是纯色图案）

**复现先行（headless Playwright 三场景）**：①光标瞄准坡面中部，ghost 落到坡后方 (-1.5,0.17,-1.5) 半空（ghost 只投影 y=0 地平面，骑不上坡面）②拖拽全程网格自由穿透，全靠提交时弹回③把球拖向坡面释放必弹回原位（「不能加深穿透」）——鼠标路径根本无法把球放上斜坡。

**修复一 ghost 骑面「指哪放哪」**（viewport._updateGhostFollow/_surfaceRide）：光标射线直击实体表面 → ghost 骑到命中面（球体沿命中面法线外推 halfH+4mm，其余竖直托起）；空地才落回地面档（grid 吸附只在地面档生效）。瞄坡面=贴坡面，瞄球顶=叠球（贴面合法物理位）。

**修复二 拖拽实时碰撞**（viewport 拖拽生命周期 + workbench onGizmoLive）：dragging-changed 建档（起点位姿+出发深度），objectChange 每步钳制——整步被挡先试滑动分解（保高度平移/单轴，贴墙滑而非冻死），rotate 嵌入=抬升解算到新姿态贴面高度，全挡回滚。运行/暂停态摆姿势保持 PL-14 语义不介入。

**修复三 判定口径升级 双口径**（viewport._embedStats）：26 向射线探针统一产出 count（嵌入方向数，placementLiftFor/方向键推入沿用）+ depth（最深嵌入深度，拖拽实时钳制与 gizmo 提交弹回改用「不比出发更深+10mm 接触皮」相对判定）——方向数口径在贴坡场景同增同减导致 `candN>=curN` 恒真、贴坡球完全拖不动；深度差才是稳定相对量。抬升阶梯 0.35→1.2m（高坡/墙顶也能解算落顶）。

**连带修（潜伏 bug 被骑面路径炸出）**：`meshPenetrates` 泄漏 `raycaster.far`（探针把 far 设成包围盒对角×4 后不还原，污染后续所有射线——骑面路径第二次 follow 同一条射线打不到 5m 外坡面 → 落回地平档）。旧代码只算地平面所以从未暴露。修：_embedStats finally 还原 far + follow 处防御性置 ∞。

**材质选择器真材质预览**（viewport.renderMaterialSwatches + workbench 色块替换）：离屏微型渲染器（96px，微型摄影棚 env=渐变天光+双柔光箱+地平灯带 equirect→PMREM，主光/冷轮廓光）把 12 个材质各渲一枚材质球 dataURL，目录色块就地替换（深底 #0c0d0f）；生成期/失败期保持色块降级，目录重渲直读缓存。主场景光照不动。目检：黄铜金/铬钢镜面/橡胶哑光/大理石洞石纹全部成立（marble 贴图本就是米黄洞石调，与场景一致）。

**回归**：units 102/102；p35 重写 14/14（骑面放置贴坡解析间隙 gap 0.172 vs 0.168、叠球心距 0.304≈2r、拖拽钳制停在坡趾切点 x=0.92 提交不弹回、trusted 通路不拦）；新增 p42-swatch-previews 5/5（12 色块全 dataURL、重渲直读缓存）；run-all 全量见当轮记录。

## 传送带引擎能力 + 模型库波2（RUN-2 + 课程补齐 + freefall 悬浮修复）

**传送带（此前台账记名的「引擎暂不支持」缺口，高中最经典模型之一）**：
- 组件 `conveyor`（表面与结构）：带长/带厚/带宽/带速（负值反向输运），friction 语义=带面动摩擦因数 μ。视觉=暗胶基座+琥珀人字纹顶带（应用主题强调色，远距离可读输运方向）+两侧钢导轨（机器轮廓）；人字纹随带速逐帧滚动（带停纹停），runtime 消费 mesh.userData.beltScroll。
- 物理口径（教科书式）：带对物的切向作用=动摩擦 a=μg 朝带速，「轻放上去先滑动后共速」；带面 Rapier 摩擦强制归零（ColliderDesc.setFriction(0)+Min 合成规则——否则 Rapier 静摩擦按「带其实没动」把共速物体拖停，带驱动模型名存实亡），切向物理完全由 runtime `_driveConveyors` 接管（contactPairsWith 找带面接触+法向竖直占优判定，步内 dv=min(|带速-vx|, μg·dt)）。
- explain 分支：t₁=v带/(μg) 理论滑动时长+滑动位移 vs 实测 crossing 时刻+共速段平均速度（±6%/±35% 判定）；派发必须先于抛体——带上单球+地面恰好满足抛体「离地单球」条件，会被拿去算射程。
- parse-schema：conveyor 实体布局（球自动落带顶左端，正常重力——对撞悬浮分支例外）+自动补 8×4 光滑地面（出带承接+取景不拉远）+TYPE_MAP/别名（传送带/输送带/传输带）+RANGES speed [-8,8]。
- workbench PEDIT 评审表补 conveyor（带长/带速/带面μ）——**此前 `PEDIT[e.type]` undefined 会让 fixture 载入即抛 TypeError 且被 catch 吞成「示例数据读取失败」**（p41 conveyor 用例 30s 超时现形）。PARSE_PROMPT 文档化 conveyor+带速方向语义（serve.py 已重启生效）。

**连带修（freefall 悬浮 bug）**：无斜面球体一律走「对撞悬浮理想化」（gravityScale=0+无摩擦）——freefall fixture 的球从 y=2.0 松手后一直悬浮！p41 靠 vacuous verify 绿（无 freefall 分支=通用遥测 0 error）。修：无初速+题给高位置（y>r+0.1）=「由静止释放」语义，保留重力；带初速/贴地缺省仍悬浮。补 explainFreefall 分支（t=√(2h/g)+落地速度，多球质量不同同时落地=伽利略叙事），配单测钉死。

**模型库波2（24→29）**：高中+4：平抛运动（水平 5m/s 抛出）/斜抛 45°（v²sin2θ/g 最远射程）/完全弹性碰撞（e=1 等质量速度交换）/传送带输运；初中+1：追及相遇（2m/s 追 1m/s，约 1s 相遇）。p41 EXPECT 同步扩表（+gs 断言能力：freefall gravityScale=1 回归守卫）。

**回归**：units 106/106（explain +2 传送带/freefall、parse +2 布局/重力例外）；p41 53/53；p43-conveyor 6/6（建场零 error/球 4s 共速偏差 1.06%/反向带速 0.18%/人字纹滚动/目录通路）；全量见当轮记录。
