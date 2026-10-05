# MECHANICA 快捷键矩阵（FB-72）

纪律：每批新增键位必须过此表登记（冲突检查），并同步 index.html 帮助浮层。

## 已用键位

| 键 | 动作 | 落点 |
|---|---|---|
| 空格 | 运行/暂停（focus 守卫：INPUT/SELECT/TEXTAREA/IME 让路；按钮点击后 blur 防双激活 FB-66） | workbench onKey |
| Shift+空格 | 慢动作 0.1x <-> 原倍率（FB-25） | onKey |
| 1 / 2 / 3 | 时间倍率 0.5x/1x/2x（FB-23） | onKey |
| R | 重置到初始态 | onKey |
| W / E | gizmo 移动/旋转 | onKey |
| F | 聚焦选中 | onKey |
| Delete / Backspace | 删除选中 | onKey |
| 方向键 | 微调选中位置（Shift=1m；仅编辑态） | onKey |
| Esc | 级联：帮助→框选→ghost→（规划中：gizmo reset/清空选择） | onKey |
| ? | 帮助浮层 | onKey |
| Ctrl+Z / +Shift+Z / +Y | 撤销/重做（运行态先 resetSim 再执行 FB-40） | onKey |
| Ctrl+S / Ctrl+D | 保存/复制 | onKey |
| Ctrl+V | 粘贴题目图（Agent 页） | workbench paste |
| Ctrl+A | （规划 FZ-37）全选未锁定 |

## 拟用键位（台账规划，落地前在此登记）

| 键 | 规划 | 台账条目 |
|---|---|---|
| G | 吸附档位循环 | FZ-8 |
| B | 推土机批量删除模式 | FZ-11 |
| T | 缩放 gizmo | FEEL-111 |
| L | gizmo 局部/世界空间 | FZ-63 |
| C | 相机跟随选中体 | FZ-43 |
| Home | 回全局视角 | FZ-41 |
| X | 删除选中（Delete 并列） | FB-73 |
| [ / ] | ghost 放置预览旋转（原 Q/E 与 gizmo 旋转冲突，FB-64 定案改 [ ]） | FZ-2 |
| . | 暂停态单步 | FEEL-112 |
| 回放中 ←/→ | 回放帧步进（需 replayBar 焦点守卫 FB-65） | FEEL-135 |
| Alt+点击 | 吸取工具 | FZ-10 |

## 浏览器保留（避开）

Ctrl+T/N/W（标签页）、Ctrl+1..9（标签切换——视角书签 FZ-39 因此用 Shift+数字 存、数字取）、F5/F12、Ctrl+P。
