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
 "entities": [
   {"type": "ramp|sphere|box|cylinder|ground",
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
 "assumptions": ["你做的假设"],
 "confidence": 0到1
}
规则补充：
- kind 填 "rotation" 时给 joint（转台体索引 from、滑块体索引 to、径向滑槽参数）。
- 转台初始角速度写在其 given.angvel = [0, ω, 0]。
规则：
- type 必须从六个值中选：斜面/楔子=ramp，球=sphere，方块/物块=box，圆柱=cylinder，地面=ground，定滑轮/滑轮=pulley。无关实体不要列。
- 定滑轮/阿特伍德题：kind 填 atwood，滑轮 type=pulley（given 带 radius 和 position），两物体 type 用 sphere 或 box（given 带各自的 mass；若题目给初速度写 velocity）。
- given 只写题目文字或图中明确给出的数值；没给的键不要写。
- 题目说"不计摩擦"时 friction 写 0 并在 assumptions 说明；"由静止释放"时 velocity 不写（默认零）。
- 题目未明确给重力加速度时 gravity 填 null（不要猜 0 或 10）；gravity 禁止填 0（除非题目明确是失重/零重力环境）。
- 缺失的重要条件写进 unknowns；你补充的工程默认值写进 assumptions；按惯例处理但无题图依据的写进 uncertain。
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
    qi = text.find('"questionType"')
    if qi != -1:
        start = text.rfind('{', 0, qi)
        end = text.rfind('}')
        if start != -1 and end > start:
            candidates.append(text[start:end + 1])
    # 兜底：首个 { 起做括号配平扫描（感知字符串），取最后一个 depth==0 闭合点
    # ——同时处理「JSON 前后夹推理文字」与「思考流里模型自拟的样例 JSON」
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
                if depth == 0: last_full = i; break
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


class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".mjs": "text/javascript", ".wasm": "application/wasm"}

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

    def do_POST(self):
        if self.path not in ("/api/parse-question", "/api/parse-text"):
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
            # 不透传上游响应体（可能含 key 相关信息），只给状态码归类
            msg = {401: "解析服务鉴权失败", 429: "解析服务限流，请稍后重试"}.get(e.code, f"解析服务错误(HTTP {e.code})")
            self._json(502, {"ok": False, "error": msg})
        except json.JSONDecodeError:
            self._json(502, {"ok": False, "error": "解析服务返回了无法解析的内容，请重试"})
        except Exception as e:
            msg = "解析服务连接失败" + ("（超时）" if isinstance(e, TimeoutError) else "")
            self._json(502, {"ok": False, "error": msg})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8721
    http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
