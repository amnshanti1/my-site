import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

const canvas = document.getElementById('demo-canvas');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const effect = new OutlineEffect(renderer, {
  defaultThickness: 0.005,
  defaultColor: [0, 0, 0],
  defaultAlpha: 0.95,
  defaultKeepAlive: true
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x22386f);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(3.0, 2.0, 4.6);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.45, 0);

const ambientLight = new THREE.AmbientLight(0xc1c1c1, 3.0);
scene.add(ambientLight);

const particleLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.06, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);
scene.add(particleLight);

const keyLight = new THREE.PointLight(0xffffff, 2.0, 40, 0);
particleLight.add(keyLight);

// Following three.js toon example style: use a 1D RedFormat DataTexture as gradient map.
function makeGradientMap(stepCount) {
  const steps = Math.max(2, Math.min(8, Math.floor(stepCount)));
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i += 1) {
    data[i] = Math.round((i / (steps - 1)) * 255);
  }
  const texture = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

let gradientMap = makeGradientMap(4);
const toonMaterials = [];

function makeToonMaterial(colorHex) {
  const material = new THREE.MeshToonMaterial({
    color: colorHex,
    gradientMap
  });
  material.userData.outlineParameters = {
    thickness: 0.005,
    color: [0, 0, 0],
    alpha: 1.0,
    visible: true,
    keepAlive: true
  };
  toonMaterials.push(material);
  return material;
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(14, 14),
  makeToonMaterial(0xbd9792)
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(0.42, 48, 32),
  makeToonMaterial(0xe8c791)
);
sphere.position.set(-0.35, 0.42, 0.0);
scene.add(sphere);

const box = new THREE.Mesh(
  new THREE.BoxGeometry(1.05, 0.62, 0.86),
  makeToonMaterial(0xc9a28d)
);
box.position.set(0.95, 0.31, 0.06);
box.rotation.y = -0.22;
scene.add(box);

let globeRoot = null;
const globeMaterialCache = new WeakMap();

function placeModelOnGround(model, targetHeight, worldX, worldZ) {
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  if (size.y <= 0) return;

  const uniformScale = targetHeight / size.y;
  model.scale.multiplyScalar(uniformScale);
  model.updateMatrixWorld(true);

  const scaledBounds = new THREE.Box3().setFromObject(model);
  const scaledCenter = scaledBounds.getCenter(new THREE.Vector3());
  model.position.x += worldX - scaledCenter.x;
  model.position.z += worldZ - scaledCenter.z;
  model.position.y += -scaledBounds.min.y;
}

function setOutlineForMaterial(material, thickness, alpha) {
  if (!material) return;
  material.userData.outlineParameters = {
    thickness,
    color: [0, 0, 0],
    alpha,
    visible: true,
    keepAlive: true
  };
}

function applyOutlineSettingsToAllMaterials(thickness, alpha) {
  for (const material of toonMaterials) {
    setOutlineForMaterial(material, thickness, alpha);
  }

  if (!globeRoot) return;
  globeRoot.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      setOutlineForMaterial(material, thickness, alpha);
    }
  });
}

function convertToToonMaterial(sourceMaterial) {
  if (!sourceMaterial) {
    return makeToonMaterial(0xffffff);
  }
  if (globeMaterialCache.has(sourceMaterial)) {
    return globeMaterialCache.get(sourceMaterial);
  }

  const toonMaterial = new THREE.MeshToonMaterial({
    color: sourceMaterial.color ? sourceMaterial.color.clone() : new THREE.Color(0xffffff),
    map: sourceMaterial.map || null,
    gradientMap,
    transparent: sourceMaterial.transparent === true,
    opacity: sourceMaterial.opacity ?? 1,
    alphaTest: sourceMaterial.alphaTest ?? 0,
    side: sourceMaterial.side ?? THREE.FrontSide
  });

  // Preserve useful texture channels from the source material.
  if (sourceMaterial.emissive) toonMaterial.emissive.copy(sourceMaterial.emissive);
  if (sourceMaterial.emissiveMap) toonMaterial.emissiveMap = sourceMaterial.emissiveMap;
  if (sourceMaterial.emissiveIntensity !== undefined) {
    toonMaterial.emissiveIntensity = sourceMaterial.emissiveIntensity;
  }
  if (sourceMaterial.normalMap) toonMaterial.normalMap = sourceMaterial.normalMap;
  if (sourceMaterial.normalScale) toonMaterial.normalScale.copy(sourceMaterial.normalScale);
  if (sourceMaterial.aoMap) toonMaterial.aoMap = sourceMaterial.aoMap;
  if (sourceMaterial.aoMapIntensity !== undefined) {
    toonMaterial.aoMapIntensity = sourceMaterial.aoMapIntensity;
  }
  if (sourceMaterial.alphaMap) toonMaterial.alphaMap = sourceMaterial.alphaMap;
  if (sourceMaterial.lightMap) toonMaterial.lightMap = sourceMaterial.lightMap;
  if (sourceMaterial.lightMapIntensity !== undefined) {
    toonMaterial.lightMapIntensity = sourceMaterial.lightMapIntensity;
  }

  if (toonMaterial.map) toonMaterial.map.colorSpace = THREE.SRGBColorSpace;
  if (toonMaterial.emissiveMap) toonMaterial.emissiveMap.colorSpace = THREE.SRGBColorSpace;

  setOutlineForMaterial(toonMaterial, guiState.outlineThickness, guiState.outlineAlpha);
  toonMaterials.push(toonMaterial);
  globeMaterialCache.set(sourceMaterial, toonMaterial);
  toonMaterial.needsUpdate = true;
  return toonMaterial;
}

