# R5 Agent 轨道调研全表(AG-501~610,110 条)

来源:Agent 轨道调研 agent(2026-10-08)。P1×32/P2×55/P3×23。

核查完毕。以下为调研结果。

**核查文件与现状要点(3 行)：**
- 核查：tools/serve.py(291 行：PARSE_PROMPT 单 few-shot、图片/文字/patch 三通道、思考流 JSON 提取链)、src/engine/parse-schema.js(637 行：TYPE_MAP/KIND_MAP/RANGES/normalizeParse/5 种专用布局/planToOverrides)、src/engine/agent-verify.js(175 行四步自查)、src/workbench.js Agent 段(3347-5019:PEDIT/tryLocalAgentCommand/bindVoiceInput/buildChangePreview/applyAgentPlan/agentPostPass/scheduleAgentPatch/motionProbe)、src/engine/explain.js(结构)、viewport.js focusScene、tools/fixtures(30 个 parse fixture)。
- 现状要点：链路完整(零信任 normalize→PEDIT 评审→vivid 建场→静核/修复/探针/理论→≤2 轮 patch);但 prompt 侧 few-shot 仅斜面 1 例、无单位换算与坐标系约定(只在 patch prompt 里)、max_tokens 截断无区分；schema 侧 TYPE_MAP 别名有缺口、joint 未查 from==to、celestial 质量被 RANGES.mass 上限 10000 拒、负索引被静默钳 0;布局侧多 ramp 完全重叠、atwood 回退丢悬挂语义、自由落体无地面承接；patch 会覆盖用户手改、payload 尾部硬截先截掉题目文字、网络失败也钉死修订轮数。
- 健壮性短板：重试判断靠错误文案前缀(401 鉴权失败也命中可重试)、429 不读 Retry-After、无请求缓存与服务端并发上限、离线状态只探一次；可观测仅 MECH.agentState 测试通道，无解析历史/阶段耗时/报告导出。

