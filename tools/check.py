#!/usr/bin/env python3
"""MECHANICA 静态自检：vendor 完整性 / importmap 路径 / JS 括号配对 / id 交叉核验 / 契约字段"""
import re, sys, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
fails, warns = [], []

def need(p, cond=True, msg=None):
    if not p.exists() or not cond:
        fails.append(msg or f"缺失: {p}")

# 1. vendor 完整性
for rel, min_size in [
    ("vendor/three/three.module.js", 100_000),
    ("vendor/three/three.core.js", 500_000),
    ("vendor/rapier/rapier.mjs", 1_000_000),
    ("assets/hdri/studio_1k.hdr", 500_000),
    ("assets/textures/marble/color.jpg", 30_000),
    ("assets/textures/wood/color.jpg", 30_000),
    ("assets/textures/planet/saturn_color.jpg", 50_000),
]:
    p = ROOT / rel
    need(p, p.exists() and p.stat().st_size > min_size, f"{rel} 缺失或过小")

# 2. importmap 路径可达
html = (ROOT / "index.html").read_text(encoding="utf-8")
mp = re.search(r'<script type="importmap">(.*?)</script>', html, re.S)
if mp:
    imports = json.loads(mp.group(1))["imports"]
    for k, v in imports.items():
        if v.endswith(".js") and not (ROOT / v.lstrip("./")).exists():
            fails.append(f"importmap 指向不存在的文件: {k} -> {v}")
else:
    fails.append("index.html 缺少 importmap")

# 3. JS 括号/反引号配对（粗糙但抓 EOF）
def balance(path):
    src = path.read_text(encoding="utf-8")
    # 去行注释/块注释/字符串近似处理：粗扫计数即可（真语法错误靠浏览器 errbar 兜底）
    stack = []
    pairs = {")": "(", "]": "[", "}": "{"}
    in_s = None; esc = False; in_line = False; in_block = False
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        nxt = src[i+1] if i+1 < n else ""
        if in_line:
            if c == "\n": in_line = False
        elif in_block:
            if c == "*" and nxt == "/": in_block = False; i += 1
        elif in_s:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == in_s: in_s = None
        else:
            if c == "/" and nxt == "/": in_line = True; i += 1
            elif c == "/" and nxt == "*": in_block = True; i += 1
            elif c in "\"'`": in_s = c
            elif c in "([{": stack.append(c)
            elif c in ")]}":
                if not stack or stack[-1] != pairs[c]:
                    return f"{path.name}: 第{i}行 括号失配 {c}"
                stack.pop()
        i += 1
    if stack: return f"{path.name}: 未闭合 {stack[-5:]}"
    if in_s: return f"{path.name}: 字符串未闭合"
    return None

for js in ["src/main.js", "src/track-curve.js", "src/materials.js"]:
    p = ROOT / js
    if p.exists():
        r = balance(p)
        if r: fails.append(r)
    else:
        fails.append(f"缺失: {js}")

# 4. id 交叉核验：index.html 定义的 id vs main.js 绑定的 id
html_ids = set(re.findall(r'id="([^"]+)"', html))
js = (ROOT / "src/main.js").read_text(encoding="utf-8")
used = set(re.findall(r"\$\('([^']+)'\)", js))
missing = used - html_ids
if missing: fails.append(f"main.js 引用了不存在的 DOM id: {missing}")
handlers = set(re.findall(r"\$\('([A-Za-z]\w+)'\)\.onclick", js))
btns = set(re.findall(r'<button id="([^"]+)"', html))
no_handler = btns - handlers
if no_handler: fails.append(f"按钮无 onclick: {no_handler}")

# 5. 契约字段：track-curve.js 必须导出 main.js 用到的 META 字段
tc = (ROOT / "src/track-curve.js").read_text(encoding="utf-8") if (ROOT / "src/track-curve.js").exists() else ""
for field in ["releasePoint", "stopper", "segments", "pylonAnchors", "tubeRadius", "ballRadius"]:
    if f"{field}:" not in tc and field not in ("releasePoint",):
        warns.append(f"track-curve.js 未见到 META 字段 {field}")
for seg in ["platform", "loop"]:
    if seg not in tc: warns.append(f"track-curve.js 未见到段 {seg}")

# 6. em-dash / emoji 红线（UI 文案区）
for ch, name in [("\u2014", "em-dash"), ("\u2013", "en-dash")]:
    if ch in html: fails.append(f"index.html 出现 {name}")
emoji = re.findall(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]", html)
if emoji: fails.append(f"index.html 出现 emoji: {emoji[:3]}")

print("== MECHANICA check ==")
for w in warns: print("  WARN:", w)
if fails:
    for f in fails: print("  FAIL:", f)
    sys.exit(1)
print("  全部通过")
