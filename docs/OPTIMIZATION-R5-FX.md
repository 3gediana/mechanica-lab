# R5 效果轨道调研全表(FX-501~590,90 条)

来源:FX 调研 agent(2026-10-08),逐条 file 实证。约束:帧预算 ≤4ms、零分配对象池、不引库、无流体电磁、不真 DOF、prefers-reduced-motion 冻结。开销档:轻<0.2ms/中0.2~1ms/重1~4ms。

## A. 粒子与碰撞表现(FX-501~514)

| # | 位置 | 内容 | P | 量 | 开销 | 状态 |
|---|---|---|---|---|---|---|
| FX-501 | juice spawnRing | 碰撞环随冲击缩放+色阶:strength 0.1→0.3m 细环淡金,1.0→2.2m 粗环亮白金;color 在 0xd9a441↔0xfff0d0 lerp,终径×(0.6+strength),opacity 峰×strength | P1 | S | 轻 | ✅B4a |
| FX-502 | juice 碎片池 | 高强 ceramic 撞击(>0.55)补 4~6 枚四面体碎片:池 16 Mesh(Tetra 0.03),材质色继承撞击体,抛物线+自旋 0.6s 回池 | P1 | M | 中 | ⬜ |
| FX-503 | runtime→juice | 持续接触摩擦微尘:接触对存活+切向相对速度>0.8 → 8Hz 限频 1~2 粒 rubber 尘(per-pair 冷却) | P2 | S | 轻 | ⬜ |
| FX-504 | runtime 轨迹→juice | 滚动轨迹尘:纯滚动(ωr≈v)速度>1.5 每 0.06s 触地点 1 粒 0.4s 尘,配额≤40 | P2 | S | 轻 | ⬜ |
| FX-505 | juice tick | 火花拖尾:ceramic 粒子速度>2.5 拉长短线——LineSegments 池 128×2 顶点,尾点=位−vel·0.03 | P2 | M | 中 | ⬜ |
| FX-506 | juice 材质 | 粒子尺寸分级:单 size 0.13 → 大小两套 Points(0.08/0.18 按 strength 分配) | P2 | M | 轻 | ⬜ |
| FX-507 | juice spawnRing | 碰撞环贴接触法向:固定 rotation.x=-π/2 → 由 contactNormals/双方连线构四元数,墙面环垂直贴墙 | P1 | M | 中 | ✅B4a |
| FX-508 | juice tickRings | 强撞双圈回波:strength>0.6 延迟 90ms 激活第二环(0.7 倍径,opacity 减半) | P3 | S | 轻 | ⬜ |
| FX-509 | juice 环材质 | 闪光芯辉光化:CircleGeometry 纯色 → 径向渐变贴图(复用 makeSoftTexture),过曝边缘柔化 | P2 | S | 轻 | ⬜ |
| FX-510 | juice TINT | 粒子双色渐变:每 timbre 加边缘色,spawn 按 r01 核心↔边缘插值(火花中心白热外缘橙) | P3 | S | 轻 | ⬜ |
| FX-511 | workbench 抓取→juice | 抓取拖动贴地拖尘:grabState 速度>2 且离地<0.12 → 10Hz 单粒尘 | P3 | S | 轻 | ⬜ |
| FX-512 | runtime spawnDrop→juice | 出生落地保底尘:4cm 落地冲量低于 0.03 门槛被吞 → 门槛放宽 0.02+保底 6 粒 | P2 | S | 轻 | ⬜ |
| FX-513 | juice 粒子材质 | 粒子亮度随环境自适应:environmentIntensity 变化时 opacity 按比例微调(0.85×k,k 钳 0.8~1.2) | P3 | S | 轻 | ⬜ |
| FX-514 | perfHud | FX 预算可视化:HUD 加 juice.state() 摘要行(活粒子/环数/trauma) | P1 | S | 轻 | ✅B4a |

## B. 运动表现力(FX-515~526)

