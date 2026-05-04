import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ReflectionWater } from './ReflectionWater.js';
import {
  MOUNTAIN_STACK_DEFAULTS,
  MOUNTAIN_LAYER_DEFAULTS,
  MOUNTAIN_TINT_PRESETS
} from '../light-mask-lab/mountainDefaults.js';
import { LIGHT_PRESET_BASES } from '../light-mask-lab/lightPresets.js';

const canvas = document.getElementById('demo-canvas');
const statusEl = document.getElementById('status');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 20000);
camera.position.set(0, 20, 110);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.1, 0.4, 0.85);
bloomPass.threshold = 0;
bloomPass.strength = 0.1;
bloomPass.radius = 0;
composer.addPass(bloomPass);

const stats = new Stats();
document.body.appendChild(stats.dom);

const controls = new OrbitControls(camera, renderer.domElement);
controls.maxPolarAngle = Math.PI * 0.495;
controls.target.set(0, 9, -18);
controls.minDistance = 30;
controls.maxDistance = 260;
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.update();

const sun = new THREE.Vector3();
const pmremGenerator = new THREE.PMREMGenerator(renderer);
const sceneEnv = new THREE.Scene();
const sharedPlaneGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
const textureLoader = new THREE.TextureLoader();
const MAIN_SCENE_LAYER = 0;
const REFLECTION_EMITTER_LAYER = 1;
const mountainGroup = new THREE.Group();
const lightSpritesGroup = new THREE.Group();
const reflectionEmitterGroup = new THREE.Group();
mountainGroup.name = 'OceanMountainGroup';
lightSpritesGroup.name = 'OceanVillageLights';
reflectionEmitterGroup.name = 'OceanReflectionEmitters';
mountainGroup.add(lightSpritesGroup);
mountainGroup.add(reflectionEmitterGroup);
scene.add(mountainGroup);
camera.layers.enable(MAIN_SCENE_LAYER);
camera.layers.disable(REFLECTION_EMITTER_LAYER);

let renderTarget;
let water;
let sky;
let spawnMaskImage = null;
let maskSampleState = null;
let lightLayoutKey = '';
let lightDescriptors = [];
const lightKernelCache = new Map();
const reflectionEmitterKernelCache = new Map();
const layerRefs = [];

const parameters = {
  preset: 'sunset',
  elevation: 2,
  azimuth: 180,
  exposure: 0.1,
  distortionScale: 3.7,
  size: 1,
  bloomStrength: 0.1,
  bloomRadius: 0,
  bloomThreshold: 0,
  turbidity: 10,
  rayleigh: 2,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.8,
  mountainsVisible: true,
  lightsVisible: true,
  reflectionEmittersVisible: true,
  reflectionEmitterBrightness: 2.8,
  reflectionEmitterHeroBoost: 1.9,
  reflectionEmitterSize: 1.45,
  reflectionEmitterZOffset: 0.14,
  worldScale: MOUNTAIN_STACK_DEFAULTS.worldScale,
  groupX: MOUNTAIN_STACK_DEFAULTS.groupX,
  groupY: 0,
  groupZ: MOUNTAIN_STACK_DEFAULTS.groupZ
};

const stackState = {
  widthScale: MOUNTAIN_STACK_DEFAULTS.widthScale,
  heightScale: MOUNTAIN_STACK_DEFAULTS.heightScale,
  layerGap: MOUNTAIN_STACK_DEFAULTS.layerGap,
  alphaTest: MOUNTAIN_STACK_DEFAULTS.alphaTest
};

const lightState = {
  ...LIGHT_PRESET_BASES.sunset
};

const layerState = MOUNTAIN_LAYER_DEFAULTS.map((layer, index) => ({
  ...layer,
  tint: MOUNTAIN_TINT_PRESETS.sunset[index] || layer.tint
}));

