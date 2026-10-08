#!/usr/bin/env python3
"""开发服务器：静态托管（补 .mjs MIME + 禁缓存）+ POST /api/parse-question 题图解析代理。

密钥纪律：key 只从环境变量 MECHANICA_STEP_KEY 或本地未跟踪文件 tools/server/step_key.txt 读取；
不写日志、不回显、不进错误消息。解析失败返回可展示的普通错误文案。
"""
import http.server, sys, json, os, urllib.request, urllib.error, re, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STEP_URL = "https://api.stepfun.com/step_plan/v1/chat/completions"
STEP_MODEL = "step-5-preview"
MAX_BODY = 8 * 1024 * 1024          # 8MB 图片上限
CALL_TIMEOUT = 90                    # 单次解析超时 s

PARSE_PROMPT = """你是大学物理题解析器。看图中的物理题，输出严格 JSON（不要 markdown 代码块，不要解释文字），schema：
{
 "questionType": "题型短语",
 "kind": "题型类别：斜面/抛体类留空，两球碰撞留空，天体引力填 astro，转台/角动量/转动惯量类填 rotation，定滑轮/阿特伍德/两侧悬挂类填 atwood，弹簧振子/胡克定律类填 spring，铰链/复摆/刚性杆摆类填 hinge",
 "goal": "实验或求解目标",
 "gravity": 数值m/s2 或 null,
 "removals": ["要从当前场景删除的既有对象名称或类型（用户明确要求删除/去掉/拿走时才给），没有则空数组"],
 "entities": [
   {"type": "ramp|sphere|box|cylinder|ground|celestial",
    "name": "实体名",
    "given": {"angleDeg":数值, "length":数值m, "height":数值m, "width":数值m, "radius":数值m, "mass":数值kg, "friction":数值, "restitution":数值, "velocity":[vx,vy,vz]},
    "confidence": 0到1}
 ],
 "observations": ["要求观察或求解的量"],
 "anchorPoints": ["固定点/支撑点/悬挂点描述，没有则空数组"],
 "keyPoints": ["题目关键点（关键位置/时刻/事件），没有则空数组"],
 "environment": "环境条件短语（如：光滑水平面、不计空气阻力），没有则空字符串",
 "unknowns": ["图中未给出的量（不要编造数值）"],
 "uncertain": ["题图未明示、你按惯例处理但需用户确认的内容，没有则空数组"],
 "joint": {"from": 实体索引, "to": 实体索引, "axis": [1,0,0], "limits": [0.15, 1.05], "anchor1": [0,0.14,0], "anchor2": [0,0,0]},
 "attaches": [{"type":"spring","from":实体索引,"to":实体索引,"stiffness":数值N/m,"restLength":数值m,"damping":数值}],
 "assumptions": ["你做的假设"],
 "confidence": 0到1
}
规则补充：
- kind 填 "rotation" 时给 joint（转台体索引 from、滑块体索引 to、径向滑槽参数）。
- 转台初始角速度写在其 given.angvel = [0, ω, 0]。
- 复摆/铰链摆（kind 填 hinge）：摆杆写 box（given.length=杆长），悬点/锚点写 box 或 ground（given.position=锚点坐标）。
- 抛体题：单个 sphere，given.velocity=[vx,vy,0]，可给 given.position 为抛出点。
- 混合搭建里用户要求"删除/去掉/拿走"某对象：把对象名或类型写进 removals（如 ["小球"]），不要假装它不存在。
输出纪律：所有数值必须是 JSON 数字（不要字符串、不要带单位）；实体不超过 16 个，无关实体一律不列。
示例（斜面题的输出形状，内容以题为准）：
{"questionType":"斜面下滑","kind":"","goal":"求底端速度","gravity":null,"entities":[{"type":"ramp","name":"斜面","given":{"angleDeg":30,"length":2},"confidence":0.95},{"type":"sphere","name":"小球","given":{"mass":1},"confidence":0.9}],"observations":["底端速度"],"anchorPoints":[],"keyPoints":[],"environment":"不计摩擦","unknowns":[],"uncertain":[],"joint":null,"assumptions":[],"confidence":0.9}
规则：
- type 必须从八个值中选：斜面/楔子/坡道=ramp，球/铁球/球体=sphere，方块/物块/砝码/重物/墙/挡板=box，圆柱=cylinder，地面/桌面/平台/台面/高台=ground，定滑轮/滑轮=pulley，恒星/行星/卫星/天体=celestial，传送带/输送带=conveyor。无关实体不要列。墙/挡板类 box 记得 given.fixed=1。
- 定滑轮/阿特伍德题：kind 填 atwood，滑轮 type=pulley（given 带 radius 和 position），两物体 type 用 sphere 或 box（given 带各自的 mass；若题目给初速度写 velocity）。
- 天体/引力题（恒星/行星/卫星绕转）：kind 填 astro，恒星/行星/卫星 type 一律填 celestial（不要填 sphere），中心天体和绕转体 given 都带 mass。轨道半径是位置不是尺寸：不要写进 radius（radius 是渲染尺寸，省略即可）；把绕转体位置写进 position（相对中心天体，如卫星在 x 方向 4 米处填 [4,0,0]，中心填 [0,0,0]）。速度写 velocity 三分量，方向与位置连线垂直（圆轨道切向）。题给场景引力常数时输出顶层 "G" 字段（数值），未给则省略。
- given 只写题目文字或图中明确给出的数值；没给的键不要写。
- 题目说"不计摩擦"时 friction 写 0 并在 assumptions 说明；"由静止释放"时 velocity 不写（默认零）。
- 题目未明确给重力加速度时 gravity 填 null（不要猜 0 或 10）；gravity 禁止填 0（除非题目明确是失重/零重力环境）。
- 「滑下斜面后在水平面继续运动」类组合题：必须补一个 ground 实体承接水平段（斜面底端在斜面 +x 侧）。
- 斜面上的方块/圆柱省略 given.position——沙盘会自动贴坡放置（圆柱自动躺平可纯滚动）；多个物体在斜面上并排对比时都不写 position，沙盘自动分车道。
- 方块/圆柱/球的 given.position 是自由落位（按题给坐标放置），写 position 表示你确定它在哪里。
- 卫星速度小于圆轨道速度是椭圆轨道（合法，可演示开普勒第二/第三定律，沙盘支持偏心率观测）；不要把椭圆强行改圆。
- 弹簧连接两个实体时用 attaches 数组（from/to 是 entities 下标，stiffness 单位 N/m，restLength 是弹簧原长 m，damping 阻尼系数 0~2，缺省 damping=0）；「弹簧一端固定在墙上」：墙写 box 实体 given.fixed=1，attaches 两端分别指向墙与小球。弹簧压缩状态：restLength 写原长（大于安装距离即可）。
- 「同一高度/同时释放」等多物体对比题：每个物体都要写 given.position 且高度一致（红队实测：模型把其中一个球放在地面=保真错误）。
- 传送带题：type=conveyor，given 带 length（带长 m）、speed（带速 m/s，方向沿 +x，反向给负值）、friction（带面动摩擦因数 μ）。被输送的物体 type 用 sphere 或 box，不写 position 时沙盘自动放在带的左端带面上（「轻放上去」类题的默认语义）。
- 缺失的重要条件写进 unknowns；你补充的工程默认值写进 assumptions；按惯例处理但无题图依据的写进 uncertain。
- 单位换算（AG）：所有数值一律换算成 SI 再输出：cm→m（÷100）、g→kg（÷1000）、km/h→m/s（÷3.6）、min→s（×60）；角度保持度数。
- 坐标约定（AG）：y 竖直向上、地面 y=0、斜面底端在其 +x 侧；「放在地面/桌面上静置」不写 position。
- 除 astro/rotation/atwood/spring/hinge 外（碰撞/动量/抛体/平抛/自由落体/传送带/圆周等），kind 一律留空字符串，不要自造类别词。
- 轻绳连接也走 attaches：type 填 "rope"，length 写绳长 m（缺省按两端距离×1.03 自动给），绳不可伸长只传拉力。
- 只输出 JSON 本体，且必须紧凑：单行、无缩进、无多余空格与换行。"""


