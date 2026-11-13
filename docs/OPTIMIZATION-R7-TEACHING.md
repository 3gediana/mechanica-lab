# R7-TEACHING 优化台账（教学跃迁 + 自检自修闭环 + 余账清偿）

Goal 契约：`docs/GOAL-R7-TEACHING.md`（2026-10-25 用户指令：「我相信你这项目还有一堆问题，除此之外，加强 agent 的教学能力，多样化表达」）。
三战区：A 教学能力跃迁（主体）｜B Agent 自检自修闭环（信任地基）｜C 质量余账（背景节奏）。
入账规则：余账续 R6-xxx，新工作开 R7-xxx；每条完成标准可执行、证据写回。

## 统计

R7 完成 17 | 挂账 0 | 开工 2026-10-26（前沿 1：B1+B2+B3 自检自修；前沿 2：渲染-物理一致性+建场提速+模型切换；前沿 3：A 战区教学跃迁全量+B4 清偿+遗留失败全清）

回归基线（不得回归）：units 158/158（+17 teaching 纯函数）、p49 213/213、p50 29/29（新增）、p52 18/18（+T9）、run-all 55 套全绿（历史首次：p8/p16/p18/p30/w1 遗留失败于 R7-017 清零）、check.py 过。

## 完成矩阵（DONE WHEN 对账，整体 COMPLETE 仅当全部外部可观察）

| 能力 | 用户可见结果 | 入口 | 失败恢复 | 证据 | 状态 | 缺口 |
|---|---|---|---|---|---|---|
| A1 拆题简报 | 建场前 Agent 面板结构化简报（已知/未知/考点/路线分步条目） | Agent 页签评审表单 | — | E3 | COMPLETE(R7-008) | — |
| A2 多通道讲解 ≥4 | 代入卡/聚光/TTS/变式绑定 teach moment | 运行态 teach 卡 | TTS 静默降级、变式失败回原题 | E3 | COMPLETE(R7-009) | — |
| A3 moment 扩展 ≥3 | turn/leaveSurface/equilibrium/sinkFloat 关键点讲解 | 运行态 | — | E3 | COMPLETE(R7-010，链路验 equilibrium+全四检测器单测) | turn/leaveSurface/sinkFloat UI 链路未单独走查（检测器纯函数已锁） |
| A4 讲解节奏分级 | moment 类型→暂停/慢放策略表 | 运行态 | — | E3 | COMPLETE(R7-011) | — |
| A5 课堂放映模式 | 一键放映→定格→录屏成片 | simbar | — | E3 | COMPLETE(R7-012) | — |
| A6 题型覆盖 ≥6 族 | 六族 fixture 金标+真实抽查 | — | — | E3 | COMPLETE(R7-013，fixture 侧；真实抽查已由 z-agentquality 7 题图覆盖) | — |
| B1 建场后 in-app 自检 | 出画/覆盖/画面/主体/物理五探针自动跑，报告进自查面板+徽标+agentOps | 建场自动 | 探针异常不阻塞建场 | E3 | COMPLETE(R7-001) | — |
| B2 自动修复循环 | 重取景/包络补拍/主体特写 ≤2 轮→复检；修不动如实报 | 建场自动/重跑自查 | 如实 warn+建议人工项 | E3 | COMPLETE(R7-001) | — |
| B3 注入故障验证 | 5 类真问题注入→自动修（②③⑥⑨×2），网格缺失诚实失败 | MECH.__injectFault（测试） | — | E3 | COMPLETE(R7-001) | — |
| B4 MOD-505 清偿 | 水平圆周绳锚定 | — | — | E3 | COMPLETE(R7-014，p52-T9 永久锚) | — |
| C1 学生走查 | ux-audit 真实点击 | — | — | E0 | MISSING | 随 A 批次 |
| C2 R6 余账 | R6-181~300 按台账 | — | — | E0 | MISSING | 背景节奏 |
| C3 教学演示片 | 高光+全长双版 | 帮助表 | — | E0 | MISSING | A 完成后 |

## 批次记录

