import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { create_island } from './island.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10151f);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.minDistance = 2;
controls.maxDistance = 80;

// Lights (simple, stable)
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.85));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(8, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.1;
sun.shadow.camera.far = 80;
sun.shadow.camera.left = -20;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;
scene.add(sun);

// Optional ground for visual reference
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.ShadowMaterial({ opacity: 0.22 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
ground.receiveShadow = true;
scene.add(ground);

let islandGroup = null;
let islandStats = null;

const wireToggle = document.createElement('button');
wireToggle.type = 'button';
wireToggle.textContent = 'Wireframe';
wireToggle.title = 'Toggle wireframe (W)';
wireToggle.style.cssText = [
  'position:fixed',
  'top:12px',
  'left:12px',
  'z-index:10',
  'padding:6px 10px',
  'background:#1b2638',
  'color:#e8edf7',
  'border:1px solid #2f405c',
  'border-radius:6px',
  'font:600 12px/1.2 system-ui',
  'letter-spacing:0.3px',
  'cursor:pointer',
].join(';');
document.body.appendChild(wireToggle);

function parseSeed() {
  const u = new URL(window.location.href);
  const s = u.searchParams.get('seed');
  const n = s != null ? parseInt(s, 10) : 1337;
  return Number.isFinite(n) ? n : 1337;
}

function disposeGroup(g) {
  if (!g) return;
  g.traverse((node) => {
    if (node.isMesh) {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) {
        node.material.forEach((m) => m?.dispose?.());
      } else {
        node.material?.dispose?.();
      }
    }
  });
}

function regenerate(seed = parseSeed(), opts = {}) {
  if (islandGroup) {
    scene.remove(islandGroup);
    disposeGroup(islandGroup);
    islandGroup = null;
    islandStats = null;
  }

  const result = create_island(THREE, { seed, ...opts });
  islandGroup = result?.group || result;
  islandStats = result?.stats || null;

  if (islandGroup) {
    islandGroup.position.y = 0.02;
    scene.add(islandGroup);
    updateControlsTarget();
  }

  // Default camera to isometric after regen
  setView('iso');

  return result;
}

function getWorldBounds() {
  if (!islandGroup) return null;
  const box = new THREE.Box3().setFromObject(islandGroup);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return { box, size, center };
}

function updateControlsTarget() {
  const b = getWorldBounds();
  if (!b) return;
  controls.target.copy(b.center);
  controls.update();
}

function frameCamera(dirVec, upVec = new THREE.Vector3(0, 1, 0)) {
  const b = getWorldBounds();
  if (!b) {
    camera.position.set(6, 5, 6);
    camera.lookAt(0, 0.4, 0);
    return;
  }

  const { size, center } = b;
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = maxDim * 1.55 + 2.0;

  const dir = dirVec.clone().normalize();
  camera.up.copy(upVec);
  camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

// Public, deterministic camera preset for Playwright: +-x +-y +-z plus iso
function setView(name) {
  const n = String(name || '').toLowerCase();
  if (n === 'px' || n === '+x') return frameCamera(new THREE.Vector3(1, 0.08, 0));
  if (n === 'nx' || n === '-x') return frameCamera(new THREE.Vector3(-1, 0.08, 0));
  if (n === 'py' || n === '+y') return frameCamera(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  if (n === 'ny' || n === '-y') return frameCamera(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1));
  if (n === 'pz' || n === '+z') return frameCamera(new THREE.Vector3(0, 0.08, 1));
  if (n === 'nz' || n === '-z') return frameCamera(new THREE.Vector3(0, 0.08, -1));
  // iso default
  return frameCamera(new THREE.Vector3(1, 0.8, 1));
}

function toggleWire(visible) {
  if (!islandGroup) return false;
  let found = false;
  islandGroup.traverse((o) => {
    if (o.name === 'ISLAND_WIRE') {
      const next = visible != null ? !!visible : !o.visible;
      o.visible = next;
      found = true;
    }
  });
  return found;
}

wireToggle.addEventListener('click', () => toggleWire());

window.addEventListener('keydown', (event) => {
  if (event.key === 'w' || event.key === 'W') {
    toggleWire();
  }
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Expose hooks for Codex + Playwright
window.ISLAND = {
  THREE,
  scene,
  camera,
  renderer,
  regenerate,
  setView,
  toggleWire,
  getWorldBounds,
  get stats() { return islandStats; },
};
window.ISLAND_SET_VIEW = setView;
window.ISLAND_TOGGLE_WIRE = toggleWire;

// Initial build
regenerate(parseSeed());
animate();
