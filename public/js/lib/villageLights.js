import { getVillageLightPresetForSky, getVillageLightPresetNameForSky } from './lightPresets.js';

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

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = path;
  });
}

function createCanvasTexture(THREE, renderer, canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 1;
  texture.needsUpdate = true;
  return texture;
}

export function createVillageLightsController({
  THREE,
  renderer,
  parentGroup,
  targetLayerName = 'mountain_02',
  maskUrl = './images/lights_mask.png',
  radioTowerUrl = './images/radiotower.png'
}) {
  const RADIO_TOWER_IMAGE_SIZE = { width: 1080, height: 1350 };
  const RADIO_TOWER_INSTANCES = [
    { visible: true, x: -7.95, y: 0.2, zOffset: 2.6, width: 0.04, height: 0.19, opacity: 1 },
    { visible: true, x: 19.27, y: 1.5, zOffset: -2.51, width: 0.03, height: 0.13, opacity: 1 },
    { visible: true, x: 23.46, y: 0.8, zOffset: -2.49, width: 0.03, height: 0.15, opacity: 1 }
  ];
  const RADIO_TOWER_BEACONS = [
    { x: 400, y: 975, row: 0 },
    { x: 680, y: 975, row: 0 },
    { x: 445, y: 695, row: 1 },
    { x: 635, y: 695, row: 1 },
    { x: 480, y: 480, row: 2 },
    { x: 600, y: 480, row: 2 }
  ];
  const sharedPlaneGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  const group = new THREE.Group();
  group.name = 'VillageLightsGroup';
  const reflectionGroup = new THREE.Group();
  reflectionGroup.name = 'VillageLightsReflections';
  const towerGroup = new THREE.Group();
  towerGroup.name = 'RadioTowerGroup';
  const baseSpritesGroup = new THREE.Group();
  baseSpritesGroup.name = 'VillageLightsBase';
  const overlaySpritesGroup = new THREE.Group();
  overlaySpritesGroup.name = 'VillageLightsOverlay';
  group.add(baseSpritesGroup);
  group.add(overlaySpritesGroup);
  parentGroup.add(group);
  parentGroup.add(reflectionGroup);
  parentGroup.add(towerGroup);

  const kernelCache = new Map();
  const reflectionTextureCache = new Map();
  let towerKernelTexture = null;
  const radioTowerRefs = [];
  let currentPresetName = 'day';
  let presetOverrides = null;
  let presetOverrideSignature = '';
  let maskImage = null;
  let radioTowerImage = null;
  let maskSampleState = null;
  const baseChannel = {
    key: 'base',
    group: baseSpritesGroup,
    reflectionMesh: null,
    presetName: null,
    preset: null,
    visualPreset: null,
    descriptors: [],
    layoutKey: '',
    shapeKey: '',
    reflectionKey: '',
    avgLightLocalY: -0.22,
    opacityMultiplier: 1
  };
  const overlayChannel = {
    key: 'overlay',
    group: overlaySpritesGroup,
    reflectionMesh: null,
    presetName: null,
    preset: null,
    visualPreset: null,
    descriptors: [],
    layoutKey: '',
    shapeKey: '',
    reflectionKey: '',
    avgLightLocalY: -0.22,
    opacityMultiplier: 0
  };
  let ready = false;
  let transitionActive = false;
  let visibleWorkActive = false;
  const updateScratchHsl = {};

  function lerpNumber(a, b, t) {
    return a + (b - a) * t;
  }

  function getResolvedPreset(name) {
    const presetName = getVillageLightPresetNameForSky(name);
    const basePreset = getVillageLightPresetForSky(presetName);
    const override = presetOverrides?.[presetName];
    return override ? { ...basePreset, ...override } : basePreset;
  }

  function getPresetColor(preset, key) {
    const value = preset?.[key];
    return value?.isColor ? value : new THREE.Color(value || '#ffffff');
  }

  function blendPresetVisuals(fromPreset, toPreset, progress) {
    return {
      ...fromPreset,
      texturePreset: fromPreset,
      isDynamicVisualPreset: true,
      lightOpacity: lerpNumber(fromPreset.lightOpacity, toPreset.lightOpacity, progress),
      glowStrength: lerpNumber(fromPreset.glowStrength, toPreset.glowStrength, progress),
      bloomStrength: lerpNumber(fromPreset.bloomStrength, toPreset.bloomStrength, progress),
      twinkleStrength: lerpNumber(fromPreset.twinkleStrength, toPreset.twinkleStrength, progress),
      twinkleFrequency: lerpNumber(fromPreset.twinkleFrequency, toPreset.twinkleFrequency, progress),
      fireStrength: lerpNumber(fromPreset.fireStrength, toPreset.fireStrength, progress),
      fireColorShift: lerpNumber(fromPreset.fireColorShift, toPreset.fireColorShift, progress),
      lightZOffset: lerpNumber(fromPreset.lightZOffset, toPreset.lightZOffset, progress),
      reflectionStretch: lerpNumber(fromPreset.reflectionStretch, toPreset.reflectionStretch, progress),
      reflectionWidth: lerpNumber(fromPreset.reflectionWidth, toPreset.reflectionWidth, progress),
      reflectionSoftness: lerpNumber(fromPreset.reflectionSoftness, toPreset.reflectionSoftness, progress),
      reflectionBreakup: lerpNumber(fromPreset.reflectionBreakup, toPreset.reflectionBreakup, progress),
      reflectionCoupling: lerpNumber(fromPreset.reflectionCoupling, toPreset.reflectionCoupling, progress),
      reflectionBrightness: lerpNumber(fromPreset.reflectionBrightness, toPreset.reflectionBrightness, progress),
      reflectionHeroBoost: lerpNumber(fromPreset.reflectionHeroBoost, toPreset.reflectionHeroBoost, progress),
      reflectionDrop: lerpNumber(fromPreset.reflectionDrop, toPreset.reflectionDrop, progress),
      starCore: lerpNumber(fromPreset.starCore, toPreset.starCore, progress),
      starArm: lerpNumber(fromPreset.starArm, toPreset.starArm, progress),
      starLineWidth: lerpNumber(fromPreset.starLineWidth, toPreset.starLineWidth, progress),
      starGlow: lerpNumber(fromPreset.starGlow, toPreset.starGlow, progress),
      dotCore: lerpNumber(fromPreset.dotCore, toPreset.dotCore, progress),
      dotGlow: lerpNumber(fromPreset.dotGlow, toPreset.dotGlow, progress),
      heroCore: lerpNumber(fromPreset.heroCore, toPreset.heroCore, progress),
      heroArm: lerpNumber(fromPreset.heroArm, toPreset.heroArm, progress),
      heroLineWidth: lerpNumber(fromPreset.heroLineWidth, toPreset.heroLineWidth, progress),
      heroGlow: lerpNumber(fromPreset.heroGlow, toPreset.heroGlow, progress),
      lightResolutionScale: lerpNumber(fromPreset.lightResolutionScale, toPreset.lightResolutionScale, progress),
      warmLightColor: getPresetColor(fromPreset, 'warmLightColor').lerp(getPresetColor(toPreset, 'warmLightColor'), progress),
      paleLightColor: getPresetColor(fromPreset, 'paleLightColor').lerp(getPresetColor(toPreset, 'paleLightColor'), progress),
      coolLightColor: getPresetColor(fromPreset, 'coolLightColor').lerp(getPresetColor(toPreset, 'coolLightColor'), progress)
    };
  }

  function createSunsetNightBasePreset(fromPreset, toPreset, progress) {
    return {
      ...fromPreset,
      texturePreset: fromPreset,
      isDynamicVisualPreset: true,
      glowStrength: lerpNumber(fromPreset.glowStrength, toPreset.glowStrength, progress),
      bloomStrength: lerpNumber(fromPreset.bloomStrength, toPreset.bloomStrength, progress),
      reflectionStretch: lerpNumber(fromPreset.reflectionStretch, toPreset.reflectionStretch, progress),
      reflectionWidth: lerpNumber(fromPreset.reflectionWidth, toPreset.reflectionWidth, progress),
      reflectionSoftness: lerpNumber(fromPreset.reflectionSoftness, toPreset.reflectionSoftness, progress),
      reflectionBreakup: lerpNumber(fromPreset.reflectionBreakup, toPreset.reflectionBreakup, progress),
      reflectionCoupling: lerpNumber(fromPreset.reflectionCoupling, toPreset.reflectionCoupling, progress),
      reflectionBrightness: lerpNumber(fromPreset.reflectionBrightness, toPreset.reflectionBrightness, progress),
      reflectionHeroBoost: lerpNumber(fromPreset.reflectionHeroBoost, toPreset.reflectionHeroBoost, progress),
      reflectionDrop: lerpNumber(fromPreset.reflectionDrop, toPreset.reflectionDrop, progress),
      starCore: lerpNumber(fromPreset.starCore, toPreset.starCore, progress),
      starArm: lerpNumber(fromPreset.starArm, toPreset.starArm, progress),
      starLineWidth: lerpNumber(fromPreset.starLineWidth, toPreset.starLineWidth, progress),
      starGlow: lerpNumber(fromPreset.starGlow, toPreset.starGlow, progress),
      dotCore: lerpNumber(fromPreset.dotCore, toPreset.dotCore, progress),
      dotGlow: lerpNumber(fromPreset.dotGlow, toPreset.dotGlow, progress),
      heroCore: lerpNumber(fromPreset.heroCore, toPreset.heroCore, progress),
      heroArm: lerpNumber(fromPreset.heroArm, toPreset.heroArm, progress),
      heroLineWidth: lerpNumber(fromPreset.heroLineWidth, toPreset.heroLineWidth, progress),
      heroGlow: lerpNumber(fromPreset.heroGlow, toPreset.heroGlow, progress),
      lightResolutionScale: lerpNumber(fromPreset.lightResolutionScale, toPreset.lightResolutionScale, progress),
      warmLightColor: getPresetColor(fromPreset, 'warmLightColor').lerp(getPresetColor(toPreset, 'warmLightColor'), progress),
      paleLightColor: getPresetColor(fromPreset, 'paleLightColor').lerp(getPresetColor(toPreset, 'paleLightColor'), progress),
      coolLightColor: getPresetColor(fromPreset, 'coolLightColor').lerp(getPresetColor(toPreset, 'coolLightColor'), progress)
    };
  }

  function createSunsetNightOverlayPreset(fromPreset, toPreset) {
    return {
      ...toPreset,
      lightCount: 26,
      twinkleFrequency: fromPreset.twinkleFrequency,
      twinkleStrength: fromPreset.twinkleStrength,
      fireStrength: fromPreset.fireStrength,
      fireColorShift: fromPreset.fireColorShift,
      reflectionStretch: fromPreset.reflectionStretch,
      reflectionWidth: fromPreset.reflectionWidth,
      reflectionSoftness: fromPreset.reflectionSoftness,
      reflectionBreakup: fromPreset.reflectionBreakup,
      reflectionCoupling: lerpNumber(fromPreset.reflectionCoupling, toPreset.reflectionCoupling, 1),
      reflectionBrightness: lerpNumber(fromPreset.reflectionBrightness, toPreset.reflectionBrightness, 1),
      reflectionHeroBoost: lerpNumber(fromPreset.reflectionHeroBoost, toPreset.reflectionHeroBoost, 1),
      reflectionDrop: lerpNumber(fromPreset.reflectionDrop, toPreset.reflectionDrop, 1)
    };
  }

  function getLayoutSignature(preset) {
    if (!preset) return '';
    return [
      preset.lightSeed,
      preset.lightCount,
      preset.lightThreshold,
      preset.clusterCount,
      preset.clusterSpread,
      preset.starShare,
      preset.heroShare
    ].join('|');
  }

  function applyChannelLayoutPreset(channel, preset) {
    channel.preset = preset;
    channel.layoutKey = '';
    channel.shapeKey = '';
    rebuildLayout(channel);
  }

  function applySteadyStackedNightMode() {
    if (baseChannel.presetName !== 'sunset') {
      setChannelPreset(baseChannel, 'sunset');
    }
    if (overlayChannel.presetName !== 'night') {
      setChannelPreset(overlayChannel, 'night');
    }
    baseChannel.visualPreset = createSunsetNightBasePreset(baseChannel.preset, overlayChannel.preset, 1);
    const overlayPreset = createSunsetNightOverlayPreset(baseChannel.preset, overlayChannel.preset);
    if (getLayoutSignature(overlayChannel.preset) !== getLayoutSignature(overlayPreset)) {
      applyChannelLayoutPreset(overlayChannel, overlayPreset);
    }
    overlayChannel.visualPreset = overlayPreset;
    baseChannel.opacityMultiplier = 1;
    overlayChannel.opacityMultiplier = 1;
  }

  function getMaskSampleState() {
    if (!maskImage) return null;
    if (maskSampleState?.image === maskImage) return maskSampleState;

    const width = maskImage.naturalWidth || maskImage.width || 1;
    const height = maskImage.naturalHeight || maskImage.height || 1;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(maskImage, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;

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

    maskSampleState = { image: maskImage, width, height, data, minX, minY, maxX, maxY };
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
      if (sampleMaskValue(sampleState, x, y) >= threshold) return { x, y };
    }
    return null;
  }

  function getBaseLightColor(role, preset) {
    if (role === 'cool') return getPresetColor(preset, 'coolLightColor');
    if (role === 'pale') return getPresetColor(preset, 'paleLightColor');
    return getPresetColor(preset, 'warmLightColor');
  }

  function getDescriptorBaseColor(light, preset) {
    const color = getBaseLightColor(light.colorRole, preset);
    const hsl = {};
    color.getHSL(hsl);
    color.setHSL(
      THREE.MathUtils.clamp(hsl.h + light.colorOffsetH, 0, 1),
      THREE.MathUtils.clamp(hsl.s + light.colorOffsetS, 0, 1),
      THREE.MathUtils.clamp(hsl.l + light.colorOffsetL, 0, 1)
    );
    return color;
  }

  function getKernelCanvasSize(preset) {
    const requested = Math.round(96 * preset.lightResolutionScale);
    return THREE.MathUtils.clamp(requested, 64, 512);
  }

  function getTowerKernelTexture() {
    if (towerKernelTexture) return towerKernelTexture;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const mid = size * 0.5;
    const glow = ctx.createRadialGradient(mid, mid, 0, mid, mid, size * 0.44);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.12, 'rgba(255,210,210,0.98)');
    glow.addColorStop(0.35, 'rgba(255,96,96,0.44)');
    glow.addColorStop(1, 'rgba(255,64,64,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(mid, mid, size * 0.44, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,246,246,1)';
    ctx.beginPath();
    ctx.arc(mid, mid, size * 0.09, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = 1;
    texture.needsUpdate = true;
    towerKernelTexture = texture;
    return texture;
  }

  function buildRadioTowerTexture() {
    if (!radioTowerImage) return null;
    const canvas = document.createElement('canvas');
    canvas.width = radioTowerImage.naturalWidth || radioTowerImage.width || RADIO_TOWER_IMAGE_SIZE.width;
    canvas.height = radioTowerImage.naturalHeight || radioTowerImage.height || RADIO_TOWER_IMAGE_SIZE.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(radioTowerImage, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(120, 12, 12, 0.82)';
    RADIO_TOWER_BEACONS.forEach(({ x, y }) => {
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
    });
    return createCanvasTexture(THREE, renderer, canvas);
  }

  function ensureRadioTowerMeshes() {
    if (radioTowerRefs.length || !radioTowerImage) return;
    const radioTowerTexture = buildRadioTowerTexture();
    if (!radioTowerTexture) return;
    const beaconMap = getTowerKernelTexture();

    RADIO_TOWER_INSTANCES.forEach((instance, towerIndex) => {
      const material = new THREE.MeshBasicMaterial({
        map: radioTowerTexture,
        color: new THREE.Color(0xffffff),
        transparent: true,
        opacity: instance.opacity,
        alphaTest: 0.01,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true,
        toneMapped: false
      });
      const mesh = new THREE.Mesh(sharedPlaneGeometry, material);
      mesh.frustumCulled = false;
      towerGroup.add(mesh);

      const beaconMeshes = [];
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
        beaconMesh.renderOrder = 22000 + towerIndex * 10 + beaconIndex;
        mesh.add(beaconMesh);
        beaconMeshes.push(beaconMesh);
      });

      radioTowerRefs.push({ mesh, material, texture: radioTowerTexture, beaconMeshes, instance });
    });
  }

  function getReflectionTextureSize() {
    return 1024;
  }

  function getShapeSignature(preset) {
    const sourcePreset = preset?.texturePreset || preset;
    const shapeKey = [
      sourcePreset.lightResolutionScale.toFixed(3),
      sourcePreset.glowStrength.toFixed(2),
      sourcePreset.bloomStrength.toFixed(2),
      sourcePreset.starCore.toFixed(3),
      sourcePreset.starArm.toFixed(3),
      sourcePreset.starLineWidth.toFixed(3),
      sourcePreset.starGlow.toFixed(3),
      sourcePreset.dotCore.toFixed(3),
      sourcePreset.dotGlow.toFixed(3),
      sourcePreset.heroCore.toFixed(3),
      sourcePreset.heroArm.toFixed(3),
      sourcePreset.heroLineWidth.toFixed(3),
      sourcePreset.heroGlow.toFixed(3)
    ].join(':');
    return shapeKey;
  }

  function getReflectionSignature(preset) {
    const sourcePreset = preset?.texturePreset || preset;
    return [
      sourcePreset.reflectionStretch.toFixed(3),
      sourcePreset.reflectionWidth.toFixed(3),
      sourcePreset.reflectionSoftness.toFixed(3),
      sourcePreset.reflectionBreakup.toFixed(3),
      sourcePreset.reflectionCoupling.toFixed(3),
      sourcePreset.reflectionBrightness.toFixed(3),
      sourcePreset.reflectionHeroBoost.toFixed(3),
      sourcePreset.reflectionDrop.toFixed(3),
      getPresetColor(sourcePreset, 'warmLightColor').getHexString(),
      getPresetColor(sourcePreset, 'paleLightColor').getHexString(),
      getPresetColor(sourcePreset, 'coolLightColor').getHexString()
    ].join(':');
  }

  function getLightKernelTexture(type, preset) {
    const sourcePreset = preset?.texturePreset || preset;
    const size = getKernelCanvasSize(sourcePreset);
    const key = `${type}:${size}:${getShapeSignature(sourcePreset)}`;
    if (kernelCache.has(key)) return kernelCache.get(key);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const mid = size * 0.5;
    const glowBoost = 0.72 + sourcePreset.glowStrength * 0.68;
    const bloomBoost = 0.7 + sourcePreset.bloomStrength * 0.9;
    const baseRadius = size * (
      type === 'hero6' ? sourcePreset.heroCore : type === 'dot' ? sourcePreset.dotCore : sourcePreset.starCore
    );
    const glowRadius = size * (
      type === 'hero6' ? sourcePreset.heroGlow : type === 'dot' ? sourcePreset.dotGlow : sourcePreset.starGlow
    ) * glowBoost;
    const armLength = size * (
      type === 'hero6' ? sourcePreset.heroArm : type === 'dot' ? 0 : sourcePreset.starArm
    );

    const glow = ctx.createRadialGradient(mid, mid, 0, mid, mid, glowRadius);
    glow.addColorStop(0, `rgba(255,255,255,${Math.min(0.98, 0.64 + bloomBoost * 0.22)})`);
    glow.addColorStop(type === 'dot' ? 0.22 : 0.15, `rgba(255,255,255,${0.22 + bloomBoost * 0.18})`);
    glow.addColorStop(0.55, `rgba(255,255,255,${0.03 + sourcePreset.glowStrength * 0.09})`);
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
      ctx.lineWidth = Math.max(2, size * sourcePreset.heroLineWidth);
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
      ctx.lineWidth = Math.max(2, size * sourcePreset.starLineWidth);
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

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = 1;
    texture.needsUpdate = true;
    kernelCache.set(key, texture);
    return texture;
  }

  function createReflectionMesh(renderOrderBase) {
    const mesh = new THREE.Mesh(
      sharedPlaneGeometry,
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 1,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
        alphaTest: 0.01
      })
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrderBase;
    reflectionGroup.add(mesh);
    return mesh;
  }

  baseChannel.reflectionMesh = createReflectionMesh(9000);
  overlayChannel.reflectionMesh = createReflectionMesh(19000);

  function getStaticReflectionColor(light, preset) {
    const color = getDescriptorBaseColor(light, preset);
    const hsl = {};
    color.getHSL(hsl);
    return new THREE.Color().setHSL(
      hsl.h,
      Math.min(1, hsl.s * 0.82),
      Math.min(1, hsl.l + 0.1)
    );
  }

  function rebuildReflectionTexture(channel, visualPreset = channel.visualPreset || channel.preset) {
    if (!channel?.reflectionMesh || !visualPreset) return;
    const sourcePreset = visualPreset.texturePreset || visualPreset;

    const reflectionKeyNext = `${channel.layoutKey}|${getReflectionSignature(sourcePreset)}`;
    if (channel.reflectionKey === reflectionKeyNext && channel.reflectionMesh.material.map) return;
    channel.reflectionKey = reflectionKeyNext;

    const cacheKey = `${channel.key}|${reflectionKeyNext}`;
    const cachedTexture = reflectionTextureCache.get(cacheKey);
    if (cachedTexture) {
      channel.reflectionMesh.material.map = cachedTexture;
      channel.reflectionMesh.material.needsUpdate = true;
      return;
    }

    const width = getReflectionTextureSize();
    const height = getReflectionTextureSize();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    channel.descriptors.forEach(light => {
      const x = light.x * width;
      const seed = Math.floor(light.sampleX * 9283 + light.sampleY * 6151 + light.phase * 997);
      const detailRand = createSeededRandom(seed || 1);
      const typeBoost = light.type === 'hero6' ? sourcePreset.reflectionHeroBoost : light.type === 'dot' ? 0.8 : 1;
      const startY = height * (THREE.MathUtils.lerp(0.012, 0.045, sourcePreset.reflectionCoupling) + (detailRand() - 0.5) * 0.004);
      const length = (light.type === 'hero6' ? 360 : light.type === 'dot' ? 170 : 265) * sourcePreset.reflectionStretch * typeBoost * (0.7 + light.prominence * 0.78);
      const streakWidth = (light.type === 'hero6' ? 19 : light.type === 'dot' ? 8 : 13) * sourcePreset.reflectionWidth * THREE.MathUtils.lerp(0.94, 1.08, detailRand());
      const brightness = light.brightness * sourcePreset.reflectionBrightness * (light.type === 'hero6' ? 0.6 * sourcePreset.reflectionHeroBoost : light.type === 'dot' ? 0.3 : 0.44);
      const gap = sourcePreset.reflectionBreakup;
      const segments = light.type === 'hero6' ? 4 + Math.round(detailRand()) : light.type === 'dot' ? 2 : 2 + Math.round(detailRand() * 2);
      const color = getStaticReflectionColor(light, sourcePreset);
      const rgba = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, `;

      for (let i = 0; i < segments; i += 1) {
        const segT = i / Math.max(1, segments - 1);
        const taper = THREE.MathUtils.lerp(0.24, 0.34, detailRand());
        const y0 = startY + segT * length * THREE.MathUtils.lerp(0.22, 0.35, detailRand()) + (i % 2 === 0 ? 0 : 8 * gap);
        const y1 = y0 + length * (taper - segT * 0.045);
        const segWidth = streakWidth * (1 + segT * 0.42) * THREE.MathUtils.lerp(0.92, 1.08, detailRand());
        const jitterX = (detailRand() - 0.5) * 14 * gap;
        const blur = light.type === 'dot'
          ? Math.max(5, 10 * sourcePreset.reflectionSoftness)
          : light.type === 'hero6'
            ? Math.max(12, 22 * sourcePreset.reflectionSoftness)
            : Math.max(8, 16 * sourcePreset.reflectionSoftness);

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
      ctx.filter = `blur(${light.type === 'hero6' ? Math.max(18, 30 * sourcePreset.reflectionSoftness) : Math.max(10, 18 * sourcePreset.reflectionSoftness)}px)`;
      ctx.fillStyle = `${rgba}${Math.min(light.type === 'hero6' ? 0.4 : 0.24, brightness * 0.2)})`;
      ctx.beginPath();
      ctx.ellipse(x + (detailRand() - 0.5) * 6, startY + length * 0.38, streakWidth * (light.type === 'hero6' ? 3.1 : 2.3), length * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.filter = `blur(${Math.max(8, 16 * sourcePreset.reflectionSoftness)}px)`;
      ctx.fillStyle = `${rgba}${Math.min(0.54, brightness * 0.42)})`;
      ctx.beginPath();
      ctx.ellipse(x, startY + 8, streakWidth * 1.2, 10 + streakWidth * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = 1;
    texture.needsUpdate = true;

    reflectionTextureCache.set(cacheKey, texture);
    channel.reflectionMesh.material.map = texture;
    channel.reflectionMesh.material.needsUpdate = true;
  }

  function clearSprites(spriteGroup) {
    while (spriteGroup.children.length) {
      const child = spriteGroup.children[spriteGroup.children.length - 1];
      spriteGroup.remove(child);
      child.material?.dispose?.();
    }
  }

  function rebuildLightSprites(channel, visualPreset = channel.visualPreset || channel.preset) {
    const sampleState = getMaskSampleState();
    if (!sampleState || !channel.preset || !visualPreset) return;
    clearSprites(channel.group);

    channel.shapeKey = getShapeSignature(visualPreset);
    channel.descriptors.forEach((light, index) => {
      const map = getLightKernelTexture(light.type, visualPreset);
      const material = new THREE.MeshBasicMaterial({
        map,
        color: getBaseLightColor(light.colorRole, visualPreset),
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
      mesh.renderOrder = (channel.key === 'overlay' ? 20000 : 10000) + index;
      const baseWidth = light.pixelSize / sampleState.width;
      const baseHeight = light.pixelSize / sampleState.height;
      mesh.position.set(light.x - 0.5, 0.5 - light.y, 0);
      mesh.scale.set(baseWidth, baseHeight, 1);
      mesh.userData.baseScaleX = baseWidth;
      mesh.userData.baseScaleY = baseHeight;
      mesh.userData.light = light;
      channel.group.add(mesh);
    });
    rebuildReflectionTexture(channel, visualPreset);
  }

  function rebuildLayout(channel) {
    const sampleState = getMaskSampleState();
    if (!sampleState || !channel.preset || !channel.presetName) return;
    const layoutKeyNext = [
      channel.preset.lightSeed,
      channel.preset.lightCount,
      channel.preset.lightThreshold.toFixed(3),
      channel.preset.clusterCount,
      channel.preset.clusterSpread.toFixed(3),
      channel.preset.starShare.toFixed(3),
      channel.preset.heroShare.toFixed(3)
    ].join('|');
    if (layoutKeyNext === channel.layoutKey && channel.descriptors.length) return;
    channel.layoutKey = layoutKeyNext;

    const rand = createSeededRandom(channel.preset.lightSeed);
    const threshold = THREE.MathUtils.clamp(channel.preset.lightThreshold, 0, 1);
    const targetCount = Math.max(0, Math.round(channel.preset.lightCount));
    const clusterCount = Math.max(2, Math.round(channel.preset.clusterCount));
    const starShare = THREE.MathUtils.clamp(channel.preset.starShare, 0, 0.9);
    const heroShare = THREE.MathUtils.clamp(channel.preset.heroShare, 0, 1 - starShare);
    const minDimension = Math.min(sampleState.width, sampleState.height);

    const anchors = [];
    for (let i = 0; i < clusterCount; i += 1) {
      const point = pickAllowedMaskPoint(sampleState, rand, threshold);
      if (!point) continue;
      anchors.push({
        x: point.x,
        y: point.y,
        radius: (0.45 + rand() * 0.9) * channel.preset.clusterSpread * minDimension
      });
    }

    const next = [];
    const attempts = targetCount * 220;
    for (let attempt = 0; attempt < attempts && next.length < targetCount; attempt += 1) {
      const anchor = anchors.length ? anchors[Math.floor(rand() * anchors.length)] : pickAllowedMaskPoint(sampleState, rand, threshold);
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

      const localDensity = smoothValueNoise2D(candidateX * 0.025, candidateY * 0.025, channel.preset.lightSeed + 19);
      const spacing = 5 + (1 - sample) * 9 + localDensity * 6;
      const tooClose = next.some(light => {
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

      next.push({
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

    channel.descriptors = next;
    channel.avgLightLocalY = next.length
      ? next.reduce((sum, light) => sum + (0.5 - light.y), 0) / next.length
      : -0.22;
    rebuildLightSprites(channel);
  }

  function setChannelPreset(channel, presetName) {
    const resolvedPreset = getResolvedPreset(presetName);
    const previousLayoutSignature = getLayoutSignature(channel.preset);
    const nextLayoutSignature = getLayoutSignature(resolvedPreset);
    channel.presetName = presetName;
    channel.preset = resolvedPreset;
    channel.visualPreset = resolvedPreset;
    if (channel.descriptors.length && previousLayoutSignature === nextLayoutSignature) {
      return;
    }
    channel.layoutKey = '';
    channel.shapeKey = '';
    rebuildLayout(channel);
  }

  function applyShapePreset(channel, visualPreset) {
    const nextShapeKey = getShapeSignature(visualPreset);
    const nextReflectionKey = `${channel.layoutKey}|${getReflectionSignature(visualPreset)}`;
    const shapeMatches = channel.shapeKey === nextShapeKey && channel.group.children.length === channel.descriptors.length;
    const reflectionMatches = channel.reflectionKey === nextReflectionKey && channel.reflectionMesh?.material?.map;
    if (shapeMatches && reflectionMatches) return;
    channel.visualPreset = visualPreset;
    rebuildLightSprites(channel, visualPreset);
  }

  function updateChannel(channel, preset, nowSeconds) {
    if (!preset) return;
    applyShapePreset(channel, preset);
    const channelVisible = channel.opacityMultiplier > 0.001 && preset.lightOpacity > 0.001;
    channel.group.visible = channelVisible;
    if (!channelVisible) {
      if (channel.reflectionMesh) channel.reflectionMesh.visible = false;
      return;
    }
    channel.group.children.forEach(child => {
      const light = child.userData.light;
      if (!light) return;

      const time = nowSeconds * preset.twinkleFrequency;
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
      const firePulse = THREE.MathUtils.clamp(0.42 * wave + 0.28 * shimmer + 0.2 * ember + 0.1 * flutter, 0, 1);
      const twinkleMix = preset.twinkleStrength * twinklePulse;
      const intensity = light.brightness * (
        0.28 +
        twinkleMix * (light.type === 'dot' ? 0.7 : light.type === 'hero6' ? 1.15 : 0.92) +
        preset.fireStrength * (0.18 * firePulse)
      );
      const bloomScale = 0.92 + preset.bloomStrength * 0.22;
      const scalePulse = (
        light.type === 'hero6'
          ? 0.82 + twinkleMix * 0.42 + preset.fireStrength * firePulse * 0.12
          : light.type === 'dot'
            ? 0.88 + twinkleMix * 0.18 + preset.fireStrength * firePulse * 0.05
            : 0.86 + twinkleMix * 0.28 + preset.fireStrength * firePulse * 0.08
      ) * bloomScale;

      child.material.opacity = THREE.MathUtils.clamp(
        intensity * preset.lightOpacity * (0.7 + preset.bloomStrength * 0.45) * channel.opacityMultiplier,
        0,
        1
      );

      const color = getBaseLightColor(light.colorRole, preset);
      const hsl = updateScratchHsl;
      color.getHSL(hsl);
      color.setHSL(
        THREE.MathUtils.clamp(hsl.h + light.colorOffsetH, 0, 1),
        THREE.MathUtils.clamp(hsl.s + light.colorOffsetS, 0, 1),
        THREE.MathUtils.clamp(hsl.l + light.colorOffsetL, 0, 1)
      );
      const warmthBias = light.colorRole === 'cool' ? 0.35 : light.colorRole === 'pale' ? 0.7 : 1;
      const fireMix = preset.fireStrength * firePulse * warmthBias;
      const twinkleColorMix = twinkleMix * 0.06 * warmthBias;
      color.setHSL(
        THREE.MathUtils.clamp(hsl.h - preset.fireColorShift * fireMix - twinkleColorMix * 0.25, 0, 1),
        THREE.MathUtils.clamp(hsl.s + fireMix * 0.12 + twinkleColorMix * 0.4 - (1 - firePulse) * preset.fireStrength * 0.03, 0, 1),
        THREE.MathUtils.clamp(hsl.l + fireMix * 0.1 + twinkleColorMix * 0.9 - (1 - firePulse) * preset.fireStrength * 0.06, 0, 1)
      );
      child.material.color.copy(color);
      child.scale.set(child.userData.baseScaleX * scalePulse, child.userData.baseScaleY * scalePulse, 1);
    });

    const reflectionMesh = channel.reflectionMesh;
    if (reflectionMesh?.material) {
      const wave = Math.sin(nowSeconds * preset.twinkleFrequency * 0.55) * 0.5 + 0.5;
      const shimmer = Math.sin(nowSeconds * preset.twinkleFrequency * 0.92 + 0.7) * 0.5 + 0.5;
      reflectionMesh.visible = channel.opacityMultiplier > 0.001 && preset.reflectionBrightness > 0.001;
      reflectionMesh.material.opacity = THREE.MathUtils.clamp(
        preset.lightOpacity * (0.6 + wave * 0.12 + shimmer * 0.08) * channel.opacityMultiplier,
        0,
        1
      );
    }
  }

  function updateTowerLights(nowSeconds) {
    const beaconVisibility = currentPresetName === 'night' ? 1 : currentPresetName === 'sunset' ? 0.8 : 0;
    towerGroup.visible = radioTowerRefs.some(ref => ref.mesh.visible);
    if (!towerGroup.visible) return;

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
        const intensity = beaconVisibility * (0.08 + pulse * 2.4);
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

  function update(nowSeconds) {
    if (!ready) return;
    updateChannel(baseChannel, baseChannel.visualPreset || baseChannel.preset, nowSeconds);
    updateChannel(overlayChannel, overlayChannel.visualPreset || overlayChannel.preset, nowSeconds);
    updateTowerLights(nowSeconds);
  }

  async function init() {
    if (ready) return;
    const [nextMaskImage, nextRadioTowerImage] = await Promise.all([
      loadImage(maskUrl),
      loadImage(radioTowerUrl)
    ]);
    maskImage = nextMaskImage;
    radioTowerImage = nextRadioTowerImage;
    ensureRadioTowerMeshes();
    ready = true;
  }

  function sync({
    presetName,
    presetTransition = null,
    presetOverrides: nextPresetOverrides = null,
    targetMesh,
    targetRenderOrder,
    towerMesh = null,
    towerBackMesh = null,
    towerRenderOrder = 0,
    mountainPlacement = null
  }) {
    if (!ready || !targetMesh) {
      group.visible = false;
      reflectionGroup.visible = false;
      towerGroup.visible = false;
      return;
    }

    const targetPresetName = getVillageLightPresetNameForSky(presetName);
    presetOverrides = nextPresetOverrides;
    const nextPresetOverrideSignature = JSON.stringify(presetOverrides || {});
    if (nextPresetOverrideSignature !== presetOverrideSignature) {
      presetOverrideSignature = nextPresetOverrideSignature;
      if (baseChannel.presetName) setChannelPreset(baseChannel, baseChannel.presetName);
      if (overlayChannel.presetName) setChannelPreset(overlayChannel, overlayChannel.presetName);
    }
    currentPresetName = targetPresetName;
    const transitionFromName = presetTransition?.fromName ? getVillageLightPresetNameForSky(presetTransition.fromName) : null;
    const transitionToName = presetTransition?.toName ? getVillageLightPresetNameForSky(presetTransition.toName) : null;
    const transitionProgress = THREE.MathUtils.clamp(presetTransition?.progress ?? 0, 0, 1);
    const isSpecialSunsetToNight = transitionFromName === 'sunset' && transitionToName === 'night';
    transitionActive = Boolean(transitionFromName && transitionToName && transitionFromName !== transitionToName && transitionProgress < 0.999);

    if (!baseChannel.presetName) {
      setChannelPreset(baseChannel, targetPresetName);
    }

    if (isSpecialSunsetToNight && transitionProgress < 0.999) {
      if (baseChannel.presetName !== 'sunset') {
        setChannelPreset(baseChannel, 'sunset');
      }
      if (overlayChannel.presetName !== 'night') {
        setChannelPreset(overlayChannel, 'night');
      }
      baseChannel.visualPreset = createSunsetNightBasePreset(baseChannel.preset, overlayChannel.preset, transitionProgress);
      const overlayPreset = createSunsetNightOverlayPreset(baseChannel.preset, overlayChannel.preset);
      if (getLayoutSignature(overlayChannel.preset) !== getLayoutSignature(overlayPreset)) {
        applyChannelLayoutPreset(overlayChannel, overlayPreset);
      }
      overlayChannel.visualPreset = overlayPreset;
      baseChannel.opacityMultiplier = 1;
      overlayChannel.opacityMultiplier = transitionProgress * transitionProgress;
    } else if (targetPresetName === 'night') {
      applySteadyStackedNightMode();
    } else if (transitionFromName && transitionToName && transitionFromName !== transitionToName && transitionProgress < 0.999) {
      if (baseChannel.presetName !== transitionFromName) {
        setChannelPreset(baseChannel, transitionFromName);
      }
      baseChannel.visualPreset = blendPresetVisuals(
        getResolvedPreset(transitionFromName),
        getResolvedPreset(transitionToName),
        transitionProgress
      );
      baseChannel.opacityMultiplier = 1;
      overlayChannel.opacityMultiplier = 0;
      overlayChannel.group.visible = false;
    } else {
      if (baseChannel.presetName !== targetPresetName) {
        setChannelPreset(baseChannel, targetPresetName);
      }
      baseChannel.visualPreset = getResolvedPreset(targetPresetName);
      baseChannel.opacityMultiplier = 1;
      overlayChannel.opacityMultiplier = 0;
      overlayChannel.group.visible = false;
    }

    group.visible = true;
    reflectionGroup.visible = true;
    group.position.copy(targetMesh.position);
    group.scale.copy(targetMesh.scale);
    group.renderOrder = targetRenderOrder + 1;
    baseChannel.group.position.set(0, 0, (baseChannel.visualPreset || baseChannel.preset)?.lightZOffset ?? 0);
    overlayChannel.group.position.set(0, 0, (overlayChannel.visualPreset || overlayChannel.preset)?.lightZOffset ?? 0);
    reflectionGroup.position.set(0, 0, 0);
    reflectionGroup.scale.set(1, 1, 1);
    reflectionGroup.renderOrder = targetRenderOrder + 1;

    [baseChannel, overlayChannel].forEach(channel => {
      const preset = channel.visualPreset || channel.preset;
      const reflectionMesh = channel.reflectionMesh;
      if (!preset || !reflectionMesh) return;
      const avgLightLocalY = channel.avgLightLocalY ?? -0.22;
      const reflectionHeight = targetMesh.scale.y * 0.88;
      const sourceY = targetMesh.position.y + avgLightLocalY * targetMesh.scale.y;
      reflectionMesh.position.set(
        targetMesh.position.x,
        sourceY - reflectionHeight * preset.reflectionDrop,
        targetMesh.position.z + 0.12
      );
      reflectionMesh.scale.set(targetMesh.scale.x * 1.04, reflectionHeight, 1);
      reflectionMesh.renderOrder = targetRenderOrder + 0.7;
      reflectionMesh.visible = channel.opacityMultiplier > 0.001 && preset.reflectionBrightness > 0.001 && !!reflectionMesh.material.map;
    });

    if (towerMesh && mountainPlacement) {
      towerGroup.visible = true;
      const radioAspect = RADIO_TOWER_IMAGE_SIZE.width / RADIO_TOWER_IMAGE_SIZE.height;
      const baseZ = towerBackMesh
        ? (towerMesh.position.z + towerBackMesh.position.z) * 0.5
        : towerMesh.position.z - 0.5;
      const renderOrder = towerBackMesh
        ? (towerMesh.renderOrder + towerBackMesh.renderOrder) * 0.5
        : towerRenderOrder + 0.5;
      radioTowerRefs.forEach((radioTowerRef, index) => {
        const instance = radioTowerRef.instance || RADIO_TOWER_INSTANCES[index] || RADIO_TOWER_INSTANCES[0];
        const width = mountainPlacement.aspect * mountainPlacement.worldScale * mountainPlacement.cardWidthScale * radioAspect * instance.width;
        const height = mountainPlacement.worldScale * mountainPlacement.cardHeightScale * instance.height;
        radioTowerRef.mesh.scale.set(width, height, 1);
        radioTowerRef.mesh.position.set(
          instance.x,
          height * 0.5 + instance.y,
          baseZ + instance.zOffset + index * 0.0005
        );
        radioTowerRef.mesh.renderOrder = renderOrder + index * 0.01;
        radioTowerRef.mesh.visible = !!instance.visible;
        radioTowerRef.material.opacity = instance.opacity ?? 1;
        const nextAlphaTest = mountainPlacement.alphaTest ?? 0.01;
        if (radioTowerRef.material.alphaTest !== nextAlphaTest) {
          radioTowerRef.material.alphaTest = nextAlphaTest;
          radioTowerRef.material.needsUpdate = true;
        }
      });
    } else {
      towerGroup.visible = false;
    }
    const baseVisualPreset = baseChannel.visualPreset || baseChannel.preset;
    const overlayVisualPreset = overlayChannel.visualPreset || overlayChannel.preset;
    const baseLightsVisible = baseChannel.opacityMultiplier > 0.001 && (
      (baseVisualPreset?.lightOpacity || 0) > 0.001 ||
      (baseVisualPreset?.reflectionBrightness || 0) > 0.001
    );
    const overlayLightsVisible = overlayChannel.opacityMultiplier > 0.001 && (
      (overlayVisualPreset?.lightOpacity || 0) > 0.001 ||
      (overlayVisualPreset?.reflectionBrightness || 0) > 0.001
    );
    visibleWorkActive = group.visible && (
      transitionActive ||
      currentPresetName === 'night' ||
      currentPresetName === 'sunset' ||
      baseLightsVisible ||
      overlayLightsVisible
    );
  }

  return {
    group,
    init,
    update,
    sync,
    needsUpdate: () => ready && visibleWorkActive,
    isReady: () => ready,
    getCount: () => baseChannel.descriptors.length + overlayChannel.descriptors.length
  };
}
