import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { generateHeatParams, solveHeatEquation } from '../../js/lib/heatEquation.js';
import { createHeatWallMesh } from '../../js/lib/heatWall.js';

const canvas = document.getElementById('heat-canvas');
const metaEl = document.getElementById('heat-meta');
const regenBtn = document.getElementById('regen');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0f18);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(6, 4, 6);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

const ambient = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambient);
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(6, 8, 4);
key.castShadow = true;
scene.add(key);

const grid = new THREE.GridHelper(10, 10, 0x24405f, 0x172235);
grid.position.y = 0;
scene.add(grid);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

let heatWall = null;
let axisGroup = null;
let currentHeatData = null;

const tweakState = {
  width: 6,
  height: 3,
  scaleZ: 0.9,
  thickness: 0,
  slitCount: 10,
  slitWidth: 0.1,
  toonBands: 11,
  colorLow: '#61b3ff',
  colorMid: '#ffffff',
  colorHigh: '#ff6633',
  colorMidPoint: 0.5,
  colorLowPower: 0.86,
  colorHighPower: 0.9,
  regenerate() {
    buildHeatWall({ regenerateData: true });
  }
};

function createLabelSprite(text, { color = '#d8ecff', fontSize = 32 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `600 ${fontSize}px "Inter", system-ui, sans-serif`;
  const metrics = ctx.measureText(text);
  const padding = 16;
  canvas.width = Math.ceil(metrics.width + padding * 2);
  canvas.height = Math.ceil(fontSize + padding * 2);
  const ctx2 = canvas.getContext('2d');
  ctx2.font = `600 ${fontSize}px "Inter", system-ui, sans-serif`;
  ctx2.fillStyle = 'rgba(8, 14, 24, 0.75)';
  ctx2.fillRect(0, 0, canvas.width, canvas.height);
  ctx2.fillStyle = color;
  ctx2.textBaseline = 'middle';
  ctx2.textAlign = 'center';
  ctx2.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  const scale = 0.0045 * canvas.height;
  sprite.scale.set((canvas.width / canvas.height) * scale, scale, 1);
  return sprite;
}

function buildAxes({ origin, width, height, zMin, zMax, T, L }) {
  const group = new THREE.Group();
  group.name = 'HeatWallAxes';

  const axisMaterial = new THREE.LineBasicMaterial({ color: 0x9bc7ff, transparent: true, opacity: 0.7 });
  const tickMaterial = new THREE.LineBasicMaterial({ color: 0x5a7aa6, transparent: true, opacity: 0.6 });

  const xAxis = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(origin.x, origin.y, origin.z),
    new THREE.Vector3(origin.x + width, origin.y, origin.z)
  ]);
  const yAxis = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(origin.x, origin.y, origin.z),
    new THREE.Vector3(origin.x, origin.y + height, origin.z)
  ]);
  const zAxis = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(origin.x, origin.y, origin.z + zMin),
    new THREE.Vector3(origin.x, origin.y, origin.z + zMax)
  ]);
  group.add(new THREE.Line(xAxis, axisMaterial));
  group.add(new THREE.Line(yAxis, axisMaterial));
  group.add(new THREE.Line(zAxis, axisMaterial));

  const xLabel = createLabelSprite(`t ∈ [0, ${T.toFixed(2)}]`);
  xLabel.position.set(origin.x + width * 0.5, origin.y - 0.15, origin.z);
  group.add(xLabel);

  const yLabel = createLabelSprite(`y ∈ [0, ${L.toFixed(2)}]`);
  yLabel.position.set(origin.x - 0.2, origin.y + height * 0.5, origin.z);
  group.add(yLabel);

  const zLabel = createLabelSprite(`u ∈ [${zMin.toFixed(2)}, ${zMax.toFixed(2)}]`);
  zLabel.position.set(origin.x - 0.2, origin.y, origin.z + zMax + 0.2);
  group.add(zLabel);

  const addTick = (posA, posB, labelText) => {
    const geom = new THREE.BufferGeometry().setFromPoints([posA, posB]);
    group.add(new THREE.Line(geom, tickMaterial));
    if (labelText) {
      const label = createLabelSprite(labelText, { color: '#b7d9ff', fontSize: 40 });
      label.position.copy(posB.clone().add(new THREE.Vector3(0.12, 0.08, 0)));
      group.add(label);
    }
  };

  addTick(
    new THREE.Vector3(origin.x, origin.y, origin.z),
    new THREE.Vector3(origin.x, origin.y, origin.z - 0.12),
    '0'
  );
  addTick(
    new THREE.Vector3(origin.x + width, origin.y, origin.z),
    new THREE.Vector3(origin.x + width, origin.y, origin.z - 0.12),
    T.toFixed(2)
  );
  addTick(
    new THREE.Vector3(origin.x, origin.y, origin.z),
    new THREE.Vector3(origin.x - 0.12, origin.y, origin.z),
    '0'
  );
  addTick(
    new THREE.Vector3(origin.x, origin.y + height, origin.z),
    new THREE.Vector3(origin.x - 0.12, origin.y + height, origin.z),
    L.toFixed(2)
  );
  addTick(
    new THREE.Vector3(origin.x, origin.y, origin.z + zMin),
    new THREE.Vector3(origin.x - 0.12, origin.y, origin.z + zMin),
    zMin.toFixed(2)
  );
  addTick(
    new THREE.Vector3(origin.x, origin.y, origin.z + zMax),
    new THREE.Vector3(origin.x - 0.12, origin.y, origin.z + zMax),
    zMax.toFixed(2)
  );

  return group;
}

