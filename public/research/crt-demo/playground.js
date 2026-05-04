import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';


import { createOverlayManager, DEFAULT_OVERLAY_KEY, OVERLAY_OPTIONS } from './overlayManager.js';

// ------- Desktop-like interaction state -------
let pickables = []; // meshes that can be clicked
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hovered = null;
let overlayManager = null;
const overlayButtons = new Map();
const desktopLayout = {
  width: 5,
  height: 4
};

function createLayoutPlane(widthPercent, heightPercent) {
  return new THREE.PlaneGeometry(desktopLayout.width * widthPercent, desktopLayout.height * heightPercent);
}

function setLayoutPosition(mesh, xPercent, yPercent, z = 0) {
  const x = (xPercent - 0.5) * desktopLayout.width;
  const y = (0.5 - yPercent) * desktopLayout.height;
  mesh.position.set(x, y, z);
}
const bootState = {
  group: null,
  progress: 0,
  ready: false,
  promptMesh: null,
  promptTextures: null,
  progressFill: null,
  barWidth: 3.6
};

// Simple helper to create a canvas-based icon texture (no external assets)
function createIconTexture(label = 'Resume', bg = '#0d2034', fg = '#e8f1ff') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  // background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  // rounded square "icon"
  const r = 36;
  ctx.fillStyle = '#1a3a5e';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(c.width, 0, c.width, c.height, r);
  ctx.arcTo(c.width, c.height, 0, c.height, r);
  ctx.arcTo(0, c.height, 0, 0, r);
  ctx.arcTo(0, 0, c.width, 0, r);
  ctx.closePath();
  ctx.fill();

  // label
  ctx.fillStyle = fg;
  ctx.font = 'bold 60px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, c.width / 2, c.height / 2);
  return new THREE.CanvasTexture(c);
}

// Creates a clickable plane "icon"
function makeDesktopIcon({ label, position = new THREE.Vector3(), onClick }) {
  const tex = createIconTexture(label);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const geo = new THREE.PlaneGeometry(0.7, 0.7);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  mesh.userData.onClick = onClick;
  mesh.userData.baseScale = 1;
  pickables.push(mesh);
  return mesh;
}

function applyOverlaySelection(activeKey) {
  overlayButtons.forEach((mesh, key) => {
    const scale = key === activeKey ? 1.05 : 0.85;
    mesh.scale.setScalar(scale);
    mesh.userData.baseScale = scale;
  });
}

function setOverlayAndHighlight(key) {
  if (!overlayManager) return;
  overlayManager.setOverlay(key);
  applyOverlaySelection(overlayManager.getActiveKey());
}

function makeOverlayButton({ label, overlayKey, position }) {
  const mesh = makeDesktopIcon({
    label,
    position,
    onClick: () => {
      setOverlayAndHighlight(overlayKey);
    }
  });
  overlayButtons.set(overlayKey, mesh);
  mesh.scale.setScalar(0.85);
  mesh.userData.baseScale = 0.85;
  return mesh;
}

function makeMenuButton({ label, positionPercent = { x: 0.2, y: 0.4 }, sizePercent = { w: 0.26, h: 0.14 }, onClick }) {
  const tex = createMenuButtonTexture(label);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const geo = createLayoutPlane(sizePercent.w, sizePercent.h);
  const mesh = new THREE.Mesh(geo, mat);
  setLayoutPosition(mesh, positionPercent.x, positionPercent.y, 0);
  mesh.userData.onClick = onClick;
  mesh.userData.baseScale = 1;
  pickables.push(mesh);
  return mesh;
}

