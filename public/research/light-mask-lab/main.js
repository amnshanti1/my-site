import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import {
  MOUNTAIN_STACK_DEFAULTS,
  MOUNTAIN_LAYER_DEFAULTS,
  MOUNTAIN_TINT_PRESETS,
  getDefaultLayerTints
} from './mountainDefaults.js';
import { cloneLightPresetDefaults } from './lightPresets.js';

const canvas = document.getElementById('demo-canvas');
const statusEl = document.getElementById('status');
const MAIN_SITE_CAMERA_DEFAULTS = {
  fov: 50,
  position: { x: 0, y: 4, z: 10.8 },
  target: { x: 0, y: 1.6, z: 0 }
};

const LIGHT_PRESET_KEYS = [
  'waterVisible',
  'waterY',
  'waterBaseColor',
  'waterPatchAmount',
  'waterPatchWarmth',
  'waterRippleAmount',
  'waterMotionSpeed',
  'waterOpacity',
  'waterBrightness',
  'waterHorizonGlow',
  'reflectionsVisible',
  'reflectionStretch',
  'reflectionWidth',
  'reflectionSoftness',
  'reflectionBreakup',
  'reflectionCoupling',
  'reflectionBrightness',
  'reflectionHeroBoost',
  'reflectionDrop',
  'reflectionTiltX',
  'lightCount',
  'lightThreshold',
  'lightResolutionScale',
  'clusterCount',
  'clusterSpread',
  'starShare',
  'heroShare',
  'lightOpacity',
  'glowStrength',
  'bloomStrength',
  'twinkleStrength',
  'twinkleFrequency',
  'fireStrength',
  'fireColorShift',
  'lightSeed',
  'warmLightColor',
  'paleLightColor',
  'coolLightColor',
  'starCore',
  'starArm',
  'starLineWidth',
  'starGlow',
  'dotCore',
  'dotGlow',
  'heroCore',
  'heroArm',
  'heroLineWidth',
  'heroGlow',
  'lightZOffset',
  'spawnMaskOpacity',
  'spawnMaskTint'
];

const LIGHT_PRESET_DEFAULTS = cloneLightPresetDefaults();

const tweakState = {
  activeLightPreset: 'sunset',
  widthScale: MOUNTAIN_STACK_DEFAULTS.widthScale,
  heightScale: MOUNTAIN_STACK_DEFAULTS.heightScale,
  worldScale: MOUNTAIN_STACK_DEFAULTS.worldScale,
  layerGap: MOUNTAIN_STACK_DEFAULTS.layerGap,
  groupX: MOUNTAIN_STACK_DEFAULTS.groupX,
  groupY: MOUNTAIN_STACK_DEFAULTS.groupY,
  groupZ: MOUNTAIN_STACK_DEFAULTS.groupZ,
  rotX: MOUNTAIN_STACK_DEFAULTS.rotX,
  rotY: MOUNTAIN_STACK_DEFAULTS.rotY,
  rotZ: MOUNTAIN_STACK_DEFAULTS.rotZ,
  alphaTest: MOUNTAIN_STACK_DEFAULTS.alphaTest,
  showGrid: false,
  fogNear: 55,
  fogFar: 220,
  lightsVisible: true,
  towerLightsVisible: true,
  towerX: 0.82,
  towerY: 0.2,
  towerSpacing: 0.078,
  towerScale: 0.022,
  towerZOffset: 0.04,
  towerBrightness: 0.92,
  radioTowersVisible: true,
  radioTowerInstances: [
    { visible: true, x: -7.95, y: 0.2, zOffset: 2.6, width: 0.04, height: 0.19, opacity: 1 },
    { visible: true, x: 19.27, y: 1.5, zOffset: -2.51, width: 0.03, height: 0.13, opacity: 1 },
    { visible: true, x: 23.46, y: 0.8, zOffset: -2.49, width: 0.03, height: 0.15, opacity: 1 }
  ],
  maskLayer: 'mountain_02',
  ...LIGHT_PRESET_DEFAULTS.sunset,
  lightZOffset: LIGHT_PRESET_DEFAULTS.sunset.lightZOffset,
  showSpawnMask: false,
  spawnMaskOpacity: LIGHT_PRESET_DEFAULTS.sunset.spawnMaskOpacity,
  spawnMaskTint: LIGHT_PRESET_DEFAULTS.sunset.spawnMaskTint,
  resetCamera() {
    camera.fov = MAIN_SITE_CAMERA_DEFAULTS.fov;
    camera.updateProjectionMatrix();
    camera.position.set(
      MAIN_SITE_CAMERA_DEFAULTS.position.x,
      MAIN_SITE_CAMERA_DEFAULTS.position.y,
      MAIN_SITE_CAMERA_DEFAULTS.position.z
    );
    controls.target.set(
      MAIN_SITE_CAMERA_DEFAULTS.target.x,
      MAIN_SITE_CAMERA_DEFAULTS.target.y,
      MAIN_SITE_CAMERA_DEFAULTS.target.z
    );
    controls.update();
    updateStatus();
  },
  layers: MOUNTAIN_LAYER_DEFAULTS.map((layer, index) => ({
    ...layer,
    tint: LIGHT_PRESET_DEFAULTS.sunset.layerTints[index] || layer.tint
  }))
};

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b1118, tweakState.fogNear, tweakState.fogFar);

const camera = new THREE.PerspectiveCamera(MAIN_SITE_CAMERA_DEFAULTS.fov, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(
  MAIN_SITE_CAMERA_DEFAULTS.position.x,
  MAIN_SITE_CAMERA_DEFAULTS.position.y,
  MAIN_SITE_CAMERA_DEFAULTS.position.z
);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(
  MAIN_SITE_CAMERA_DEFAULTS.target.x,
  MAIN_SITE_CAMERA_DEFAULTS.target.y,
  MAIN_SITE_CAMERA_DEFAULTS.target.z
);
controls.minDistance = 18;
controls.maxDistance = 260;
controls.maxPolarAngle = Math.PI * 0.485;

const ambient = new THREE.HemisphereLight(0xd6e6ff, 0x0a0d12, 1.25);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffe7c4, 1.25);
keyLight.position.set(42, 64, 26);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x89adff, 0.45);
fillLight.position.set(-30, 18, -42);
scene.add(fillLight);

const grid = new THREE.GridHelper(260, 26, 0x45638a, 0x162230);
grid.material.transparent = true;
grid.material.opacity = 0.05;
scene.add(grid);

const waterGroup = new THREE.Group();
waterGroup.name = 'WaterLayer';
scene.add(waterGroup);

const mountainGroup = new THREE.Group();
mountainGroup.name = 'MountainLabGroup';
scene.add(mountainGroup);

const sharedPlaneGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
const textureLoader = new THREE.TextureLoader();

const layerRefs = [];
const radioTowerRefs = [];
let waterBaseMesh = null;
let waterPatchMesh = null;
let waterRippleMesh = null;
let reflectionMesh = null;
let reflectionPivot = null;
let waterBaseTexture = null;
let waterPatchTexture = null;
let waterRippleTexture = null;
let reflectionCanvas = null;
let reflectionCtx = null;
let reflectionTexture = null;
let spawnMaskImage = null;
let spawnMaskTexture = null;
let spawnMaskMesh = null;
let lightDescriptors = [];
let lightLayoutKey = '';
let maskSampleState = null;
const lightSpritesGroup = new THREE.Group();
lightSpritesGroup.name = 'VillageLightsGroup';
mountainGroup.add(lightSpritesGroup);
const towerLightsGroup = new THREE.Group();
towerLightsGroup.name = 'TowerLightsGroup';
mountainGroup.add(towerLightsGroup);
const lightKernelCache = new Map();
let towerKernelTexture = null;
const RADIO_TOWER_IMAGE_SIZE = { width: 1080, height: 1350 };
const RADIO_TOWER_BEACONS = [
  { x: 400, y: 975, row: 0 },
  { x: 680, y: 975, row: 0 },
  { x: 445, y: 695, row: 1 },
  { x: 635, y: 695, row: 1 },
  { x: 480, y: 480, row: 2 },
  { x: 600, y: 480, row: 2 }
];
const towerLightDescriptors = [
  { offset: 0, phase: 0.0, strength: 1.0 },
  { offset: 1, phase: 0.035, strength: 0.84 },
  { offset: 2, phase: 0.07, strength: 0.72 }
];
const towerLightMeshes = [];
const lightPresetControllers = [];
const layerTintControllers = [];
let lastActiveLightPreset = tweakState.activeLightPreset;

function loadTexture(path) {
  return new Promise((resolve, reject) => {
    textureLoader.load(
      path,
      texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.needsUpdate = true;
        resolve(texture);
      },
      undefined,
      reject
    );
  });
}

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = path;
  });
}

function buildMountainMaterial(texture, layer) {
  return new THREE.MeshBasicMaterial({
    map: texture,
    color: new THREE.Color(layer.tint),
    transparent: true,
    opacity: layer.opacity,
    alphaTest: tweakState.alphaTest,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
    toneMapped: false
  });
}

function createCanvasTexture(canvasEl, { repeat = false } = {}) {
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.needsUpdate = true;
  return texture;
}

function buildRadioTowerTexture(sourceImage) {
  const canvasEl = document.createElement('canvas');
  canvasEl.width = sourceImage.naturalWidth || sourceImage.width;
  canvasEl.height = sourceImage.naturalHeight || sourceImage.height;
  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.drawImage(sourceImage, 0, 0, canvasEl.width, canvasEl.height);

  const beaconPositions = [
    [400, 975],
    [680, 975],
    [445, 695],
    [635, 695],
    [480, 480],
    [600, 480]
  ];
  const beaconRadius = 12;
  ctx.fillStyle = 'rgba(120, 12, 12, 0.82)';
  beaconPositions.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, beaconRadius, 0, Math.PI * 2);
    ctx.fill();
  });

  return createCanvasTexture(canvasEl);
}

