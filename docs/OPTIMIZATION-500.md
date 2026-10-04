# MECHANICA 优化台账（Round 36 · 500+ 项）

产生方式：逐文件通读 `src/`（workbench 3184 行、engine/ 八模块、materials、track-curve）、`index.html`、`tools/serve.py`、`tools/check.py`、`tools/ui-test/` 后逐模块盘点，全部条目落到具体文件/函数；禁止「优化性能」式空话。
图例：P0=本轮必做 / P1=高价值 / P2=择机 / P3=远期或需决策；量 S<1h / M=半天 / L=多天；风险列 ⚠=可能破坏回归需重点验证。
状态：⬜未做 / ✅已实施（附结果）。

## 一、性能（PER-1 ~ PER-82）

| # | 位置 | 问题 → 改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| PER-1 | viewport.js render()/workbench tick | 编辑态静止时仍每帧 render+refreshHighlight：加脏标记（controls change/叠加层/物理推进置脏，连续 2 帧干净则跳过 renderer.render），空闲 CPU 大降 | P0 | M | ⚠ 控件阻尼收尾帧不能漏 | ✅ B2：脏标记跳渲染（hasFocus 守卫防 headless rAF 饿死） |
| PER-2 | viewport.js updateTrails | 每 tick 全量重写 1800×N 点缓冲：记录每线已写点数只 append 增量，drawRange 覆盖 | P0 | S | ⚠ rebuild 后计数复位 | ✅ B2：trails 增量写点，封顶后退回全量 |
| PER-3 | runtime.js stepOnce prevVel | 每步 new Map+数组（120Hz×8 步 GC 大头）：模块级复用容器 clear() 重填 | P0 | S | | ✅ B2：_prevVel 模块级复用原地写 |
| PER-4 | runtime.js _idOfCollider | O(实体) 线扫 per 碰撞事件：_createEntity 时建 handle→id Map，rebuild 清空 | P0 | S | | ✅ B2：_colOwner handle→id Map |
| PER-5 | workbench applyAgentPlanInner | N 实体 N 次 rebuildAll（含 Rapier world 重建）：批内挂起 rebuild，末尾一次重建（同 historyBatch 语义） | P0 | M | ⚠ atwood __PULLEY__ 回填路径 | ⬜ |
| PER-6 | viewport.js _snapCandidate | ghost 跟随每 pointermove 对全场 Box3.setFromObject：rebuild 时缓存 AABB（viewport.invalidateSnapCache()），移动只查缓存 | P0 | M | ⚠ 实体拖动需失效缓存 | ⬜ |
| PER-7 | workbench.js tick 矢量/受力块 | 每帧 new 多组临时数组/对象（items/gravity/normal/friction/jItems）：模块级数组 length=0 复用 | P1 | S | ⚠ 引用逃逸排查 | ⬜ |
| PER-8 | runtime.js _gravAccel | 每子步分配二维数组（4×120Hz）：Float64Array 扁平 scratch 复用 | P1 | S | | ⬜ |
| PER-9 | runtime.js trails push/shift | 1800 封顶后每采样 shift O(n)：环形缓冲或超限 64 个一批 splice | P1 | S | ⚠ drawRange 语义 | ⬜ |
| PER-10 | runtime.js telemetry | 每次调用 6+ 数组分配且每帧每实体调用：热路径（矢量层）改为只读填充复用对象，MECH.telemetry 保留现语义 | P2 | M | ⚠ 调用方持有引用 | ⬜ |
| PER-11 | runtime.js _createEntity | 传感器/标记/绳/铰链视觉件 castShadow=true 徒增阴影 pass：buildCollider()==null 的实体默认关 castShadow | P0 | S | | ✅ B2：无碰撞体实体免阴影 pass |
| PER-12 | viewport.js init | renderer 无 powerPreference:'high-performance'：补上（独显直连本机收益明确） | P1 | S | | ⬜ |
| PER-13 | viewport.js spawnImpact | 每次碰撞 new RingGeometry+Material：环池复用（8 个循环） | P2 | S | | ⬜ |
| PER-14 | viewport.js setHighlights | 每次选中变更 new/dispose BoxHelper：按实体缓存 BoxHelper 复用 update() | P2 | M | | ⬜ |
| PER-15 | workbench.js autosave | 每次 commit 同步写 localStorage 全 JSON：300ms 防抖（页面隐藏前 flush） | P1 | S | ⚠ beforeunload flush | ⬜ |
| PER-16 | workbench.js noteRecentUse | 每次放置全目录 DOM 重建（20+ 卡片）：局部更新「最近使用」区或 diff | P2 | M | | ⬜ |
| PER-17 | thumbs.js | 目录 20+ 缩略图 boot 时同步逐个 WebGL 渲染：分帧（requestIdleCallback 队列）渐进填充 | P1 | S | | ⬜ |
| PER-18 | thumbs.js | 第二个 WebGLRenderer 常驻：渲染完成后可释放（或保留但低优先） | P3 | S | | ⬜ |
| PER-19 | registry.js track | buildTroughGeometry(620,48)≈3 万顶点每次 rebuild 重建：registry 层按 (type+params json) 哈希缓存几何，clear() 不 dispose 缓存 | P1 | M | ⚠ 参数变更失配 | ⬜ |
| PER-20 | workbench.js commitChange | 每次 commit serializeDoc 整文档：小场景可忽略；仅当 entities>80 时改增量（阈值项，先不做） | P3 | L | | ⬜ |
| PER-21 | viewport.js resize | 正交相机切窗后 frustum 不更新（bug 兼性能）：ortho 分支按 aspect 重建 left/right/top/bottom | P0 | S | | ✅ B2：resize 修正交 frustum（toggleProjection 单入口） |
| PER-22 | viewport.js pointermove | 全局 pointermove 恒挂（ghost/框选都空时也进函数）：rAF 节流 + 早退条件前置 | P2 | S | | ⬜ |
| PER-23 | runtime.js rebuild | 每次 doc 变更全量重建所有实体 mesh：叠加 PER-19 几何缓存后 mesh 层按 params+transform 哈希跳过未变实体（仅重建刚体，不重建网格） | P2 | L | ⚠ 高风险大改，先几何缓存 | ⬜ |
| PER-24 | runtime.js stepOnce postVels | 含碰撞步构造整对象图：仅保留白名单键+复用数组 | P2 | S | | ⬜ |
| PER-25 | workbench.js updateReadouts | 每 0.15s 多次 getElementById：启动时缓存 DOM 引用表 | P2 | S | | ⬜ |
| PER-26 | workbench.js updateScaleReadout | 每 0.15s 无条件拼字符串写 DOM：值未变跳过 | P2 | S | | ⬜ |
| PER-27 | runtime.js CCD | 所有动态体恒开 CCD：仅速度阈值>2m/s 或用户勾选时开启（重场景收益） | P2 | S | ⚠ 高速穿隧回归 | ⬜ |
| PER-28 | runtime.js world | numSolverIterations=8 固定：场景级质量档（教学默认 8，>60 实体自动降 4 并 toast） | P3 | M | ⚠ 精度变化 | ⬜ |
| PER-29 | serve.py | SimpleHTTPRequestHandler 每静态请求 stderr log（GBK 控制台噪音+IO）：覆写 log_message 静默静态、仅记 API | P1 | S | | ⬜ |
| PER-30 | index.html | 15 个模块逐请求无打包：本地 dev 可接受；生产形态再议（bundling 决策） | P3 | M | | ⬜ |
| PER-31 | viewport.js 箭头池 | 各箭头池只增不减（实体删除后隐藏不回收）：rebuild 时收缩至需求量 | P2 | S | | ⬜ |
| PER-32 | workbench.js tick jointViz | 每帧 position.toArray() 分配：仅 selectedIds 变化或运行态节流到 0.15s 更新 | P2 | S | | ⬜ |
| PER-33 | materials.js | 纹理 anisotropy 固定 8：取 min(8, renderer.capabilities.getMaxAnisotropy()) 传入 | P2 | S | | ⬜ |
| PER-34 | runtime.js recording | 录制 cap 2400 点数组一次性结构：无问题；低优先 | P3 | S | | ⬜ |
| PER-35 | workbench.js renderCatalog | 收藏/最近切换重建整列表：单卡片原地更新（含 fav 文案/颜色） | P2 | M | | ⬜ |
| PER-36 | runtime.js contactNormals | wantContactNormals 时 _bindDocs.entities.find 在 120Hz 回调内：预建 collider→entity 索引 | P1 | S | | ⬜ |
| PER-37 | workbench.js sampleCurves | 每 0.15s 全实体 telemetry 分配：与 PER-7 同批复用 | P2 | S | | ⬜ |
| PER-38 | viewport.js fog | 天体大场景（r>16）本体被雾吃掉：fog far 随场景包围盒自适应（检测 gravitating×maxR 调 2.5×R） | P1 | S | | ⬜ |
| PER-39 | workbench.js energyTotals 调用 | 每采样遍历 binds 两遍（弹簧二遍）：单遍合并循环 | P2 | S | | ⬜ |
| PER-40 | legacy-main.js | classic 页与主程序独立渲染循环：保留（历史页冻结）；仅在 README 说明 | P3 | S | | ⬜ |
| PER-41 | viewport.js tickFocus/tickPose | 每帧 lerp 检查：收敛后已置 null 早退 ✓ 无问题；不动 | P3 | S | | ⬜ |
| PER-42 | runtime.js clear | mesh traverse dispose geometry 但 Group 子件材质（spoke/flag 内联材质）泄漏：dispose 时排除共享材质、回收内联材质 | P1 | S | ⚠ 共享材质误删 | ⬜ |
| PER-43 | workbench.js renderParseResult | 每次解析全 DOM 重建：事件驱动可接受；不动 | P3 | S | | ⬜ |
| PER-44 | viewport.js ghost showGhost | 每次 hover new MeshStandardMaterial+几何：材质单例缓存，几何随 PER-19 缓存 | P2 | S | | ⬜ |
| PER-45 | serve.py ThreadingHTTPServer | 每请求一线程：dev 可接受；daemon_threads=True 补上防 Ctrl+C 挂死（并入工程项） | P2 | S | | ⬜ |
| PER-46 | workbench tick impacts | tickImpacts 每帧遍历 + scale.set：数量小 ✓；与 PER-13 环池合并处理 | P3 | S | | ⬜ |
| PER-47 | runtime applyFrame 回放 | 每帧 states 循环 set：无分配 ✓ 不动 | P3 | S | | ⬜ |
| PER-48 | registry.js wedgePoints | 每次 build new Float32Array(6 顶点)：微小；随 PER-19 缓存 | P3 | S | | ⬜ |
| PER-49 | workbench drawCurves | 能量模式 ke.map(v=>v+pe[i]) 每帧新数组：trace 内联求和 | P2 | S | | ⬜ |
| PER-50 | viewport updateVelocityArrows | setDirection 内部 new Vector3：ArrowHelper API 限制；批量时先 normalize 复用外部向量传入 | P2 | S | | ⬜ |
| PER-51 | 大场景守护 | entities>150 时 toast 警告+建议关阴影/轨迹（防呆而非真优化） | P2 | S | | ⬜ |
| PER-52 | runtime stepOnce accels Map | 每步写 Map 分配数组：与 PER-3 同批（复用 Map+数组） | P1 | S | | ✅ B2：accels/contactForces 原地写 |
| PER-53 | workbench tick 法线可视化块 | 每 ramp 每帧 new Vector3×3：模块级 scratch | P2 | S | | ⬜ |
| PER-54 | workbench tick 张力块 | telemetry+accels 每 rope 每帧：节流 0.15s（箭头平滑无感） | P2 | S | | ⬜ |
| PER-55 | viewport _updateGhostFollow | getBoundingClientRect 每 move 两次：进 rAF 时缓存一次 | P2 | S | | ⬜ |
| PER-56 | runtime _syncSensors | 每步遍历全部 binds 找 sensor：rebuild 时预收集 sensor 列表 | P1 | S | | ⬜ |
| PER-57 | runtime _syncLinks | 每 mesh position/quaternion copy：必要；ruler 路径 new Vector3×2 每帧：scratch 复用 | P2 | S | | ⬜ |
| PER-58 | History undo JSON.parse | 撤销整文档 parse：小场景 ✓ 不动 | P3 | S | | ⬜ |
| PER-59 | workbench updateConsbar astroInfo | 每次 rel/rs 新数组（0.15s 一次）：可接受；>3 天体再优化 | P3 | S | | ⬜ |
| PER-60 | viewport setGridScale | 档位切换 new GridHelper：低频 ✓ 不动 | P3 | S | | ⬜ |
| PER-61 | serve.py json.dumps 无压缩 | 响应体小 ✓ 不动 | P3 | S | | ⬜ |
| PER-62 | workbench renderOutline nT 计算 | 每行 doc.entities.filter×2（O(n²) 渲染大纲）：预建连接计数 Map 一次 | P1 | S | ⚠ n 小但顺手 | ⬜ |
| PER-63 | viewport _idsInScreenRect | 框选 O(n) 投影 ✓ 合理；不动 | P3 | S | | ⬜ |
| PER-64 | runtime world.free | rebuild 释放旧 world ✓；确认 eventQueue 一并释放（wasm 引用） | P2 | S | | ⬜ |
| PER-65 | workbench tick 回放 applyFrame | 每帧整帧 set ✓；拖动时 setRange 节流可选 | P3 | S | | ⬜ |
| PER-66 | index.html CSS | 无性能问题；:hover transition ✓ | P3 | S | | ⬜ |
| PER-67 | workbench opAddComponent 摆位 | n%3 网格摆位与相机无关（用户找半天）：spawn 在 controls.target 附近偏移 | P1 | S | ⚠ 回归断言摆位 | ⬜ |
| PER-68 | runtime _constrainToPipe | 最近线段窗口 ±8/+40 硬编码：跨环时窗口边界抖动风险；按弧长缓存自适应窗口 | P2 | M | ⚠ p8 经典轨 | ⬜ |
| PER-69 | explain/telemetry 频率 | runAndExplain 期间叠加层照跑：解释运行时暂停矢量/受力更新（减负+防干扰） | P2 | S | | ⬜ |
| PER-70 | viewport render 内 controls.update | 阻尼系数 0.07 需持续 update：脏标记方案需含 controls 'end' 后 1s 缓冲（并入 PER-1 设计） | P0 | M | ⚠ | ✅ B2：controls.update 前置+阻尼 change 置脏 |
| PER-71 | workbench roSel 字符串 | 每 0.15s 拼接写 DOM：值未变跳过（与 PER-26 同法） | P2 | S | | ⬜ |
| PER-72 | localStorage 同步读 | loadAutosave boot 一次 ✓ 不动 | P3 | S | | ⬜ |
| PER-73 | runtime frames 记录 | 1200 帧上限数组 ✓；录制中 sampleCurves 照跑：录制时曲线暂停采样可选 | P3 | S | | ⬜ |
| PER-74 | viewport 材质共享 | runtime._createEntity 共享 M 材质 ✓ 正确；无项 | P3 | S | | ⬜ |
| PER-75 | workbench renderInspector | 每次重建整面板：事件驱动 ✓；仅节流 selectEntity 连续点击 | P3 | S | | ⬜ |
| PER-76 | parse 结果渲染 | 一次性 ✓ | P3 | S | | ⬜ |
| PER-77 | window blur 提交语义 | change on blur ✓（已知坑文档化） | P3 | S | | ⬜ |
| PER-78 | devicesPixelRatio | min(dpr,2) ✓；4K 截图测试稳定 | P3 | S | | ⬜ |
| PER-79 | Rapier 初始化 | init() 一次 ✓ | P3 | S | | ⬜ |
| PER-80 | import 链 | workbench→12 模块顶层 import ✓ 冷启动 ~1s 可接受 | P3 | S | | ⬜ |
| PER-81 | 曲线 canvas 320×96 | 未按 dpr 缩放（hidpi 发虚）：canvas 尺寸×dpr、ctx.scale（并入 UI 项） | P2 | S | | ⬜ |
| PER-82 | tick 时钟 | clock.getDelta cap 0.05 ✓ 良好实践；无项 | P3 | S | | ⬜ |

