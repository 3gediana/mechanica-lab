# 三轮优化台账 · R3-300（2026-10-04）

用户点名：**300 项，聚焦 agent 能力 + 手感，参考《城市天际线》《文明6》的操作手感与 UI 品质**，细节自决，不间断打磨。
调研方法：4 个并行子 agent（FZ 放置/选择/相机/gizmo/大纲、FB 反馈/通知流/时间/撤销/键盘、AX 解析准确度扩展、AB 解释器/实验教学/数据呈现），全部条目带 file:line 证据，与一轮（OPTIMIZATION-500.md）/二轮（OPTIMIZATION-R2-250.md）台账双去重；收编项均读码复验。
303 条候选裁 3 条 P3（AB-55 教学彩蛋、AX-33 英文题规则、FB-55 chip 过渡）定稿 **300 项**。配额：FZ 75 · FB 75 · AX 75 · AB 75。
状态：⬜ 待做 · ✅ 已实施（附实测）· ⛔ 需设计决策/不做。

**调研勘误（二轮台账口径修正）**：R2 FEEL-110 断言「r186 OrbitControls 无 dollyToCursor」已过期——vendored OrbitControls.js:306 实有 `zoomToCursor`（:778/:815/:1060 消费），滚轮朝光标缩放现为一行开关（→FZ-45）。

---

## FZ 放置/选择/相机/gizmo/大纲（75 项）

### 放置工具链（城市天际线核心）
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| FZ-1 | viewport.js:687-704 + workbench.js:800 | ghost 跟随暗示「放这里」但视口左键仍是点选（收编 FEEL-103）→ ghost 激活期 `_onUp` 优先放置：调 onGhostPlace(pos)；Shift+点击=保留选择放置；Esc 退出 | P1 | M | ⚠ p 系点击用例需先 Esc | ⬜ |
| FZ-2 | viewport.js:238,242 | ghost 无旋转预览（收编 FEEL-134，键位按 FB-64 改 [ ]）→ [ ] 绕 y 旋 15°（Shift=90°），放置写进 transform.rot；ghost 激活期键位覆盖 | P2 | S | E 冲突已避（改 [ ]） | ⬜ |
| FZ-3 | viewport.js:239 | ghost 出生钉 (0,spawnY,0)，鼠标不动预览在视野外（收编 FEEL-97）→ 缓存最近 pointermove，showGhost 立即跟随一次 | P1 | S | 无 | ⬜ |
| FZ-4 | workbench.js:327-328 | 点击放置无落点反馈（收编 FEEL-98，摆位不动）→ 落点 spawnImpact 环闪+toast 坐标 | P1 | S | 无 | ⬜ |
| FZ-5 | workbench.js:800 | 每次点击放置后工具即失效 → 连续放置模式：ghost 保持激活，每次视口点击放一个；Esc/右键退出；整段合并单 undo | P1 | M | ⚠ 目录点击语义变化 | ⬜ |
| FZ-6 | workbench.js:800 + viewport.js:671-682 | 无拖拽画排 → 连续放置下按住左键沿方向每网格档放一个（cap 20），rebuildSuspend 批内合并 | P2 | L | ⚠ rebuildAll×N | ⬜ |
| FZ-7 | viewport.js:237,207 | ghost 无有效性语义 → AABB 相交（仅对 fixed 体）时 ghost 切 danger 色+落点框红；AABB 自 rebuild 缓存 | P2 | M | 不阻断只警示 | ⬜ |
| FZ-8 | workbench.js:607,669-677 | 吸附档位无快捷键 → G=cycleSnap()+toast+help 行 | P2 | S | 无 | ⬜ |
| FZ-9 | viewport.js:215 vs workbench.js:1905 | ghost 网格吸附硬编码 0.5m 与显示网格档脱钩 → 吸附步长读 gridStep | P1 | S | p24 复验 | ⬜ |
| FZ-10 | workbench.js:329 | 无吸取工具 → Alt+点击实体=以该 type+params 为放置默认，ghost 重建预览；Alt+空白取消 | P1 | M | overrides 键级合并现成 | ⬜ |
| FZ-11 | workbench.js:63-68 + viewport.js:724-729 | 无批量删除工具 → B 键推土机模式：拖框即删未锁定，框内即时红描边+「删 n 跳 m 锁定」角标，Esc 退出 | P2 | M | ⚠ 与框选互斥状态机 | ⬜ |
| FZ-12 | viewport.js:192-221 | ghost 悬空无落点参照 → 正下方细线十字+外接矩形（hairline 琥珀 0.5），随 _updateGhostFollow 更新 | P2 | S | 无新增 raycast | ⬜ |
| FZ-13 | workbench.js:746-752 | 右键轻点（位移<5px）=退出放置（OrbitControls 已吞 contextmenu vendor:502） | P2 | S | 与 FZ-35 统一 button 判定 | ⬜ |
| FZ-14 | workbench.js:251-267 | 传感器/观察点 ghost 落点与实际不符 → isSensor/isViewpoint 不启动跟随 ghost，toast 提示实际落点语义 | P2 | S | 无 | ⬜ |
| FZ-15 | workbench.js:806 | 绳/弹簧 hover 无预览 → 已选 2 实体时画连线（虚线池）+中点读数「A→B · 2.34m」 | P2 | S | 事件驱动开关 | ⬜ |
| FZ-16 | workbench.js:339-348 | 新实体放置后不易定位 → 0.6s BoxHelper 琥珀脉冲（复用 impacts 衰减） | P3 | S | 无 | ⬜ |
| FZ-17 | index.html:87-99 + workbench.js:779 | 放置激活期目录卡无工具态 → ghost 激活卡加 hot 类（琥珀边框） | P2 | S | renderCatalog 重建保持态 | ⬜ |
| FZ-18 | workbench.js:327-328 | per-type 放置参数持久化 localStorage，大纲「重置默认」入口 | P3 | S | 缺省回落 registry | ⬜ |
| FZ-19 | workbench.js:327-328 | n%3 槽位第 10 个与第 1 个重叠 → 仅当默认槽位 AABB 相交时顺延找空槽 | P3 | M | ⚠ p61 复跑 | ⬜ |
| FZ-20 | index.html:103-107 | 目录卡「+」角标绑定独立快速放置（stopPropagation 双语义） | P3 | S | 无 | ⬜ |
| FZ-21 | viewport.js:727 | ghost 激活期光标三态：copy/not-allowed（有效性）/默认 | P3 | S | 无 | ⬜ |
| FZ-22 | viewport.js:162-221 vs workbench.js:679-714 | ghost 与 gizmo 两套吸附语义分裂+初始不一致（snapMode='grid' 但 setSnap 未调用→gizmo 初始不吸附）→ 抽单一 snap 函数共用参数表；boot 按 snapMode 调一次 setSnap | P2 | M | ⚠ p24/p61 先固定口径 | ⬜ |

