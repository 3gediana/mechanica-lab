// materials.js — 3D 物理沙盘材质库（暗色摄影棚 · 仪器级高级感）
// 约定：全部 MeshPhysicalMaterial，参数取 PBR 实测量级（metalness 金属度 / roughness 微表面
// 粗糙度 0 镜面→1 哑光 / envMapIntensity 环境反射倍率）；贴图逐张独立降级，单张失败不 throw。
import * as THREE from 'three';

const TEX = './assets/textures/'; // 贴图根路径，文件名为跨代理固定契约

// repeat 约定：marble 滑道细长，(4,2) 平铺防纹理拉伸；wood 块料 (1,1) 保持原比例
const REPEAT_MARBLE = { x: 4, y: 2 };
const REPEAT_WOOD = { x: 1, y: 1 };
const ANISOTROPY = 8; // 各向异性过滤 8：斜视角下高光纹理更锐利，画质/性能平衡值（上限 16）

// 逐张加载：失败只 console.warn 并返回 null，由上层降级为程序化材质
async function loadTex(url, { srgb = false, repeat = null } = {}) {
  try {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace; // 颜色图必须 sRGB 解码，否则整体偏亮发灰
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; // 环绕平铺，repeat 才能无缝拼接
    tex.anisotropy = ANISOTROPY;
    if (repeat) tex.repeat.set(repeat.x, repeat.y);
    return tex;
  } catch {
    console.warn(`[materials] 贴图缺失，已降级: ${url}`);
    return null;
  }
}

// ---------- 程序化贴图（MAT-69/72/74）：canvas 现场生成，不新增图片文件 ----------

// 256² 径向临边昏暗 emissiveMap（MAT-69）：中心 1.0 → 边缘 0.72，恒星盘面亮度向边缘自然回落，
// 去掉"均匀涂色球"的廉价感（真实恒星临边昏暗的静态近似）
function sunLimbTexture() {
  const S = 256, half = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.min(1, Math.hypot(x + 0.5 - half, y + 0.5 - half) / half); // 0 中心 → 1 边缘
    const v = Math.round(255 * (1.0 - 0.28 * d)); // 1.0 → 0.72
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; // emissiveMap 属颜色图，须 sRGB 解码
  return tex;
}

// 256² 水平拉丝 roughnessMap（MAT-72）：行级 0.35~0.5 值带 + 行内 ±0.015 微扰。
// 幅度刻意克制 —— 呈机加件拉丝高光的轻微方向感，而不是塑料宽条纹
function brushedSteelTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    const base = 0.35 + Math.random() * 0.15; // 每行一条拉丝痕
    for (let x = 0; x < S; x++) {
      const v = Math.round(255 * Math.min(1, Math.max(0, base + (Math.random() - 0.5) * 0.03)));
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c); // 数据图保持默认线性色彩空间
}

// 128² 微噪声 roughnessMap（MAT-74）：0.90~0.97 逐像素抖动，近全哑光里的橡胶颗粒质感
function rubberNoiseTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = Math.round(255 * (0.90 + Math.random() * 0.07));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c); // 线性色彩空间
}

// 程序化环境球（用户实锤：铬球反射的是网图 HDRI 摄影棚——柔光箱/白反光板/暗房间在场景里
// 都不存在，两张皮）。env 内容按主视口真实三灯位生成：主光暖柔光箱 (4.5,7.5,3.5)、
// 冷灰补光 (-5,3.5,-4)、冷色轮廓条 (-3.5,5.5,-5.5)、石墨地面微回弹、0x0b0c0e 暗幕。
// 金属/清漆反射的都是「场景里真存在的光」，主视口与缩略图共用同一份。
let sharedEnv = null;
export function createEnvironment(renderer) {
  if (sharedEnv) return sharedEnv;
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x0b0c0e);
  const panel = (w, h, color, intensity, pos) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
    return m;
  };
  // 面板刻意大而亮：金属的可读性=大源柔光占比（暗幕全包围时铬球会黑成塑料）
  panel(5.0, 3.5, 0xfff1dd, 6.0, [4.5, 7.5, 3.5]);   // 主柔光箱（与 key 光同位同色）
  panel(4.0, 3.0, 0xbcccdd, 1.5, [-5, 3.5, -4]);     // 冷灰补光板
  panel(6.0, 1.5, 0x8ab0d0, 2.5, [-3.5, 5.5, -5.5]); // 冷色轮廓长条
  panel(3.0, 4.0, 0xfff1dd, 1.2, [-4, 2.5, 3.5]);    // 前左反光板：暗侧给一条高光，球面不断黑
  { // 石墨地面回弹：反射下半球不至于死黑
    const g = new THREE.Mesh(new THREE.PlaneGeometry(12, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0x23262b).multiplyScalar(2.5) }));
    g.rotation.x = Math.PI / 2; g.position.y = -3; env.add(g);
  }
  { // 暗摄影棚底衬：全向深灰包裹——金属基反射=深灰而非死黑（黑漆化），高光贴片仍由柔光箱主导
    const shell = new THREE.Mesh(new THREE.SphereGeometry(30, 24, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0x1d2026).multiplyScalar(5.0), side: THREE.BackSide }));
    env.add(shell);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  sharedEnv = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  return sharedEnv;
}