function updateStatus() {
  statusEl.innerHTML = [
    `<strong>Scene</strong> ocean + mountain cards + village lights`,
    `<strong>Preset</strong> ${parameters.preset}`,
    `<strong>Mountains</strong> ${parameters.mountainsVisible ? 'on' : 'off'} / ${layerRefs.length} layers`,
    `<strong>Lights</strong> ${parameters.lightsVisible ? `${lightDescriptors.length} on mountain_02` : 'hidden'}`,
    `<strong>Reflection Emitters</strong> ${parameters.reflectionEmittersVisible ? 'on' : 'off'}`,
    `<strong>Camera</strong> ${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}`,
    `<strong>Target</strong> ${controls.target.x.toFixed(1)}, ${controls.target.y.toFixed(1)}, ${controls.target.z.toFixed(1)}`,
    `<strong>Sun</strong> elev ${parameters.elevation.toFixed(1)} / az ${parameters.azimuth.toFixed(1)}`,
    `<strong>Water</strong> distort ${parameters.distortionScale.toFixed(2)} / size ${parameters.size.toFixed(2)}`,
    `<strong>Bloom</strong> ${parameters.bloomStrength.toFixed(2)}`
  ].join('<br />');
}

function updateSun() {
  const phi = THREE.MathUtils.degToRad(90 - parameters.elevation);
  const theta = THREE.MathUtils.degToRad(parameters.azimuth);

  sun.setFromSphericalCoords(1, phi, theta);

  sky.material.uniforms.sunPosition.value.copy(sun);
  water.material.uniforms.sunDirection.value.copy(sun).normalize();

  if (renderTarget) renderTarget.dispose();

  sceneEnv.add(sky);
  renderTarget = pmremGenerator.fromScene(sceneEnv);
  scene.add(sky);
  scene.environment = renderTarget.texture;

  renderer.toneMappingExposure = parameters.exposure;
  updateStatus();
}

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
    alphaTest: stackState.alphaTest,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
    toneMapped: false
  });
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
  if (maskSampleState?.image === spawnMaskImage) return maskSampleState;

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

  maskSampleState = { image: spawnMaskImage, width, height, data, minX, minY, maxX, maxY };
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
  const starShare = THREE.MathUtils.clamp(lightState.starShare, 0, 0.9);
  const heroShare = THREE.MathUtils.clamp(lightState.heroShare, 0, 1 - starShare);
  return { starShare, heroShare };
}

function getKernelCanvasSize() {
  const requested = Math.round(96 * lightState.lightResolutionScale);
  return THREE.MathUtils.clamp(requested, 64, 512);
}

