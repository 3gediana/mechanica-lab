# MECHANICA · 物理教学工作台

浏览器里的 Agent 驱动物理沙盒工作台：真实刚体引擎（Rapier WASM）+ PBR 摄影棚渲染（three.js + HDRI + ACES）。
当前处于 **P0 通用工作台内核** 阶段：场景文档驱动、组件可增删改、真实物理演化、可保存恢复。
原固定轨道演示保留在 `classic.html`（见下）。

## 运行

物理引擎经 ES module 加载，必须走本地 http 服务（file:// 会被 CORS 拦）：

```
cd D:\mechanica-lab
python tools/serve.py            # 或 python -m http.server 8721
# 浏览器打开 http://127.0.0.1:8721          ← 工作台
#            http://127.0.0.1:8721/classic.html ← 原轨道演示（保留版）
```

## 工作台（index.html）

```
顶栏    新建 / 预置场景 / 保存 / 打开 / 撤销重做 / 移动·旋转 gizmo / 吸附 / 全局·顶·前·侧·聚焦
左栏    组件目录（球·方块·圆柱·斜坡·地面板）+ 场景对象大纲
中央    3D 视口：点选、gizmo 拖动、滚轮缩放、左键拖转视角
右栏    属性检查器 + Agent 解析（标签页切换）
底栏    运行 / 暂停 / 单步(1/120s) / 重置 / 时间倍率 / 模拟时间 / 选中对象读数
```

- 键盘：`Space` 运行/暂停 · `W/E` 移动/旋转 gizmo · `F` 聚焦 · `R` 重置 · `Del` 删除 · `Ctrl+Z/Y` 撤销重做 · `Ctrl+S` 保存 · `Ctrl+D` 复制
- 场景自动保存到浏览器 localStorage；保存按钮下载 `.mechanica.json`，打开按钮载入
- 编辑态改参数即时重建物理世界；运行态参数只读；重置 = 从场景文档全量重建回初始态

## Agent 题目解析（P1 切片）

右栏"Agent 解析"标签：上传题图 → `POST /api/parse-question`（step-5-preview 视觉模型）→
结构化解析（题型/实体/物理量/单位/置信度/未知量/假设）→ 用户逐项检查修正 → 确认后经白名单 API 创建真实场景实体 → 运行真实物理。

- **密钥纪律**：key 只在服务端（环境变量 `MECHANICA_STEP_KEY` 或未跟踪文件 `tools/server/step_key.txt`），前端代码/Git/日志零出现（check.py 有泄漏扫描红线）
- 无 Key 时可点"载入本地示例解析数据"（fixture，明确标注非真实模型输出）验证后续物理链路
- 解析给出的值带"题给"徽标，Agent 补的默认值带"默认"徽标；用户修改会记录进场景文档 `meta.corrections`
- 建场统一走 `window.MECH` 白名单 API（与组件目录同一路径），实体来源标 `agent`

## 架构（src/engine/）

| 模块 | 职责 |
|---|---|
| `scene-doc.js` | 版本化 JSON 场景文档（实体/变换/物理/材质/来源），快照式撤销重做 |
| `registry.js` | 组件注册表：几何构建 + 碰撞构建 + 参数 schema（单位/范围/校验）。新组件只在此登记 |
| `runtime.js` | 文档 → three 网格 + Rapier 刚体全量重建；固定步长 1/120s；每帧步数上限 + 背压丢弃；碰撞事件；遥测 |
| `viewport.js` | 视口：点选 / gizmo（TransformControls r186）/ 吸附 / 聚焦 / 三视图 |
| `presets.js` | 预置场景（空场景、斜面小球），与 UI/Agent 同一条 createEntity 路径 |
| `parse-schema.js` | 题图解析结果零信任规范化 + 建场计划（planToOverrides） |
| `workbench.js` | UI 接线 + `window.MECH` 白名单编程接口（组件/变换/物理/重力/解析元数据） |

物理与视觉分离：每个实体 = 渲染网格 + 碰撞形状 + 质量动力学参数 + 刚体类型（动态/固定/仅视觉），全部可序列化。

## P0/P1 验收（tools/ui-test/）

```
cd tools/ui-test && npm i && node p0.mjs   # P0 工作台内核 19 项
                            node p1.mjs   # P1 解析切片 13 项（需 8721 服务与有效 Key）
```

## 经典演示（classic.html）

Round 0 的铬钢球钻环场景原样保留：大理石半管滑道（C1 连续参数面 + 管道中心线解析约束）、抽开式挡板、
弹簧-阻尼抓取抛掷、轻绳单摆周期测量、土星展台（Solar System Scope CC-BY 贴图）。`?run=1` 自动演示通道保留。
README Round 0 版本描述的轨道物理细节以该页与 `src/track-curve.js` 注释为准。

## 技术

- three r186 + Rapier 0.21（WASM，固定步长 1/120s 确定性），全部 vendor 本地化，断网可跑
- TransformControls 来自 three 官方 examples（MIT），已入 vendor
- 材质 PBR：ambientCG CC0 大理石/橡木，Poly Haven CC0 HDRI；贴图缺失自动降级

## 自检

```
python tools/check.py     # vendor 完整性 / 入口指向 / JS 括号 / DOM id 交叉 / 契约字段 / 文案红线
```

## 授权

- 代码：本项目自有；three.js MIT；Rapier Apache-2.0
- HDRI / PBR 贴图：Poly Haven、ambientCG（CC0）；行星贴图：Solar System Scope（CC BY 4.0）
