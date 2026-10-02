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

export async function createMaterials() {
  const [marbleC, marbleR, marbleN, woodC, woodR, saturnC, ringC] = await Promise.all([
    loadTex(`${TEX}marble/color.jpg`, { srgb: true, repeat: REPEAT_MARBLE }),
    loadTex(`${TEX}marble/roughness.jpg`, { repeat: REPEAT_MARBLE }), // 粗糙度/法线图保持默认线性色彩空间
    loadTex(`${TEX}marble/normal.jpg`, { repeat: REPEAT_MARBLE }),
    loadTex(`${TEX}wood/color.jpg`, { srgb: true, repeat: REPEAT_WOOD }),
    loadTex(`${TEX}wood/roughness.jpg`, { repeat: REPEAT_WOOD }),
    loadTex(`${TEX}planet/saturn_color.jpg`, { srgb: true }),
    loadTex(`${TEX}planet/saturn_ring.png`, { srgb: true }),
  ]);

  return {
    // 铬钢球（主角）：抛光铬实测反射率 ≈0.9，metalness 1 + roughness 0.06 得锐利镜面高光
    chrome: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06, envMapIntensity: 1.25 }),
    // 暗钢支架：metalness 0.9 模拟表面微氧化层，roughness 0.42 呈哑光机加质感
    steelDark: new THREE.MeshPhysicalMaterial({ color: 0x2e3134, metalness: 0.9, roughness: 0.42, envMapIntensity: 0.9 }),

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

    // 橡木块：木料为电介质（metalness 默认 0），roughness 0.72 ≈ 木蜡油半哑光表面
    wood: new THREE.MeshPhysicalMaterial({
      color: woodC ? 0xffffff : 0x8a6a48, // 降级为橡木暖棕
      roughness: woodR ? 1.0 : 0.72,
      ...(woodC && { map: woodC }),
      ...(woodR && { roughnessMap: woodR }),
      envMapIntensity: 0.55, // 木料弱反射，压低环境强度避免塑料感
    }),

    // 橡胶球：roughness 0.94 近全哑光，纯电介质，漫射为主几乎无高光
    rubber: new THREE.MeshPhysicalMaterial({ color: 0x17181a, roughness: 0.94, metalness: 0 }),

    // 黄铜展台：抛光黄铜反射率 ≈0.8，roughness 0.28 呈缎面拉丝高光
    brass: new THREE.MeshPhysicalMaterial({ color: 0x9c7a3c, metalness: 1, roughness: 0.28, envMapIntensity: 1.1 }),

    // 恒星（天体场景）：自发光为主，暗场里作为光源质感出现，不靠环境反射
    sun: new THREE.MeshStandardMaterial({
      color: 0xffc46b, emissive: 0xff9a2a, emissiveIntensity: 1.35, roughness: 1, metalness: 0,
    }),

    // 土星本体：气态行星以漫射为主，roughness 0.95 消除镜面高光
    saturn: new THREE.MeshPhysicalMaterial({
      color: saturnC ? 0xffffff : 0xc9b38a, // 降级为云带米金色
      roughness: 0.95, metalness: 0,
      ...(saturnC && { map: saturnC }),
    }),

    // 土星环：PNG 自带 alpha 故 transparent；depthWrite false 防半透明环片深度排序错误；双面可见
    saturnRing: ringC ? new THREE.MeshPhysicalMaterial({
      map: ringC, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.85, metalness: 0,
    }) : null, // 契约：环图缺失返回 null，下游跳过渲染环

    // 反光地板覆层：近黑基色压暗摄影棚地面，roughness 0.5 只留温润反光，opacity 0.9 透出镜面地板的克制倒影
    floorOverlay: new THREE.MeshPhysicalMaterial({ color: 0x0a0a0c, roughness: 0.5, metalness: 0, transparent: true, opacity: 0.9 }),
  };
}