## 二、UI 视觉（UI-1 ~ UI-88）

| # | 位置 | 问题 → 改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| UI-1 | index.html .comp-item | border-radius 4px 违反「直角 hairline 2px」语言（thumb 3px 同）：统一 2px | P1 | S | | ⬜ |
| UI-2 | index.html 全局 | 无 :focus-visible 键盘焦点环：加 accent 色 1px 焦点样式（不动默认 outline 场景） | P1 | S | | ⬜ |
| UI-3 | index.html #dropZone | 仅点击上传，无拖拽/无粘贴：补 dragover 高亮+drop 载入、Ctrl+V 粘贴截图（教师传题高频路径） | P0 | M | | ⬜ |
| UI-4 | index.html #btnFixtureParse | fixture 按钮只载入 incline 一种，实际有 10 份 fixture：改成下拉选择（无 Key 用户可看全部题型链路） | P1 | S | | ⬜ |
| UI-5 | index.html #toast | 无类型语义（成功/警告同色）：toast(msg, kind) 警告用 danger 描边 | P2 | S | | ⬜ |
| UI-6 | index.html #errbar | 无关闭按钮：补 × | P2 | S | | ⬜ |
| UI-7 | index.html #sceneName | 130px 定宽长名截断无 tooltip：title 同步值+自适应宽度 | P2 | S | | ⬜ |
| UI-8 | index.html .ol-row .nm | 长名无 ellipsis：CSS text-overflow | P1 | S | | ⬜ |
| UI-9 | index.html #simbar | <1100px 按钮溢出换行错乱：media query 折叠次要按钮（矢量/受力/分解并入「叠加层」组） | P1 | M | ⚠ p 系列按钮选择器 | ⬜ |
| UI-10 | index.html #left/#right | 面板定宽不可调：加 4px 拖拽条（拖动改 CSS 变量，consbar/curvePanel 偏移同源变量） | P2 | M | | ⬜ |
| UI-11 | index.html #consbar | 4 列网格窄屏溢出：auto-fit minmax 折行 | P2 | S | | ⬜ |
| UI-12 | index.html #veil | 加载无进度感：3 步 setLoad 已有文案；补细进度条（真步进非假动画） | P2 | S | | ⬜ |
| UI-13 | index.html #veil 失败态 | 加载失败无重试按钮：fail() 加「重试」reload | P1 | S | | ⬜ |
| UI-14 | index.html 图标系统 | 纯文字按钮一致性 ✓（生死线：不上 emoji）；播放/暂停可用 CSS 三角/双竖条 glyph 增强辨识（需实机截图验证不廉价） | P3 | M | ⚠ 廉价感红线 | ⬜ |
| UI-15 | index.html btnRec | 录制态仅文字变色：加 6px 琥珀呼吸圆点（CSS animation，克制） | P2 | S | | ⬜ |
| UI-16 | workbench setAgentStage | 解析中无 spinner：badge 加 CSS 转圈（1 个元素，不引入图标库） | P1 | S | | ⬜ |
| UI-17 | workbench parse | 解析进行中无取消：AbortController 挂 btnParse 变「取消」 | P1 | M | | ⬜ |
| UI-18 | workbench #agentTextReq | 无 Cmd/Ctrl+Enter 快捷解析：textarea keydown | P1 | S | | ⬜ |
| UI-19 | workbench #catalogSearch | 无清空按钮、无结果计数：补 × 与 「n 项」 | P2 | S | | ⬜ |
| UI-20 | workbench renderCatalog | 分类不可折叠：cat-head 点击折叠（localStorage 记忆） | P2 | M | | ⬜ |
| UI-21 | workbench #outline 空态 | 「场景为空」无引导：补 2 个快捷链接（载入斜面/空场景） | P2 | S | | ⬜ |
| UI-22 | workbench undo/redo | 无操作反馈：undo/redo 后 toast 显示 history label | P1 | S | | ⬜ |
| UI-23 | workbench opRemoveEntity | 删除无反馈：toast「已删除 X — Ctrl+Z 可撤销」 | P1 | S | | ⬜ |
| UI-24 | workbench btnMode* | 运行态点移动/旋转/缩放静默无效：运行态 disable 三按钮+title 说明 | P1 | S | | ⬜ |
| UI-25 | workbench 矢量/受力图例 | 箭头颜色语义只在 title：曲线面板同款 clegend 加「图例」浮层（矢量琥珀/重力红/接触绿/N 淡绿/f 橙/加速度青） | P2 | M | | ⬜ |
| UI-26 | viewport updateTrails | 轨迹颜色按遍历序分配，rebuild 后同实体变色：按 id 哈希稳定配色 | P1 | S | | ⬜ |
| UI-27 | workbench updateCurveLegend | 多实体图例溢出无折行：flex-wrap+最多 6 项+「+n」 | P2 | S | | ⬜ |
| UI-28 | index.html #curveCanvas | 固定 320×96 不随 dpr（发虚）且不可调：dpr 缩放+拖拽改宽 | P2 | M | | ⬜ |
| UI-29 | workbench drawCurves | 无 y 轴最大值读数：右上角 vmax 文本（mono 9px） | P2 | S | | ⬜ |
| UI-30 | index.html .frow label | 58px 定宽中文四字截断（「劲度系数」挤）：62px+letter-spacing 0 | P1 | S | ⚠ 全面板微移 | ⬜ |
| UI-31 | index.html .errmsg | margin-left 66px 硬编码：跟随 label 宽度变量 | P2 | S | | ⬜ |
| UI-32 | workbench numRow | 错误提示 1.6s 硬消失无过渡：CSS opacity 过渡 | P3 | S | | ⬜ |
| UI-33 | workbench 材质 select | 纯文字选项：option 前加色点（material.color）不可行（option 限制）；改 select 旁 swatch 点随选择更新 | P2 | S | | ⬜ |
| UI-34 | workbench renderCatalogEnvMats | 材质卡纯色块：用 thumbs 离屏渲一颗小球实材质缩略图（真实感生死线） | P1 | M | | ⬜ |
| UI-35 | workbench 重力卡 | 大数字 9.81 文本卡 ✓ 仪器感；补 m/s² 单位小字 | P2 | S | | ⬜ |
| UI-36 | index.html #scaleReadout | 与 consbar 窄屏重叠：consbar 激活时 scaleReadout 右移或降透明 | P2 | S | | ⬜ |
| UI-37 | workbench #roSel | 底栏选中读数长名撑爆：max-width ellipsis | P2 | S | | ⬜ |
| UI-38 | index.html #topbar | brand letter-spacing .34em 末字符后空隙：text-indent 补偿已有 ✓；无项 | P3 | S | | ⬜ |
| UI-39 | index.html a11y | 无 aria-label/role 布局：重点补 dropZone role=button、rtab aria-selected、canvas aria-hidden | P1 | M | | ⬜ |
| UI-40 | workbench setParseStatus | 状态区无 aria-live：补 role=status（解析状态自动播报） | P2 | S | | ⬜ |
| UI-41 | index.html 对比度 | --faint #565b62 于 #0b0c0e ≈2.4:1 低于 WCAG AA：faint 仅装饰可接受；hint 正文改 --dim | P2 | S | ⚠ 全局色微调 | ⬜ |
| UI-42 | workbench 拍照预览 | 无镜像预览：video transform scaleX(-1)（拍摄自然性，捕获不镜像） | P2 | S | | ⬜ |
| UI-43 | workbench imgPrev | 无旋转按钮（手机横拍常见）：↺ 按钮旋转 90°（canvas 重绘） | P1 | S | | ⬜ |
| UI-44 | workbench 裁剪框 | 只能重画不能调边：四角手柄拖拽调整（M 量，P2） | P2 | M | | ⬜ |
| UI-45 | workbench explainGrp | 无复制按钮：summary+数据表 一键复制纯文本（教师备课） | P1 | S | | ⬜ |
| UI-46 | workbench explain 数值 | toFixed 位数不一（2/3 混用）：统一 3 位小数规范 | P2 | S | | ⬜ |
| UI-47 | workbench runAndExplain | 11s 天体解释无进度：badge 百分比（simT/needT） | P1 | S | | ⬜ |
| UI-48 | workbench applyAgentPlan | 建场后强制跳检查器页签：留在 Agent 页签+新按钮「查看场景」跳转（避免丢失操作明细） | P1 | S | ⚠ w2 流程断言 tab 切换 | ⬜ |
| UI-49 | workbench 建场后 | 不自动取景：建场完成 viewport.focus 场景包围盒 | P1 | S | | ⬜ |
| UI-50 | workbench changePreview | 无全选/全不选：顶部两个小链接 | P2 | S | | ⬜ |
| UI-51 | workbench changePreview | 行点击不高亮对应实体：点击行 selectEntity（新建项建场后才能选，仅更新项可联动） | P3 | M | | ⬜ |
| UI-52 | workbench 解析实体行 | 实体卡片无类型图标色条：左 2px 类型色条（球蓝/坡琥珀/…复用轨迹 palette） | P3 | S | ⚠ 廉价感 | ⬜ |
| UI-53 | index.html #replayBar | 原生 range 观感突兀：自定义 track/thumb（2px 线+方形 thumb，直角语言） | P2 | M | | ⬜ |
| UI-54 | workbench stopReplay | 回放结束静默回编辑态：toast 提示+末帧保留 0.5s | P2 | S | | ⬜ |
| UI-55 | workbench toggleFrameRec | 30s 录制上限无倒计时：btnRec 文案变 「录制 23s」 | P2 | S | | ⬜ |
| UI-56 | workbench 快捷键 | 无帮助浮层：? 键弹快捷键速查（半透明面板，Esc 关） | P1 | S | | ⬜ |
| UI-57 | index.html title | 不随场景名变：document.title = 名称·MECHANICA | P2 | S | | ⬜ |
| UI-58 | 无 favicon | 标签页默认图标：SVG favicon（M 字母 hairline 风格，data URI） | P2 | S | | ⬜ |
| UI-59 | workbench 切预置 | selPreset 归空后无当前预置指示：modeChip 旁 chip 显示来源（预置名/Agent/手工） | P3 | S | | ⬜ |
| UI-60 | workbench 实体计数 | roN 含传感器/绳：细分 「实体 5 · 约束 2」 | P2 | S | | ⬜ |
| UI-61 | workbench 丢步提示 | runtime.dropped 从未展示：>0.1s 时 modeChip 警示色+title（性能透明） | P1 | S | | ⬜ |
| UI-62 | workbench 读数千分位 | 大数无分组：toLocaleString 用于质量/能量读数 | P3 | S | | ⬜ |
| UI-63 | workbench autosave | 无保存指示：右上 2s 「已自动保存」微提示（低频闪烁，克制） | P3 | S | | ⬜ |
| UI-64 | workbench beforeunload | 无未保存守卫：autosave 已兜底；不加（决策记录） | P3 | S | | ⬜ |
| UI-65 | workbench 打开文件 | 无最近文件：P3 不做（autosave 已有连续性） | P3 | S | | ⬜ |
| UI-66 | index.html .tb-group | 分组语义良好 ✓；无项 | P3 | S | | ⬜ |
| UI-67 | workbench 组头 | ol-group 内联 cssText：迁 CSS 类（一致性） | P2 | S | | ⬜ |
| UI-68 | workbench 大纲按钮 | ⌖/锁/删 span 内联样式：同 UI-67 迁类 | P2 | S | | ⬜ |
| UI-69 | index.html #rubber | 内联 style：迁 CSS | P2 | S | | ⬜ |
| UI-70 | workbench 行内改名 input | 无 maxlength：24 上限与 agent 一致 | P2 | S | | ⬜ |
| UI-71 | workbench selSpeed | 无标签 a11y：aria-label=时间倍率 | P2 | S | | ⬜ |
| UI-72 | workbench btnDecompose | 禁用态无原因提示：disabled 时 title=「先开启受力」 | P2 | S | | ⬜ |
| UI-73 | workbench triRow | 三输入无 x/y/z 微标：label 后缀 (x)(y)(z) 9px | P2 | S | | ⬜ |
| UI-74 | workbench liveGrid | 「最近碰撞: 无」表达 ✓；无项 | P3 | S | | ⬜ |
| UI-75 | workbench 检查器滚动 | rebuild 后 scrollTop 丢失：rebuildAll 保存/恢复 #right.scrollTop | P1 | S | | ⬜ |
| UI-76 | workbench 观察点 | 无视角预览：飞回按钮旁静态文字记录 pos（mono 9px）；缩略图渲染留 P3 | P2 | S | | ⬜ |
| UI-77 | workbench 传感器空态 | 未运行时读数区「等待运行」✓；补「运行后此处实时更新」首用提示一次性 toast | P3 | S | | ⬜ |
| UI-78 | index.html .pe-row | 解析实体卡 hover 无反馈：hover 边框微亮 | P3 | S | | ⬜ |
| UI-79 | workbench PEDIT 球摩擦 | pairFriction 展示逻辑 ✓；无项 | P3 | S | | ⬜ |
| UI-80 | workbench renderParseResult 警告 | warnings 红 hint ✓；多条时无分隔：join '; ' 已有 ✓ | P3 | S | | ⬜ |
| UI-81 | workbench cropHint | 文案 ✓；按钮下划线虚线风格 ✓ | P3 | S | | ⬜ |
| UI-82 | index.html .chip | pause/run 色 ✓；无项 | P3 | S | | ⬜ |
| UI-83 | workbench 空场景运行 | 无实体运行无提示：toast「空场景无可演化实体」 | P1 | S | ⚠ w1 空场景断言 | ⬜ |
| UI-84 | workbench 空态 inspEmpty | 引导文案 ✓ 无项 | P3 | S | | ⬜ |
| UI-85 | workbench agentOps | 明细 ✓；成功/失败色 ✓ | P3 | S | | ⬜ |
| UI-86 | index.html 按钮 active | translateY(1px) ✓ 手感一致 | P3 | S | | ⬜ |
| UI-87 | workbench 快捷键 title | 格式不一（「Ctrl+Z」vs「（F）」）：统一 「快捷键: X」 | P2 | S | | ⬜ |
| UI-88 | workbench 相机开/关 | 开相机后 dropZone 隐藏 ✓；关相机按钮位置 ✓ | P3 | S | | ⬜ |

