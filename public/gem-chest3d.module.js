import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// Rương "Gem Chest" — thiết kế riêng cho Milestones, KHÁC HẲN rương vuông
// wood/silver/gold ở chest3d.module.js (rương đó dùng cho Mailbox/Community
// Chest). Thân hình trụ bo tròn + nắp vòm + viền kim loại + 1 viên đá quý lớn
// phát sáng trên nắp.
const TIER_GEMS = {
  bronze:  { body: 0x6b3f1d, trim: 0xb87333, gem: 0xcd7f32 },
  jade:    { body: 0x123d36, trim: 0xc7ccd6, gem: 0x2ecc71 },
  gold:    { body: 0x7a5a12, trim: 0xf4c441, gem: 0xffd966 },
  ruby:    { body: 0x4a0f1a, trim: 0xe0a899, gem: 0xe0263f },
  diamond: { body: 0x223347, trim: 0xe8eef5, gem: 0x9beaff },
};

function buildScene(canvas, tier) {
  const colors = TIER_GEMS[tier] || TIER_GEMS.bronze;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
  camera.position.set(1.3, 1.2, 1.7);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(2, 3, 2);
  scene.add(dir);

  const group = new THREE.Group();

  // Thân hình trụ bo tròn
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.52, 0.58, 0.62, 20),
    new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.55, metalness: 0.1 })
  );
  body.position.y = -0.12;
  group.add(body);

  // Viền kim loại quanh miệng thân
  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(0.54, 0.045, 10, 28),
    new THREE.MeshStandardMaterial({ color: colors.trim, metalness: 0.85, roughness: 0.25 })
  );
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 0.2;
  group.add(trim);

  // Viền kim loại đáy (trang trí thêm)
  const baseTrim = new THREE.Mesh(
    new THREE.TorusGeometry(0.56, 0.035, 8, 24),
    new THREE.MeshStandardMaterial({ color: colors.trim, metalness: 0.85, roughness: 0.3 })
  );
  baseTrim.rotation.x = Math.PI / 2;
  baseTrim.position.y = -0.42;
  group.add(baseTrim);

  // Nắp vòm — bọc trong 1 pivot riêng để chơi animation "bật mở" độc lập
  const lidPivot = new THREE.Group();
  lidPivot.position.y = 0.2;
  const lid = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2.1),
    new THREE.MeshStandardMaterial({ color: colors.trim, roughness: 0.4, metalness: 0.5 })
  );
  lidPivot.add(lid);

  // Viên đá quý lớn gắn trên nắp — vật liệu phát sáng (emissive)
  const gemMat = new THREE.MeshStandardMaterial({
    color: colors.gem, emissive: colors.gem, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.2,
  });
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), gemMat);
  gem.position.y = 0.34;
  lidPivot.add(gem);

  group.add(lidPivot);
  group.rotation.y = -0.35;
  scene.add(group);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.render(scene, camera);

  let rafId = null;
  function open() {
    if (rafId) return; // đã/đang mở rồi
    const start = performance.now();
    const duration = 650;
    const fromY = lidPivot.position.y, toY = fromY + 0.22;
    const fromRotZ = 0, toRotZ = 0.5;
    const fromGlow = gemMat.emissiveIntensity, toGlow = 1.6;
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      lidPivot.position.y = fromY + (toY - fromY) * eased;
      lidPivot.rotation.z = fromRotZ + (toRotZ - fromRotZ) * eased;
      gemMat.emissiveIntensity = fromGlow + (toGlow - fromGlow) * eased;
      renderer.render(scene, camera);
      if (t < 1) rafId = requestAnimationFrame(tick);
      else rafId = null;
    }
    rafId = requestAnimationFrame(tick);
  }

  function dispose() {
    if (rafId) cancelAnimationFrame(rafId);
    renderer.dispose();
    if (renderer.forceContextLoss) renderer.forceContextLoss();
  }

  return { open, dispose };
}

window.GemChest = {
  create(canvas, tier) { return buildScene(canvas, tier); },
};
