import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// Hộp quà "Gem Gift" — thiết kế riêng cho Milestones, KHÁC HẲN rương vuông
// wood/silver/gold ở chest3d.module.js (rương đó dùng cho Mailbox/Community
// Chest). Hộp vuông + nơ ru-y-băng + 1 viên đá quý phát sáng — đồng nhất 1
// thiết kế sáng/rực rỡ cho mọi mốc (đúng ảnh mẫu — chỉ số tiền dưới khác nhau).
const GEM_COLORS = {
  bronze: 0xffb070, jade: 0x7CFFC4, silver: 0xe8eef5, gold: 0xffe27a,
  ruby: 0xff7a90, diamond: 0xbdf3ff,
};
// Thân hộp + ru-y-băng cũng đổi màu theo tier (trước đây chỉ viên đá quý nhỏ đổi
// màu, thân hộp luôn tím cố định — 5 hộp nhìn gần như giống nhau). Giờ cả khối
// leo thang rõ rệt: bronze (nâu đồng) -> jade (xanh ngọc) -> gold (vàng kim) ->
// ruby (đỏ ruby) -> diamond (trắng-xanh băng, sáng nhất).
const TIER_BODY = {
  bronze: 0x9c6b3f, jade: 0x1e6b54, silver: 0x9aa3ad, gold: 0xb8862e,
  ruby: 0x8a1f33, diamond: 0xcfd8e3,
};
const TIER_RIBBON = {
  bronze: 0xd8a86a, jade: 0x7CFFC4, silver: 0xe8eef5, gold: 0xffe27a,
  ruby: 0xff7a90, diamond: 0xbdf3ff,
};

function buildScene(canvas, tier) {
  const gemColor = GEM_COLORS[tier] || GEM_COLORS.gold;
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

  // Thân hộp — màu theo tier (xem TIER_BODY), sáng, bắt sáng tốt
  const bodyColor = TIER_BODY[tier] || TIER_BODY.gold;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 0.9, 1.05),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.38, metalness: 0.08 })
  );
  group.add(body);

  const ribbonColor = TIER_RIBBON[tier] || TIER_RIBBON.gold;
  const ribbonMat = new THREE.MeshStandardMaterial({ color: ribbonColor, metalness: 0.7, roughness: 0.22, emissive: 0x6b4f00, emissiveIntensity: 0.15 });

  // Ru-y-băng dọc (qua mặt trước + nóc + sau)
  const ribbonV = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.94, 1.09), ribbonMat);
  group.add(ribbonV);
  // Ru-y-băng ngang (quanh hộp)
  const ribbonH = new THREE.Mesh(new THREE.BoxGeometry(1.09, 0.94, 0.2), ribbonMat);
  group.add(ribbonH);

  // Nơ trên nóc — 2 cánh nơ (Torus) + nút nơ giữa
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

  // Viên đá quý phát sáng gắn trên nút nơ
  const gemMat = new THREE.MeshStandardMaterial({
    color: gemColor, emissive: gemColor, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.15,
  });
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), gemMat);
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

  // Xoay THẬT trong scene 3D (đổi rotation.y + render lại mỗi frame) — KHÔNG
  // dùng CSS rotateY trên canvas (đã bị lép/méo vì canvas chỉ là 1 ảnh phẳng,
  // xoay CSS làm nó dẹt lại ở góc 90°/270° như xoay 1 tờ ảnh, không phải khối).
  let spinRafId = null;
  function spinTick() {
    group.rotation.y += 0.006;
    renderer.render(scene, camera);
    spinRafId = requestAnimationFrame(spinTick);
  }
  spinRafId = requestAnimationFrame(spinTick);

  let rafId = null;
  function open() {
    if (rafId) return; // đã/đang mở rồi
    const start = performance.now();
    const duration = 650;
    const fromScale = 1, peakScale = 1.18;
    const fromGlow = gemMat.emissiveIntensity, peakGlow = 2.2;
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      // bật nảy: phình lên rồi co lại (đỉnh ở giữa animation)
      const bounce = Math.sin(t * Math.PI);
      const eased = 1 - Math.pow(1 - bounce, 2);
      const scale = fromScale + (peakScale - fromScale) * eased;
      group.scale.set(scale, scale, scale);
      gemMat.emissiveIntensity = fromGlow + (peakGlow - fromGlow) * eased;
      gemLight.intensity = 0.6 + 1.4 * eased;
      renderer.render(scene, camera);
      if (t < 1) rafId = requestAnimationFrame(tick);
      else { group.scale.set(1, 1, 1); gemMat.emissiveIntensity = fromGlow; gemLight.intensity = 0.6; renderer.render(scene, camera); rafId = null; }
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
};
