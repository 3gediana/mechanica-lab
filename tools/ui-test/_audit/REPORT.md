# ux-audit 报告 — MECHANICA 物理教学工作台（2026-10-07，commit b70725b 后工作区）

═══════════════════════════════════════════════════════════
VERDICT: Conditional Pass（3 真 finding，全部当场修复+实证；1 allowlist）

Persona: 大学物理老师，课间 10 分钟备课（解析题目→演示→导数据）；首用视角强制过
Surfaces audited: 单页应用 5 线程（备课主链/手工搭建/预置+运行态/键盘帮助/真实模型全链）
Interaction Manifest: complete（5 份，共 50 条，带时间戳与选择器）

Hard Gates: console errors [0], warnings [0 报告able + 4 allowlisted(WebGL GL Driver=本机驱动噪音)],
network 5xx [0 报告able + 1 已解释(parse-patch 首连上游抖动,客户端自动重试覆盖,重试成功)],
layout-collapse [0]
Performance: 未跑 LCP/CLS/INP（单页 WebGL 应用,超出演示预算口径）

Findings:
  Critical: 0    High: 1（F1）    Medium: 1（F2）    Low: 1（F3）

Self-critique pass: Drafted: 5  Kept: 3  Generic: 0  Duplicate: 2（连撤2→2与Delete删除两题为探针失手,
非应用行为——搜索框焦点与 MECH.select 通道误用,复验后撤销/删除实际正常）

TOP 3（按影响×易修排序）:
  1. [F1] 双击「创建场景实体」翻倍连接件 — 建场无幂等，双击=2 根弹簧，老师最常犯的操作
  2. [F2] 目录搜索「斜面」找不到「斜坡」 — 教师词汇与卡片标签不一致，首用者卡死点
  3. [F3] 搜索框焦点残留吃掉 Ctrl+Z — 文本撤销抢先于场景撤销
═══════════════════════════════════════════════════════════

## Findings 详情（全部已修复）

### F1 (High · Interaction) 双击建场翻倍
- **Reproduce**: 任意场景 → Agent 页签载入示例（spring）→ 双击「创建场景实体」
- **Observed**: n=6、弹簧 2 根；**Expected**: n 不变、弹簧 1 根
- **Evidence**: t23 manifest `[✗] btnApplyParse 双击 {"n":6,"springN":2}`
- **Root cause**: ① applyAgentPlan 无重入锁（vivid 分批 await 期间可交错重入）② agentPlanApplied 有置位但入口不检查 ③ agentPostPass 连接件无条件新建，从不查同端对
- **Patch**: 入口 in-flight 锁 applyAgentBusy + 连接件端对去重（同类型+同 attach 对=跳过，记「连接已存在」）
- **Fix-verify**: p37 F1/F2 断言（双击/三击后 springN===1）16/16 绿

### F2 (Medium · 首用视角) 搜索词汇不匹配
- **Reproduce**: 目录搜索「斜面」→ 无匹配组件
- **Observed**: 卡片叫「斜坡」，教师输入「斜面」空手而归；**Expected**: 别名命中
- **Evidence**: t23 manifest `[✗] 搜索+添加「斜面」没找到卡片`
- **Patch**: CATALOG_SEARCH_ALIAS 双向别名表（斜面↔斜坡/小球→球/物块→方块/滑轮↔定滑轮/绳子→绳）+ catalogItemMatches
- **Fix-verify**: t4 实证「斜面」命中「斜坡」、「小球」命中球类

### F3 (Low · 键盘) 搜索框焦点残留
- **Reproduce**: 搜索框输入→点卡片加件→Ctrl+Z
- **Observed**: 焦点仍在搜索框，Ctrl+Z 走文本撤销，场景无变化；**Expected**: 撤销掉刚加的实体
- **Patch**: 目录行点击加件后 blur 搜索框
- **Fix-verify**: t4 实证 activeElement 离开 + Ctrl+Z 1→0

## Allowlist（非应用 bug）
- WebGL `GL Driver Message ... GPU stall due to ReadPixels`：RTX 5060 驱动已知问题（本机在案），非应用代码产生。
- `/api/parse-patch` 首次调用 502：上游模型瞬时抖动；生产客户端 isRetryableParseError 自动重试一次已覆盖（curl 重试即成功）。

## 真实模型 E2E（AG-V3 首次真调）
- parse-patch 直调：模型修订**正确**——补地面承接、题给 30m/s 与 2kg 一字未动、假设注明「题目无地面，按沙盒约定补 y=0 地面」。
- UI 全链：真实解析（11s，置信 95%）→ 建场 → 自查 4✓0⚠0✗ → 修订 0 轮 → 解释 513 字 → CSV 56 行。console 零错误。

## Hold this in your hands
把 MECHANICA 拿在手里像一件顺手的教具：目录搜索能听懂老师的话、点错了不会留下重复的弹簧、键盘undo落在你心里想的那个层面上。三个修复都是「已经顺手」级别的——这轮之后，它从"演示时不敢让同学乱点"变成"随便点"。