| # | 位置 | 内容 | P | 量 | 开销 | 状态 |
|---|---|---|---|---|---|---|
| FX-515 ✅B4b | viewport updateTrails+runtime trails | 轨迹线速度渐变着色:点按采样 speed 映射色(慢蓝 0x5b8dd9→快琥珀→极快红);geometry color attribute+vertexColors;trails 点改四元组 | P1 | M | 中 | ⬜ |
| FX-516 | viewport updateTrails | 轨迹尾端渐隐:最老 30% 点叠一条 opacity 0.25 分段线(无 shader) | P3 | S | 轻 | ⬜ |
| FX-517 | viewport updateVelocityArrows | 速度箭头平滑:方向/长度指数平滑 lerp 0.35,消抖动毛刺 | P1 | S | 轻 | ⬜ |
| FX-518 | viewport+workbench | 受力箭头数值标签(开关):N/f/g DOM 浮签钉箭头顶点(screenPosOf 已有),默认关,标签池复用 | P1 | M | 中 | ⬜ |
| FX-519 | viewport 残影池 | 运动残影:速度>3 克隆轮廓 2 层(池化 60ms 采样,opacity 0.18/0.09,0.25s 淡出,仅运行态) | P2 | M | 中 | ⬜ |
| FX-520 | runtime trails 采样 | 轨迹点距均匀:每 2 步一点 → 位移累计≥0.03m 落点 | P2 | S | 轻 | ⬜ |
| FX-521 | viewport 角速度环 | 角速度指示:转台/滚动球绕轴环形箭头(密度/转速映射 ω),挂 arrowsOn | P2 | M | 中 | ⬜ |
| FX-522 | viewport 速度箭头 | 箭头速度映射色:青↔琥珀 lerp(与轨迹同源) | P2 | S | 轻 | ⬜ |
| FX-523 | viewport updateForceArrows | 加速度突变脉冲:碰撞帧 |Δa| 超阈值 → 青箭头 150ms 增亮脉冲 | P3 | S | 轻 | ⬜ |
| FX-524 | viewport updateTrails | 轨迹等时节拍点:每 0.5s 模拟时落 0.02m 小点(Points 池≤64)——疏=快密=慢 | P1 | S | 轻 | ⬜ |
| FX-525 | viewport 抓取线 | 抓取牵引线:指针落点→质心细虚线,距离越远越红,松手消 | P2 | S | 轻 | ⬜ |
| FX-526 | viewport releaseGrab | 抛掷预测线:甩出瞬间按抛体解析式采样 12 点虚线弧 0.6s 淡出(纯装饰) | P2 | M | 中 | ⬜ |

## C. 镜头语言(FX-527~538)

| # | 位置 | 内容 | P | 量 | 开销 | 状态 |
|---|---|---|---|---|---|---|
| FX-527 | juice applyShake | 碰撞指向性震动:撞击点投影屏幕方向叠加 1~2px 推移回弹(shake 向量+dir·mag·0.4) | P1 | M | 轻 | ✅B4a |
| FX-528 | juice applyShake | 震频分级:小撞 60Hz 高频小幅/中 40/大撞 22Hz 低频大幅(查表) | P2 | S | 轻 | ✅B4a |
| FX-529 | viewport tickFocus/tickPose | 聚焦飞行缓动分级:固定 lerp → 时间参数化 cubic-in-out(0.6s 标准/1.2s 叙事) | P1 | M | 中 | ⬜ |
| FX-530 | presets+flyToPose | 预置开场镜头叙事:opening 字段{wide,hero} 两段飞行 0.9s→0.7s,reduced-motion/用户接管跳终态 | P2 | M | 中 | ⬜ |
| FX-531 ✅B4b | workbench+viewport fog | 子弹时间伪景深:0.25x/0.1x 时 fog near 16→9+全屏 vignette DOM 层 opacity 0→0.3(0.4s) | P1 | S | 轻 | ⬜ |
| FX-532 ✅B4b | maybeBulletTime 旁 | 强撞 hitstop 微顿:strength>0.7 → timeScale 0.35 持续 60ms(独立 0.8s 冷却) | P1 | S | 轻 | ⬜ |
| FX-533 | viewport 追焦 | 选中体运动追焦:controls.target lerp 0.02/帧 微跟随(可关,拖相机即断) | P2 | M | 中 | ⬜ |
| FX-534 | viewport tickZoom | 缩放终点缓出:固定 0.2 → 自适应(0.12+0.25·min(1,dist/goal)) | P2 | S | 轻 | ⬜ |
| FX-535 | juice+render | 撞击 FOV 微冲:strength>0.5 → fov 42→42.6 单帧脉冲 120ms 回 | P2 | S | 轻 | ⬜ |
| FX-536 | viewport tickPose | 观察点飞行弧线:>3m 路径中点抬高 0.12·dist 二次贝塞尔 | P3 | M | 中 | ⬜ |
| FX-537 | setSpeed | 慢动作降饱和:0.1x 时 exposure 1.06→0.98+env 0.55→0.42(0.3s),回 1x 复原 | P2 | S | 轻 | ⬜ |
| FX-538 | reset+applyFrame | 重置回卷感:有录制时 0.3s 快速倒放(反向 3 帧/帧)再 rebuild | P2 | M | 中 | ⬜ |