## 三、材质渲染（MAT-1 ~ MAT-64）

| # | 位置 | 问题 → 改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| MAT-1 | materials.js repeat | marble/wood repeat 定值，大尺寸 ramp/box 纹理拉伸：按实体尺寸缩放 repeat（registry 钩子 matRepeat(params)） | P1 | M | ⚠ 材质共享需 per-instance 纹理或接受共享档 | ⬜ |
| MAT-2 | registry cylinder makeMesh | spokes 每次 rebuild new MeshStandardMaterial×辐条数：模块级共享 spoke 材质 | P0 | S | | ⬜ |
| MAT-3 | registry markerGroup | flag 材质每实例 new：共享常量材质 | P0 | S | | ⬜ |
| MAT-4 | registry lightGroup | bulb 材质每实例 new：共享 | P0 | S | | ⬜ |
| MAT-5 | viewport.js 灯光 | 三点布光缺轮廓光：加低强度冷色 rim DirectionalLight(0x8ab0d0, 0.35) 从后上（真实摄影棚参考） | P1 | S | ⚠ 全场景亮度微变，w 截图金标 | ⬜ |
| MAT-6 | viewport.js shadow | 无 normalBias：加 key.shadow.normalBias=0.02 消斜面自阴影 acne（实机验证） | P1 | S | | ⬜ |
| MAT-7 | viewport.js 阴影范围 | ±9 固定：天体/大板场景阴影裁切：按场景包围盒自适应 left/right/top/bottom/far（rebuild 时更新） | P2 | M | | ⬜ |
| MAT-8 | viewport.js exposure | 1.06 定值无用户控制：顶栏视角组加曝光滑杆（0.6~1.6，内存不进文档） | P2 | S | | ⬜ |
| MAT-9 | viewport.js envRotation | environmentRotation 不可调（r163+ 支持）：材质检查用滑杆（P3） | P3 | S | | ⬜ |
| MAT-10 | materials.js chrome | 镜面反射 1k HDRI 带状：studio_2k.hdr 可选资产+启动探测（无则 1k） | P3 | M | | ⬜ |
| MAT-11 | materials.js sun | 恒星无实际照明，行星暗面平：celestial 中心体挂微弱 PointLight（衰减半径=轨道尺度，freedom 交叉项） | P2 | M | ⚠ 守恒无关、性能+1 灯 | ⬜ |
| MAT-12 | materials.js rubber | roughness 0.94 无 sheen：加 sheen 0.15/sheenColor 暖灰（r186 MeshPhysical 支持） | P2 | S | | ⬜ |
| MAT-13 | materials.js steelDark | 无表面变化：加程序化各向异性 anisotropy 0.3（机加纹理感） | P3 | S | ⚠ 贵族化过度风险 | ⬜ |
| MAT-14 | materials.js wood | 无法线图：补 wood/normal.jpg 加载（缺则跳过 ✓ 契约） | P3 | M | | ⬜ |
| MAT-15 | workbench render.color | 无 per-entity 色调：doc.render.tint (#rrggbb) + 材质 clone 着色（不破坏共享材质缓存语义：tint 实体 clone） | P2 | M | | ⬜ |
| MAT-16 | viewport.js trail 线 | 受雾影响远处轨迹淡出：LineBasicMaterial fog=false（数据线不参与大气） | P1 | S | | ⬜ |
| MAT-17 | viewport.js grid | 无主刻度强调：step≥0.5 时每 5 格加 0x4a4e55 强线（双 GridHelper 叠加或自定义几何） | P2 | M | | ⬜ |
| MAT-18 | viewport.js 轴线 | ±10 固定，5m 档视野 20m+ 轴不到边：轴线长度随 gridStep×10 | P2 | S | | ⬜ |
| MAT-19 | registry ruler | 光杆无刻度：rulerGeometry 加 0.1m 刻度槽（BoxGeometry merge 或小段 mesh） | P2 | M | | ⬜ |
| MAT-20 | registry timer | 光门无门面视觉：半透明 0x7ba7d9 平面（opacity 0.12）显示检测面 | P1 | S | | ⬜ |
| MAT-21 | registry speedSensor | 锥体无指向：jointViz 同款虚线连 sensor→target（运行态隐藏可选） | P2 | S | | ⬜ |
| MAT-22 | viewport impact ring | 碰撞环等大：环尺寸∝碰撞相对速度（教学信息量） | P3 | S | | ⬜ |
| MAT-23 | viewport 速度箭头 | 无标度：箭头组显示 1m/s 参考短刻度（图例配合 UI-25） | P3 | M | | ⬜ |
| MAT-24 | materials.js 降级色 | marble 0xe8e5df/wood 0x8a6a48 ✓ 实测量级；无项 | P3 | S | | ⬜ |
| MAT-25 | materials.js 加载 | 7 贴图 Promise.all ✓ 并行；失败 warn 降级 ✓ | P3 | S | | ⬜ |
| MAT-26 | viewport.js HDRI | 失败降级 RoomEnvironment ✓；PMREM generator 未 dispose：补 dispose | P2 | S | | ⬜ |
| MAT-27 | viewport.js 背景 | 纯色背景层次感弱：摄影棚地平线渐变（大半径内壁球 gradient 着色器或 canvas 渐变纹理球）——需设计定调后做 | P3 | L | ⚠ 生死线：先样张 | ⬜ |
| MAT-28 | viewport.js 色调映射 | ACES ✓ 教材场景够用；AgX 试验留 P3 | P3 | S | | ⬜ |
| MAT-29 | viewport.js shadowFloor | ShadowMaterial 0.42 ✓；大场景透明面 overdraw 可接受 | P3 | S | | ⬜ |
| MAT-30 | registry celestial | saturnRing 缺图 null 契约 ✓ | P3 | S | | ⬜ |
| MAT-31 | workbench ghost | ghost 材质 opacity 0.35 ✓；hover 时呼吸微动画（±0.05）克制版 | P3 | S | | ⬜ |
| MAT-32 | viewport jointViz | 虚线蓝/红 ✓ 语义清晰 | P3 | S | | ⬜ |
| MAT-33 | viewport 力箭头颜色 | decompose 4 色体系 ✓ 文档化于 UI-25 图例 | P3 | S | | ⬜ |
| MAT-34 | materials.js floorOverlay | classic 页专用 ✓ 保留 | P3 | S | | ⬜ |
| MAT-35 | registry track | marble 贴图 uv×6 ✓；arcFraction 调整无重渲染问题（全量重建） | P3 | S | | ⬜ |
| MAT-36 | viewport.js 雾 | near16/far42（并入 PER-38 自适应） | P1 | S | | ⬜ |
| MAT-37 | registry box | wood 拉伸（并入 MAT-1） | P1 | M | | ⬜ |
| MAT-38 | registry ground | steelDark 大平面反射生硬：roughnessMap 噪声贴图（程序 canvas 生成 256²） | P3 | M | | ⬜ |
| MAT-39 | viewport toneMappingExposure | 与 MAT-8 同源（滑杆） | P2 | S | | ⬜ |
| MAT-40 | thumbs.js | 缩略图无环境贴图（主场景有）：离屏场景 scene.environment 复用主 HDRI 纹理（一致性） | P2 | M | | ⬜ |
| MAT-41 | thumbs.js 灯光 | ambient1.0+key1.6+rim0.5 与主场景不同：对齐主布光（含 PER-12 后功率档） | P2 | S | | ⬜ |
| MAT-42 | viewport.js 相机 | fov42 ✓ 仪器感；无项 | P3 | S | | ⬜ |
| MAT-43 | materials.js brass | 0x9c7a3c ✓ 实测反射率；无项 | P3 | S | | ⬜ |
| MAT-44 | registry hinge | 轴柱 brass ✓；无项 | P3 | S | | ⬜ |
| MAT-45 | registry pulley | brass ✓；无项 | P3 | S | | ⬜ |
| MAT-46 | workbench 材质切换 | patchRender rebuild ✓ 即时反馈；无项 | P3 | S | | ⬜ |
| MAT-47 | registry light | PointLight distance7/decay2 ✓ 物理正确；不投影 ✓ 注释明确 | P3 | S | | ⬜ |
| MAT-48 | viewport gizmo | TransformControls 默认配色与主题冲突（红绿蓝轴 ✓ 功能色保留） | P3 | S | | ⬜ |
| MAT-49 | viewport BoxHelper | ACCENT 琥珀 ✓；多选灰 0x82878f ✓ | P3 | S | | ⬜ |
| MAT-50 | 材质文档 | materials.js 注释详实 ✓；无项 | P3 | S | | ⬜ |
| MAT-51 | registry sphere | 40×28 段球 ✓ 平滑；大半径(2m) 段数不足：radius>0.8 时 48×32 | P2 | S | | ⬜ |
| MAT-52 | registry cylinder | 32 段 ✓；无项 | P3 | S | | ⬜ |
| MAT-53 | viewport snapMarker | 琥珀环 ✓；无项 | P3 | S | | ⬜ |
| MAT-54 | viewport cropRect | UI 层 ✓ | P3 | S | | ⬜ |
| MAT-55 | workbench atwood 绳 | 绳 mesh 直连两球穿模滑轮：绳改两段（球→滑轮切点）两 mesh 或 CatmullRom 3 点曲线（freedom 交叉） | P2 | M | ⚠ p10 断言绳长 | ⬜ |
| MAT-56 | registry rope | 8 段细杆 ✓；无项 | P3 | S | | ⬜ |
| MAT-57 | registry spring | 直杆无螺旋视觉：螺旋TubeGeometry（k=12 匝，性能可接受单实体） | P1 | M | ⚠ p 系列截图 | ⬜ |
| MAT-58 | viewport 轨迹线宽 | 1px 固定：linewidth 无效（WebGL 限制）记录；不动 | P3 | S | | ⬜ |
| MAT-59 | 材质键契约 | check.py 无材质键校验：MATERIAL_OPTIONS×materials.js 键 diff 检查补进 check.py | P1 | S | | ⬜ |
| MAT-60 | envIntensity | 0.55 ✓；与 exposure 滑杆联动留 P3 | P3 | S | | ⬜ |
| MAT-61 | viewport AA | MSAA antialias ✓；postprocessing 无（决策：不上 bloom，保持仪器克制） | P3 | S | | ⬜ |
| MAT-62 | registry marker | 三角旗警示色 0xc96a5a ✓ | P3 | S | | ⬜ |
| MAT-63 | 材质命名 | M 键名与 WINDOW.MECH 无冲突（局部作用域）但易混（并入 ENG-24 重命名） | P2 | S | | ⬜ |
| MAT-64 | 阴影分辨率 | 2048 ✓；高 dpr 屏可选 4096（决策默认不动） | P3 | S | | ⬜ |

## 四、交互手感（FEEL-1 ~ FEEL-92）

| # | 位置 | 问题 → 改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| FEEL-1 | index.html number input | 滚轮误改数值（聚焦后滑动）：input[type=number] wheel preventDefault（blur 后恢复） | P0 | S | | ⬜ |
| FEEL-2 | workbench opDuplicate | 副本与原件完全重叠：offset x+0.25/spawn 重摆位 | P1 | S | ⚠ p 系列位置断言 | ⬜ |
| FEEL-3 | workbench F 键 | viewport.focus 瞬跳 vs 大纲 ⌖ focusOn 平滑：统一 F=focusOn 平滑版 | P1 | S | | ⬜ |
| FEEL-4 | workbench 方向键 | 无微调：←→↑↓ 移动选中 0.1m（Shift=1m，Alt=0.01m），运行态禁用 | P1 | M | ⚠ 与输入框焦点冲突守卫 | ⬜ |
| FEEL-5 | workbench triRow | 三个输入各 commit 一次（3 个 undo 步）：行级合并单 undo（延迟 100ms 聚合） | P1 | M | ⚠ undo 语义回归 | ⬜ |
| FEEL-6 | workbench onKey | 无 Esc 全局：Esc=关相机/退框选/清 ghost/关帮助浮层（按优先级） | P1 | S | | ⬜ |
| FEEL-7 | viewport ghost | ghost 只能点目录放置：canvas 点击=在 ghost 当前位放置（放置模式），Esc 退出 | P1 | M | ⚠ 点击与选择冲突：ghost 激活时点击优先放置 | ⬜ |
| FEEL-8 | viewport ghost | 放置中不可旋转（R 已被重置占用）：Q/E 旋转 ghost 15° | P2 | S | | ⬜ |
| FEEL-9 | workbench cycleSnap | 切吸附档位立即重定位选中实体（副作用突兀）：改为仅设档+toast，重吸附只在 gizmo 释放时 | P1 | S | ⚠ p24 吸附断言 | ⬜ |
| FEEL-10 | workbench 目录拖拽 | 无 drag&drop 拖入视口放置（HTML5 DnD）：comp-item draggable → drop 位置放置 | P2 | M | | ⬜ |
| FEEL-11 | viewport 双击 | 双击实体不平滑聚焦：dblclick→focusOn | P2 | S | | ⬜ |
| FEEL-12 | workbench 多选 gizmo | gizmo 只挂主选中：多选时平移主实体其余不动：组平移（delta 应用全部选中） | P2 | L | ⚠ 大改；先做平移 | ⬜ |
| FEEL-13 | workbench onBoxSelect | 框选只能替换不能加选：shift+框选=并集 | P2 | S | | ⬜ |
| FEEL-14 | viewport hover | 视口无 hover 预选提示：pointermove 节流 raycast 高亮 hover 轮廓（弱化 0.25 透明度） | P2 | M | ⚠ 性能（rAF 节流） | ⬜ |
| FEEL-15 | workbench 右键 | 无实体右键菜单（复制/删除/锁定/聚焦）：自绘菜单（直角风格）；OrbitControls 右键=平移保留，菜单挂 contextmenu 仅实体命中时 | P2 | M | ⚠ 与平移手势冲突 | ⬜ |
| FEEL-16 | workbench Ctrl+D | ✓ 已有；title 提示统一（UI-87） | P3 | S | | ⬜ |
| FEEL-17 | workbench stepOnce | 无单步键盘：「.」或 → 键单步（暂停态） | P2 | S | | ⬜ |
| FEEL-18 | index.html selSpeed | 无 2x/4x：加 2/4 档（MAX_STEPS×8 上限=8 步/帧，4x 需升上限至 16 或接受丢步提示） | P2 | S | ⚠ advance 上限 | ⬜ |
| FEEL-19 | workbench replay | 回放无倍速/循环：bar 旁 ×0.5/×1/×2 循环开关 | P3 | M | | ⬜ |
| FEEL-20 | workbench 录制 | 录制不可暂停续录：决策不做（简化） | P3 | S | | ⬜ |
| FEEL-21 | viewport zoomSpeed | 1.0 默认近景过快：0.9+dollyToCursor=true（对准鼠标缩放，建模软件手感） | P1 | S | | ⬜ |
| FEEL-22 | viewport controls | 无平移惯性/旋转阻尼文档：enableDamping ✓ 已有；无项 | P3 | S | | ⬜ |
| FEEL-23 | workbench rename | Enter/Esc/blur ✓ 良好；无项 | P3 | S | | ⬜ |
| FEEL-24 | workbench numRow | 无拖拽滑值（点住 label 横拖改值）：加（step 倍率随 Shift） | P2 | M | | ⬜ |
| FEEL-25 | workbench schema min/max | 滑杆型参数（friction/restitution/rollResist）无 range UI：schema 加 kind:'slider' 渲染 range+number 组合 | P2 | M | | ⬜ |
| FEEL-26 | registry ramp | 倾角行与 computed 行分裂（编辑行+只读当前倾角）：合并一行（编辑即显新值） | P2 | S | | ⬜ |
| FEEL-27 | workbench applySnapToMesh | endpoint 吸附含 y（3D 角点）而 ghost 版只算 xz：语义统一（ghost 同 3D） | P2 | S | | ⬜ |
| FEEL-28 | viewport snap 档 | 档位循环 5 档无指示序号：toast 显示 n/5 | P3 | S | | ⬜ |
| FEEL-29 | workbench 大纲 | 无拖拽排序实体：决策不做（顺序无语义） | P3 | S | | ⬜ |
| FEEL-30 | workbench 成组 | 组不可命名：ol-group 头行内改名（同实体改名交互） | P3 | M | | ⬜ |
| FEEL-31 | workbench 组选中 | 点组头选中 ✓；组整体 gizmo 同 FEEL-12 | P3 | L | | ⬜ |
| FEEL-32 | workbench 锁定 | 运行态不可锁 ✓；批量锁（组）留 P3 | P3 | S | | ⬜ |
| FEEL-33 | viewport 正交切换 | 焦点/距离保留 ✓；resize bug（PER-21）修后无项 | P3 | S | | ⬜ |
| FEEL-34 | workbench 视图预设 | 顶/前/侧瞬跳：300ms 插值飞（与 flyToPose 同机制） | P2 | M | | ⬜ |
| FEEL-35 | viewport focus | min(size*2.4,1.0) 小件偏远：系数 2.0 试验 | P3 | S | ⚠ 截图金标 | ⬜ |
| FEEL-36 | workbench resetSim | R 键无确认清运行：toast「已重置」✓ 已有；无项 | P3 | S | | ⬜ |
| FEEL-37 | workbench play/pause | Space ✓；按钮文案态机 ✓（运行/继续/暂停）；无项 | P3 | S | | ⬜ |
| FEEL-38 | workbench timeScale | 0.1x 精细观察 ✓；UI 档位（FEEL-18） | P3 | S | | ⬜ |
| FEEL-39 | workbench 曲线开关 | 运行结束曲线冻结 ✓ 合理；清空按钮补「清除数据」 | P2 | S | | ⬜ |
| FEEL-40 | viewport 轨迹 | 无清除轨迹按钮（重置即清 ✓）：底栏轨迹按钮 double-click 清除（隐蔽）；改显式小按钮 | P3 | S | | ⬜ |
| FEEL-41 | workbench 叠加层 | 4 开关独立无一键全关：矢量按钮 shift+click 全关（title 说明） | P2 | S | | ⬜ |
| FEEL-42 | workbench 裁剪 | 裁剪后无预览裁剪结果：cropHint 显示尺寸已有 ✓；补选区重置按钮已有 ✓ | P3 | S | | ⬜ |
| FEEL-43 | workbench 拍照 | captureFrame ✓；无倒计时自拍（决策不做） | P3 | S | | ⬜ |
| FEEL-44 | workbench 上传 | 大图降采样 1400 ✓；进度无（本地瞬时） | P3 | S | | ⬜ |
| FEEL-45 | workbench 解析重试 | btnParse 可重复 ✓；失败自动重试 1 次（502 瞬时，间隔 1.5s，toast 告知） | P1 | M | ⚠ 双倍调用量预算 | ⬜ |
| FEEL-46 | workbench agent 面板 | 场景切换后 plan 陈旧（可对错场景解释）：applyDoc 时 agentPlan 相关态复位+提示 | P0 | S | ⚠ w4 混合流程时序 | ⬜ |
| FEEL-47 | workbench explain | 解释会 reset 重跑 ✓（数据新鲜）；重跑前 toast「将重置并运行 n 秒」 | P2 | S | | ⬜ |
| FEEL-48 | workbench textReq | 解析后 textarea 保留 ✓（可改重解析）；无项 | P3 | S | | ⬜ |
| FEEL-49 | workbench 建场滚屏 | 变更清单长时 apply 后视口在下方：自动滚到 explainGrp | P2 | S | | ⬜ |
| FEEL-50 | viewport gizmo scale | 拖拽中非均匀预览后松手跳正（已知语义）：拖拽中实时钳制显示（objectChange 事件同步 uniform） | P1 | M | | ⬜ |
| FEEL-51 | viewport gizmo | setSize 0.85 固定：按 dpr 归一（4K 屏偏小）setSize(0.85*max(1,dpr/1.5)) | P2 | S | | ⬜ |
| FEEL-52 | viewport gizmo 模式 | W/E 快捷 ✓；无 scale 快捷键：R 被占用 → 用 T（或 1/2/3） | P2 | S | | ⬜ |
| FEEL-53 | workbench 撤销 | gizmo 拖动 undo ✓ 粒度合理；无项 | P3 | S | | ⬜ |
| FEEL-54 | workbench history cap | 60 步无提示达上限：title 显示 60/60 | P3 | S | | ⬜ |
| FEEL-55 | workbench 打开场景 | 文件读取无进度（大 JSON 瞬时）✓ | P3 | S | | ⬜ |
| FEEL-56 | workbench 保存 | a.click 下载 ✓；文件名场景名 ✓ | P3 | S | | ⬜ |
| FEEL-57 | workbench 空场景预设 | btnNew 无确认（autosave 覆盖）：新建前 confirm 若 entities>0 且未导出 | P2 | S | ⚠ 测试流程（w1 新建）| ⬜ |
| FEEL-58 | viewport 框选 | 微拖 <6px 忽略 ✓；无项 | P3 | S | | ⬜ |
| FEEL-59 | workbench shift 加选 | ✓ 已有（onSelect additive）；无项 | P3 | S | | ⬜ |
| FEEL-60 | workbench 删除键 | Delete/Backspace ✓；输入框守卫 ✓ | P3 | S | | ⬜ |
| FEEL-61 | viewport pick | 递归 Group 可选 ✓（辐条）；无项 | P3 | S | | ⬜ |
| FEEL-62 | viewport 锁定 | 不可点选 ✓；大纲可解锁 ✓ | P3 | S | | ⬜ |
| FEEL-63 | workbench 检查器禁用态 | 运行态 input disabled ✓ 灰化；无项 | P3 | S | | ⬜ |
| FEEL-64 | workbench 材质切换即时性 | rebuild 全量（感知 <50ms 小场景）✓；PER-19 后更快 | P3 | S | | ⬜ |
| FEEL-65 | viewport 相机起步 | 首帧相机 (3.4,2.6,5.2) ✓；预置加载不飞（UI-49 补自动取景） | P2 | S | | ⬜ |
| FEEL-66 | workbench 预置连点 | selPreset onchange 即载 ✓；e.target.value='' 复位 ✓ | P3 | S | | ⬜ |
| FEEL-67 | workbench momentumpreset 叠加层自动开 ✓（教学预设惯例）；其余预设无：celestial/spin/classic 已有；incline/atwood/hinge/projectile 无（不强制） | P3 | S | | ⬜ |
| FEEL-68 | workbench atwood 载入聚焦 | ✓ 已有 focus；无项 | P3 | S | | ⬜ |
| FEEL-69 | viewport maxDistance | 100 ✓ 大场景；minDistance 0.4 微距 ✓ | P3 | S | | ⬜ |
| FEEL-70 | viewport maxPolarAngle | 1.54 防钻地 ✓；天体场景希望俯瞰：视角预设不受限 ✓（setViewPreset top 突破？top dir [0,1,0.0001] 极角≈π/2-ε<1.54 ✓ 可达） | P3 | S | | ⬜ |
| FEEL-71 | workbench replayBar scrub | input 拖动逐帧 ✓ 手感好；无项 | P3 | S | | ⬜ |
| FEEL-72 | workbench stopReplay | 恢复编辑态 rebuild ✓；无项 | P3 | S | | ⬜ |
| FEEL-73 | workbench 相机 toggleProjection | 死代码/重复逻辑清理（ENG-3/4）后无项 | P3 | S | | ⬜ |
| FEEL-74 | viewport tickFocus lerp | 0.18 ✓ 顺滑；收敛阈值 ✓ | P3 | S | | ⬜ |
| FEEL-75 | workbench toast 时长 | 1800ms 固定：错误类 3s（与 UI-5 联动） | P2 | S | | ⬜ |
| FEEL-76 | workbench outlineEditing | 改名期间禁重建 ✓（坑修复记录）；无项 | P3 | S | | ⬜ |
| FEEL-77 | workbench 输入 blur 提交 | 已知坑 ✓ 文档化；无项 | P3 | S | | ⬜ |
| FEEL-78 | workbench flex input width:0 | 已知坑 ✓ tri 类已设；无项 | P3 | S | | ⬜ |
| FEEL-79 | viewport TransformControls | r186 getHelper ✓；dragging-changed 禁 OrbitControls ✓ | P3 | S | | ⬜ |
| FEEL-80 | viewport gizmo scale 提交 | 均匀化+钳制 ✓（0.25~4）；无项 | P3 | S | | ⬜ |
| FEEL-81 | workbench applyGizmoToEntity | toFixed(4) ✓ 精度；无项 | P3 | S | | ⬜ |
| FEEL-82 | workbench onGizmoCommit | 撤销标签「移动 X」✓；旋转/缩放模式标签同串：按 gizmoMode 区分标签 | P2 | S | | ⬜ |
| FEEL-83 | viewport grid 迟滞收敛 | 迟滞档位 ✓（42/8 阈值）；p23 waitForFunction ✓ 稳定 | P3 | S | | ⬜ |
| FEEL-84 | workbench scaleReadout | 档位提示 ✓；无项 | P3 | S | | ⬜ |
| FEEL-85 | viewport ghost sticky | hover 粘滞语义 ✓（Round 27 修复）；移出目录不消失 ✓ 设计 | P3 | S | | ⬜ |
| FEEL-86 | viewport ghost 半高 | _ghostHalfHeight 每帧 Box3：随 PER-6 缓存 | P2 | S | | ⬜ |
| FEEL-87 | workbench 传感器放置 | 需先选 1 动态体 ✓ toast 引导；放置位 target+0.6x ✓ | P3 | S | | ⬜ |
| FEEL-88 | workbench 两实体连接 | 选中顺序 A→B 语义无提示：选中 2 个且 hover 绳/弹簧时 toast「按选中顺序连接 A→B」 | P2 | S | | ⬜ |
| FEEL-89 | registry rope 长度 | 重叠实体 auto len≈0 → clamp min 0.05 + toast | P1 | S | | ⬜ |
| FEEL-90 | workbench 撤销跨批 | historyBatchDepth ✓ 单 undo 单元；无项 | P3 | S | | ⬜ |
| FEEL-91 | viewport resize 监听 | window resize ✓；容器尺寸变化（面板拖宽 FEEL-10）需 ResizeObserver：随 UI-10 | P2 | S | | ⬜ |
| FEEL-92 | workbench 自检 | selftest 存在但无入口：console.log banner 提示 MECH.selftest()（boot 一次） | P3 | S | | ⬜ |

## 五、Agent 能力（AG-1 ~ AG-92）

| # | 位置 | 问题 → 改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| AG-1 | explain.js explainProjectile | 摘要把实测高度印进理论槽（H = ...= ${Hmeasured}）：改 Htheory（文案 bug） | P0 | S | | ✅ B1：摘要理论槽位改 Htheory |
| AG-2 | explain.js explainMomentum | 恢复系数合成 ternary 逻辑错（min=0 时强制 e=0，Rapier 实为平均）：e 恒取平均 | P0 | S | ⚠ 理论值变化（0/0.8 组合场景） | ✅ B1：node 实测 Rapier=平均后改恒取平均 |
| AG-3 | explain.js explainHinge/Atwood | g=9.81 硬编码：改 doc.gravity（月球场景错误） | P0 | S | | ✅ B1：hinge/atwood 用场景重力 |
| AG-4 | workbench updateAtwoodCons/atwoodInfo | g=9.81 硬编码同上：统一 Math.abs(doc.gravity) | P0 | S | | ✅ B1：updateAtwoodCons/atwoodInfo 用 doc.gravity 并随结果带 g |
| AG-5 | explain.js explainAstro | 中心体取 plan.entities[0]（模型顺序不可信）：取 doc 中质量最大 celestial | P0 | S | | ✅ B1：中心质量取最大者（含单测锚） |
| AG-6 | parse-schema ballOnRamp | 球半径硬编 0.15（题给 0.5 半球沉坡）：用实际 given.radius | P0 | S | | ✅ B1：ballOnRamp 半径参数化（单测覆盖） |
| AG-7 | workbench runAndExplain | astro 解释依赖 trails 采样（周期/偏心率），未开轨迹时 null→判 fail：isAstro && !trailsOn 自动 setTrails(true) | P0 | S | | ✅ B1：astro 解释自动开轨迹 |
| AG-8 | workbench readQuestionImage | EXIF 方向不处理（手机横拍图歪）：createImageBitmap(blob,{imageOrientation:'from-image'})，失败回退 Image | P1 | M | | ⬜ |
| AG-9 | parse-schema normalizeParse | 未知 given 键静默丢弃：收集进 plan.uncertain 展示（透明度） | P1 | S | | ⬜ |
| AG-10 | parse-schema gravity | 越界 gravity 静默落默认 9.81：errors 加一条提示 | P1 | S | | ⬜ |
| AG-11 | parse-schema ramp 过定 | angleDeg+length+height 同给时优先 angleDeg ✓ 但无提示：加 uncertain 提示 | P2 | S | | ⬜ |
| AG-12 | parse-schema TYPE_MAP | 中文别名不足：补 斜坡/木板/台/圆盘/转盘/滑轮组/刚体/质点 | P1 | S | | ⬜ |
| AG-13 | parse-schema atwoodLayout | 球 y 固定 1.0 忽略 given.position.y：尊重题给高度 | P2 | S | | ⬜ |
| AG-14 | parse-schema hingeLayout | 初始摆角 0.4 固定：题给「拉开 θ 角」→ angvel 或位置推导 | P2 | M | | ⬜ |
| AG-15 | parse-schema springLayout | 仅水平振子：竖直弹簧（挂吊）布局分支（gravityScale=1, 平衡位拉伸 mg/k） | P2 | L | | ⬜ |
| AG-16 | parse-schema rotationLayout | r0=0.7 固定：题给初始半径（slider position）推导 | P2 | S | | ⬜ |
| AG-17 | parse-schema 天体 G | plan.G 缺省按 1 推断速度：若质量量级真实（≤1e3）且无 G → uncertain 提示 G 可能未按教学缩放 | P2 | S | | ⬜ |
| AG-18 | parse-schema box 尺寸 | 题给木块尺寸被忽略（0.3 立方固定）：RANGES+prompt 加 sx/sy/sz，layout 应用 | P1 | M | | ⬜ |
| AG-19 | parse-schema cylinder 高 | given.height 有 range 但 layout 忽略：应用 | P1 | S | | ⬜ |
| AG-20 | parse-schema ground 尺寸 | ground 固定 10×8：given.length/width 应用（抛体需 30 宽） | P1 | S | | ⬜ |
| AG-21 | parse-schema ramp 宽 | 坡宽默认 0.5 vs 球半径大时侧翻跌落：width=max(0.5, 2.2×maxBallRadius) | P1 | S | | ⬜ |
| AG-22 | parse-schema 对撞间距 | 1.6m 固定：按相对速度放大（v>3 时间距 2.4）防 needT 截断 | P2 | S | | ⬜ |
| AG-23 | explain.js explainProjectile | 落地阈值 y≤0.16 硬编码（半径 0.15 假设）：用 doc 球半径+地面顶面高 | P1 | S | | ⬜ |
| AG-24 | explain.js explainProjectile | needT 2.5s 固定：tFlight×1.5+0.5 动态 | P1 | S | | ⬜ |
| AG-25 | workbench runAndExplain needT | isMomentum 4s/斜面 4s 固定：斜面按坡长/加速度估计 | P3 | M | | ⬜ |
| AG-26 | explain.js explainSpring | 峰间隔去毛刺阈值 5 采样固定：k 大周期短漏检：阈值=max(3, T_est 采样数/8) | P2 | M | | ⬜ |
| AG-27 | explain.js explainSpring | Ttheory 只用球质量：注明理想弹簧假设（文案）✓ 已有；补悬挂质量校正决策不做 | P3 | S | | ⬜ |
| AG-28 | explain.js explainAtwood | aFit=2d/t² 假设静止起跑：题给初速时三点二次拟合 | P2 | M | | ⬜ |
| AG-29 | workbench atwoodInfo | heavyDrop 死行（×0）：删除 | P0 | S | | ✅ B1：删 heavyDrop 死行 |
| AG-30 | serve.py PARSE_PROMPT | 无少样本示例：附 1 个紧凑示例（斜面 JSON 单行）提升一次通过率 | P1 | M | ⚠ 输出风格漂移需 fixture 回归 | ⬜ |
| AG-31 | serve.py temperature | 0.2 固定：实验 0.1（结构化输出更稳）真实抽查对比后定 | P2 | S | ⚠ 调用预算 | ⬜ |
| AG-32 | serve.py prompt 实体数 | 无上限：补「实体不超过 12 个」防跑题长输出 | P1 | S | | ⬜ |
| AG-33 | serve.py prompt 数值型 | 未强调「数值必须是 JSON 数字不要字符串」：补一句 | P1 | S | | ⬜ |
| AG-34 | serve.py response_format | 未尝试 json 模式：探测 step_plan 支持 response_format=json_object 则启用 | P2 | M | | ⬜ |
| AG-35 | serve.py 图片尺寸 | 1400 上限：文字密集竖照（长题）上限放宽 1800 竖向：客户端按宽高比分支 | P2 | S | ⚠ 请求体 | ⬜ |
| AG-36 | serve.py 重试 | 上游 5xx/超时无自动重试 1 次（服务端侧）：幂等可重试（连 AG 客户端 FEEL-45 二选一，先客户端） | P2 | S | | ⬜ |
| AG-37 | serve.py 超时 | 90s 长：视觉思考流确实长；保持（记录决策） | P3 | S | | ⬜ |
| AG-38 | workbench parseQuestion | fetch 无 AbortController 超时：100s AbortController（UI-17 取消复用） | P1 | S | | ⬜ |
| AG-39 | workbench adoptServerParse | confidence<0.35 低置信无警示：banner 提示「模型置信度低，请逐项核对」 | P1 | S | | ⬜ |
| AG-40 | workbench matchOverrides | 复用匹配 first-find 不看位置：改「同类型+距离最近」混合匹配 | P1 | M | ⚠ w4 混合断言 | ⬜ |
| AG-41 | workbench applyAgentPlanInner | 复用更新 patch 全覆盖 transform（用户拖过的位置被题给覆盖）：变更预览已展示 diff ✓；补选项「保留我的位置」（checkbox per-entity） | P3 | M | | ⬜ |
| AG-42 | workbench 混合建场 | 已有实体类型不在 plan（用户加的装饰）不动 ✓ 尊重；无项 | P3 | S | | ⬜ |
| AG-43 | workbench atwood 回填 | '__PULLEY__' 回填+二次 rebuild ✓ 可用；PER-5 批内合并后单次 | P1 | S | | ⬜ |
| AG-44 | workbench 文字通道 | 无上下文引用（「把选中物体质量改 2kg」）：文字前缀「选中: <名>」拼进 prompt（决策先做只读注入） | P2 | M | | ⬜ |
| AG-45 | workbench 多题图 | 一图多题无拆分：crop 框选即手动拆分 ✓ 已覆盖；无项 | P3 | S | | ⬜ |
| AG-46 | workbench fixture 通道 | UI-4 下拉化（10 份 fixture 全量可览） | P1 | S | | ⬜ |
| AG-47 | workbench agentState | 快照 API ✓ 完整；无项 | P3 | S | | ⬜ |
| AG-48 | workbench recordCorrection | 修正记录进 doc.meta ✓；本地统计面板（哪类字段最常被改→反向改 prompt）：localStorage 聚合+console 表 | P2 | M | | ⬜ |
| AG-49 | tools/fixtures | 10 fixture ✓ 回归金标；补 parse-momentum2d/projectile 已有 ✓；无缺 | P3 | S | | ⬜ |
| AG-50 | tools/ui-test | 无 normalizeParse 纯函数单测：node --test 直跑 parse-schema（无浏览器，快） | P1 | M | | ✅ B1：23 项 node --test（金标+防御+布局） |
| AG-51 | explain.js | 纯函数无单测：node --test 覆盖 8 分支理论值（造 series/reports 假数据） | P1 | M | | ✅ B1：8 分支合成轨迹单测（含 g=10/月球锚） |
| AG-52 | workbench runAndExplain 选球 | first sphere 选中解释对象：优先 measured:true | P2 | S | | ⬜ |
| AG-53 | workbench explain 分派 | 优先级 hinge>spring>projectile>rotation>atwood>astro>incline>momentum ✓ 明确；文档化注释 | P3 | S | | ⬜ |
| AG-54 | explain.js explainIncline | effFriction 平均假设与 Rapier 默认一致 ✓；无项 | P3 | S | | ⬜ |
| AG-55 | explain.js hinge debug | console.log 残留 2 处：删除 | P0 | S | | ✅ B1：删 hinge-dbg 两处 |
| AG-56 | explain.js explainHinge | L 取最长维启发式：建场铰链杆 sx=长 ✓ 一致；无项 | P3 | S | | ⬜ |
| AG-57 | explain.js explainRotation | 理论 ω 仅参考 L 守恒门控 ✓ 注释明确；无项 | P3 | S | | ⬜ |
| AG-58 | explain.js explainAstro | pass 三条件 ✓；Ttheory null 时（trails 短）判 fail：needT 11s 已保 ~2 周期；边界仍补采样中态文案 | P2 | S | | ⬜ |
| AG-59 | parse-schema celestial 恢复 | r<1e-6 && speed>0 反推 ✓；position 完全缺失且速度 0：落默认 r=3+assumption ✓ 已兜；补 errors 提示 | P2 | S | | ⬜ |
| AG-60 | parse-schema 光滑推断 | friction 注入 ✓ 推断徽标 ✓；粗糙语义（「粗糙」「摩擦因数 μ=0.5」）已有显式 friction ✓；无项 | P3 | S | | ⬜ |
| AG-61 | parse-schema RANGES | momentOfInertia 两拼写 ✓；补 damping/长度类键？ 决策不加（防编造） | P3 | S | | ⬜ |
| AG-62 | serve.py prompt 天体 | G/position/radius 语义 ✓ 已修；补「卫星速度方向垂直于位置连线」一句（圆轨道图示常见歧义） | P1 | S | | ⬜ |
| AG-63 | serve.py prompt 铰链 | 复摆提示缺（杆长写 length、锚点 position）：补一句 kind=hinge 规则 | P1 | S | | ⬜ |
| AG-64 | serve.py prompt 抛体 | 无专项规则（初速 vx/vy 语义）：补「抛体题球 given.velocity=[vx,vy,0]」 | P1 | S | | ⬜ |
| AG-65 | workbench buildChangePreview | attach 显示 k=—：rope 显示 绳长；✓小改 | P3 | S | | ⬜ |
| AG-66 | workbench PEDIT | cylinder 无 height 行、box 无尺寸行（AG-18 联动补） | P1 | S | | ⬜ |
| AG-67 | workbench PEDIT celestial | mass 上限 1e6 vs registry 检查器 1e4：对齐 1e6（质量范围一致化） | P1 | S | | ⬜ |
| AG-68 | parse-schema 速度范围 | velocity 无量级校验（1000m/s 也收）：范围 ±100 clamp+警告 | P2 | S | | ⬜ |
| AG-69 | parse-schema angvel | 同上 ±100 | P2 | S | | ⬜ |
| AG-70 | workbench loadParse | 外部注入通道 ✓（回归用）；无项 | P3 | S | | ⬜ |
| AG-71 | workbench setAgentStage 状态机 | 9 态 ✓ 完整；error 态 badge 色差（UI-5 联动） | P2 | S | | ⬜ |
| AG-72 | workbench 解析并发 | 双通道同时 parse 无互斥：busy 期 btnParseText 禁用（防双计费） | P1 | S | | ⬜ |
| AG-73 | serve.py 线程 | 并发 parse 多线程 ✓（daemon 见 PER-45）；无 key 早退 ✓ | P3 | S | | ⬜ |
| AG-74 | serve.py 错误分类 | 401/429 ✓；500/503 区分文案 | P2 | S | | ⬜ |
| AG-75 | serve.py 健康检查 | 无 /api/status：GET 返回 {key:bool,model}，UI 顶栏 key chip（绿/灰） | P1 | M | ⚠ 不回显 key | ⬜ |
| AG-76 | workbench 错误文案 | 「解析服务连接失败（超时）」✓；补建议动作（检查代理/重试） | P2 | S | | ⬜ |
| AG-77 | workbench 采纳后 | plan 持久 ✓ 重解析覆盖 ✓；无项 | P3 | S | | ⬜ |
| AG-78 | workbench 混合天体 | 复用匹配 celestial 已有天体时 transform 平面化 ✓ 统一走 planToOverrides；无项 | P3 | S | | ⬜ |
| AG-79 | docs | 解析链路无架构文档：docs/AGENT-PIPELINE.md（prompt→normalize→review→build→explain 数据流） | P2 | M | | ⬜ |
| AG-80 | serve.py prompt 长度 | ~1.5k tokens/次：紧凑化（删冗余空格）省 10-15% 输入 token | P2 | S | | ⬜ |
| AG-81 | workbench 图片重发 | 裁剪变更后 btnParse 直接可点 ✓；无项 | P3 | S | | ⬜ |
| AG-82 | workbench parseSrcBadge | 文字通道徽标 ✓；fixture 徽标 ✓；无项 | P3 | S | | ⬜ |
| AG-83 | explain.js telemetrySummary | 末态摘要 ✓；无项 | P3 | S | | ⬜ |
| AG-84 | explain.js 分派 | spring 判定 hasSpring（场景）而非 plan.kind：文字建 spring 无 attach 时 springLayout 兜底 ✓；无项 | P3 | S | | ⬜ |
| AG-85 | parse-schema momentum 布局 | 2D z 错开 0.12 默认 ✓（模型给 position 时尊重）；1D 检测 explain 层 ✓；无项 | P3 | S | | ⬜ |
| AG-86 | workbench joint 预览 | joint from/to 索引展示 ✓；拒绝联动 ✓；无项 | P3 | S | | ⬜ |
| AG-87 | workbench 建场失败可见性 | agentOps ✓/✗ ✓；失败汇总 toast（n 失败） | P2 | S | | ⬜ |
| AG-88 | parse-schema 复用物理 | 复用 patch 含 physics 全量（覆盖用户摩擦为题给）✓ 题意正确；无项 | P3 | S | | ⬜ |
| AG-89 | workbench explain unsupported | 不支持题型文案 ✓ 诚实；补当前遥测摘要 ✓ 已有；无项 | P3 | S | | ⬜ |
| AG-90 | 真实模型回归 | 7 类题图历史抽查（每类 1 次）：新 prompt+推断层下复验（预算 7 次调用） | P1 | M | ⚠ 调用预算 | ⬜ |
| AG-91 | parse-schema 输出规模 | entities>12 截断+提示：防长输出建出垃圾场 | P2 | S | | ⬜ |
| AG-92 | workbench 拍照通道 | 摄像头 BLOCKED（无硬件）记录 ✓；不重复投入；无项 | P3 | S | | ⬜ |

## 六、物理自由度与约束（PHY-1 ~ PHY-62）

| # | 位置 | 问题 → 改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| PHY-1 | runtime energyTotals | KE 无转动项（滚动球能量条走低假象）：+0.5·inertiaY·ω²（守恒条/曲线口径一致） | P1 | M | ⚠ p 系列能量断言数值变化 | ⬜ |
| PHY-2 | registry joints UI | 无图形化建约束入口：选中 2 实体 → 目录「约束」类（滑槽/转轴）卡（生成 e.joints 文档字段） | P1 | L | ⚠ UI+文档+undo 链路 | ⬜ |
| PHY-3 | workbench 检查器 | joints 不可见不可删：检查器「约束」组列出 e.joints+attach（类型/target/×删除） | P1 | M | | ⬜ |
| PHY-4 | scene-doc duplicateEntity | 副本 joints 指向原 target（复制转台控制原滑块）：复制时 joints 剥离+toast 说明 | P0 | S | | ⬜ |
| PHY-5 | workbench opRemoveEntity | 删除目标实体后悬空 joints/attach 留档：级联清理引用（删除时扫 attach 包含者一并删/ joints target 失效项剔除+toast） | P0 | M | ⚠ w6 删坡恢复场景 | ⬜ |
| PHY-6 | runtime hinge | jointAxis 固定 [0,0,1]：铰链实体 params.axis 可编辑（schema+runtime 读取） | P2 | S | | ⬜ |
| PHY-7 | registry spring | 弹簧视觉直杆（MAT-57 螺旋同源）：无独立物理项；Rapier spring joint ✓ | P3 | S | | ⬜ |
| PHY-8 | runtime rope | 绳张紧外可推（rope joint 语义）：教学可接受；文档注明；无项 | P3 | S | | ⬜ |
| PHY-9 | runtime rope | 无断裂：params.breakTension 可选（每步查张力差分超限删 joint）| P3 | M | | ⬜ |
| PHY-10 | registry spinLock | 隐藏物理标志无 UI：检查器「理想轴承」只读 badge（spinLock/gravitating/onPulley/onTrack 通用只读展示组） | P1 | M | | ⬜ |
| PHY-11 | registry noCollide | 仅 agent 铰链杆内部使用：检查器「参与碰撞」checkbox（noCollide 反义） | P2 | S | | ⬜ |
| PHY-12 | runtime 碰撞组 | noCollide 实现=碰撞组 0x0002 hack：常量化+注释（工程交叉） | P2 | S | | ⬜ |
| PHY-13 | workbench 冲量 | 无运行时踢一脚：检查器「施加冲量」（暂停态，沿视线方向 5 N·s，runtime.applyImpulse） | P2 | M | ⚠ 只编辑初速更符合文档驱动：改为写 linvel 增量+undo | ⬜ |
| PHY-14 | 运行态拖拽 | 无鼠标抓取（spring drag）：决策不做（破坏守恒演示可信度），记录 | P3 | L | | ⬜ |
| PHY-15 | registry ramp | 仅楔形：圆弧坡（四分之一圆挤压几何+凸包碰撞）决策 P3 | P3 | L | | ⬜ |
| PHY-16 | registry track | 中心线烘焙死（gen_track.py）：参数化轨道（入口高/环半径）P3 决策 | P3 | L | | ⬜ |
| PHY-17 | runtime onTrack | 仅球：box onTrack 不支持（约束半径语义）：决策不做，文档注明 | P3 | S | | ⬜ |
| PHY-18 | runtime pulley | 仅定滑轮：动滑轮/滑轮组 P3 决策（教学价值高但约束数学另起） | P3 | L | | ⬜ |
| PHY-19 | runtime atwood | 绳可视直穿滑轮（MAT-55 视觉项同源）：物理约束 ✓ 正确；无项 | P3 | S | | ⬜ |
| PHY-20 | registry light | 点光源不投影：可选 castShadow（性能 note）P3 | P3 | S | | ⬜ |
| PHY-21 | workbench 角速度读数 | liveGrid 无 ω：加「角速度 ‖ω‖」行（telemetry 已有 angvel） | P1 | S | | ⬜ |
| PHY-22 | workbench 质心 | 无质心可视化：选中实体显示质心标记（Group 按质量加权）P3 决策 | P3 | M | | ⬜ |
| PHY-23 | registry gravityScale | 范围 0~5 无负（上浮演示）：schema 扩 -2~5 决策（物理上 gravityScale 负=反向重力） | P3 | S | | ⬜ |
| PHY-24 | workbench 阻尼模型 | 仅线性阻尼：空气阻力 kv² 选项（自定义阻力系数 Cd·A·ρ 简化为 params.drag2）：P3 决策 | P3 | M | | ⬜ |
| PHY-25 | runtime CCD | 恒开（PER-27 联动）：策略化；无独立项 | P3 | S | | ⬜ |
| PHY-26 | runtime sleep | 刚体休眠致静止读数：forceSensor 称重场景已差分 ✓ 不受影响；暴露 body.sleep 验证 P3 | P3 | S | | ⬜ |
| PHY-27 | registry timer | 光门仅 x 平面：axis 参数（x/z/y）P2 | P2 | S | | ⬜ |
| PHY-28 | registry ruler | 仅距离：角度测量（三点）P3 决策 | P3 | M | | ⬜ |
| PHY-29 | sensors | 无加速度计：accelSensor（差分读数）P2 | P2 | S | | ⬜ |
| PHY-30 | workbench 单位制 | SI only：单位切换 P3 不做 | P3 | S | | ⬜ |
| PHY-31 | runtime spin slot | 限位止挡非弹性 ✓ 教学正确；弹性碰撞止挡选项 P3 | P3 | S | | ⬜ |
| PHY-32 | runtime _constrainAtwood | x/z 归位 home（导轨理想化）✓ 假设已记录；无项 | P3 | S | | ⬜ |
| PHY-33 | runtime 天体 | n 体 ✓ 通用；三体等 chaos 演示：预设「三体」P2 决策（教学价值） | P2 | M | | ⬜ |
| PHY-34 | workbench 守恒条 | rotation 模式仅 doc.kind==='rotation' 手动/agent 置位：检测转台 joints 自动置 kind（heuristic）P2 | P2 | S | | ⬜ |
| PHY-35 | registry 复合体 | 多 collider 单刚体（哑铃两球一杆）：组件「连接后合并」P3 决策 | P3 | L | | ⬜ |
| PHY-36 | runtime 摩擦组合 | min 注入策略 ✓（parse 层）；手动场景取平均语义在检查器 tooltip 说明 | P2 | S | | ⬜ |
| PHY-37 | explain 恢复系数 | AG-2 修正后与引擎一致 ✓；无独立项 | P3 | S | | ⬜ |
| PHY-38 | workbench 重力方向 | 仅 -y：斜置重力（向量）决策不做（教学场景罕用） | P3 | M | | ⬜ |
| PHY-39 | runtime 风场 | 无：风力区域实体 P3 决策 | P3 | L | | ⬜ |
| PHY-40 | registry celestial | 碰撞体存在但天体不互撞（纯引力）：视觉穿星演示可接受；merge 碰撞事件 P3 | P3 | S | | ⬜ |
| PHY-41 | runtime Lz 口径 | xz 平面 y 轴角动量 ✓ 与归一化层一致；无项 | P3 | S | | ⬜ |
| PHY-42 | workbench astro 周期 | ±π 跳变法 ✓ 稳；偏心率 (rmax-rmin)/(rmax+rmin) ✓ 近似注记已有 | P3 | S | | ⬜ |
| PHY-43 | runtime 步长 | 1/120 固定：质量档（1/60 轻量/1/240 高精度）P3 决策（守恒断言全挂风险大） | P3 | M | ⚠ 大 | ⬜ |
| PHY-44 | spin 滑块摩擦 | 槽内摩擦=0 题设：params 摩擦可调（默认 0）P3 | P3 | S | | ⬜ |
| PHY-45 | hinge 阻尼 | 转轴无摩擦选项：joint damping 参数 P3 | P3 | S | | ⬜ |
| PHY-46 | 电机 | 无角驱动电机（恒 ω 转台）：P3 决策（教学：对比守恒/驱动） | P3 | L | | ⬜ |
| PHY-47 | registry marker | 标记无文字：文本标注实体（canvas 贴图）P2 | P2 | M | | ⬜ |
| PHY-48 | workbench 轨迹导出 | trailsDump API ✓；CSV 导出按钮（曲线面板）P2（UI 交叉） | P2 | S | | ⬜ |
| PHY-49 | runtime 帧导出 | frames 录制无导出：JSON 下载 P3 | P3 | S | | ⬜ |
| PHY-50 | workbench 图快照 | 无视口截图按钮：renderer.domElement.toDataURL 下载（preserveDrawingBuffer 需开或渲染后同步截）P2 | P2 | S | | ⬜ |
| PHY-51 | 预置覆盖 | atwood m1 1.2/m2 1 vs 注释 2/1 不一致（注释错）：修正注释或参数一致 | P1 | S | ⚠ p 断言用 1.2/1 | ⬜ |
| PHY-52 | 预置 incline | 摩擦 0.3 非光滑（守恒条动量误差场景？p0 基线）✓ 设计如此；无项 | P3 | S | | ⬜ |
| PHY-53 | presets celestial | 近圆 5m/s ✓；椭圆预设（v=4 偏心演示）P2 决策 | P2 | S | | ⬜ |
| PHY-54 | presets classic | 环轨余量 32.8% ✓ 验证过；无项 | P3 | S | | ⬜ |
| PHY-55 | workbench 预置下拉 | 无「空场景」选项（btnNew 补位）：selPreset 加 empty 统一入口 | P2 | S | | ⬜ |
| PHY-56 | 文档向后兼容 | deserializeDoc version!==1 拒绝：迁移层 P3 决策 | P3 | M | | ⬜ |
| PHY-57 | workbench MECH API | setJoints 缺（updateEntity 可达）：显式 setJoints(id,[...]) 白名单化 P2 | P2 | S | | ⬜ |
| PHY-58 | runtime jointFailures | 失败记录 ✓ 可见；建场后 toast 汇总（AG-87 同源） | P2 | S | | ⬜ |
| PHY-59 | viewport jointViz | 运行态也画 ✓；多选全画 ✓；无项 | P3 | S | | ⬜ |
| PHY-60 | registry spin | spokes 4 ✓ 可视化转动的教学关键；辐条数可调 ✓；无项 | P3 | S | | ⬜ |
| PHY-61 | workbench 教学假设面板 | doc.meta.assumptions 无 UI 展示（存了看不见）：Agent 页「假设记录」折叠区（含 corrections） | P1 | M | | ⬜ |
| PHY-62 | runtime 恢复系数上限 | restitution≤1 schema ✓；极端组合（1+1 完全弹性+高速）能量发散：CCD ✓ 兜底；无项 | P3 | S | | ⬜ |

## 七、代码与工程健康（ENG-1 ~ ENG-70）

| # | 位置 | 问题 → 改法 | P | 量 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| ENG-1 | viewport.js | setHighlights 定义两次（L464/L778 重复体）：删一处 | P0 | S | | ✅ B2：删重复 setHighlights |
| ENG-2 | viewport.js setPersp | 死赋值/无操作行（controls.object 双写、target.copy(target)）：清理 | P0 | S | | ✅ B2：setPersp 死赋值随函数删除 |
| ENG-3 | viewport.js setProjection/setPersp/toggleProjection | 三函数逻辑重叠（仅 toggleProjection 被用）：保留 toggle+resize 修复，其余删或合并 | P0 | S | | ✅ B2：setProjection/setPersp 删除，toggleProjection 唯一入口 |
| ENG-4 | workbench.js setTensions | 死函数（无调用方）：删除 | P0 | S | | ✅ B1：删死函数 setTensions |
| ENG-5 | parse-schema.js | 注释「抛体布局」重复两行+hasSpringAttach 未用变量：清理 | P0 | S | | ✅ B1：删重复注释/未用变量 |
| ENG-6 | workbench.js M 命名 | applyAgentPlanInner 内 const M=window.MECH 遮蔽外层材质 M：重命名 MECHApi | P1 | S | | ⬜ |
| ENG-7 | workbench.js renderExplanation | renderMomentum2DExplain 声明嵌在函数体中段（早退 return 之后，靠 hoisting）：移到顶层 | P1 | S | | ⬜ |
| ENG-8 | check.py | 只查 p0-p14 存在：扩到 p0-p31+w1-w7+OPT 文档 | P1 | S | | ✅ B1：存在性扩到 p0-p31+w1-w7+docs |
| ENG-9 | check.py | 未扫 tools/ui-test 泄漏：SECRET_PATTERNS 扫测试目录 | P1 | S | | ✅ B1：测试目录扫密值模式（允许文件名编排） |
| ENG-10 | check.py | 材质键契约（MAT-59）：MATERIAL_OPTIONS 与 materials.js 返回键 diff | P1 | S | | ✅ B1：材质键契约检查 |
| ENG-11 | tools/ui-test | helper 重复（goto/shot/ctx 每份复制）：抽 lib.mjs 共享（不动现有绿测，仅新测使用） | P2 | M | ⚠ 回归面大 | ⬜ |
| ENG-12 | tools/ui-test | 端口硬编 8721：MECH_URL env 读取（默认 8721） | P2 | S | | ⬜ |
| ENG-13 | serve.py | daemon_threads 未设：ThreadingHTTPServer(..., daemon_threads=True)（Ctrl+C 干净退出） | P1 | S | | ⬜ |
| ENG-14 | serve.py | 静态请求日志刷屏（PER-29 同源）：log_message 静默非 API | P1 | S | | ⬜ |
| ENG-15 | index.html ?v=1 | 手工版本号：serve.py no-store 已兜底；删除 ?v=1（少一处必改点） | P2 | S | | ⬜ |
| ENG-16 | 无 lint | 无 ESLint：加最小 no-unused-vars/no-undef 扁平配置+package.json script（不引入框架） | P2 | M | | ⬜ |
| ENG-17 | 无 pre-commit | check.py 手跑：.git/hooks/pre-commit 调 check.py（本地钩子不进库+README 说明） | P2 | S | | ⬜ |
| ENG-18 | workbench.js 体量 | 3184 行单文件：拆 agent-panel.js/overlays.js/mech-api.js（模块边界已有注释分区）P2 择机（回归成本高） | P2 | L | ⚠ 大重构风险 | ⬜ |
| ENG-19 | 无根 package.json | 无 scripts 入口：根 package.json（serve/test/check 三脚本，npm.cmd 调用） | P2 | S | | ⬜ |
| ENG-20 | deserializeDoc | 坏 type 直接 rebuild 崩到 errbar：实体级校验（type in registry）+跳过+警告行 | P1 | M | | ⬜ |
| ENG-21 | workbench rebuildAll | rebuild 异常无兜底：try/catch 回滚前 doc+errbar（保护 undo 后状态） | P1 | M | | ⬜ |
| ENG-22 | history label | 空 label 批（assignGroup '' 传入）：统一默认标签「批量修改」 | P2 | S | | ⬜ |
| ENG-23 | newId | Date36+seq ✓；无项 | P3 | S | | ⬜ |
| ENG-24 | 命名规范 | M（材质）/doc/mode 等过短全局：仅新代码规范，旧名不动（回归成本） | P3 | S | | ⬜ |
| ENG-25 | JSDoc | MECH API 无类型注解：JSDoc 注释 key 方法（自文档化） | P2 | M | | ⬜ |
| ENG-26 | node 单测 | parse-schema/explain/scene-doc 纯模块：test/unit/*.test.mjs node --test（AG-50/51 载体） | P1 | M | | ✅ B1(部分)：test/unit 落地；scene-doc 单测未做 |
| ENG-27 | 测试 waitForTimeout | 402 处固定等待（headless 抖动隐患）：仅对新增/翻红用例改 waitForFunction（全量替换回归成本不可控，记录债） | P3 | L | ⚠ 债务管理 | ✅ B2(部分)：p8/w1-A5 固定 sleep 改 waitForFunction（p23 先例） |
| ENG-28 | shots 目录 | 磁盘增长：测试 runner 前清 shots/w* 子目录（git 已忽略） | P2 | S | | ⬜ |
| ENG-29 | serve.py 重启编排 | w3 杀服场景重启复杂：runner 脚本 ensure-server（netstat 探活+按需起）| P2 | M | | ⬜ |
| ENG-30 | README | 优化后同步：测试章节补 w 系列与 unit、运行方式 | P1 | S | | ⬜ |
| ENG-31 | LEDGER | Round 36 记录：本台账+批次实施摘要 | P1 | S | | ⬜ |
| ENG-32 | AUDIT-MATRIX | 证据级别刷新（优化批次对应能力行） | P1 | S | | ⬜ |
| ENG-33 | git 钩子部署 | pre-commit 写入 .git/hooks（不跟踪）：install.cmd? 手动说明即可 | P3 | S | | ⬜ |
| ENG-34 | vendor 升级路径 | r186/r0.21 pin：README vendor 章节（升级 checklist：TransformControls getHelper 等） | P2 | S | | ⬜ |
| ENG-35 | gen_track.py | 再生成轨道说明：README 工具节 | P3 | S | | ⬜ |
| ENG-36 | classic.html | legacy 冻结声明 ✓ README；无项 | P3 | S | | ⬜ |
| ENG-37 | console.log 清扫 | explain.js 2 处+全局 grep：生产路径零 console（warn 保留） | P0 | S | | ✅ B1：console.log 清零（warn 保留） |
| ENG-38 | CSS 冗余 | 未用选择器审计（.tri input width:0 是坑修复必需保留）：仅删确认死规则 | P3 | S | | ⬜ |
| ENG-39 | 内联样式迁移 | UI-67/68/69 批量迁 CSS 类（50+ 处 cssText）：分批 | P2 | M | | ⬜ |
| ENG-40 | workbench 全局态 | 30+ 模块级 let：状态对象收拢（state.）P3 决策（可读性 vs churn） | P3 | L | | ⬜ |
| ENG-41 | 事件解绑 | init 一次性绑定 ✓ 无泄漏面；window listeners（pointermove×2/resize/keydown）常驻合理 | P3 | S | | ⬜ |
| ENG-42 | fetch 错误吞噬 | catch(e) 无日志 3 处（parse 链）：console.warn 补（不进 UI） | P1 | S | | ⬜ |
| ENG-43 | serve.py _extract_json | 双启发式 ✓ 有测试否：unit py 测（思考流样例）P2 | P2 | S | | ⬜ |
| ENG-44 | serve.py 超时异常类型 | TimeoutError vs socket.timeout（py 版本差异）：urllib.error.URLError 包裹判定 | P2 | S | | ⬜ |
| ENG-45 | check.py node 依赖 | node 不在 PATH 时 fail 信息明确 ✓ subprocess 返回码处理 ✓；无项 | P3 | S | | ⬜ |
| ENG-46 | 场景文件扩展名 | .mechanica.json 双后缀 ✓ 防误开；无项 | P3 | S | | ⬜ |
| ENG-47 | MECH dbg 通道 | __vp/__rollDbg/dbg ✓ 诊断专用命名；无项 | P3 | S | | ⬜ |
| ENG-48 | selftest | ✓ 存在；boot console 提示（FEEL-92） | P3 | S | | ⬜ |
| ENG-49 | localStorage 键 | 常量集中（AUTOSAVE/RECENT/FAV 散落）：KEYS 对象 | P2 | S | | ⬜ |
| ENG-50 | 时间格式 | ISO toISOString ✓；无项 | P3 | S | | ⬜ |
| ENG-51 | git 工作流 | 单分支直提 ✓ 项目规模合适；无项 | P3 | S | | ⬜ |
| ENG-52 | 提交粒度 | 一批一 commit 规范 ✓（本轮执行） | P3 | S | | ⬜ |
| ENG-53 | 依赖审计 | playwright 版本 pin ✓ package-lock；无项 | P3 | S | | ⬜ |
| ENG-54 | 密钥轮换 | step_key.txt untracked ✓；.gitignore 已含 tools/server/ ✓；无项 | P3 | S | | ⬜ |
| ENG-55 | console.warn 噪音 | 材质缺失 warn ✓ 合理；无项 | P3 | S | | ⬜ |
| ENG-56 | viewport 材质引用 | runtime M 引用 ✓ 注入式；无项 | P3 | S | | ⬜ |
| ENG-57 | registry schema | min/max/step 声明式 ✓；kind 扩展（slider FEEL-25）文档化 | P2 | S | | ⬜ |
| ENG-58 | presets 结构 | builder ✓ 与 UI 同路径；无项 | P3 | S | | ⬜ |
| ENG-59 | explain 返回结构 | kind 分支 ✓ 扁平字段；无项 | P3 | S | | ⬜ |
| ENG-60 | 文档交叉引用 | README↔AUDIT-MATRIX↔本台账链接互链 | P1 | S | | ⬜ |
| ENG-61 | 测试截图断言 | w 系列截图人工核验流程说明（AUDIT-MATRIX 已有）✓；无项 | P3 | S | | ⬜ |
| ENG-62 | unit 测试进 check.py | check.py 挂 node --test 聚合（一键全绿入口） | P2 | S | | ⬜ |
| ENG-63 | runner 汇总 | 批次回归结果落盘 tools/ui-test/last-run.txt（时间/套件/断言数） | P2 | S | | ✅ B1(部分)：run-all.mjs 落地；last-run 机制启用 |
| ENG-64 | 错误消息规范 | errbar/toast/parseStatus 三通道语义（致命/操作/流程）文档化注释 | P2 | S | | ⬜ |
| ENG-65 | workbench bindUI 体量 | bindUI 90 行 ✓ 可读；无项 | P3 | S | | ⬜ |
| ENG-66 | 重复 G 检查 | _collectGravitating G falsy 早退 ✓（G=0 教学无引力场景退化警告 P3） | P3 | S | | ⬜ |
| ENG-67 | parse-schema 体量 | 474 行 ✓ 分区注释清晰；无项 | P3 | S | | ⬜ |
| ENG-68 | serve.py 体量 | 228 行 ✓ 单文件合适；无项 | P3 | S | | ⬜ |
| ENG-69 | OPT 台账维护 | 本文档批次勾选+一行结果纪律（执行中） | P1 | S | | ⬜ |
| ENG-70 | 台账编号引用 | commit message 引用条目号（PER-x/AG-x）可追溯 | P1 | S | | ⬜ |

## 统计与批次计划

- 总计 **550 条**：性能 82 / UI 88 / 材质 64 / 手感 92 / Agent 92 / 自由度 62 / 工程 70。
- P0 共 ~40 条（本轮必做），P1 ~110 条，P2 ~180 条，P3 ~220 条（含「决策不做/记录」项，防止重复讨论）。
- 实施批次：B1 Agent 正确性（AG-1~7/29/55 + ENG-37）→ B2 热路径性能（PER-1/2/3/4/11/21 + PER-70）→ B3 Agent 建场性能与鲁棒（PER-5 + AG-38/39/40/46/72）→ B4 手感快赢（FEEL-1/3/9 + UI-23/75 + PHY-4/5）→ B5 材质共享与光影（MAT-2/3/4/5/6/16 + PER-42）→ B6 UI 补全（UI-3/4/16/48/49/56/61/83）→ B7 工具链（check.py 扩展/unit/runner）。P2/P3 视余量推进，每批全量回归绿后 commit。