### 选择工艺
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| FZ-23 | viewport.js:671-682 | hover 零反馈（收编 FEEL-106）→ rAF 节流 ≤30Hz+无拖拽/ghost 时才 raycast：cursor:pointer+0.25 预览框；静止 200ms 停 | P2 | M | ⚠ 性能红线先落 | ⬜ |
| FZ-24 | workbench.js:1753-1760 | hover 无数据卡（文明6 单位卡）→ 180ms 悬停 DOM 小卡（名/类型/质量/半径/锁定，panel 底 hairline） | P2 | M | 与 FZ-23 共用节流 | ⬜ |
| FZ-25 | workbench.js:195-204 | 无同类型全选 → 视口双击=全选同 type 未锁定 | P2 | S | 双击抖动 P3 验证 | ⬜ |
| FZ-26 | viewport.js:742-748 | pick 永远 hits[0]，遮挡体点不到 → 同点（±6px）连击轮换候选+「2/4 名」角标 | P2 | M | 候选列表现成 | ⬜ |
| FZ-27 | viewport.js:747 | 点锁定体静默 → toast「已锁定——大纲行可解锁」（2s 去重） | P3 | S | 无 | ⬜ |
| FZ-28 | viewport.js:673-681 | 框选拖动无实时计数 → 橡皮框角标「n 个（+m 锁定跳过）」rAF 节流；>150 实体降 15Hz | P2 | S | 无 | ⬜ |
| FZ-29 | workbench.js:1753-1760 | 多选时 roSel 只显主选中 → 「n 个对象 · 主: 名 v=」 | P3 | S | 无 | ⬜ |
| FZ-30 | viewport.js（无） | 选中实体出屏无指示 → 屏幕边缘琥珀箭头（仅单选，搭脏渲染便车） | P3 | M | 复用投影逻辑 | ⬜ |
| FZ-31 | workbench.js:195-204 | 无反选 → Ctrl+I | P3 | S | 无 | ⬜ |
| FZ-32 | workbench.js:63-68 | 框选 shift=并集（收编 FEEL-108）→ _onUp 透传 shiftKey | P2 | S | 无 | ⬜ |
| FZ-33 | viewport.js:713-719 | 框选只测原点，大实体漏选（收编 FEEL-100）→ 投影包围盒 8 角+中心任一入框 | P1 | M | ⚠ p61 复跑 | ⬜ |
| FZ-34 | viewport.js:724-729 | 框选时不 detach gizmo（收编 FEEL-124）→ 进出配对 detach/恢复 | P2 | S | 无 | ⬜ |
| FZ-35 | viewport.js:659,687-704 | 右键平移松手误换选中（收编 FEEL-123）→ pointerdown/_onUp 开头 button!==0 早退 | P2 | S | 无 | ⬜ |
| FZ-36 | workbench.js:746-752 | Esc 级联补清空选择（收编 FEEL-136） | P3 | S | 无 | ⬜ |
| FZ-37 | workbench.js:733-739 | Ctrl+A 全选未锁定（收编 FEEL-137） | P3 | S | tag 守卫已拦 | ⬜ |
| FZ-38 | workbench.js（无 contextmenu） | 实体右键直角菜单：聚焦/复制/锁定/隐藏/删除（收编 FEEL-129）→ 全走 op* 通道；按位移阈值与平移区分 | P2 | M | ⚠ 手势冲突 | ⬜ |

### 相机工艺
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| FZ-39 | workbench.js:729-776 + viewport.js:82-97 | 视角书签：Shift+数字存 {pos,target}（localStorage），数字=flyToPose；空槽 toast 提示 | P1 | M | 键位矩阵（FB-72） | ⬜ |
| FZ-40 | index.html:355-361 | 书签槽位指示 chip「位 3/9」+hover 摘要 | P3 | S | 无 | ⬜ |
| FZ-41 | workbench.js:608 | Home 键=回全局视角 | P2 | S | 无 | ⬜ |
| FZ-42 | workbench.js:609-611 | 等距视角预设 iso:[1,1,1]（极角 0.955 可达）+顶栏第 4 按钮 | P2 | S | 无 | ⬜ |
| FZ-43 | viewport.js:68-79 + workbench.js:1998 | 跟随模式：检查器 checkbox+C 键，target lerp(0.12) 到实体+相机保持偏移；拖视角/F 聚焦/重置解除 | P1 | M | 与 _focusAnim 互斥 | ⬜ |
| FZ-44 | viewport.js:68-79,86-97 | 取景飞行改时间归一 easeInOutCubic（300-700ms 按距离），到达即止 | P2 | M | ⚠ 收敛断言复验 | ⬜ |
| FZ-45 | vendor OrbitControls.js:306 | zoomToCursor=true（vendored 实有，R2 勘误）+zoomSpeed 0.9 | P1 | S | ⚠ 金标视角变化 | ✅ R3-B2：zoomToCursor=true+zoomSpeed 0.9 |
| FZ-46 | workbench.js:1032-1043 | 大纲观察点 ⌖ 语义错（focusOn 标记体）→ viewpoint 改 flyToPose(pos,target) | P1 | S | 无 | ⬜ |
| FZ-47 | viewport.js:582-590 | controls 'start' 清焦点/飞行动画（收编 FEEL-101）+两动画互斥 | P1 | S | 无 | ✅ R3-B2：controls start 事件清取景/飞行动画 |
| FZ-48 | viewport.js:879-894 | 顶/前/侧/复位改 flyToPose 300ms（收编 FEEL-109）+Ctrl 瞬跳逃生口 | P2 | M | ⚠ 金标 Ctrl 路径 | ⬜ |
| FZ-49 | viewport.js:585 | zoomSpeed 0.9（与 FZ-45 同批） | P2 | S | 无 | ⬜ |
| FZ-50 | viewport.js:421-448 | 正交切换 top/bottom=dist·tan(fov/2)（收编 FEEL-105）+resize 单源 | P1 | S | ⚠ 断言复验 | ⬜ |
| FZ-51 | workbench.js:558-575 | 预置载入尾统一 focusScene()（收编 FEEL-133） | P2 | S | ⚠ 金标白名单 | ⬜ |

### gizmo 工艺
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| FZ-52 | viewport.js:653 | 拖拽中 DOM 数值气泡（(x,y,z) m+Δ / ° / ×k），mouseUp 消隐 | P1 | S | 纯 DOM 零 GPU | ⬜ |
| FZ-53 | workbench.js:72-77 | 吸附修正跳变无解释 → snapMarker 闪现 0.5s+气泡「⌗ 端点吸附」；<1mm 不显示 | P2 | S | 无 | ⬜ |
| FZ-54 | viewport.js（无） | 对齐参考线：拖动中与他实体 x/z<0.03m 画 hairline+分量吸附（Alt 临时禁用）；候选 ≤30 | P2 | L | ⚠ AABB 缓存+节流 | ⬜ |
| FZ-55 | workbench.js:1168-1170 | 拖拽中检查器 triRow 实时刷新（节流 0.1s，readOnly 防竞态） | P2 | S | 无 | ⬜ |
| FZ-56 | workbench.js:759-775 | 方向键微调尊重吸附档（snap on 时步长=网格档） | P3 | S | snap 默认 off | ⬜ |
| FZ-57 | workbench.js:746-752 | Esc 级联最前：gizmo.dragging 时 reset() 不触发提交（收编 FEEL-102） | P1 | S | 级联顺序 | ⬜ |
| FZ-58 | viewport.js:794-805 | 缩放拖拽实时钳均匀（收编 FEEL-104） | P1 | M | ⚠ 手感实测 | ⬜ |
| FZ-59 | workbench.js:69-81 | 多选组平移：主实体位移向量应用到其余（收编 FEEL-107），undo「成组移动」 | P2 | L | ⚠ 大改 | ⬜ |
| FZ-60 | workbench.js:79 | undo 标签按 gizmoMode 前缀（收编 FEEL-116） | P2 | S | 无 | ⬜ |
| FZ-61 | viewport.js:778-784 + workbench.js:207 | 锁定实体仍挂 gizmo（收编 FEEL-93，P0 行为 bug）→ attach 前判 locked；多选主锁定挂最近未锁定 | P0 | S | ⚠ p 系复验 | ✅ R3-B2：gizmo 只挂未锁定选中（锁定体保持高亮），多选主锁定时挂最近未锁定 |
| FZ-62 | viewport.js:819-823 | setSnap 补缩放档 setScaleSnap(0.05)（收编 FEEL-125） | P2 | S | 无 | ⬜ |
| FZ-63 | viewport.js（vendored:933 setSpace 存在） | L 键 local/world 切换+toast+help | P3 | S | 手感实测 | ⬜ |