// Canvas text texture for flat panels
function createLabelTexture(text = 'Panel', bg = '#0d2034', fg = '#696969', w = 1024, h = 768) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0,0,w,h);
  ctx.fillStyle = fg;
  ctx.font = 'bold 56px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w/2, h/2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBootTitleTexture(title = 'SEVASTOLINK', subtitle = 'ANLA-LINK PRODUCT') {
  const width = 2048;
  const height = 1024;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = '#060606';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  for (let y = 0; y < height; y += 4) {
    ctx.fillRect(0, y, width, 1);
  }
  ctx.fillStyle = '#d0d0d0';
  ctx.font = '600 260px "IBM Plex Mono", "Courier New", monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(title, width / 2, height * 0.45);
  ctx.fillStyle = '#7a7a7a';
  ctx.font = '200 84px "IBM Plex Mono", "Courier New", monospace';
  ctx.fillText(subtitle, width / 2, height * 0.72);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createBootPromptTexture(text) {
  const width = 1536;
  const height = 384;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#dcdcdc';
  ctx.font = '600 140px "IBM Plex Mono", "Courier New", monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, width / 2, height / 2, width * 0.9);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createBootFooterTexture(text = '(C) LIA-LINK DATA SYSTEMS') {
  const width = 1024;
  const height = 256;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#737373';
  ctx.font = '600 64px "IBM Plex Mono", "Courier New", monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMenuHeaderTexture(text = 'PERSONAL TERMINAL') {
  const width = 4096;
  const height = 320;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#1d1d1d';
  ctx.fillRect(8, 8, width - 16, height - 16);
  ctx.strokeStyle = '#5e5e5e';
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, width - 12, height - 12);
  ctx.fillStyle = '#cfcfcf';
  ctx.font = '600 180px "IBM Plex Mono", "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 240, height / 2);
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(width - 320, 64, 224, height - 128);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMenuSectionLabelTexture(text = 'FOLDERS') {
  const width = 1024;
  const height = 256;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#7b7b7b';
  ctx.font = '600 140px "IBM Plex Mono", "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, height / 2);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMenuButtonTexture(text = 'PLAY GAME') {
  const width = 1536;
  const height = 512;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = '#101010';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#7f7f7f';
  ctx.lineWidth = 16;
  ctx.strokeRect(8, 8, width - 16, height - 16);
  ctx.fillStyle = '#dcdcdc';
  ctx.font = '600 220px "IBM Plex Mono", "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMenuLogoTexture() {
  return createBootTitleTexture('SEVASTOLINK', 'AN LM-LINK PRODUCT');
}

const canvas = document.getElementById('crt-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(1280, 1280, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02050b);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
camera.position.set(0, 0, 6);

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const spot = new THREE.SpotLight(0xffffff,1000);

spot.angle = 0.15;
spot.penumbra = 1;

spot.position.set(10, 10, 10);  
spot.target.position.set(0, 0, 0);  
scene.add(spot);

const point = new THREE.PointLight(0xffffff, 0.5, 0, 1);
point.position.set(0, 0, 0);
scene.add(point);

// ------- Screen router: swap entire 3D layers instead of iframe overlay -------
const screenRoot = new THREE.Group();
scene.add(screenRoot);

const screenBoot = new THREE.Group();
const screenDesktop = new THREE.Group();
const screenCube = new THREE.Group();
const screenDocs = new THREE.Group();
const screenSettings = new THREE.Group();
screenRoot.add(screenBoot, screenDesktop, screenCube, screenDocs, screenSettings);
screenDesktop.position.set(0, 0, 0);
screenDesktop.scale.setScalar(1);

(function buildBootScreen() {
  const title = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 1.4),
    new THREE.MeshBasicMaterial({ map: createBootTitleTexture(), transparent: true })
  );
  title.position.set(0, 1.1, 0);
  screenBoot.add(title);

  const promptTextures = {
    wait: createBootPromptTexture('INITIALIZING...'),
    ready: createBootPromptTexture('PRESS ME TO CONTINUE')
  };
  const promptMaterial = new THREE.MeshBasicMaterial({
    map: promptTextures.wait,
    transparent: true,
    opacity: 0.6
  });
  const prompt = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.7), promptMaterial);
  prompt.position.set(0, -0.05, 0.01);
  screenBoot.add(prompt);

  const footer = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 0.3),
    new THREE.MeshBasicMaterial({ map: createBootFooterTexture(), transparent: true, opacity: 0.65 })
  );
  footer.position.set(0, -1.2, 0);
  screenBoot.add(footer);

  const frameHeight = 0.2;
  const frameWidth = bootState.barWidth;
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(frameWidth, frameHeight),
    new THREE.MeshBasicMaterial({ color: 0x1c1c1c, transparent: true, opacity: 0.85 })
  );
  frame.position.set(0, -0.6, 0);
  screenBoot.add(frame);

  const innerHeight = frameHeight * 0.55;
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xd9d9d9, transparent: true, opacity: 0.88 })
  );
  fill.scale.set(frameWidth * 0.08, innerHeight, 1);
  fill.userData.baseHeight = innerHeight;
  fill.position.set(-frameWidth / 2 + fill.scale.x / 2, -0.6, 0.01);
  screenBoot.add(fill);

  bootState.group = screenBoot;
  bootState.progress = 0;
  bootState.ready = false;
  bootState.progressFill = fill;
  bootState.promptMesh = prompt;
  bootState.promptTextures = promptTextures;
})();