def load_key():
    k = os.environ.get("MECHANICA_STEP_KEY", "").strip()
    if k:
        return k
    f = ROOT / "tools/server/step_key.txt"
    if f.exists():
        return f.read_text(encoding="utf-8").strip()
    return ""


def _extract_json(text):
    """从模型输出（正文或思考流）中提取 JSON 本体。
    返回 dict 或抛 JSONDecodeError。"""
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.S)
    candidates = []
    # 主启发式：定位 "questionType" 键，回溯 JSON 起始、顺延到末尾大括号
    # AG-94：用 rfind 取最后一次出现——思考流先草拟样例 JSON 再输出真 JSON 时，
    # 第一个 questionType 属于草稿；真解析结果在最后
    qi = text.rfind('"questionType"')
    if qi != -1:
        start = text.rfind('{', 0, qi)
        end = text.rfind('}')
        if start != -1 and end > start:
            candidates.append(text[start:end + 1])
    # 兜底：首个 { 起做括号配平扫描（感知字符串），不 break、记录最后一个 depth==0 闭合点
    # ——同时处理「JSON 前后夹推理文字」与「思考流里模型自拟的样例 JSON」（后者在前，真结果在后）
    fb = text.find('{')
    if fb != -1:
        depth = 0; in_str = False; esc = False; last_full = -1
        for i in range(fb, len(text)):
            ch = text[i]
            if in_str:
                if esc: esc = False
                elif ch == '\\': esc = True
                elif ch == '"': in_str = False
                continue
            if ch == '"': in_str = True
            elif ch in '{[': depth += 1
            elif ch in '}]':
                depth -= 1
                if depth == 0: last_full = i
        if last_full != -1:
            candidates.append(text[fb:last_full + 1])
    for c in candidates:
        try:
            obj = json.loads(c)
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            continue
    raise json.JSONDecodeError("no extractable JSON", text[:60], 0)


