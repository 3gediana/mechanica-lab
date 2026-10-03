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