// Utility: clear and set current pickable list
function setPickablesFrom(group) {
  if (!group) {
    pickables = [];
    return;
  }
  pickables = [];
  group.traverse((obj) => {
    if (obj.isMesh && obj.userData && (obj.userData.onClick || obj.userData.baseScale)) {
      pickables.push(obj);
    }
  });
}

// Back icon factory
function makeBackIcon(targetScreen = 'desktop', position = new THREE.Vector3(-1.8, 1.2, 0)) {
  return makeDesktopIcon({
    label: 'Back',
    position,
    onClick: () => setActiveScreen(targetScreen)
  });
}

// ----- Desktop screen (main menu layout) -----
const menuHeader = new THREE.Mesh(
  createLayoutPlane(0.82, 0.12),
  new THREE.MeshBasicMaterial({ map: createMenuHeaderTexture(), transparent: true })
);
setLayoutPosition(menuHeader, 0.58, 0.17, 0);
screenDesktop.add(menuHeader);

const foldersLabelMesh = new THREE.Mesh(
  createLayoutPlane(0.24, 0.08),
  new THREE.MeshBasicMaterial({ map: createMenuSectionLabelTexture('FOLDERS'), transparent: true, opacity: 0.75 })
);
setLayoutPosition(foldersLabelMesh, 0.2, 0.33, 0);
screenDesktop.add(foldersLabelMesh);

const menuButtonDefs = [
  { label: 'PLAY GAME', target: 'cube', positionPercent: { x: 0.2, y: 0.45 } },
  { label: 'OPTIONS', target: 'settings', positionPercent: { x: 0.2, y: 0.57 } },
  { label: 'STORE', target: 'docs', positionPercent: { x: 0.2, y: 0.69 } },
  { label: 'QUIT', target: 'boot', positionPercent: { x: 0.2, y: 0.81 } }
];

const menuButtonSize = { w: 0.25, h: 0.12 };
menuButtonDefs.forEach((def) => {
  const button = makeMenuButton({
    label: def.label,
    positionPercent: def.positionPercent,
    sizePercent: menuButtonSize,
    onClick: () => setActiveScreen(def.target)
  });
  screenDesktop.add(button);
});

const menuLogo = new THREE.Mesh(
  createLayoutPlane(0.55, 0.28),
  new THREE.MeshBasicMaterial({ map: createMenuLogoTexture(), transparent: true, opacity: 0.85 })
);
setLayoutPosition(menuLogo, 0.65, 0.52, 0);
screenDesktop.add(menuLogo);

const menuFooter = new THREE.Mesh(
  createLayoutPlane(0.4, 0.1),
  new THREE.MeshBasicMaterial({ map: createBootFooterTexture(), transparent: true, opacity: 0.6 })
);
setLayoutPosition(menuFooter, 0.65, 0.78, 0);
screenDesktop.add(menuFooter);

