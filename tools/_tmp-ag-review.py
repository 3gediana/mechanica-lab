# -*- coding: utf-8 -*-
# R6-F2 第三簇:AG-547 折叠/548 diff 高亮/550 attach 单位名/551 joint 名
import io

p = r"D:\mechanica-lab-r4\src\workbench.js"
s = io.open(p, encoding="utf-8").read()

# ---- AG-548:更新类条目 detail 结构化(旧值删除线/新值琥珀,零 innerHTML 注入面) ----
OLD = """      const diffs = [];
      for (const sect of ['params', 'physics', 'transform']) {
        const oldS = e[sect] || {}, newS = o[sect] || {};
        for (const [k, v] of Object.entries(newS)) {
          if (k === 'linvel' || k === 'angvel') continue;   // 向量太长，摘要略
          const ov = oldS[k];
          if (ov !== undefined && ov !== v && typeof v !== 'object') diffs.push(`${k} ${ov}→${v}`);
        }
      }
      agentChanges.push({
        type: 'entity', idx, reuseId,
        label: `更新已有 ${o.type}「${e.name || o.type}」`,
        detail: diffs.length ? diffs.slice(0, 4).join('，') : '位置/参数按题给重设',
        skipped: false,
      });"""
assert s.count(OLD) == 1
s = s.replace(OLD, """      const diffs = [];
      for (const sect of ['params', 'physics', 'transform']) {
        const oldS = e[sect] || {}, newS = o[sect] || {};
        for (const [k, v] of Object.entries(newS)) {
          if (k === 'linvel' || k === 'angvel') continue;   // 向量太长，摘要略
          const ov = oldS[k];
          if (ov !== undefined && ov !== v && typeof v !== 'object') diffs.push({ k, ov, v });   // AG-548：结构化,渲染层给样式
        }
      }
      agentChanges.push({
        type: 'entity', idx, reuseId,
        label: `更新已有 ${o.type}「${e.name || o.type}」`,
        detail: diffs.length ? '' : '位置/参数按题给重设',
        diffs: diffs.slice(0, 4),   // AG-548：diff 段数组（渲染旧值删除线/新值琥珀）
        skipped: false,
      });""", 1)

# ---- AG-551:joint 条目实体名 ----
OLD2 = "      label: `建立${jn}约束（实体 ${agentPlan.joint.from}→${agentPlan.joint.to}）`,"
assert s.count(OLD2) == 1
s = s.replace(OLD2, """      label: `建立${jn}约束（${(agentPlan.entities[agentPlan.joint.from] || {}).name || `实体${agentPlan.joint.from}`} → ${(agentPlan.entities[agentPlan.joint.to] || {}).name || `实体${agentPlan.joint.to}`}）`,""", 1)

# ---- AG-550:attach 条目单位+实体名 ----
OLD3 = "      label: `连接${at.type === 'rope' ? '绳' : '弹簧'}（实体 ${at.from}→${at.to}，k=${at.stiffness ?? '—'}）`,"
assert s.count(OLD3) == 1
s = s.replace(OLD3, """      label: `连接${at.type === 'rope' ? '绳' : '弹簧'}（${(agentPlan.entities[at.from] || {}).name || `实体${at.from}`} → ${(agentPlan.entities[at.to] || {}).name || '（布局自动补墙）'}${at.type === 'spring' ? `，k=${at.stiffness ?? '—'} N/m，原长 ${at.restLength ?? '—'} m` : `，绳长 ${at.length ?? '—'} m`}`),""", 1)

# ---- AG-548 渲染层:diff 段样式化 ----
OLD4 = """    const txt = document.createElement('span');
    txt.textContent = c.label + (c.detail ? `（${c.detail}）` : '');
    row.append(cb, txt);"""
assert s.count(OLD4) == 1
s = s.replace(OLD4, """    const txt = document.createElement('span');
    txt.textContent = c.label;
    if (c.diffs && c.diffs.length) {   // AG-548：旧值删除线灰、新值琥珀（全 textContent 零注入）
      const wrap = document.createElement('span');
      wrap.style.cssText = 'display:inline-flex;flex-wrap:wrap;gap:2px 8px;margin-left:4px';
      for (const d of c.diffs) {
        const seg = document.createElement('span');
        seg.style.cssText = 'font-family:var(--mono);font-size: 11px';
        const kEl = document.createElement('span'); kEl.textContent = d.k; kEl.style.color = 'var(--faint)';
        const oEl = document.createElement('span'); oEl.textContent = String(d.ov); oEl.style.cssText = 'text-decoration:line-through;color:var(--faint)';
        const aEl = document.createElement('span'); aEl.textContent = '→'; aEl.style.color = 'var(--faint)';
        const nEl = document.createElement('span'); nEl.textContent = String(d.v); nEl.style.color = 'var(--accent-hi)';
        seg.append(kEl, document.createTextNode(' '), oEl, document.createTextNode(' '), aEl, document.createTextNode(' '), nEl);
        wrap.appendChild(seg);
      }
      row.append(cb, txt, wrap);
    } else {
      if (c.detail) txt.textContent += `（${c.detail}）`;
      row.append(cb, txt);
    }""", 1)

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("workbench OK: AG-548/550/551")