def call_step_messages(messages):
    """共用请求+提取链：图片通道与文字通道唯一差异是 messages。"""
    body = json.dumps({
        "model": STEP_MODEL,
        "temperature": 0.2,
        "max_tokens": 8192,
        "messages": messages,
    }).encode("utf-8")
    req = urllib.request.Request(STEP_URL, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": "Bearer " + load_key(),
    })
    with urllib.request.urlopen(req, timeout=CALL_TIMEOUT) as resp:
        out = json.loads(resp.read().decode("utf-8"))
    msg = (out.get("choices") or [{}])[0].get("message", {})
    if os.environ.get("MECH_PARSE_DEBUG"):
        # 诊断转储：仅响应正文（不含 key），排查思考流提取失败
        dump = {"finish_reason": (out.get("choices") or [{}])[0].get("finish_reason"),
                "usage": out.get("usage"),
                "content_len": len(msg.get("content") or ""),
                "reasoning_len": len(msg.get("reasoning_content") or ""),
                "content_head": (msg.get("content") or "")[:300],
                "reasoning_head": (msg.get("reasoning_content") or "")[:300],
                "reasoning_tail": (msg.get("reasoning_content") or "")[-400:]}
        dump_path = os.path.join(tempfile.gettempdir(), "mech_step_raw.json")
        with open(dump_path, "w", encoding="utf-8") as f:
            json.dump(dump, f, ensure_ascii=False, indent=2)
    # content 与 reasoning_content 走同一条提取链：正文直读优先，思考流启发式兜底
    err = None
    for src in (msg.get("content") or "", msg.get("reasoning_content") or ""):
        if not src.strip():
            continue
        try:
            return _extract_json(src)
        except json.JSONDecodeError as e:
            err = e
    if err:
        # AG-508：finish_reason=length（思考流+正文顶满 max_tokens）时提取链必然失败——
        # 如实上报截断，与「内容不可解析」区分（客户端按 retryable 自动重试）
        if (out.get("choices") or [{}])[0].get("finish_reason") == "length":
            raise json.JSONDecodeError("__truncated__ 模型输出被截断（达到 max_tokens）", "", 0)
        raise err
    raise json.JSONDecodeError("empty content and reasoning", "", 0)


def call_step(data_url):
    return call_step_messages([{
        "role": "user",
        "content": [
            {"type": "image_url", "image_url": {"url": data_url}},
            {"type": "text", "text": PARSE_PROMPT},
        ],
    }])


def call_step_text(text):
    """文字要求通道（混合搭建）：题目文字或搭建要求，同一 schema 输出。"""
    return call_step_messages([{
        "role": "user",
        "content": PARSE_PROMPT + "\n\n题目/搭建要求（文字输入）：\n" + text,
    }])


PARSE_PATCH_PROMPT = """你是物理沙盒建场计划修订器。一次建场已执行，沙盒自动自查（放置穿透检测、运动探针、理论对照）发现了问题。请修订计划，使场景符合题目并消除问题。

修订规则：
- 输出与原计划完全同 schema 的严格 JSON（单行紧凑，无 markdown 代码块、无解释文字）。
- 只改有必要改的字段：优先调 position/velocity/length/angleDeg 等几何与初条件，其次 mass/friction。
- 题目明确给出的数值（题给质量/角度/初速等）绝不允许改动——如果自查问题源于题给数值本身，保持原样并在 assumptions 里说明。
- 沙盒世界约定：y 向上，地面在 y=0，动态体默认贴地静置；初速单位 m/s，位置单位米。
- 修不好/拿不准的地方保持原样，不要为消除报错而编造数值或删除实体。
- 常见处方：运动逃逸=初速过大或缺地面（补 ground 实体）；卡滞=嵌入/被夹（挪开或抬升）；穿透=位置错（重算落点）；理论偏差大=布局与题意不符（按题意重摆）。

当前计划 JSON：
"""