| 编号 | 事项 | 完成标准 | 状态 |
|---|---|---|---|
| R7-001 | **B1 视觉探针进应用本体**：p49 测试侧闸门移植——出画（动态体 NDC 轨迹越限 1.35，世界级出界去重不重复定罪）/可视化覆盖（实体必有可见网格+滑轮对必有跨绳）/画面非退化（现渲 320×180 灰度，**实测环境球柔光条常亮 ~81px，mean/bright 只能抓全黑**）/主体份额（⑨类主判据：动态轨迹 NDC 外接框/画布对角线 ≥8%，实测正常 22%/宽抛体 47%/故障 ≤3.5%，相机过远与巨道具都收口）；建场自动跑，结果进自查报告+阶段徽标+agentOps。相机先 settleFocus（半途相机判定不可信） | units +10 全绿；p49 agent 链零回归；干净链路五探针全 ok（p51 E0） | ✅R7 |
| R7-002 | **B2 自动修复循环 ≤2 轮**：出画→轨迹包络重取景（包络>60m 世界级远走不硬救）；主体/画面→主体特写（**框「动作」=动态网格∪全程轨迹包络**——只框初始位姿会与出画修复互相打架，实测两轮振荡后仍失败）；复检用已存世界轨迹按新相机重投+现渲重采样（不重跑模拟）；修不动如实 warn+建议人工项；视觉类 error skipPatch 不烧模型修订轮次（渲染层问题回喂模型救不了）；patchBrief 同步过滤 | p51 E1~E5 五类故障修复后全绿；E6 网格缺失诚实失败+零修订轮次 | ✅R7 |
| R7-003 | **B3 注入故障验证（p51-selfheal.mjs 19/19）**：R6-038 九类真问题做成可注入故障（MECH.__injectFault，仅测试用）——②取景过近/③行程终点出画（撤包络原案）/⑥抛体落点出画/⑨相机 260m 芝麻/⑨变体 40m 固定巨道具压芝麻，全部检出→修复→复检绿（≥4 类达标）；网格缺失=诚实失败路径；run-all 聚合扩到 p45~49+p51（52 套，p50 随 A 战区入列）；check.py 存在性清单同步 | p51 19/19；p37 16/16、p48 12/12、p49 213/213 定向零回归；run-all 全绿 | ✅R7 |
| R7-004 | **渲染-物理一致性审计（RP-AUDIT，用户 10-27 点单「算出前端实际表现 vs 引擎计算的偏差」）**：实证定性先行（z-devprobe：引擎固定步长 3 次重跑轨迹哈希全同=完全确定性，一切偏差皆系统性，逐条按根因修）——runtime 六修：①编辑态/重置态 `_syncLinks(true)` 链接立即摆位（此前仅运行态首帧同步=「弹簧不显示」根因）②spawnDrop 收窄+`_resolveSpawnDrops` 二次裁定（贴支撑面撤抬升）③链接端点表面化（弹簧/绳端点贴被连体表面，悬空/深埋>6mm 报错）④碰撞事件配对 ID+环境/动力学对分类 ⑤rest-clamp 穿透保护 `_penetrationOf`（深埋体速度置零弹不出=「球莫名卡住」根因）⑥弹簧**表面口径统一**：关节静长=表面距（springSurfacePad）+能量账+力箭头+预设(pad 外移保物理)+parse 布局+explain 理论同源（视觉线圈长=胡克定律用的长度，学生看到的=公式算的）；deco 子件（转台辐条）豁免 26 向嵌入射线（「贴台物体被误判嵌入」根因）；自动修复改「自然静置高」首选+承景类(地面/斜面/轨道/水槽)不抬升+surface-clamp 识别；gravityScale=0 误用守卫（竖直上抛被零重力化=「球一直上升」根因）；rotationLayout 滑块贴台面。事实由 runtime.renderAuditFacts() 直读渲染树+物理体，判定纯函数 `auditRenderPhysics`（出生跳变/网格漂移/端点贴合/幽灵碰撞四类，幽灵碰撞余量=推测接触 rel·h+1cm，骑行对 1s 内重启不重复定罪） | units +N 全绿（auditRenderPhysics 判定/宽限）；p52 15/15（两轮：T1 表面中点口径/T8 agent 计划注入）；z-devprobe 复跑全绿（静止球 0.15→0.14999 不跳/弹簧编辑态即显/埋球全弹出） | ✅R7 |
| R7-005 | **建场提速（用户点单「又快又稳」）**：自查运动探针步进 sleep(8)→sleep(0)+rAF 异步步进（原每 4 物理步等 8ms≈4 倍减速，6.5s 场景探针墙钟 10s+；现 ~0.5s）；z-agentquality 实测 apply+verify **6~15s→0.3~0.7s**；模型修订轮只在「模型可修 error」触发（放置/参数/题意），渲染层 error skipPatch 不烧轮次——整链一次解析调用+确定性建场+确定性自查=PTC 式批量建场（会话研究结论：架构本就 plan-then-apply，真延迟在探针墙钟与修订轮，均已消） | z-agentquality：apply+verify 平均 0.4s；首过零 error 5/10→9/10 | ✅R7 |
| R7-006 | **Agent 模型切换**：step five preview 无额度 → 15730 付费池 apigoto `deepseek-flash`（多模态，数值参数同 step five preview）；serve.py 端点/base/模型名三处 | 文本+图片双通道真实解析通过（16.9s/34.9s 量级，schema 正确） | ✅R7 |
| R7-018 | **模型二切（用户 11-14 点单「换 15730 后端 opencode go deepseek v4.1 flash」）**：15730=本机模型池中转 `127.0.0.1:15730`（OpenAI 兼容，/v1/models 稳定别名 `opencode-go/deepseek-v4.1-flash`）；serve.py STEP_URL/STEP_MODEL 两处手术改动，key 流程与数值口径不动 | 文本 49.8s/图片 9.5s 双通道真实解析通过（图片较 apigoto 34.9s 提速 ~3.7 倍），schema 正确 | ✅R7 |
| R7-007 | **质量门与回归锚**：z-agentquality.mjs 基准工具（7 题图+3 文字题全链：解析→建场→自查→error 分类，计解析/建场耗时）；presets 单测 4 弹簧锚更新表面口径（springSHM/springVert/coupled/springGun，物理量不变仅度量同源 springSurfacePad）；p52-render-consistency.mjs 15 断言入 run-all | units 141/141；run-all 全绿；z-agentquality 9/10（hinge 主体份额偶发一轮，复现通过=模型输出方差非代码缺陷） | ✅R7 |
| R7-008 | **A1 拆题简报**：纯函数 `briefFromPlan`（teaching.js）——已知量键值格（质量/初速/k/L/θ/μ，doc/plan 双形态读取，建场前 plan 优先、建场后 doc 优先按 source:'agent' 判）/未知量/考点（族→考点映射）/解题路线 3~4 步模板（套题面真值，atwood 首步直接给出 a 数值）；评审表单顶部简报卡（仪器级样式） | p50 A1 四断言（卡上屏/族分类/已知量/路线真值）；units brief 2 锚 | ✅R7 |
| R7-009 | **A2 多通道讲解四条**：①代入行 `substitutionLine`（与 explain.js 同公式同口径，单测交叉锁定 atwood a 理论值；无适用公式诚实 null）进 teach 卡+录屏字幕；②聚光 contact/ground 时力箭头临时点亮 3Hz 脉冲（viewport.setForceFlash，窗口后回用户开关态）+曲线面板琥珀虚线打标 t=xx s；③TTS 语音旁白（Web Speech 本地中文，尊重全局静音，speechSynthesis 不可用静默降级——headless 全程零报错即证）；④对比变式 `deriveVariants`（无摩擦/质量减半/初速加倍，规则改文档非模型调用，深拷贝铁律）+「一题多变」面板一键切换（专用通道保留 plan，自查后终态 doc 为基线） | p50 A2a 三断言（代入行非空/进卡/数值=真值）+A2b 两断言（闪烁窗/打标）+A2d 三断言（面板/切换/切回）；units 变式+旁白 4 锚 | ✅R7 |
| R7-010 | **A3 moment 扩展四类**：检测器纯函数（detectTurn/detectLeaveSurface/detectEquilibrium/detectSinkFloat，teaching.js）+ tickTeach 逐帧喂速度/接触/浸没（浸没态读 runtime 浮力环 _vSub 标记）；MOMENT_MAP 扩中文近义（水平折返/抛离/平衡/浮沉…）+ serve.py 提示词枚举同步 | units 四检测器 8 锚；p50 equilibrium 全链触发（落球回弹静止）| ✅R7 |
| R7-011 | **A4 讲解节奏分级**：`TEACH_PACE` 策略表（contact/ground/equilibrium/sinkFloat=真定格 3.8~4.2s 自动续播；highest/lowest/turn=0.25x 慢放；end=5s 收尾）——teachSlowmo 按时机取档替换一刀切 1.6s；教学定格走 `_teachFreezing` 保护（pauseToggle 不当作用户暂停误触 end 讲解）；用户手动暂停/重置随时接管 | p50 A4 三断言（表型/触发即定格/自动续播） | ✅R7 |
| R7-012 | **A5 课堂放映模式**：simbar「放映」钮=重置→录屏→播放→关键点按节奏定格（hold×1.4 课堂阅读档）→end 后 1.6s 自动停录下载 WebM（MediaRecorder 不可用纯放映诚实降级）；哨兵轮询用户重置随时撤 | p50 A5 三断言（开启/自动收尾/零报错） | ✅R7 |
| R7-013 | **A6 题型覆盖 ≥6 族**：sceneFamily 双形态分类（doc 判据+plan 关键词兜底，fixture 六族全命中）金标；p50-teach-elevate.mjs 29 断言全链套件（简报→代入→变式→放映→时机→定格→聚光→六族）入 run-all+check.py | p50 29/29；六族 family 各 ✓ | ✅R7 |
| R7-014 | **B4 MOD-505 清偿**：z-mod505 复现定性——R6-180「系地面丢绳」已被后续批次（R6-036+RP-FIX）消化（绳建出+轨道 r≈0.98 约束生效）；剩余两假阳根因修：①审计把绳段「中点」当端点（系统性差半段长 6cm）——按四元数还原真端点（与弹簧分支同款）；②地面锚沿绳轴支撑距爆表（12m 大地半长 6m）——`_linkAnchorOffset` 统一锚定口径（ground=顶面销 sy/2，其余=支撑距钳 45%），渲染与审计共用；p52-T9 永久回归锚（绳在场+审计零 error+约束生效） | z-mod505 双锚（柱/地面）embedErr 空；p52 18/18 | ✅R7 |
| R7-015 | **随批三修**：①标量 velocity 静默丢弃（模型「初速度 3」只收数组→球不动）——升维 [v,0,0]+uncertain 透明化；②index.html 双 `id="btnRec"` 重复 ID（顶栏 WebM/帧序列互踩，帧序列按钮被覆盖成死键）——帧序列独立 btnFrameRec；③出生悬高裁定窗口过宽（5cm 内全撤→p38 契约的 5mm 缝也不落）——收窄为嵌入/贴合（≤3mm 浮点缝）才撤；④解析来源徽章随服务端模型名（/api/status.model），不再硬编码旧模型 | p38 10/10 复绿；p47 p50 全绿 | ✅R7 |
| R7-016 | **终局回归咬出两根因修**：①hinge 基座被误抬飞（p12 8/9）：摆杆 noCollide（无碰撞体）但视觉网格伸进基座=铰链设计形态，26 向嵌入射线打到杆网格→基座误判嵌入→静置高修复把 2.5m 基座搬到 0.1m 场景报废——`_probeOthers` 豁免 noCollide 实体作障碍物；实测周期 1.633 vs 理论 1.622（0.68%）复绿；②waveRoad 球侧坠出画（p49 212/213 间歇）：波浪横向调制把球 z 向漂移出 1.2m 窄路侧缘直坠（步序随帧时序→轨迹离散→间歇爆红）——安全底衬加宽成兜底盆（x×1.6/z×3）；③p46 弹簧端点锚更新表面口径（err=0 精确贴合，旧中心口径锚差=球半径） | p12 9/9；p46 8/8；p49 复跑全绿；z-waveroad 球被兜底盆接住 | ✅R7 |
| R7-017 | **历史遗留失败全清（run-all 首次全绿基线）**：①p8/p30 帧录制死键（R6-F5 WebM 录屏劫持 btnRec 覆盖帧序列 onclick 的重复 ID 旧账）——R7-015②改名后测试归位 btnFrameRec；②p16/p18 混合复用失效=测试与 R6-F5 产品决策冲突（示例/题图通道=独立成题自清场景，混合语义仅文字通道可达）——加 `MECH.loadParseMixed` 回归通道（adoptParse 第三参，fixture 走生产 normalizeParse+matchOverrides 全真路径），两套件混合段切换；③w1 B1 动量预置碰撞 sim t≈1.93s 与固定 sleep 2600ms 的墙钟竞态（headless 节流 simT 1.7~2.0 边缘）——改条件等待 simT>2.2（纪律：flaky 修根因不加 sleep） | p8 11/11、p16 13/13、p18 15/15、p30 20/20、w1 30/30；认证 run-all 全绿 | ✅R7 |

## 阻塞记录

（无）

## 环境坑新增

- MSYS /tmp 放 node 脚本=模块解析不到 playwright（node 从 Windows 路径解析）——临时脚本放 tools/ui-test/ 内跑。
- OrbitControls 直接 setLength 相机位置：maxDistance 若存在会在 controls.update() 时钳回；实测 120m/260m 帧统计相同（钳制或等效）。
- 相机 far=200：投影 beyond far 的点 NDC 会爆值——sesame 注入(260m)反而先触发出画探针（爆值越限），修复链同链收敛。
- 组件默认动态体：注入「静态大道具」必须显式 `physics:{body:'fixed'}`，否则它坠落+横跨画面把主体份额探针撑大（实测 22% 假绿）。