### 大纲/目录
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| FZ-64 | index.html:372 + workbench.js:933-975 | 大纲过滤输入（名/类型前缀，组内命中则组显示） | P2 | S | 复用 PER-84 防抖 | ⬜ |
| FZ-65 | workbench.js:977-1045 | 大纲行右键菜单：聚焦/重命名/锁定/隐藏/删除/成组（与 FZ-38 同组件） | P2 | M | 无 OrbitControls 冲突 | ⬜ |
| FZ-66 | workbench.js:943-974 | 大纲显示排序（名/类型/创建序，纯视图不动文档序） | P3 | S | R1 FEEL-29 决策兼容 | ⬜ |
| FZ-67 | workbench.js:951-974 | 行拖入组头=加入组（opUpdateEntity 单步 undo）；拖到未分组=移出 | P2 | M | 改名期禁 drag | ⬜ |
| FZ-68 | workbench.js:951-974 | 组折叠（三角指示 stopPropagation，折叠态计数），localStorage 记忆 | P3 | S | 组头点击语义保留 | ⬜ |
| FZ-69 | workbench.js:977-1045 | 行 hover 联动视口弱高亮（0.15 透明独立单例，事件驱动） | P2 | S | 无 | ⬜ |
| FZ-70 | workbench.js:339-348 | 最近使用 cap 5→8+title「n 分钟前·共用 m 次」（结构 v2 迁移） | P3 | S | 兼容 | ⬜ |
| FZ-71 | workbench.js:1030 | 行 Ctrl/Shift=加选、Shift+点击=范围选（按显示序） | P2 | S | 与 FZ-66 注明联动 | ⬜ |
| FZ-72 | workbench.js:966-971 | 组头 Shift+点击=整组并入/移出选集 | P3 | S | 无 | ⬜ |
| FZ-73 | workbench.js:977-1045 | 隐藏实体行淡化+「隐」徽标；标题行「全部显示」一键（走 undo） | P1 | S | 无 | ⬜ |
| FZ-74 | workbench.js:212-229 | 选中行 scrollIntoView(nearest)（收编 FEEL-122） | P2 | S | 无 | ⬜ |
| FZ-75 | index.html:114 + workbench.js:983 | 行左缘 2px 类型色条（复用轨迹 PALETTE 语义）；锁定降饱和；实机验收不过即弃 | P3 | S | ⚠ 廉价感红线 | ⬜ |

## FB 反馈/通知流/时间控制/撤销/键盘（75 项）

### 通知流（文明6 右侧事件流）
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| FB-1 | workbench.js:31-38 + index.html:296 | #eventFeed 右下竖排：直角卡+左 2px 严重度竖线（line/琥珀/danger）+mono t= 前缀；同屏 ≤5 | P0 | M | 布局避让（FB-74） | ✅ R3-B3：#eventFeed 右下事件卡容器（直角卡+左 2px 严重度竖线+mono 时间前缀，同屏 ≤5） |
| FB-2 | runtime.js:645-647 + workbench.js:2130 | 碰撞事件卡「碰撞 A×B · t=1.234s · Δp 0.8%」 | P0 | S | 高频配 FB-12 去重 | ✅ R3-B3：碰撞事件卡「碰撞 A × B」+聚焦动作（实测 momentum 预置出卡） |
| FB-3 | workbench.js:2130 + viewport.js:60 | 事件卡点击=focusOn 两体包围盒中点；有录制帧按 FB-31 跳回放 | P1 | M | 实体已删降级 | ⬜ |
| FB-4 | runtime.js:290 | 管道脱轨完全静默 → 警告卡+「聚焦该球」（每球一次） | P0 | S | 无 | ✅ R3-B3：runtime 脱轨事件一次性上报 escapeEvents+警告卡+聚焦（管道场景数据源就绪） |
| FB-5 | runtime.js:462-610 | 实体坠出工作域警告卡+「停止运行」动作（天体 gravitating 豁免） | P1 | S | 不自动停 | ⬜ |
| FB-6 | workbench.js:1658-1677 | 能量环比漂移>5% 信息卡（关守恒条也可见） | P2 | S | 弹簧基准误报防 | ⬜ |
| FB-7 | runtime.js:686-694 | 光门通过瞬间成功卡「穿过光门 · t=X.XXXs」 | P1 | S | 无 | ⬜ |
| FB-8 | runtime.js:29,209 | jointFailures 可见化：错误卡逐条+计数徽标 | P1 | S | w 系断言同步 | ⬜ |
| FB-9 | workbench.js:467 + runtime.js:635 | 丢步警告卡（每 epoch 首次 dropped>0.1s，含降档建议） | P2 | S | 文案常量同源 | ⬜ |
| FB-10 | runtime.js:600-609 | 录满 30s 自动掐断信息卡 | P2 | S | 无 | ⬜ |
| FB-11 | workbench.js:439-445 | feed 绑 epoch：rebuild/reset 清空+分隔线+上轮摘要 | P1 | S | 无 | ✅ R3-B3：epoch 边界检测（rebuild 清空事件数组→计数器回退）自动清流 |
| FB-12 | runtime.js:641-649 | 同对 (a,b) 0.5s 窗口合并「碰撞 ×3」，hover 展开 | P1 | S | 无 | ✅ R3-B3：同对碰撞 0.5s 窗口聚合「碰撞 ×n」 |
| FB-13 | index.html:296 | 卡片 6s 驻留+hover 暂停（1px 进度 hairline） | P2 | S | 无 | ✅ R3-B3：卡片 6s 驻留（err 12s）+× 关闭+动作链接 |
| FB-14 | workbench.js:439-445 | 重置发运行摘要卡「本轮 12.4s · 碰撞 3 · 脱轨 0」 | P2 | S | 无 | ✅ R3-B3：epoch 摘要卡「上一轮：碰撞 N 次」 |
| FB-15 | workbench.js:31-38 | toast 堆叠队列 ≤3 同屏（超越 FEEL-117 单卡） | P1 | M | z-index 编排 | ⬜ |
| FB-16 | workbench.js:31-38 | 四级驻留 info1.8/success2.2/warn3.2/error4.5s+左竖线区分 | P1 | S | kind 默认不破坏 | ✅ R3-B3：toast 分级驻留 info1.8/success2.2/warn3.2/err4.5s+warn/err 描边（单槽 #toast 语义不变，测试兼容） |
| FB-17 | index.html:300 + workbench.js:407 | toast 可点动作链（撤销/停止/查看明细 ≤2 个文字链） | P1 | M | 指针域不挡视口 | ⬜ |
| FB-18 | workbench.js:31-38 | 同文案 2s 聚合「×2」+延长 1s | P2 | S | 无 | ⬜ |
| FB-19 | index.html:296 | 卡片右上 × 关闭；error 不自动消失 | P2 | S | 无 | ⬜ |
| FB-20 | index.html:300 | aria 分级：error=role alert，info=polite；feed 容器 off | P2 | S | 无 | ⬜ |
| FB-21 | workbench.js:22-30 | fail() 同步落持久错误卡（会话级沉淀，errbar 管当前屏） | P2 | S | 无 | ⬜ |

### 时间控制
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| FB-22 | index.html:479-484 + workbench.js:46 | SPEED_STEPS=[0.1,0.25,0.5,1,2,4] 单源自动生成 select | P1 | S | 4x 依赖 PAR-12 | ✅ R3-B2：SPEED_STEPS 单源生成 select（0.1..4x 六档） |
| FB-23 | workbench.js:618,729-753 | 1/2/3 键切 0.5x/1x/2x+toast+selSpeed 同步（文明6 风格） | P0 | S | 键位矩阵 FB-72 | ✅ R3-B2：1/2/3 键 0.5x/1x/2x+toast+select 同步 |
| FB-24 | workbench.js:618 | 悬停 selSpeed 滚轮循环档位（preventDefault） | P2 | S | select 非 INPUT 守卫补 | ⬜ |
| FB-25 | workbench.js:46,753 | Shift+Space=0.1x 慢动作互切（记忆原档）+modeChip 角标 | P1 | S | 无 | ✅ R3-B2：Shift+空格慢动作互切（记忆原倍率） |
| FB-26 | workbench.js:422-428 | 慢动作切入自动开速度矢量（退出不关） | P2 | S | w 系复验 | ⬜ |
| FB-27 | workbench.js:422-428,1460 | 定时停：roT 旁定时按钮+秒输入，simT≥目标暂停+事件卡；单步跨过即停 | P1 | M | 无 | ⬜ |
| FB-28 | index.html:494 | 定时待停倒计时 mono 显示 | P2 | S | 无 | ⬜ |
| FB-29 | index.html:492 + workbench.js:1958 | 回放条自绘 track：0.5s 主刻度+碰撞时刻琥珀竖标（与 UI-53 合并实施） | P1 | M | 载体合并防双改 | ⬜ |
| FB-30 | workbench.js:1985-1991 | 回放「帧 123/600 · t=3.07s」读数 | P1 | S | 无 | ⬜ |
| FB-31 | workbench.js:1948-1964 | 事件卡「回放此刻」：按 t 二分最近帧 seek t−0.5s 暂停；无录制灰显不渲染 | P1 | M | 无 | ⬜ |
| FB-32 | workbench.js:616 | btnStep 按住 400ms 后 10Hz 连发（「.」键同机制） | P2 | S | 无 | ⬜ |
| FB-33 | workbench.js:618 | 倍率变更 toast「即时生效，不重置」 | P2 | S | 无 | ✅ R3-B2：setSpeed 统一 toast「即时生效，不重置」 |
| FB-34 | index.html:494 | 双击 roT=快捷 3s 定时停（再点取消） | P2 | S | title 说明 | ⬜ |
| FB-35 | workbench.js:1751 | t≥60 显示 1:23.4 分秒格式 | P3 | S | 断言口径注明 | ⬜ |
| FB-36 | index.html:494 | 暂停态 roT 前缀 ‖+--dim | P3 | S | 无 | ⬜ |