// ----- Cube screen (the classic 4 rotating cubes)
const BOX_COLORS = [0xff5555, 0x55bb55, 0x5555ff, 0xffffff];
const BOX_OFFSETS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
const orbitGroup = new THREE.Group();
screenCube.add(orbitGroup, makeBackIcon('desktop'));

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const boxes = BOX_COLORS.map(color => {
  const material = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(boxGeometry, material);
  orbitGroup.add(mesh);
  return mesh;
});

// ----- Docs screen (flat panel with "Documents" title)
const docsPanelTex = createLabelTexture('Documents Panel (replace with PDF texture)');
const docsPanel = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.0), new THREE.MeshBasicMaterial({ map: docsPanelTex, transparent: true }));
screenDocs.add(docsPanel, makeBackIcon('desktop'));

// ----- Settings screen (flat panel)
const settingsPanelTex = createLabelTexture('Settings Panel (expose uniforms here)');
const settingsPanel = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.0), new THREE.MeshBasicMaterial({ map: settingsPanelTex, transparent: true }));
screenSettings.add(settingsPanel, makeBackIcon('desktop'));

const overlayButtonOffset = -1.4;
OVERLAY_OPTIONS.forEach(({ key, label }, index) => {
  const position = new THREE.Vector3(overlayButtonOffset + index * 1.4, 0.7, 0.01);
  const button = makeOverlayButton({ label, overlayKey: key, position });
  screenSettings.add(button);
});

// ----- Active screen state + router -----
let activeScreen = 'boot';
function setActiveScreen(name) {
  activeScreen = name;
  screenBoot.visible = name === 'boot';
  screenDesktop.visible = name === 'desktop';
  screenCube.visible = name === 'cube';
  screenDocs.visible = name === 'docs';
  screenSettings.visible = name === 'settings';
  let targetGroup = null;
  if (name === 'desktop') targetGroup = screenDesktop;
  else if (name === 'cube') targetGroup = screenCube;
  else if (name === 'docs') targetGroup = screenDocs;
  else if (name === 'settings') targetGroup = screenSettings;
  if (name === 'boot') {
    resetBootSequence();
  }
  setPickablesFrom(targetGroup);
}
setActiveScreen('boot');
const renderSize = new THREE.Vector2(1280, 1280);
const composer = new EffectComposer(renderer);
composer.setSize(renderSize.x, renderSize.y);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), 2, 0.8, 0);
bloomPass.renderToScreen = true;
composer.addPass(bloomPass);

overlayManager = createOverlayManager({
  composer,
  bloomPass,
  initialSize: renderSize.clone()
});
setOverlayAndHighlight(DEFAULT_OVERLAY_KEY);

window.addEventListener('resize', () => {
  const w = 1280; // Replace with canvas measurements if responsive
  const h = 1280;
  renderSize.set(w, h);
  composer.setSize(w, h);
  renderer.setSize(w, h, false);
  bloomPass.setSize(w, h);
  overlayManager.resize(w, h);
});


let time = 0;
let paused = false;

const toggleButton = document.getElementById('toggle');
toggleButton.addEventListener('click', () => {
  if (activeScreen === 'boot') return;
  paused = !paused;
  toggleButton.textContent = paused ? 'Resume' : 'Pause';
});

function attemptBootCompletion() {
  if (activeScreen === 'boot' && bootState.ready) {
    setActiveScreen('desktop');
  }
}

window.addEventListener('keydown', event => {
  if (activeScreen === 'boot') {
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      attemptBootCompletion();
    }
    return;
  }
  if (event.code === 'Space') {
    event.preventDefault();
    paused = !paused;
    toggleButton.textContent = paused ? 'Resume' : 'Pause';
  }
});

// ------- Pointer handling for picking -------
renderer.domElement.style.cursor = 'default';

function updatePointerFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function handleHover() {
  if (activeScreen === 'boot') {
    if (hovered) {
      hovered.scale.setScalar(hovered.userData.baseScale);
      hovered = null;
    }
    renderer.domElement.style.cursor = 'default';
    return;
  }
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(pickables, true);
  const hit = hits[0]?.object || null;

  if (hovered !== hit) {
    // reset previous
    if (hovered) hovered.scale.setScalar(hovered.userData.baseScale);
    hovered = hit;
    renderer.domElement.style.cursor = hovered ? 'pointer' : 'default';
    if (hovered) hovered.scale.setScalar(1.08);
  }
}

renderer.domElement.addEventListener('pointermove', (e) => {
  updatePointerFromEvent(e);
  handleHover();
});

renderer.domElement.addEventListener('click', (e) => {
  if (activeScreen === 'boot') {
    attemptBootCompletion();
    return;
  }
  updatePointerFromEvent(e);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(pickables, true);
  if (hits.length) {
    const obj = hits[0].object;
    if (typeof obj.userData.onClick === 'function') obj.userData.onClick();
  }
});

function resetBootSequence() {
  if (!bootState.group) return;
  bootState.progress = 0;
  bootState.ready = false;
  const width = bootState.barWidth;
  const minWidth = width * 0.08;
  if (bootState.progressFill) {
    const height = bootState.progressFill.userData.baseHeight || 0.12;
    bootState.progressFill.scale.set(minWidth, height, 1);
    bootState.progressFill.position.x = -width / 2 + minWidth / 2;
  }
  if (bootState.promptMesh && bootState.promptTextures) {
    bootState.promptMesh.material.map = bootState.promptTextures.wait;
    bootState.promptMesh.material.opacity = 0.6;
    bootState.promptMesh.material.needsUpdate = true;
  }
}

function updateBootScreen() {
  if (!bootState.group) return;
  if (!bootState.ready) {
    bootState.progress = Math.min(1, bootState.progress + 0.004);
    if (bootState.progress >= 1) {
      bootState.ready = true;
      if (bootState.promptMesh && bootState.promptTextures) {
        const readyTexture = bootState.promptTextures.ready;
        bootState.promptMesh.material.map = readyTexture;
        bootState.promptMesh.material.opacity = 1;
        bootState.promptMesh.material.needsUpdate = true;
      }
    }
  }

  const width = bootState.barWidth;
  const minWidth = width * 0.08;
  const fillWidth = bootState.ready ? width : minWidth + (width - minWidth) * bootState.progress;
  if (bootState.progressFill) {
    const height = bootState.progressFill.userData.baseHeight || 0.12;
    bootState.progressFill.scale.set(fillWidth, height, 1);
    bootState.progressFill.position.x = -width / 2 + fillWidth / 2;
  }

  if (bootState.promptMesh) {
    const material = bootState.promptMesh.material;
    material.transparent = true;
    if (bootState.ready) {
      const blink = (Math.sin(time * 6) + 1) * 0.5;
      material.opacity = THREE.MathUtils.lerp(0.45, 1, blink);
    } else {
      material.opacity = 0.6;
    }
  }
}

function animate() {
  // Keep hover logic fresh if camera/scene moves
  handleHover();
  if (!paused) {
    time += 0.01;
  }
  if (activeScreen === 'boot') {
    updateBootScreen();
  }
  // Cube screen animation
  if (activeScreen === 'cube') {
    const radius = 0.5 * (Math.sin(time * 0.5) + 2) * 1.5;
    boxes.forEach((mesh, index) => {
      const angle = time + BOX_OFFSETS[index];
      mesh.position.set(radius * Math.cos(angle), radius * Math.sin(angle), 0);
      if (!paused) {
        mesh.rotation.x += 0.01;
        mesh.rotation.y += 0.01;
      }
    });
  }

  if (overlayManager) {
    overlayManager.update(time);
  }

  composer.render();
  requestAnimationFrame(animate);
}
animate();