## D. 声音(FX-539~552)

| # | 位置 | 内容 | P | 量 | 开销 | 状态 |
|---|---|---|---|---|---|---|
| FX-539 | sound 持续音部 | 滚动摩擦持续音:纯滚动 speed>0.3 → 带通噪声 250Hz+lowpass 800,gain=speed 封顶 0.12,最多 2 声部,停滚 0.2s 淡出 | P1 | M | 中 | ⬜ |
| FX-540 | sound 弹簧 | 弹簧谐振吱呀:|dΔx/dt|>0.4 → 60→95Hz sine 扫频短音(gain 随 F/k 封顶 0.08,冷却 0.3s) | P2 | M | 中 | ⬜ |
| FX-541 | sound 绳 | 绳绷紧音:T 首超 0.8·mg → 1200Hz 高 Q 单模态「绷」(attack 1ms decay 0.08,每绳冷却 0.4s) | P1 | S | 轻 | ⬜ |
| FX-542 | sound 传送带 | 带运行底噪:lowpass 白噪 120Hz+100Hz hum,gain 随\|v\| 封顶 0.07,多带共享声部 | P2 | M | 中 | ⬜ |
| FX-543 | sound impact | 多声源 pan 平滑:pan 突变>0.3 → 0.1s setTargetAtTime 滑向目标 | P3 | S | 轻 | ⬜ |
| FX-544 | sound gainOf | 音量包络精修:幂 0.7 → 分段幂(小撞 0.6/大撞 0.85)16 档查表;p33 单调断言口径保持 | P2 | S | 轻 | ⬜ |
| FX-545 | sound impact detune | 音高随质量:±6% detune 上叠质量因子(轻升重降,钳 ±8%) | P1 | S | 轻 | ✅B4a |
| FX-546 | sound ui() | 状态音三连精修:play=620→880 双 tick/pause=下行/reset=三连 | P2 | S | 轻 | ⬜ |
| FX-547 | sound voice | 慢动作音调下移:detune×timeScale 音高因子(0.25x→-5 半音,0.1x→-7) | P2 | S | 轻 | ⬜ |
| FX-548 | sound voice | 距离低通:att 同时驱动每 voice lowpass(近 12k→远 2.2k) | P1 | S | 轻 | ✅B4a |
| FX-549 | sound impact | 碰撞风暴并簇:同帧 dropped≥3 → 下帧内合并为能量叠加 voice(封顶 1.2×) | P2 | M | 中 | ⬜ |
| FX-550 | sound 主链 | 教室微混响:ceramic 大撞后挂一次性延迟回声(delay 0.11s 反馈 0.15 -8dB)单共享节点 | P3 | M | 中 | ⬜ |
| FX-551 | workbench drain | 静音视觉等价:muted 时强撞仍走环+hitstop+FOV(视路照常),测试钉住 | P1 | S | 轻 | ✅B4a |
| FX-552 | sound HUD | 声音仪表化:voices 最近 8 声 mini 强度条 HUD(24px canvas 4Hz) | P3 | S | 轻 | ⬜ |

