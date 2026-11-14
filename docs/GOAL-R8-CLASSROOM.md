# GOAL-R8 · 课堂交付（从「教学链部件齐全」到「一堂真能放进课堂的课」）

> 2026-11-14 立线。用户指令：「给我一份 goal 目标，我要给 agent 继续完善这个教学 agent」。
> 本文件是长期执行契约：每轮开工先重读此文件 + LEDGER 末轮记录 + R7 台账统计行，收尾按 WORKING RHYTHM 第 6 步心跳续作，不许等用户说继续。

## GOAL（一句话）

MECHANICA 的教学链部件（简报/代入行/聚光/TTS/变式/时机/节奏/放映）已全部建成且单件有证据；R8 要把它推进到「交付」：真实浏览器、真实题目、真实模型通道，从拍题到下载一张成片全程走通，成片与每块新 UI 过独立视觉终验与学生视角走查——让物理老师明天就能把这张片子放进课堂播放。

## CONTEXT（执行必读现状）

- 工作区 `D:\mechanica-lab-r4`（git worktree，分支 `r4-play`）；公开仓库 origin=github.com/3gediana/mechanica-lab，推送口径 r4-play→main。**另一 agent 占 8721/master，严禁越界**（含进程操作——杀服务只许按精确 PID，宽过滤器 taskkill 已有误杀前科）；本线服务一律 `python tools/serve.py 8722`，UI 测试统一 `MECH_BASE=http://127.0.0.1:8722`；改 serve.py 后必须手动重启才生效。
- **模型通道（11-14 已切）**：本机 15730 模型池 `127.0.0.1:15730`（OpenAI 兼容中转），模型别名 `opencode-go/deepseek-v4.1-flash`（多模态，图片通道实测 9.5s 量级）。本地池为免费资源：真实调用每批 ≤10 次（仍守纪律防限流）；外部付费 API ≤5 次。真实解析 key 在服务端 `tools/server/step_key.txt`（不入库、不日志、不进前端，check.py 有泄漏扫描红线）。
- **R7 已交付（证据在 `docs/OPTIMIZATION-R7-TEACHING.md` R7-001~018）**：A1 简报/A2 四通道（代入行·聚光·TTS·一题多变）/A3 四时机/A4 节奏分级/A5 课堂放映/A6 六族金标/B1~B3 自检自修/B4 MOD-505 清偿/RP 渲染-物理一致性审计/遗留失败全清（run-all 历史首次全绿）。
- **R8 要清的精确缺口（R7 完成矩阵如实标注的 PARTIAL 与 MISSING）**：
  - A5 放映成片只有 fixture 证据（p50 断言）——headless 无 MediaRecorder，**真实成片从未录出过**（E5 缺口）；
  - A3 的 turn/leaveSurface/sinkFloat 只有纯函数单测 + equilibrium 真链路——三个时机的真实场景 UI 走查未做；
  - A6 六族金标是 fixture 侧——真实模型 teaching 字段质量抽查（E4）未做；
  - z-agentquality 9/10 基线是 apigoto 时代跑的——**新通道 opencode-go 未跑过全量质量基准**；
  - C1 学生走查 / C3 演示片 / 黑板时刻：MISSING。
- 回归基线（不得回归）：units 158/158、p49 213/213、p50 29/29、p52 18/18、run-all 55 套全绿、check.py 过。p47 走真实 API（60~170s + 计费），测试优先 fixture。
- 按序必读：`LEDGER.md`（末三节：R7 前沿 1/2/3）→ `docs/OPTIMIZATION-R7-TEACHING.md`（完成矩阵+批次）→ `docs/VISUAL-GATE.md`（对立式视觉终验纪律）→ `README.md`（能力现状）→ `docs/GOAL-R7-TEACHING.md`（质量红线沿用）。

## NORTH STAR

学生拍一道题，得到一堂 60 秒的微型物理课，全程不需要任何人在旁边兜底；老师拿到的是能直接放课堂的讲解片。R8 的跃迁点：**这堂课必须在真实条件下被完整地走一遍并留下可审查的成片**——部件齐全 ≠ 一堂课，测试全绿 ≠ 敢交付。

## DELIVERY HORIZON（三战区，D 为主 C 为节奏）

### D. 课堂交付主线（用户点单主体）

