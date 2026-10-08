# R5 UI 轨道调研全表(UI-501~620,120 条)

来源:UI 调研 agent(2026-10-08)。

核查完毕。以下为最终产出。

实核文件:`D:\mechanica-lab-r4\index.html`(1180 行全文:CSS token、顶栏/左右岛/simbar/浮层族结构)、`D:\mechanica-lab-r4\src\workbench.js`(5515 行中逐段读约 40 个 UI 函数:toast/saveFile/bindUI/renderCatalog/renderOutline/renderInspector/numRow/triRow/updateSimbarStatic/renderLibrary/setParseStatus/buildChangePreview/renderParseResult/renderAgentVerify/runAndExplain/renderExplanation/updateConsbar/updateReadouts/drawCurves/updateScaleReadout/录制回放/onKey/tickPerfHud)。
另核 `D:\mechanica-lab-r4\src\engine\viewport.js` 的 hover 三态/ghost/_surfaceRide/renderMaterialSwatches 段。
对照 `D:\mechanica-lab-r4\docs\UX-DETAILS-R4.md`(D1-D150)去重:D 系列已实装项不重列；全部改动不触硬约束(不动 208/292、不加 backdrop-filter[两条建议为移除现有违例]、不删三处受保护文案、不改 id 与 .hot/.on 语义)。

