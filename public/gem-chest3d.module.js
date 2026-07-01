import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// Hộp quà "Gem Gift" — thiết kế riêng cho Milestones, KHÁC HẲN rương vuông
// wood/silver/gold ở chest3d.module.js (rương đó dùng cho Mailbox/Community
// Chest). Hộp vuông + nơ ru-y-băng + 1 viên đá quý phát sáng.
// 26 styles: 6 cũ (bronze/jade/silver/gold/ruby/diamond) + 20 mới.
// Mỗi style khác nhau về: màu gem, màu thân, màu ribbon, VÀ hình dạng gem.

const GEM_COLORS = {
  // ── 6 styles cũ (giữ nguyên backward compat) ──────────────────────────
  bronze: 0xffb070, jade: 0x7CFFC4, silver: 0xe8eef5, gold: 0xffe27a,
  ruby: 0xff7a90, diamond: 0xbdf3ff,
  // ── Group 1: Octahedron gem (classic diamond shape) ───────────────────
  crimson: 0xff3b3b, amethyst: 0xc084fc, sapphire: 0x60a5fa,
  citrine: 0xfde047, emerald: 0x4ade80,
  // ── Group 2: Icosahedron gem (rounded crystal ball) ───────────────────
  arctic: 0xe0f2fe, rose_quartz: 0xfbcfe8, moonstone: 0xd1fae5,
  topaz: 0xfdba74, tanzanite: 0xa78bfa,
  // ── Group 3: Tetrahedron gem (sharp pyramid shard) ────────────────────
  obsidian: 0x94a3b8, ancient: 0xfef08a, jade_deep: 0x86efac,
  shadow: 0x6366f1, volcano: 0xf97316,
  // ── Group 4: Dodecahedron gem (layered faceted orb) ──────────────────
  galaxy: 0xc4b5fd, aurora: 0x34d399, solar: 0xfcd34d,
  nebula: 0xf472b6, void: 0x38bdf8,
};

const TIER_BODY = {
  bronze: 0x9c6b3f, jade: 0x1e6b54, silver: 0x9aa3ad, gold: 0xb8862e,
  ruby: 0x8a1f33, diamond: 0xcfd8e3,
  crimson: 0x8a0020, amethyst: 0x581c87, sapphire: 0x1e3a8a,
  citrine: 0x854d0e, emerald: 0x14532d,
  arctic: 0x0c4a6e, rose_quartz: 0x831843, moonstone: 0x374151,
  topaz: 0x7c2d12, tanzanite: 0x1e1b4b,
  obsidian: 0x0f172a, ancient: 0x78350f, jade_deep: 0x052e16,
  shadow: 0x1e1b4b, volcano: 0x7f1d1d,
  galaxy: 0x0c0420, aurora: 0x064e3b, solar: 0x1c1400,
  nebula: 0x4a044e, void: 0x020617,
};

const TIER_RIBBON = {
  bronze: 0xd8a86a, jade: 0x7CFFC4, silver: 0xe8eef5, gold: 0xffe27a,
  ruby: 0xff7a90, diamond: 0xbdf3ff,
  crimson: 0xff6b6b, amethyst: 0xa855f7, sapphire: 0x3b82f6,
  citrine: 0xfacc15, emerald: 0x22c55e,
  arctic: 0xbae6fd, rose_quartz: 0xf9a8d4, moonstone: 0xa7f3d0,
  topaz: 0xfb923c, tanzanite: 0x8b5cf6,
  obsidian: 0x475569, ancient: 0xfbbf24, jade_deep: 0x4ade80,
  shadow: 0x4f46e5, volcano: 0xef4444,
  galaxy: 0x7c3aed, aurora: 0x10b981, solar: 0xf59e0b,
  nebula: 0xec4899, void: 0x0284c7,
};

// Hình dạng gem theo style — 4 loại geometry tạo visual thật sự khác nhau
const GEM_SHAPE = {
  bronze: 'octahedron', jade: 'octahedron', silver: 'octahedron',
  gold: 'octahedron', ruby: 'octahedron', diamond: 'octahedron',
  crimson: 'octahedron', amethyst: 'octahedron', sapphire: 'octahedron',
  citrine: 'octahedron', emerald: 'octahedron',
  arctic: 'icosahedron', rose_quartz: 'icosahedron', moonstone: 'icosahedron',
  topaz: 'icosahedron', tanzanite: 'icosahedron',
  obsidian: 'tetrahedron', ancient: 'tetrahedron', jade_deep: 'tetrahedron',
  shadow: 'tetrahedron', volcano: 'tetrahedron',
  galaxy: 'dodecahedron', aurora: 'dodecahedron', solar: 'dodecahedron',
  nebula: 'dodecahedron', void: 'dodecahedron',
};

function makeGemGeometry(shape) {
  switch (shape) {
    case 'icosahedron':  return new THREE.IcosahedronGeometry(0.14, 0);
    case 'tetrahedron':  return new THREE.TetrahedronGeometry(0.16, 0);
    case 'dodecahedron': return new THREE.DodecahedronGeometry(0.13, 0);
    default:             return new THREE.OctahedronGeometry(0.14, 0);
  }
}