- **D1 新模型基准重校准**：z-agentquality 10 题全量跑 opencode-go 通道（≤10 次真实调用），复核 9/10 零 error 基线；新模型短板（解析质量/teaching 字段/schema 纪律）逐条修 prompt 或链路，短板修不动如实入账。
- **D2 真实教学质量抽查（E4）**：≥6 族（atwood/斜面/抛体/单摆/弹簧/动量）各 1 次真实解析，检查 teaching 字段质量（moment 时机是否贴合题面/formula 是否正确/note 是否给学生的话），原始输出落盘可追溯；不合格字段修 PARSE_PROMPT 后复抽。
- **D3 A3 剩余时机真实链路（E3）**：turn（弹簧伸缩极值/水平折返）、leaveSurface（跳离/抛离）、sinkFloat（浮沉平衡）各配一个真实场景（预置或 fixture），真实 UI 运行触发、卡片上屏、断言入 p50 扩展。
- **D4 放映成片真实化（E3→E4）**：headed 浏览器真实录出 ≥1 张放映成片（MediaRecorder/WebM），检查片中字幕（公式+代入行）、原题角标、定格节奏是否完整可读；成片时长/大小/可播放性三态如实记录。
- **D5 E5 学生主路径全链**：一张**此前从未用过的**新题图，从上传 → 简报评审 → 建场（自检过）→ 运行讲解 → 放映 → 成片下载，全程真实 UI 完成，逐步记录耗时与进行中/成功/失败三态；任何一步卡死/降级都要么修掉要么如实入账。
- **D6 独立视觉终验**：成片抽 ≥2 帧问**对立式问题**（VISUAL-GATE.md 清单，不问引导问题）；关键新 UI（简报卡/teach 卡代入行/变式面板/放映按钮态）样张独立评审。

### C. 质量余账与走查（背景节奏）

- **C1 学生视角真实走查**：ux-audit 技能真实点击走查 A1/A2/A5 全部新通道（等待体验、空态、降级态、重入），发现问题当批修并入台账。
- **C3 教学演示片双版**：高光版（关键点集锦）+ 全长版，帮助表入口已有，成片可下载。
- **C2 R6-181~300 余账**按台账继续（每批 ≥6 条，不阻塞 D）。

## PRODUCT COMPLETENESS（R8 语境下「完整」的含义）

- **学生主路径**（D5 是它的 E5 证据）：上传/拍照 →（等待有进度可感知）→ 拆题简报 → 评审修正 → 建场（自检过）→ 运行（关键点多通道讲解，节奏有起伏）→ 解释对照 → 变式对比 → **放映片真实下载**。每步三态可观察。
- **老师主路径**：放映模式一键出片，成片在普通播放器可放；讲解卡与画面不脱节（说的公式对应画面正在发生的事）。
- **失败/边界路径**：解析超时自愈、自检不过诚实降级、TTS 不可用静默降级、变式失败回原题、**放映录屏不可用诚实提示**（不许静默假装在录）。
- **不许出现**：假数字、假成片（空文件/零时长 WebM 冒充交付）、讲解卡与画面脱节、用 fixture 证据冒充真实链路完成。

## CURRENT FRONTIER（第一切片）

**先做 D1+D2（新模型基准重校准 + 真实教学质量抽查）**——此后每个 D 项的证据都跑在新通道上，它是全部真实性的前提；随后立即进 D5+D4（学生主路径全链 + 放映成片真实化，R8 的核心交付瞬间），D3/D6 紧随。顺序可自主调整，但原则：先校准真实性地基，再走全链，后补时机走查与演示片；C1 在 D5 后立刻做（真实走查最容易在全链之后暴露问题）。

## DONE WHEN + 完成矩阵

整体 COMPLETE 仅当（全部外部可观察）：

1. D1~D6 各项在真实条件完成：D1 基线复核有数据、D2 ≥6 族 E4 落盘、D3 三时机 E3 断言、D4 真实成片文件存在且可播、D5 新题图全链记录、D6 对立式终验通过；
2. C1 走查报告产出且发现的问题当批修完（或如实挂账）；C3 双版成片可下载；
3. 回归基线不破：units / p49 / p50 / p52 / run-all / check.py 全绿；
4. 完成矩阵在 R8 台账维护（`能力 | 用户可见结果 | 入口 | 失败恢复 | 证据级别 E0~E5 | COMPLETE/PARTIAL/MISSING | 缺口`），任何必要项 PARTIAL/MISSING ⇒ 整体 IN PROGRESS 继续干。测试全绿、README、自述都不算完成证据。

## VERIFY（最短证据路径）

1. `node --test test/unit/*.test.mjs`（158+ 全绿）；
2. `MECH_BASE=http://127.0.0.1:8722 node tools/ui-test/z-agentquality.mjs`（D1，10 题真实调用）；
3. `p50-teach-elevate.mjs` 扩展（D3 三时机断言）+ run-all 全量回归 + check.py；
4. D4/D5：headed Chrome 真实操作录出成片，`ls -la` 文件证据 + 播放器可播；
5. D2：`tools/ui-test/` 落盘 `realspot-r8-raw-*.json` 原始输出 ≥6 族；
6. D6/C3：对立式视觉终验记录（问句+回答+判定）入台账。

## QUALITY BAR（红线，违反=返工）