## E. UI 与视口联动(FX-553~562)

| # | 位置 | 内容 | P | 量 | 开销 | 状态 |
|---|---|---|---|---|---|---|
| FX-553 | updateReadouts | 检查器运行中数值流动高亮:变化率>阈值 → 该行 150ms 琥珀脉冲 | P1 | S | 轻 | ⬜ |
| FX-554 | drawCurves | 曲线实时游标:当前时刻竖线+曲线末端圆点+最新值文本 | P1 | S | 轻 | ⬜ |
| FX-555 | 事件卡/解释卡 | 事件卡入场动效:translateY(6px)+opacity 120ms ease-out,reduced-motion 禁 | P2 | S | 轻 | ⬜ |
| FX-556 | toast | toast 出场 transition(0.18s opacity+4px 下移);连续消息换字不闪容器 | P2 | S | 轻 | ⬜ |
| FX-557 | Space 处理 | 运行按钮键鼠同反馈:Space 触发时按钮 100ms 脉冲 class | P2 | S | 轻 | ⬜ |
| FX-558 | setSpeed | 倍率档位刻度 HUD:modeChip 旁 6 档刻度点,换档数字脉冲 120ms | P2 | S | 轻 | ⬜ |
| FX-559 | setHighlights | 选中盒渐入:BoxHelper opacity 2 帧 ramp(0.35/帧) | P3 | S | 轻 | ⬜ |
| FX-560 | 叠加层开关 | 叠加层淡入淡出:trails/vectors/forces opacity 200ms 过渡(每帧 lerp 0.25) | P2 | S | 轻 | ⬜ |
| FX-561 | replayBar | 回放 scrub 刻度:每 5s 刻度线+拖动 tooltip(帧号/时刻) | P3 | S | 轻 | ⬜ |
| FX-562 | 材质目录 | 材质球 hover 微动:scale 1.08+tooltip,选中琥珀描边(纯 CSS) | P3 | S | 轻 | ⬜ |

## F. 教学表现(FX-563~572)

| # | 位置 | 内容 | P | 量 | 开销 | 状态 |
|---|---|---|---|---|---|---|
| FX-563 | updateForceArrows | 矢量分解过渡动画:切分解时新箭头从合力方向/长度 0.25s 插值归位 | P1 | M | 中 | ⬜ |
| FX-564 | explain+viewport | explain 结论视口浮签:锚定实体屏幕投影,屏外收边缘箭头,开关默认关 | P2 | L | 中 | ⬜ |
| FX-565 | viewport+workbench | 选中体数据浮签:体旁 m/v/p 三行迷你面板(DOM 投影 0.15s 节流) | P2 | M | 中 | ⬜ |
| FX-566 | 对比模式 | 上次运行幽灵对比:recFrames 以 20% 灰 ghost 回放上次位姿(开关式) | P3 | L | 重 | ⬜(缓办) |
| FX-567 | 守恒条 | 能量条呼吸:数值变化率映射条端 2px 脉冲(KE 骤降可见掉格闪光) | P2 | S | 轻 | ⬜ |
| FX-568 | registry vertCircle | 环顶临界标记:过环顶高度 → 标记点+浮签「v_top=xx」(开关) | P2 | M | 中 | ⬜ |
| FX-569 | timer+viewport | 光门触发闪光:crossedT 命中 → 光门线 emissive 脉冲 200ms+tick 音 | P1 | S | 轻 | ⬜ |
| FX-570 | sensorReadings | 传感器读数视口化:speed/forceSensor 读数小浮签跟随实体 | P2 | M | 中 | ⬜ |
| FX-571 | recording+viewport | 抛体顶点标记:vy 正转负 → 轨迹顶点标记+h_max 浮签(单次) | P2 | S | 轻 | ⬜ |
| FX-572 | 阿特伍德 | 张力色带:连线颜色随 T 灰→琥珀渐变 | P3 | S | 轻 | ⬜ |