function updateMeta(meta, params) {
  const timeScale = (params.T / 6).toFixed(2);
  metaEl.innerHTML = [
    `seed: ${params.seed}`,
    `L: ${params.L.toFixed(2)}  T: ${params.T.toFixed(2)}`,
    `alpha: ${params.alpha.toFixed(3)}`,
    `A: ${params.A.toFixed(2)}  B: ${params.B.toFixed(2)}`,
    `min/max: ${meta.minU.toFixed(3)} / ${meta.maxU.toFixed(3)}`,
    `time scale: 1 unit = ${timeScale}`,
    `bands: ${tweakState.toonBands}  slits: ${Math.round(tweakState.slitCount)}`
  ].join('<br />');
}

function buildHeatWall({ regenerateData = false } = {}) {
  if (heatWall) {
    heatWall.geometry.dispose();
    heatWall.material.dispose();
    scene.remove(heatWall);
    heatWall = null;
  }

  if (regenerateData || !currentHeatData) {
    const params = generateHeatParams();
    const { U, meta } = solveHeatEquation(params, 64, 128, { debug: true });
    currentHeatData = { params, meta, U };
  }

  const { params, meta, U } = currentHeatData;

  heatWall = createHeatWallMesh(U, { ...params, ...meta }, {
    THREE,
    width: tweakState.width,
    height: tweakState.height,
    scaleZ: tweakState.scaleZ,
    thickness: tweakState.thickness,
    slitCount: Math.round(tweakState.slitCount),
    slitWidth: tweakState.slitWidth,
    toonBands: Math.round(tweakState.toonBands),
    colorLow: tweakState.colorLow,
    colorMid: tweakState.colorMid,
    colorHigh: tweakState.colorHigh,
    colorMidPoint: tweakState.colorMidPoint,
    colorLowPower: tweakState.colorLowPower,
    colorHighPower: tweakState.colorHighPower,
    name: 'HeatWall'
  });
  heatWall.position.set(-3, 0, 0);
  scene.add(heatWall);

  if (axisGroup) {
    scene.remove(axisGroup);
    axisGroup.traverse(obj => {
      if (obj.material?.map) obj.material.map.dispose();
      if (obj.material) obj.material.dispose();
      if (obj.geometry) obj.geometry.dispose();
    });
    axisGroup = null;
  }

  const zMin = tweakState.thickness;
  const zMax = tweakState.thickness + tweakState.scaleZ * (meta.maxU - meta.minU);
  axisGroup = buildAxes({
    origin: heatWall.position.clone(),
    width: tweakState.width,
    height: tweakState.height,
    zMin,
    zMax,
    T: params.T,
    L: params.L
  });
  scene.add(axisGroup);

  updateMeta(meta, params);
  window.__HEAT_DEBUG__ = { params, meta, U, tweakState };
}

const gui = new GUI({ title: 'Heat Wall Controls' });
const geometryFolder = gui.addFolder('Geometry');
geometryFolder.add(tweakState, 'width', 2, 12, 0.1).onChange(() => buildHeatWall());
geometryFolder.add(tweakState, 'height', 1, 8, 0.1).onChange(() => buildHeatWall());
geometryFolder.add(tweakState, 'scaleZ', 0.1, 3, 0.01).name('Heat Depth').onChange(() => buildHeatWall());
geometryFolder.add(tweakState, 'thickness', 0, 0.8, 0.01).onChange(() => buildHeatWall());
geometryFolder.add(tweakState, 'slitCount', 0, 24, 1).onChange(() => buildHeatWall());
geometryFolder.add(tweakState, 'slitWidth', 0, 0.8, 0.01).onChange(() => buildHeatWall());

const colorFolder = gui.addFolder('Color Bands');
colorFolder.add(tweakState, 'toonBands', 2, 32, 1).name('Toon Bands').onChange(() => buildHeatWall());
colorFolder.add(tweakState, 'colorMidPoint', 0.05, 0.95, 0.01).name('Mid Point').onChange(() => buildHeatWall());
colorFolder.add(tweakState, 'colorLowPower', 0.1, 3, 0.01).name('Blue Power').onChange(() => buildHeatWall());
colorFolder.add(tweakState, 'colorHighPower', 0.1, 3, 0.01).name('Red Power').onChange(() => buildHeatWall());
colorFolder.addColor(tweakState, 'colorLow').name('Low Color').onChange(() => buildHeatWall());
colorFolder.addColor(tweakState, 'colorMid').name('Mid Color').onChange(() => buildHeatWall());
colorFolder.addColor(tweakState, 'colorHigh').name('High Color').onChange(() => buildHeatWall());

gui.add(tweakState, 'regenerate').name('Regenerate Field');

buildHeatWall({ regenerateData: true });
regenBtn.addEventListener('click', () => buildHeatWall({ regenerateData: true }));

function onResize() {
  const { innerWidth: w, innerHeight: h } = window;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