### 撤销工艺
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| FB-37 | index.html:344 + scene-doc.js:90-128 | 撤销历史面板：直角列表点击跳转（链式 undo/redo+单 rebuild），redo 区灰显 | P1 | M | 复用 helpOverlay 遮罩 | ⬜ |
| FB-38 | workbench.js:759-775 | 面板内同 label 折叠「×12」（仅展示层） | P2 | S | 依赖 FEEL-115 | ⬜ |
| FB-39 | scene-doc.js:91 | 栈满提示「最早的 X 已被移出」+首次 toast | P3 | S | 无 | ⬜ |
| FB-40 | workbench.js:476-494 | **运行态 Ctrl+Z 静默 rebuildAll 重置仿真而 mode 仍 run**（与 FEEL-94 同族独立入口，P0）→ undo/redo 开头判 mode：先 toast+resetSim 再撤销 | P0 | S | ⚠ w 系复跑 | ✅ R3-B2：运行态撤销/重做先 resetSim+toast（不再静默重置仿真而 mode 仍 run） |
| FB-41 | workbench.js:476-481 | undo/redo title「剩余 n 步/可重做 m 步」 | P2 | S | 无 | ⬜ |
| FB-42 | workbench.js:476-494 | 撤销/重做长按 500ms 连发（150ms 间隔） | P2 | S | 无 | ⬜ |
| FB-43 | scene-doc.js:104 | redo 被清空且 ≥3 条时一次性提示 | P3 | S | 防烦 | ⬜ |
| FB-44 | workbench.js:97-98 | autosave 损坏静默落默认预置 → errbar+事件卡+「下载原始数据」 | P1 | S | 无 | ⬜ |
| FB-45 | workbench.js:121-123 | autosave 写失败静默 → 顶栏常驻 danger chip 自愈消失 | P1 | S | 状态位去重 | ⬜ |
| FB-46 | workbench.js:632 | 场景名改是否进 undo（决策：进，label 改名） | P3 | S | 低频 | ⬜ |
| FB-47 | workbench.js:482-488 | undo toast 追加「下一步: X · 剩 n」 | P2 | S | 一行内 | ⬜ |
| FB-48 | scene-doc.js:98-105 | 面板 hint「无实际变化的操作不占历史」 | P3 | S | 无 | ⬜ |

### 微反馈
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| FB-49 | index.html:163-178,269-290 | btnrow/rtab/ctabs/veil 按钮统一 :active 压下 1px+亮度阶 | P1 | S | 无 | ⬜ |
| FB-50 | workbench.js:1396-1447 | 数值提交 600ms 旧→新 diff 闪示（旧值删除线 9px） | P2 | S | 连调节流 | ⬜ |
| FB-51 | workbench.js:1031,1359 | 删除按钮 hover → 目标实体 BoxHelper 临时 danger 红 300ms 预览（不改选中态） | P1 | M | ⚠ 多选整组预览 | ⬜ |
| FB-52 | workbench.js:69-81 | gizmo 提交 BoxHelper 0.9→1 脉冲 250ms | P2 | S | 无 | ⬜ |
| FB-53 | workbench.js:1761-1786 | liveGrid 跳变闪示（Δ>阈值 cell 背景 400ms） | P2 | S | Δ 非绝对值 | ⬜ |
| FB-54 | workbench.js:1817-1823 | 空曲线画布「等待运行数据…」占位 | P2 | S | 无 | ⬜ |
| FB-56 | workbench.js:453-460 | disabled 按钮 data-reason：title=禁用原因（统一常量表，收编 UI-72） | P2 | S | 同步维护 | ⬜ |
| FB-57 | workbench.js:212-229 | 选中行 300ms 琥珀进场渐隐（与滚动定位互补） | P3 | S | 无 | ⬜ |
| FB-58 | index.html:163-169 | 危险按钮 hover 补 danger 边框（169 行只给了 color） | P2 | S | 无 | ⬜ |
| FB-59 | workbench.js:21,56-88 | veil 步序「1/4」+耗时 ms（真步进非动画） | P2 | S | 步数同步 | ⬜ |
| FB-60 | workbench.js:424 | 空场景运行 toast 叠加「载入示例场景」动作链 | P2 | S | w1 A17 复验 | ⬜ |
| FB-61 | workbench.js:434-438 | 单步后 roT 琥珀闪 200ms | P3 | S | 无 | ⬜ |
| FB-62 | workbench.js:1948-1957 | 回放启动 1px 琥珀 hairline 全视口框一帧 | P3 | S | 装饰红线：一帧即走 | ⬜ |

### 键盘全覆盖
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| FB-63 | index.html:559-576 | 帮助表补 Ctrl+Y/Ctrl+V 两行；check.py 校验 onKey 分支与 help 行数 diff | P1 | S | 无 | ✅ R3-B2：帮助表补 Shift+空格/1·2·3/Ctrl+Y/Ctrl+V 行 |
| FB-64 | workbench.js:755 × FEEL-134 | **键位冲突实锤**：E 已绑 gizmo 旋转，FEEL-134 拟用 Q/E 转 ghost → ghost 旋转改 [ ]（已采纳入 FZ-2） | P1 | S | 已定案 | ✅ R3-B2：ghost 旋转键定案 [ ]（记入 KEYS.md，FZ-2 落地时执行） |
| FB-65 | workbench.js:753 × FEEL-135 | 回放全局 ←/→ 与 replayBar 原生方向键双触发 → e.target!==replayBar 守卫或 blur | P1 | S | 同批实施 | ⬜ |
| FB-66 | workbench.js:753 | Space 双激活审计：按钮点击后 blur 或 onKey 对 BUTTON 目标早退（实测定案） | P1 | S | 浏览器时序 | ✅ R3-B2：全局按钮点击后 blur（防空格双激活） |
| FB-67 | workbench.js:218-228,961-1043 | 大纲行/行内件键盘可达（role=button+tabindex+行内 span 改 button 外观不变） | P1 | M | Tab 序：行内 tabindex=-1 方向键导航 | ⬜ |
| FB-68 | workbench.js:2191-2197 | 右栏页签快捷键（[ ] 或 Tab 组内导航，归 FB-72 定案） | P2 | S | 键位矩阵 | ⬜ |
| FB-69 | workbench.js:729-731 | onKey 补 e.isComposing 早退（IME 组合期让路） | P2 | S | 无 | ✅ R3-B2：onKey isComposing 早退 |
| FB-70 | workbench.js:741-745 | helpOverlay 关闭后焦点归还 activeElement | P2 | S | UI-92 半边 | ⬜ |
| FB-71 | index.html:334-499 | 三区 role=region+aria-label；Tab 序审计记录 | P2 | S | 无 | ⬜ |
| FB-72 | workbench.js:729-776 | docs/KEYS.md 快捷键冲突矩阵（已用/拟用/浏览器保留），每批新增键过表 | P1 | S | 纪律项 | ✅ R3-B2：docs/KEYS.md 冲突矩阵落盘（已用/拟用/浏览器保留） |
| FB-73 | workbench.js:758 | X=删除选中（Delete 保留并列） | P2 | S | 入矩阵 | ⬜ |
| FB-74 | index.html:234-301 | 浮层布局契约：curvePanel 激活 feed 右移；z 序 55/50/45/44/18；CSS 变量 --feed-right | P1 | S | 无 | ✅ R3-B3：body.curves-on 时事件流右移 356px 给曲线面板让位 |
| FB-75 | runtime.js:37-38,600 | 常驻 10s 环形帧缓冲（事件即固化快照段；>60 体降 5s） | P2 | L | ⚠ 内存双轨期兼容 | ⬜ |