- 一切上屏数字确定性可复算，与 explain.js/teaching.js 同源；禁止 LLM 生成数字上屏（R7 已锁，不许松）。
- UI 设计语言不变：仪器级暗色、琥珀唯一强调色、无渐变无玻璃拟态无 emoji、动效只做状态反馈。
- 模型输出字符串上屏一律 textContent（防注入）。
- **真实还原非数学等价**：慢放/定格/聚光/放映是观察手段，不得改动物理演化本身。
- 测试断言不许为过而弱化；flaky 修根因，不许加 sleep 凑。
- **证据诚实**：fixture/注入/测试钩子的证据标 E2/E3，不冒充 E4/E5；成片必须是真实 MediaRecorder 产物，空文件不算。
- 并发子代理 ≤2 路（用户令）。

## BOUNDARIES

- 只在 r4-play 工作，推 r4-play→main，**严禁 force/改历史**；不碰 8721/主工作区/另一 agent 的任何东西（含进程：重启/杀服务只按精确 PID）。
- 计费纪律：本地 15730 池真实调用每批 ≤10 次；外部付费 API ≤5 次；教学抽查优先复用已裁题图（assets/demo/）+ 至少 1 张全新题图（D5 专用）。
- 浏览器纪律：最多 1 进程/1 context/1-2 标签；headless waitForFunction 一律 `polling:250`；录屏用 headed。
- 环境坑速查：页外读画布前 `vp.render()` 现渲；node --check 是 JS 语法权威；python 补丁 assert 失败=零写入，先 dry-run；git push 后 `rev-parse HEAD` 对账 origin/main；MSYS /tmp 与 Windows python 不互通；本机代理 7897 会劫持 localhost 调用（NO_PROXY）。
- 不做：多用户/云端/账号；不改 classic.html 核心物理；不引入外部运行时依赖；TTS 只用本地 Web Speech 不上云。

## OPEN CREATIVE MANDATE（惊喜预算）

每个大战区完成时主动尝试 ≥1 个高上限创意（不合适就删并说明理由）：

- **黑板时刻（主推）**：teach 定格瞬间在场景上叠 2D 黑板式受力图/示意图——把 3D 画面翻译回课本图语言。学生看不懂 3D 对应课本哪张图是真实痛点，R7 未做，R8 最值得深试的一个；
- **互动小测**：放映结束出 1~2 道从题面确定性派生的数值代入题，答对才算学完；
- **镜头语言**：放映模式中 contact 时刻自动推近特写（仅放映模式，不劫持交互相机）。

判断标准：是否让学生/老师获得原来没有的理解；是否与仪器级气质连贯；是否挤占核心打磨（挤占就砍）。

## SKILL ROUTE（按需调用，不为凑数）

- `ux-audit`：C1 学生视角走查时——真实交互找可用性/行为 bug，静态审查不算；
- `web-interface-guidelines`：新 UI（黑板时刻/小测）交付前对照 MUST/SHOULD/NEVER 自查；
- `pdf`/`documents` 视觉评审相关 skill 不适用本项目——视觉终验走 VISUAL-GATE 对立式问题。

## WORKING RHYTHM（每批节奏）

1. 读本文件 + LEDGER 末节 + R7/R8 台账统计行（不重吞全部历史）；
2. 选一个连贯切片，R8 台账入账编号；
3. 纯函数先行（单测）→ UI 实现 → 定向测试 → 全量回归 + check.py；
4. 视觉改动样张过视觉门；成片/图交付走对立式视觉终验；
5. 台账入账（完成标准+证据）、LEDGER 追加轮次、一批一 commit（信息含证据概要）、推送对账；
6. **完成闸门心跳**：`COMPLETE gate passed? 否→立即选下一前沿开工；可能→自己发起独立总审查（D5 全链走查+对立式视觉终验+全量回归），失败回前沿`。
   不许以「本轮完成/等待用户/下轮候选」收尾；上下文将尽时写 HANDOFF 存档（IN PROGRESS + 精确缺口 + 最短启动命令），不许伪装完成。
   阻塞时写清：已试路径、已知事实、真正缺的决定/资源、一个最小可继续方案——不在同一死路机械重复。

## HANDOFF（下一窗口先读）

本文件 + `LEDGER.md` 末三节 + `docs/OPTIMIZATION-R7-TEACHING.md` 完成矩阵 + `docs/VISUAL-GATE.md`。最短启动：

```
cd D:\mechanica-lab-r4 && git status && git log --oneline -3
python tools/serve.py 8722        # 改过 serve.py 记得重启
curl http://127.0.0.1:15730/v1/models   # 确认模型池在线（opencode-go/deepseek-v4.1-flash）
cd tools/ui-test && MECH_BASE=http://127.0.0.1:8722 node run-all.mjs
```
