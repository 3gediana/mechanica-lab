# 二轮优化台账 · R2-250（2026-10-04）

调研方法：6 个并行子 agent 分类读码（FEEL/AG/MDL/PAR/MAT/PER·UI·ENG），全部条目带 file:line 证据；
与一轮台账（docs/OPTIMIZATION-500.md，102 项 ✅ + ⛔PER-67）去重；收编的一轮 ⬜ 存量条目均重新读码核实。
共 268 条候选，裁 18 条低价值/高风险项（PAR-35/36/37/38/40/44/45/46、MAT-85/95、MDL-13/17/45、PER-92/94/95、UI-101、ENG-75），定稿 **250 项**。

配额：FEEL 50 · AG 50 · MDL 42 · PAR 38 · MAT 30 · PER 12 · UI 14 · ENG 14。
编号沿用一轮连续编号（新条目接续 + 收编条目保留原 ID 标注）。
状态：⬜ 待做 · ✅ 已实施（附实测）· ⛔ 需设计决策/不做。

---

## FEEL 手感（50 项）

| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| FEEL-93 | viewport.js:778-784 + workbench.js:968-974 | 锁定实体仍挂 gizmo 可拖（「防误拖」承诺失效）→ attach 前判 locked，锁定即 detach+保高亮；隐藏实体同理 | P0 | S | 多选主选中为锁定体时 gizmo 行为变化，需过 p 系选择断言 | ⬜ |
| FEEL-94 | workbench.js:327-336,718,991,1317 | 运行态目录点击/键盘 Delete/大纲 ×/检查器删除均静默 rebuildAll 重置仿真 → 运行态先 toast+二次确认；updateSimbarStatic 补禁 | P0 | M | ⚠ w1/w6 含运行后删除流程，确认流要同步测试 | ⬜ |
| FEEL-95 | workbench.js:1945-1951,439-445,713 | 回放中 R 触发 resetSim 但 replaying 每帧 applyFrame 覆盖重建；Space 不停回放；btnStep 推进真实物理 → onKey/stepOnce 开头判 replaying 分流 | P0 | S | 回放相关 w 系断言复验 | ⬜ |
| FEEL-96 | workbench.js:1958-1959 与 2098-2099 | tickFocus/tickPose 每帧双调，焦点/飞行动画 2 倍速收敛与设计 lerp 不符 → 删 2098-2099 重复对 | P1 | S | 动画变慢半档，收敛等待留余量 | ✅ R2-1：删重复调用对，动画按设计 lerp 收敛 |
| FEEL-97 | viewport.js:239,671-672 | ghost 出现在 (0,spawnY,0)：hover 卡后鼠标静止则预览钉在可能视野外的原点 → 缓存最近指针位置，showGhost 时立即跟随一次 | P1 | S | 无指针历史仍落原点（可接受降级） | ⬜ |
| FEEL-98 | workbench.js:328,760 | ghost 跟随鼠标暗示「放这里」，点击实际落 n%3 默认摆位 → 摆位不动（p61 雷区），落点 spawnImpact 环闪+toast 坐标 | P1 | S | 摆位不动仅加反馈 | ⬜ |
| FEEL-99 | workbench.js:1946 + runtime.js:600 | 回放恒 1.5 倍速且随屏幕刷新率漂移（120Hz=3 倍速）→ 按帧自带 t 对齐墙钟推进（accumulate rawDt×40） | P1 | S | 回放时长断言按新速率校准 | ⬜ |
| FEEL-100 | viewport.js:713-720 | 框选只测实体原点投影：大实体中心在框外不选中 → 投影包围盒 8 角+中心任一入框即选 | P1 | M | ⚠ p61 框选计数依赖现语义需复跑 | ⬜ |
| FEEL-101 | viewport.js:582-590 | 焦点/飞行动画与用户拖视角抢权 → controls 'start' 事件清 _focusAnim/_poseAnim；两动画互斥 | P1 | S | 无 | ⬜ |
| FEEL-102 | viewport.js:652-654 | gizmo 拖错只能拖完再 Ctrl+Z → Esc 级联最前插「dragging 时 reset()」（r186 有，已验证），不触发 onGizmoCommit | P1 | S | Esc 级联顺序最前避免误吞 | ⬜ |
| FEEL-103 | viewport.js:687-704 + workbench.js:760 | ghost 激活时视口左键变成点选而非放置（收编 FEEL-7）→ ghost 激活期左键=在 ghost 位放置，Esc 退出放置模式 | P1 | M | ⚠ 点击与点选冲突，p 系点击用例需先 Esc | ⬜ |
| FEEL-104 | viewport.js:653,795-805 | 缩放 gizmo 拖拽中非均匀变形、松手才弹回（收编 FEEL-50）→ objectChange 实时把 scale 钳成均匀均值，所见即所得 | P1 | M | ⚠ 与逐轴缩放互相改写需实测手感不抖 | ⬜ |
| FEEL-105 | viewport.js:421-435 | 正交切换瞬间尺度突变（视野高固定 6 与透视距离无换算）→ 切换时 top/bottom=d·tan(fov/2)，resize 用保存高度 | P1 | S | ⚠ 正交断言与视野宽读数复验 | ⬜ |
| FEEL-106 | viewport.js:731-749 | 视口无 hover 反馈（收编 FEEL-14）→ rAF 节流 raycast，命中 cursor:pointer+0.25 透明预览框；gizmo 手柄 hover=cursor:move | P2 | M | ⚠ hover raycast 每帧成本须节流且静止帧不置脏 | ⬜ |
| FEEL-107 | viewport.js:760-788 + workbench.js:69-81 | 多选时 gizmo 只动主选中（收编 FEEL-12）→ 组平移：mouseUp 把主实体位移向量应用到其余选中 | P2 | L | ⚠ 大改；undo「成组移动」单步 | ⬜ |
| FEEL-108 | workbench.js:63-68 | 框选只能整替不能加选（收编 FEEL-13）→ onBoxSelect(ids, e.shiftKey)，shift=并集 | P2 | S | viewport _onUp 透传 shiftKey | ⬜ |
| FEEL-109 | viewport.js:879-894 + workbench.js:532 | 顶/前/侧/复位视图与 atwood 载入均瞬跳（收编 FEEL-34）→ 四预设改 flyToPose 300ms 飞行 | P2 | M | ⚠ 依赖瞬跳的截图金标需重拍或 Ctrl 逃生口 | ⬜ |
| FEEL-110 | viewport.js:582-588 | 滚轮缩放近景过快（r186 无 dollyToCursor，已验证）→ zoomSpeed=0.85~0.9 单值 | P2 | S | 远景拉全景稍慢可接受 | ⬜ |
| FEEL-111 | workbench.js:714-715 + index.html:572 | 缩放模式无快捷键（收编 FEEL-52）→ T 键 setGizmoMode('scale')，帮助浮层补行 | P2 | S | T 未被占用 | ⬜ |
| FEEL-112 | workbench.js:689-736 | 暂停态无单步键盘（收编 FEEL-17）→ 「.」键在 run&&paused 时 stepOnce；编辑态忽略 | P2 | S | 与 FEEL-95 守卫共用入口 | ⬜ |
| FEEL-113 | workbench.js:1388-1407 | triRow 三输入各 commit 一次=3 个 undo 步（收编 FEEL-5）→ 行内 100ms 聚合合并单次 commit | P2 | M | ⚠ undo 语义变化，撤销计数断言复验 | ⬜ |
| FEEL-114 | workbench.js:1400-1404 | 初速度 triRow 无 min/max 校验，1e9 直入文档炸物理 → ±100 clamp+红框 1.6s | P2 | S | 天体场景 linvel 5 在界内无回归 | ⬜ |
| FEEL-115 | workbench.js:719-735 | 方向键长按每 30ms 一条 undo 灌满 60 栈 → e.repeat 不逐次 commitChange，300ms 防抖窗口收尾合并一条 | P2 | S | 撤销一次回退整段微调，help 说明 | ⬜ |
| FEEL-116 | workbench.js:79 | gizmo 旋转/缩放提交的 undo 标签仍叫「移动 X」（收编 FEEL-82）→ 按 gizmoMode 取前缀 | P2 | S | 无 | ⬜ |
| FEEL-117 | workbench.js:31-38 | toast 一律 1800ms，错误一闪而过（收编 FEEL-75）→ toast(msg,kind)：err 类 3200ms+danger 描边 | P2 | S | 无 | ⬜ |
| FEEL-118 | workbench.js:1926-1937 | 回放结束静默瞬回编辑态（收编 FEEL-54）→ 停 500ms 于末帧+toast「回放结束，已恢复编辑态」 | P2 | S | 自动结束路径多 500ms 测试容忍 | ⬜ |
| FEEL-119 | workbench.js:1437-1445 | 曲线面板运行中途打开无重采入口（收编 FEEL-39）→ 加「清除数据」小按钮 | P2 | S | 无 | ⬜ |
| FEEL-120 | workbench.js:579-590 | 4 叠加层独立开关无一键全关（收编 FEEL-41）→ 矢量按钮 shift+click 全关（title 注明） | P2 | S | 无 | ⬜ |
| FEEL-121 | workbench.js:520 | btnNew 一键清空且 autosave 即刻覆盖（收编 FEEL-57）→ entities>0 时 confirm（提示 Ctrl+Z 可找回） | P2 | S | ⚠ w1 新建流程多一步确认需处理 dialog | ⬜ |
| FEEL-122 | workbench.js:212-229 | 点选/框选后大纲选中行不滚动定位 → scrollIntoView({block:'nearest'}) | P2 | S | 大纲滚动被动变化影响最小 | ⬜ |
| FEEL-123 | viewport.js:659-670,683-704 | pointerdown/up 不判 e.button：右键平移松手即换选中 → 两处开头 button!==0 早退（框选起点同理） | P2 | S | 无 | ⬜ |
| FEEL-124 | viewport.js:724-729 | 框选模式不 detach gizmo：拉橡皮框同时 gizmo 也生效 → setBoxSelect(on) 时保存并 detach，退出恢复 | P2 | S | 退出恢复走 setHighlights | ⬜ |
| FEEL-125 | viewport.js:819-823 | setSnap 缺缩放档（r186 setScaleSnap 已验证）→ on 时 setScaleSnap(0.05) | P2 | S | 与均匀化提交交互实测 | ⬜ |
| FEEL-126 | viewport.js:162-190,215,821 + workbench.js:639-674 | ghost 吸附与 gizmo 吸附两套语义分裂（xz-only vs 3D、0.5m vs 0.1m 档、阈值 0.3 vs 0.25）→ 抽单一 snap 求值函数共用参数表 | P2 | M | ⚠ p24 吸附断言与 p61 摆位擦边，先固定口径 | ⬜ |
| FEEL-127 | viewport.js:687-704 | 双击实体不平滑聚焦（收编 FEEL-11）→ canvas dblclick（位移<5px）focusOn(mesh) | P2 | S | 与大纲双击 rename 不同 DOM 不冲突 | ⬜ |
| FEEL-128 | workbench.js:739-771 | 目录卡只能点击放置无拖入视口（收编 FEEL-10）→ comp-item draggable，drop 地面投射定 pos | P2 | M | DnD 显式给 pos 不改默认摆位，p61 点击路径不变 | ⬜ |
| FEEL-129 | workbench.js（无 contextmenu） | 无实体右键菜单（收编 FEEL-15）→ pick 命中时自绘直角菜单：聚焦/复制/锁定/删除 | P2 | M | ⚠ 与右键平移手势冲突需命中判定 | ⬜ |
| FEEL-130 | workbench.js:1340-1386 | 数值只能键入无 label 拖拽滑值（收编 FEEL-24）→ label pointerdown+横向拖拽 step×(Shift×10)，pointerup 提交单 undo | P2 | M | ⚠ 与 blur 提交时序坑同源 | ⬜ |
| FEEL-131 | registry.js:110-143 + workbench.js:1145 | 摩擦/弹性/劲度等连续参数只有 number 输入（收编 FEEL-25）→ schema kind:'slider'，range+number 组合 | P2 | M | 重建型参数拖拽节流到 change 提交 | ⬜ |
| FEEL-132 | registry.js:177,182 + workbench.js:1144-1161 | 斜坡倾角双行分裂（只读 computed+末尾可编辑）（收编 FEEL-26）→ 删 computed 行，编辑行就地刷新 | P2 | S | w 系若断言「当前倾角」字样需同步 | ⬜ |
| FEEL-133 | workbench.js:521-535 | 预置载入不自动取景（celestial 卫星轨道后半程出视野）（收编 FEEL-65）→ applyDoc 尾统一 focusScene() | P2 | S | ⚠ 截图金标依赖默认相机需白名单或重拍 | ⬜ |
| FEEL-134 | workbench.js:689-736 + viewport ghost | 放置预览不可旋转（收编 FEEL-8）→ ghost 激活时 Q/E 绕 y 转 15°（Shift=90°），放置写进 rot | P2 | S | Q/E 未绑定无冲突 | ⬜ |
| FEEL-135 | workbench.js:550-560 | 回放无键盘单帧 → 回放中 ←/→=±1 帧、Home/End=首末帧 | P2 | S | 与 FEEL-95 同批 | ⬜ |
| FEEL-136 | workbench.js:706-712 | Esc 级联不含清空选择 → 最末级加「清除选中」 | P3 | S | 无 | ⬜ |
| FEEL-137 | workbench.js:693-699 | 无全选快捷键 → Ctrl+A=选中全部未锁定实体（编辑态） | P3 | S | 输入焦点守卫已有 | ⬜ |
| FEEL-138 | viewport.js:453 vs 494 | trails 关再开短线不显示：可见阈值 count>=4 与更新处 n>=2 不一致 → 统一 >=2 | P3 | S | 无 | ⬜ |
| FEEL-139 | viewport.js:649-657 | gizmo 无局部/世界空间切换（斜面上摆件旋转高频）→ L 键 setSpace 切换+toast+帮助行 | P3 | S | local 手感变化实测一例 | ⬜ |
| FEEL-140 | viewport.js:651 | gizmo setSize(0.85) 不随 dpr（收编 FEEL-51）→ 0.85×max(1,dpr/1.5) | P3 | S | 高 dpr 截图金标 gizmo 大小变化 | ⬜ |
| FEEL-141 | workbench.js:579-590 | 叠加层无快捷键（教学演示频繁切换）→ V=矢量/N=轨迹/B=受力+帮助行 | P3 | S | 键位冲突排查 | ⬜ |
| FEEL-142 | runtime.js:8 + index.html:488-491 | 时间倍率只有 0.1~1（收编 FEEL-18）→ 补 2x/4x 档；4x 时步上限 8→16+丢步 toast 建议降档 | P2 | M | ⚠ 步上限对重场景帧预算实测 | ⬜ |