| 编号 | 位置 | 问题 → 改法 | P | S/M/L |
|---|---|---|---|---|
| AG-501 | tools/serve.py:47-48 (PARSE_PROMPT few-shot) | 全 prompt 仅 1 个斜面示例,天体/传送带/弹簧 attach/转台全靠规则长文描述，长尾题型输出形状漂移 → 增补 2~3 个单行 few-shot(带 attaches 的弹簧题、celestial 轨道题、conveyor 题),纯文本改动 | P1 | S |
| AG-502 ✅B3a | tools/serve.py:19 (kind 枚举) | prompt 只列 astro/rotation/atwood/spring/hinge 五类，未明说「碰撞/动量/平抛/自由落体/传送带 kind 必须留空」,模型偶发自造中文 kind → 补一行负面清单「其余题型 kind 一律留空」 | P1 | S |
| AG-503 ✅B3a | tools/serve.py:16-64 (PARSE_PROMPT) | 无单位换算规则，题图「30cm/500g/72km/h/2min」可能原样输出后被 RANGES 拒 → 补显式规则「所有数值一律换算 SI(m/kg/s,速度 m/s,角度 deg)」 | P1 | S |
| AG-504 ✅B3a | tools/serve.py:185 vs 16 | 世界坐标约定(y 向上/地面 y=0/斜面底端在 +x/贴地静置)只写在 PARSE_PATCH_PROMPT,首解析 prompt 没有，position 语义漂移 → 把同一段约定复制进 PARSE_PROMPT | P1 | S |
| AG-505 | tools/serve.py:55 | 「未给 g 填 null」正确,但题面明示「取 g=10」时模型仍可能输出 null → 补规则「题面明示 g 取值时输出该值，仍禁止把答案数值当 g」 | P2 | S |
| AG-506 | tools/serve.py:46 (输出纪律) | 「实体不超过 16 个」无超限行为约定，模型静默砍实体 → 补「超限时保留与 observations 直接相关的实体，被舍弃的写进 unknowns」 | P2 | S |
| AG-507 | tools/serve.py:16-39 (schema 块) | schema 多行缩进+行内中文注释占大量 prompt token,思考型模型响应慢被进一步放大 → 压缩为单行紧凑 schema+要点列表，省 ~30% prompt token | P2 | S |
| AG-508 ✅B3 | tools/serve.py:134-158 (call_step_messages) | finish_reason=length(思考流+正文超 8192)时静默走提取链失败，用户只见「无法解析」→ 检测 finish_reason,失败文案区分「输出被截断」并自动重试一次 | P1 | M |
| AG-509 | tools/serve.py:122-127 (temperature) | 解析与修订共用 temperature=0.2,patch 通道要的是确定性重写 → patch 请求单独降 0~0.1,减少修订引入新偏差 | P2 | S |
| AG-510 | tools/serve.py:171-176 (call_step_text) | 文字通道复用「看图中的物理题」导语，与纯文字输入语义矛盾 → 文字通道换独立导语「根据以下文字描述的物理题…」,schema/规则不变 | P2 | S |
| AG-511 ✅B3a | tools/serve.py:60 (attaches 说明) | prompt 只教 spring;客户端已支持 rope(attaches.type='rope' 归一)但模型无从知晓 → 补 rope 语义一句(轻绳不可伸长，length=绳长，缺省按端距×1.03) | P1 | S |
| AG-512 ✅B3a | tools/serve.py:50 (type 词表) | 词表缺「桌面/平台/台面/高台/墙」的表达，模型自造 type 被整实体丢弃 → 补「桌面=ground、墙/挡板=box(fixed=1)」 | P1 | S |
| AG-513 | tools/serve.py:44 (抛体规则) | 抛体只说 velocity 三分量，未说抛出点默认语义 → 补「抛出点写 given.position(缺省 [0,0.6,0]),客户端自动补地面」 | P3 | S |
| AG-514 | tools/serve.py:34 (uncertain) | 未引导模型对图片质量自检，低质图静默出低置信计划 → 补「图片模糊或字段读不准时，存疑项写进 uncertain 并降 confidence」 | P2 | S |
| AG-515 | tools/serve.py:35 (joint schema) | joint 的 axis/limits/anchor 无单位与默认值说明，模型乱填 → 补「axis 单位向量、limits 单位 m、anchor 相对体心，默认 [0.15,1.05]/[0,0,0]」 | P2 | S |
| AG-516 | tools/serve.py:64 (输出纪律) | 思考模型常在 reasoning 里先起草完整 JSON 再输出，双倍 token+延迟+截断风险 → 补「不要在思考中起草完整 JSON,直接给最终结果」 | P3 | S |
| AG-517 ✅B3a | src/engine/parse-schema.js:4-17 (TYPE_MAP) | 别名缺口:坡/坡道/斜板→ramp、铁球/球体→sphere、砝码/重物/货物→box、轻杆/棒→box,整实体被丢 → 纯数据扩表 | P1 | S |
| AG-518 ✅B3a | src/engine/parse-schema.js:28-33 (RANGES) | 范围拒绝只有「值无效」，无单位提示(30 若是 cm、500 若是 g) → 拒绝报错文案带换算建议(「若单位为 cm 请 ÷100」),评审界面可见 | P2 | S |
| AG-519 ✅B3a | src/engine/parse-schema.js:35-40 (num) | 字符串数值("30°"、"≈9.8"、"6.67e-11")直接 Number 失败被丢 → num() 先剥离单位/比较符号字符再解析,仍失败才报错(解析成功仍过范围，零信任不破) | P1 | S |
| AG-520 | src/engine/parse-schema.js:55-71 (velocity/position) | 向量只查有限性不查量级，\|v\|=5000 或 position=1e6 直进场景炸取景 → velocity/position/angvel 加合理上限(如 \|v\|≤200、\|p\|≤500),超限报错丢弃 | P1 | S |
| AG-521 | src/engine/parse-schema.js:98-99 (attaches type) | attach type 只认 'rope' 否则一律当 spring,'string'/'绳'/'链' 被静默错挂 → 加 ATTACH_TYPE_MAP 别名归一，未知值报错 | P1 | S |
| AG-522 | src/engine/parse-schema.js:117-132 (joint) | joint 未查 from===to(attach 有查)，且 axis/anchor/limits 逐项 Number 后可能 NaN 进 plan → 补 from==to 拒绝 + 数组逐项有限性校验，非法回退默认并 errors | P1 | S |
| AG-523 | src/engine/parse-schema.js:98-115 (attaches) | 同一对实体重复连接(弹簧+绳同端对)不去重 → 同端对去重合并，重复项 errors 提示 | P2 | S |
| AG-524 | src/engine/parse-schema.js:49-85 (entities 循环) | prompt 限 16 实体但客户端不设上限，模型超限全建 → entities 截断到 16 并 uncertain 提示「超出上限的 N 个已丢弃」 | P2 | S |
| AG-525 | src/engine/parse-schema.js:84 (name) | name 只截 24 字符不查重，同名实体使 removals/findLocalEntities 匹配歧义 → 重名自动加后缀并 uncertain 说明 | P3 | S |
| AG-526 | src/engine/parse-schema.js:20-26 (KIND_MAP) | 无「防误判」负清单:模型输出 kind='碰撞'/'动量'/'平抛'/'传送带' 原样保留 → 显式映射为 ''(与 prompt 负清单呼应) | P3 | S |
| AG-527 ✅B3a | src/engine/parse-schema.js:54-81 (given 键) | 模型偶发输出 mu/μ→friction、v0→velocity、m→mass、theta→angleDeg,全被丢进 droppedNotes → 加 GIVEN_KEY_ALIAS 归一(归一后仍走 RANGES 校验) | P1 | S |
| AG-528 ✅B3 | src/engine/parse-schema.js:28-33,147 | RANGES.mass [0.01,10000] 对 celestial 过窄(真实行星量级被拒),而 PEDIT celestial 允许 1e6 → celestial 质量独立放宽(≤1e30)或按类型选范围 | P1 | S |
| AG-529 | src/engine/parse-schema.js:170-173 (gravity 缺省) | gravity 缺省恒 9.81,国内教材大量题按 g=10 出题，理论对照系统性偏差 ~2% → gravityDefault 时评审行加「9.81/10」一键切换(记 correction) | P1 | S |
| AG-530 | src/engine/parse-schema.js:180-194 (光滑注入) | 光滑正则只扫 questionType/goal/environment/assumptions,写在 keyPoints/observations 的「光滑」漏注入 → 扫描范围并入 keyPoints | P2 | S |
| AG-531 | src/engine/parse-schema.js:100-105 + workbench.js:4540 | stiffness/restLength/damping 缺省散落建场层(k=20/restLength=端距/damping 0.5) → 缺省上收 normalize 按质量给合理默认并标 inferred,评审可见可改 | P2 | M |
| AG-532 | src/engine/parse-schema.js:137-141 (removals) | removals 按「名字包含或类型别名」匹配，「红色的球」「右边滑块」不命中且无候选 → 未命中时列出场景现有同名候选(前 3 个)辅助人工勾选 | P2 | S |
| AG-533 | src/engine/parse-schema.js:100-101 (索引钳位) | 负索引/NaN 被 Math.max(0,..) 静默钳成 0(指向第 0 实体,连接错对象) → 非整数/负数索引应报错丢弃而非钳位 | P2 | S |
| AG-534 | src/engine/parse-schema.js:143-162 | 缺省值无题型感知:atwood 专用布局球摩擦硬编码 0,通用回退却是 0.3,同题两张脸 → 按 kind 给缺省表(kind→默认 friction/restitution),评审与建场统一取用 | P2 | M |
| AG-535 | src/engine/parse-schema.js:393-413 (rampGeom) | 多斜面场景(下坡-水平-上坡)只有第一个 ramp 算 rampGeom,其余 ramp 全落 [0,0.05,0] 完全重叠 → 支持按实体顺序沿 x 串联摆放多 ramp(题给 position 优先) | P1 | L |
| AG-536 | src/engine/parse-schema.js:359-364 (atwood 回退) | 摆球数≠2 回退通用布局后,球走悬浮理想化分支且 1 球时无地面，悬挂语义丢失 → 回退时补 ground+按滑轮下方悬挂摆位 | P2 | M |
| AG-537 | src/engine/parse-schema.js:271-300 (springLayout) | 「竖直悬挂弹簧振子」也建成水平无重力理想化(gravityScale=0),与题意不符 → 检测题面「竖直/悬挂」关键词切换竖直布局(静平衡点挂球，gravityScale=1),agent 层布局不动引擎 | P2 | M |
| AG-538 | src/engine/parse-schema.js:239-269 (atwoodLayout) | 两球 y 恒 1.0,题给 position/velocity 被丢弃，「m1 从高 h 处释放」类题保真差 → atwood 布局尊重题给 position/velocity,仅未给时用默认 | P2 | S |
| AG-539 | src/engine/parse-schema.js:421-422 (laneZ) | 车道间距恒 0.75m,大半径球/圆柱(radius>0.3)侧向仍相碰 → 间距自适应 max(0.75, 相邻半径和+0.1) | P2 | S |
| AG-540 | src/engine/parse-schema.js:514-518 (box 贴坡) | 大尺寸方块(sx>坡长)照常贴坡摆放，悬出斜面边缘不自知 → 摆放前按坡面尺寸检查，放不下时 uncertain 提示并收紧车道偏移 | P3 | S |
| AG-541 | src/engine/parse-schema.js:473-481 (conveyor 放物) | 传送带多物体全放带左端同一点(z=0)相互嵌入 → 多物体沿带长/z 车道按 2r 间距错开 | P1 | S |
| AG-542 | src/engine/parse-schema.js:488-493 (自由落体例外) | 「从高处由静止释放」单球不补地面(dropFromHigh 只保留重力)，球永坠无落地可测 → dropFromHigh 时自动补地面(尺寸按题给高度估算)，地面摩擦 0 不污染测量 | P2 | M |
| AG-543 | src/engine/parse-schema.js:202-235 (hingeLayout) | 初始摆角硬编码 0.4rad,「从水平位置释放」类题被忽略 → 支持「水平释放」档(rot 对应水平)与缺省 0.4 两档，按题面关键词选 | P2 | M |
| AG-544 | src/engine/parse-schema.js:305-350 (rotationLayout) | 滑块初始 r0=0.7、切向速度按 ω0·r0 固定，题给滑块初位/初速被忽略 → rotation 布局尊重 given.position(半径 r)并按 r 重算切向速度 | P2 | S |
| AG-545 | src/engine/viewport.js:116-126 (focusScene) + workbench.js:4558 | 相机取景在建场完成后才调一次，逐件落场动画期间相机不跟、长斜面先只见局部 → applyAgentPlan 开始时按 plan 预估包围盒先取景，落场过程不再跳切 | P3 | S |
| AG-546 | src/engine/parse-schema.js:429-436 + workbench.js:4536-4540 | 多体 attach 走通用管线时，布局端距与题给 restLength 严重不符(拉伸 2 倍内不触发自查 warn),首帧弹力失真 → 建场前按 restLength 沿连接轴摆放两端实体(springLayout 已有此实践，推广到通用路径) | P1 | M |
| AG-547 | src/workbench.js:4151-4203 (renderParseResult) | 实体评审行全部展开，16 实体×4 字段超长难扫 → pe-head 点击折叠/展开 grid,默认折叠非首实体 | P1 | M |
| AG-548 | src/workbench.js:3996-4008 (buildChangePreview diffs) | 更新类条目差异纯文本(「mass 1→2」)新旧同色难辨 → diff 片段旧值删除线+新值高亮(纯展示样式) | P2 | S |
| AG-549 | src/workbench.js:4187-4195 (inp.onchange) | 字段改错后无「恢复题给」入口，只能手输回原值 → 每字段/每实体加恢复按钮，还原 given 并回滚对应 correction 记录 | P2 | S |
| AG-550 | src/workbench.js:4040-4042 (attach 条目) | 变更条目无量纲:连接条目「k=20」无 N/m、restLength 无 m → label 补单位，并显示两端实体名而非 #0→#1 下标 | P1 | S |
| AG-551 | src/workbench.js:4014-4021 (joint 条目) | joint 条目只显示「实体 0→1」下标,建场前无法对应实体 → 用 plan.entities[i].name 渲染「转台→滑块」 | P1 | S |
| AG-552 | src/workbench.js:3357-3390 (PEDIT) | PEDIT 无 position/velocity/angvel 字段,题给位姿/初速错误时评审期无法修正 → 每实体加可折叠「位姿/初速」编辑组(三分量向量) | P2 | M |
| AG-553 | src/workbench.js:4037-4043 (attaches 无编辑) | attaches 的 k/restLength/damping 只能勾选不能改值 → attach 条目展开三个数值输入，改动写回 agentPlan.attaches 并记 correction | P2 | M |
| AG-554 | src/workbench.js:4165 (conf 列) | 实体置信度纯文本无色阶(总体置信度已有三档色) → 与总体同色阶(<70% 红/70-85% 琥珀)，低置信实体一眼可见 | P3 | S |
| AG-555 | src/workbench.js:4186 (推断徽标) | 「推断」徽标无 tooltip,用户不知推断依据 → title 标注推断来源(光滑语义注入/缺省表),与 parse-schema 注入文案一致 | P2 | S |
| AG-556 | src/workbench.js:4205-4213 (appendList) | unknowns/uncertain 只读罗列无法标记「已确认」→ 每条加确认勾选，全部确认后建场按钮旁的「需确认」提示消失(纯前端状态不强制) | P3 | M |
| AG-557 | src/workbench.js:4046-4056 (checkbox 渲染) | agentChanges 全平铺，删除/更新/新建/连接混排，16+ 条难核对 → 按类型分组小标题(删除先行/更新/新建/连接/约束)+每类小计 | P2 | M |
| AG-558 | src/workbench.js:4658-4664 (maybeAgentPatch) | 模型修订轮直接覆盖 agentPlan 并重渲染，用户评审中手改的数值丢失且无提示 → patch 前检测 agentCorrections,同名同键回写新 plan 或警告明示「你的 N 处修改被修订覆盖」 | P1 | M |
| AG-559 | src/engine/agent-verify.js:113-131 (auditMotion) | 无采样间瞬移检测：薄地面/斜面被高速体一帧隧穿不报错，落地后表现诡异弹跳 → 相邻采样位移 > v·Δt×4 且穿面时 warn「疑似穿透」 | P1 | M |
| AG-560 | src/engine/agent-verify.js:131-144 (卡滞检测) | 卡滞只查「全程未动」；坡面浅嵌来回微振(位移小但 maxV 大)漏检 → 加「位移<0.05m 且速度方向翻转 ≥4 次」检出坡面谐振 warn | P2 | S |
| AG-561 | src/engine/agent-verify.js:79-96 (连接核对) | 连接只查初始绷紧/拉伸；演化中弹簧超 restLength×5 或两端骤脱(约束断裂)无检出 → auditMotion 增加可选 attach 端距序列监控，超阈值 error | P2 | M |
| AG-562 | src/workbench.js:4687-4717 (修复候选) | 修复策略只有挪位置；「题面光滑但摩擦>0(模型显式给错)」不修 → 修复扩展：光滑语义与给定摩擦冲突时自查 warn+一键置 0(记 correction,agent 层参数不动引擎) | P1 | M |
| AG-563 | src/workbench.js:4741-4742 (修复失败注记) | 修复失败只留 warn 文案无下一步引导 → 注记附操作链：「手动拖动或重新解析」按钮(重新解析=parseQuestion) | P3 | S |
| AG-564 | src/workbench.js:4622-4628 (scheduleAgentPatch) | patch 触发只看 error>0,不看是否「题给数值冲突」类修不了的问题 → findings 带 given 冲突标记时跳过 patch 直接提示人工(省 2 轮×8-30s API) | P1 | S |
| AG-565 | src/workbench.js:4643-4657 (patch 验收) | 新计划仅过 normalizeParse 即采纳，无「修订后不劣于上一轮」比较，第 2 轮可能更差 → 保留上一轮 findings 计数，error 数上升时回滚旧 plan(快照在 agentVerifyCtx.plan) | P1 | M |
| AG-566 | src/engine/agent-verify.js:169-175 (patchBrief) | error 全量拼接，16 实体全嵌时 brief 挤占 patch payload(12000 硬截可能截掉题目文字) → error>8 时截断附「另 N 处同类」，保证题目文字完整 | P2 | S |
| AG-567 ✅B3 | tools/serve.py:196-204 (call_step_patch) | payload 超 12000 从尾部硬截，先截掉的恰是拼在最后的题目文字 → 按预算分配:plan 压缩(去 null 字段)+issues 截断+题目文字保留完整 | P1 | S |
| AG-568 | src/workbench.js:4767-4778 (motionProbe needT) | needT 按题型固定(斜面 4s),长坡/低速球走不完，理论对照恒「未走完」warn → 按坡长与 g·sinθ 确定性估算到达时间动态 needT(封顶 8s) | P2 | M |
| AG-569 | src/workbench.js:4837-4839 (verifyTheory unsupported 分支) | explainRun 不支持时只报「暂无解释器」；系统级能量漂移仍可作降级核对 → unsupported 分支加 KE+PE 漂移检查(漂移>5% warn,数据已有 runtime.energyTotals) | P2 | M |
| AG-570 | src/engine/agent-verify.js:42-60 (坡面语义核对) | 坡面位置核对只覆盖 sphere;box/cylinder 悬空/埋坡漏检 → 按 slopeSpot 公式扩展 box/cylinder 期望位核对(cylinder 计入躺平 yOff=r) | P2 | M |
| AG-571 | src/engine/agent-verify.js:87-95 (弹簧压缩) | 连接核对只查拉伸 ratio>3,过压(端距<restLength×0.2)首帧猛推同样炸 → 加压缩倍率检测 warn | P2 | S |
| AG-572 | src/workbench.js:4699-4702 (lift 候选) | lift 只沿 +y 阶梯，两物体夹缝嵌入垂直抬不出 → 候选位追加水平偏移(±0.3/±0.6 沿 x)再过 spotOk 实机网格 | P2 | S |
| AG-573 | src/workbench.js:4746-4762 (报告时效) | 建场后用户手动改场景，agentVerifyState 不失效，「自查全过」可能是旧场景结论 → 非 Agent 批次的 doc 变更后徽标注「报告已过时，可重跑自查」 | P2 | S |
| AG-574 | src/workbench.js:3773-3776 (运行控制词表) | 词表缺口:播放/go/开始演示→运行、停下/别动→暂停、「撤销/重做」(undo 栈已存在)未接入 → 词表扩容 | P1 | S |
| AG-575 | src/workbench.js:3755 (复合句拒绝) | 「运行然后开轨迹」整句落模型烧 8-30s,本地完全可做 → 按「然后/再/接着」分段，各段全命中本地词表则依序执行，任一未命中才回模型(仍确定性) | P1 | M |
| AG-576 | src/workbench.js:3744-3750 (LOCAL_OVERLAY) | 叠加层词表缺「网格」「坐标轴」「标签/名字」「能量条」等面板开关 → 补映射到既有按钮 id | P2 | S |
| AG-577 | src/workbench.js:3782-3786 (倍速正则) | 倍速只认阿拉伯数字，「二倍速/两倍速/半速」不命中整句落模型 → 中文数字与「半」映射(二/两→2、半→0.5) | P2 | S |
| AG-578 | src/workbench.js:3792-3799 (聚焦) | 「聚焦小球」命中多个时静默选第一个 → toast 列出命中数与名字(前 3),支持「聚焦 小球 2」指定 | P3 | S |
| AG-579 | src/workbench.js:3802-3827 (删除分支) | 「删除斜面上的小球」整串 kw 查无命中直接报没找到 → 剥介词短语(「X上的/里的/旁边」)取核心名词重查，仍无命中才报错 | P2 | S |
| AG-580 | src/workbench.js:3751-3836 (返回路径) | 本地指令执行不进 agentOps,任务面板操作明细看不到本地动作 → 执行成功也 push {op:'本地指令', target:t} | P3 | S |
| AG-581 | src/workbench.js:3758-3771 (叠加层分支) | 「隐藏轨迹和曲线」含「和」不在复合句正则，只翻转第一个名词就 return → 「和/跟/与/还有」连接多个叠加层名词时逐个处理 | P2 | S |
| AG-582 | src/workbench.js:3752-3755 (回模型兜底) | 未命中本地词表时静默落模型，「快进一点」类操控近义句白烧 API → 未命中但含操控动词(显示/运行/倍速…)时提示「该说法暂不支持，试试：…」并给词表近例 | P2 | S |
| AG-583 | src/workbench.js:3828-3832 (存档/导出) | 缺「放大/缩小视角」「载入/打开」常用词 → 补相机 dolly 与文件载入映射 | P3 | S |
| AG-584 | src/workbench.js:3868-3876 (onresult) | 识别原文直接追加，物理同音错字(「斜波/斜颇」→斜面)不做纠正 → 追加前过物理词表同音映射表(纯字符串替换，用户可再编辑) | P1 | S |
| AG-585 | src/workbench.js:3874-3875 (chunk 拼接) | chunk 固定以「，」连接，自带句末标点时出现「，，」→ 拼接前清理 chunk 首尾标点、折叠重复标点 | P1 | S |
| AG-586 | src/workbench.js:3868-3876 (数字口语) | 「三点五米」「三十度」留在文本里靠模型猜 → 口语数字转写预处理(三点五→3.5、三十→30、二分之一→1/2) | P2 | M |
| AG-587 | src/workbench.js:3868-3876 (单位口语) | 「米每秒/千克/牛每米」未归一为符号 → 单位口语→符号映射(m/s、kg、N/m、rad),降低模型换算负担 | P2 | S |
| AG-588 | src/workbench.js:3886 (rec.onend) | continuous 模式句间停顿稍长服务端即 onend 停止，长题念一半断 → voiceState.on 时自动 restart(限 3 次)并 toast「继续聆听中」 | P1 | S |
| AG-589 | src/workbench.js:3868-3876 (chunk 历史) | 念错一句只能手动删改 textarea → 维护 chunk 历史，加「删最后一句」按钮撤回最近 chunk | P3 | S |
| AG-590 | src/workbench.js:3866 (interimResults=false) | 长句听写无实时反馈，不知是否在收音 → interim 结果显示在状态行/placeholder(不写 textarea,避免光标打架) | P3 | S |
| AG-591 | src/workbench.js:3865 (rec.lang) | lang 固定 zh-CN,题目含公式/英文(V=2m/s)识别差 → 提供中/英切换按钮或按首 chunk 自动切换 | P3 | S |
| AG-592 | tools/serve.py:14 (CALL_TIMEOUT) | 三通道共用 90s 超时;patch 通道 payload 大思考久偶发不够，图片 90s 又偏长占线程 → 按通道分级(image 90/text 75/patch 120) | P2 | S |
| AG-593 ✅B3 | src/workbench.js:3706-3709 (isRetryableParseError) | 重试判断靠错误文案前缀「解析服务」，401「鉴权失败」也命中被盲目重试(白等 8-30s) → 服务端返回结构化 {retryable} 字段;429 退避 3s 再重试 | P1 | M |
| AG-594 | tools/serve.py:280 (429 处理) | 上游 429 不读 Retry-After,客户端只能盲等 → 透传秒数进错误文案(「限流，请 N 秒后重试」) | P2 | S |
| AG-595 | src/workbench.js:3711-3733 (parseQuestion) | 相同图片/文字重复提交无缓存，误点=再等 8-30s+再计费 → 按 body 哈希缓存最近 1 次成功结果，同输入 5 分钟内直接回放并标注「缓存」 | P2 | M |
| AG-596 | tools/serve.py:207-291 (H) | ThreadingHTTPServer 无并发上限，多标签页并发全打上游加剧阵发限流 → 简单信号量(≤2),排队超 30s 返回友好 429 | P2 | S |
| AG-597 | src/workbench.js:3484-3488 (无 Key 探针) | /api/status 只在 boot 问一次，服务中途起/停状态不更新 → 状态条常驻(轮询或失败时刷新)，离线标注「仅本地指令/示例可用」 | P2 | S |
| AG-598 | src/workbench.js:3714-3715 (重复编码) | 上传时 toDataURL(0.85) 一次，解析时对同一画布再编码一次(耗时+画质损失) → 无裁剪时直接复用 agentImageDataUrl | P2 | S |
| AG-599 ✅B3 | src/workbench.js:4635-4639 (patch 失败路径) | patch 失败一律 agentPatchRounds=MAX 钉死，网络瞬断也永久放弃修订 → 网络类失败(AbortError/连接失败)不计轮数，仅模型输出无效才钉死 | P1 | S |
| AG-600 | src/workbench.js:3753 (24 字门槛) | ≤24 字硬门槛先于词表匹配，稍长的操控句全落模型 → 本地词表先匹配(命中即执行)，未命中才按长度分流 | P2 | S |
| AG-601 | tools/serve.py:273 (图片大小) | 体积用 len(b64)*3/4 高估(未解码校验)，边界图误拒/无分辨率指引 → 精确估算解码字节并在拒绝文案给「建议 ≤1400px」(与客户端降采样一致) | P3 | S |
| AG-602 | src/workbench.js:3492-3509 (setAgentStage) | 各阶段无耗时统计(文字通道临时算了一次) → 阶段时间戳数组，任务行显示「解析 12.3s · 建场 1.2s · 自查 6.8s · 修订 2 轮 21s」 | P2 | M |
| AG-603 | src/workbench.js:5341-5364 (agentState) | agentState 仅测试通道，无用户可见导出 → 「导出解析报告」按钮:plan+corrections+自查 findings+explain 摘要合成 JSON/MD 下载(复用 CSV 下载模式) | P1 | M |
| AG-604 | src/workbench.js:3353 (agentPlan 单槽) | 新解析直接覆盖旧 plan,误点解析后上一份评审成果不可恢复 → 内存保留最近 5 次解析历史(输入类型+前 30 字+计划摘要)，下拉回放载回评审表 | P1 | M |
| AG-605 | src/workbench.js:4658-4666 (patch 历史) | 多轮修订只留最终 plan,每轮改了什么不可见 → 每轮快照 plan+findings 摘要，自查报告头部显示「第 1 轮：嵌入 2→0,理论偏差 12%→3%」 | P2 | M |
| AG-606 | src/workbench.js:3725,3917 (失败文案) | 解析失败无累计视角，连续限流/断网无全局感知 → 连续失败≥2 次状态行追加「已连续失败 N 次」,成功即清零 | P3 | S |
| AG-607 | tools/serve.py:210-214 (log_message) | 只打 API 路径行，无耗时/状态码/提取成败，调研「哪类题翻车」无据 → /api/ 日志加耗时+结果码+body 长度(不含内容/key),单文件滚动 | P2 | S |
| AG-608 | tools/serve.py:135-146 (MECH_PARSE_DEBUG) | 诊断转储只写本机临时文件，客户端无法感知失败原因 → 502 响应加 debug 字段(仅 debug 开关时):finish_reason/content 长度/提取候选数 | P2 | S |
| AG-609 | src/workbench.js:3350,4501-4516 (agentOps) | agentOps 只显示最近 6 条且不落 doc → 建场 ops 摘要写入 doc.meta.origin.ops,存档可追溯「场景是 Agent 怎么建的」 | P3 | S |
| AG-610 | src/workbench.js:4857-4894 (renderAgentVerify) | 自查报告只在面板渲染无法离线留存 → 加「复制自查报告」(findings 文本进剪贴板)，与 explain 复制按钮同模式 | P3 | S |

补充说明:以上全部为 Agent 层(prompt/schema/布局/评审/自查/指令/语音/健壮性/观测)改动，未涉及内核物理语义(摩擦模型、求解器、守恒计算均只消费不改)，也不依赖 step-5-preview 之外的新模型能力。编号 AG-501~610 共 110 条，其中 P1×32、P2×55、P3×23;S×62、M×42、L×1(AG-535 多斜面串联)、其余按行内标注。