function buildScene(canvas, tier) {
  const gemColor   = GEM_COLORS[tier]  || GEM_COLORS.gold;
  const bodyColor  = TIER_BODY[tier]   || TIER_BODY.gold;
  const ribbonColor = TIER_RIBBON[tier] || TIER_RIBBON.gold;
  const gemShape   = GEM_SHAPE[tier]   || 'octahedron';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
  camera.position.set(1.3, 1.15, 1.7);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const dir = new THREE.DirectionalLight(0xffffff, 1.15);
  dir.position.set(2, 3, 2);
  scene.add(dir);
  const rim = new THREE.DirectionalLight(0xfff2cc, 0.5);
  rim.position.set(-2, 1, -1.5);
  scene.add(rim);

  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 0.9, 1.05),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.38, metalness: 0.08 })
  );
  group.add(body);

  const ribbonMat = new THREE.MeshStandardMaterial({
    color: ribbonColor, metalness: 0.7, roughness: 0.22,
    emissive: 0x6b4f00, emissiveIntensity: 0.15,
  });

  const ribbonV = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.94, 1.09), ribbonMat);
  group.add(ribbonV);
  const ribbonH = new THREE.Mesh(new THREE.BoxGeometry(1.09, 0.94, 0.2), ribbonMat);
  group.add(ribbonH);

  const bowPivot = new THREE.Group();
  bowPivot.position.y = 0.48;
  const loopGeo = new THREE.TorusGeometry(0.16, 0.06, 10, 20);
  const loopL = new THREE.Mesh(loopGeo, ribbonMat);
  loopL.position.set(-0.13, 0, 0);
  loopL.rotation.y = Math.PI / 2.4;
  bowPivot.add(loopL);
  const loopR = new THREE.Mesh(loopGeo, ribbonMat);
  loopR.position.set(0.13, 0, 0);
  loopR.rotation.y = -Math.PI / 2.4;
  bowPivot.add(loopR);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), ribbonMat);
  bowPivot.add(knot);
  group.add(bowPivot);

  const gemMat = new THREE.MeshStandardMaterial({
    color: gemColor, emissive: gemColor, emissiveIntensity: 0.9,
    roughness: 0.1, metalness: 0.15,
  });
  const gem = new THREE.Mesh(makeGemGeometry(gemShape), gemMat);
  gem.position.y = 0.5 + 0.16;
  group.add(gem);

  const gemLight = new THREE.PointLight(gemColor, 0.6, 2.2);
  gemLight.position.copy(gem.position);
  group.add(gemLight);

  group.rotation.y = -0.35;
  scene.add(group);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.render(scene, camera);

  let spinRafId = null;
  function spinTick() {
    group.rotation.y += 0.006;
    renderer.render(scene, camera);
    spinRafId = requestAnimationFrame(spinTick);
  }
  spinRafId = requestAnimationFrame(spinTick);

  let rafId = null;
  function open() {
    if (rafId) return;
    const start = performance.now();
    const duration = 650;
    const fromScale = 1, peakScale = 1.18;
    const fromGlow = gemMat.emissiveIntensity, peakGlow = 2.2;
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const bounce = Math.sin(t * Math.PI);
      const eased = 1 - Math.pow(1 - bounce, 2);
      const scale = fromScale + (peakScale - fromScale) * eased;
      group.scale.set(scale, scale, scale);
      gemMat.emissiveIntensity = fromGlow + (peakGlow - fromGlow) * eased;
      gemLight.intensity = 0.6 + 1.4 * eased;
      renderer.render(scene, camera);
      if (t < 1) rafId = requestAnimationFrame(tick);
      else {
        group.scale.set(1, 1, 1);
        gemMat.emissiveIntensity = fromGlow;
        gemLight.intensity = 0.6;
        renderer.render(scene, camera);
        rafId = null;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  function dispose() {
    if (rafId) cancelAnimationFrame(rafId);
    if (spinRafId) cancelAnimationFrame(spinRafId);
    renderer.dispose();
    if (renderer.forceContextLoss) renderer.forceContextLoss();
  }

  return { open, dispose };
}

window.GemChest = {
  create(canvas, tier) { return buildScene(canvas, tier); },
  // Danh sách 20 styles mới để admin chọn
  CUSTOM_STYLES: [
    { id: 'crimson',     label: '🔴 Crimson',     group: 'Octahedron' },
    { id: 'amethyst',    label: '🟣 Amethyst',    group: 'Octahedron' },
    { id: 'sapphire',    label: '🔵 Sapphire',    group: 'Octahedron' },
    { id: 'citrine',     label: '🟡 Citrine',     group: 'Octahedron' },
    { id: 'emerald',     label: '🟢 Emerald',     group: 'Octahedron' },
    { id: 'arctic',      label: '🧊 Arctic',      group: 'Crystal' },
    { id: 'rose_quartz', label: '🌸 Rose Quartz', group: 'Crystal' },
    { id: 'moonstone',   label: '🌙 Moonstone',   group: 'Crystal' },
    { id: 'topaz',       label: '🟠 Topaz',       group: 'Crystal' },
    { id: 'tanzanite',   label: '💜 Tanzanite',   group: 'Crystal' },
    { id: 'obsidian',    label: '⚫ Obsidian',    group: 'Ancient' },
    { id: 'ancient',     label: '⚡ Ancient Gold', group: 'Ancient' },
    { id: 'jade_deep',   label: '🌿 Deep Jade',   group: 'Ancient' },
    { id: 'shadow',      label: '🌑 Shadow',      group: 'Ancient' },
    { id: 'volcano',     label: '🌋 Volcano',     group: 'Ancient' },
    { id: 'galaxy',      label: '🌌 Galaxy',      group: 'Cosmic' },
    { id: 'aurora',      label: '🌿 Aurora',      group: 'Cosmic' },
    { id: 'solar',       label: '☀️ Solar',       group: 'Cosmic' },
    { id: 'nebula',      label: '💫 Nebula',      group: 'Cosmic' },
    { id: 'void',        label: '🌊 Void',        group: 'Cosmic' },
  ],
};