function getBaseLightColor(role) {
  if (role === 'cool') return new THREE.Color(lightState.coolLightColor);
  if (role === 'pale') return new THREE.Color(lightState.paleLightColor);
  return new THREE.Color(lightState.warmLightColor);
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
  const key = [
    type,
    size,
    lightState.glowStrength.toFixed(2),
    lightState.bloomStrength.toFixed(2),
    lightState.starCore.toFixed(3),
    lightState.starArm.toFixed(3),
    lightState.starLineWidth.toFixed(3),
    lightState.starGlow.toFixed(3),
    lightState.dotCore.toFixed(3),
    lightState.dotGlow.toFixed(3),
    lightState.heroCore.toFixed(3),
    lightState.heroArm.toFixed(3),
    lightState.heroLineWidth.toFixed(3),
    lightState.heroGlow.toFixed(3)
  ].join(':');
  if (lightKernelCache.has(key)) return lightKernelCache.get(key);

  const canvasEl = document.createElement('canvas');
  canvasEl.width = size;
  canvasEl.height = size;
  const ctx = canvasEl.getContext('2d');
  const mid = size * 0.5;
  const glowBoost = 0.72 + lightState.glowStrength * 0.68;
  const bloomBoost = 0.7 + lightState.bloomStrength * 0.9;
  const baseRadius = size * (
    type === 'hero6'
      ? lightState.heroCore
      : type === 'dot'
        ? lightState.dotCore
        : lightState.starCore
  );
  const glowRadius = size * (
    type === 'hero6'
      ? lightState.heroGlow
      : type === 'dot'
        ? lightState.dotGlow
        : lightState.starGlow
  ) * glowBoost;
  const armLength = size * (
    type === 'hero6'
      ? lightState.heroArm
      : type === 'dot'
        ? 0
        : lightState.starArm
  );

  const glow = ctx.createRadialGradient(mid, mid, 0, mid, mid, glowRadius);
  glow.addColorStop(0, `rgba(255,255,255,${Math.min(0.98, 0.64 + bloomBoost * 0.22)})`);
  glow.addColorStop(type === 'dot' ? 0.22 : 0.15, `rgba(255,255,255,${0.22 + bloomBoost * 0.18})`);
  glow.addColorStop(0.55, `rgba(255,255,255,${0.03 + lightState.glowStrength * 0.09})`);
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
    ctx.lineWidth = Math.max(2, size * lightState.heroLineWidth);
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
    ctx.lineWidth = Math.max(2, size * lightState.starLineWidth);
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

function getReflectionEmitterKernelTexture(type) {
  const size = 128;
  const key = `${type}:${size}`;
  if (reflectionEmitterKernelCache.has(key)) return reflectionEmitterKernelCache.get(key);

  const canvasEl = document.createElement('canvas');
  canvasEl.width = size;
  canvasEl.height = size;
  const ctx = canvasEl.getContext('2d');
  const mid = size * 0.5;
  const core = type === 'hero6' ? size * 0.085 : type === 'dot' ? size * 0.052 : size * 0.065;
  const arm = type === 'hero6' ? size * 0.21 : type === 'dot' ? 0 : size * 0.13;
  const glow = type === 'hero6' ? size * 0.36 : type === 'dot' ? size * 0.2 : size * 0.26;

  const grad = ctx.createRadialGradient(mid, mid, 0, mid, mid, glow);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(mid, mid, glow, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.lineCap = 'round';

  if (type === 'dot') {
    ctx.beginPath();
    ctx.arc(mid, mid, core, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'hero6') {
    ctx.lineWidth = size * 0.018;
    for (let i = 0; i < 3; i += 1) {
      const angle = (Math.PI / 3) * i;
      const dx = Math.cos(angle) * arm;
      const dy = Math.sin(angle) * arm;
      ctx.beginPath();
      ctx.moveTo(mid - dx, mid - dy);
      ctx.lineTo(mid + dx, mid + dy);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(mid, mid, core * 1.15, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.lineWidth = size * 0.024;
    ctx.beginPath();
    ctx.moveTo(mid - arm, mid);
    ctx.lineTo(mid + arm, mid);
    ctx.moveTo(mid, mid - arm);
    ctx.lineTo(mid, mid + arm);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mid, mid, core, 0, Math.PI * 2);
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
  reflectionEmitterKernelCache.set(key, texture);
  return texture;
}

function clearLightSprites() {
  while (lightSpritesGroup.children.length) {
    const child = lightSpritesGroup.children[lightSpritesGroup.children.length - 1];
    lightSpritesGroup.remove(child);
    child.material?.dispose();
  }
}

function clearReflectionEmitters() {
  while (reflectionEmitterGroup.children.length) {
    const child = reflectionEmitterGroup.children[reflectionEmitterGroup.children.length - 1];
    reflectionEmitterGroup.remove(child);
    child.material?.dispose();
  }
}

function rebuildLightSprites() {
  const sampleState = getMaskSampleState();
  if (!sampleState) return;
  clearLightSprites();
  clearReflectionEmitters();

  lightDescriptors.forEach((light, index) => {
    const material = new THREE.MeshBasicMaterial({
      map: getLightKernelTexture(light.type),
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

    const emitterTypeBoost = light.type === 'hero6' ? parameters.reflectionEmitterHeroBoost : 1;
    const emitterMaterial = new THREE.MeshBasicMaterial({
      map: getReflectionEmitterKernelTexture(light.type),
      color: getBaseLightColor(light.colorRole).multiplyScalar(parameters.reflectionEmitterBrightness * emitterTypeBoost),
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    const emitterMesh = new THREE.Mesh(sharedPlaneGeometry, emitterMaterial);
    emitterMesh.frustumCulled = false;
    emitterMesh.layers.set(REFLECTION_EMITTER_LAYER);
    emitterMesh.renderOrder = 15000 + index;
    emitterMesh.position.copy(mesh.position);
    emitterMesh.scale.set(
      baseWidth * parameters.reflectionEmitterSize * (light.type === 'dot' ? 0.9 : light.type === 'hero6' ? 1.25 : 1),
      baseHeight * parameters.reflectionEmitterSize * (light.type === 'dot' ? 0.9 : light.type === 'hero6' ? 1.25 : 1),
      1
    );
    emitterMesh.userData.baseScaleX = emitterMesh.scale.x;
    emitterMesh.userData.baseScaleY = emitterMesh.scale.y;
    emitterMesh.userData.light = light;
    reflectionEmitterGroup.add(emitterMesh);
  });
}

function rebuildVillageLights() {
  const sampleState = getMaskSampleState();
  if (!sampleState) return;

  const layoutKey = [
    lightState.lightSeed,
    lightState.lightCount,
    lightState.lightThreshold.toFixed(3),
    lightState.clusterCount,
    lightState.clusterSpread.toFixed(3),
    lightState.starShare.toFixed(3),
    lightState.heroShare.toFixed(3)
  ].join('|');
  if (layoutKey === lightLayoutKey && lightDescriptors.length) return;

  const rand = createSeededRandom(lightState.lightSeed);
  const threshold = THREE.MathUtils.clamp(lightState.lightThreshold, 0, 1);
  const targetCount = Math.max(12, Math.round(lightState.lightCount));
  const clusterCount = Math.max(2, Math.round(lightState.clusterCount));
  const { starShare, heroShare } = getLightMix();
  const minDimension = Math.min(sampleState.width, sampleState.height);

  const anchors = [];
  for (let i = 0; i < clusterCount; i += 1) {
    const point = pickAllowedMaskPoint(sampleState, rand, threshold);
    if (!point) continue;
    anchors.push({
      x: point.x,
      y: point.y,
      radius: (0.45 + rand() * 0.9) * lightState.clusterSpread * minDimension,
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

    const localDensity = smoothValueNoise2D(candidateX * 0.025, candidateY * 0.025, lightState.lightSeed + 19);
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
    const colorRole = colorRoll < 0.72 ? 'warm' : colorRoll < 0.93 ? 'pale' : 'cool';
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
      brightness: type === 'dot' ? 0.62 + rand() * 0.28 : type === 'hero6' ? 1 + rand() * 0.4 : 0.74 + rand() * 0.3,
      pulseSpeed: type === 'dot' ? 0.85 + rand() * 0.65 : type === 'hero6' ? 1.2 + rand() * 0.95 : 0.95 + rand() * 0.8,
      shimmerSpeed: 0.45 + rand() * 1.1,
      phase: rand() * Math.PI * 2,
      prominence
    });
  }

  lightDescriptors = descriptors;
  lightLayoutKey = layoutKey;
  rebuildLightSprites();
  updateStatus();
}

function updateLightSprites(nowSeconds) {
  lightSpritesGroup.children.forEach(child => {
    const light = child.userData.light;
    if (!light) return;
    const time = nowSeconds * lightState.twinkleFrequency;
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
    const twinkleMix = lightState.twinkleStrength * twinklePulse;
    const intensity = light.brightness * (
      0.28 +
      twinkleMix * (light.type === 'dot' ? 0.7 : light.type === 'hero6' ? 1.15 : 0.92) +
      lightState.fireStrength * (0.18 * firePulse)
    );
    const bloomScale = 0.92 + lightState.bloomStrength * 0.22;
    const scalePulse = (
      light.type === 'hero6'
        ? 0.82 + twinkleMix * 0.42 + lightState.fireStrength * firePulse * 0.12
        : light.type === 'dot'
          ? 0.88 + twinkleMix * 0.18 + lightState.fireStrength * firePulse * 0.05
          : 0.86 + twinkleMix * 0.28 + lightState.fireStrength * firePulse * 0.08
    ) * bloomScale;

    child.material.opacity = THREE.MathUtils.clamp(
      intensity * lightState.lightOpacity * (0.7 + lightState.bloomStrength * 0.45),
      0,
      1
    );
    const color = getDescriptorBaseColor(light);
    const hsl = {};
    color.getHSL(hsl);
    const warmthBias = light.colorRole === 'cool' ? 0.35 : light.colorRole === 'pale' ? 0.7 : 1;
    const fireMix = lightState.fireStrength * firePulse * warmthBias;
    const twinkleColorMix = twinkleMix * 0.06 * warmthBias;
    color.setHSL(
      THREE.MathUtils.clamp(hsl.h - lightState.fireColorShift * fireMix - twinkleColorMix * 0.25, 0, 1),
      THREE.MathUtils.clamp(hsl.s + fireMix * 0.12 + twinkleColorMix * 0.4 - (1 - firePulse) * lightState.fireStrength * 0.03, 0, 1),
      THREE.MathUtils.clamp(hsl.l + fireMix * 0.1 + twinkleColorMix * 0.9 - (1 - firePulse) * lightState.fireStrength * 0.06, 0, 1)
    );
    child.material.color.copy(color);
    child.scale.set(
      child.userData.baseScaleX * scalePulse,
      child.userData.baseScaleY * scalePulse,
      1
    );
  });

  reflectionEmitterGroup.children.forEach(child => {
    const light = child.userData.light;
    if (!light) return;
    const time = nowSeconds * lightState.twinkleFrequency;
    const wave = Math.sin(time * light.pulseSpeed + light.phase) * 0.5 + 0.5;
    const shimmer = Math.sin(time * light.shimmerSpeed + light.phase) * 0.5 + 0.5;
    const twinklePulse = light.type === 'hero6'
      ? 0.35 * shimmer + 0.65 * Math.pow(wave, 4)
      : light.type === 'dot'
        ? 0.65 * wave + 0.35 * shimmer
        : 0.52 * wave + 0.48 * shimmer;
    const intensity = 0.62 + twinklePulse * 0.32;
    const typeBoost = light.type === 'hero6' ? parameters.reflectionEmitterHeroBoost : 1;
    const color = getBaseLightColor(light.colorRole).multiplyScalar(parameters.reflectionEmitterBrightness * typeBoost * intensity);
    child.material.color.copy(color);
    child.material.opacity = parameters.reflectionEmittersVisible ? Math.min(1, 0.78 + twinklePulse * 0.18) : 0;
    const scalePulse = 0.96 + twinklePulse * 0.08;
    child.scale.set(
      child.userData.baseScaleX * scalePulse,
      child.userData.baseScaleY * scalePulse,
      1
    );
  });
}

function applyPreset(name) {
  const preset = LIGHT_PRESET_BASES[name];
  const tints = MOUNTAIN_TINT_PRESETS[name];
  if (!preset || !tints) return;
  parameters.preset = name;
  Object.assign(lightState, preset);
  layerState.forEach((layer, index) => {
    layer.tint = tints[index] || layer.tint;
  });
  lightLayoutKey = '';
  lightKernelCache.clear();
  rebuildVillageLights();
  updateMountains();
  updateStatus();
}

function updateMountains() {
  mountainGroup.visible = parameters.mountainsVisible;
  mountainGroup.position.set(parameters.groupX, parameters.groupY, parameters.groupZ);

  const centerIndex = (layerRefs.length - 1) * 0.5;
  layerRefs.forEach((layerRef, index) => {
    const layer = layerState[index];
    const width = parameters.worldScale * stackState.widthScale * layer.widthMultiplier;
    const height = parameters.worldScale * stackState.heightScale * layer.heightMultiplier;
    const z = layer.zOffset + (centerIndex - index) * stackState.layerGap;
    layerRef.mesh.scale.set(width, height, 1);
    layerRef.mesh.position.set(layer.xOffset || 0, height * 0.5 + layer.yOffset, z);
    layerRef.mesh.renderOrder = 20 + (layerRefs.length - 1 - index);
    layerRef.material.color.set(layer.tint);
    layerRef.material.opacity = layer.opacity;
    layerRef.material.alphaTest = stackState.alphaTest;
  });

  const targetIndex = layerState.findIndex(layer => layer.name === 'mountain_02');
  const targetRef = layerRefs[targetIndex];
  if (targetRef) {
    lightSpritesGroup.visible = parameters.mountainsVisible && parameters.lightsVisible;
    lightSpritesGroup.position.copy(targetRef.mesh.position);
    lightSpritesGroup.position.z += lightState.lightZOffset;
    lightSpritesGroup.scale.copy(targetRef.mesh.scale);
    lightSpritesGroup.renderOrder = targetRef.mesh.renderOrder + 1;

    reflectionEmitterGroup.visible = parameters.mountainsVisible && parameters.reflectionEmittersVisible;
    reflectionEmitterGroup.position.copy(targetRef.mesh.position);
    reflectionEmitterGroup.position.z += lightState.lightZOffset + parameters.reflectionEmitterZOffset;
    reflectionEmitterGroup.scale.copy(targetRef.mesh.scale);
    reflectionEmitterGroup.renderOrder = targetRef.mesh.renderOrder + 2;
  }
}

async function initMountainsAndLights() {
  const [mountainTextures, maskImage] = await Promise.all([
    Promise.all(MOUNTAIN_LAYER_DEFAULTS.map(layer => loadTexture(layer.path))),
    loadImage('/images/lights_mask.png')
  ]);

  spawnMaskImage = maskImage;

  mountainTextures.forEach((texture, index) => {
    const material = buildMountainMaterial(texture, layerState[index]);
    const mesh = new THREE.Mesh(sharedPlaneGeometry, material);
    mesh.frustumCulled = false;
    mountainGroup.add(mesh);
    layerRefs.push({ mesh, material, texture });
  });

  rebuildVillageLights();
  updateMountains();
}

function initOcean() {
  const waterGeometry = new THREE.PlaneGeometry(10000, 10000);
  const waterNormals = new THREE.TextureLoader().load(
    'https://threejs.org/examples/textures/waternormals.jpg',
    texture => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    }
  );

  water = new ReflectionWater(waterGeometry, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals,
    sunDirection: new THREE.Vector3(),
    sunColor: 0xffffff,
    waterColor: 0x061018,
    distortionScale: parameters.distortionScale,
    fog: false,
    reflectionLayersMask: (1 << MAIN_SCENE_LAYER) | (1 << REFLECTION_EMITTER_LAYER)
  });
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);

  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity.value = parameters.turbidity;
  skyUniforms.rayleigh.value = parameters.rayleigh;
  skyUniforms.mieCoefficient.value = parameters.mieCoefficient;
  skyUniforms.mieDirectionalG.value = parameters.mieDirectionalG;
}

function initGui() {
  const gui = new GUI({ title: 'Ocean Light Reflection Lab' });

  const sceneFolder = gui.addFolder('Scene');
  sceneFolder.add(parameters, 'preset', { Day: 'day', Sunset: 'sunset', Night: 'night' }).name('Preset').onChange(applyPreset);
  sceneFolder.add(parameters, 'mountainsVisible').name('Mountains').onChange(() => {
    updateMountains();
    updateStatus();
  });
  sceneFolder.add(parameters, 'lightsVisible').name('Lights').onChange(() => {
    updateMountains();
    updateStatus();
  });

  const reflectionEmittersFolder = gui.addFolder('Reflection Emitters');
  reflectionEmittersFolder.add(parameters, 'reflectionEmittersVisible').name('Visible').onChange(() => {
    updateMountains();
    updateStatus();
  });
  reflectionEmittersFolder.add(parameters, 'reflectionEmitterBrightness', 0.5, 8, 0.01).name('Brightness').onChange(() => {
    rebuildLightSprites();
    updateMountains();
    updateStatus();
  });
  reflectionEmittersFolder.add(parameters, 'reflectionEmitterHeroBoost', 1, 4, 0.01).name('Hero Boost').onChange(() => {
    rebuildLightSprites();
    updateMountains();
    updateStatus();
  });
  reflectionEmittersFolder.add(parameters, 'reflectionEmitterSize', 0.4, 3, 0.01).name('Size').onChange(() => {
    rebuildLightSprites();
    updateMountains();
    updateStatus();
  });
  reflectionEmittersFolder.add(parameters, 'reflectionEmitterZOffset', 0, 1, 0.001).name('Z Offset').onChange(updateMountains);

  const mountainFolder = gui.addFolder('Mountains');
  mountainFolder.add(parameters, 'worldScale', 8, 80, 0.1).name('World Scale').onChange(updateMountains);
  mountainFolder.add(parameters, 'groupX', -80, 80, 0.1).name('Group X').onChange(updateMountains);
  mountainFolder.add(parameters, 'groupY', -10, 30, 0.1).name('Group Y').onChange(updateMountains);
  mountainFolder.add(parameters, 'groupZ', -120, 40, 0.1).name('Group Z').onChange(updateMountains);

  const skyFolder = gui.addFolder('Sky');
  skyFolder.add(parameters, 'elevation', 0, 90, 0.1).onChange(updateSun);
  skyFolder.add(parameters, 'azimuth', -180, 180, 0.1).onChange(updateSun);
  skyFolder.add(parameters, 'exposure', 0, 1, 0.0001).onChange(value => {
    renderer.toneMappingExposure = value;
    updateStatus();
  });
  skyFolder.add(parameters, 'turbidity', 0, 20, 0.1).onChange(value => {
    sky.material.uniforms.turbidity.value = value;
    updateSun();
  });
  skyFolder.add(parameters, 'rayleigh', 0, 4, 0.01).onChange(value => {
    sky.material.uniforms.rayleigh.value = value;
    updateSun();
  });
  skyFolder.add(parameters, 'mieCoefficient', 0, 0.1, 0.001).onChange(value => {
    sky.material.uniforms.mieCoefficient.value = value;
    updateSun();
  });
  skyFolder.add(parameters, 'mieDirectionalG', 0, 1, 0.001).onChange(value => {
    sky.material.uniforms.mieDirectionalG.value = value;
    updateSun();
  });
  skyFolder.open();

  const waterUniforms = water.material.uniforms;
  const waterFolder = gui.addFolder('Water');
  waterFolder.add(parameters, 'distortionScale', 0, 8, 0.1).name('distortionScale').onChange(value => {
    waterUniforms.distortionScale.value = value;
    updateStatus();
  });
  waterFolder.add(parameters, 'size', 0.1, 10, 0.1).name('size').onChange(value => {
    waterUniforms.size.value = value;
    updateStatus();
  });
  waterFolder.open();

  const bloomFolder = gui.addFolder('Bloom');
  bloomFolder.add(parameters, 'bloomStrength', 0, 3, 0.01).name('strength').onChange(value => {
    bloomPass.strength = value;
    updateStatus();
  });
  bloomFolder.add(parameters, 'bloomRadius', 0, 1, 0.01).name('radius').onChange(value => {
    bloomPass.radius = value;
    updateStatus();
  });
  bloomFolder.add(parameters, 'bloomThreshold', 0, 1, 0.01).name('threshold').onChange(value => {
    bloomPass.threshold = value;
    updateStatus();
  });
  bloomFolder.open();
}

async function init() {
  initOcean();
  await initMountainsAndLights();
  updateSun();
  initGui();
  updateStatus();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  const time = performance.now() * 0.001;
  water.material.uniforms.time.value += 1 / 60;
  updateLightSprites(time);
  controls.update();
  composer.render();
  stats.update();
}

window.addEventListener('resize', onWindowResize);
controls.addEventListener('change', updateStatus);

try {
  await init();
  animate();
} catch (error) {
  console.error('Failed to start Ocean Light Reflection Lab:', error);
  statusEl.textContent = `Failed to load scene: ${error.message}`;
}