const gltfLoader = new GLTFLoader();
gltfLoader.load(
  '/models/texturedGlobe.glb',
  (gltf) => {
    globeRoot = gltf.scene;
    scene.add(globeRoot);
    const oldMaterials = new Set();

    globeRoot.traverse((node) => {
      if (!node.isMesh) return;
      if (Array.isArray(node.material)) {
        node.material.forEach((material) => oldMaterials.add(material));
        node.material = node.material.map((material) => convertToToonMaterial(material));
      } else {
        oldMaterials.add(node.material);
        node.material = convertToToonMaterial(node.material);
      }
    });

    oldMaterials.forEach((material) => material?.dispose?.());
    placeModelOnGround(globeRoot, 1.25, 0.0, -1.25);
  },
  undefined,
  (err) => {
    console.error('Failed to load /models/texturedGlobe.glb', err);
  }
);

function setToonBands(stepCount) {
  const nextMap = makeGradientMap(stepCount);
  for (const material of toonMaterials) {
    material.gradientMap = nextMap;
    material.needsUpdate = true;
  }
  gradientMap.dispose();
  gradientMap = nextMap;
}

const guiState = {
  toonBands: 4,
  exposure: renderer.toneMappingExposure,
  keyIntensity: keyLight.intensity,
  ambientIntensity: ambientLight.intensity,
  animateLight: true,
  lightOrbitRadius: 2.2,
  lightHeight: 1.8,
  outlineThickness: 0.005,
  outlineAlpha: 1.0,
  keyColor: '#ffffff',
  backgroundColor: '#22386f',
  sphereColor: '#e8c791',
  boxColor: '#c9a28d',
  groundColor: '#bd9792'
};

const gui = new GUI({ title: 'Toon Controls' });
gui.add(guiState, 'toonBands', 2, 8, 1).name('Bands').onChange((value) => {
  setToonBands(value);
});
gui.add(guiState, 'exposure', 0.5, 2.0, 0.01).name('Exposure').onChange((value) => {
  renderer.toneMappingExposure = value;
});
gui.add(guiState, 'keyIntensity', 0.0, 4.0, 0.01).name('Key Intensity').onChange((value) => {
  keyLight.intensity = value;
});
gui.add(guiState, 'ambientIntensity', 0.0, 4.0, 0.01).name('Ambient').onChange((value) => {
  ambientLight.intensity = value;
});
gui.add(guiState, 'animateLight').name('Animate Light');
gui.add(guiState, 'lightOrbitRadius', 0.5, 4.0, 0.01).name('Light Radius');
gui.add(guiState, 'lightHeight', 0.2, 4.0, 0.01).name('Light Height');
gui.add(guiState, 'outlineThickness', 0.0, 0.02, 0.0005).name('Outline Width').onChange((value) => {
  applyOutlineSettingsToAllMaterials(value, guiState.outlineAlpha);
});
gui.add(guiState, 'outlineAlpha', 0.0, 1.0, 0.01).name('Outline Alpha').onChange((value) => {
  applyOutlineSettingsToAllMaterials(guiState.outlineThickness, value);
});
gui.addColor(guiState, 'keyColor').name('Key Color').onChange((value) => {
  keyLight.color.set(value);
  particleLight.material.color.set(value);
});
gui.addColor(guiState, 'backgroundColor').name('BG Color').onChange((value) => {
  scene.background.set(value);
});
gui.addColor(guiState, 'sphereColor').name('Sphere Color').onChange((value) => {
  sphere.material.color.set(value);
});
gui.addColor(guiState, 'boxColor').name('Box Color').onChange((value) => {
  box.material.color.set(value);
});
gui.addColor(guiState, 'groundColor').name('Ground Color').onChange((value) => {
  ground.material.color.set(value);
});

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
});

function updateLightMotion() {
  if (!guiState.animateLight) {
    particleLight.position.set(0, guiState.lightHeight, guiState.lightOrbitRadius);
    return;
  }

  const timer = Date.now() * 0.00025;
  particleLight.position.x = Math.sin(timer * 7) * guiState.lightOrbitRadius;
  particleLight.position.y = Math.cos(timer * 5) * 1.3 + guiState.lightHeight;
  particleLight.position.z = Math.cos(timer * 3) * guiState.lightOrbitRadius;
}

renderer.setAnimationLoop(() => {
  controls.update();
  updateLightMotion();
  effect.render(scene, camera);
});
