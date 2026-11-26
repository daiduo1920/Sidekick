window.KuroRegistry = (function () {
  function hexToRgb01(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  // =========================================================================
  // 1. REAL COMMERCIAL-GRADE 3D VRM ANIME MODELS (OPEN / CC0 / VRM LICENSE)
  //    Powered by Three.js + @pixiv/three-vrm (MToon + SpringBone + Expressions)
  // =========================================================================
  const AVATARS = [
    {
      id: 'vrm-sample-a',
      name: '青羽 · Yui',
      subtitle: 'VRoid 官方动漫少女 · MToon 三渲二 + 头发弹簧物理 + 全套表情',
      badge: 'VRM 3D',
      category: 'vrm',
      renderer: 'vrm3d',
      vrmUrl: './models/vrm/AvatarSample_A.vrm',
      thumbUrl: './models/vrm/AvatarSample_A.thumb.png',
      licenseNote: 'VRoid Studio Official Sample',
      eyeAnchor: { x: 0.50, y: 0.36 },
      peekEyeAnchor: { x: 0.50, y: 0.34 },
      previewAccent: '#4E6FA6',
      previewColors: ['#36486E', '#F8ECE4', '#E57A6B'],
    },
    {
      id: 'vrm-sample-b',
      name: '苍夜 · Ren',
      subtitle: 'VRoid 官方冷系少年 · 酷感层次短发 + 窗沿坐姿晃腿 + 眼动追踪',
      badge: 'VRM 3D',
      category: 'vrm',
      renderer: 'vrm3d',
      vrmUrl: './models/vrm/AvatarSample_B.vrm',
      thumbUrl: './models/vrm/AvatarSample_B.thumb.png',
      licenseNote: 'VRoid Studio Official Sample',
      eyeAnchor: { x: 0.50, y: 0.36 },
      peekEyeAnchor: { x: 0.50, y: 0.34 },
      previewAccent: '#384D75',
      previewColors: ['#232838', '#4F6E9E', '#E8D8C8'],
    },
    {
      id: 'vrm-vita',
      name: '维塔 · Vita',
      subtitle: 'VRoid CC0 元气少女 · 零版权限制 · 灵动短发与清爽休闲造型',
      badge: 'VRM CC0',
      category: 'vrm',
      renderer: 'vrm3d',
      vrmUrl: './models/vrm/Vita.vrm',
      thumbUrl: './models/vrm/Vita.thumb.png',
      licenseNote: 'VRoid Studio CC0 Public Domain',
      eyeAnchor: { x: 0.50, y: 0.36 },
      peekEyeAnchor: { x: 0.50, y: 0.34 },
      previewAccent: '#E05A3A',
      previewColors: ['#D85B43', '#F5EFE4', '#384256'],
    },
    {
      id: 'vrm-seed',
      name: '种子酱 · Seed-san',
      subtitle: 'VRM 1.0 官方标杆角色 · 完整 SpringBone 物理 + 高精表情形变',
      badge: 'VRM 1.0',
      category: 'vrm',
      renderer: 'vrm3d',
      vrmUrl: './models/vrm/Seed-san.vrm',
      thumbUrl: './models/vrm/Seed-san.thumb.png',
      licenseNote: 'VirtualCast VRM 1.0 Public License',
      eyeAnchor: { x: 0.50, y: 0.36 },
      peekEyeAnchor: { x: 0.50, y: 0.34 },
      previewAccent: '#639172',
      previewColors: ['#5C9A70', '#F5EFE2', '#E8A838'],
    },
  ];

  // =========================================================================
  // 2. KEYBOARD / GEAR / DESK COMPATIBILITY STUBS
  // =========================================================================
  const KEYBOARDS = [
    { id: 'signature', name: '模型原生台面', subtitle: '保留 BongoCat/模型自带画面', swatch: '#D65A3E', accentTop: '#D65A3E' },
    { id: 'retro-9009', name: '复古 9009', subtitle: '兼容占位', swatch: '#E6DEC8', accentTop: '#7BA484' },
    { id: 'none', name: '无桌面', subtitle: '纯净悬浮', swatch: 'transparent' },
  ];

  const GEARS = [
    { id: 'pebble-wireless', name: '常规键鼠', subtitle: '标准桌面交互', swatch: '#F6F2EA', accent: '#D85B43' },
    { id: 'none', name: '极简悬浮', subtitle: '仅角色展示', swatch: 'transparent' },
  ];

  const DESK_MATS = [
    { id: 'minimal-felt', name: '默认', deskTop: '#F3ECE0', ledColor: '#E49B50' },
  ];

  // =========================================================================
  // 5. CURATED EDITORIAL PALETTES (strict Hue-Shifting + 60/30/10 restraint!)
  // =========================================================================
  const PALETTES = [
    {
      id: 'washi-amber',
      name: '和纸朱砂',
      swatch: '#D85B43',
      accent: '#D85B43',
      accentSoft: 'rgba(216, 91, 67, 0.18)',
      rim: '#F2B863',
      particle: '#E8A838',
      heart: '#E46E78',
      studioRim3d: [0.96, 0.78, 0.56],
      studioWarm3d: [1.0, 0.93, 0.84],
    },
    {
      id: 'matcha-mist',
      name: '京都抹茶',
      swatch: '#639172',
      accent: '#639172',
      accentSoft: 'rgba(99, 145, 114, 0.18)',
      rim: '#B7D4A8',
      particle: '#7EB088',
      heart: '#E58086',
      studioRim3d: [0.68, 0.85, 0.70],
      studioWarm3d: [0.99, 0.95, 0.86],
    },
    {
      id: 'sakura-cream',
      name: '春樱奶霜',
      swatch: '#D96D85',
      accent: '#D96D85',
      accentSoft: 'rgba(217, 109, 133, 0.18)',
      rim: '#F5B8C4',
      particle: '#EE95A8',
      heart: '#E2627C',
      studioRim3d: [0.95, 0.72, 0.78],
      studioWarm3d: [1.0, 0.94, 0.92],
    },
    {
      id: 'dusk-indigo',
      name: '暮色蓝染',
      swatch: '#4E6FA6',
      accent: '#4E6FA6',
      accentSoft: 'rgba(78, 111, 166, 0.18)',
      rim: '#9BB5E0',
      particle: '#DF9558',
      heart: '#E07584',
      studioRim3d: [0.62, 0.74, 0.95],
      studioWarm3d: [0.96, 0.90, 0.84],
    },
    {
      id: 'coral-riso',
      name: '孔版柿红',
      swatch: '#E05A3A',
      accent: '#E05A3A',
      accentSoft: 'rgba(224, 90, 58, 0.18)',
      rim: '#E8B84B',
      particle: '#E8B84B',
      heart: '#E05A3A',
      studioRim3d: [0.94, 0.60, 0.48],
      studioWarm3d: [0.98, 0.94, 0.86],
    },
  ];

  const SOUND_PACKS = [
    { id: 'creamy-thock', name: '麻将闷响轴 · Creamy Thock', desc: '温润低沉客制化麻将音' },
    { id: 'tactile-blue', name: '清脆提前段落 · Crisp Tactile', desc: '干脆利落打字节奏感' },
    { id: 'silent-plush', name: '轻柔静音轴 · Silent Plush', desc: '极轻柔微声，深夜不扰人' },
  ];

  function findById(list, id, fallbackIdx) {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return list[fallbackIdx || 0];
  }

  return {
    hexToRgb01,
    avatars: AVATARS,
    keyboards: KEYBOARDS,
    gears: GEARS,
    deskMats: DESK_MATS,
    palettes: PALETTES,
    soundPacks: SOUND_PACKS,
    getAvatar(id, customAssets) {
      if (id && id.startsWith('custom:') && Array.isArray(customAssets)) {
        const cid = id.slice(7);
        const found = customAssets.find((a) => a.id === cid);
        if (found) {
          const renderer = found.kind === 'avatar3d'
            ? 'vrm3d'
            : (found.kind === 'live2d' ? 'live2d' : 'custom25d');
          return {
            id,
            name: found.name,
            subtitle: found.notes || '自定义外部模型资产',
            badge: found.kind === 'avatar3d' ? 'VRM / GLB' : (found.kind === 'live2d' ? 'Live2D' : '2.5D 自定'),
            artStyle: renderer,
            renderer,
            customAsset: found,
            eyeAnchor: { x: found.eyeAnchorX || 0.48, y: found.eyeAnchorY || 0.34 },
            peekEyeAnchor: { x: 0.50, y: 0.48 },
            previewAccent: '#4E6FA6',
            previewColors: ['#293550', '#F3EDE2', '#D85B43'],
            style: AVATARS[0].style,
          };
        }
      }
      return findById(AVATARS, id, 0);
    },
    getVariant(avatar, variantId) {
      if (!avatar || !Array.isArray(avatar.variants) || avatar.variants.length === 0) return null;
      if (variantId) {
        for (let i = 0; i < avatar.variants.length; i++) {
          if (avatar.variants[i].id === variantId) return avatar.variants[i];
        }
      }
      return avatar.variants[0];
    },
    getKeyboard(id) {
      if (id === 'signature') return KEYBOARDS[1];
      return findById(KEYBOARDS, id, 1);
    },
    getGear(id) { return findById(GEARS, id, 0); },
    getDeskMat(id) { return findById(DESK_MATS, id, 0); },
    getPalette(id) { return findById(PALETTES, id, 0); },
  };
})();
   