// 单例缓存（MAT-68）：registry.celestial 的环 mesh 需跨模块复用这里的 saturnRing；
// workbench/legacy 各自 await 一次，重复调用幂等返回同一份（材质全 app 生命周期只读共享）
let shared = null;

// 同步取已构建的材质表；createMaterials() 完成前为 null，下游按"缺贴图跳过"契约降级
export function getSharedMaterials() {
  return shared;
}

export async function createMaterials() {
  if (shared) return shared;
  const [marbleC, marbleR, marbleN, woodC, woodR, woodN, saturnC, jupiterC, marsC, ringC] = await Promise.all([
    loadTex(`${TEX}marble/color.jpg`, { srgb: true, repeat: REPEAT_MARBLE }),
    loadTex(`${TEX}marble/roughness.jpg`, { repeat: REPEAT_MARBLE }), // 粗糙度/法线图保持默认线性色彩空间
    loadTex(`${TEX}marble/normal.jpg`, { repeat: REPEAT_MARBLE }),
    loadTex(`${TEX}wood/color.jpg`, { srgb: true, repeat: REPEAT_WOOD }),
    loadTex(`${TEX}wood/roughness.jpg`, { repeat: REPEAT_WOOD }),
    loadTex(`${TEX}wood/normal.jpg`, { repeat: REPEAT_WOOD }), // MAT-66：法线图，线性色彩空间
    loadTex(`${TEX}planet/saturn_color.jpg`, { srgb: true }),
    loadTex(`${TEX}planet/jupiter_color.jpg`, { srgb: true }), // MAT-67：盘上已有、此前未加载
    loadTex(`${TEX}planet/mars_color.jpg`, { srgb: true }),    // MAT-67：同上
    loadTex(`${TEX}planet/saturn_ring.png`, { srgb: true }),
  ]);

  const mats = {
    // 铬钢球（主角）：抛光铬实测反射率 ≈0.9，metalness 1 + roughness 0.06 得锐利镜面高光
    chrome: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06, envMapIntensity: 1.25 }),
    // 暗钢支架：metalness 0.9 模拟表面微氧化层；水平拉丝 roughnessMap 驱动 0.35~0.5 值带（MAT-72），
    // 标量 roughness 1.0 交由贴图全权驱动，高光沿拉丝方向轻微展开
    steelDark: new THREE.MeshPhysicalMaterial({
      color: 0x2e3134, metalness: 0.9, roughness: 1.0, envMapIntensity: 0.9,
      roughnessMap: brushedSteelTexture(),
    }),

    // 抛光大理石滑道：有图时 color 置白防染色（map 与 color 相乘），roughness 1.0 交由贴图全权驱动
    marble: new THREE.MeshPhysicalMaterial({
      color: marbleC ? 0xffffff : 0xe8e5df, // 降级基色取卡拉拉白米色调
      roughness: marbleR ? 1.0 : 0.18, // 无粗糙度贴图时 0.18 ≈ 抛光石材实测
      ...(marbleC && { map: marbleC }),
      ...(marbleR && { roughnessMap: marbleR }),
      ...(marbleN && { normalMap: marbleN, normalScale: new THREE.Vector2(0.6, 0.6) }), // normalScale 0.6 抑制法线强度防凹凸过假
      metalness: 0, // 石材为电介质，无金属反射
      clearcoat: 1.0, clearcoatRoughness: 0.06, // 清漆层模拟大理石打蜡抛光面，反光滑道质感关键
      envMapIntensity: 1.0,
    }),

    // 橡木块：木料为电介质（metalness 默认 0），roughness 0.72 ≈ 木蜡油半哑光表面；
    // normal.jpg 补载（MAT-66）：normalScale 0.5 温和木纹凹凸，再强会塑料化
    wood: new THREE.MeshPhysicalMaterial({
      color: woodC ? 0xffffff : 0x8a6a48, // 降级为橡木暖棕
      roughness: woodR ? 1.0 : 0.72,
      ...(woodC && { map: woodC }),
      ...(woodR && { roughnessMap: woodR }),
      ...(woodN && { normalMap: woodN, normalScale: new THREE.Vector2(0.5, 0.5) }),
      envMapIntensity: 0.55, // 木料弱反射，压低环境强度避免塑料感
    }),

    // 橡胶球：近全哑光电介质；128² 微噪声 roughnessMap（0.90~0.97，MAT-74）给表面颗粒感
    rubber: new THREE.MeshPhysicalMaterial({
      color: 0x17181a, roughness: 1.0, metalness: 0,
      roughnessMap: rubberNoiseTexture(),
    }),

    // 哑光塑料（MAT-75）：冷灰烟色（与背景带同族色相），roughness 0.55 + 极薄 clearcoat 0.06 ——
    // 教学器材外壳的均匀半哑光，只余一层若隐若现的表面膜
    mattePlastic: new THREE.MeshPhysicalMaterial({ color: 0x9aa0a6, roughness: 0.55, metalness: 0, clearcoat: 0.06 }),

    // 粉笔（MAT-75）：0xd8d5cf 暖白近全哑光（roughness 0.98），黑板/桌面教学件的干燥矿物质感
    chalk: new THREE.MeshPhysicalMaterial({ color: 0xd8d5cf, roughness: 0.98, metalness: 0 }),

    // 黄铜展台：抛光黄铜反射率 ≈0.8，roughness 0.28 缎面拉丝高光；
    // clearcoat 0.25/0.35（MAT-73）加一层薄蜡质亮膜 —— 亮而不刺眼，守住摄影棚克制语言
    brass: new THREE.MeshPhysicalMaterial({ color: 0x9c7a3c, metalness: 1, roughness: 0.28, envMapIntensity: 1.1, clearcoat: 0.25, clearcoatRoughness: 0.35 }),

    // 恒星（天体场景）：自发光为主，暗场里作为光源质感出现，不靠环境反射；
    // 程序化径向临边昏暗 emissiveMap（MAT-69）：盘面中心 1.0 → 边缘 0.72
    sun: new THREE.MeshStandardMaterial({
      color: 0xffc46b, emissive: 0xff9a2a, emissiveIntensity: 1.35, roughness: 1, metalness: 0,
      emissiveMap: sunLimbTexture(),
    }),

    // 土星本体：气态行星以漫射为主，roughness 0.95 消除镜面高光
    saturn: new THREE.MeshPhysicalMaterial({
      color: saturnC ? 0xffffff : 0xc9b38a, // 降级为云带米金色
      roughness: 0.95, metalness: 0,
      envMapIntensity: 0.35, // 环境反射梯度（MAT-71）：chrome 1.25 镜面主角 > wood 0.55 弱反射介质 > 行星 0.35 深空漫射体仅余微弱拾光
      ...(saturnC && { map: saturnC }),
    }),

    // 木星本体（MAT-67，结构同 saturn）：条带云层 + 大红斑贴图，降级米棕条带色
    jupiter: new THREE.MeshPhysicalMaterial({
      color: jupiterC ? 0xffffff : 0xc8a678,
      roughness: 0.95, metalness: 0,
      envMapIntensity: 0.35, // 同 saturn（MAT-71 梯度）
      ...(jupiterC && { map: jupiterC }),
    }),

    // 火星本体（MAT-67，结构同 saturn）：锈红氧化铁表面贴图，降级铁锈红
    mars: new THREE.MeshPhysicalMaterial({
      color: marsC ? 0xffffff : 0xb5623c,
      roughness: 0.95, metalness: 0,
      envMapIntensity: 0.35, // 同 saturn（MAT-71 梯度）
      ...(marsC && { map: marsC }),
    }),

    // 土星环：PNG 自带 alpha 故 transparent；depthWrite false 防半透明环片深度排序错误；双面可见
    saturnRing: ringC ? new THREE.MeshPhysicalMaterial({
      map: ringC, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.85, metalness: 0,
    }) : null, // 契约：环图缺失返回 null，下游跳过渲染环

    // 反光地板覆层：近黑基色压暗摄影棚地面，roughness 0.5 只留温润反光，opacity 0.9 透出镜面地板的克制倒影
    floorOverlay: new THREE.MeshPhysicalMaterial({ color: 0x0a0a0c, roughness: 0.5, metalness: 0, transparent: true, opacity: 0.9 }),

    // 水（U-LIQ 液体）：透蓝水体，depthWrite 关闭防透明排序吃面；clearcoat 薄膜给水面高光
    water: new THREE.MeshPhysicalMaterial({
      color: 0x2f7fae, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.42,
      depthWrite: false, envMapIntensity: 1.0, clearcoat: 0.4, clearcoatRoughness: 0.1,
    }),

    // 玻璃（U-LIQ 水槽壁/底）：近透明薄壳
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xdfe9ee, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.14,
      depthWrite: false, envMapIntensity: 1.2,
    }),

    // 绳（U1 审计）：原用 steelDark——暗钢细圆柱贴暗背景不可见（单摆摆绳消失实锤）。
    // 黑板教学画的就是白绳：麻白暖灰全哑光，任何背景都可读
    rope: new THREE.MeshPhysicalMaterial({ color: 0xcfc8b8, roughness: 0.9, metalness: 0 }),

    // 影棚地台（U1 审计）：地面板专用。原默认 steelDark 的程序化拉丝 roughnessMap 铺上 12m
    // 大平面会摩尔条纹化成瓦楞钢皮；地台回归「无声承托」——冷石墨全哑光 + 一层若隐若现的
    // 清漆膜（clearcoatRoughness 0.5 漫射开），网格线/阴影/物体在其上保持可读
    floor: new THREE.MeshPhysicalMaterial({ color: 0x1b1e22, roughness: 0.88, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.5 }),
  };
  shared = mats;
  return mats;
}