function getTowerKernelTexture() {
  if (towerKernelTexture) return towerKernelTexture;
  const size = 128;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = size;
  canvasEl.height = size;
  const ctx = canvasEl.getContext('2d');
  const mid = size * 0.5;
  const glow = ctx.createRadialGradient(mid, mid, 0, mid, mid, size * 0.44);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.1, 'rgba(255,236,236,0.98)');
  glow.addColorStop(0.24, 'rgba(255,98,98,0.72)');
  glow.addColorStop(0.55, 'rgba(255,72,72,0.18)');
  glow.addColorStop(1, 'rgba(255,64,64,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(mid, mid, size * 0.44, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,250,250,1)';
  ctx.beginPath();
  ctx.arc(mid, mid, size * 0.075, 0, Math.PI * 2);
  ctx.fill();

  towerKernelTexture = createCanvasTexture(canvasEl);
  return towerKernelTexture;
}

function colorToRgba(color, alpha = 1) {
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${alpha})`;
}

function buildWaterBaseTexture() {
  const width = 1024;
  const height = 1024;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  const baseColor = new THREE.Color(tweakState.waterBaseColor);
  const horizonColor = baseColor.clone().lerp(new THREE.Color('#9d84a1'), tweakState.waterHorizonGlow * 0.28);
  const midColor = baseColor.clone().lerp(new THREE.Color('#4d628e'), 0.16 + tweakState.waterHorizonGlow * 0.14);
  const deepColor = baseColor.clone().multiplyScalar(0.72);

  const vertical = ctx.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, colorToRgba(horizonColor.clone().multiplyScalar(1.16), 1));
  vertical.addColorStop(0.18, colorToRgba(midColor, 1));
  vertical.addColorStop(0.62, colorToRgba(baseColor, 1));
  vertical.addColorStop(1, colorToRgba(deepColor, 1));
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, width, height);

  const horizonGlow = ctx.createRadialGradient(width * 0.5, height * 0.08, 0, width * 0.5, height * 0.08, width * 0.42);
  horizonGlow.addColorStop(0, colorToRgba(new THREE.Color('#ffbf99'), 0.12 + tweakState.waterHorizonGlow * 0.18));
  horizonGlow.addColorStop(0.42, colorToRgba(new THREE.Color('#b7c7f7'), 0.04 + tweakState.waterHorizonGlow * 0.08));
  horizonGlow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = horizonGlow;
  ctx.fillRect(0, 0, width, height * 0.4);

  const vignette = ctx.createLinearGradient(0, height * 0.36, 0, height);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, height * 0.36, width, height * 0.64);

  return createCanvasTexture(canvasEl, { repeat: true });
}

function buildWaterPatchTexture() {
  const width = 1024;
  const height = 1024;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  const warmStrength = tweakState.waterPatchWarmth;
  const warmColor = new THREE.Color('#ffb084').lerp(new THREE.Color('#ffcfaa'), 0.4);
  const coolColor = new THREE.Color('#94a7d8').lerp(new THREE.Color('#7388bd'), 0.35);
  const clusters = [];

  if (lightDescriptors.length) {
    const sorted = [...lightDescriptors]
      .sort((a, b) => (b.prominence * b.brightness) - (a.prominence * a.brightness))
      .slice(0, 6);
    sorted.forEach((light, index) => {
      clusters.push([
        light.x,
        0.18 + (index % 3) * 0.09 + light.prominence * 0.04,
        0.12 + light.prominence * 0.12,
        0.035 + light.prominence * 0.028,
        (index - 2.5) * 0.02,
        colorToRgba(warmColor, 0.05 + warmStrength * 0.1 + light.prominence * 0.06)
      ]);
    });
  }

  const patches = [
    ...clusters,
    [0.16, 0.3, 0.26, 0.09, -0.08, colorToRgba(warmColor, 0.035 + warmStrength * 0.05)],
    [0.52, 0.42, 0.34, 0.11, -0.04, colorToRgba(coolColor, 0.11)],
    [0.78, 0.6, 0.22, 0.08, -0.1, colorToRgba(coolColor.clone().lerp(new THREE.Color('#c1cffa'), 0.15), 0.09)],
    [0.38, 0.74, 0.28, 0.09, -0.03, colorToRgba(coolColor, 0.07)],
    [0.66, 0.83, 0.4, 0.1, -0.02, colorToRgba(coolColor.clone().multiplyScalar(0.9), 0.06)]
  ];

  patches.forEach(([x, y, rx, ry, rot, color]) => {
    ctx.save();
    ctx.filter = 'blur(40px)';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(width * x, height * y, width * rx, height * ry, rot, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  return createCanvasTexture(canvasEl, { repeat: true });
}

function buildWaterRippleTexture() {
  const width = 1024;
  const height = 1024;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  for (let row = 0; row < 10; row += 1) {
    const t = row / 9;
    const y = height * (0.12 + row * 0.068);
    const alpha = 0.01 + (1 - t) * 0.02;
    ctx.strokeStyle = `rgba(189, 208, 255, ${alpha})`;
    ctx.lineWidth = 1 + (1 - t) * 0.55;
    ctx.beginPath();
    for (let x = 0; x <= width + 20; x += 26) {
      const waveY = y + Math.sin((x / (150 + row * 16)) * Math.PI * 2 + row * 0.7) * (3.5 + row * 0.24);
      if (x === 0) ctx.moveTo(x, waveY);
      else ctx.lineTo(x, waveY);
    }
    ctx.stroke();
  }

  return createCanvasTexture(canvasEl, { repeat: true });
}

function rebuildWaterTextures() {
  waterBaseTexture?.dispose();
  waterPatchTexture?.dispose();
  waterRippleTexture?.dispose();
  waterBaseTexture = buildWaterBaseTexture();
  waterPatchTexture = buildWaterPatchTexture();
  waterRippleTexture = buildWaterRippleTexture();
  if (waterBaseMesh?.material) waterBaseMesh.material.map = waterBaseTexture;
  if (waterPatchMesh?.material) waterPatchMesh.material.map = waterPatchTexture;
  if (waterRippleMesh?.material) waterRippleMesh.material.map = waterRippleTexture;
}

function getStaticReflectionColor(light) {
  const color = getDescriptorBaseColor(light);
  const hsl = {};
  color.getHSL(hsl);
  return new THREE.Color().setHSL(
    hsl.h,
    Math.min(1, hsl.s * 0.82),
    Math.min(1, hsl.l + 0.1)
  );
}

function ensureReflectionTexture() {
  if (reflectionCanvas && reflectionCtx && reflectionTexture) return;
  reflectionCanvas = document.createElement('canvas');
  reflectionCanvas.width = 1024;
  reflectionCanvas.height = 1024;
  reflectionCtx = reflectionCanvas.getContext('2d');
  reflectionTexture = createCanvasTexture(reflectionCanvas);
}

function rebuildReflectionTexture() {
  ensureReflectionTexture();
  const ctx = reflectionCtx;
  const width = reflectionCanvas.width;
  const height = reflectionCanvas.height;
  ctx.clearRect(0, 0, width, height);

  if (!tweakState.reflectionsVisible) {
    reflectionTexture.needsUpdate = true;
    return;
  }

  lightDescriptors.forEach(light => {
    const x = light.x * width;
    const seed = Math.floor(light.sampleX * 9283 + light.sampleY * 6151 + light.phase * 997);
    const detailRand = createSeededRandom(seed || 1);
    const typeBoost = light.type === 'hero6' ? tweakState.reflectionHeroBoost : light.type === 'dot' ? 0.8 : 1;
    const startY = height * (THREE.MathUtils.lerp(0.012, 0.045, tweakState.reflectionCoupling) + (detailRand() - 0.5) * 0.004);
    const length = (light.type === 'hero6' ? 360 : light.type === 'dot' ? 170 : 265) * tweakState.reflectionStretch * typeBoost * (0.7 + light.prominence * 0.78);
    const streakWidth = (light.type === 'hero6' ? 19 : light.type === 'dot' ? 8 : 13) * tweakState.reflectionWidth * THREE.MathUtils.lerp(0.94, 1.08, detailRand());
    const brightness = light.brightness * tweakState.reflectionBrightness * (light.type === 'hero6' ? 0.6 * tweakState.reflectionHeroBoost : light.type === 'dot' ? 0.3 : 0.44);
    const gap = tweakState.reflectionBreakup;
    const segments = light.type === 'hero6' ? 4 + Math.round(detailRand()) : light.type === 'dot' ? 2 : 2 + Math.round(detailRand() * 2);
    const color = getStaticReflectionColor(light);
    const rgba = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, `;

    for (let i = 0; i < segments; i += 1) {
      const segT = i / Math.max(1, segments - 1);
      const taper = THREE.MathUtils.lerp(0.24, 0.34, detailRand());
      const y0 = startY + segT * length * THREE.MathUtils.lerp(0.22, 0.35, detailRand()) + (i % 2 === 0 ? 0 : 8 * gap);
      const y1 = y0 + length * (taper - segT * 0.045);
      const segWidth = streakWidth * (1 + segT * 0.42) * THREE.MathUtils.lerp(0.92, 1.08, detailRand());
      const jitterX = (detailRand() - 0.5) * 14 * gap;
      const blur = light.type === 'dot'
        ? Math.max(5, 10 * tweakState.reflectionSoftness)
        : light.type === 'hero6'
          ? Math.max(12, 22 * tweakState.reflectionSoftness)
          : Math.max(8, 16 * tweakState.reflectionSoftness);

      ctx.save();
      ctx.filter = `blur(${blur}px)`;
      const grad = ctx.createLinearGradient(x, y0, x, y1);
      grad.addColorStop(0, `${rgba}${Math.min(0.98, brightness * 0.98)})`);
      grad.addColorStop(0.16, `${rgba}${Math.min(1, brightness)})`);
      grad.addColorStop(0.42, `${rgba}${Math.min(0.86, brightness * 0.78)})`);
      grad.addColorStop(1, `${rgba}0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(x + jitterX, (y0 + y1) * 0.5, segWidth, Math.max(8, (y1 - y0) * 0.5), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.filter = `blur(${light.type === 'hero6' ? Math.max(18, 30 * tweakState.reflectionSoftness) : Math.max(10, 18 * tweakState.reflectionSoftness)}px)`;
    ctx.fillStyle = `${rgba}${Math.min(light.type === 'hero6' ? 0.4 : 0.24, brightness * 0.2)})`;
    ctx.beginPath();
    ctx.ellipse(x + (detailRand() - 0.5) * 6, startY + length * 0.38, streakWidth * (light.type === 'hero6' ? 3.1 : 2.3), length * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.filter = `blur(${Math.max(8, 16 * tweakState.reflectionSoftness)}px)`;
    ctx.fillStyle = `${rgba}${Math.min(0.54, brightness * 0.42)})`;
    ctx.beginPath();
    ctx.ellipse(x, startY + 8, streakWidth * 1.2, 10 + streakWidth * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  reflectionTexture.needsUpdate = true;
}

function updateStatus() {
  const cameraPos = camera.position;
  const target = controls.target;
  const dotShare = Math.max(0, 1 - tweakState.starShare - tweakState.heroShare);
  statusEl.innerHTML = [
    `<strong>Scene</strong> mountain stack + painterly water + shoreline lights`,
    `<strong>Preset</strong> ${tweakState.activeLightPreset}`,
    `<strong>Gap</strong> ${tweakState.layerGap.toFixed(2)}  <strong>Scale</strong> ${tweakState.worldScale.toFixed(1)}`,
    `<strong>Water</strong> ${tweakState.waterVisible ? 'on' : 'off'}  <strong>Reflections</strong> ${tweakState.reflectionsVisible ? 'on' : 'off'}`,
    `<strong>Lights</strong> ${tweakState.lightsVisible ? `${Math.round(lightDescriptors.length)} on ${tweakState.maskLayer}` : 'hidden'}`,
    `<strong>Tower</strong> ${tweakState.towerLightsVisible ? `on mountain_03 @ ${tweakState.towerX.toFixed(3)}, ${tweakState.towerY.toFixed(3)}` : 'hidden'}`,
    `<strong>Radio Towers PNGs</strong> ${tweakState.radioTowersVisible ? `${tweakState.radioTowerInstances.filter(instance => instance.visible).length} visible` : 'hidden'}`,
    `<strong>Mix</strong> star ${(tweakState.starShare * 100).toFixed(0)} / dot ${(dotShare * 100).toFixed(0)} / hero ${(tweakState.heroShare * 100).toFixed(0)}`,
    `<strong>Camera</strong> ${cameraPos.x.toFixed(1)}, ${cameraPos.y.toFixed(1)}, ${cameraPos.z.toFixed(1)}`,
    `<strong>Target</strong> ${target.x.toFixed(1)}, ${target.y.toFixed(1)}, ${target.z.toFixed(1)}`
  ].join('<br />');
}

function updateEnvironment() {
  scene.fog.near = tweakState.fogNear;
  scene.fog.far = tweakState.fogFar;
  grid.visible = tweakState.showGrid;
}

function updateWaterLayout(nowSeconds = 0) {
  if (!waterBaseMesh || !waterPatchMesh || !waterRippleMesh) return;

  const planeWidth = 360;
  const planeDepth = 260;
  const waterZ = tweakState.groupZ + 48;
  waterGroup.visible = tweakState.waterVisible || tweakState.reflectionsVisible;
  waterGroup.position.set(tweakState.groupX, tweakState.waterY, waterZ);

  [waterBaseMesh, waterPatchMesh, waterRippleMesh].forEach(mesh => {
    mesh.rotation.x = -Math.PI * 0.5;
    mesh.scale.set(planeWidth, planeDepth, 1);
  });

  waterBaseMesh.visible = tweakState.waterVisible;
  waterPatchMesh.visible = tweakState.waterVisible;
  waterRippleMesh.visible = tweakState.waterVisible;

  waterBaseMesh.position.set(0, 0, 0);
  waterPatchMesh.position.set(0, 0.01, 0);
  waterRippleMesh.position.set(0, 0.02, 0);

  waterBaseMesh.material.color.set(0xffffff);
  waterBaseMesh.material.opacity = tweakState.waterOpacity * tweakState.waterBrightness;
  waterPatchMesh.material.opacity = tweakState.waterOpacity * tweakState.waterPatchAmount * 0.64;
  waterRippleMesh.material.opacity = tweakState.waterOpacity * tweakState.waterRippleAmount * 0.32;

  if (waterPatchTexture) {
    waterPatchTexture.offset.x = nowSeconds * tweakState.waterMotionSpeed * 0.002;
    waterPatchTexture.offset.y = nowSeconds * tweakState.waterMotionSpeed * -0.0015;
  }
  if (waterRippleTexture) {
    waterRippleTexture.offset.x = nowSeconds * tweakState.waterMotionSpeed * 0.008;
    waterRippleTexture.offset.y = nowSeconds * tweakState.waterMotionSpeed * -0.006;
  }
}

function createSeededRandom(seed = 1) {
  let t = (Math.floor(seed) || 1) >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashUnit2D(seed, x, y) {
  let h = (Math.floor(seed) || 1) ^ Math.imul(Math.floor(x), 374761393) ^ Math.imul(Math.floor(y), 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothValueNoise2D(x, y, seed = 1) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v00 = hashUnit2D(seed, ix, iy);
  const v10 = hashUnit2D(seed, ix + 1, iy);
  const v01 = hashUnit2D(seed, ix, iy + 1);
  const v11 = hashUnit2D(seed, ix + 1, iy + 1);
  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return a + (b - a) * sy;
}

function getMaskSampleState() {
  if (!spawnMaskImage) return null;
  if (maskSampleState?.image === spawnMaskImage) {
    return maskSampleState;
  }

  const width = spawnMaskImage.naturalWidth || spawnMaskImage.width || 1;
  const height = spawnMaskImage.naturalHeight || spawnMaskImage.height || 1;
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = width;
  sampleCanvas.height = height;
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  sampleCtx.clearRect(0, 0, width, height);
  sampleCtx.drawImage(spawnMaskImage, 0, 0, width, height);
  const data = sampleCtx.getImageData(0, 0, width, height).data;

  let minX = width - 1;
  let minY = height - 1;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3] / 255;
      const luminance = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
      const value = Math.max(alpha, luminance);
      if (value <= 0.04) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  maskSampleState = {
    image: spawnMaskImage,
    width,
    height,
    data,
    minX,
    minY,
    maxX,
    maxY
  };
  return maskSampleState;
}

function sampleMaskValue(sampleState, x, y) {
  const px = Math.max(0, Math.min(sampleState.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(sampleState.height - 1, Math.round(y)));
  const idx = (py * sampleState.width + px) * 4;
  const alpha = sampleState.data[idx + 3] / 255;
  const luminance = (sampleState.data[idx] * 0.299 + sampleState.data[idx + 1] * 0.587 + sampleState.data[idx + 2] * 0.114) / 255;
  return Math.max(alpha, luminance);
}

function pickAllowedMaskPoint(sampleState, rand, threshold) {
  if (!sampleState) return null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const x = sampleState.minX + rand() * Math.max(1, sampleState.maxX - sampleState.minX);
    const y = sampleState.minY + rand() * Math.max(1, sampleState.maxY - sampleState.minY);
    if (sampleMaskValue(sampleState, x, y) >= threshold) {
      return { x, y };
    }
  }
  return null;
}

function getLightMix() {
  const starShare = THREE.MathUtils.clamp(tweakState.starShare, 0, 0.9);
  const heroShare = THREE.MathUtils.clamp(tweakState.heroShare, 0, 1 - starShare);
  const dotShare = Math.max(0, 1 - starShare - heroShare);
  return { starShare, heroShare, dotShare };
}

function clearLightSprites() {
  while (lightSpritesGroup.children.length) {
    const child = lightSpritesGroup.children[lightSpritesGroup.children.length - 1];
    if (!child) break;
    lightSpritesGroup.remove(child);
    if (child.geometry && child.geometry !== sharedPlaneGeometry) {
      child.geometry.dispose();
    }
    if (child.material) {
      child.material.dispose();
    }
  }
}

function getKernelCanvasSize() {
  const requested = Math.round(96 * tweakState.lightResolutionScale);
  return THREE.MathUtils.clamp(requested, 64, 512);
}

function getBaseLightColor(role) {
  if (role === 'cool') return new THREE.Color(tweakState.coolLightColor);
  if (role === 'pale') return new THREE.Color(tweakState.paleLightColor);
  return new THREE.Color(tweakState.warmLightColor);
}

function refreshLightPresetControllerDisplays() {
  lightPresetControllers.forEach(controller => controller.updateDisplay());
}

function refreshLayerTintControllerDisplays() {
  layerTintControllers.forEach(controller => controller.updateDisplay());
}

function storeLightPresetState(presetName = tweakState.activeLightPreset) {
  const preset = LIGHT_PRESET_DEFAULTS[presetName];
  if (!preset) return;
  LIGHT_PRESET_KEYS.forEach(key => {
    preset[key] = tweakState[key];
  });
  preset.layerTints = tweakState.layers.map(layer => layer.tint);
}

function applyLightPreset(name, { storeCurrent = true } = {}) {
  if (!LIGHT_PRESET_DEFAULTS[name]) return;
  if (storeCurrent) {
    storeLightPresetState(lastActiveLightPreset);
  }
  tweakState.activeLightPreset = name;
  lastActiveLightPreset = name;
  LIGHT_PRESET_KEYS.forEach(key => {
    tweakState[key] = LIGHT_PRESET_DEFAULTS[name][key];
  });
  const presetLayerTints = LIGHT_PRESET_DEFAULTS[name].layerTints || getDefaultLayerTints();
  tweakState.layers.forEach((layer, index) => {
    layer.tint = presetLayerTints[index] || MOUNTAIN_LAYER_DEFAULTS[index]?.tint || layer.tint;
  });
  refreshLightPresetControllerDisplays();
  refreshLayerTintControllerDisplays();
  lightKernelCache.clear();
  lightLayoutKey = '';
  rebuildWaterTextures();
  rebuildVillageLights();
  updateMountains();
  updateStatus();
}

function bindLightPresetController(controller, key, onChange) {
  lightPresetControllers.push(controller);
  controller.onChange(value => {
    const preset = LIGHT_PRESET_DEFAULTS[tweakState.activeLightPreset];
    if (preset) {
      preset[key] = tweakState[key];
    }
    onChange?.(value);
  });
  return controller;
}

function bindLayerTintController(controller, index) {
  layerTintControllers.push(controller);
  controller.onChange(() => {
    const preset = LIGHT_PRESET_DEFAULTS[tweakState.activeLightPreset];
    if (preset) {
      preset.layerTints = tweakState.layers.map(layer => layer.tint);
    }
    updateMountains();
  });
  return controller;
}

function getDescriptorBaseColor(light) {
  const color = getBaseLightColor(light.colorRole);
  const hsl = {};
  color.getHSL(hsl);
  color.setHSL(
    THREE.MathUtils.clamp(hsl.h + light.colorOffsetH, 0, 1),
    THREE.MathUtils.clamp(hsl.s + light.colorOffsetS, 0, 1),
    THREE.MathUtils.clamp(hsl.l + light.colorOffsetL, 0, 1)
  );
  return color;
}

function getLightKernelTexture(type) {
  const size = getKernelCanvasSize();
  const glowStrength = tweakState.glowStrength.toFixed(2);
  const bloomStrength = tweakState.bloomStrength.toFixed(2);
  const shapeKey = [
    tweakState.starCore.toFixed(3),
    tweakState.starArm.toFixed(3),
    tweakState.starLineWidth.toFixed(3),
    tweakState.starGlow.toFixed(3),
    tweakState.dotCore.toFixed(3),
    tweakState.dotGlow.toFixed(3),
    tweakState.heroCore.toFixed(3),
    tweakState.heroArm.toFixed(3),
    tweakState.heroLineWidth.toFixed(3),
    tweakState.heroGlow.toFixed(3)
  ].join(':');
  const key = `${type}:${size}:${glowStrength}:${bloomStrength}:${shapeKey}`;
  if (lightKernelCache.has(key)) {
    return lightKernelCache.get(key);
  }

  const canvasEl = document.createElement('canvas');
  canvasEl.width = size;
  canvasEl.height = size;
  const ctx = canvasEl.getContext('2d');
  const mid = size * 0.5;
  const glowBoost = 0.72 + tweakState.glowStrength * 0.68;
  const bloomBoost = 0.7 + tweakState.bloomStrength * 0.9;
  const baseRadius = size * (
    type === 'hero6'
      ? tweakState.heroCore
      : type === 'dot'
        ? tweakState.dotCore
        : tweakState.starCore
  );
  const glowRadius = size * (
    type === 'hero6'
      ? tweakState.heroGlow
      : type === 'dot'
        ? tweakState.dotGlow
        : tweakState.starGlow
  ) * glowBoost;
  const armLength = size * (
    type === 'hero6'
      ? tweakState.heroArm
      : type === 'dot'
        ? 0
        : tweakState.starArm
  );

  const glow = ctx.createRadialGradient(mid, mid, 0, mid, mid, glowRadius);
  glow.addColorStop(0, `rgba(255,255,255,${Math.min(0.98, 0.64 + bloomBoost * 0.22)})`);
  glow.addColorStop(type === 'dot' ? 0.22 : 0.15, `rgba(255,255,255,${0.22 + bloomBoost * 0.18})`);
  glow.addColorStop(0.55, `rgba(255,255,255,${0.03 + tweakState.glowStrength * 0.09})`);
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(mid, mid, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, 0.8 + bloomBoost * 0.18)})`;
  ctx.fillStyle = `rgba(255,255,255,${Math.min(1, 0.84 + bloomBoost * 0.14)})`;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (type === 'dot') {
    ctx.beginPath();
    ctx.arc(mid, mid, baseRadius, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'hero6') {
    ctx.lineWidth = Math.max(2, size * tweakState.heroLineWidth);
    for (let i = 0; i < 3; i += 1) {
      const angle = (Math.PI / 3) * i;
      const dx = Math.cos(angle) * armLength;
      const dy = Math.sin(angle) * armLength;
      ctx.beginPath();
      ctx.moveTo(mid - dx, mid - dy);
      ctx.lineTo(mid + dx, mid + dy);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(mid, mid, baseRadius * 1.1, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.lineWidth = Math.max(2, size * tweakState.starLineWidth);
    ctx.beginPath();
    ctx.moveTo(mid - armLength, mid);
    ctx.lineTo(mid + armLength, mid);
    ctx.moveTo(mid, mid - armLength);
    ctx.lineTo(mid, mid + armLength);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mid, mid, baseRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.needsUpdate = true;
  lightKernelCache.set(key, texture);
  return texture;
}

function rebuildLightSprites() {
  const sampleState = getMaskSampleState();
  if (!sampleState) return;

  clearLightSprites();

  if (spawnMaskTexture && tweakState.showSpawnMask) {
    const maskMaterial = new THREE.MeshBasicMaterial({
      map: spawnMaskTexture,
      color: new THREE.Color(tweakState.spawnMaskTint),
      transparent: true,
      opacity: tweakState.spawnMaskOpacity,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    spawnMaskMesh = new THREE.Mesh(sharedPlaneGeometry, maskMaterial);
    spawnMaskMesh.frustumCulled = false;
    spawnMaskMesh.renderOrder = 9998;
    lightSpritesGroup.add(spawnMaskMesh);
  } else {
    spawnMaskMesh = null;
  }

  lightDescriptors.forEach((light, index) => {
    const map = getLightKernelTexture(light.type);
    const material = new THREE.MeshBasicMaterial({
      map,
      color: getBaseLightColor(light.colorRole),
      transparent: true,
      opacity: 1,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    const mesh = new THREE.Mesh(sharedPlaneGeometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10000 + index;

    const baseWidth = light.pixelSize / sampleState.width;
    const baseHeight = light.pixelSize / sampleState.height;
    mesh.position.set(light.x - 0.5, 0.5 - light.y, 0);
    mesh.scale.set(baseWidth, baseHeight, 1);
    mesh.userData.baseScaleX = baseWidth;
    mesh.userData.baseScaleY = baseHeight;
    mesh.userData.light = light;
    lightSpritesGroup.add(mesh);
  });

  applyLightSpriteColors();
}

function rebuildVillageLights() {
  const sampleState = getMaskSampleState();
  if (!sampleState) return;

  const layoutKey = [
    tweakState.lightSeed,
    tweakState.lightCount,
    tweakState.lightThreshold.toFixed(3),
    tweakState.clusterCount,
    tweakState.clusterSpread.toFixed(3),
    tweakState.starShare.toFixed(3),
    tweakState.heroShare.toFixed(3)
  ].join('|');
  if (layoutKey === lightLayoutKey && lightDescriptors.length) {
    return;
  }

  const rand = createSeededRandom(tweakState.lightSeed);
  const threshold = THREE.MathUtils.clamp(tweakState.lightThreshold, 0, 1);
  const targetCount = Math.max(12, Math.round(tweakState.lightCount));
  const clusterCount = Math.max(2, Math.round(tweakState.clusterCount));
  const { starShare, heroShare } = getLightMix();
  const minDimension = Math.min(sampleState.width, sampleState.height);

  const anchors = [];
  for (let i = 0; i < clusterCount; i += 1) {
    const point = pickAllowedMaskPoint(sampleState, rand, threshold);
    if (!point) continue;
    anchors.push({
      x: point.x,
      y: point.y,
      radius: (0.45 + rand() * 0.9) * tweakState.clusterSpread * minDimension,
      weight: 0.65 + rand() * 0.8
    });
  }

  const descriptors = [];
  const attempts = targetCount * 220;
  for (let attempt = 0; attempt < attempts && descriptors.length < targetCount; attempt += 1) {
    const anchor = anchors.length
      ? anchors[Math.floor(rand() * anchors.length)]
      : pickAllowedMaskPoint(sampleState, rand, threshold);
    if (!anchor) continue;

    const isolated = rand() < 0.14;
    let candidateX = anchor.x;
    let candidateY = anchor.y;

    if (isolated) {
      const point = pickAllowedMaskPoint(sampleState, rand, threshold);
      if (!point) continue;
      candidateX = point.x;
      candidateY = point.y;
    } else {
      const angle = rand() * Math.PI * 2;
      const radial = Math.pow(rand(), 1.55) * anchor.radius;
      const squash = 0.42 + rand() * 0.9;
      candidateX += Math.cos(angle) * radial;
      candidateY += Math.sin(angle) * radial * squash;
    }

    const sample = sampleMaskValue(sampleState, candidateX, candidateY);
    if (sample < threshold) continue;

    const localDensity = smoothValueNoise2D(candidateX * 0.025, candidateY * 0.025, tweakState.lightSeed + 19);
    const spacing = 5 + (1 - sample) * 9 + localDensity * 6;
    const tooClose = descriptors.some(light => {
      const dx = light.sampleX - candidateX;
      const dy = light.sampleY - candidateY;
      return (dx * dx + dy * dy) < ((spacing * light.spacing) ** 2);
    });
    if (tooClose) continue;

    const roll = rand();
    const type = roll < starShare ? 'star4' : roll < (starShare + heroShare) ? 'hero6' : 'dot';
    const colorRoll = rand();
    const colorRole = colorRoll < 0.72
      ? 'warm'
      : colorRoll < 0.93
        ? 'pale'
        : 'cool';
    const prominence = THREE.MathUtils.clamp(sample * 0.65 + localDensity * 0.35, 0, 1);

    descriptors.push({
      x: candidateX / sampleState.width,
      y: candidateY / sampleState.height,
      sampleX: candidateX,
      sampleY: candidateY,
      spacing: 0.8 + rand() * 0.5,
      type,
      colorRole,
      colorOffsetH: (rand() - 0.5) * 0.018,
      colorOffsetS: (rand() - 0.5) * 0.08,
      colorOffsetL: (rand() - 0.5) * 0.12,
      pixelSize: type === 'dot' ? 10 + rand() * 4 : type === 'hero6' ? 22 + rand() * 10 : 14 + rand() * 6,
      size: type === 'dot' ? 0.75 + rand() * 0.45 : type === 'hero6' ? 1.55 + rand() * 0.75 : 1.05 + rand() * 0.55,
      arm: type === 'dot' ? 0 : type === 'hero6' ? 3.1 + rand() * 2.2 : 2.0 + rand() * 1.5,
      glow: type === 'dot' ? 3.2 + rand() * 2.3 : type === 'hero6' ? 6.2 + rand() * 3.8 : 4.2 + rand() * 2.8,
      brightness: type === 'dot' ? 0.62 + rand() * 0.28 : type === 'hero6' ? 1 + rand() * 0.4 : 0.74 + rand() * 0.3,
      pulseSpeed: type === 'dot' ? 0.85 + rand() * 0.65 : type === 'hero6' ? 1.2 + rand() * 0.95 : 0.95 + rand() * 0.8,
      shimmerSpeed: 0.45 + rand() * 1.1,
      phase: rand() * Math.PI * 2,
      prominence
    });
  }

  lightDescriptors = descriptors;
  lightLayoutKey = layoutKey;
  rebuildWaterTextures();
  rebuildLightSprites();
  rebuildReflectionTexture();
  updateStatus();
}

function applyLightSpriteColors() {
  lightSpritesGroup.children.forEach(child => {
    if (child === spawnMaskMesh) {
      if (child.material) {
        child.material.opacity = tweakState.spawnMaskOpacity;
        child.material.color.set(tweakState.spawnMaskTint);
      }
      return;
    }

    const light = child.userData.light;
    if (!light || !child.material) return;
    child.material.color.copy(getDescriptorBaseColor(light));
  });
}

function updateLightSprites(nowSeconds) {
  lightSpritesGroup.children.forEach(child => {
    if (child === spawnMaskMesh) {
      if (child.material) {
        child.material.opacity = tweakState.spawnMaskOpacity;
        child.material.color.set(tweakState.spawnMaskTint);
      }
      return;
    }

    const light = child.userData.light;
    if (!light) return;

    const time = nowSeconds * tweakState.twinkleFrequency;
    const shimmer = Math.sin(time * light.shimmerSpeed + light.phase) * 0.5 + 0.5;
    const wave = Math.sin(time * light.pulseSpeed + light.phase) * 0.5 + 0.5;
    const ember = Math.sin(time * (light.pulseSpeed * 2.2) + light.phase * 1.73) * 0.5 + 0.5;
    const flutter = Math.sin(time * (light.shimmerSpeed * 3.1) + light.phase * 0.61) * 0.5 + 0.5;
    const heroPulse = light.type === 'hero6' ? Math.pow(wave, 5) : wave;
    const twinklePulse = light.type === 'hero6'
      ? 0.28 * shimmer + 0.72 * heroPulse
      : light.type === 'dot'
        ? 0.58 * wave + 0.42 * shimmer
        : 0.46 * wave + 0.24 * shimmer + 0.3 * heroPulse;
    const firePulse = THREE.MathUtils.clamp(
      0.42 * wave + 0.28 * shimmer + 0.2 * ember + 0.1 * flutter,
      0,
      1
    );
    const twinkleMix = tweakState.twinkleStrength * twinklePulse;
    const intensity = light.brightness * (
      0.28 +
      twinkleMix * (light.type === 'dot' ? 0.7 : light.type === 'hero6' ? 1.15 : 0.92) +
      tweakState.fireStrength * (0.18 * firePulse)
    );
    const bloomScale = 0.92 + tweakState.bloomStrength * 0.22;
    const scalePulse = (
      light.type === 'hero6'
        ? 0.82 + twinkleMix * 0.42 + tweakState.fireStrength * firePulse * 0.12
        : light.type === 'dot'
          ? 0.88 + twinkleMix * 0.18 + tweakState.fireStrength * firePulse * 0.05
          : 0.86 + twinkleMix * 0.28 + tweakState.fireStrength * firePulse * 0.08
    ) * bloomScale;

    child.material.opacity = THREE.MathUtils.clamp(intensity * tweakState.lightOpacity * (0.7 + tweakState.bloomStrength * 0.45), 0, 1);
    const color = getDescriptorBaseColor(light);
    const hsl = {};
    color.getHSL(hsl);
    const warmthBias = light.colorRole === 'cool' ? 0.35 : light.colorRole === 'pale' ? 0.7 : 1;
    const fireMix = tweakState.fireStrength * firePulse * warmthBias;
    const twinkleColorMix = twinkleMix * 0.06 * warmthBias;
    color.setHSL(
      THREE.MathUtils.clamp(hsl.h - tweakState.fireColorShift * fireMix - twinkleColorMix * 0.25, 0, 1),
      THREE.MathUtils.clamp(hsl.s + fireMix * 0.12 + twinkleColorMix * 0.4 - (1 - firePulse) * tweakState.fireStrength * 0.03, 0, 1),
      THREE.MathUtils.clamp(hsl.l + fireMix * 0.1 + twinkleColorMix * 0.9 - (1 - firePulse) * tweakState.fireStrength * 0.06, 0, 1)
    );
    child.material.color.copy(color);
    child.scale.set(
      child.userData.baseScaleX * scalePulse,
      child.userData.baseScaleY * scalePulse,
      1
    );
  });

  if (reflectionMesh?.material) {
    const wave = Math.sin(nowSeconds * tweakState.twinkleFrequency * 0.55) * 0.5 + 0.5;
    const shimmer = Math.sin(nowSeconds * tweakState.twinkleFrequency * 0.92 + 0.7) * 0.5 + 0.5;
    reflectionMesh.material.opacity = THREE.MathUtils.clamp(
      tweakState.lightOpacity * (0.6 + wave * 0.12 + shimmer * 0.08),
      0,
      1
    );
  }
}

function updateTowerLights(nowSeconds) {
  const targetLayer = layerRefs[2];
  const presetVisibility = tweakState.activeLightPreset === 'night'
    ? 1
    : tweakState.activeLightPreset === 'sunset'
      ? 0.78
      : 0;
  towerLightsGroup.visible = tweakState.towerLightsVisible && presetVisibility > 0.001 && !!targetLayer;
  if (!towerLightsGroup.visible) return;

  towerLightMeshes.forEach((mesh) => {
    const tower = mesh.userData.tower;
    const cycle = (nowSeconds * 0.64 + tower.phase) % 1;
    const blinkA = THREE.MathUtils.clamp(1 - Math.abs(cycle - 0.05) / 0.045, 0, 1);
    const blinkB = THREE.MathUtils.clamp(1 - Math.abs(cycle - 0.16) / 0.036, 0, 1);
    const blink = Math.max(blinkA, blinkB);
    const idle = tweakState.activeLightPreset === 'night' ? 0.045 : 0.022;
    const intensity = presetVisibility * tweakState.towerBrightness * tower.strength * (idle + blink * 0.98);
    const scale = tweakState.towerScale * (0.92 + blink * 0.34);
    mesh.material.opacity = THREE.MathUtils.clamp(intensity, 0, 1);
    mesh.scale.set(scale, scale, 1);
  });
}

function updateRadioTowerBeaconLights(nowSeconds) {
  const presetVisibility = tweakState.activeLightPreset === 'night'
    ? 1
    : tweakState.activeLightPreset === 'sunset'
      ? 0.8
      : 0;
  const tierInterval = 0.2;
  const pauseDuration = 2.0;
  const pulseDuration = 0.22;
  const cycleDuration = tierInterval * 2 + pauseDuration;

  radioTowerRefs.forEach((radioTowerRef, towerIndex) => {
    const localTime = (nowSeconds + towerIndex * 0.85) % cycleDuration;
    radioTowerRef.beaconMeshes?.forEach((mesh) => {
      const row = mesh.userData.row || 0;
      const pulseStart = row * tierInterval;
      const pulseTime = localTime - pulseStart;
      let pulse = THREE.MathUtils.clamp(1 - Math.abs(pulseTime - pulseDuration * 0.5) / (pulseDuration * 0.5), 0, 1);
      pulse = pulse * pulse * (3 - 2 * pulse);
      const intensity = presetVisibility * (0.08 + pulse * 2.4);
      const scaleMultiplier = THREE.MathUtils.lerp(1, 6, pulse);
      mesh.material.opacity = THREE.MathUtils.clamp(intensity, 0, 1);
      mesh.scale.set(
        mesh.userData.baseScaleX * scaleMultiplier,
        mesh.userData.baseScaleY * scaleMultiplier,
        1
      );
    });
  });
}

function updateMountains() {
  mountainGroup.position.set(tweakState.groupX, tweakState.groupY, tweakState.groupZ);
  mountainGroup.rotation.set(
    THREE.MathUtils.degToRad(tweakState.rotX),
    THREE.MathUtils.degToRad(tweakState.rotY),
    THREE.MathUtils.degToRad(tweakState.rotZ)
  );

  const centerIndex = (layerRefs.length - 1) * 0.5;
  const aspect = camera?.aspect || Math.max(window.innerWidth / Math.max(window.innerHeight, 1), 1);

  layerRefs.forEach((layerRef, index) => {
    const layer = tweakState.layers[index];
    const width = aspect * tweakState.worldScale * tweakState.widthScale * layer.widthMultiplier;
    const height = tweakState.worldScale * tweakState.heightScale * layer.heightMultiplier;
    const z = layer.zOffset + (centerIndex - index) * tweakState.layerGap;

    layerRef.mesh.scale.set(width, height, 1);
    layerRef.mesh.position.set(layer.xOffset || 0, height * 0.5 + layer.yOffset, z);
    layerRef.mesh.renderOrder = 4 + (layerRefs.length - 1 - index);
    layerRef.material.color.set(layer.tint);
    layerRef.material.opacity = layer.opacity;
    layerRef.material.alphaTest = tweakState.alphaTest;
    layerRef.material.needsUpdate = true;
  });

  if (radioTowerRefs.length) {
    const layer3 = layerRefs[2];
    const layer4 = layerRefs[3];
    const baseZ = layer3 && layer4
      ? (layer3.mesh.position.z + layer4.mesh.position.z) * 0.5
      : -0.035;
    const renderOrder = layer3 && layer4
      ? (layer3.mesh.renderOrder + layer4.mesh.renderOrder) * 0.5
      : 6.5;
    radioTowerRefs.forEach((radioTowerRef, index) => {
      const instance = tweakState.radioTowerInstances[index] || tweakState.radioTowerInstances[0];
      const radioAspect = (radioTowerRef.texture.image?.width || 1) / Math.max(radioTowerRef.texture.image?.height || 1, 1);
      const width = aspect * tweakState.worldScale * tweakState.widthScale * radioAspect * (instance?.width ?? 1);
      const height = tweakState.worldScale * tweakState.heightScale * (instance?.height ?? 1);
      radioTowerRef.mesh.scale.set(width, height, 1);
      radioTowerRef.mesh.position.set(
        instance?.x ?? 0,
        height * 0.5 + (instance?.y ?? 0),
        baseZ + (instance?.zOffset ?? 0) + index * 0.0005
      );
      radioTowerRef.mesh.renderOrder = renderOrder + index * 0.01;
      radioTowerRef.mesh.visible = tweakState.radioTowersVisible && !!instance?.visible;
      radioTowerRef.material.opacity = instance?.opacity ?? 1;
      radioTowerRef.material.alphaTest = tweakState.alphaTest;
      radioTowerRef.material.needsUpdate = true;
    });
  }

  const towerLayerRef = layerRefs[2];
  if (towerLayerRef) {
    towerLightsGroup.position.copy(towerLayerRef.mesh.position);
    towerLightsGroup.position.z += tweakState.towerZOffset;
    towerLightsGroup.scale.copy(towerLayerRef.mesh.scale);
    towerLightsGroup.renderOrder = towerLayerRef.mesh.renderOrder + 1.5;
    towerLightMeshes.forEach((mesh, index) => {
      const tower = mesh.userData.tower;
      mesh.position.set(
        tweakState.towerX - 0.5,
        0.5 - (tweakState.towerY + tower.offset * tweakState.towerSpacing),
        index * 0.0005
      );
      mesh.renderOrder = towerLayerRef.mesh.renderOrder + 1.5 + index * 0.01;
    });
  } else {
    towerLightsGroup.visible = false;
  }

  updateWaterLayout();

  const targetIndex = tweakState.layers.findIndex(layer => layer.name === tweakState.maskLayer);
  const targetRef = layerRefs[targetIndex];
  if (targetRef) {
    lightSpritesGroup.visible = tweakState.lightsVisible || tweakState.showSpawnMask;
    lightSpritesGroup.position.copy(targetRef.mesh.position);
    lightSpritesGroup.position.z += tweakState.lightZOffset;
    lightSpritesGroup.scale.copy(targetRef.mesh.scale);
    lightSpritesGroup.renderOrder = targetRef.mesh.renderOrder + 1;

    if (reflectionMesh) {
      const reflectionHeight = targetRef.mesh.scale.y * 0.88;
      const bottomY = targetRef.mesh.position.y - targetRef.mesh.scale.y * 0.5;
      if (reflectionPivot) {
        reflectionPivot.visible = tweakState.reflectionsVisible;
        reflectionPivot.position.set(
          targetRef.mesh.position.x,
          bottomY - reflectionHeight * ((tweakState.reflectionDrop || 0) - 0.5),
          targetRef.mesh.position.z + 0.12
        );
        reflectionPivot.rotation.set(THREE.MathUtils.degToRad(tweakState.reflectionTiltX || 0), 0, 0);
      }
      reflectionMesh.visible = tweakState.reflectionsVisible;
      reflectionMesh.position.set(
        0,
        -reflectionHeight * 0.5,
        0
      );
      reflectionMesh.scale.set(targetRef.mesh.scale.x * 1.04, reflectionHeight, 1);
      reflectionMesh.renderOrder = targetRef.mesh.renderOrder + 0.7;
    }
  } else {
    lightSpritesGroup.visible = false;
    if (reflectionMesh) reflectionMesh.visible = false;
    if (reflectionPivot) reflectionPivot.visible = false;
  }

  updateStatus();
}

async function initScene() {
  statusEl.textContent = 'Loading mountain textures…';

  const [mountainTextures, radioTowerImage, maskImage, maskTexture] = await Promise.all([
    Promise.all(MOUNTAIN_LAYER_DEFAULTS.map(layer => loadTexture(layer.path))),
    loadImage('/images/radiotower.png'),
    loadImage('/images/lights_mask.png'),
    loadTexture('/images/lights_mask.png')
  ]);
  const radioTowerTexture = buildRadioTowerTexture(radioTowerImage);
  spawnMaskImage = maskImage;
  spawnMaskTexture = maskTexture;

  mountainTextures.forEach((texture, index) => {
    const layer = tweakState.layers[index];
    const material = buildMountainMaterial(texture, layer);
    const mesh = new THREE.Mesh(sharedPlaneGeometry, material);
    mesh.frustumCulled = false;
    mountainGroup.add(mesh);
    layerRefs.push({ mesh, material, texture });
  });

  Array.from({ length: 3 }).forEach(() => {
    const material = new THREE.MeshBasicMaterial({
      map: radioTowerTexture,
      color: new THREE.Color(0xffffff),
      transparent: true,
      opacity: 1,
      alphaTest: tweakState.alphaTest,
      side: THREE.DoubleSide,
      depthWrite: true,
      depthTest: true,
      toneMapped: false
    });
    const mesh = new THREE.Mesh(sharedPlaneGeometry, material);
    mesh.frustumCulled = false;
    mountainGroup.add(mesh);
    const beaconMeshes = [];
    const beaconMap = getTowerKernelTexture();
    RADIO_TOWER_BEACONS.forEach((beacon, beaconIndex) => {
      const beaconMesh = new THREE.Mesh(
        sharedPlaneGeometry,
        new THREE.MeshBasicMaterial({
          map: beaconMap,
          color: new THREE.Color(0xff6a6a),
          transparent: true,
          opacity: 0,
          depthTest: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          toneMapped: false
        })
      );
      beaconMesh.frustumCulled = false;
      beaconMesh.position.set(
        beacon.x / RADIO_TOWER_IMAGE_SIZE.width - 0.5,
        0.5 - beacon.y / RADIO_TOWER_IMAGE_SIZE.height,
        0.002 + beaconIndex * 0.0001
      );
      beaconMesh.userData.row = beacon.row;
      beaconMesh.userData.baseScaleX = 42 / RADIO_TOWER_IMAGE_SIZE.width;
      beaconMesh.userData.baseScaleY = 42 / RADIO_TOWER_IMAGE_SIZE.height;
      beaconMesh.scale.set(beaconMesh.userData.baseScaleX, beaconMesh.userData.baseScaleY, 1);
      beaconMesh.renderOrder = 12000 + beaconIndex;
      mesh.add(beaconMesh);
      beaconMeshes.push(beaconMesh);
    });
    radioTowerRefs.push({ mesh, material, texture: radioTowerTexture, beaconMeshes });
  });

  waterBaseMesh = new THREE.Mesh(
    sharedPlaneGeometry,
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffffff),
      transparent: true,
      opacity: tweakState.waterOpacity,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false
    })
  );
  waterPatchMesh = new THREE.Mesh(
    sharedPlaneGeometry,
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false
    })
  );
  waterRippleMesh = new THREE.Mesh(
    sharedPlaneGeometry,
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false
    })
  );
  [waterBaseMesh, waterPatchMesh, waterRippleMesh].forEach(mesh => {
    mesh.frustumCulled = false;
    waterGroup.add(mesh);
  });
  rebuildWaterTextures();

  ensureReflectionTexture();
  reflectionPivot = new THREE.Group();
  reflectionPivot.name = 'ReflectionPivot';
  reflectionMesh = new THREE.Mesh(
    sharedPlaneGeometry,
    new THREE.MeshBasicMaterial({
      map: reflectionTexture,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false
    })
  );
  reflectionMesh.frustumCulled = false;
  reflectionPivot.add(reflectionMesh);
  mountainGroup.add(reflectionPivot);

  const towerMap = getTowerKernelTexture();
  towerLightDescriptors.forEach((tower, index) => {
    const mesh = new THREE.Mesh(
      sharedPlaneGeometry,
      new THREE.MeshBasicMaterial({
        map: towerMap,
        color: new THREE.Color(0xff4343),
        transparent: true,
        opacity: 1,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false
      })
    );
    mesh.frustumCulled = false;
    mesh.userData.tower = tower;
    mesh.renderOrder = 11000 + index;
    towerLightsGroup.add(mesh);
    towerLightMeshes.push(mesh);
  });

  rebuildVillageLights();

  updateEnvironment();
  updateMountains();
  updateStatus();
}

const gui = new GUI({ title: 'Mountain Light Lab' });
gui.domElement.style.marginTop = '14px';
gui.close();

const sceneFolder = gui.addFolder('Scene');
sceneFolder.close();
sceneFolder.add(tweakState, 'showGrid').name('Grid').onChange(updateEnvironment);
sceneFolder.add(tweakState, 'fogNear', 10, 140, 1).name('Fog Near').onChange(updateEnvironment);
sceneFolder.add(tweakState, 'fogFar', 80, 320, 1).name('Fog Far').onChange(updateEnvironment);
sceneFolder.add(tweakState, 'resetCamera').name('Reset Camera');

const stackFolder = gui.addFolder('Mountain Stack');
stackFolder.close();
stackFolder.add(tweakState, 'worldScale', 10, 180, 0.1).name('World Scale').onChange(updateMountains);
stackFolder.add(tweakState, 'widthScale', 0.2, 4, 0.01).name('Width').onChange(updateMountains);
stackFolder.add(tweakState, 'heightScale', 0.1, 2.5, 0.01).name('Height').onChange(updateMountains);
stackFolder.add(tweakState, 'layerGap', -20, 20, 0.01).name('Layer Gap').onChange(updateMountains);
stackFolder.add(tweakState, 'groupX', -120, 120, 0.1).name('Group X').onChange(updateMountains);
stackFolder.add(tweakState, 'groupY', -40, 80, 0.1).name('Group Y').onChange(updateMountains);
stackFolder.add(tweakState, 'groupZ', -220, 120, 0.1).name('Group Z').onChange(updateMountains);
stackFolder.add(tweakState, 'rotX', -90, 90, 0.1).name('Rot X').onChange(updateMountains);
stackFolder.add(tweakState, 'rotY', -90, 90, 0.1).name('Rot Y').onChange(updateMountains);
stackFolder.add(tweakState, 'rotZ', -90, 90, 0.1).name('Rot Z').onChange(updateMountains);
stackFolder.add(tweakState, 'alphaTest', 0, 0.5, 0.001).name('Alpha Test').onChange(updateMountains);

const waterFolder = gui.addFolder('Water');
waterFolder.close();
bindLightPresetController(waterFolder.add(tweakState, 'waterVisible').name('Visible'), 'waterVisible', () => updateWaterLayout());
bindLightPresetController(waterFolder.add(tweakState, 'waterY', -8, 8, 0.01).name('Horizon Y'), 'waterY', () => updateWaterLayout());
bindLightPresetController(waterFolder.addColor(tweakState, 'waterBaseColor').name('Base Tint'), 'waterBaseColor', () => {
  rebuildWaterTextures();
  updateWaterLayout();
});
bindLightPresetController(waterFolder.add(tweakState, 'waterPatchAmount', 0, 1.5, 0.01).name('Patch Amount'), 'waterPatchAmount', () => updateWaterLayout());
bindLightPresetController(waterFolder.add(tweakState, 'waterPatchWarmth', 0, 1, 0.01).name('Patch Warmth'), 'waterPatchWarmth', () => {
  rebuildWaterTextures();
  updateWaterLayout();
});
bindLightPresetController(waterFolder.add(tweakState, 'waterRippleAmount', 0, 1.5, 0.01).name('Ripple Amount'), 'waterRippleAmount', () => updateWaterLayout());
bindLightPresetController(waterFolder.add(tweakState, 'waterMotionSpeed', 0, 1, 0.01).name('Motion'), 'waterMotionSpeed', updateStatus);
bindLightPresetController(waterFolder.add(tweakState, 'waterOpacity', 0, 1, 0.01).name('Opacity'), 'waterOpacity', () => updateWaterLayout());
bindLightPresetController(waterFolder.add(tweakState, 'waterBrightness', 0.2, 1.4, 0.01).name('Brightness'), 'waterBrightness', () => updateWaterLayout());
bindLightPresetController(waterFolder.add(tweakState, 'waterHorizonGlow', 0, 1, 0.01).name('Horizon Glow'), 'waterHorizonGlow', () => {
  rebuildWaterTextures();
  updateWaterLayout();
});

const reflectionFolder = gui.addFolder('Reflections');
reflectionFolder.close();
bindLightPresetController(reflectionFolder.add(tweakState, 'reflectionsVisible').name('Visible'), 'reflectionsVisible', () => {
  rebuildReflectionTexture();
  updateWaterLayout();
});
bindLightPresetController(reflectionFolder.add(tweakState, 'reflectionStretch', 0.1, 1.5, 0.01).name('Stretch'), 'reflectionStretch', () => {
  rebuildReflectionTexture();
});
bindLightPresetController(reflectionFolder.add(tweakState, 'reflectionWidth', 0.2, 1.8, 0.01).name('Width'), 'reflectionWidth', () => {
  rebuildReflectionTexture();
});
bindLightPresetController(reflectionFolder.add(tweakState, 'reflectionSoftness', 0.1, 1.4, 0.01).name('Softness'), 'reflectionSoftness', () => {
  rebuildReflectionTexture();
});
bindLightPresetController(reflectionFolder.add(tweakState, 'reflectionBreakup', 0, 1, 0.01).name('Breakup'), 'reflectionBreakup', () => {
  rebuildReflectionTexture();
});
bindLightPresetController(reflectionFolder.add(tweakState, 'reflectionCoupling', 0, 1, 0.01).name('Source Couple'), 'reflectionCoupling', rebuildReflectionTexture);
bindLightPresetController(reflectionFolder.add(tweakState, 'reflectionBrightness', 0, 2, 0.01).name('Brightness'), 'reflectionBrightness', () => {
  rebuildReflectionTexture();
});
bindLightPresetController(reflectionFolder.add(tweakState, 'reflectionHeroBoost', 0.8, 2, 0.01).name('Hero Boost'), 'reflectionHeroBoost', () => {
  rebuildReflectionTexture();
});
bindLightPresetController(reflectionFolder.add(tweakState, 'reflectionDrop', 0, 0.8, 0.01).name('Y Drop'), 'reflectionDrop', updateMountains);
bindLightPresetController(reflectionFolder.add(tweakState, 'reflectionTiltX', -80, 80, 0.1).name('Angle X'), 'reflectionTiltX', updateMountains);

const presetFolder = gui.addFolder('Light Preset');
presetFolder.close();
presetFolder
  .add(tweakState, 'activeLightPreset', { Day: 'day', Sunset: 'sunset', Night: 'night' })
  .name('Preset')
  .onChange(value => applyLightPreset(value));

const lightFolder = gui.addFolder('Village Lights');
lightFolder.close();
lightFolder.add(tweakState, 'lightsVisible').name('Visible').onChange(updateMountains);
lightFolder.add(tweakState, 'maskLayer', MOUNTAIN_LAYER_DEFAULTS.map(layer => layer.name)).name('Target Layer').onChange(updateMountains);
bindLightPresetController(lightFolder.add(tweakState, 'lightCount', 24, 120, 1).name('Count'), 'lightCount', () => {
  lightLayoutKey = '';
  rebuildVillageLights();
  updateMountains();
});
bindLightPresetController(lightFolder.add(tweakState, 'lightThreshold', 0.01, 0.9, 0.01).name('Threshold'), 'lightThreshold', () => {
  lightLayoutKey = '';
  rebuildVillageLights();
});
bindLightPresetController(lightFolder.add(tweakState, 'lightResolutionScale', 1, 8, 0.1).name('Res Scale'), 'lightResolutionScale', () => {
  lightKernelCache.clear();
  lightLayoutKey = '';
  rebuildVillageLights();
  updateMountains();
});
bindLightPresetController(lightFolder.add(tweakState, 'clusterCount', 2, 16, 1).name('Clusters'), 'clusterCount', () => {
  lightLayoutKey = '';
  rebuildVillageLights();
});
bindLightPresetController(lightFolder.add(tweakState, 'clusterSpread', 0.02, 0.2, 0.005).name('Cluster Spread'), 'clusterSpread', () => {
  lightLayoutKey = '';
  rebuildVillageLights();
});
bindLightPresetController(lightFolder.add(tweakState, 'starShare', 0.2, 0.8, 0.01).name('Star Share'), 'starShare', () => {
  lightLayoutKey = '';
  rebuildVillageLights();
});
bindLightPresetController(lightFolder.add(tweakState, 'heroShare', 0.02, 0.3, 0.01).name('Hero Share'), 'heroShare', () => {
  lightLayoutKey = '';
  rebuildVillageLights();
});
bindLightPresetController(lightFolder.add(tweakState, 'glowStrength', 0.2, 3, 0.01).name('Glow'), 'glowStrength', () => {
  lightKernelCache.clear();
  rebuildLightSprites();
  rebuildReflectionTexture();
  updateStatus();
});
bindLightPresetController(lightFolder.add(tweakState, 'bloomStrength', 0, 3, 0.01).name('Bloom'), 'bloomStrength', () => {
  lightKernelCache.clear();
  rebuildLightSprites();
  rebuildReflectionTexture();
  updateStatus();
});
bindLightPresetController(lightFolder.add(tweakState, 'twinkleStrength', 0, 2, 0.01).name('Twinkle'), 'twinkleStrength', updateStatus);
bindLightPresetController(lightFolder.add(tweakState, 'twinkleFrequency', 0.1, 4, 0.01).name('Twinkle Freq'), 'twinkleFrequency', updateStatus);
bindLightPresetController(lightFolder.add(tweakState, 'fireStrength', 0, 2, 0.01).name('Fire Motion'), 'fireStrength', updateStatus);
bindLightPresetController(lightFolder.add(tweakState, 'fireColorShift', 0, 0.12, 0.001).name('Fire Color'), 'fireColorShift', updateStatus);
bindLightPresetController(lightFolder.add(tweakState, 'lightOpacity', 0, 1, 0.01).name('Opacity'), 'lightOpacity', updateMountains);
bindLightPresetController(lightFolder.add(tweakState, 'lightZOffset', -2, 2, 0.001).name('Z Nudge'), 'lightZOffset', updateMountains);
bindLightPresetController(lightFolder.add(tweakState, 'lightSeed', 1, 9999, 1).name('Seed'), 'lightSeed', () => {
  lightLayoutKey = '';
  rebuildVillageLights();
});
lightFolder.add(tweakState, 'showSpawnMask').name('Show Mask').onChange(() => {
  rebuildLightSprites();
  updateMountains();
});
bindLightPresetController(lightFolder.addColor(tweakState, 'warmLightColor').name('Warm'), 'warmLightColor', () => {
  applyLightSpriteColors();
  rebuildReflectionTexture();
});
bindLightPresetController(lightFolder.addColor(tweakState, 'paleLightColor').name('Pale'), 'paleLightColor', () => {
  applyLightSpriteColors();
  rebuildReflectionTexture();
});
bindLightPresetController(lightFolder.addColor(tweakState, 'coolLightColor').name('Cool'), 'coolLightColor', () => {
  applyLightSpriteColors();
  rebuildReflectionTexture();
});
  bindLightPresetController(lightFolder.add(tweakState, 'spawnMaskOpacity', 0, 0.4, 0.01).name('Mask Opacity'), 'spawnMaskOpacity', updateStatus);
  bindLightPresetController(lightFolder.addColor(tweakState, 'spawnMaskTint').name('Mask Tint'), 'spawnMaskTint', updateStatus);

const towerFolder = gui.addFolder('Tower Lights');
towerFolder.close();
towerFolder.add(tweakState, 'towerLightsVisible').name('Visible').onChange(updateMountains);
towerFolder.add(tweakState, 'towerX', 0.5, 0.98, 0.001).name('X').onChange(updateMountains);
towerFolder.add(tweakState, 'towerY', 0.02, 0.6, 0.001).name('Y').onChange(updateMountains);
towerFolder.add(tweakState, 'towerSpacing', 0.02, 0.2, 0.001).name('Spacing').onChange(updateMountains);
towerFolder.add(tweakState, 'towerScale', 0.004, 0.06, 0.001).name('Scale').onChange(updateMountains);
towerFolder.add(tweakState, 'towerZOffset', -1, 1, 0.001).name('Z Nudge').onChange(updateMountains);
towerFolder.add(tweakState, 'towerBrightness', 0, 2, 0.01).name('Brightness').onChange(updateStatus);

const radioTowersFolder = gui.addFolder('Radio Towers');
radioTowersFolder.close();
radioTowersFolder.add(tweakState, 'radioTowersVisible').name('Visible').onChange(updateMountains);
tweakState.radioTowerInstances.forEach((instance, index) => {
  const folder = radioTowersFolder.addFolder(`Tower ${index + 1}`);
  folder.close();
  folder.add(instance, 'visible').name('Visible').onChange(updateMountains);
  folder.add(instance, 'x', -80, 80, 0.01).name('X').onChange(updateMountains);
  folder.add(instance, 'y', -40, 40, 0.01).name('Y').onChange(updateMountains);
  folder.add(instance, 'zOffset', -20, 20, 0.01).name('Z').onChange(updateMountains);
  folder.add(instance, 'width', 0.01, 4, 0.01).name('Width').onChange(updateMountains);
  folder.add(instance, 'height', 0.01, 4, 0.01).name('Height').onChange(updateMountains);
  folder.add(instance, 'opacity', 0, 1, 0.01).name('Opacity').onChange(updateMountains);
});

const spriteFolder = gui.addFolder('Sprite Shape');
spriteFolder.close();
const rebuildSpriteKernels = () => {
  lightKernelCache.clear();
  rebuildLightSprites();
  rebuildReflectionTexture();
  updateStatus();
};
bindLightPresetController(spriteFolder.add(tweakState, 'starCore', 0.01, 0.18, 0.001).name('Star Core'), 'starCore', rebuildSpriteKernels);
bindLightPresetController(spriteFolder.add(tweakState, 'starArm', 0.02, 0.4, 0.001).name('Star Arm'), 'starArm', rebuildSpriteKernels);
bindLightPresetController(spriteFolder.add(tweakState, 'starLineWidth', 0.004, 0.08, 0.001).name('Star Line'), 'starLineWidth', rebuildSpriteKernels);
bindLightPresetController(spriteFolder.add(tweakState, 'starGlow', 0.04, 0.5, 0.001).name('Star Glow'), 'starGlow', rebuildSpriteKernels);
bindLightPresetController(spriteFolder.add(tweakState, 'dotCore', 0.01, 0.2, 0.001).name('Dot Core'), 'dotCore', rebuildSpriteKernels);
bindLightPresetController(spriteFolder.add(tweakState, 'dotGlow', 0.02, 0.5, 0.001).name('Dot Glow'), 'dotGlow', rebuildSpriteKernels);
bindLightPresetController(spriteFolder.add(tweakState, 'heroCore', 0.02, 0.2, 0.001).name('Hero Core'), 'heroCore', rebuildSpriteKernels);
bindLightPresetController(spriteFolder.add(tweakState, 'heroArm', 0.04, 0.5, 0.001).name('Hero Arm'), 'heroArm', rebuildSpriteKernels);
bindLightPresetController(spriteFolder.add(tweakState, 'heroLineWidth', 0.004, 0.08, 0.001).name('Hero Line'), 'heroLineWidth', rebuildSpriteKernels);
bindLightPresetController(spriteFolder.add(tweakState, 'heroGlow', 0.05, 0.6, 0.001).name('Hero Glow'), 'heroGlow', rebuildSpriteKernels);

const widthFolder = gui.addFolder('Layer Widths');
widthFolder.close();
tweakState.layers.forEach((layer, index) => {
  widthFolder
    .add(layer, 'widthMultiplier', 0.2, 4, 0.01)
    .name(`Layer ${index + 1}`)
    .onChange(updateMountains);
});

const layerFolder = gui.addFolder('Layers');
layerFolder.close();
tweakState.layers.forEach((layer, index) => {
  const folder = layerFolder.addFolder(`Layer ${index + 1}`);
  folder.close();
  folder.add(layer, 'xOffset', -80, 80, 0.01).name('X Offset').onChange(updateMountains);
  folder.add(layer, 'zOffset', -40, 40, 0.01).name('Depth').onChange(updateMountains);
  folder.add(layer, 'yOffset', -40, 40, 0.01).name('Y Offset').onChange(updateMountains);
  folder.add(layer, 'widthMultiplier', 0.2, 4, 0.01).name('Width Mul').onChange(updateMountains);
  folder.add(layer, 'heightMultiplier', 0.2, 4, 0.01).name('Height Mul').onChange(updateMountains);
  folder.add(layer, 'opacity', 0, 1, 0.01).name('Opacity').onChange(updateMountains);
  bindLayerTintController(folder.addColor(layer, 'tint').name('Tint'), index);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

controls.addEventListener('change', updateStatus);

initScene().catch(error => {
  console.error('Failed to start Mountain Light Lab:', error);
  statusEl.textContent = `Failed to load scene: ${error.message}`;
});

function render() {
  requestAnimationFrame(render);
  controls.update();
  const now = performance.now() * 0.001;
  updateWaterLayout(now);
  updateLightSprites(now);
  updateTowerLights(now);
  updateRadioTowerBeaconLights(now);
  renderer.render(scene, camera);
}

render();
