import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const TIER_COLORS = {
  wood:  { body:0x8b5a2b, lid:0x9c6a35, stud:0x5c3a1a, clasp:0xcaa56a },
  silver:{ body:0xc7ccd6, lid:0xd6dae2, stud:0x8b93a3, clasp:0xeef2f8 },
  gold:  { body:0xf4c441, lid:0xffd966, stud:0xb9860a, clasp:0xfff4cc },
  buyer: { body:0xb266ff, lid:0xc18bff, stud:0x6b2fa0, clasp:0xe9d4ff },
};

function buildScene(canvas, tier) {
  const colors = TIER_COLORS[tier] || TIER_COLORS.wood;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
  camera.position.set(1.4, 1.3, 1.8);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(2, 3, 2);
  scene.add(dir);

  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.7, 0.9),
    new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.7 })
  );
  body.position.y = -0.05;
  group.add(body);

  // ổ khóa
  const clasp = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.22, 0.1),
    new THREE.MeshStandardMaterial({ color: colors.clasp, metalness: 0.4, roughness: 0.4 })
  );
  clasp.position.set(0, -0.05, 0.5);
  group.add(clasp);

  // các khối góc trang trí
  [[-0.6, -0.42], [0.6, -0.42], [-0.6, 0.42], [0.6, 0.42]].forEach(([x, z]) => {
    const stud = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.7, 0.12),
      new THREE.MeshStandardMaterial({ color: colors.stud, roughness: 0.8 })
    );
    stud.position.set(x, -0.05, z);
    group.add(stud);
  });

  // nắp gắn vào pivot ở mép sau để xoay mở được
  const pivot = new THREE.Group();
  pivot.position.set(0, 0.3, -0.45);
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.32, 0.9),
    new THREE.MeshStandardMaterial({ color: colors.lid, roughness: 0.65 })
  );
  lid.position.set(0, 0.16, 0.45);
  pivot.add(lid);
  group.add(pivot);

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
    const from = pivot.rotation.x, to = -1.92; // ~-110deg
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      pivot.rotation.x = from + (to - from) * eased;
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

window.ChestVoxel = {
  create(canvas, tier) { return buildScene(canvas, tier); },
};
