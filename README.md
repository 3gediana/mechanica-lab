# MECHANICA · 牛顿力学拟真沙盘

浏览器里的高保真物理实验台：真实刚体引擎（Rapier WASM）+ PBR 摄影棚渲染（three.js + HDRI + ACES）。
一颗铬钢球从大理石滑道释放，下坡、钻环、撞出木块；旁边是可抓取抛掷的橡胶球与真切换的单摆，展台上是土星。

## 运行

物理引擎经 ES module 加载，必须走本地 http 服务（file:// 会被 CORS 拦）：

```
cd D:\mechanica-lab
python -m http.server 8721
# 浏览器打开 http://127.0.0.1:8721
```

## 操作

- 左键拖动 = 旋转视角，滚轮 = 缩放
- 按住左键抓取铬球 / 橡胶球 / 木块，甩动松手 = 抛掷
- 底部控制台：抽开挡板（释放主角球）、暂停、慢速、重置
- 键盘：`SPACE` 暂停 / `R` 重置 / `F` 慢速 / `G` 抽挡板

## 场景清单

| 装置 | 物理内容 |
|---|---|
| 大理石滑道 + 竖直环轨 | 30° 下坡、C1 连续半管雪橇道（trimesh）、360° 环轨不掉落（能量守恒可行性已在注释给出推导） |
| 橡木块 | 跑道末端碰撞对象，密度 560 kg/m³，滑动+倾翻 |
| 单摆 | 轻绳关节（rope joint，仅拉不推），左仪表实时测摆动周期 |
| 橡胶球 | 高弹性（e=0.72）大摩擦，抓来抛 |
| 土星展台 | Solar System Scope CC-BY 真实贴图，黄铜座 |

## 技术

- 物理引擎 `@dimforge/rapier3d-compat` 0.21（Rust→WASM，固定步长 1/120s，确定性）
- 轨道 = 半管参数面：渲染 620 段 / 碰撞 trimesh 420×20，开口永远朝世界正上方，环顶不掉落按 2.7R 判据复核
- 渲染 three r186：HDRI 环境光（Poly Haven CC0 摄影棚）+ ACES + PCFSoft 阴影 + Reflector 真镜面地板 + 轻 bloom
- 材质全 PBR：ambientCG CC0 大理石/橡木贴图，铬钢球 metalness 1 / roughness 0.06
- 全部资产本地化，断网可跑

## 自检

```
python tools/check.py
```

vendor 完整性 / importmap 路径 / JS 括号配对 / DOM id 交叉核验 / 契约字段 / 文案红线（em-dash、emoji）。

## 目录

```
index.html          页面壳 + importmap + UI
src/main.js         场景搭建、物理、交互、渲染循环
src/track-curve.js  滑道曲线数据（python 数值验证过）
src/materials.js    PBR 材质库（贴图缺失自动降级）
vendor/             three r186 + rapier 0.21 本地拷贝
assets/             HDRI / PBR 贴图 / 行星贴图
tools/check.py      静态自检
```

## 授权

- 代码：本项目自有
- three.js MIT；Rapier Apache-2.0
- HDRI / PBR 贴图：Poly Haven、ambientCG（CC0）
- 行星贴图：Solar System Scope（CC BY 4.0）