## AX 解析准确度/一次性通过率/鲁棒性（75 项）

### 题型覆盖
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| AX-1 | parse-schema.js:338 | conveyorLayout：kinematic 皮带体+物块（依赖 MDL-25 引擎先行）；KIND_MAP 补传送带/皮带 | P1 | M | 依赖 MDL-25 | ⬜ |
| AX-2 | serve.py:39-42 | prompt 补传送带 kind 规则 | P1 | S | realspot 复验 | ⬜ |
| AX-3 | parse-schema.js:347 | kinematic 不可用期传送带参考系等价降级+assumptions 注明 | P2 | M | 摩擦口径注明 | ⬜ |
| AX-4 | parse-schema.js:89-97 | rope 保留弹簧字段（实测原样进 plan）→ 剥离+uncertain「绳不可伸长」 | P1 | S | 无 | ⬜ |
| AX-5 | serve.py + parse-schema.js:96 | 弹簧 damping 缺省 0（教学理想振子）+prompt 注明 | P1 | S | 与 explainSpring 口径对齐 | ⬜ |
| AX-6 | parse-schema.js:437 | 连接球缺省 1.6m 等距与绳长无关 → attaches 链感知排布（间距=rope.length） | P2 | M | ⚠ p 系摆位断言 | ⬜ |
| AX-7 | parse-schema.js:91 | from/to 实体名 Number('球B')|0=0 误判自引用（node 实测）→ 名匹配回退再丢 | P1 | S | 无 | ⬜ |
| AX-8 | parse-schema.js:338 | conicalLayout（顶锚+球+rope+切向 v，参数复用 MDL-18 预置口径） | P1 | M | assumptions 半径微摆 | ⬜ |
| AX-9 | parse-schema.js:338 | vertCircleLayout（锚+rope+最低点水平初速；v<临界注明将斜抛） | P1 | M | CCD 已兜 | ⬜ |
| AX-10 | parse-schema.js:17-23 | KIND_MAP 补圆周族词簇+「球+绳 attach+圆周词」自动置 kind | P1 | S | 误检前置条件 | ⬜ |
| AX-11 | serve.py:39-42 | prompt 补圆锥摆/竖直圆周表达通道 | P1 | S | 无 | ⬜ |
| AX-12 | parse-schema.js:453 | 多 box 全落同位穿插爆开（node 实测板顶 0.12 块底 0.02）→ 堆叠布局（后块 y=前块顶+sy/2） | P1 | M | ⚠ p 系摆位断言 | ⬜ |
| AX-13 | serve.py:44-54 | few-shot 补板块紧凑示例 | P1 | S | token +120 | ⬜ |
| AX-14 | parse-schema.js:19 | 单摆误 KIND_MAP 到 hinge（刚杆 T=2π√(2L/3g) 错）→ pendulumLayout 绳系（T=2π√(L/g)）+prompt「单摆（绳）：kind=pendulum」 | P1 | M | 无 | ⬜ |
| AX-15 | serve.py:16-54 | momentum2d z 错开靠 fixture 无兜底 → prompt 注明 z 瞄准距+缺省客户端 z=0.12 兜底 | P2 | S | AG-85 口径修正 | ⬜ |
| AX-16 | serve.py:16-54 | 电磁题规则：匀强电场按 a=qE/m 输出 gravity 类比；磁场 uncertain 诚实降级 | P2 | M | 等效条件注明 | ⬜ |
| AX-17 | parse-schema.js:347 | 多过程（先滑后抛）：ramp+平台 box 接坡末几何联动+ground | P2 | M | 坡顶反算 | ⬜ |
| AX-18 | serve.py + parse-schema.js:77 | v-t 图像题 kind=graph：数值化进 observations，空实体豁免，只评审不建场 | P2 | M | 图读错低置信联动 | ⬜ |
| AX-19 | parse-schema.js:511 | 椭圆题被强制圆化（径向速度丢弃）→ 椭圆词只做 xz 平面化保留径向+uncertain | P2 | S | astro 精度注明 | ⬜ |
| AX-20 | parse-schema.js:348 | 自由落体走通用布局建出悬浮+无地面（node 实测）→ 落体分支（球+高 position+ground，needT=√(2h/g)×1.5） | P2 | S | 无 | ⬜ |
| AX-21 | parse-schema.js:441 | 初速指向坡上时 uncertain「请确认方向」 | P3 | S | 无 | ⬜ |
| AX-22 | serve.py | 恒功率/变力题 uncertain 注明无牵引力通道 | P2 | S | 无 | ⬜ |

### prompt 工程
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| AX-23 | serve.py:18-37 | schema 每字段尾内联一句语义（confidence 分档/anchorPoints 边界） | P1 | M | token 增量复验 | ⬜ |
| AX-24 | serve.py:44-45 | few-shot 再补传送带/圆锥摆/板块三例（配 AX-8/12） | P2 | M | ⚠ +3 调用预算 | ⬜ |
| AX-25 | serve.py:44-54 | 3 条短反例（radius 写轨道/未提重力填 10/markdown 围栏） | P1 | S | 无 | ⬜ |
| AX-26 | serve.py:16-54 | 关键词预路由按题型附规则子集（~15 行/题型），无命中回落全量 | P2 | L | ⚠ 路由误判 fallback | ⬜ |
| AX-27 | serve.py:50-53 | 长度纪律（questionType≤12 字等）+客户端截断 uncertain 提示 | P2 | S | 无 | ⬜ |
| AX-28 | serve.py:43 | 术语→字段集中表（劲度系数→stiffness/μ→friction/e→restitution/ω→angvel） | P1 | S | 无 | ⬜ |
| AX-29 | parse-schema.js:69 | GIVEN_ALIAS 归一层（mu/μ→friction、v0/speed→velocity、e→restitution、omega→angvel、k→stiffness；不识别仍透明丢弃） | P1 | S | e 歧义保守白名单 | ⬜ |
| AX-30 | parse-schema.js:31-36 | 量纲启发建议层（mass<0.01 疑 g/length>12 疑 cm）只进 uncertain 不自动改 | P2 | M | 误建议需确认 | ⬜ |
| AX-31 | parse-schema.js:106 | attaches slice(0,4) 静默截断 → errors 提示+上限提 6 | P2 | S | 建场端同步守卫 | ⬜ |
| AX-32 | serve.py:16 | PARSE_PROMPT 版本标识进 assumptions 首项（realspot 归因） | P3 | S | 槽位占用 | ⬜ |
| AX-34 | serve.py:114-116 | 分题型 temperature 矩阵（结构化强题型 0.1） | P2 | S | ⚠ 对照 2×7 调用 | ⬜ |
| AX-35 | parse-schema.js:22 | KIND_MAP 天体值 'celestial' 与 prompt 枚举 'astro' 不一致 → 统一 'astro' | P2 | S | 纯对齐无行为变化 | ⬜ |
| AX-36 | parse-schema.js:139 | 高频 unknowns 字段生成 prompt 补规则建议（依赖 AX-62 统计） | P3 | M | 基建先行 | ⬜ |