## G. 光影氛围(FX-573~580)

| # | 位置 | 内容 | P | 量 | 开销 | 状态 |
|---|---|---|---|---|---|---|
| FX-573 | presets+viewport init | 预置 env 氛围差异化:mood 字段(studio/night/class)→environmentIntensity/fog/rim,0.5s lerp | P1 | M | 中 | ⬜ |
| FX-574 | materials+celestial | 恒星点光源:恒星位置 PointLight(0xffc46b,decay 2 不投影),卫星明暗面 | P2 | S | 轻 | ⬜ |
| FX-575 | materials+juice | 强撞反光微变:strength>0.5 → 双方 clearcoat +0.15(0.15s 回落,仅 Physical 材质) | P3 | M | 中 | ⬜ |
| FX-576 | viewport 网格 | 运行态网格退隐:run 时网格/轴 opacity 0.85→0.5(0.4s),重置复原 | P2 | S | 轻 | ⬜ |
| FX-577 | viewport fog | 雾随相机距离自适应:near/far 按相机-target 距离 k 缩放(0.6k~2k) | P3 | S | 轻 | ⬜ |
| FX-578 | viewport 主光 | 预置时段光色:morning(0xfff1dd)/dusk(0xffd2a0 低角度)两档 | P3 | S | 轻 | ⬜ |
| FX-579 | viewport env | HDRI 缓旋(天体档):night mood 背景 0.002rad/s 缓移(仅运行态) | P3 | S | 轻 | ⬜ |
| FX-580 | renderMaterialSwatches | 材质球双氛围:night 变体 env,mood 切换目录重渲(缓存两套) | P3 | S | 轻 | ⬜ |

## H. 节奏手感(FX-581~590)

| # | 位置 | 内容 | P | 量 | 开销 | 状态 |
|---|---|---|---|---|---|---|
| FX-581 ✅B4b | maybeBulletTime/setSpeed | 子弹时间进出缓动:timeScale 每帧向目标 lerp 0.12(约 0.4s) | P1 | M | 中 | ⬜ |
| FX-582 | 单步按钮 | 单步步进视觉确认:视口四边 1px 琥珀描边闪 120ms | P2 | S | 轻 | ⬜ |
| FX-583 | reset 无录制路径 | 重置回卷感(表现层):快照当前位姿,rebuild 后 0.25s lerp 回初始(仅视觉) | P1 | M | 中 | ⬜ |
| FX-584 | 运行态 HUD | 运行专注模式:运行 3s 后次要 HUD 再降 30%,编辑/暂停恢复 | P3 | S | 轻 | ⬜ |
| FX-585 | wheel | Alt+滚轮换时间档:运行态六档步进,toast 报档 | P2 | S | 轻 | ⬜ |
| FX-586 | 高亮材质 | 暂停态选中呼吸:选中盒 opacity 0.9↔0.7 正弦(1.2s) | P2 | S | 轻 | ⬜ |
| FX-587 | replay | 回放事件节拍音:经过录制碰撞时刻 → ui tick(gain 0.05) | P3 | S | 轻 | ⬜ |
| FX-588 | perfmon+juice | 帧预算自动降级链:spike20 超阈值 → 粒子减半→震幅×0.6→环减半,5s 滞回回升 | P1 | M | 中 | ⬜ |
| FX-589 | 设置 | FX 总开关三档:全/精简/关(粒子+震屏+环+状态音联动,localStorage) | P2 | S | 轻 | ⬜ |
| FX-590 | 全局 | prefers-reduced-motion 全局冻结:统一 matchMedia 探针——粒子/震屏/环/hitstop/FOV 禁发,镜头直跳终态;**现状 src 零处理(红线必落)** | P1 | M | 中 | ✅B4a |

B4a 验证口径:FX-551 由 p33-play 新增断言钉住(静音下 shake/环照发);FX-590 用 emulateMedia reduce 冒烟;其余目检+样张。