## AG Agent 能力（50 项）

新条目 AG-93+；「收编」=一轮 ⬜ 存量经本轮读码核实仍成立。P0 五项均经纯函数实测复现。

| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| AG-93 | workbench.js:2460,2485 | parseQuestion/parseTextQuestion 的 catch（网络异常/超时）只 setParseStatus 不流转阶段 → 徽标永停「解析中」带 spinner → catch 补 setAgentStage('error') | P0 | S | 无 | ✅ R2-1：两处 catch 补 setAgentStage(error) |
| AG-94 | serve.py:73-97 | _extract_json 取第一个 questionType：思考流草拟样例 JSON 再输出真 JSON 时草稿被当解析结果（python 实测复现）→ rfind+兜底取最末闭合对象 | P0 | S | ⚠ 提取语义变化需 fixture 回归 | ✅ R2-1：rfind+兜底取最末闭合对象；python 3 场景实测（草稿/单 JSON/围栏）过 |
| AG-95 | parse-schema.js:305,189 | 摆球数≠2 时 atwoodLayout 返回 [] 且静默建场 0 实体报成功（node 实测）→ 布局失败回退通用布局+assumptions 提示 | P0 | S | 无 | ✅ R2-1：atwoodLayout 空结果回退通用布局+uncertain 提示；单测锚 |
| AG-96 | explain.js:457 | explainMomentum2D 的 keBefore 漏 B 球动能（实测 10.0 vs 正确 10.5），lossPct 虚高 → 补 0.5·m2·u2²；顺修 L469 字符串乘法怪味 | P0 | S | 无 | ✅ R2-1：keBefore 补 B 球动能+修 1−e² 百分比维度 bug |
| AG-97 | parse-schema.js:43,48,53 | velocity/position/angvel 长度≠3（二维题 [vx,vy] 高发）被静默丢弃 → 长度 2 补零成 3 元+uncertain 备注降维 | P0 | S | 无 | ✅ R2-1：二维向量补零升维+uncertain 计数；单测锚 |
| AG-98 | serve.py:16-54 | PARSE_PROMPT 无 attaches 字段：绳/弹簧连接体模型无通道表达只能漏 → 补 attaches（rope/spring+from/to+length/stiffness）schema 与规则 | P1 | M | ⚠ 输出风格漂移 realspot 复验 | ⬜ |
| AG-99 | parse-schema.js:81 | kind 中文/近义值（转台/转动/滑轮/弹簧/复摆/天体）不归一，布局全失配（实测 kind='转台' 建出无关节场景）→ 补 KIND_MAP 别名归一层 | P1 | S | 无 | ✅ R2-1：KIND_MAP 12 别名归一；单测锚（转台→rotation 滑块切向速度匹配） |
| AG-100 | serve.py:43 + parse-schema.js:127 | 弹性/完全非弹性碰撞 restitution 语义无规则无推断，漏给落默认 0.1 物理错误 → prompt 补规则（弹性 e=1/共速 e=0）+客户端语义推断注入（类比光滑推断） | P1 | M | 无 | ⬜ |
| AG-101 | parse-schema.js:18 | RANGES.mass 上限 1e4 拒收天体量级质量（实测 5.97e24 报错→轨道全错），与检查器 1e6 不一致 → celestial 放宽 1e6+prompt 补教学缩放规则 | P1 | S | 无 | ⬜ |
| AG-102 | workbench.js:2128-2138 | PEDIT sphere 缺 restitution 行、box 缺 friction 行：对撞题关键题给看不见也改不了 → 补行（复用徽标） | P1 | S | 无 | ⬜ |
| AG-103 | workbench.js:2440-2442 | isRetryableParseError 按文案前缀匹配：401/429 也被无意义重试且无间隔 → 服务端错误附 code，客户端按 code 白名单重试+1.5s 退避 | P1 | S | 无 | ⬜ |
| AG-104 | serve.py:122-146,236 | finish_reason=length 截断与 JSON 损坏混同一 502 文案，重试同样截断再失败浪费计费 → 透传 finish_reason 分类+专属文案+评估 max_tokens 上调 | P1 | S | 无 | ⬜ |
| AG-105 | explain.js:299,313 | explainIncline 理论 v=√(2gΔh) 忽略题给初速且 g 取 plan.gravity（改环境重力卡理论过期）→ √(v0²+2gΔh)、g 读 doc.gravity | P1 | S | ⚠ 理论口径变化 | ⬜ |
| AG-106 | explain.js:313-327 | 粗糙斜面/滚动球无条件套光滑能量守恒，μ>0 必判 fail 误导 → 按 effFriction 分支：滑动 v²=2gΔh−2μgd·cosθ、纯滚动 √(10gΔh/7) | P1 | M | ⚠ 理论分支实测标定 | ⬜ |
| AG-107 | parse-schema.js:412,428 | box/cylinder 布局忽略 given.position（实测 [5,1,0]→[0.6,0.17,0]）→ 尊重题给位置，缺省才默认摆位 | P1 | S | ⚠ p 系摆位断言 | ⬜ |
| AG-108 | parse-schema.js:381-401 | given.angvel 仅转台布局消费，自旋题（旋转球/飞轮）静默丢弃 → 通用布局透传 physics.angvel | P1 | S | 无 | ⬜ |
| AG-109 | serve.py:44-45 | few-shot 仅斜面 1 例 → 补对撞（restitution/velocity 语义）+天体（G/position 语义）两个紧凑单行示例 | P1 | M | ⚠ token+风格漂移 realspot 复验 | ⬜ |
| AG-110 | workbench.js:2945 | runAndExplain 强依赖 agentPlan：手工搭建场景无法运行解释 → 合成伪 plan（observations 兜底、gravity 取 doc）复用 explainRun | P1 | M | 无 | ⬜ |
| AG-111 | parse-schema.js:4-14 | 传送带题型零支持 → 参考系等价布局（固定摩擦长面+物块带相对初速）或至少 uncertain 诚实标注 | P1 | M | 无 | ⬜ |
| AG-112 | parse-schema.js:84-98 | attaches/joint 的 from/to 越界索引（实测 to=99 原样保留）拖到建场才静默失败 → normalize 层校验 <entities.length，越界丢弃+errors | P1 | S | 无 | ✅ R2-1：attaches/joint 越界 normalize 层拦截+errors；单测锚×2 |
| AG-113 | parse-schema.js:126 + serve.py | 圆周临界/圆锥摆/竖直圆环题型无布局也无声明，错建场比诚实降级更糟 → 关键词检测进 uncertain+prompt 补「此类题型 uncertain 注明」 | P1 | S | 无 | ⬜ |
| AG-8（收编） | workbench.js:2304-2321 | EXIF 方向不处理（手机横拍图歪）→ createImageBitmap(blob,{imageOrientation:'from-image'})，失败回退 Image | P1 | M | 现代浏览器或已默认，先探测再落 | ⬜ |
| AG-23（收编） | explain.js:51 | 抛体落地阈值 y≤0.16 硬编码假设半径 0.15 → 用 doc 球半径+地面顶面高 | P1 | S | 无 | ⬜ |
| AG-24（收编） | workbench.js:2966 | 抛体 needT 2.5s 固定，高抛/低速题截断 → tFlight×1.5+0.5 动态 | P1 | S | 无 | ⬜ |
| AG-40（收编） | workbench.js:2523-2535 | matchOverrides 复用匹配 first-find 不看位置 → 「同类型+同刚体+距离最近」混合匹配 | P1 | M | ⚠ w4 混合断言 | ⬜ |
| AG-114 | serve.py:98-105 | 截断 JSON 无修复路径（python 实测 JSONDecodeError）→ 候选全败时截尾到最后完整 entities 元素+补闭合的 lenient repair | P2 | M | ⚠ 半截结果 uncertain 标注 | ⬜ |
| AG-115 | realspot.mjs:14-22 | 真实抽查缺 projectile/momentum2d 两类 → 补两类用例（+2 次调用） | P2 | M | ⚠ 调用预算 | ⬜ |
| AG-116 | test/unit/parse.test.mjs | 单测盲区：2 元向量降维/attaches 越界/kind 别名/atwood 回退均无锚 → 随修复补 6-8 断言 | P2 | S | 无 | ✅ R2-1：新增 5 个防御层单测（33/33 绿） |
| AG-117 | parse-schema.js:436-443 | 自动补地面条件是「≥2 个 sphere」：box+sphere 对撞题无地面、box 悬浮直坠 → 判定改「≥2 个动态对撞体」 | P2 | S | 无 | ⬜ |
| AG-118 | workbench.js:2557,2584 | 变更预览 linvel/angvel 一律「摘要略」、attach 行 k=— → 展示速度模长、rope 绳长、spring 默认 k | P2 | S | 无 | ⬜ |
| AG-119 | workbench.js:2588-2602 | 变更清单 50+ 行逐条勾选负担大 → 清单头分类型批量开关（实体/重力/约束/连接四组） | P2 | S | 无 | ⬜ |
| AG-120 | workbench.js:2689-2692 | 实体级低置信无视觉区分 → 行级 confidence<0.5 琥珀描边（克制） | P2 | S | ⚠ 廉价感红线 | ⬜ |
| AG-121 | workbench.js:2605 | 评审界面无法看模型原始输出 → 折叠「原始输出」区 textContent 展示 raw JSON | P2 | S | 无 | ⬜ |
| AG-91（收编） | parse-schema.js:35 | entities>12 无客户端截断（模型可无视 prompt 上限）→ 超限截断+errors | P2 | S | 无 | ⬜ |
| AG-68/69（收编） | parse-schema.js:41-55 | velocity/angvel 无量级校验（1000m/s 也收）→ ±100 clamp+警告 | P2 | S | 无 | ⬜ |
| AG-11（收编） | parse-schema.js:341-351 | 斜面 angleDeg+length+height 同给时静默按 angleDeg 优先 → uncertain 提示过定 | P2 | S | 无 | ⬜ |
| AG-14（收编） | parse-schema.js:157 | hinge 初始摆角 0.4 固定 → given.angleDeg 推导 swing+Ttheory 小角假设边界提示 | P2 | M | 无 | ⬜ |
| AG-22（收编） | parse-schema.js:396 | 对撞 1.6m 间距固定：高速对撞 needT 跑不完 → 相对速度>3 时间距 2.4 | P2 | S | 无 | ⬜ |
| AG-26（收编） | explain.js:182 | spring 峰去毛刺阈值 5 采样固定，k 大周期短漏检 → max(3, T_est 采样数/8) | P2 | M | 无 | ⬜ |
| AG-28（收编） | workbench.js:1671 | atwood aFit=2d/t² 假设静止起跑匀加速 → 位移三点二次拟合 | P2 | M | 无 | ⬜ |
| AG-52（收编） | workbench.js:2946 | 解释对象 first-fit 选球 → 优先 measured:true 实体 | P2 | S | 无 | ⬜ |
| AG-58（收编） | explain.js:268-274 | astro period 采样未满时「采样中」与 fail 混合呈现 → 中性文案+建议重跑更久 | P2 | S | 无 | ⬜ |
| AG-59（收编） | parse-schema.js:469 | celestial 位置全缺且速度 0 时落 r=3 兜底无提示 → 补 errors/uncertain | P2 | S | 无 | ⬜ |
| AG-13（收编） | parse-schema.js:203,205 | atwood 球 y=1.0/radius 0.12 固定忽略题给 → 双双尊重 | P2 | S | 无 | ⬜ |
| AG-48（收编） | workbench.js:2766 | 修正记录只进 doc.meta 无统计 → localStorage 聚合「哪类字段最常被改」反哺 prompt | P2 | M | 无 | ⬜ |
| AG-87（收编） | workbench.js:2910 | 建场失败仅明细行可见 → n 失败时汇总 toast | P2 | S | 无 | ⬜ |
| AG-16（收编） | parse-schema.js:265 | rotation r0=0.7 固定 → 题给初始半径推导+滑块切向速度同步 | P2 | S | 无 | ⬜ |
| AG-17（收编） | parse-schema.js:449 | 天体质量量级真实且无 G 时按 G=1 建场无提示 → uncertain 注明 G 可能未按教学缩放 | P2 | S | 无 | ⬜ |
| AG-15（收编） | parse-schema.js:217-246 | springLayout 仅水平振子 → 竖直吊挂分支（平衡位预拉伸 mg/k） | P2 | L | ⚠ 需实测标定 | ⬜ |
| AG-79（收编） | docs/ | 解析链路无架构文档 → AGENT-PIPELINE.md（prompt→extract→normalize→评审→建场→explain 数据流） | P2 | M | 无 | ⬜ |