### 鲁棒性
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| AX-37 | parse-schema.js:51-56 | 标量 velocity 静默丢（node 实测）→ 方向词推断向量；无方向 [v,0,0]+uncertain | P1 | S | 可评审配合 AX-64 | ⬜ |
| AX-38 | parse-schema.js:45 | entities 单对象整题 fail → lenient 包装数组 | P2 | S | 无 | ⬜ |
| AX-39 | parse-schema.js:50 | given 写实体顶层的风格漂移 → 键白名单回退收集 | P2 | S | 杂键误收防 | ⬜ |
| AX-40 | parse-schema.js:108 | raw.joints 复数漂移 → 取首个+uncertain | P2 | S | 无 | ⬜ |
| AX-41 | parse-schema.js:118-121 | joint axis NaN 直达建场（node 实测 ['z','0','0']）→ isFinite 校验回退默认 | P1 | S | 无 | ⬜ |
| AX-42 | parse-schema.js:126 | questionType 缺省时 kind 反查中文标签兜底 | P3 | S | 无 | ⬜ |
| AX-43 | workbench.js:2453 | 低置信自动追问式二次解析（uncertain 摘要拼上下文重发，不问用户）+「二次解析」徽标 | P1 | M | ⚠ +1 调用/低置信题 | ⬜ |
| AX-44 | workbench.js:2448 | 二次解析两版字段级 diff（不直接覆盖） | P2 | M | 状态面清理 | ⬜ |
| AX-45 | serve.py:151-166 | 图片通道接受可选 text 备注（content 数组 image+text 并列） | P1 | M | parseBusy 复用 | ⬜ |
| AX-46 | workbench.js:2363 | 小选区<600px 高质量放大×2 再压 JPEG | P2 | S | 伪影抽验 | ⬜ |
| AX-47 | workbench.js:2348 | 暗图可选对比度拉伸（默认关，首败自动开+重试一次） | P2 | M | 失真风险默认关 | ⬜ |
| AX-48 | workbench.js:2486 | 多图并送（content 数组原生支持）+上传队列 | P3 | M | ⚠ 请求体×2 | ⬜ |
| AX-49 | serve.py:67-107 | 候选全败时全角→半角归一重试（仅结构性字符） | P2 | S | 无 | ⬜ |
| AX-50 | parse-schema.js:45-76 | 重复实体（同名同型）去重合并（conflict 取 confidence 高+uncertain） | P2 | S | 无 | ⬜ |
| AX-51 | parse-schema.js:77 | entities>12 客户端截断+errors（收编 AG-91）+attaches 索引级联清 | P2 | S | 无 | ⬜ |
| AX-52 | workbench.js:2497 | 选区解析失败 toast 建议「清除选区重试全图」一键 | P3 | S | 无 | ⬜ |

### 评审体验
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| AX-53 | workbench.js:2598 | typeof object 把数组跳过：pos 变更 diff 不可见 → 向量 diff 摘要 `pos [0.6,0.07]→[0.8,1.2]` | P1 | S | 无 | ⬜ |
| AX-54 | workbench.js:2606 | diffs 分色 span+「n 处变化」badge（现 danger/accent 色） | P2 | S | 廉价感红线 | ⬜ |
| AX-55 | workbench.js:2756 | 越界编辑红框+hint「合法 0.05~6，已回退」+最邻合法值一键 | P2 | S | 无 | ⬜ |
| AX-56 | workbench.js:2625 | attach 行显示实体名+绳长/k（替「实体 0→1」） | P2 | M | 无 | ⬜ |
| AX-57 | workbench.js:2622 | attach 行可改 type 与 from/to（下拉），改后重算预览 | P2 | M | 无 | ⬜ |
| AX-58 | serve.py:25 | evidence 字段：数值给题面短引（≤40 字），实体行展开显示 | P1 | M | ⚠ token +15% | ⬜ |
| AX-59 | workbench.js:2732 | 实体置信三档色阶+「按置信度排序」+「只看低置信」过滤 | P2 | S | 克制色阶 | ⬜ |
| AX-60 | workbench.js:2636 | uncertain 命中实体默认不勾+「仅接受置信≥80%」一键 | P2 | S | ⚠ w4 拒绝路径 | ⬜ |
| AX-61 | workbench.js:2807 | 修正记忆库：同题型低置信字段灰色占位预填可拒绝（一键清） | P2 | M | 记忆键过粗防 | ⬜ |
| AX-62 | serve.py:57 + workbench.js:2912 | top-3 修正规则自动生成 prompt 附录（tools/server/prompt-addons.txt gitignored）注入 | P2 | M | ⚠ 附录变更 realspot 复验 | ⬜ |
| AX-63 | workbench.js:2912 | 「导出修正记录」JSON 下载 | P3 | S | 无 | ⬜ |
| AX-64 | workbench.js:2161-2189 | PEDIT 按「布局消费即必须可修」全补（velocity/position/angvel 全类型只读+模长、ground.length/width、pulley.radius/position；超越 AG-102 两行） | P1 | M | pgrid 密度 | ⬜ |
| AX-65 | serve.py:18 | answers 数组通道：解释后「题面答案 vs 实测」对照行（题给才写规则） | P2 | M | 编造防 | ⬜ |

### 测试基建
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| AX-66 | tools/fixtures/ | 每新题型 1 金标（conveyor/conical/vertcircle/blocks/pendulum-rope/chain-2ropes/graph，+7 份+png） | P1 | M | 布局实测后冻结 | ⬜ |
| AX-67 | tools/fixtures/ | 7 份 adversarial fixture（键改名/标量速度/单对象/joints 数组/NaN/名称引用/重复实体）单测锚 | P1 | M | 无 | ⬜ |
| AX-68 | serve.py:200 | MECH_MOCK_PARSE=1 确定性假模型（轮播 fixtures+漂移注入），零 key 零出网默认关 | P1 | M | 红线：不读 key 不出网 | ⬜ |
| AX-69 | tools/check.py | PARSE_PROMPT 哈希落 prompt.hash，变更 WARN「请跑 realspot 复验」（不自动调 API） | P1 | S | WARN 不 FAIL | ⬜ |
| AX-70 | realspot.mjs:85 | JSONL 历史（date/type/ver/pass/conf/dt）+通过率趋势表 | P2 | S | 年度轮转 | ⬜ |
| AX-71 | realspot.mjs:14 | EXPECT 补 conveyor/circular/板块用例 | P2 | M | ⚠ +5 调用 | ⬜ |
| AX-72 | test/unit/parse.test.mjs | 属性 fuzz：金标随机变异 100 case 断言不 throw+二态（seed 固定） | P2 | M | 可复现 | ⬜ |
| AX-73 | test/unit/parse.test.mjs | 10 金标 planToOverrides 结构断言（实体数/类型序/关键 pos） | P2 | M | 锚维护成本 | ⬜ |
| AX-74 | tools/check.py | fixtures 完整性校验（_fixture/questionType/entities） | P2 | S | 文档注明 | ⬜ |
| AX-75 | test/unit/parse.test.mjs | AX-37/38/39/40/41/50/7/29 每修复各补 1-2 断言（+10-14 项） | P1 | S | 无 | ⬜ |

## AB 解释器/实验教学/数据呈现（75 项）

**调研实测**：21 个新预置仅 3 个得到正确解释，6 个被误派发且输出误导性「通过」（vertCircle/galileoDrop/rangeAngles 误判二维斜碰、bulletBlock 入抛体、newtonCradle/ballChain 理论值取文档初速算出零、binaryStar 周期理论差 29%）。