def _compact_plan(plan):
    """AG-567：payload 预算第一步——剥 null/空字段与注释元数据，plan 本体显著缩水。"""
    def clean(o):
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items()
                    if v is not None and v != [] and v != {} and k not in ("_note", "_fixture")}
        if isinstance(o, list):
            return [clean(x) for x in o]
        return o
    return clean(plan)


def call_step_patch(text, plan, verify):
    """AG-V3 修订通道：自查报告回喂模型，输出修订后的完整计划（同一 schema）。
    AG-567：预算分配制——plan 压缩去空 + issues 逐条截断（≤160 字×12 条），
    题目文字永远完整保留在末尾（旧版超长从尾部硬截，先截掉的恰是题目文字，
    模型失去校对基准）。"""
    brief = (verify or {}).get("issues") or []
    issues = ("\n".join("- " + b[:160] for b in brief[:12]) if brief else "（无明细，仅汇总计数）")
    question = (text or "").strip()
    tail = ("\n\n题目文字（可能为空，以它为准校对计划）：\n"
            + (question if question else "（无文字，按当前计划与自查问题修订）"))
    head = (PARSE_PATCH_PROMPT
            + json.dumps(_compact_plan(plan), ensure_ascii=False)
            + "\n\n自查问题（错误必须消除，提醒酌情参考）：\n" + issues)
    budget = 12000 - len(tail)
    if len(head) > budget:
        head = head[:budget]
    return call_step_messages([{"role": "user", "content": head + tail}])


class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".mjs": "text/javascript", ".wasm": "application/wasm"}

    def log_message(self, fmt, *args):
        # 只记 API 请求（PER-29/ENG-14）：静态资源日志刷屏且含 GBK 控制台乱码风险
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/status":
            self._json(200, {"ok": True, "key": bool(load_key()), "model": STEP_MODEL})
            return
        super().do_GET()

    def do_POST(self):
        if self.path not in ("/api/parse-question", "/api/parse-text", "/api/parse-patch"):
            self._json(404, {"ok": False, "error": "未知接口"})
            return
        if not load_key():
            self._json(503, {"ok": False, "error": "服务端未配置解析 API Key（可用示例数据验证链路）"})
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > MAX_BODY:
                self._json(413, {"ok": False, "error": "请求体过大（上限 8MB）"})
                return
            req = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            self._json(400, {"ok": False, "error": "请求体无效"})
            return
        try:
            if self.path == "/api/parse-text":
                text = str(req.get("text", "")).strip()
                if not text:
                    self._json(400, {"ok": False, "error": "文字要求为空"})
                    return
                if len(text) > 4000:
                    self._json(413, {"ok": False, "error": "文字过长（上限 4000 字符）"})
                    return
                parse = call_step_text(text)
            elif self.path == "/api/parse-patch":
                # AG-V3 修订通道：当前计划 + 自查问题清单回喂模型，出修订计划（同 schema）
                plan = req.get("plan")
                if not isinstance(plan, dict) or not plan.get("entities"):
                    self._json(400, {"ok": False, "error": "修订请求缺少有效计划"})
                    return
                parse = call_step_patch(str(req.get("text", "")).strip(), plan, req.get("verify"))
            else:
                data_url = req.get("image", "")
                if not data_url.startswith("data:image/") or "," not in data_url:
                    self._json(400, {"ok": False, "error": "图片格式无效"})
                    return
                b64 = data_url.split(",", 1)[1]
                if len(b64) * 3 / 4 > MAX_BODY:
                    self._json(413, {"ok": False, "error": "图片过大（上限 8MB）"})
                    return
                parse = call_step(data_url)
            self._json(200, {"ok": True, "parse": parse})
        except urllib.error.HTTPError as e:
            # 不透传上游响应体（可能含 key 相关信息），只给状态码归类；
            # retryable=结构化重试信号（AG-593）：401 鉴权失败绝不重试，429 退避后可重试
            if e.code == 401:
                self._json(502, {"ok": False, "error": "解析服务鉴权失败", "retryable": False})
            elif e.code == 429:
                self._json(502, {"ok": False, "error": "解析服务限流，请稍后重试", "retryable": True, "retryAfterMs": 3000})
            else:
                self._json(502, {"ok": False, "error": f"解析服务错误(HTTP {e.code})", "retryable": True})
        except json.JSONDecodeError as e:
            if "__truncated__" in str(getattr(e, "msg", "")):
                self._json(502, {"ok": False, "error": "模型输出被截断（达到 max_tokens 上限），请重试", "retryable": True})   # AG-508
            else:
                self._json(502, {"ok": False, "error": "解析服务返回了无法解析的内容，请重试", "retryable": True})
        except Exception as e:
            msg = "解析服务连接失败" + ("（超时）" if isinstance(e, TimeoutError) else "")
            self._json(502, {"ok": False, "error": msg, "retryable": True})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8721
    http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
