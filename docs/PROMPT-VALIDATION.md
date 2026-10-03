# 拍题解析真实模型抽查记录

> step-5-preview 逐类一次调用。密钥在服务端，输出经本地 /api/parse-question 代理。

## spring

```json
{
  "questionType": "弹簧振子周期计算",
  "kind": "spring",
  "goal": "由 m=1.5 kg、k=20 N/m 求水平弹簧振子的振动周期",
  "gravity": null,
  "entities": [
    {
      "type": "sphere",
      "name": "小球",
      "given": {
        "mass": 1.5
      },
      "confidence": 0.99
    }
  ],
  "observations": [
    "振动周期 T"
  ],
  "unknowns": [
    "振幅/初始拉伸量（题目未给出，但周期与振幅无关）"
  ],
  "assumptions": [
    "轻弹簧理想无质量，水平放置，不计摩擦与空气阻力，系统做简谐运动"
  ],
  "confidence": 0.98
}
```


## Round 15 后抽查补充（reasoning_content 回退修复后）

## hinge

```json
{
  "questionType": "复摆周期计算",
  "kind": "hinge",
  "goal": "求均匀细杆绕端点做小角度摆动的周期",
  "gravity": null,
  "entities": [
    {
      "type": "cylinder",
      "name": "均匀细杆",
      "given": {
        "length": 1,
        "mass": 1,
        "friction": 0
      },
      "confidence": 0.95
    }
  ],
  "observations": [
    "杆摆动的周期"
  ],
  "unknowns": [
    "重力加速度g的数值"
  ],
  "joint": null,
  "assumptions": [
    "取重力加速度 g = 9.8 m/s²（题目未明确给出）",
    "小角度摆动，适用简谐运动近似",
    "光滑铰链意味着无摩擦阻力",
    "细杆质量分布均匀，绕端点转动惯量为 I = mL²/3"
  ],
  "confidence": 0.95
}
```


## Round 15 后抽查补充（reasoning_content 回退修复后）

## hinge

```json
{
  "questionType": "复摆周期计算",
  "kind": "hinge",
  "goal": "求均匀细杆绕光滑铰链做小角度摆动的周期",
  "gravity": null,
  "entities": [
    {
      "type": "cylinder",
      "name": "均匀细杆",
      "given": {
        "length": 1,
        "mass": 1
      },
      "confidence": 1.0
    }
  ],
  "observations": [
    "杆摆动的周期"
  ],
  "unknowns": [
    "重力加速度g"
  ],
  "joint": null,
  "assumptions": [
    "重力加速度取 g = 9.8 m/s²",
    "摆动为小角度，满足简谐运动近似 sinθ≈θ",
    "光滑铰链无摩擦，空气阻力忽略不计"
  ],
  "confidence": 1.0
}
```



## Round 18：spin 类复测通过（提取链加固后）

Round 17 时 spin 类 502 BLOCKED。Round 18 诊断转储（MECH_PARSE_DEBUG）定位真根因：
**finish_reason="length"**——思考流耗 ~3300 token 后 4200 max_tokens 把 content JSON 中途截断。
三处修复：max_tokens→8192；提示词要求紧凑单行 JSON；`_extract_json` 统一提取链
（content 与 reasoning_content 同路径：questionType 启发式 + 括号配平感知字符串的兜底扫描，
离线 4 样本单测含「叙述中出现 questionType 字样」干扰项）。

修复后 question-spin.png 连续两次真实调用全通（ok:true），第二次输出存档
`tools/fixtures/parse-spin-real.json`（题给转动惯量 6.5 kg·m² 完整保留），
并经 `MECH.loadParse` 生产路径完成九步 E2E（p15：I 反解命中 6.5、L 漂移 0.000%、
末态 ω=2.271 与守恒解一致）。七类题型真实模型抽查至此全部打通。

```json
{
  "questionType": "转台滑块角动量守恒",
  "kind": "rotation",
  "goal": "求滑块从距轴 0.7 m 径向滑到距轴 1.3 m 时转台的角速度",
  "gravity": null,
  "entities": [
    { "type": "cylinder", "name": "转台", "given": { "momentOfInertia": 6.5, "angvel": [0, 3, 0] }, "confidence": 1.0 },
    { "type": "box", "name": "滑块", "given": { "mass": 2, "friction": 0 }, "confidence": 1.0 }
  ],
  "joint": { "from": 0, "to": 1, "axis": [1, 0, 0], "limits": [0.7, 1.3] },
  "observations": ["滑块滑到 1.3 m 时转台的角速度"],
  "assumptions": ["系统（转台+滑块）绕竖直轴角动量守恒", "摩擦不计", "转台转动惯量保持6.5 kg·m²不变，滑块视为质点"],
  "confidence": 1.0
}
```