## MDL 更多的模型（42 项）

### 线 (a) 解析后端多模型可插拔（12 项）

| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| MDL-1 | tools/server/providers.json（新） | provider 注册表配置 `[{name,label,base_url,model,key_env,key_file,timeout_s}]`，默认条目=现 serve.py 常量；key 不进本文件；附 providers.example.json 占位 | P0 | S | 双源期先落地再迁常量 | ⬜ |
| MDL-2 | serve.py:11-14,57-64 | load_key()→load_providers()：启动解析 providers.json（缺文件回落单 provider 现行为），key 解析 env→key_file，stderr 摘要不回显值 | P0 | M | 启动只验 key 存在不验活 | ⬜ |
| MDL-3 | serve.py:108-146 | call_step_messages→call_llm(provider,msgs)：URL/鉴权/model/超时全参数化；兼容 reasoning_content 与纯 content | P0 | M | ⚠ 各家思考流字段差异 | ⬜ |
| MDL-4 | serve.py:188-191 | /api/status 扩展 providers:[{name,label,model,available}]（不回显 key/URL），保留旧字段兼容 | P0 | S | ⚠ w3 对 status 形状断言 | ⬜ |
| MDL-5 | index.html + workbench.js:2444+ | 前端模型选择器：selModel（boot 拉 status 填充，仅 1 个时隐藏），parse 带 {model}，选择存 localStorage | P1 | M | ⚠ parseBusy 互斥不失效 | ⬜ |
| MDL-6 | workbench.js:2451,2473,2482,2609 | 4 处 'step-5-preview' 字面量（解析提示/徽标）改用 /api/status 当前模型变量；fixture 徽标维持「示例数据」 | P0 | S | w2 若锚定模型名需同步 | ⬜ |
| MDL-7 | serve.py do_POST | 跨 provider 失败降级：401/429/5xx/超时按注册序试下一有 key provider（深度限 1），响应附 usedProvider+degraded，前端 toast | P1 | M | ⚠ 双倍调用预算 | ⬜ |
| MDL-8 | providers.json + serve.py:14 | 每 provider timeout_s：视觉思考型 90s/纯文本 30s；客户端 100s 不变 | P1 | S | 超时分层 | ⬜ |
| MDL-9 | tools/check.py:53-71 | 扫描目标加 providers.json（key 值模式而非端点）；端点白名单=serve.py+server/*.json；校验 key_file 均在 gitignored 目录 | P0 | S | 扩目标集勿误伤 | ⬜ |
| MDL-10 | tools/server/（约定+README） | key 文件按 provider 命名规范，gitignore 已覆盖整目录；示例一律占位 | P1 | S | 旧 step_key.txt 保留兼容 | ⬜ |
| MDL-11 | tools/fixtures/parse-*.json | fixture 按 provider 打标 _provider/_model，UI badge「示例数据·synthetic」 | P2 | S | normalize 容忍新键已有出口 | ⬜ |
| MDL-12 | realspot.mjs | 多 provider 真实抽查：每 provider 1 次 incline 图，无 key 自动 skip，原始输出落盘 gitignored | P2 | M | ⚠ 调用预算 n×1 | ⬜ |
| MDL-14 | serve.py:198-199 | 无 key 文案升级：503 提示「已注册 n provider，m 缺 key」；与 w3 兼容 | P2 | S | ⚠ w3 503 文案锚 | ⬜ |
| MDL-15 | serve.py __main__ | 启动配置校验：providers.json 解析失败/缺键/重名 → stderr 明细+降级内建单 provider（不拒启动） | P2 | S | 坏配置需 boot 可见 | ⬜ |

### 线 (b) 更多预置场景/实体模板（28 项）

| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| MDL-16 | presets.js 新键 pendulum | 单摆：锚+球+rope L=1.2、拉开 0.3rad；T=2π√(L/g)≈2.20s | P1 | S | 解释器无单摆分支（→MDL-43） | ✅ R2-2：见实施批次记录（子 agent 实施+Rapier 端到端自查） |
| MDL-18 | presets.js conical | 锥摆：rope L=1.0、θ=30° 切向 v≈1.68；trails 圆锥投影 | P1 | S | 绳约束下半径微摆（assumptions 注明） | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-19 | presets.js vertCircle | 竖直圆周临界：v=7.0<√(5gL)=7.67 抛离 vs v=8.0 过顶对照 | P1 | S | 高速 CCD 已兜 | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-20 | presets.js springSHM | 弹簧振子（水平）：k=20 damping=0，T=2π√(m/k)=1.40s；explainSpring 已有→端到端即绿 | P0 | S | spring 默认 damping 0.5 须置 0 | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-21 | presets.js springVert | 竖直弹簧振子：平衡拉伸 mg/k、T 同水平；能量曲线闭合 | P1 | S | 重力势基准面 assumptions 写明 | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-22 | presets.js coupled | 耦合双振子：两 box+spring 连心，质心匀速+相对振动 | P2 | S | 质心漂出视野（地面加长） | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-23 | presets.js springGun | 弹簧弹射台：压缩 0.5m 释放 v=2.24 平抛落点对照 | P2 | S | 球初位=压缩量须精确 | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-24 | presets.js+runtime recoil | 反冲演示：压缩 spring 释放 m 比 1:2→v 比 2:1；需扩展 spring params.detach | P2 | M | 需 runtime 扩展 | ⬜ |
| MDL-25 | registry+runtime+presets conveyor | 传送带：vendored Rapier 无 surfaceVelocity（grep 证实）→ kinematicVelocityBased 皮带体+linvel+beltSpeed | P1 | M | ⚠ 三处联动 | ⬜ |
| MDL-26 | presets.js collLab | 一维碰撞实验台：e=1 道与 e=0 道双泳道对照，守恒条+collisionReports 直读 | P0 | S | 泳道内两球设同 e（平均合成口径） | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-27 | presets.js bulletBlock | 子弹打木块：弹丸 m=0.05 v=15+木块 e=0 共速，动量守恒+ΔKE 损失 | P1 | S | 弹丸不嵌入但共速正确（注明） | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-28 | presets.js newtonCradle | 牛顿摆：5 球等长 rope 预接触 e=1 | P2 | M | ⚠ 求解器序列传递非严格逐球（注明） | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-29 | presets.js ballChain | 水平多球碰撞链：5 球预接触+1 入射 | P2 | S | 同上；e=0.95 折衷 | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-30 | presets.js bounceCompare | 反弹高度对照：三球 e=0.9/0.5/0.2 同高 2m，hₙ=e²ⁿh₀ | P1 | S | 地面 restitution 同步 | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-31 | presets.js galileoDrop | 平抛与自由落体同时落地：同高两球一 vx=2 一静止 | P0 | S | 两球 z 错开防互碰 | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-32 | presets.js rangeAngles | 斜抛射程角对照：v=5 三球 30°/45°/60° | P1 | S | z 错开；落地 e=0.05 防乱跳 | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-33 | presets.js+runtime inclinePulley | 斜面连接体：需泛化 onPulley 侧沿坡面约束 | P2 | L | ⚙ atwood 约束重写回归面大 → ⛔ 决策不动现约束 | ⛔ |
| MDL-34 | presets.js atwoodHeavy | 阿特伍德大质量比 m=3/1（a=4.9 显著）+能量模式 | P2 | S | 注意 PHY-51 教训（注释=参数） | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-35 | presets.js binaryStar | 双星互绕：m=50 间距 4 反向 v=2.5 绕质心；n 体自积分零扩展 | P1 | S | 初值对称质心静止 | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-36 | presets.js threeBody | 三星拉格朗日等边解（收编 PHY-33）：m=30 边长 3 v=3.16；混沌敏感性注明 | P2 | M | 初值敏感（演示时限引导） | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-37 | presets.js rollRace | 滚动竞速球 vs 圆柱：a=5/7 vs 2/3·g sinθ 球先到 | P1 | S | 坡宽≥2.2×半径防侧翻 | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-38 | presets.js frictionLock | 摩擦自锁临界角 26.57°+μ=0.5，检查器微调跨临界 | P2 | S | 引擎无静/动摩擦区分（注明蠕变） | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-39 | presets.js blockOnBlock | 板块模型：地面光滑叠面 μ=0.4，动量守恒+摩擦生热 | P1 | S | 两层设同 μ（平均合成） | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-40 | presets.js weightless | 失重演示：球+力传感器，斜抛段读数 0 落地回 mg | P1 | S | 传感器文案引导 | ✅ R2-2：子 agent 实施，Rapier 端到端自查过 |
| MDL-41 | index.html:337-350 + workbench.js:521 | 预置注册单源化：PRESETS 自动生成 <option>+optgroup 分组（基础/碰撞/振动/转动/天体） | P1 | S | ⚠ w7 option 文本锚 | ✅ R2-1：预置下拉由 PRESETS 自动生成+optgroup 六组，未分组落「更多」；新预置教学默认叠加层 |
| MDL-42 | presets.js | 预置教学说明字段 note（验证目标+理论值），载入后经 assumptions 面板展示 | P2 | S | 与 meta.assumptions 语义不混 | ⬜ |
| MDL-43 | explain.js | 新预置解释分支：单摆/锥摆/竖直圆周/竖直弹簧 4 分支理论对照+单测锚 | P1 | M | 分派优先级回归 | ⬜ |
| MDL-44 | tools/ui-test/w7-presets-explain.mjs | 新预置回归网：每预置 1-2 断言（实体数/守恒条/telemetry）并入 run-all，一律 waitForFunction | P1 | S | 套件时长控量 | ⬜ |

## PAR 更多可调参数（38 项）

「设置浮层」=复用 helpOverlay 模式新增的半透明面板（视口/手感/性能参数集中地）。红线：默认值全=现值，不改测试断言依赖。

| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| PAR-1 | workbench.js:2015/2038/3382-3384 | 受力箭头/张力/分解 9.81 硬编码（月球卡场景画错力）→ 读 Math.abs(doc.gravity) | P0 | S | 与 AG-3/4 同族遗漏 | ✅ R2-1：三处 9.81 改读 doc.gravity（受力箭头/张力/分解读数） |
| PAR-2 | runtime.js:7 FIXED_H=1/120 | 文档级 doc.solver.hz 枚举 {60,120,240} 默认 120→设置浮层；astroInfo 周期换算同步 | P1 | M | ⚠ p 系能量断言依赖 1/120，默认不变即安全 | ⬜ |
| PAR-3 | runtime.js:57 numSolverIterations=8 | 文档级 doc.solver.iterations 默认 8→int 4~16 | P1 | S | 默认不变 | ⬜ |
| PAR-4 | registry.js:74 angDamping 0.05 | doc 有字段无 UI → 检查器物理组补行 0~10 | P1 | S | 无 | ⬜ |
| PAR-5 | scene-doc.js:17/18 gravity/G 仅预置卡 | 检查器新增「场景」组：重力 0~50、G 0~1e6（校验复用 MECH API 规则） | P1 | S | 走 commit+undo 主通道 | ⬜ |
| PAR-6 | viewport.js:569 toneMappingExposure=1.06 | UI 级内存态（localStorage）→ 顶栏视角组滑杆 0.6~1.6 | P1 | S | ⚠ 截图金标默认不变 | ⬜ |
| PAR-7 | workbench.js:721-722 微调 0.1/Shift 1 | UI 级档位 {0.01,0.05,0.1,0.25,0.5}+Shift 系数，默认 0.1 | P1 | S | ⚠ e2e 或断言 0.1 步长 | ⬜ |
| PAR-8 | runtime.js:573/579 + viewport.js:469/480 | 轨迹 cap 1800 → 文档级 doc.render.trailCap 600~3600；采样间隔 2 不参数化（astro 公式硬绑） | P1 | M | cap 变更同步缓冲分配 | ⬜ |
| PAR-9 | explain.js 判定容差分散（斜面3%/抛体8%/…） | 文档级 doc.meta.explainTolerance 按题型键，缺省=现值→Agent 页折叠区 1~20% | P1 | M | 默认不变即安全 | ⬜ |
| PAR-10 | workbench.js:2966 needT 七题型窗口 | 文档级 doc.meta.explain.windowScale 倍率默认 1→0.5~3 | P1 | M | ⚠ UI-47 进度分母联动 | ⬜ |
| PAR-11 | workbench.js:2426 解析超时 100s（文案两处硬编码） | UI 级 30~180s 默认 100（下限>服务端 90s），文案插值 | P1 | S | 改小假失败风险 | ⬜ |
| PAR-12 | runtime.js:8 MAX_STEPS_PER_FRAME=8 | UI 级 int 2~16 默认 8（4x 档前置） | P2 | S | 调大失去掉步保护 | ⬜ |
| PAR-13 | runtime.js:134 setCcdEnabled(true) | 文档级 per-entity physics.ccd 默认 true+场景速度阈值 0=恒开 | P2 | M | ⚠ 高速穿隧回归默认不变 | ⬜ |
| PAR-14 | runtime.js:386 天体 SUB=4 | 文档级 doc.solver.astroSubsteps 2~8 默认 4 | P2 | S | 天体漂移断言默认不变 | ⬜ |
| PAR-15 | runtime.js:600/608 录制每 3 步一帧 cap 1200 | UI 级录制时长 10~60s 默认 30（cap 换算） | P2 | S | 内存线性 | ⬜ |
| PAR-16 | runtime.js:192 spin limits[0.15,1.05] | 文档可存无 UI → 检查器约束组双数字行 0~5 | P2 | M | ⚠ spin 预置断言（文档值优先） | ⬜ |
| PAR-17 | viewport.js:603 environmentIntensity=0.55 | UI 级 0~2 默认 0.55 | P2 | S | 观感仅用户主动 | ⬜ |
| PAR-18 | viewport.js:608 阴影 2048² | UI 级枚举 1024/2048/4096 默认 2048（resize dispose 旧 map） | P2 | S | ⚠ 4096 显存×4 | ⬜ |
| PAR-19 | viewport.js:609-611 阴影相机 ±9/1/24 | 文档级 doc.render.shadowRange 默认 9→5~40 | P2 | M | ⚠ 大场景阴影裁切 vs 金标 | ⬜ |
| PAR-20 | viewport.js:564 setPixelRatio(min(dpr,2)) | UI 级枚举 1/1.5/2 默认 2 | P2 | S | ⚠ 4K 截图依赖 2 | ⬜ |
| PAR-21 | viewport.js:575 Fog(16,42) | 文档级 doc.render.fogNear/Far 默认 16/42→near 4~30/far 20~80 且 far>near+5 | P2 | S | 天体远轨被雾吃 | ⬜ |
| PAR-22 | viewport.js:529 速度箭头 0.15+speed×0.22 cap1.8 | UI 级 scale 0.05~0.6、cap 0.6~3 默认现值 | P2 | S | 高速全顶格教学痛点 | ⬜ |
| PAR-23 | viewport.js:287-295 受力箭头散表 | 先集中 FORCE_ARROW_SCALES 常量表，再加 UI 全局乘子 0.5~2 默认 1 | P2 | M | 相对长度语义不破坏 | ⬜ |
| PAR-24 | viewport.js:821-822 gizmo 吸附 0.1m/15° | UI 级档位平移 {0.05,0.1,0.25,0.5}/旋转 {5,15,45} 默认现值 | P2 | S | ⚠ p24 吸附断言默认不变 | ⬜ |
| PAR-25 | workbench.js:648/667 + viewport.js:178 | 吸附搜索半径 0.25/0.3/0.09（平方值散写）→ UI 级统一线性值 0.05~1 | P2 | S | ⚠ 平方→线性换算易错 | ⬜ |
| PAR-26 | scene-doc.js:91 History(60) | UI 级 20~200 默认 60 | P2 | S | 快照式 undo 成本可控 | ⬜ |
| PAR-27 | workbench.js:121-123 autosave 同步写 | UI 级节流 0~2000ms 默认 0=现状；visibilitychange flush 兜底 | P2 | S | 节流开启崩溃丢档窗口（默认 0 不变） | ⬜ |
| PAR-28 | index.html:486-491 selSpeed 0.1~1.0 | UI 级补 2x/4x（4x 需 PAR-12 上限 16 配套） | P2 | S | ⚠ advance 上限联动 | ⬜ |
| PAR-29 | workbench.js:1487+ 守恒条色阶 8/1/1/2% | 展示色阶独立于判定 → UI 级 1~20% 默认现值 | P2 | S | 仅颜色不影响判定 | ⬜ |
| PAR-30 | workbench.js:2454-2457 解析重试 1 次 | UI 级 int 0~2 默认 1 | P2 | S | ⚠ 重试=双倍调用预算 | ⬜ |
| PAR-31 | workbench.js:2414 低置信阈值 0.35 | UI 级 0.1~0.6 默认 0.35 | P2 | S | 无 | ⬜ |
| PAR-32 | workbench.js:2275/2309 图片降采样 1400px | UI 级 800~2000 默认 1400 | P2 | S | ⚠ 请求体 413 风险 | ⬜ |
| PAR-33 | runtime.js:690 光门容差 0.15 | 文档级 params.gateTol 0.02~0.5 | P3 | S | 高速球穿门漏检 | ⬜ |
| PAR-34 | runtime.js:290 管道脱管 r>0.30 | 文档级 params.escapeR 0.1~1 | P3 | S | ⚠ p8 经典轨回归 | ⬜ |
| PAR-39 | viewport.js:920 脏标记保险丝 500ms | UI 级 250~2000ms 默认 500 | P3 | S | 调大=漏网旧画更久 | ⬜ |
| PAR-41 | viewport.js:428/906 正交视野高 6（resize 分支 3=6/2 重复） | UI 级 2~20 默认 6，resize 联动单源 | P3 | S | 两处须同步 | ⬜ |
| PAR-42 | viewport.js:72/75 取景 lerp 0.18+距离系数 3/2.4/1.6 | UI 级动画速度 0.05~0.5 默认 0.18、距离系数 1.5~5 默认 3 | P3 | S | ⚠ 截图金标取景距离默认不变 | ⬜ |
| PAR-43 | viewport.js:585-588 阻尼 0.07/minDist 0.4/maxDist 100 | UI 级各默认现值 | P3 | S | ⚠ maxPolar 放开破坏防钻地 | ⬜ |

## MAT 质感（30 项）

实锤资产缺口：wood/normal.jpg（1.5MB）、jupiter/mars 贴图在盘未加载；saturnRing 仅 legacy 消费主程序无环；thumbs 无 ACES。大视觉项一律样张先行。

| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| MAT-65 | materials.js:9-10,34 | repeat 定值且纹理全局共享：6m 坡与 0.3m 块同密度（收编 MAT-1）→ registry 加 matRepeat 钩子按最长边量化 0.5/1/2/4m 桶，桶内 clone texture | P1 | M | ⚠ 桶缓存随 clear 释放防泄漏 | ⬜ |
| MAT-66 | materials.js:33-34 | wood/normal.jpg 实盘未加载，木块零凹凸（收编 MAT-14）→ loadTex 补第 8 张线性空间+normalScale 0.5 | P1 | S | 无 | ✅ R2-3：子 agent 实施，check 契约过 |
| MAT-67 | materials.js:35-36 | jupiter/mars 贴图实盘未用 → 新增材质键（结构同 saturn），MATERIAL_OPTIONS+check.py 契约三处同步 | P2 | M | 契约不同步挂 check | ✅ R2-3：子 agent 实施，check 契约过 |
| MAT-68 | registry.js:295 + runtime.js:92 | saturnRing 仅 legacy 消费：主程序 celestial 无环 → params.ring 挂环 mesh（复用 M.saturnRing）倾角 26.7° | P2 | M | 环片透明排序 depthWrite:false 复核 | ✅ R2-3：子 agent 实施，check 契约过 |
| MAT-69 | materials.js:73-75 | sun 恒定 emissive 1.35 平面盘 → 程序化 256² 径向临边昏暗 emissiveMap（中心 1.0→边缘 0.72） | P2 | S | 过暗显脏样张定系数 | ✅ R2-3：子 agent 实施，check 契约过 |
| MAT-70 | registry.js:295 | 行星无大气边缘 → BackSide fresnel 壳（scale 1.04、Additive、≤0.18）；样张逐像素对比出现 glow 感即弃 | P3 | M | ⚠ 廉价 glow 生死线样张先行 | ⬜ |
| MAT-71 | materials.js:78-82 | saturn 未设 envMapIntensity 吃满摄影棚环境（太空语义错）→ 0.35 与 wood 0.55/chrome 1.25 梯度 | P2 | S | 无 | ✅ R2-3：子 agent 实施，check 契约过 |
| MAT-72 | materials.js:43 | steelDark 无拉丝 → 程序化 256² 水平条痕 roughnessMap（0.35~0.5 带） | P2 | M | 过强显塑料样张定幅度 | ✅ R2-3：子 agent 实施，check 契约过 |
| MAT-73 | materials.js:70 | brass 无清漆层 → clearcoat 0.25/roughness 0.35 模拟仪器漆面 | P2 | S | 无 | ✅ R2-3：子 agent 实施，check 契约过 |
| MAT-74 | materials.js:67 | rubber 0.94 全均匀哑光 → 128² 微噪声 roughnessMap（0.90~0.97） | P3 | S | 无 | ✅ R2-3：子 agent 实施，check 契约过 |
| MAT-75 | materials.js + registry.js:48-57 | 缺哑光塑料/粉笔面 → 新增 mattePlastic（0x9aa0a6 rough 0.55 clearcoat 0.06）与 chalk（0xd8d5cf rough 0.98） | P2 | M | 契约同步同 MAT-67 | ✅ R2-3：子 agent 实施，check 契约过 |
| MAT-76 | registry.js:243,259 | rope 8 段/spring 10 段细杆高光走样 → 径向 12/14 段或专属 roughness 0.5 clone | P2 | S | 顶点 +30%/杆总量极小 | ✅ R2-3：子 agent 实施，check 契约过 |
| MAT-77 | registry.js:80-88 | ramp ExtrudeGeometry UV=米域坐标（非 0-1），MAT-65 落地前置 → 按 UV 域分治或 wedge UV bbox 归一化 | P1 | M | ⚠ MAT-65 正确性前置 | ⬜ |
| MAT-78 | thumbs.js:15-25 | 缩略图 NoToneMapping+fov38 与主场景 ACES/1.06/fov42 色差 → 补三行对齐 | P1 | S | 无 | ✅ R2-3：子 agent 实施，check 契约过 |
| MAT-79 | viewport.js:635-639 | GridHelper 20m 硬边界+1px 无 AA → 自定义 ShaderMaterial 网格：fwidth 抗锯齿+径向 alpha r6→9.5m 渐隐 | P2 | M | ⚠ p23 网格档位回归 | ⬜ |
| MAT-80 | viewport.js:613 | normalBias 0.02 固定米制：大场景 acne 回归 → 随 gridStep/包围盒线性缩放 | P2 | S | 无 | ⬜ |
| MAT-81 | viewport.js:567 | PCFSoft 固定软化 → 样张对比 VSM+radius 2~3；不过关维持并决策记录 | P3 | S | ⚠ VSM 渗漏+全场景阴影回归 | ⬜ |
| MAT-82 | viewport.js:615-617 | fill 方向光硬质无面积感 → RectAreaLight 软箱替换（UniformsLib.init 一次）无阴影 | P2 | M | ⚠ 全场景亮度微变金标 | ⬜ |
| MAT-83 | registry.js:412 | 点光源 distance=7 硬截断亮环 → distance 0（decay2 无限）+intensity 重标或 12 | P2 | S | 无 | ✅ R2-3：子 agent 实施，check 契约过 |
| MAT-84 | index.html + viewport.js:574 | 摄影暗角 = CSS 径向 0→0.22 纯黑 overlay（零 GPU）；DOF/bloom/grain 判死不做 | P2 | S | ⚠ 过重压背景 lum 带，样张定 | ⬜ |
| MAT-86 | viewport.js:760-778 | 选中表达仅 BoxHelper 线框 → fresnel 外壳方案（scale 1.03、琥珀 0.15 alpha）与描边样张对比定夺 | P2 | M | ⚠ 选中截图金标 | ⬜ |
| MAT-87 | viewport.js:471 | 轨迹全程等亮 0.75 → 顶点色向背景色 lerp 渐隐+depthWrite:false 修排序 | P2 | S | ⚠ 封顶环形重写路径同步写色 | ⬜ |
| MAT-89 | viewport.js:100-111 | 碰撞环恒水平朝向 → collisionReports 补 normal 字段按接触法向定向 | P3 | S | 缺省回退水平 | ⬜ |
| MAT-90 | registry.js:101,408-416 | BULB_MAT emissive 恒定不随 intensity → 按 3 档预建 clone 选挂 | P2 | S | 无 | ✅ R2-3：子 agent 实施，check 契约过 |
| MAT-91 | viewport.js:630,635,643-645 | shadowFloor/grid/轴线三层 1mm 间距掠射闪烁 → 阶梯 0.005/0.01+polygonOffset | P2 | S | 无 | ⬜ |
| MAT-92 | viewport.js:597-603 | HDRI 失败降级无强度标定视觉跳变 → 降级分支 environmentIntensity 单独标定 0.7~0.8 | P3 | S | 无 | ⬜ |
| MAT-93 | viewport.js:603 | 天体场景吃满摄影棚 env 0.55 → celestial 时压 0.3 | P2 | S | ⚠ 天体截图金标 | ⬜ |
| MAT-94 | viewport.js:461,517 | 琥珀语义过载（速度箭头/轨迹/选中/吸附/碰撞 5 处同色）→ 数据类改钢青 0x6f93b5，琥珀保留交互意图 | P2 | S | ⚠ UI-25 图例与金标 | ⬜ |
| MAT-96 | viewport.js:574 | 纯平背景层次弱（收编 MAT-27 样张先行）→ (a) HDRI+blurriness 0.5+intensity 0.12（lum hold 11-12 逐像素验证）或 (b) 极暗弯幕；不得亮于现带宽/可见地平线 | P3 | M | ⚠ 生死线样张一票否决 | ⬜ |

## PERF 性能（12 项）

| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| PER-83 | workbench.js:1957-1959+2098-2099 | tickFocus/tickPose 每帧双调（=FEEL-96）+双份 clone 分配 → 删第二次 | P1 | S | 动画变慢（实为修 bug） | ✅ R2-1：与 FEEL-96 同修（删双调） |
| PER-84 | workbench.js:594-601 | catalogSearch 每键全目录 innerHTML 重建（~40 卡）→ 120ms 防抖或 display:none 过滤 | P2 | S | 焦点恢复逻辑保留 | ⬜ |
| PER-85 | viewport.js:270-275 | 力箭头池切换 scene.remove 不 dispose（cone+line 泄漏）→ traverse dispose | P2 | S | 无 | ⬜ |
| PER-86 | viewport.js:465 | updateTrails 每帧每线重算 id 哈希（展开分配+reduce）→ id→色 Map 缓存随 clear 失效 | P2 | S | 无 | ⬜ |
| PER-87 | runtime.js:462-583 | stepOnce 每步 5 次独立遍历 binds×120Hz×8 → 合并单遍或 rebuild 预收集 dynamic 列表 | P1 | M | 可读性下降 | ⬜ |
| PER-88 | workbench.js:1721-1731 | updateReadouts 每 0.15s 逐字段 querySelector×9 → renderInspector 缓存引用表 | P2 | S | liveGrid 重建时失效缓存 | ⬜ |
| PER-89 | workbench.js:719-735 | 方向键长按 30 次/s rebuildAll+30 条 undo → 150ms 节流+historyBatch（与 FEEL-115 同批） | P1 | S | p 系无该路径断言 | ⬜ |
| PER-90 | workbench.js:979-980 | 大纲每行 doc.entities.filter×2 O(n²)（收编 PER-62）→ 预建 target 计数 Map 单遍 | P2 | S | 无 | ⬜ |
| PER-91 | runtime.js:255-258 | _collectTrackBalls 越权重置 _pulleyPairs 与 rebuild 顺序隐式耦合 → 删该行，清空职责归还 _collectPulleyPairs | P2 | S | 回归 atwood | ⬜ |
| PER-93 | workbench.js:56-86 | 启动路径串行（RAPIER.init→HDRI→7 贴图无依赖）→ Promise.all 并行提前数百 ms | P2 | S | veil 三步文案对齐 | ⬜ |
| PER-96 | workbench.js:1985+2012 | 矢量/受力块各遍历 entities+各调 telemetry（每帧 2 次全量分配）→ 单遍采集 | P2 | S | 行为不变 | ⬜ |
| PER-97 | viewport.js:760-765 | setHighlights 只 dispose geometry，BoxHelper material 泄漏 → 补 material.dispose() | P2 | S | 无 | ⬜ |

## UI 界面细节（14 项）

| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| UI-89 | index.html:83,113,131,457 | 深色工作台用浏览器默认亮色滚动条 → ::-webkit-scrollbar 6px+thumb var(--line)+scrollbar-color | P1 | S | 无 | ⬜ |
| UI-90 | registry.js:447-453 + opAddComponent | 手动连续添加同类型名字恒「球 1」 → 按文档内同类型计数 +1 命名 | P1 | S | w1 hasText 匹配不受影响 | ⬜ |
| UI-91 | index.html:376-377 | 搜索框无结果计数与清空 → 「n 项」角标+×（收编 UI-19） | P2 | S | 无 | ⬜ |
| UI-92 | index.html:566-583 | helpOverlay 无 role=dialog/aria-modal，Tab 穿透 → 对话框语义+打开聚焦首行 | P2 | S | 无 | ⬜ |
| UI-93 | workbench.js:739-771 | 目录卡 div+onclick：Tab 跳过、焦点环永不出现 → role=button+tabindex=0+Enter/Space | P1 | S | focus 不触发 ghost 需守卫 | ⬜ |
| UI-94 | workbench.js:32-38 | toast 无 aria-live 且成功/警告同色 → aria-live=polite+toast(msg,kind)（与 FEEL-117 同批） | P2 | S | 无 | ⬜ |
| UI-95 | workbench.js:453-458 | 运行暂停态 btnPlay 与 btnPause 双「继续」歧义 → btnPlay 运行态改「从头运行」 | P2 | S | ⚠ w 系按钮文案断言 | ⬜ |
| UI-96 | index.html:505 | #roSel 无 max-width 长名挤爆底栏 → max-width+ellipsis+title（收编 UI-37） | P2 | S | 无 | ⬜ |
| UI-97 | index.html:424-466 | 重力卡大数字无 m/s² 单位小字 → 卡面补单位后缀（收编 UI-35） | P2 | S | 无 | ⬜ |
| UI-98 | index.html:158,241 | .ro-grid .k 等用 --faint（2.4:1）承载功能标签 → 数据标签升 --dim | P2 | S | 全局色微调 | ⬜ |
| UI-99 | workbench.js:2205-2215 | 复制结果只拼两行，astro/hinge/spring 关键数据不进剪贴板 → 按 kind 分支拼全数据行 | P2 | S | 无 | ⬜ |
| UI-100 | index.html:479-506 | 1280 宽 simbar 满排无溢出保护（<1100 错乱）→ 分组折叠/缩 padding（收编 UI-9） | P1 | M | p 系按钮选择器 | ⬜ |
| UI-102 | workbench.js:2636-2638 | 评审区重力输入无 label 关联 → 补 aria-label | P2 | S | 无 | ⬜ |
| UI-103 | index.html:146,197 | .frow/.pgrid input:focus 的 outline:none 抵消 UI-2 焦点环 → 仅 :focus:not(:focus-visible) 去 outline | P2 | S | 截图金标微变 | ✅ R2-1：.frow/.pgrid 焦点环仅对非 focus-visible 抑制 outline |

## ENG 工程（14 项）

| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| ENG-71 | check.py:86-89 | node --check 清单漏 src/engine/thumbs.js → 加入 | P1 | S | 无 | ✅ R2-1：check.py node 清单补 thumbs.js（JS_FILES 化） |
| ENG-72 | check.py:106-114 | id 交叉核验只匹配 $('id')，7 处 getElementById 不设防 → 扩正则+动态 id 白名单 | P2 | S | 误报需调 | ⬜ |
| ENG-73 | check.py:125-128 | en-dash/emoji 红线只扫 index.html → 扩到 src/*.js 字符串字面量（跳过注释） | P2 | S | 注释排除防误报 | ⬜ |
| ENG-74 | check.py（新节） | console.log 无回归护栏 → 扫描（error/warn 放行）违者 FAIL | P1 | S | 无 | ✅ R2-1：check.py 加 console.log 残留扫描（3a 节） |
| ENG-76 | scene-doc.js:74-82 | deserializeDoc 只验 entities/version：外部 JSON 缺 meta 直接 TypeError → 规范化默认值 | P1 | S | 无 | ⬜ |
| ENG-77 | workbench.js（全局） | 无 onerror/unhandledrejection 兜底 → errbar 通道显示「内部错误」+console.error 保留现场 | P1 | S | 过滤良性事件 | ⬜ |
| ENG-78 | workbench.js:243-335 | opAddComponent 四分支重复收尾五连 → 抽 finishAdd(e,label)（低风险纯抽取） | P2 | S | 逐分支 diff | ⬜ |
| ENG-79 | workbench.js:3009-3217 | 7 个 renderXXXExplain 同构+一个嵌套在函数体中段 → 抽 renderExplainGrid 纯函数+移顶层 | P2 | S | w7 文本不变 | ⬜ |
| ENG-80 | workbench.js:1494-1540 | astroInfo 纯数学锁在 workbench 0 单测 → 抽 engine/astro-math.js+node --test 锚 | P1 | M | 无 | ⬜ |
| ENG-81 | workbench.js:2523-2603 | matchOverrides/buildChangePreview 纯函数无单测 → 抽取+单测（AG-40 前置锚） | P2 | M | 无 | ⬜ |
| ENG-82 | viewport.js:459-498 | viewport 0 单测：增量写点边界/缩放钳制 → 抽纯函数进 test/unit | P2 | M | 抽取面大则只做钳制函数 | ⬜ |
| ENG-83 | run-all.mjs:29-49 | 聚合器不含单测与 check.py → 前置串跑 node --test+check.py 任一失败计 FAIL（收编 ENG-62） | P1 | S | CI 总时长 +数秒 | ⬜ |
| ENG-84 | index.html:318-326 | vendor 仅靠快照钉死无版本契约 → check.py 断言 three.core.js REVISION='186' | P2 | S | 升级需同步改 | ⬜ |
| ENG-85 | serve.py:242-244 | 端口被占直接抛栈退出 → OSError 输出人类可读提示+退出码 2 | P2 | S | 无 | ⬜ |

---

## 实施批次记录（R2）

（每批一 commit：完整回归全绿 + check.py 过 + 台账打勾）

### R2-1 Agent P0 修复 + 手感/工程快赢（主线程批次，16 项）
AG-93 解析异常阶段流转 / AG-94 _extract_json 思考流草稿误取（rfind+最末闭合，python 3 场景实测）/ AG-95 atwood 布局失败静默 0 实体→回退通用+uncertain / AG-96 二维碰撞 keBefore 漏 B 球+1−e² 百分比维度 bug / AG-97 二维向量补零升维 / AG-99 KIND_MAP 12 别名 / AG-112 attaches·joint 越界拦截（边界=原始实体数+2：索引语义针对布局后列表——springLayout 补墙是合法越界，首轮 entities.length 边界误杀 p9/p17 spring fixture，已修）/ AG-116 +5 单测（33/33）/ PAR-1 重力三处硬编码 / FEEL-96+PER-83 tick 双调 / UI-103 焦点环 / ENG-71 thumbs 入 check / ENG-74 console.log 守卫 / MDL-41 预置下拉单源化。
首轮回归 4 红（p6/p9/p11/p17）：p9/p17=spring fixture 边界误杀；p11 复跑绿（负载 flake）；p6=守恒条 300ms 死等，按 p8 方案加固（显式 change+waitForFunction）。修复后全绿。

### R2-2 预置场景波（子 agent 实施，21 个新预置 = MDL-16..40 主体）
31 预置全量 Rapier 端到端自查（每预置 10s@120Hz）：0 关节失败 0 NaN；bulletBlock 共速 0.710（理论 0.714）、collLab e=1 速度交换精确、atwoodHeavy a=4.905 精确、springSHM 振幅无衰减、springGun 落点 1.680（理论 1.70）。
实施中发现与调研假设不符并已修正：①Rapier spring 是双向力不能直接弹射→springGun 用 0.02kg 轻推板传力；②板块模型两层 μ 按平均合成口径重配（板 0/滑块 0.8→叠面 0.4、板-地 0）；③bounceCompare 分道地面同步 e；④newtonCradle/ballChain 求解器逐对传递局限按实测校准 assumptions 措辞。单测 26 个新增（presets.test.mjs，经 module.registerHooks 把 three 映射到 vendor）。

### R2-3 材质质感波（子 agent 实施，13 项 = MAT-66..91 主体）
在盘未接线资产补齐：wood 法线贴图、jupiter/mars 材质键、主程序土星环（celestial ring 参数）；程序化微细节：太阳临边昏暗 emissiveMap、暗钢拉丝、黄铜清漆、橡胶噪声、灯泡三档；一致性：行星 envMapIntensity 梯度 0.35、thumbs ACES 对齐、点光源 distance 0 物理衰减。check.py 材质契约过。MAT-80/91（viewport.js 内逻辑）按文件约束跳过留主线程。
