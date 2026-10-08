# R5 模型轨道调研全表(MOD-501~580,80 条)

来源:模型库调研 agent(2026-10-08)。A 新模型 50 条/B 现有 29 模型质量 30 条。优先五项:MOD-567(launcher 理论值错)/562/578(题设与布局两张皮)/568(文案自相矛盾)/580(p41 缺 10 fixture 断言)。

调研完成。已通读 `D:\mechanica-lab-r4\tools\fixtures\` 全部 29 个 fixture、`src\engine\parse-schema.js`、`src\engine\explain.js`、`src\engine\registry.js`、`src\engine\presets.js`、`tools\ui-test\p41-model-coverage.mjs`。

**现有模型清单(29 个 fixture)**：
- 运动学：freefall(自由落体双球)、inertia(惯性)、vertical-throw(竖直上抛)、horizontal-throw(平抛)、oblique45(斜抛45°)、projectile(斜抛一般角)
- 碰撞动量：momentum(一维对撞e=0.8)、momentum2d(二维斜碰)、elastic(e=1等质量)、inelastic(e=0共速)、bullet-block(子弹打木块)、recoil(等质量反冲)、chase(追及)
- 摩擦与斜面：incline(光滑斜面)、friction-race(刹车对比)、plank(板块)、conveyor(传送带轻放)、rolling(纯滚动)、ramp-race(滚滑赛跑)
- 振动与转动：spring(弹簧振子)、damped(阻尼)、coupled(耦合双振子)、launcher(弹射器)、hinge(复摆)、spin/spin-real(转台角动量两版)、atwood(阿特伍德)
- 天体：celestial(圆轨道)、elliptic(椭圆轨道)
- 注意：presets.js 已有单摆/圆锥摆/竖直圆周/牛顿摆/双星/三星/失重等 31 个**场景预置**(无题目文本与 explain 分支)，下文部分条目为“预置→教学 fixture 化”；p41 EXPECT 表仅覆盖 19 个 fixture(缺 10 个，见 MOD-580)。

## A. 新模型 fixture(MOD-501~550)

| 编号 | 模型/文件 | 内容(一句话题目+布局+explain 要点) | P | S/M/L |
|---|---|---|---|---|
| MOD-501 | 单摆(绳系球) parse-pendulum.json | L=1.0m 轻绳系 0.5kg 球拉开小角由静止释放求周期；布局=固定锚box+球+attaches rope(通用路径可承)；explain 新增 explainPendulum:小角 T=2π√(L/g)≈1.99s,峰间隔测周期，窗口8% | 高 | M |
| MOD-502 | 单摆摆长对照 parse-pendulum-compare.json | 双摆 L=1.0/0.5m 同角齐释，验证 T∝√L(T 比 1:√2≈0.707);布局=两锚+两球+双 rope;explain 扩展 501 分支做双摆周期比 | 高 | M |
| MOD-503 | 圆锥摆 parse-conical.json | 绳 1m 球给切向初速做水平匀速圆周，求周期与锥角关系；布局=锚+球+rope(球题给切向 v);explain 新分支：稳态锥角 θ 下 T=2π√(L·cosθ/g)、F向=mg·tanθ=m v²/(L sinθ) | 高 | M |
| MOD-504 | 竖直圆周绳系球(临界速度) parse-vert-circle.json | 绳 0.8m 球在最低点以 v0=√(5gL)≈6.32 入轨，判断能否过顶；布局=锚+球+rope+初速；explain 新分支：顶部临界 v_top=√(gL)、机械能 ½v0²=½v_top²+2gL、张力差 T底−T顶=6mg | 高 | M |
| MOD-505 | 水平圆周(绳系球测向心力) parse-horiz-circle.json | 光滑面绳系球 v=2m/s r=1m 匀速圆周，求周期与向心力；布局=固定锚+球+rope+切向初速；explain 新分支：轨迹圆拟合 r、T=2πr/v=3.14s、F=mv²/r=2N | 高 | M |
| MOD-506 | 竖直弹簧振子 parse-spring-vert.json | k=25 弹簧上端固定下挂 1kg 球竖直振动，验证 T=2π√(m/k)=1.26s 与重力无关；布局=固定锚box+球+spring(通用路径，重力保留)；explainSpring 三轴方差选主轴已支持竖直，直接复用 | 高 | S |
| MOD-507 | 胡克定律静态伸长 parse-hooke-static.json | k=20 弹簧挂 2kg 砝码静止，测静伸长 x=mg/k=1.0m 反证 F=kx;布局同 506(无初速)；explain 新静态分支：末段位移均值 vs mg/k,窗口5% | 高 | M |
| MOD-508 | 弹簧串联 parse-spring-series.json | 两 k=20 弹簧经轻质中间环串接挂 1kg 球，k_eff=k/2=10,T 增至√2 倍；布局=墙锚+中间fixed box+球，attaches 2 条链式；explain 扩展 explainSpring 识别串联给等效劲度 | 中 | M |
| MOD-509 | 弹簧并联 parse-spring-parallel.json | 墙与球之间并接两条 k=20 弹簧，k_eff=2k,T 除以√2;布局=墙锚+球+attaches 2 条同端点；explain 扩展并联 k_eff=k1+k2 | 中 | M |
| MOD-510 | 弹簧弹开双车 parse-spring-launch-pair.json | m1=1 与 m2=2 两球间弹簧压缩 0.8m(restLength 2.0 安装距 1.2)释放弹开，验证 p=0、v1=2v2、½kx²=½m1v1²+½m2v2²;布局=通用两球+attach;explain 新分支(无碰撞报告，势能动能账+动量零) | 高 | M |
| MOD-511 | 三球两弹簧链(简正模式) parse-spring-chain3.json | 端固定链 wall–k–A–k–B(k=20,m 各1),中间球拉开释放，测两简正频率；布局=固定锚+2球+2 attach;explain 新分支：双峰检测得 ω 比 1:√2(大学简正模态) | 中 | M |
| MOD-512 | 拍现象 parse-beats.json | 双振子 m=1.0/1.1 弱耦合 k=3,能量往复转移周期(拍)=2π/Δω;布局=coupled 同款+质量不等；explain 扩展：动能包络峰间隔测拍周期 | 中 | M |
| MOD-513 | 阻尼对照 parse-damped-compare.json | 两并排振子 damping=0.3/3.0,包络衰减率比 10:1;布局=两锚+两球+双 spring;explain 扩展 spring 分支支持多振子逐个测对数衰减率 δ=ln(A_n/A_{n+1}) | 中 | M |
| MOD-514 | 受迫振动与共振 parse-resonance.json | 弹簧悬挂端按 A·sinωt 简谐驱动，扫至 ω≈ω0 振幅出峰；布局需引擎支持运动学锚点轨迹驱动(spring 端点受迫)；explain 新分支：稳态振幅 A(ω)=A0/√((1−r²)²+(2ζr)²) | 高 | L |
| MOD-515 | 耦合摆 parse-coupled-pendulum.json | 两单摆+中间弱弹簧 k=2,对称/反对称模态频率 √(g/L) 与 √(g/L+2k/m);布局=两锚+两球+2 rope+1 spring(attaches≤6 可容)；explain 新分支：双模态频率分裂 | 中 | M |
| MOD-516 ✅B2 | 竖直下抛 parse-vertical-down.json | h=1.8m 处以 vy=−4 下抛，求落地时间与末速 v=√(v0²+2gh)=7.2m/s;布局=单球抛体布局(自动补地面，projBalls 分支)；explainProjectile 公式已覆盖 vy0<0,纯 fixture | 高 | S |
| MOD-517 ✅B2 | 三球自由落体 parse-freefall3.json | 质量 0.2/2/5kg 三球同高 2.5m 齐落同时落地；布局=freefall 同款三球(位置高+无初速，重力保留)；explainFreefall rows 已支持 N 球，multi 同落判定扩到三球 | 高 | S |
| MOD-518 | 落体与下抛对比 parse-freefall-vs-down.json | 同高 2m 甲静止释放、乙同时 vy=−3 下抛，求落地时刻差 Δt≈0.13s;布局=双球一静一抛；explain 需放宽 freefall“全零初速”条件做双球时刻对比分支(注意：现通用布局对带初速球强制悬浮 gravityScale=0,抛体例外需扩展) | 高 | M |
| MOD-519 | 平抛初速无关性 parse-horizontal-throw2.json | 同高 1.6m 两球 vx=2/4 同时平抛同时落地；布局=双球抛体版(同 518 注：需保留重力的多球抛体布局)；explain 扩展 galileo 分支支持双 mover 同落 | 高 | M |
| MOD-520 | 斜抛 30°/60° 等射程 parse-range-symmetry.json | v=6 两球 30°/60° 同点齐射，射程相等 3.12m 而高度不同(0.45/1.35m);布局=双球抛体版；explain 新分支双弹道射程对比+对称性 sin2θ | 高 | M |
| MOD-521 ✅B2 | 斜抛 60° 通式 parse-oblique60.json | v=6 θ=60° 单球：T=2vsinθ/g=1.04s、R=v²sin120°/g=3.12m、H=1.35m;布局=单球抛体布局自动；explainProjectile 原样复用，纯 fixture | 高 | S |
| MOD-522 ✅B2 | 月面斜抛 parse-oblique-moon.json | gravity=1.6,v=5 θ=45°,射程放大到 15.6m,验证 R∝1/g;布局=单球抛体+题给重力；explainProjectile 读 doc.gravity 原样可用 | 中 | S |
| MOD-523 ✅B2 | 完全弹性大撞小 parse-elastic-heavy-light.json | 2kg v=2 撞 1kg 静止 e=1:v1′=v0/3、v2′=4v0/3 都前进；布局=通用双球；explainMomentum e=1 闭式公式直接覆盖 | 高 | S |
| MOD-524 ✅B2 | 完全弹性小撞大 parse-elastic-light-heavy.json | 1kg v=2 撞 2kg 静止 e=1:v1′=−v0/3 原路回弹(入射速度反向判据)；布局同上；explain 同上 | 高 | S |
| MOD-525 ✅B2 | 完全弹性追尾 parse-elastic-rear.json | 等质量同向 3m/s 追 1m/s,e=1 速度交换；布局=双球同向；explainMomentum 覆盖 | 高 | S |
| MOD-526 ✅B2 | 相向对撞动量为零 parse-elastic-headon.json | 等质量 ±2 相向 e=1,交换后各自反向、总动量恒 0;布局=双球相向；explainMomentum 覆盖(p0=0 门控注意除零保护) | 高 | S |
| MOD-527 ✅B2 | 中等弹性 e=0.5 parse-collision-e05.json | 2kg v=2 撞 1kg 静止 e=0.5,验证恢复系数公式与动能损失账；布局=双球+restitution 0.5;explainMomentum 覆盖 | 高 | S |
| MOD-528 | 二维弹性 90° 散射 parse-momentum2d-right.json | 等质量 e=1 非对心(z 偏移 0.15)斜碰，碰后两速度矢量成 90°(台球定理)；布局=momentum2d 同款改 e=1;explainMomentum2D 加“散开夹角≈90°”check | 高 | M |
| MOD-529 | 三球弹性链式传递 parse-ball-chain3.json | 三等质量球贴排，甲 2m/s 撞，速度逐级传递末端出射 2m/s 前两球停；布局=三球贴排 e=1;explain 扩展：按碰撞事件序列逐对核对(momentum 分支现只取一对报告) | 高 | M |
| MOD-530 | 子弹三连发 parse-bullet-burst.json | 三颗 0.02kg 子弹(错开 x=−1/−2/−3,v=15)先后嵌入 1kg 木块，终速 Σmv/Σm=0.849m/s;布局=通用 3 球+box;explain 新分支：多段完全非弹性累加 | 中 | M |
| MOD-531 ✅B2 | 不等质量反冲 parse-recoil-unequal.json | 静止系统分裂为 1kg 与 2kg,速度比 2:1 反向、动能比 2:1;布局=recoil 同款改质量；explainMomentum 验证 p 恒 0 | 高 | S |
| MOD-532 | 粗糙斜面下滑 parse-incline-friction.json | θ=30° μ=0.2 滑块下滑 a=g(sinθ−μcosθ)=3.27m/s²,滑完 2m 坡 v=3.62m/s;布局=ramp+box 贴坡(通用)；explainIncline 需扩展 μ>0 口径(现按能量守恒 v=√(2gΔh) 会误判) | 高 | M |
| MOD-533 | 冲上斜面 parse-incline-up.json | 滑块以 v0=4 沿坡向上冲 θ=30°(μ=0),a=g sinθ 上滑距离 v0²/2a=1.6m 后折返；布局=坡底 given.position+负 x 初速；explain 新分支(现 incline 分支只测 +x 出坡速度) | 高 | M |
| MOD-534 | 斜面叠块 parse-incline-stacked.json | 坡上 M=1 大块叠 m=0.5 小块，块间 μ1=0.5、块坡 μ2=0.1,验证一起下滑 a=g(sinθ−μ2cosθ)=4.13 且上块不打滑(μ1≥a/(g cosθ)=0.477);布局=ramp+双box 贴坡叠放(given.position);explain 新分支：整体加速度+上块摩擦力上限核对 | 中 | M |
| MOD-535 | 伽利略斜面理想实验 parse-galileo-ramps.json | 球从左坡 θ=30° 滑下冲上对面光滑右坡，回升到等高 h(无摩擦 never 超过)；布局=双 ramp 对置——现 rampGeom 只取第一个 ramp,需多斜面布局小扩展；explain 新分支：回摆高度比 h′/h≈1 | 高 | M |
| MOD-536 | 滑轮连接体(坡-坡/坡-悬) parse-pulley-incline.json | 绳跨坡顶定滑轮连两侧坡上滑块(或一坡一悬)，a=(m1g sinθ1−m2g sinθ2)/(m1+m2);现 pulley 布局只支持双竖直球 onPulley,需绳-滑轮-多体路由小扩展 | 高 | L |
| MOD-537 ✅B2 | 传送带反向 parse-conveyor-reverse.json | 带速 −0.8m/s 上轻放物体，物体向 −x 加速 t1=v带/μg=0.4s 后共速反向输运；布局=conveyor speed 负值(RANGES 已容 ±8);explainConveyor 的 sgn 逻辑已支持，纯 fixture | 高 | S |
| MOD-538 | 传送带超速物体 parse-conveyor-fast.json | 物体以 v0=1.6 同向放上带速 0.8 的带，μ=0.2 减速段 t=|v0−v带|/μg=0.4s 后共速；布局=conveyor+球题给初速；explainConveyor 需扩展(现按轻放 v0=0 口径) | 高 | M |
| MOD-539 | 物体滑离带端 parse-conveyor-exit.json | 带长 0.8m、带速 2.0、μ=0.2,物体未及共速即滑离，出带速度 v=√(2μgL)=1.79m/s;布局=conveyor length 0.8;explainConveyor 需“滑离未共速”口径(现只报“带太短未观察”) | 中 | M |
| MOD-540 ✅B2 | 双星互绕 parse-binary.json | 两星各 60kg 相距 6,各以 v=√(Gm/2d)=2.24 绕质心做圆运动；布局=双 celestial 对称反向切速(归一化逻辑已保 xz 切向)；explainAstro 的 mSum 周期公式(AB-18)已支持 | 高 | S |
| MOD-541 | 三星拉格朗日解 parse-three-body.json | 三星 30kg 等边三角(边长 d)绕质心圆运转，每星受合力 √3Gm²/d² 指向质心；布局=3 celestial;explainAstro 需扩展按质心距 r=d/√3 与 mSum=90 给周期理论值 | 中 | M |
| MOD-542 | 开普勒第三定律双卫星对照 parse-kepler3.json | 恒星 100+两卫星 r=3(v=5.77)/r=6(v=4.08),周期比 (6/3)^1.5=2.83;布局=3 celestial 各自圆轨；explain 扩展为逐卫星周期测量与比值验证 | 高 | M |
| MOD-543 | 逃逸速度 parse-escape.json | r=4 处以 v=√2·v圆=7.07 入轨恰逃逸，验证机械能 E≥0 判据；布局=双 celestial(速度超圆轨)；explainAstro 现把逃逸判 fail,需加“逃逸成功”教学口径(E=½v²−GM/r≥0) | 高 | M |
| MOD-544 ✅B2 | 深椭圆轨道 parse-elliptic-deep.json | v=0.8v圆=4.0 入轨，r=4 成远点，e=0.2 深椭圆，近日/远日速度比 (1+e)/(1−e)=1.5;布局=双 celestial;explainAstro 已合法化椭圆(UX-R),纯 fixture | 高 | S |
| MOD-545 ✅B2 | 复摆杆长变体 parse-hinge-l15.json | L=1.5m 均质杆绕端点，T=2π√(2L/3g)=1.99s(对比 L=1 的 1.62s);布局=hingeLayout 已消费 rod.given.length,纯 fixture | 高 | S |
| MOD-546 | 转台双滑块 parse-spin-two-sliders.json | 转台上两滑块对称同时外滑，ΔI=2mr²,ω 降幅加倍；rotationLayout 现只支持单滑块，需双滑块扩展；explain 扩展 L=(I+Σmr²)ω | 中 | L |
| MOD-547 | 刹车距离验证 parse-braking.json | 单箱 μ=0.25、v0=3m/s 在粗糙地面滑行，验证 a=μg=2.5m/s²、d=v0²/2μg=1.8m、t=1.2s;布局=ground+box(通用)；现单动态体+地面非腾空场景落入 unsupported,需新匀减速 explain 分支 | 高 | M |
| MOD-548 | 竖直环形轨道(离心轨道) parse-loop-track.json | 球沿管轨过竖直环，顶部最小速度判据；registry 有 track 组件但 TYPE_MAP 无 track/onTrack 映射，需 schema+布局扩展；explain 新分支：能量守恒 v_top²=v0²−4gR 与管轨/绳轨临界差异(管轨可 v_top→0) | 高 | L |
| MOD-549 | 失重演示 fixture 化 parse-weightless.json | 力传感器绑定小球随舱自由下落读数→0(视重消失)；weightless 预置已存在但 forceSensor 不在 TYPE_MAP,需传感器实体入 schema+布局；explain:自由落体段接触合力=0 | 高 | L |
| MOD-550 | 电梯超重/失重 parse-elevator.json | 舱以 a=±2m/s² 竖直加速，视重 N=m(g±a) 对比；需 kinematic 电梯平台或 gravityScale 时变的引擎小扩展；explain:N=mg(1±a/g) 双态对照 | 高 | L |

## B. 现有模型质量提升(MOD-551~580,逐个 fixture)

| 编号 | 模型/文件 | 内容(一句话题目+布局+explain 要点) | P | S/M/L |
|---|---|---|---|---|
| MOD-551 | parse-atwood.json | 质量差 1.2/1.0 太小(a=0.91m/s²,噪声占比高)，建议典型值 1.5~2.0 vs 1.0;实体名内嵌质量“左球(重 1.2kg)”与 given.mass 冗余，名字截断 24 字符风险 | 高 | S |
| MOD-552 | parse-bullet-block.json | μ=0.1 下共速后滑行距离仅 0.043m 不可测，建议 μ 降到 0.02~0.05 或提高 v0,使 d=v′²/2μg 可观察；追加滑行距离设问 | 高 | S |
| MOD-553 | parse-celestial.json | goal 只有“观察”无定量设问，建议补 T=2π√(r³/GM)=5.03s 对照目标；observations 三项建议标主次 | 高 | S |
| MOD-554 | parse-chase.json | e=0.3 非教学典型值且题目未设问，建议改 e=1(速度交换型追及)或 e=0;“约 1s 后追上”从 assumptions 升格为设问求 t 与相遇位置 | 高 | S |
| MOD-555 | parse-conveyor.json | explainConveyor 时间窗 t1Err<35% 过松(t1=0.4s 仅约 24 帧)，建议收紧到 15% 或按采样粒度自适应容差 | 高 | S |
| MOD-556 | parse-coupled.json | 无耦合双振子专用 explain 分支(现被 explainSpring 按单振子拿走)，建议补能量交换周期分支或至少门控“双球动能+势能和守恒” | 高 | M |
| MOD-557 | parse-damped.json | 只有定性“阻尼 0.8 欠阻尼”，建议补理论包络 A(t)=A0·e^(−ct/2m) 与对数衰减率实测对照；确认运行时长≥3 个完整周期 | 高 | S |
| MOD-558 | parse-elastic.json | 建议加 p41 结构断言(两球 restitution=1、碰后 A 速≈0);实体名内嵌初速“(2 m/s)”冗余 | 高 | S |
| MOD-559 | parse-elliptic.json | gravity:10 对天体题无意义(应对齐 celestial 惯例 null);goal 一句塞三条观察过长；e≈0.15 的能量方程推导应写进 assumptions | 高 | S |
| MOD-560 | parse-freefall.json | “2m 高”与球心口径差 2r=0.3m(理论 t=0.583s 而非 0.632s,差 8%),建议 keyPoints 直接给球心落差理论值，避免教师手算对照落空 | 高 | S |
| MOD-561 | parse-friction-race.json | 建议加 μ=0.3 中档第三箱(3 车道，斜面/地面自动加宽已支持)与滑行时间观察项；理论 d=2.0/0.33m 可写入 keyPoints 自证 | 高 | S |
| MOD-562 ✅B2pre | parse-hinge.json | assumptions 写“初始摆角 1.2 rad”但 hingeLayout 硬编码 swing=0.4 rad——题设与建场两张皮，改文案或让 layout 消费题给摆角(小扩展) | 高 | S |
| MOD-563 | parse-horizontal-throw.json | 建议补“落地速度方向角 φ=arctan(gt/vx)”观察项；t=0.566s/R=2.83m 自证值写入 keyPoints | 高 | S |
| MOD-564 | parse-incline.json | 球已显式 friction:0,“光滑”语义注入仍会追加冗余 inferred 假设条目；unknowns“半径取默认”与 assumptions 重复；建议加 θ=45° 变体档 | 高 | S |
| MOD-565 | parse-inelastic.json | 等质量动能损失恰 50%,建议写入 observations 作定量目标；p41 加 restitution≈0 结构断言 | 高 | S |
| MOD-566 | parse-inertia.json | 建议 observations 加“任意相等时间间隔位移相等”判据与速度传感器绑定提示；确认运行≥4s 才能读出匀速 | 中 | S |
| MOD-567 ✅B2pre | parse-launcher.json | 实错：goal 标注理论弹速 1.8m/s,但 x√(k/m)=0.4×√40=2.53m/s——修正数值或调参(如 x=0.285)使自洽；建议 damping 0.2→0 使能量账干净 | 高 | S |
| MOD-568 ✅B2pre | parse-momentum.json | 自相矛盾：unknowns 说“恢复系数题目未给需取默认”，assumptions 却说“取 0.8(题目给定)”——删 unknowns 项；悬浮理想化(gravityScale=0)应写进 assumptions | 高 | S |
| MOD-569 | parse-momentum2d.json | 瞄准几何(z 偏移 0.22 vs 半径和 0.30)决定散射角但题面未言明，keyPoints 应写明瞄准参数便于复现；e=1 版让位给新模型 MOD-528 | 高 | S |
| MOD-570 | parse-oblique45.json | 建议补飞行时间 T=2vsinθ/g=0.707s 观察项；assumptions 应写明“落回同高(球心)口径”，否则教师按地面起抛算 R=2.5m 与实测差半径 | 高 | S |
| MOD-571 | parse-plank.json | 定量结论可入 observations:共速 v=m1v0/(m1+m2)=0.3m/s、相对滑移 Δs=v0²/(2(a1+a2))≈0.26m<板长(不滑离)；ground friction 0 已正确 | 高 | S |
| MOD-572 | parse-projectile.json | 起点高 0.6m 使 H=1.05m 而非 0.45m,goal 应写明“含抛点高度”口径；与 horizontal-throw/oblique45 统一坐标系注释(+x 水平/y 竖直) | 中 | S |
| MOD-573 | parse-ramp-race.json | 建议理论到达时间入 keyPoints(滑块 t=1.0s、圆柱 a=g sinθ/1.5 → 1.22s);两车起滑点按各自半径差约 2cm,建议 assumptions 注明起滑口径 | 高 | S |
| MOD-574 | parse-recoil.json | 假设“分裂瞬间内力远大于外力”与悬浮(gravityScale=0,本无外力)场景矛盾，文案自洽化；建议加不等质量变体档(或由 MOD-531 承接) | 高 | S |
| MOD-575 | parse-rolling.json | goal 建议附自证值 v=√(4gh/3)=4.08m/s(h=1.25m);“斜面 0.2 与圆柱 0.2 成对取 min 合成”的机制应写进 assumptions | 高 | S |
| MOD-576 | parse-spin.json | 与 spin-real 定位重叠，建议明确分工：spin 定性观察 I-ω 反比、spin-real 定量求末态 ω;建议 p41 加 prismatic joint 与转台 angvel 结构断言 | 高 | S |
| MOD-577 | parse-spin-real.json | 条件缺失：滑块初始 r=0.7 由 rotationLayout 硬编码，题面与 assumptions 均未写；assumptions 应补“momentOfInertia=6.5 反解盘质量 ½MR²=I 自动生效”与理论末态 ω=22.44/9.88≈2.27rad/s 的验证口径 | 高 | S |
| MOD-578 ✅B2pre | parse-spring.json | 歧义：assumptions“初始拉伸 1.2m”实为安装长(rest 0.8+拉伸 0.4,springLayout 硬编码 stretch=0.4),建议改写为“弹簧安装长 1.2m(原长 0.8+拉伸 0.4)”或让 layout 消费题给振幅 | 高 | S |
| MOD-579 | parse-vertical-throw.json | 建议加“落回速度≈−8m/s(往返对称)”EXPECT 断言与运行时长≥1.6s 保证；可加 v0=12 变体档(H=7.2m,注意取景拉远) | 高 | S |
| MOD-580 | p41-model-coverage.mjs | EXPECT 表仅 19 条，缺 atwood/celestial/hinge/incline/momentum/momentum2d/projectile/spin/spin-real/spring 共 10 个 fixture 未进回归——补全(分别加 atwoodInfo 断言、gravitating 标志、revolute joint、ramp 几何等)；同时在表头注释统一各 explain 理论窗口(3%/5%/8%/35% 并存)的容忍理由，过松的(见 MOD-555)一并对齐 | 高 | S |

**关键实测发现汇总**：567(launcher 理论值算错)、562/578(题设与 layout 硬编码摆角/振幅两张皮)、568(unknowns 与 assumptions 自相矛盾)、580(p41 缺 10 个 fixture 断言)是优先级最高的五项。
