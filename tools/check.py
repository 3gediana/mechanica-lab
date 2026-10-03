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
    ("vendor/three/addons/controls/TransformControls.js", 30_000),
    ("vendor/rapier/rapier.mjs", 1_000_000),
    ("assets/hdri/studio_1k.hdr", 500_000),
    ("assets/textures/marble/color.jpg", 30_000),
    ("assets/textures/wood/color.jpg", 30_000),
    ("assets/textures/planet/saturn_color.jpg", 50_000),
]:
    p = ROOT / rel
    need(p, p.exists() and p.stat().st_size > min_size, f"{rel} 缺失或过小")

# 1b. 源文件存在性（工作台 + 引擎 + legacy 保留版 + Agent 解析切片）
for js in [
    "src/workbench.js",
    "src/engine/scene-doc.js", "src/engine/registry.js",
    "src/engine/runtime.js", "src/engine/viewport.js", "src/engine/presets.js",
    "src/engine/parse-schema.js", "src/engine/explain.js",
    "src/legacy-main.js", "src/track-curve.js", "src/materials.js",
]:
    need(ROOT / js, (ROOT / js).exists(), f"缺失: {js}")
for page in ["index.html", "classic.html"]:
    need(ROOT / page, (ROOT / page).exists(), f"缺失: {page}")
for tool in ["tools/serve.py", "tools/ui-test/p0.mjs", "tools/ui-test/p1.mjs", "tools/ui-test/p2.mjs", "tools/ui-test/p3.mjs", "tools/ui-test/p4.mjs", "tools/ui-test/p5.mjs", "tools/ui-test/p6.mjs", "tools/ui-test/p7.mjs", "tools/ui-test/p8.mjs", "tools/ui-test/p9.mjs", "tools/ui-test/p10.mjs", "tools/ui-test/p11.mjs", "tools/ui-test/p12.mjs", "tools/ui-test/p13.mjs", "tools/ui-test/p14.mjs"]:
    need(ROOT / tool, (ROOT / tool).exists(), f"缺失: {tool}")
for fx in ["tools/fixtures/question-incline.png", "tools/fixtures/parse-incline.json",
           "tools/fixtures/question-momentum.png", "tools/fixtures/parse-momentum.json",
           "tools/fixtures/parse-celestial.json", "tools/fixtures/parse-spin.json", "tools/fixtures/parse-spring.json", "tools/fixtures/parse-hinge.json", "tools/fixtures/parse-projectile.json", "tools/fixtures/parse-atwood.json"]:
    need(ROOT / fx, (ROOT / fx).exists(), f"缺失: {fx}")

# 1c. 密钥纪律：key / 上游端点 / 鉴权头只允许出现在服务端 tools/serve.py，前端零出现
SECRET_PATTERNS = ["3esUVr", "step_key", "api.stepfun", "Bearer"]
for rel in ["index.html", "classic.html", "src/workbench.js", "src/legacy-main.js",
            "src/materials.js", "src/track-curve.js",
            "src/engine/scene-doc.js", "src/engine/registry.js", "src/engine/runtime.js",
            "src/engine/viewport.js", "src/engine/presets.js", "src/engine/parse-schema.js",
            "src/engine/explain.js"]:
    txt = (ROOT / rel).read_text(encoding="utf-8")
    for pat in SECRET_PATTERNS:
        if pat in txt:
            fails.append(f"前端密钥泄漏红线: {rel} 含 '{pat}'")

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

# 3. JS 语法检查：node --check 为权威（粗扫器在模板串内嵌引号上会误报，已弃用）
import subprocess
for js in ["src/legacy-main.js", "src/track-curve.js", "src/materials.js",
           "src/workbench.js", "src/engine/scene-doc.js", "src/engine/registry.js",
           "src/engine/runtime.js", "src/engine/viewport.js", "src/engine/presets.js",
           "src/engine/parse-schema.js", "src/engine/explain.js"]:
    p2 = ROOT / js
    if not p2.exists():
        fails.append(f"缺失: {js}")
        continue
    r = subprocess.run(["node", "--check", str(p2)], capture_output=True, text=True)
    if r.returncode != 0:
        fails.append(f"JS 语法错误 {js}: {r.stderr.strip()[:200]}")

# 3b. 页面入口指向正确
if "src/workbench.js" not in html:
    fails.append("index.html 未指向 src/workbench.js")
classic = (ROOT / "classic.html").read_text(encoding="utf-8") if (ROOT / "classic.html").exists() else ""
if "src/legacy-main.js" not in classic:
    fails.append("classic.html 未指向 src/legacy-main.js")

# 4. id 交叉核验：index.html 定义的 id vs workbench.js 绑定的 id
html_ids = set(re.findall(r'id="([^"]+)"', html))
js = (ROOT / "src/workbench.js").read_text(encoding="utf-8")
used = set(re.findall(r"\$\('([^']+)'\)", js))
missing = used - html_ids
if missing: fails.append(f"workbench.js 引用了不存在的 DOM id: {missing}")
handlers = set(re.findall(r"\$\('([A-Za-z]\w+)'\)\.onclick", js))
btns = set(re.findall(r'<button id="([^"]+)"', html))
no_handler = btns - handlers
if no_handler: fails.append(f"按钮无 onclick: {no_handler}")

# 5. 契约字段：track-curve.js 必须导出 main.js 用到的 META 字段
tc = (ROOT / "src/track-curve.js").read_text(encoding="utf-8") if (ROOT / "src/track-curve.js").exists() else ""
for field in ["releasePoint", "stopper", "segments", "pylonAnchors", "tubeRadius", "ballRadius", "sideFrames"]:
    if f'"{field}"' not in tc:
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