| 编号 | 位置(选择器或函数) | 问题 → 改法 | 优先级 | 体积 |
|---|---|---|---|---|
| UI-501 | `saveFile()` workbench.js:1128-1131 操作 `#btnSave` | `bs.textContent='已存'` 直写按钮——btnSave 内只有 svg 无 `.lab` span,首次保存后软盘图标被抹掉、900ms 后复原为空字符串=永久空钮 → 改走 `setBtnText` 或缓存/还原 `innerHTML` | P0 | S |
| UI-502 ✅B1b | `#topbar .brand h1` `letter-spacing:.3em` | 尾字符后多出 .3em 空隙，品牌与右侧场景名间距失衡 → 补 `margin-right:-.3em`(`.sub` 同理 -.12em) | P2 | S |
| UI-503 ✅B1b | `#sceneName` 固定 `width:136px` | 长场景名截断且无悬停全名 → onchange/onfocus 同步 `title=input.value`,宽 celebrities 不动 | P1 | S |
| UI-504 ✅B1c | `.dirty-dot` `display:none↔inline-block` 硬切 | 脏点出现/消失无过渡、视线易漏 → 改 `.on` 类控 opacity+scale(.5→1) 120ms,display 保持 | P2 | S |
| UI-505 ✅B1c | `#dirtyDot`(HTML 裸 span) | 可点击=保存但无 role/tabindex,键盘不可达 → 加 `role="button" tabindex="0" aria-label="保存到场景库"`+Enter/Space 触发 | P1 | S |
| UI-506 ✅B1d | `.tb-group select`/`#simbar select` `appearance:none` | 去掉原生箭头又无替代指示，不像可下拉 → 右侧内嵌 8px chevron data-URI 背景(--faint 色)+padding-right 18px | P1 | S |
| UI-507 ✅B1d | `#linkClassic` `color:var(--faint)` 10px | 常态对比踩 --faint 下限、又是唯一页外导航 → 常态提为 var(--dim),hover 已有 | P2 | S |
| UI-508 ✅B1c | `#btnViewReset/Top/Front/Side` 纯文字 tbtn | 点击后无任何反馈，不知视角已切 → 点击瞬间加 `.hot` 120ms 后移除的脉冲反馈 | P2 | S |
| UI-509 ✅B1d | `#modeChip` `.chip.run` 与 `#modeChip.grab` 同为琥珀实底 | 子弹时间复用 grab 反白样式与运行态不可分 → grab/子弹态加 `box-shadow:inset 0 0 0 1px rgba(217,164,65,.7)` 区分 | P2 | S |
| UI-510 ✅B1d | `.tbtn`(高 26px 于 44px 顶栏) | 图标钮热区偏小，触屏/手准度差 → 不改外观，加 `position:relative` + `::after{inset:-4px}` 扩热区 | P2 | S |
| UI-511 ✅B1b | `refreshHistoryButtons()` | undo/redo disabled 时 title 只剩「撤销」，不知为何禁用 → disabled 时 title=「没有可撤销的操作」/「没有可重做的操作」 | P2 | S |
| UI-512 ✅B1d | `#selPreset` onchange 即载入+回占位 | Windows Chrome 关闭态下拉方向键每移动一项就触发 change=连续 applyDoc 重建世界 → select keydown 拦方向键手动移 selectedIndex,Enter 才触发载入 | P1 | M |
| UI-513 ✅B1b | `#catalogList` 底部(已知线索) | 可滚但底缘无任何渐隐暗示，最后半张卡像被裁断 → 容器 `mask-image:linear-gradient(180deg,#000 calc(100% - 24px),transparent)` | P1 | S |
| UI-514 ✅B1d | `.comp-item` `transition transform .15s` | 与全站 120ms 基准不一致(lib-card 同病) → 统一 .12s | P2 | S |
| UI-515 ✅B1d | `renderCatalog()` 搜索区 `.cat-head`「搜索结果」 | 无命中计数，不知匹配了几张 → 「搜索结果(N)」复用 `.ol-count` 弱化样式 | P2 | S |
| UI-516 ✅B1d | `#catalogSearch` | 有词后清除只能全选重打(Esc 需焦点在框) → 框内右侧 13px `i-x` 清除钮，点击清词+重渲+回焦 | P2 | S |
| UI-517 ✅B1d | `.searchbox input`/`.search-input` radius 6px vs `--r-ctl` 4px | 输入件圆角脱离 4px 控件 token → 输入类统一 `var(--r-ctl)`(searchbox 若保前缀观感可整体定 `--r-tray:6px` 收编) | P2 | S |
| UI-518 ✅B1c | `.ol-row`(div onclick) | 大纲行键盘不可达 → `tabindex=0`+`role=button`+Enter/Space 走 `selectEntity`;`.del` 同理 | P1 | M |
| UI-519 ✅B1b | `.ol-row .del` `visibility:hidden→visible` | 悬停显形无过渡、突兀 → opacity 0↔1 + visibility 延迟 120ms | P2 | S |
| UI-520 ✅B1c | `renderOutlineRow()` 行内改名 input `border-radius:2px` | 与 --r-ctl 4px 不一致 → `var(--r-ctl)` | P2 | S |
| UI-521 ✅B1c | `.ol-row .vis/.lock` 9px 中文「显/隐/锁」 | 9px 汉字难辨 → 提到 10px 并给 16px min-width 防换档跳动 | P2 | S |
| UI-522 ✅B1c | `.ol-empty`(大纲空态) | 纯文字无行动入口 → 追加 `.link-btn`「打开组件目录」聚焦 `#catalogSearch` | P2 | S |
| UI-523 ✅B1c | `#outline` | 无右 padding,滚动条压住 `.del`/⌁ 徽标 → `padding-right:6px` | P2 | S |
| UI-524 ✅B1c | `renderOutline()` 组头 `▦` 文字字符 | 脱离 Tabler 唯一图标族 → 换 `<svg class="ic"><use href="#i-box-multiple"/></svg>` | P2 | S |
| UI-525 ✅B1c | `renderOutlineRow()` `.focus-btn` `⌖` 字符 | 同上散落字符形 → 换 `i-focus-2` sprite(其余 ⌁/▶ 逐批迁移) | P2 | S |
| UI-526 ✅B1d | `renderCatalogEnvMats()` 材质卡 | 未选中实体点击仅 toast 事后告知 → 选中态变化时给材质卡加 .dim(opacity .45, title=「先选中实体」) | P1 | S |
| UI-527 ✅B1d | 环境/材质卡复用 `.comp-item` | hover 出现「+」但点击是设置不是放置，语义误导 → 这两类卡不渲染 `.plus` | P2 | S |
| UI-528 ✅B1d | `.comp-item .need2` 8px 中文徽标 | 8px 不可读 → 提到 9px 与 `.ty` 一致 | P2 | S |
| UI-529 ✅B1c | `#rtabs`/`.rtab` | 无 role=tablist/tab/aria-selected → `selectTab()` 同步 aria-selected,容器 role=tablist | P1 | S |
| UI-530 ✅B1c | `.rtab` | 无方向键切换 → Left/Right 在两页签间移动并切换 | P2 | S |
| UI-531 ✅B1d | `renderInspector()` 运行态 banner 内联 `radius:2px`+`color:var(--accent)` | 圆角不归 token、#d9a441 在琥珀底上对比不足 → radius `var(--r-ctl)`、字色 `var(--accent-hi)` | P2 | S |
| UI-532 ✅B1b | `numRow()` 校验失败 1600ms 后静默还原 | 范围文案读不完、不知已被还原 → err 保持到该输入下次 focus/输入，还原时值回填可见 | P1 | S |
| UI-533 ✅B1c | `.btnrow button.hot`(index.html:267-271) | 实底琥珀渐变与「运行=全站唯一实底主按钮」口径冲突 → 改成 `.tbtn.hot` 同款(琥珀字+13% 底+细描边)，渐变只留 #btnPlay | P1 | S |
| UI-534 ✅B1d | `triRow()` 轴色 border-bottom + `.frow input:disabled{opacity:.45}` | 运行态禁用整体降透明把轴身份色一起淡出 → disabled 时轴色 border 单独不降(opacity 只作用于背景/文字) | P2 | S |
| UI-535 | renderInspector「视觉缩放」行 `×N` | 暂停态 gizmo 摆姿势只写 mesh 不写文档，该行显示旧值与画面不符 → 拖动结束同步刷新该行文本 | P2 | S |
| UI-536 | renderInspector 外观组材质 `<select>` | 无视觉预览，全靠文字记材质 → select 前加 12px 色点 span(取 `M[mat].color` 或 swatchPreviews 缓存) | P2 | M |
| UI-537 ✅B1d | renderInspector 观察点「飞到观察点」裸 button | 只有 width/padding 内联样式，与 `.btnrow button` 全站风格脱节 → 套 btnrow 结构 | P1 | S |
| UI-538 ✅B1d | renderInspector 约束行删除钮内联 `border-radius:2px` | token 不一致 → `var(--r-ctl)` | P2 | S |
| UI-539 ✅B1c | `#liveGrid` 未运行时全 `--` | 「--」语义含混(无数据 vs 零) → 编辑态首格 hint「运行后出数」或值置「待运行」 | P2 | S |
| UI-540 ✅B1c | `updateReadouts()` omega 值自带 " rad/s"、其余裸数 | 单位口径不一(hint 又第三处) → 全部裸数+格内单位，或全部带单位，与 hint 二留一 | P2 | S |
| UI-541 ✅B1c | `.ro-grid .v` `word-break:break-all` | 数字任意中断行难读 → `break-word`+保持 min-width:0 | P2 | S |
| UI-542 ✅B1c | `#roSel` | 长实体名+读数无宽度上限，把 spacer 压没顶进左侧按钮组 → `max-width:340px`+ellipsis+title 全文 | P1 | S |
| UI-543 ✅B1c | `updateReadouts()` `\|p\|=12.34` | 动量读数无单位 → `|p|=12.34 N·s` | P2 | S |
| UI-544 ✅B1b | `#btnApplyParse` | vivid 建场期间按钮仍可点，双击仅 toast 事后拦截 → `applyAgentBusy` 期间 disabled+文案「建场中…」 | P1 | S |
| UI-545 ✅B1d | `#btnClearParse` | 一键清空全部解析结果无确认，误触丢 plan → 复用库卡「确认删?」两段式(2.6s 复原) | P1 | S |
| UI-546 ✅B1b | `setAgentStage()` error 态 | error 与 idle 同为素 badge,失败不显眼 → stage==='error' 加红字红描边样式类 | P1 | S |
| UI-547 ✅B1b | `renderAgentVerify()` badge `${ok}✓ ${warn}⚠ ${error}✗` | 三计数同色不可扫读 → 三段 span 分色(dim/accent/danger) | P1 | S |
| UI-548 ✅B1d | `.vrow .tx` `[分类] 信息` 前缀 | 分类与正文同色同权，扫读噪音 → 分类拆成 `.mk` 后 9px faint span | P2 | M |
| UI-549 ✅B1b | `#btnRerunVerify` | 自查秒级可完成但无 busy 态可连点 → 运行中 disabled+「自查中…」 | P1 | S |
| UI-550 ✅B1c | `#explainBadge` HTML 静态 `class="badge given"` | 未生成解释就琥珀高亮 → 初始素 badge,`renderExplanation` 再给 given | P2 | S |
| UI-551 ✅B1c | `#btnExportCSV` | 无数据时可点，点了才 toast → `lastSeries` 为空时 disabled+title 说明先跑解释 | P2 | S |
| UI-552 ✅B1c | `renderParseResult()` 每实体 `.conf` | 恒 --faint,总体置信度有色阶(D101)单实体没有 → 复用同色阶逻辑 | P1 | S |
| UI-553 ✅B1c | `renderParseResult()` 重力行 onchange | 非法输入静默还原，与 numRow 双标准 → 同 `.bad`+errmsg 反馈 | P1 | S |
| UI-554 ✅B1c | `.pgrid` 题给/默认/推断 badge | 归因无解释，教师不懂差别 → title:题给=题目明示/默认=组件缺省/推断=模型推算(可改) | P2 | S |
| UI-555 ✅B1b | `#changePreviewList` `max-height:150px` | 滚动裁切无暗示(同 UI-513) → 同款 mask 渐隐 | P2 | S |
| UI-556 ✅B1c | `buildChangePreview()` 行 checkbox | 取消勾选后行无视觉差，不知哪条被拒 → skipped 行 opacity .45 | P2 | S |
| UI-557 ✅B1c | `#dropZone` dragover | 只改边框色，拖入反馈弱 → 加 `background:rgba(217,164,65,.06)`(dragleave 复原已有) | P2 | S |
| UI-558 ✅B1c | `#imgPrev` | 大图解码期白板无状态 → onload 前显示 inset 底+「解码中…」(与库「无缩略图」同款) | P2 | S |
| UI-559 ✅B1c | `#camWrap` | 摄像头开着无任何标识，隐私焦虑 → 视频左上 9px「摄像头预览中」琥珀 dim 徽标 | P2 | S |
| UI-560 ✅B1b | `#btnMic.listening` | 仅 box-shadow 呼吸，按钮本身无状态语义(文案受保护不可改) → 同步 `aria-pressed` + 动态 title「点击结束聆听」 | P1 | S |
| UI-561 ✅B1b | `setParseStatus()` | 错误/成功纯靠颜色区分，色弱不友好 → 错误消息加 `✗ `(chrBad)、成功加 `✓ `(chrOk) 前缀 | P2 | S |
| UI-562 ✅B1c | `#agentTextReq` `maxlength=4000` | 上限不可见，打满才截断 → 右下 9px `N/4000` 计数,>90% 转琥珀 | P2 | S |
| UI-563 ✅B1c | `#agentTextReq`(HTML) | 缺 `spellcheck="false"`,中文输入下红波浪线干扰 → 与其他输入框对齐补上 | P2 | S |
| UI-564 ✅B1d | `#btnPlay` paused 加 `.hot` | `.primary` 渐变声明在其后覆盖,暂停态主按钮与运行态零视觉差(仅文字) → 追加 `#simbar button.primary.hot` 规则:去渐变改琥珀描边或降亮度 | P1 | S |
| UI-565 ✅B1b | `#btnPause` paused 文案「继续」 | 与 btnPlay「继续」同屏双「继续」并列费解 → btnPause 暂停态显示「恢复」(setBtnText 已有机制，非保护文案) | P1 | S |
| UI-566 ✅B1c | `#btnRec` 录制中 | 只有 hot+「停止录制」，无时长反馈 → 每秒 `setBtnText('停止 Ns')` | P2 | S |
| UI-567 ✅B1c | `#replayBar` 拖动 scrub | 逐帧检查时无帧号读数 → 旁边 `.ro` 显示 `帧 120/900` | P2 | S |
| UI-568 ✅B1d | `#selSpeed` | 无 aria-label(仅 title) → 补 `aria-label="时间倍率"` | P2 | S |
| UI-569 | `#simbar .ro` 分隔线 `:not(:first-of-type)` | 依赖 DOM 顺序的脆弱选择器，插一组控件就错位 → 显式 class 控制分隔线 | P2 | S |
| UI-570 ✅B1b | `#btnPause` disabled(编辑态) | 禁用无解释 → disabled 时 title=「运行后可用」 | P2 | S |
| UI-571 ✅B1c | `.chip.warn`(modeChip 欠载) | 只变字色边框，扫一眼不知出了事 → 文案前加 `⚠ ` 前缀(title 详情已有) | P2 | S |
| UI-572 ✅B1c | `#btnShake` | title 静态，不像 btnSound 有动态开关状态文案 → 对齐:`juice.shakeOn ? '震屏开启中—点击关闭' : '震屏已关—点击开启'` | P2 | S |
| UI-573 ✅B1b | `#perfHud .ph-row` flex space-between+gap 14px(已知线索) | k/v 各自起点，v 右缘不齐、长值挤压 k,基线松散 → 改 grid `1fr auto`,v 右对齐 tabular-nums | P1 | M |
| UI-574 ✅B1b | `#perfHud` 仅 `min-width:132px` 无上限 | 数值变宽整块逐帧抖动 → 固定 `width:148px`,溢出省略 | P2 | S |
| UI-575 ✅B1b | `#perfHud .ph-hd` b 16px 与 .u 9px | baseline 对齐下 9px 单位视觉下沉 → `.u` 加 `align-self:flex-end;padding-bottom:2px` | P2 | S |
| UI-576 ✅B1b | `#curvePanel` width:334 padding 8 border 1 vs `#curveCanvas` width=320 | 内容盒 316px,画布右缘溢出面板 4px 戳出圆角外 → 面板 334→340,或 canvas CSS `width:100%` | P1 | S |
| UI-577 ✅B1b | `drawCurves()` `n<2` 直接 return | 空画布纯黑无解释 → 画布中央 10px faint「运行后记录曲线」 | P1 | S |
| UI-578 ✅B1d | `.clegend` 纯文字着色 | 色弱/投影不可辨 → 每项前 8px 色块 span | P2 | S |
| UI-579 ✅B1d | `#consbar .emark` 66.67% 刻度 | 含义无任何说明 → erow title=「刻度=初始 KE/PE 构成分界(能量条按初始态归一)」 | P2 | S |
| UI-580 ✅B1d | `#consbar .erow .v` `flex:0 0 52px` | 负值/宽值(-123.456)溢出挤压能量条 → 56px+溢出省略 | P2 | S |
| UI-581 ✅B1b | `toast()` 固定 1800ms | 长文案(「打开失败: …」「已导出 …csv」)读不完即消失 → `1800+min(2200, msg.length*45)` ms | P1 | S |
| UI-582 ✅B1b | `#toast`(已知线索:无类型语义) | 成功/警告/错误同一张脸 → `toast(msg,type)` 第二参映射 `.ok/.warn/.err`:左 2px 实色边(绿/琥珀/红) | P1 | M |
| UI-583 ✅B1b | `toast()` 换文案 | 旧出新入无重入动画，连续操作像文字瞬换 → 文案变化时移除 `.on` 后 rAF 再加回，重放 6px 上浮 | P2 | S |
| UI-584 ✅B1b | `#errbar`(已知线索:无关闭钮) | fail 后常驻顶部遮内容，只能刷新 → 右端固定 × 钮(i-x sprite)置 display:none | P1 | S |
| UI-585 ✅B1b | `#errbar` 显示时 `#toast`(top= topbar+10, z45) | toast 被 errbar(z50) 压住同位叠放 → errbar 可见时 toast top 下移 class(+34px) | P2 | S |
| UI-586 ✅B1d | `#veil.gone` | 仅 opacity+pointer-events,元素仍留 AT 树 → transitionend 后 `visibility:hidden` | P2 | S |
| UI-587 ✅B1b | `#helpOverlay` 背景 `backdrop-filter:blur(3px)` | 违反全站无 backdrop-filter 的 WebGL 性能口径(现有违例) → 改 `rgba(5,6,8,.84)` 纯色遮罩 | P1 | S |
| UI-588 ✅B1b | `#sceneLib` 背景 `backdrop-filter:blur(3px)` | 同上 → 同 UI-587 处理 | P1 | S |
| UI-589 ✅B1c | `#helpOverlay` | 无 role=dialog/aria-modal、打开不移焦 → role=dialog aria-modal=true,打开时焦点入卡、Tab 循环、Esc 已有 | P1 | M |
| UI-590 ✅B1c | `#sceneLib` `.scn-dlg` | 无焦点陷阱,closeLibrary 不还焦 → Tab 圈限在弹层内；关闭时 focus 回 `#btnOpen`(记录 opener) | P1 | M |
| UI-591 ✅B1c | `#helpOverlay` 20 行快捷键平铺 | 无分组扫读难 → 按 全局/视图/编辑/Agent 插 4 行 9px faint 分组头 | P2 | M |
| UI-592 ✅B1c | helpOverlay `td.k` 复合键「Shift+空格」单 span | 与单键同构看不出组合 → 拆多个 kbd span 以 `+` 相连 | P2 | S |
| UI-593 ✅B1b | `.scn-dlg` `border-radius:14px` | 脱离岛/浮层 10px token → `var(--r-panel)` | P2 | S |
| UI-594 ✅B1b | `renderLibrary()` 空态判断 | `libEmpty` 按过滤后 list 显示，搜索无匹配时错误显示「库里还没有场景」 → libQuery 非空时改显「没有匹配的场景」+清词 link-btn | P1 | S |
| UI-595 ✅B1c | `snapshotThumb()` 全视口 cover 裁剪(已知线索:取景偏小) | 主体居中小、四周空旷 → drawImage 源区取中央约 62%(等效 1.6x 变焦)再 cover,或按实体包围盒重渲一帧 | P1 | M |
| UI-596 ✅B1b | `.lib-card:hover` translateY(-2px)+专属阴影 | 与 `.comp-item` -1px 高度语言不一致 → 统一 -1px 并复用 island 阴影变体 | P2 | S |
| UI-597 ✅B1c | `.lib-card .nm` `cursor:text` | 单击并不改名(双击才改)，光标误导 → cursor:default,靠 title「双击改名」 | P2 | S |
| UI-598 ✅B1c | `renderLibrary()` 当前场景卡 | inline borderColor+`▶ ` 前缀，状态弱且字符脱离图标族 → `.on` 类:accent-dim 底+琥珀描边(▶ 可保留) | P2 | S |
| UI-599 ✅B1c | `.lib-card .ops button` | 无 ：active 按压反馈 → 补 `transform:translateY(1px)` 对齐 btnrow | P2 | S |
| UI-600 ✅B1c | lib-card `img.thumb` `alt=""` | 读屏读不出卡 → `alt="场景 ${sc.name} 缩略图"` | P2 | S |
| UI-601 ✅B1c | `#libSearch` Enter 打开首条 | 「第一结果」无视觉指向 → 有词时首卡加 1px 琥珀描边提示回车目标 | P2 | S |
| UI-602 ✅B1c | `.chip-tag .x` 10px | 移除热区过小 → padding 提到 2px 3px 或 `::after` 扩 8px 热区 | P2 | S |
| UI-603 ✅B1c | `#outlineSearch` | Esc 无行为(目录框有)，清词只能手删 → 对齐目录框：Esc 清词，空词再冒泡 | P2 | S |
| UI-604 ✅B1b | `updateScaleReadout()` 与 `#btnGrid` | 网格隐藏后读数仍写「网格 1 格 = 1 m」信息失真 → grid 关时隐藏 readout(或文案注「网格已隐藏」) | P2 | S |
| UI-605 ✅B1b | `updateScaleReadout()` 全角空格 `　\|　` | mono 读数里混入全角分隔，宽度不齐 → 用 `·` + 两侧 8px margin | P2 | S |
| UI-606 ✅B1b | `renderLibrary()` | 全量 innerHTML 重建，正在改的名/标签输入被排序切换等打断 → 加 libEditing 守卫(同 outlineEditing),编辑中跳过重渲 | P1 | S |
| UI-607 ✅B1b | `startReplay()` | 录制中可点回放(frames 实时增长)，回放/录制状态互踩 → 入口守卫:`runtime.recFrames` 时 toast「先停止录制」并 return | P1 | S |
| UI-608 ✅B1b | `exportSeriesCSV()` workbench.js:5016-5018 | 连发两条 toast(文件名+行数),第二条同帧顶掉第一条 → 合并为一条「已导出 N 行采样 → 文件名」 | P2 | S |
| UI-609 ✅B1c | `addCatalogRow()` `onGhostPlace` 被阻挡分支(id=null) | 放置被防穿模拦截时静默，只有 ghost 变红 → 节流 toast「该位置被占用(红色预览)，挪到空地再点」 | P1 | S |
| UI-610 ✅B1c | `viewport.js showGhost()` 材质 opacity 0.35 固定 | overlap 红警示态同透明度不够醒目 → overlap 时提到 0.55 | P2 | S |
| UI-611 | ghost 跟随期(`ghostState()` 有 snapped/snapMode) | 吸附档位/是否吸附只有按钮文案，画布旁无提示 → ghost 激活时在 scaleReadout 位临时显示「吸附：表面 · 已吸附」小条 | P2 | M |
| UI-612 ✅B1c | ghost 旋转 `[`/`]`(FZ-2) | 快捷键无任何 UI 提示，发现成本高 → 首次 ghost 激活 toast 一次「[ ] 旋转预览 · 右键取消」(localStorage 记忆已示) | P2 | S |
| UI-613 | `#rubber` 框选矩形 | 拖框中无尺寸/计数反馈 → 矩形下缘 10px mono 实时显示框宽×高(m) | P2 | M |
| UI-614 ✅B1d | `renderCatalogEnvMats()` 材质降级色块 | swatchPreviews 未生成时灰块与成品不可分 → 降级期加 1px 虚线边+title「预览生成中」 | P2 | S |
| UI-615 ✅B1b | `onKey()` Esc 链 | errbar 不在 Esc 关闭链里(lib/搜索词/gizmo/help/框选/ghost 都有) → errbar 可见时 Esc 先关它 | P2 | S |
| UI-616 ✅B1c | `onKey()` `'?'` 开帮助 | 只响应 Shift+/ 组合，F1 空闲 → F1 同映射 helpOverlay toggle | P2 | S |
| UI-617 ✅B1b | `:focus-visible` 全局 1px 琥珀 outline | `.tbtn.hot`/`.rtab.hot` 琥珀底上琥珀描边不可见 → hot 态 outline 改 var(--text) 或加双环 | P2 | S |
| UI-618 ✅B1b | `button:disabled`/`select:disabled` `cursor:default` | 不暗示不可交互，教学场景易反复点 → `cursor:not-allowed` | P2 | S |
| UI-619 ✅B1c | `#dropZone`(div onclick) | 键盘不可达上传 → `tabindex=0`+`role=button`+Enter/Space 触发 `#agentFile.click()` | P1 | S |
| UI-620 ✅B1c | `renderInspector()`/`patchParams(rerender=true)` | paramsRebuild 类参数提交后面板整体重建，焦点丢失需重新点输入框 → 重建前记录 activeElement 的 label/key,重建后还原 focus+select | P1 | M |

补充说明:UI-501(UI-576)为实读代码确认的真实缺陷级问题;UI-513/573/582/584/595 对应任务书给的五条已知线索;UI-587/588 是对现有两处 backdrop-filter 的清理建议(符合“不使用”约束的方向)。