### 分派修复与新分支
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| AB-13 | explain.js:372-379 | momentum 理论初速取文档初值：静止释放对撞理论算出 0/0 → u1/u2 改取 rep.pBefore/m（碰前真实值） | P0 | M | ⚔ p 系理论值断言复验 | ✅ R3-B1：runtime 碰撞报告补 preVels 分体碰前速度，一维理论改用真实碰前值（单测锚：文档初速 0 摆落后撞不再得 0/0） |
| AB-14 | explain.js:442-445 | momentum2D 报告不验 b2 参与、不排斥地面碰撞 → 加双方 id∈{b1,b2} 且均动态球 | P0 | S | 修后三场景转投新分支 | ✅ R3-B1：报告双变过滤（两球都显著变化），单球撞地不再误判斜碰（单测锚） |
| AB-18 | explain.js:260-264 | 双星理论 G·M_center 差 29%（node 复现）→ T=2π√(a³/G(m1+m2))（单星场景自然兼容） | P0 | S | celestial 断言不变 | ✅ R3-B1：两体开普勒 T=2π√(a³/G(m1+m2))，双星 29% 误差消除（单测锚更新） |
| AB-11 | explain.js:19-21 | 抛体分支条件过宽：bulletBlock 误入 → 补「无其它动态实体」；子弹木块走完全非弹性 v′=mv/(m+M)+ΔKE=½μv² | P0 | S | box 参与场景全改道 | ✅ R3-B1：抛体条件收窄（仅单动态体）+ 新 inelastic 分支（共速 v′=mv/(m+M)+ΔKE）（单测锚） |
| AB-1 | explain.js:8-26 | 分派无 rope link 检测：摆类全 unsupported → hasRope 子分派（单摆/锥摆/竖直圆周按初速/几何判） | P0 | M | ⚔ 分派优先级全链回归 | ⬜ |
| AB-5 | explain.js:178 | spring 峰检测只看 pos[0]：竖直振子周期 null（node 复现 peaks:0）→ 三轴方差主轴或弹簧轴向投影 | P0 | S | 水平路径不变 | ✅ R3-B1：spring 峰检测取三轴方差主轴，竖直振子不再 0 峰（单测锚） |
| AB-8 | presets.js galileoDrop | 伽利略同落分支：落地时刻差 Δt（阈值=球半径+地面顶面，修 0.16 硬编码同源）+水平位移对照；现误判 momentum2d pass | P0 | S | 依赖 AB-14 | ✅ R3-B1：新 galileo 分支（t=√(2h/g) 与 vx 无关+水平位移对照）（单测锚）；抛体落地阈值改球半径+地面顶面（顺修 AG-23 同源硬编码） |
| AB-2 | presets.js pendulum | 单摆分支 T=2π√(L/g)：角序列过中点间隔（与 hinge 抽公共工具），θ0=0.3 大角修正 0.6% 注记 | P1 | M | 抽函数防两份漂移 | ⬜ |
| AB-3 | presets.js conical | 锥摆分支：tanθ=v²/(gρ)、T=2πρ/v、张力 mg/cosθ；ρ 取中位数，方位角 ±π 跳变测周期 | P1 | M | 容差标定 | ⬜ |
| AB-4 | presets.js vertCircle | 竖直圆周分支：临界 √(5gL)；过顶/抛离判定（球-锚距<0.97L 首次时刻），A/B 对照 | P1 | M | 阈值标定 | ⬜ |
| AB-6 | explain.js:171 | 振子限 sphere：coupled 双 box unsupported → 取 spring 动态侧任意刚体；双质量理论 2π√(m/(2k)) | P1 | M | 质心漂移去趋势 | ⬜ |
| AB-7 | presets.js springGun | 弹簧枪三段能量：½kΔx²→出口动能→平抛落点三级对照；分派加「球非 attach 端」旁路 | P1 | M | 分离时刻容差 | ⬜ |
| AB-9 | presets.js rangeAngles | 射程角分支：逐道 R=v²sin2θ/g+45° 极值+30°/60° 对称结论 | P1 | M | 逐球落地检测 | ⬜ |
| AB-10 | presets.js bounceCompare | 反弹对照分支：hₙ=e²ⁿh₀+e 反演 √(h₁/h₀)；现误报「未捕捉斜碰」 | P1 | M | 忽略滚动段 | ⬜ |
| AB-12 | presets.js blockOnBlock | 板块分支：共速 v′+Q=μm块g·d相对 与 ΔKE 对照 | P1 | M | 积分口径与 μ 平均一致 | ⬜ |
| AB-15 | presets.js collLab | 双泳道并列解释（z 聚类，速度交换 vs 共速+50% KE 损失两表） | P1 | M | 聚类容差 0.1 | ⬜ |
| AB-16 | presets.js rollRace | 滚动竞速：到达差+v²=2gh/(1+I/mr²)+转动动能占比 2/7 vs 1/3（与 AG-106 共公式模块） | P1 | M | 无 | ⬜ |
| AB-17 | presets.js frictionLock | 自锁解释：tanθ−μ 符号+蠕变速率诚实标注 | P2 | M | 阈值标定 | ⬜ |
| AB-19 | presets.js threeBody | 三星：ω=√(GΣm/a³)+边长保持率+混沌声明 | P2 | M | n 体泛化 | ⬜ |
| AB-20 | presets.js weightless + runtime.js:673 | 失重曲线：sensorReadings 环形缓冲（cap 600）供 explain 消费，三段结论（飞行 0/静止 mg/冲击峰） | P1 | M | runtime+explain 联动 | ⬜ |
| AB-21 | presets.js newtonCradle | 牛顿摆：理想结论+逐球残余速度表+Σmv 全链+求解器局限声明 | P2 | M | 依赖 AB-13 | ⬜ |
| AB-22 | explain.js:29 | unsupported 文案按实体组合分型列出（帮教师理解能力边界） | P2 | S | 无 | ⬜ |
| AB-23 | explain.js:8 | explainRun 7 参尾随 null → 收拢 ctx 对象 | P2 | S | 调用点 2 处 | ⬜ |
| AB-24 | workbench.js:2986 | 预置伪 plan 化（observation 写 doc.meta+伪 plan 合成，统一 AG-110 一套）→ 31 预置全部可解释 | P1 | M | fixture 徽标保留 | ⬜ |
| AB-25 | workbench.js:2997 | needT 窗口表扩新题型（摆类 5.5s/锥摆 4s/反弹 3s） | P1 | S | UI-47 联动 | ⬜ |
| AB-26 | workbench.js:3015 | 解释终止条件按 kind 派生（落地/周期数/反弹次数） | P2 | M | 配套各分支 | ⬜ |

### 理论对照
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| AB-27 | workbench.js:1817-1870 | 曲线画理论虚线层（抛体 v(t)/SHM 包络/斜面 v=√(2gΔh)），公式从 explain 抽 theory.js 共享 | P1 | M | 单一来源 | ⬜ |
| AB-28 | workbench.js:1849 | 能量模式 E0 参考横线（光滑场景） | P2 | S | 无 | ⬜ |
| AB-29 | workbench.js:1824 | 速率/高度双轴或归一开关（混轴失真） | P2 | M | 刻度标注 | ⬜ |
| AB-30 | explain.js+workbench.js | formula 最小可读化（Unicode 组合，禁 KaTeX 依赖体积红线） | P2 | M | 跨平台字形实测 | ⬜ |
| AB-31 | explain.js 各分支 | 误差分解 {numerical: 能量漂移, model: 剩余} 两句归因（incline driftPct 雏形泛化） | P1 | M | 口径统一 | ⬜ |
| AB-32 | workbench.js:1810 | 曲线历史叠加模式（上次 25% 透明保留，cap 1200） | P1 | M | 绘制成本可控 | ⬜ |
| AB-33 | workbench.js:1681 | 守恒条碰撞历史迷你步进（逐报告切换） | P2 | M | 小屏适配 | ⬜ |
| AB-34 | workbench.js:1560 | 偏心率精确式 e=√(1+2EL²/μ(GM)²)（替 rmax/rmin 近似+trail 等长依赖） | P2 | M | 单测锚 | ⬜ |
| AB-35 | explain.js 各处 | 容差透明：输出带 tolerance+结果行显示判据（与 PAR-9 同批） | P2 | S | 无 | ⬜ |
| AB-36 | explain.js:196 | 阻尼弹簧理论 T'=T/√(1−ζ²)+包络（先标定 Rapier damping 语义） | P2 | M | 语义标定 | ⬜ |
| AB-37 | explain.js:319 | 斜面能量账分列平动/转动/损耗三行（PHY-1 曲线口径对齐解释层） | P1 | S | 漂移数值变化 | ⬜ |
| AB-38 | workbench.js:1658 | ebFill 理论损失刻度 hairline（(1−e²)%） | P2 | S | 无 | ⬜ |
| AB-39 | explain.js:34-75 | projectileTheory 纯函数抽取+单测（三分支共用） | P1 | S | 无 | ⬜ |

