# UI 全面重设计施工图（Round 43，已执行完毕——本档留作红线清单与图标映射存档）

> 状态：✅ 已落地并过视觉门（3 轮）+ 全量回归 ALL GREEN + units 106/106。台账见 OPTIMIZATION-R4-PLAY.md Round 43。

用户判词：「现在的 UI 实在太丑，没有设计感，一堆按键的堆砌，没有工作台的感觉」。
方向已定：**精密仪器暗色工作台**（Blender/Fusion 的 chrome 感），按铁律先样张后铺开。

## 已完成的审计（勿重做）

- before 样张：`tools/ui-test/_ui-sample/before-scene.png`（斜坡+球场景）、`before-agent.png`（Agent 页签），1600×900。
- 截图脚本：`tools/ui-test/_ui-sample/shot.mjs`（MECH_BASE=8722）。
- 病灶：顶栏三段 24 个同权重中文文字按钮（letter-spacing 拉开）、底栏 16+ 文字按钮、
  主操作（运行）无视觉重量、面板焊死四边无呼吸、全站无图标系统、grp 段落节奏单调。

## 测试红线（违反必炸回归）

1. **保文字的按钮**：`#btnSnap`（textContent 必含 网格/端点/表面/中心，p11/p24 读它）、
   `#btnSound`（=== '静音' 精确相等，p33）、`#btnMic`（含 '口述中'，p44）。
   → 这三个做图标+`<span>` 组合时，**JS 改文案必须只改 span**（改动前先 grep 这三个 id 的赋值处，
   上次查 `btnSnap|btnSound|btnMic + textContent` 无输出=赋值可能在别处或用 label 属性，续工时先确认）。
2. **保类名语义**：`hot`（13 处断言）、`on`（7 处）、`gone`、`primary`。只换视觉不改机制。
3. 文字定位只打动态内容（`.comp-item`/`.frow label`/`.ol-row`/`.pe-row`）——顶栏/底栏可放心图标化。
4. 面板宽度别动：`--left-w:208px / --right-w:292px` 保持（p24 等按屏幕坐标扫视口，变宽可能扫进面板底下）。

## 设计系统定案

- Token：bg0 #0b0c0e / 岛面板 rgba(18,20,24,.96) / 提升面 #17191f / 输入底 #0c0e11；
  hairline .06/.14；tx0 #eceae4 / tx1 #a6acb5 / tx2 #71767f；accent 保琥珀 #d9a441（品牌色，favicon/皮带纹理已用它）；
  danger #d0806d。**旧 token 名（--text/--dim/--faint/--line/--accent-dim/--panel-solid/--mono…）全部别名保留**
  ——workbench.js 里 23 处内联样式引用旧名，别名化后 JS 几乎零改动。
- 形状锁：控件/输入 4px，岛面板/浮层 10px，状态 chip/badge 999 药丸。
- **浮动岛布局**：左右面板改 8px 离缝浮动岛（radius+边线+双层影），视口四边透气——这是「工作台感」最大的一刀。
  不用 backdrop-filter（WebGL 常驻动画上模糊是 GPU 坑，5060 驱动本就不稳）。
- 顶栏 44px/底栏 48px 轨道；`.tb-group` 改「工具托盘」：淡底+hairline+6px 圆角+2px 内衬，内部按钮 4px 圆角浮起。
- 图标：Tabler outline（MIT），stroke 2，16px 显示。46 个 SVG 已抓到 **`_ui-sample/tabler-svg/`**（tmp 会被关机清掉，已搬进仓库）。
- 主操作：运行 = 琥珀实底药丸+播放图标（全站唯一实底按钮）；`.hot` 切换态 = 琥珀图标+13% 琥珀底+hairline。

## 图标→按钮映射

新建 file-plus / 保存 device-floppy / 打开 folder-open / 撤销 arrow-back-up / 重做 arrow-forward-up /
移动 arrows-move / 旋转 rotate / 缩放 arrows-maximize / 吸附 magnet(+文字) / 正交 cube / 网格 grid-dots / 框选 marquee /
perf activity / 运行 player-play / 暂停 player-pause / 单步 player-track-next / 重置 refresh /
矢量 vector / 受力 arrows-vertical / 分解 arrows-split-2 / 轨迹 route / 曲线 chart-line / 守恒 scale /
录制 circle-dot / 回放 history / 音效 volume-2(+文字) / 震屏 wave-sine / ? help / 截图 screenshot /
口述 microphone / 拍照 camera / 解析 sparkles / 搜索 search / 关闭 x / 创建 circle-plus / 导入 upload / 导出 download / 副本 files / 删 trash / 眼珠 eye+eye-off。
全局/顶/前/侧/聚焦保留单字文字 chip（视图组保持可读性）。

## 续工顺序

1. grep `btnSnap` 等三钮的 JS 文案赋值处 → 需要则改成改 span。
2. 生成 sprite（`_ui-sample/tabler-svg/*.svg` → `<symbol id="i-*">`，剥 width/height/class）插 `<body>` 顶。
3. 重写 index.html `<style>` 整块（~600 行，覆盖现全部选择器+新类）；HTML 各块 Edit：
   topbar/simbar 按钮图标化、catalogSearch/outlineSearch 套 .searchbox、fixtureSel/textarea/按钮内联样式改类、
   sceneLib 弹层内联→类、olCount 并进 panel-title（现 472-473 行「场景对象」标题重复出现两次，顺手修）。
4. after 样张（同 shot.mjs）→ 视觉验收（documents:visual-judge 或自看）迭代 2-3 轮。
5. 全量回归 run-all.mjs（38 套，~870s）→ 修 → 提交 r4-play。
6. 台账 docs/OPTIMIZATION-R4-PLAY.md 记 Round 43 + 记忆文件更新。