### 实验教学
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| AB-40 | 新 engine/sweep.js | 参数扫描实验（变质量/角度 N 次对比曲线）三件套，先单参数 MVP | P1 | L | 大项 | ⬜ |
| AB-41 | workbench.js:3463 | runHeadless(doc,needT,collectors) 通用同步步进 API（selftest 已验证可行），sweep/假设检验共用 | P1 | M | 与 selftest 复用 | ⬜ |
| AB-42 | 曲线面板 | 扫描散点+拟合线第三 tab「实验」（R vs θ 抛物线标 45°） | P2 | M | 视觉红线 | ⬜ |
| AB-43 | sweep 面板 | 控制变量守卫：多参数时警示单参数建议 | P2 | S | 无 | ⬜ |
| AB-44 | index.html:461 | 假设检验：运行前输预测，运行后「猜测/理论/实测」三列+方向评语，存 doc.meta | P1 | M | 无 | ⬜ |
| AB-45 | explain.js 各分支 | observable 定义 {key,unit,label} 统一（AB-44/68 前置） | P1 | S | 形状统一 | ⬜ |
| AB-46 | 新 doc.meta.demo | 课堂演示脚本编排回放 [{t,action:viewpoint/run/pause/overlay/caption}] | P2 | L | 先 JSON 后 GUI | ⬜ |
| AB-47 | 字幕条 | caption 触发底部居中 hairline 字幕条（1.5s 淡出） | P2 | S | 无彩色底 | ⬜ |
| AB-48 | workbench.js 各 set* | 演示录制辅助：视角/叠加层切换事件 append demo 骨架 | P3 | M | 钩子面散 | ⬜ |
| AB-49 | workbench.js:589 | 回放 A-B 段循环（shift+拖设点+循环开关） | P2 | M | 手势冲突排查 | ⬜ |
| AB-50 | viewport.js:760 | 对比冻结叠影：运行前位姿 wireframe 叠加看位移（与 MAT-86 统一方案） | P2 | M | 无 | ⬜ |
| AB-51 | sweep | 同参两次末速差<1e-9 单测锚（确定性） | P1 | S | rebuild 语义复用 | ⬜ |
| AB-52 | explain hints | 常见错误映射（全高 H vs 球心 Δh/忘转动动能/e²ⁿ 写 eⁿ），3 题型试点 | P2 | M | 文案量 | ⬜ |
| AB-53 | workbench.js:495 | 实验报告导出：解释+曲线 CSV+截图组装 markdown | P2 | M | 同步截 | ⬜ |
| AB-54 | workbench.js:1460 | 演示脚本叠加层编排 action（复用 set* 现成函数） | P2 | S | 无 | ⬜ |

### 数据呈现
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| AB-56 | workbench.js:1817 + index.html:548 | 曲线游标读数（hover 竖 hairline+交点值） | P1 | M | 96px 布局 | ⬜ |
| AB-57 | workbench.js:1834 | 曲线横向缩放（滚轮 0.5~8x+双击复位） | P2 | M | 插值防谎报 | ⬜ |
| AB-58 | workbench.js:3430 | 曲线全量 CSV 导出（BOM 头防 Excel 乱码） | P1 | S | 无 | ⬜ |
| AB-59 | 曲线面板 | 数据表视图（折叠表+粘性头+200 行虚拟滚动） | P2 | M | DOM 虚拟化 | ⬜ |
| AB-60 | workbench.js:1658 | 守恒条 60×14 sparkline（近 40 采样） | P2 | S | 无新色 | ⬜ |
| AB-61 | workbench.js:1824 | y 轴 3 档刻度+单位（与 UI-29 合并） | P1 | S | 无 | ⬜ |
| AB-62 | index.html:548 | curveCanvas dpr 适配（尺寸×dpr+ctx.scale） | P1 | S | 金标 canvas 尺寸同步 | ⬜ |
| AB-63 | workbench.js:1872 | 图例点击 toggle 曲线显隐 | P2 | S | legendN 缓存键 | ⬜ |
| AB-64 | workbench.js:1792 | 暂停段曲线断点竖线标注 | P3 | S | 无 | ⬜ |
| AB-65 | workbench.js:1126 | 自由测距+三点量角器（测量模式，PHY-28 收编统一） | P2 | M | 手势模式切换 | ⬜ |
| AB-66 | workbench.js:1332 | liveGrid sparkline（40×10px 共享 canvas） | P2 | M | 9 格成本可控 | ⬜ |
| AB-67 | runtime.js:494 | 碰撞记录折叠表（t/对/Δp/ΔKE 逐行复盘） | P2 | M | 字段已齐 | ⬜ |
| AB-68 | workbench.js:2244 | 复制结果 markdown 表格（公式/容差/假设/时间戳/场景名，与 UI-99 同批） | P2 | S | 无 | ⬜ |
| AB-69 | workbench.js:1759 | roSel 单位间距与有效位统一 | P3 | S | 无 | ⬜ |
| AB-70 | workbench.js:2141 | 三套采样口径说明 tooltip | P3 | S | 无 | ⬜ |

### 文案质量
| # | 位置 | 问题→改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| AB-71 | explain.js 全文 | fmtSig 有效数字规范（周期/速度 4 位、误差 2 位）+单测 | P1 | S | w7 文本锚同步 | ⬜ |
| AB-72 | explain summary | 简/详双版切换（简版=结论+偏差，默认简版投影友好） | P1 | M | 双文案维护 | ⬜ |
| AB-73 | explain 各分支 | errorHints：偏差超容差时 2-3 条常见错误对照（琥珀列表） | P1 | M | 与 AB-52 共库 | ⬜ |
| AB-74 | explain pass 字段 | verdict 三态 pass/limited/fail（limited 自动带入 assumptions 局限） | P1 | S | w7「未通过」字样同步 | ⬜ |
| AB-75 | explain 各 summary | 结论前置重排（首句=判定+核心对照） | P2 | S | 无 | ⬜ |
| AB-76 | explain+presets | fmtQty 单位排版统一「数值+空格+单位」 | P2 | S | 无 | ⬜ |
| AB-77 | explain.js:56 等 | 误差显示规范（<0.05% 显示「<0.05%」、>50% 一位） | P2 | S | 无 | ⬜ |
| AB-78 | workbench.js:1271 vs explain | 「弹性系数」vs「恢复系数」统一 label+tooltip 平均合成说明 | P2 | S | w 系旧 label 同步 | ⬜ |

---

## 实施批次记录（R3）

（每批一 commit：完整回归全绿 + check.py 过 + 台账打勾；真实 API 调用继续遵守全轮 ≤40 预算）

### R3-B3 事件流 MVP（FB-1/2/4/11/12/13/14/16/74，9 项）
文明6 式右下事件卡：碰撞卡（聚焦动作）+脱轨警告卡（runtime escapeEvents 一次性上报）+同对 0.5s 聚合+epoch 摘要+toast 分级驻留；出生触地噪声按 t<0.15 过滤；curves-on 让位契约。视觉验收过（panel 底/2px 竖线/hairline/无廉价感）。冒烟：momentum 出卡「碰撞 球A × 球B」、reset 出「上一轮：碰撞 3 次」；36 套回归 ALL GREEN。

### R3-B2 守卫+时间控制+键盘（FZ-61/45/47、FB-40/22/23/25/33/63/64/66/69/72，13 项）
锁定体 gizmo 守卫（P0）；运行态撤销先重置（P0）；文明6 风格 1/2/3 倍率键+Shift+空格慢动作+SPEED_STEPS 单源六档（0.1~4x）；zoomToCursor（R2 勘误兑现）+zoomSpeed 0.9；用户接管相机中断取景动画；按钮 blur 防空格双激活；IME 组合期让路；帮助表补 4 行；docs/KEYS.md 冲突矩阵（FB-64 ghost 键定案 [ ]）。

### R3-B1 解释器分派修复（AB-13/14/18/11/5/8，6 个教学错误级 P0）
runtime 碰撞报告补 preVels（分体碰前速度，_prevVel 步前快照）；一维/二维动量理论改用真实碰前值（静止释放后碰撞不再拿文档初速算出 0/0）；momentum2D 报告双变过滤（单球撞地不再误判「斜碰通过」）；两体开普勒 T=2π√(a³/G(m1+m2))（双星 29% 误差消除）；抛体条件收窄（仅单动态体）+ 新 inelastic 分支（子弹木块共速+ΔKE）；新 galileo 分支（t=√(2h/g) 与 vx 无关）；spring 峰检测取三轴方差主轴（竖直振子不再 0 峰）；抛体落地阈值改球半径+地面顶面。
实施教训：galileo 判定首版太松（两球+一水平初速+地面）劫持了标准一维动量场景（p5/p26 红）——补「双球离地>0.3m」分界后全绿。+5 单测（13/13），explain.test 天体锚更新为总质量口径。
