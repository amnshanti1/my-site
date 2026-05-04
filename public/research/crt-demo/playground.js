import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';


import { createOverlayManager, DEFAULT_OVERLAY_KEY, OVERLAY_OPTIONS } from './overlayManager.js';
import { DEFAULT_MULTICOLOR_CRT_PARAMS } from './crtShader.js';
import { DEFAULT_MONOCHROME_CRT_PARAMS } from './passes/monochromeCrtPass.js';

const CANVAS_WIDTH = 1280+1280/2;
const CANVAS_HEIGHT = 1280;
const CANVAS_ASPECT = CANVAS_WIDTH / CANVAS_HEIGHT;

// ------- Desktop-like interaction state -------
let pickables = []; // meshes that can be clicked
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hovered = null;
let overlayManager = null;
const overlayButtons = new Map();
const BASE_LAYOUT_HEIGHT = 5.2;
const desktopLayout = {
  width: BASE_LAYOUT_HEIGHT * CANVAS_ASPECT,
  height: BASE_LAYOUT_HEIGHT
};
const layoutCornerConfig = {
  horizontalPercent: 0.08,
  verticalPercent: 0.08,
  thicknessPercent: 0.01,
  color: 0xFFBF00,
  opacity: 0.35
};
const overlayDisplayNames = {
  multicolor: 'MULTI',
  monochrome: 'MONO'
};
const optionsRowMetrics = {
  labelAnchor: 0.08,
  valueCenter: 0.78,
  valueHalfSpan: 0.15,
  fontSize: 138
};
let layoutCorners = [];
const overlayOptionKeys = OVERLAY_OPTIONS.map((option) => option.key);
let overlayOptionIndex = Math.max(0, overlayOptionKeys.indexOf(DEFAULT_OVERLAY_KEY));
let overlayRowMesh = null;
GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/legacy/build/pdf.worker.mjs';
let colorControlsEnabled = overlayOptionKeys[overlayOptionIndex] === 'monochrome';
const monochromeColorOptions = [
  { label: 'WHITE', color: new THREE.Color(0xf5f5f5) },
  { label: 'AMBER', color: new THREE.Color(0xffbb66) },
  { label: 'GREEN', color: new THREE.Color(0x8cff8a) }
];
let monochromeColorIndex = 0;
let monochromeColorRowMesh = null;
let pendingMonochromeTint = monochromeColorOptions[0].color.clone();
let shaderControllers = [];
const resumeMinZoomFactor = 0.7;
const resumeState = {
  zoom: 1,
  minZoom: resumeMinZoomFactor,
  maxZoom: 3.5,
  zoomStep: 0.12,
  aspect: 1,
  offset: new THREE.Vector2(0, 0),
  size: new THREE.Vector2(0, 0),
  panActive: false,
  panLast: new THREE.Vector2(),
  ignoreClick: false,
  defaultZoom: 1
};
const embeddedDemoState = {
  iframe: null,
  sourceCanvas: null,
  compositeCanvas: null,
  compositeContext: null,
  texture: null,
  plane: null,
  material: null,
  guiHitRegions: [],
  guiPointerRegion: null,
  suppressNextGuiClick: false,
  activePath: '',
  activeTitle: '',
  retryUntil: 0,
  pointerActive: false,
  pointerId: 1,
  pointerButtons: 0
};


function createLayoutPlane(widthPercent, heightPercent) {
  return new THREE.PlaneGeometry(desktopLayout.width * widthPercent, desktopLayout.height * heightPercent);
}

function setLayoutPosition(mesh, xPercent, yPercent, z = 0) {
  const x = (xPercent - 0.5) * desktopLayout.width;
  const y = (0.5 - yPercent) * desktopLayout.height;
  mesh.position.set(x, y, z);
}

function disposeCornerGroup(group, parent) {
  if (!group) return;
  group.traverse((child) => {
    if (child.isMesh) {
      child.geometry.dispose();
      child.material.dispose();
    }
  });
  if (parent) parent.remove(group);
}

function safelySetPointerCapture(element, pointerId) {
  try {
    element?.setPointerCapture?.(pointerId);
  } catch {
    // Forwarded iframe pointer events are synthetic, so native capture can be unavailable.
  }
}

function safelyReleasePointerCapture(element, pointerId) {
  try {
    if (!element?.hasPointerCapture || element.hasPointerCapture(pointerId)) {
      element?.releasePointerCapture?.(pointerId);
    }
  } catch {
    // Ignore capture release mismatches from synthetic pointer streams.
  }
}

function installSyntheticPointerCaptureShim(element) {
  if (!element || element.__crtSyntheticPointerCaptureShim) return;
  const nativeSetPointerCapture = element.setPointerCapture?.bind(element);
  const nativeReleasePointerCapture = element.releasePointerCapture?.bind(element);
  const nativeHasPointerCapture = element.hasPointerCapture?.bind(element);
  element.__crtSyntheticPointerCaptureShim = true;
  element.setPointerCapture = (pointerId) => {
    try {
      nativeSetPointerCapture?.(pointerId);
    } catch {
      element.__crtSyntheticPointerId = pointerId;
    }
  };
  element.releasePointerCapture = (pointerId) => {
    try {
      nativeReleasePointerCapture?.(pointerId);
    } catch {
      if (element.__crtSyntheticPointerId === pointerId) element.__crtSyntheticPointerId = null;
    }
  };
  element.hasPointerCapture = (pointerId) => {
    try {
      return nativeHasPointerCapture?.(pointerId) || element.__crtSyntheticPointerId === pointerId;
    } catch {
      return element.__crtSyntheticPointerId === pointerId;
    }
  };
}

function ensureEmbeddedCompositeCanvas(width = CANVAS_WIDTH, height = CANVAS_HEIGHT) {
  const canvas = embeddedDemoState.compositeCanvas || document.createElement('canvas');
  const nextWidth = Math.max(1, Math.round(width));
  const nextHeight = Math.max(1, Math.round(height));
  if (canvas.width !== nextWidth) canvas.width = nextWidth;
  if (canvas.height !== nextHeight) canvas.height = nextHeight;
  embeddedDemoState.compositeCanvas = canvas;
  embeddedDemoState.compositeContext = canvas.getContext('2d');
  return canvas;
}

function getEmbeddedDemoDocument() {
  try {
    return embeddedDemoState.iframe?.contentDocument || null;
  } catch {
    return null;
  }
}

function isRenderableRect(rect, width = CANVAS_WIDTH, height = CANVAS_HEIGHT) {
  return rect &&
    rect.width > 4 &&
    rect.height > 4 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < width &&
    rect.top < height;
}

function findControllerLabel(controller, input) {
  const explicitName = controller?.querySelector?.('.name')?.textContent?.trim();
  if (explicitName) return explicitName;
  const label = input?.closest?.('label')?.textContent?.trim();
  if (label) return label.replace(String(input.value || ''), '').trim();
  return input?.name || input?.ariaLabel || input?.type || 'Control';
}

function formatControlValue(input) {
  if (!input) return '';
  if (input.type === 'checkbox') return input.checked ? 'ON' : 'OFF';
  if (input.type === 'color') return String(input.value || '').toUpperCase();
  if (input.tagName === 'SELECT') {
    const option = input.selectedOptions?.[0];
    return option?.textContent?.trim() || input.value || '';
  }
  const numeric = Number.parseFloat(input.value);
  if (Number.isFinite(numeric)) {
    return Math.abs(numeric) >= 10 ? numeric.toFixed(1).replace(/\.0$/, '') : numeric.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }
  return String(input.value || '');
}

function setRangeInputValue(input, ratio) {
  const min = Number.parseFloat(input.min);
  const max = Number.parseFloat(input.max);
  const step = Number.parseFloat(input.step);
  const low = Number.isFinite(min) ? min : 0;
  const high = Number.isFinite(max) ? max : 1;
  const unclamped = low + THREE.MathUtils.clamp(ratio, 0, 1) * (high - low);
  const stepped = Number.isFinite(step) && step > 0
    ? Math.round(unclamped / step) * step
    : unclamped;
  input.value = String(THREE.MathUtils.clamp(stepped, Math.min(low, high), Math.max(low, high)));
  dispatchEmbeddedElementEvent(input, 'input');
}

function dispatchEmbeddedElementEvent(element, type) {
  const EventCtor = element?.ownerDocument?.defaultView?.Event || Event;
  element?.dispatchEvent?.(new EventCtor(type, { bubbles: true }));
}

function getEmbeddedDocumentPoint(viewX, viewY, canvasWidth, canvasHeight) {
  const doc = getEmbeddedDemoDocument();
  if (!doc) return null;
  const viewWidth = doc.defaultView?.innerWidth || canvasWidth || CANVAS_WIDTH;
  const viewHeight = doc.defaultView?.innerHeight || canvasHeight || CANVAS_HEIGHT;
  return {
    doc,
    x: (viewX / Math.max(canvasWidth || 1, 1)) * viewWidth,
    y: (viewY / Math.max(canvasHeight || 1, 1)) * viewHeight
  };
}

function findEmbeddedGuiElementAt(viewX, viewY, canvasWidth, canvasHeight) {
  const point = getEmbeddedDocumentPoint(viewX, viewY, canvasWidth, canvasHeight);
  if (!point) return null;
  const element = point.doc.elementFromPoint(point.x, point.y);
  const guiNode = element?.closest?.('.lil-gui');
  if (!guiNode) return null;
  const input = element.matches?.('input, select, button')
    ? element
    : (element.closest?.('.controller, li')?.querySelector?.('input, select, button') || guiNode.querySelector?.('input, select, button'));
  if (!input) return null;
  const rect = input.getBoundingClientRect();
  const viewWidth = point.doc.defaultView?.innerWidth || canvasWidth || CANVAS_WIDTH;
  return {
    element: input,
    type: input.type || input.tagName.toLowerCase(),
    trackX: rect.left,
    trackWidth: Math.max(rect.width, 1),
    canvasRegion: {
      element: input,
      type: input.type || input.tagName.toLowerCase(),
      trackX: (rect.left / Math.max(viewWidth, 1)) * canvasWidth,
      trackWidth: (Math.max(rect.width, 1) / Math.max(viewWidth, 1)) * canvasWidth
    },
    x: point.x,
    y: point.y
  };
}

function drawEmbeddedGuiOverlay(ctx, width, height) {
  embeddedDemoState.guiHitRegions = [];
  const doc = getEmbeddedDemoDocument();
  if (!doc) return;
  const viewWidth = doc.defaultView?.innerWidth || width;
  const viewHeight = doc.defaultView?.innerHeight || height;
  const scaleX = width / Math.max(viewWidth, 1);
  const scaleY = height / Math.max(viewHeight, 1);
  const scaleRect = rect => ({
    left: rect.left * scaleX,
    right: rect.right * scaleX,
    top: rect.top * scaleY,
    bottom: rect.bottom * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY
  });

  const allGuiRoots = [...doc.querySelectorAll('.lil-gui.root, .lil-gui')];
  const guiRoots = allGuiRoots.filter(root => {
    if (allGuiRoots.some(other => other !== root && other.contains(root))) return false;
    const rect = scaleRect(root.getBoundingClientRect());
    return isRenderableRect(rect, width, height);
  });
  if (!guiRoots.length) return;

  ctx.save();
  ctx.font = '600 16px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;

  guiRoots.forEach(root => {
    const rootRect = scaleRect(root.getBoundingClientRect());
    if (!isRenderableRect(rootRect, width, height)) return;
    const panelX = THREE.MathUtils.clamp(rootRect.left, 0, width);
    const panelY = THREE.MathUtils.clamp(rootRect.top, 0, height);
    const panelW = THREE.MathUtils.clamp(rootRect.width, 80, width - panelX);
    const panelH = THREE.MathUtils.clamp(rootRect.height, 20, height - panelY);
    ctx.fillStyle = 'rgba(12, 14, 18, 0.86)';
    ctx.strokeStyle = 'rgba(120, 190, 255, 0.35)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1);

    const controls = [...root.querySelectorAll('input, select, button')].filter(input => {
      const rect = scaleRect(input.getBoundingClientRect());
      if (!isRenderableRect(rect, width, height)) return false;
      const style = doc.defaultView.getComputedStyle(input);
      return style.visibility !== 'hidden' && style.display !== 'none';
    });

    controls.forEach(input => {
      const controller = input.closest('.controller') || input.closest('li') || input.parentElement;
      const controllerRect = scaleRect(controller?.getBoundingClientRect?.() || input.getBoundingClientRect());
      const inputRect = scaleRect(input.getBoundingClientRect());
      if (!isRenderableRect(controllerRect, width, height)) return;

      const rowX = THREE.MathUtils.clamp(controllerRect.left, 0, width);
      const rowY = THREE.MathUtils.clamp(controllerRect.top, 0, height);
      const rowW = THREE.MathUtils.clamp(controllerRect.width, 36, width - rowX);
      const rowH = THREE.MathUtils.clamp(controllerRect.height, 18, height - rowY);
      const label = findControllerLabel(controller, input);
      const value = formatControlValue(input);
      const valueW = Math.max(54, Math.min(92, rowW * 0.3));
      const trackX = Math.max(inputRect.left, rowX + rowW * 0.48);
      const trackY = inputRect.top + inputRect.height * 0.5;
      const trackW = Math.max(24, inputRect.width);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.055)';
      ctx.fillRect(rowX, rowY, rowW, rowH);
      ctx.fillStyle = 'rgba(230, 238, 255, 0.9)';
      ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(label.slice(0, 22), rowX + 8, rowY + rowH * 0.5);
      ctx.fillStyle = 'rgba(92, 202, 255, 0.95)';
      ctx.textAlign = 'right';
      ctx.fillText(value.slice(0, 12), rowX + rowW - 8, rowY + rowH * 0.5);
      ctx.textAlign = 'left';

      if (input.type === 'range') {
        const min = Number.parseFloat(input.min);
        const max = Number.parseFloat(input.max);
        const low = Number.isFinite(min) ? min : 0;
        const high = Number.isFinite(max) ? max : 1;
        const current = Number.parseFloat(input.value);
        const ratio = high !== low && Number.isFinite(current) ? THREE.MathUtils.clamp((current - low) / (high - low), 0, 1) : 0;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
        ctx.beginPath();
        ctx.moveTo(trackX, trackY);
        ctx.lineTo(trackX + trackW, trackY);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(92, 202, 255, 0.9)';
        ctx.beginPath();
        ctx.moveTo(trackX, trackY);
        ctx.lineTo(trackX + trackW * ratio, trackY);
        ctx.stroke();
        ctx.fillStyle = 'rgba(92, 202, 255, 1)';
        ctx.fillRect(trackX + trackW * ratio - 2, rowY + 3, 4, rowH - 6);
      } else if (input.type === 'color') {
        ctx.fillStyle = input.value || '#ffffff';
        ctx.fillRect(rowX + rowW - valueW - 8, rowY + 4, valueW, rowH - 8);
      } else if (input.type === 'checkbox') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.strokeRect(rowX + rowW - 28, rowY + rowH * 0.5 - 8, 16, 16);
        if (input.checked) {
          ctx.fillStyle = 'rgba(92, 202, 255, 1)';
          ctx.fillRect(rowX + rowW - 25, rowY + rowH * 0.5 - 5, 10, 10);
        }
      }

      embeddedDemoState.guiHitRegions.push({
        x: rowX,
        y: rowY,
        width: rowW,
        height: rowH,
        trackX,
        trackWidth: trackW,
        element: input,
        type: input.type || input.tagName.toLowerCase()
      });
    });
  });

  ctx.restore();
}

function findEmbeddedGuiRegion(x, y) {
  return embeddedDemoState.guiHitRegions.find(region =>
    x >= region.x &&
    x <= region.x + region.width &&
    y >= region.y &&
    y <= region.y + region.height
  ) || null;
}

function dispatchEmbeddedGuiChange(region, kind, x, y) {
  if (!region?.element) return false;
  const element = region.element;
  if (region.type === 'range') {
    if (kind === 'pointerdown' || kind === 'pointermove' || kind === 'click') {
      setRangeInputValue(element, (x - region.trackX) / Math.max(region.trackWidth, 1));
    }
    if (kind === 'pointerup' || kind === 'click') {
      dispatchEmbeddedElementEvent(element, 'change');
    }
    return true;
  }
  if (kind !== 'pointerdown' && kind !== 'click') return true;
  if (region.type === 'checkbox') {
    element.checked = !element.checked;
    dispatchEmbeddedElementEvent(element, 'input');
    dispatchEmbeddedElementEvent(element, 'change');
    return true;
  }
  if (element.tagName === 'BUTTON') {
    element.click();
    return true;
  }
  element.focus?.();
  element.click?.();
  return true;
}

function dispatchEmbeddedGuiDomFallback(hit, kind) {
  if (!hit?.element) return false;
  const element = hit.element;
  if (hit.type === 'range') {
    if (kind === 'pointerdown' || kind === 'pointermove' || kind === 'click') {
      setRangeInputValue(element, (hit.x - hit.trackX) / Math.max(hit.trackWidth, 1));
    }
    if (kind === 'pointerup' || kind === 'click') {
      dispatchEmbeddedElementEvent(element, 'change');
    }
    return true;
  }
  if (kind !== 'pointerdown' && kind !== 'click') return true;
  if (hit.type === 'checkbox') {
    element.checked = !element.checked;
    dispatchEmbeddedElementEvent(element, 'input');
    dispatchEmbeddedElementEvent(element, 'change');
    return true;
  }
  if (element.tagName === 'BUTTON') {
    element.click();
    return true;
  }
  element.focus?.();
  element.click?.();
  return true;
}

function rebuildLayoutCorners(parentGroup) {
  if (!parentGroup) return;
  layoutCorners.forEach((corner) => disposeCornerGroup(corner, parentGroup));
  layoutCorners = [];

  const horizontalLength = desktopLayout.width * layoutCornerConfig.horizontalPercent;
  const verticalLength = desktopLayout.height * layoutCornerConfig.verticalPercent;
  const thickness = Math.min(desktopLayout.width, desktopLayout.height) * layoutCornerConfig.thicknessPercent;
  const halfWidth = desktopLayout.width / 2;
  const halfHeight = desktopLayout.height / 2;
  const materialParams = {
    color: layoutCornerConfig.color,
    transparent: true,
    opacity: layoutCornerConfig.opacity,
    depthTest: false
  };

  const createBarMaterial = () => new THREE.MeshBasicMaterial(materialParams);
  const zOffset = 0.03;

  const corners = [
    { xSign: -1, ySign: 1 },
    { xSign: 1, ySign: 1 },
    { xSign: -1, ySign: -1 },
    { xSign: 1, ySign: -1 }
  ];

  corners.forEach(({ xSign, ySign }) => {
    const cornerGroup = new THREE.Group();

    const horizontal = new THREE.Mesh(
      new THREE.PlaneGeometry(horizontalLength, thickness),
      createBarMaterial()
    );
    horizontal.position.set(
      xSign * (halfWidth - horizontalLength / 2),
      ySign * (halfHeight - thickness / 2),
      zOffset
    );
    cornerGroup.add(horizontal);

    const vertical = new THREE.Mesh(
      new THREE.PlaneGeometry(thickness, verticalLength),
      createBarMaterial()
    );
    vertical.position.set(
      xSign * (halfWidth - thickness / 2),
      ySign * (halfHeight - verticalLength / 2),
      zOffset
    );
    cornerGroup.add(vertical);

    parentGroup.add(cornerGroup);
    layoutCorners.push(cornerGroup);
  });
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
  mesh.userData.hoverScale = 1.08;
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
  if (overlayManager) {
    overlayManager.setOverlay(key);
  }
  applyOverlaySelection(key);
  const index = OVERLAY_OPTIONS.findIndex(option => option.key === key);
  if (index >= 0) {
    overlayOptionIndex = index;
    colorControlsEnabled = OVERLAY_OPTIONS[index].key === 'monochrome';
    debugTweakState.crtProfile = key;
    updateOverlayRowLabel();
    updateColorRowState();
    syncShaderStateFromProfile(key);
    applyDebugShaderTweaks();
  }
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
  mesh.userData.hoverScale = mesh.userData.baseScale * 1.06;
  return mesh;
}

function makeMenuButton({ label, positionPercent = { x: 0.2, y: 0.4 }, sizePercent = { w: 0.26, h: 0.14 }, onClick, active = false }) {
  const geo = createLayoutPlane(sizePercent.w, sizePercent.h);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true }));
  setLayoutPosition(mesh, positionPercent.x, positionPercent.y, 0);
  mesh.userData.onClick = onClick;
  mesh.userData.baseScale = 1;
  mesh.userData.isMenuButton = true;
  mesh.userData.label = label;
  mesh.userData.activeTexture = !!active;
  updateMenuButtonTexture(mesh, !!active);
  pickables.push(mesh);
  return mesh;
}

function updateMenuButtonTexture(mesh, isActive) {
  if (!mesh?.userData?.isMenuButton) return;
  mesh.userData.activeTexture = !!isActive;
  const newTexture = createMenuButtonTexture(mesh.userData.label, { active: mesh.userData.activeTexture });
  if (mesh.material.map) {
    mesh.material.map.dispose();
  }
  mesh.material.map = newTexture;
  mesh.material.needsUpdate = true;
  mesh.userData.hoverScale = mesh.userData.activeTexture ? 1.02 : 1.03;
}

async function loadPdfTexture(path, maxCanvasWidth = 2048) {
  const pdf = await getDocument(path).promise;
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = maxCanvasWidth / baseViewport.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const alpha = data[i + 3] / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b; // 0 = black, 255 = white
    const ink = Math.max(0, 255 - luminance); // darker areas => higher value
    const inkNorm = ink / 255;
    const outAlpha = Math.min(1, inkNorm * 1.6 * alpha);
    const outValue = 255;
    data[i] = data[i + 1] = data[i + 2] = outValue;
    data[i + 3] = Math.floor(outAlpha * 255);
  }
  ctx.putImageData(imageData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return {
    texture,
    width: viewport.width,
    height: viewport.height,
    aspect: viewport.width / viewport.height
  };
}

function createBackButtonTexture(text = 'BACK') {
  const width = 1400;
  const height = 420;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#bcbcbc';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, width - 14, height - 14);
  ctx.fillStyle = '#f4f4f4';
  ctx.font = '600 210px "IBM Plex Mono", "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createOptionsTabTexture(text = 'TAB', active = false) {
  const width = 1400;
  const height = 360;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = active ? '#1f1f1f' : '#0b0b0b';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = active ? '#f0f0f0' : '#6a6a6a';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, width - 14, height - 14);
  ctx.fillStyle = active ? '#ffffff' : '#bcbcbc';
  ctx.font = '600 200px "IBM Plex Mono", "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width * 0.1, height / 2);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createOptionsRowTexture(label = 'SETTING', value = 'ON', highlight = false) {
  const width = 2600;
  const height = 420;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = highlight ? '#101010' : '#060606';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = highlight ? '#d0d0d0' : '#7d7d7d';
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, width - 12, height - 12);
  ctx.fillStyle = highlight ? '#f0f0f0' : '#d0d0d0';
  ctx.font = `600 ${optionsRowMetrics.fontSize}px "IBM Plex Mono", "Courier New", monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, width * optionsRowMetrics.labelAnchor, height / 2);
  ctx.textAlign = 'center';
  ctx.fillText(value, width * optionsRowMetrics.valueCenter, height / 2);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createArrowTexture(direction = 'left') {
  const size = 256;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = size;
  canvasEl.height = size;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#d8d8d8';
  ctx.beginPath();
  if (direction === 'left') {
    ctx.moveTo(size * 0.7, size * 0.2);
    ctx.lineTo(size * 0.32, size * 0.5);
    ctx.lineTo(size * 0.7, size * 0.8);
  } else {
    ctx.moveTo(size * 0.3, size * 0.2);
    ctx.lineTo(size * 0.68, size * 0.5);
    ctx.lineTo(size * 0.3, size * 0.8);
  }
  ctx.closePath();
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createArrowMesh(direction, width, height) {
  const geometry = new THREE.PlaneGeometry(width, height);
  const texture = createArrowTexture(direction);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false });
  const mesh = new THREE.Mesh(geometry, material);
  return mesh;
}

function updateOverlayRowLabel() {
  if (!overlayRowMesh) return;
  const option = OVERLAY_OPTIONS[overlayOptionIndex] || OVERLAY_OPTIONS[0];
  const label = option ? (overlayDisplayNames[option.key] || option.label.toUpperCase()) : 'UNKNOWN';
  const newTexture = createOptionsRowTexture('CRT PROFILE', label, true);
  if (overlayRowMesh.material.map) {
    overlayRowMesh.material.map.dispose();
  }
  overlayRowMesh.material.map = newTexture;
  overlayRowMesh.material.needsUpdate = true;
}

function cycleOverlayMode(step) {
  if (!OVERLAY_OPTIONS.length) return;
  const nextIndex = (overlayOptionIndex + step + OVERLAY_OPTIONS.length) % OVERLAY_OPTIONS.length;
  const option = OVERLAY_OPTIONS[nextIndex];
  if (option) {
    setOverlayAndHighlight(option.key);
  } else {
    updateOverlayRowLabel();
  }
}

function cycleMonochromeColor(step) {
  if (!colorControlsEnabled) return;
  monochromeColorIndex = (monochromeColorIndex + step + monochromeColorOptions.length) % monochromeColorOptions.length;
  updateMonochromeColorRow();
}

function applyMonochromeTint(color) {
  pendingMonochromeTint.copy(color);
  if (overlayManager) {
    const tintClone = color.clone();
    overlayManager.mutateOverlay('monochrome', instance => {
      if (typeof instance.setTint === 'function') {
        instance.setTint(tintClone);
      } else if (instance.pass?.material?.uniforms?.tint) {
        instance.pass.material.uniforms.tint.value.copy(tintClone);
      }
    });
  }
}

function applyPendingMonochromeTint() {
  applyMonochromeTint(pendingMonochromeTint.clone());
}

function updateMonochromeColorRow() {
  if (!monochromeColorRowMesh) return;
  const option = monochromeColorOptions[monochromeColorIndex];
  const valueLabel = colorControlsEnabled ? option.label : 'LOCKED';
  const newTexture = createOptionsRowTexture('CRT COLOR', valueLabel.toUpperCase(), colorControlsEnabled);
  if (monochromeColorRowMesh.material.map) {
    monochromeColorRowMesh.material.map.dispose();
  }
  monochromeColorRowMesh.material.map = newTexture;
  monochromeColorRowMesh.material.needsUpdate = true;
  if (colorControlsEnabled) {
    applyMonochromeTint(option.color.clone());
  }
}

function updateColorRowState() {
  const opacity = colorControlsEnabled ? 1.0 : 0.35;
  if (monochromeColorRowMesh) {
    monochromeColorRowMesh.material.opacity = opacity;
    monochromeColorRowMesh.material.transparent = opacity < 1;
    monochromeColorRowMesh.material.needsUpdate = true;
  }
  const arrows = [colorLeftArrow, colorRightArrow];
  arrows.forEach(arrow => {
    if (!arrow) return;
    arrow.material.opacity = colorControlsEnabled ? 1.0 : 0.2;
    arrow.material.transparent = arrow.material.opacity < 1;
    arrow.userData.hoverScale = colorControlsEnabled ? 1.12 : 1.0;
    arrow.material.needsUpdate = true;
  });
  updateMonochromeColorRow();
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

function createEmbeddedDemoStatusTexture(title = 'LOADING DEMO', subtitle = 'WAITING FOR CANVAS') {
  const width = 2048;
  const height = 1024;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = '#020202';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#5f5f5f';
  ctx.lineWidth = 18;
  ctx.strokeRect(18, 18, width - 36, height - 36);
  ctx.fillStyle = '#f0f0f0';
  ctx.font = '600 142px "IBM Plex Mono", "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, width / 2, height * 0.44, width * 0.86);
  ctx.fillStyle = '#8d8d8d';
  ctx.font = '500 72px "IBM Plex Mono", "Courier New", monospace';
  ctx.fillText(subtitle, width / 2, height * 0.60, width * 0.86);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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

function createMenuButtonTexture(text = 'VIEW RESUME', { active = false } = {}) {
  const width = 1536;
  const height = 512;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = active ? '#1a1a1a' : '#101010';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = active ? '#ffffff' : '#6f6f6f';
  ctx.lineWidth = active ? 22 : 16;
  const inset = active ? 5 : 8;
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
  ctx.fillStyle = active ? '#f0f0f0' : '#dcdcdc';
  ctx.font = '600 200px "IBM Plex Mono", "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createProjectButtonTexture(title = 'DEMO', subtitle = '/research/demo/') {
  const width = 2048;
  const height = 420;
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');
  ctx.fillStyle = '#090909';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#7f7f7f';
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, width - 12, height - 12);
  ctx.fillStyle = '#f2f2f2';
  ctx.font = '600 112px "IBM Plex Mono", "Courier New", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, width * 0.08, height * 0.42, width * 0.84);
  ctx.fillStyle = '#8a8a8a';
  ctx.font = '500 54px "IBM Plex Mono", "Courier New", monospace';
  ctx.fillText(subtitle, width * 0.08, height * 0.70, width * 0.84);
  const texture = new THREE.CanvasTexture(canvasEl);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMenuLogoTexture() {
  return createBootTitleTexture('SEVASTOLINK', 'AN LM-LINK PRODUCT');
}

const canvas = document.getElementById('crt-canvas');
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;
canvas.style.width = `${CANVAS_WIDTH}px`;
canvas.style.height = `${CANVAS_HEIGHT}px`;
canvas.style.aspectRatio = `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setPixelRatio(1);
renderer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02050b);

const camera = new THREE.PerspectiveCamera(48, CANVAS_ASPECT, 0.1, 100);
camera.position.set(0, 0, 6);
const clock = new THREE.Clock();

const shaderParamsByProfile = {
  multicolor: { ...DEFAULT_MULTICOLOR_CRT_PARAMS },
  monochrome: { ...DEFAULT_MONOCHROME_CRT_PARAMS }
};

const transitionConfig = {
  duration: 0.28,
  travel: desktopLayout.height * 1.05,
  squeeze: 0.06,
  widen: 0.02,
  brightnessDip: 0.18,
  jitter: 0.012
};

const debugTweakState = {
  cameraX: 0,
  cameraY: 0,
  cameraZ: 6,
  cameraFov: 48,
  exposure: 1.0,
  bloomStrength: 1.75,
  bloomRadius: 0,
  bloomThreshold: 0,
  crtProfile: DEFAULT_OVERLAY_KEY,
  monochromeTint: monochromeColorOptions[monochromeColorIndex].label,
  crtResDiv: shaderParamsByProfile[DEFAULT_OVERLAY_KEY].resDiv,
  crtScanHard: shaderParamsByProfile[DEFAULT_OVERLAY_KEY].hardScan,
  crtPixHard: shaderParamsByProfile[DEFAULT_OVERLAY_KEY].hardPix,
  crtWarpX: shaderParamsByProfile[DEFAULT_OVERLAY_KEY].warpX,
  crtWarpY: shaderParamsByProfile[DEFAULT_OVERLAY_KEY].warpY,
  crtMaskDark: shaderParamsByProfile[DEFAULT_OVERLAY_KEY].maskDark,
  crtMaskLight: shaderParamsByProfile[DEFAULT_OVERLAY_KEY].maskLight,
  crtPhosphor: shaderParamsByProfile[DEFAULT_OVERLAY_KEY].phosphorAmount
};

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
const screenProjects = new THREE.Group();
const screenDemo = new THREE.Group();
const screenDocs = new THREE.Group();
const screenSettings = new THREE.Group();
screenRoot.add(screenBoot, screenDesktop, screenCube, screenProjects, screenDemo, screenDocs, screenSettings);
screenDesktop.position.set(0, 0, 0);
screenDesktop.scale.setScalar(1);
const screenGroups = {
  boot: screenBoot,
  desktop: screenDesktop,
  cube: screenCube,
  projects: screenProjects,
  demo: screenDemo,
  docs: screenDocs,
  settings: screenSettings
};
const transitionState = {
  active: false,
  from: null,
  to: null,
  progress: 0,
  direction: 1
};

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

const backButtonMargin = new THREE.Vector2(0.65, 0.25);

// Back icon factory
function makeBackIcon(targetScreen = 'desktop', position) {
  const tex = createBackButtonTexture('BACK');
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const geo = new THREE.PlaneGeometry(1.4, 0.55);
  const mesh = new THREE.Mesh(geo, mat);

  const defaultPosition = new THREE.Vector3(
    -desktopLayout.width / 2 + backButtonMargin.x,
    desktopLayout.height / 2 - backButtonMargin.y,
    0
  );

  mesh.position.copy(position ?? defaultPosition);
  mesh.userData.onClick = () => setActiveScreen(targetScreen);
  mesh.userData.baseScale = 1;
  mesh.userData.hoverScale = 1.05;
  pickables.push(mesh);
  return mesh;
}

// ----- Desktop screen (main menu layout) -----
const menuHeader = new THREE.Mesh(
  createLayoutPlane(0.95, 0.06),
  new THREE.MeshBasicMaterial({ map: createMenuHeaderTexture(), transparent: true })
);
setLayoutPosition(menuHeader, 0.5, 0.08, 0);
screenDesktop.add(menuHeader);

const foldersLabelMesh = new THREE.Mesh(
  createLayoutPlane(0.24, 0.08),
  new THREE.MeshBasicMaterial({ map: createMenuSectionLabelTexture('FOLDERS'), transparent: true, opacity: 0.75 })
);
setLayoutPosition(foldersLabelMesh, 0.17, 0.33, 0);
screenDesktop.add(foldersLabelMesh);

const menuButtonDefs = [
  { label: 'VIEW RESUME', target: 'docs' },
  { label: 'OPTIONS', target: 'settings' },
  { label: 'PROJECTS', target: 'projects' },
  { label: 'QUIT', target: 'boot' }
];

const menuButtonSize = { w: 0.24, h: 0.12 };
const menuButtonColumnX = 0.17;
const menuButtonTopY = 0.45;
const menuButtonGap = 0.01;

menuButtonDefs.forEach((def, index) => {
  const y = menuButtonTopY + index * (menuButtonSize.h + menuButtonGap);
  const button = makeMenuButton({
    label: def.label,
    positionPercent: { x: menuButtonColumnX, y },
    sizePercent: menuButtonSize,
    onClick: () => setActiveScreen(def.target),
    active: !!def.active
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

rebuildLayoutCorners(screenDesktop);

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

// ----- Projects screen (research demo launcher)
const projectDemos = [
  { title: 'LIGHT MASK LAB', path: '/research/light-mask-lab/' },
  { title: 'OCEAN REFLECTION', path: '/research/ocean-light-reflection-lab/' },
  { title: 'HEAT WALL', path: '/research/heat-wall/' },
  { title: 'TOON DEMO', path: '/research/toon-demo/' },
  { title: 'METABALL STREAM', path: '/research/metaball-demo/' },
  { title: 'ISLAND STYLE', path: '/research/primary-island-style/' },
  { title: 'PROCEDURAL ISLAND', path: '/research/procedural-island/' }
];

const projectsHeader = new THREE.Mesh(
  createLayoutPlane(0.72, 0.08),
  new THREE.MeshBasicMaterial({ map: createMenuHeaderTexture('DEMO ARCHIVE'), transparent: true })
);
setLayoutPosition(projectsHeader, 0.56, 0.08, 0);
screenProjects.add(projectsHeader, makeBackIcon('desktop'));

const projectsHint = new THREE.Mesh(
  createLayoutPlane(0.5, 0.055),
  new THREE.MeshBasicMaterial({ map: createMenuSectionLabelTexture('SELECT A DEMO'), transparent: true, opacity: 0.7 })
);
setLayoutPosition(projectsHint, 0.37, 0.22, 0);
screenProjects.add(projectsHint);

function ensureEmbeddedDemoIframe() {
  if (embeddedDemoState.iframe) return embeddedDemoState.iframe;
  const iframe = document.createElement('iframe');
  iframe.title = 'Embedded research demo';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = `${CANVAS_WIDTH}px`;
  iframe.style.height = `${CANVAS_HEIGHT}px`;
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.onload = () => {
    embeddedDemoState.sourceCanvas = null;
    embeddedDemoState.retryUntil = performance.now() + 8000;
    attachEmbeddedDemoCanvas();
  };
  document.body.appendChild(iframe);
  embeddedDemoState.iframe = iframe;
  return iframe;
}

function attachEmbeddedDemoCanvas() {
  const iframe = embeddedDemoState.iframe;
  let sourceCanvas = null;
  try {
    sourceCanvas = iframe?.contentDocument?.querySelector('canvas') || null;
  } catch {
    sourceCanvas = null;
  }
  if (!sourceCanvas) return false;
  if (embeddedDemoState.sourceCanvas === sourceCanvas && embeddedDemoState.texture) return true;

  embeddedDemoState.sourceCanvas = sourceCanvas;
  installSyntheticPointerCaptureShim(sourceCanvas);
  const compositeCanvas = ensureEmbeddedCompositeCanvas(sourceCanvas.width || CANVAS_WIDTH, sourceCanvas.height || CANVAS_HEIGHT);
  embeddedDemoState.texture?.dispose?.();
  const texture = new THREE.CanvasTexture(compositeCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  embeddedDemoState.texture = texture;
  if (embeddedDemoState.material) {
    embeddedDemoState.material.map?.dispose?.();
    embeddedDemoState.material.map = texture;
    embeddedDemoState.material.needsUpdate = true;
  }
  return true;
}

function updateEmbeddedDemoTexture() {
  if (!embeddedDemoState.iframe || activeScreen !== 'demo') return;
  if (!embeddedDemoState.sourceCanvas && performance.now() < embeddedDemoState.retryUntil) {
    attachEmbeddedDemoCanvas();
  }
  if (embeddedDemoState.texture && embeddedDemoState.sourceCanvas && embeddedDemoState.compositeContext) {
    const canvas = embeddedDemoState.compositeCanvas;
    if (canvas.width !== embeddedDemoState.sourceCanvas.width || canvas.height !== embeddedDemoState.sourceCanvas.height) {
      ensureEmbeddedCompositeCanvas(embeddedDemoState.sourceCanvas.width, embeddedDemoState.sourceCanvas.height);
    }
    const ctx = embeddedDemoState.compositeContext;
    const width = embeddedDemoState.compositeCanvas.width;
    const height = embeddedDemoState.compositeCanvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(embeddedDemoState.sourceCanvas, 0, 0, width, height);
    drawEmbeddedGuiOverlay(ctx, width, height);
    embeddedDemoState.texture.needsUpdate = true;
  }
}

function forwardEmbeddedDemoPointer(kind, event) {
  if (activeScreen !== 'demo' || !embeddedDemoState.sourceCanvas || !embeddedDemoState.plane) return false;
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObject(embeddedDemoState.plane, false)[0];
  if (!hit?.uv) return false;

  const targetCanvas = embeddedDemoState.sourceCanvas;
  const targetWindow = embeddedDemoState.iframe?.contentWindow || window;
  const rect = targetCanvas.getBoundingClientRect();
  const canvasWidth = embeddedDemoState.compositeCanvas?.width || targetCanvas.width || rect.width || CANVAS_WIDTH;
  const canvasHeight = embeddedDemoState.compositeCanvas?.height || targetCanvas.height || rect.height || CANVAS_HEIGHT;
  const viewX = hit.uv.x * canvasWidth;
  const viewY = (1 - hit.uv.y) * canvasHeight;
  const x = rect.left + hit.uv.x * rect.width;
  const y = rect.top + (1 - hit.uv.y) * rect.height;

  if (embeddedDemoState.guiPointerRegion || kind === 'pointerdown' || kind === 'click') {
    if (kind === 'click' && embeddedDemoState.suppressNextGuiClick) {
      embeddedDemoState.suppressNextGuiClick = false;
      return true;
    }
    const guiRegion = embeddedDemoState.guiPointerRegion || findEmbeddedGuiRegion(viewX, viewY);
    if (guiRegion) {
      if (kind === 'pointerdown') {
        embeddedDemoState.guiPointerRegion = guiRegion;
        embeddedDemoState.suppressNextGuiClick = true;
      }
      dispatchEmbeddedGuiChange(guiRegion, kind, viewX, viewY);
      if (kind === 'pointerup' || kind === 'pointerleave' || kind === 'click') {
        embeddedDemoState.guiPointerRegion = null;
      }
      return true;
    }
    const guiHit = findEmbeddedGuiElementAt(viewX, viewY, canvasWidth, canvasHeight);
    if (guiHit) {
      if (kind === 'pointerdown') {
        embeddedDemoState.guiPointerRegion = guiHit.canvasRegion;
        embeddedDemoState.suppressNextGuiClick = true;
      }
      dispatchEmbeddedGuiDomFallback(guiHit, kind);
      return true;
    }
  }

  if (kind === 'wheel') {
    targetCanvas.dispatchEvent(new targetWindow.WheelEvent('wheel', {
      clientX: x,
      clientY: y,
      deltaX: event.deltaX ?? 0,
      deltaY: event.deltaY ?? 0,
      bubbles: true,
      cancelable: true
    }));
    return true;
  }

  if (kind === 'click') {
    targetCanvas.dispatchEvent(new targetWindow.MouseEvent('click', {
      clientX: x,
      clientY: y,
      button: event.button ?? 0,
      bubbles: true,
      cancelable: true
    }));
    return true;
  }

  const buttons = kind === 'pointermove' && embeddedDemoState.pointerActive
    ? (embeddedDemoState.pointerButtons || 1)
    : (event.buttons ?? embeddedDemoState.pointerButtons ?? 0);
  const pointerId = embeddedDemoState.pointerId || event.pointerId || 1;
  const PointerCtor = targetWindow.PointerEvent || window.PointerEvent || MouseEvent;
  targetCanvas.dispatchEvent(new PointerCtor(kind, {
    clientX: x,
    clientY: y,
    button: event.button ?? 0,
    buttons,
    pointerId,
    pointerType: event.pointerType || 'mouse',
    bubbles: true,
    cancelable: true
  }));
  const mouseType = {
    pointerdown: 'mousedown',
    pointermove: 'mousemove',
    pointerup: 'mouseup'
  }[kind];
  if (mouseType) {
    targetCanvas.dispatchEvent(new targetWindow.MouseEvent(mouseType, {
      clientX: x,
      clientY: y,
      button: event.button ?? 0,
      buttons,
      bubbles: true,
      cancelable: true
    }));
  }
  return true;
}

function openDemoPath(path, title = 'DEMO') {
  if (!path) return;
  embeddedDemoState.activePath = path;
  embeddedDemoState.activeTitle = title;
  embeddedDemoState.sourceCanvas = null;
  embeddedDemoState.retryUntil = performance.now() + 8000;
  if (embeddedDemoState.material) {
    embeddedDemoState.texture?.dispose?.();
    const loadingTexture = createEmbeddedDemoStatusTexture('LOADING DEMO', path);
    embeddedDemoState.texture = loadingTexture;
    embeddedDemoState.material.map?.dispose?.();
    embeddedDemoState.material.map = loadingTexture;
    embeddedDemoState.material.needsUpdate = true;
  }
  const iframe = ensureEmbeddedDemoIframe();
  iframe.src = path;
  setActiveScreen('demo');
}

function makeProjectButton({ demo, column, row }) {
  const widthPercent = 0.40;
  const heightPercent = 0.105;
  const columnX = column === 0 ? 0.285 : 0.715;
  const y = 0.35 + row * 0.13;
  const texture = createProjectButtonTexture(demo.title, demo.path);
  const mesh = new THREE.Mesh(
    createLayoutPlane(widthPercent, heightPercent),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true })
  );
  setLayoutPosition(mesh, columnX, y, 0);
  mesh.userData.onClick = () => openDemoPath(demo.path, demo.title);
  mesh.userData.baseScale = 1;
  mesh.userData.hoverScale = 1.035;
  screenProjects.add(mesh);
  pickables.push(mesh);
  return mesh;
}

projectDemos.forEach((demo, index) => {
  const column = index % 2;
  const row = Math.floor(index / 2);
  makeProjectButton({ demo, column, row });
});

rebuildLayoutCorners(screenProjects);

// ----- Embedded demo screen
const embeddedDemoBack = makeBackIcon('projects');
screenDemo.add(embeddedDemoBack);

embeddedDemoState.material = new THREE.MeshBasicMaterial({
  map: createEmbeddedDemoStatusTexture('SELECT A DEMO', 'PROJECTS > DEMO ARCHIVE'),
  transparent: true,
  depthTest: false
});
embeddedDemoState.plane = new THREE.Mesh(
  createLayoutPlane(0.92, 0.76),
  embeddedDemoState.material
);
setLayoutPosition(embeddedDemoState.plane, 0.5, 0.55, -0.02);
screenDemo.add(embeddedDemoState.plane);

rebuildLayoutCorners(screenDemo);

// ----- Docs screen (resume viewer)
const resumePlaneMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 1, map: createLabelTexture('Loading Resume...') });
const resumePlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), resumePlaneMaterial);
resumePlane.position.set(0, 0, 0);
screenDocs.add(resumePlane, makeBackIcon('desktop'));

const resumePath = './docs/resume.pdf';
resumeState.zoom = 1;
resumeState.offset.set(0, 0);
resumeState.aspect = 1;
resumeState.panActive = false;
resumeState.ignoreClick = false;

loadPdfTexture(resumePath).then(({ texture, aspect }) => {
  resumePlaneMaterial.map?.dispose();
  resumePlaneMaterial.map = texture;
  resumePlaneMaterial.needsUpdate = true;
  resumeState.aspect = aspect;
  const margin = 0.98;
  const maxWidth = desktopLayout.width * margin;
  const maxHeight = desktopLayout.height * margin;
  const baseWidth = Math.min(maxWidth, maxHeight * resumeState.aspect);
  const fitZoom = baseWidth > 0 ? maxWidth / baseWidth : 1;
  resumeState.zoom = THREE.MathUtils.clamp(fitZoom, resumeState.minZoom, resumeState.maxZoom);
  resumeState.defaultZoom = resumeState.zoom;
  resumeState.minZoom = Math.min(resumeState.defaultZoom * resumeMinZoomFactor, resumeState.defaultZoom);
  resumeState.zoom = Math.max(resumeState.zoom, resumeState.minZoom);
  resumeState.offset.set(0, 0);
  fitResumeToViewport();
  if (activeScreen === 'docs') {
    renderer.domElement.style.cursor = resumeCanPan() ? 'grab' : 'default';
  }
}).catch((err) => {
  console.error('Failed to load resume PDF', err);
  resumePlaneMaterial.map = createLabelTexture('Resume Unavailable');
  resumePlaneMaterial.needsUpdate = true;
  resumeState.aspect = 1;
  resumeState.zoom = resumeState.defaultZoom = 1;
  resumeState.offset.set(0, 0);
  const fallbackWidth = desktopLayout.width * 0.8;
  const fallbackHeight = desktopLayout.height * 0.6;
  resumeState.size.set(fallbackWidth, fallbackHeight);
  resumePlane.scale.set(fallbackWidth, fallbackHeight, 1);
  resumePlane.position.set(0, 0, 0);
  fitResumeToViewport();
  if (activeScreen === 'docs') {
    renderer.domElement.style.cursor = resumeCanPan() ? 'grab' : 'default';
  }
});

function fitResumeToViewport() {
  const margin = 0.98;
  const maxWidth = desktopLayout.width * margin;
  const maxHeight = desktopLayout.height * margin;
  const baseWidth = Math.min(maxWidth, maxHeight * resumeState.aspect);
  resumeState.zoom = THREE.MathUtils.clamp(resumeState.zoom, resumeState.minZoom, resumeState.maxZoom);
  const width = baseWidth * resumeState.zoom;
  const height = width / resumeState.aspect;
  resumeState.size.set(width, height);
  resumePlane.scale.set(width, height, 1);

  const maxOffsetX = Math.max(0, (width - desktopLayout.width) / 2);
  const maxOffsetY = Math.max(0, (height - desktopLayout.height) / 2);
  resumeState.offset.x = THREE.MathUtils.clamp(resumeState.offset.x, -maxOffsetX, maxOffsetX);
  resumeState.offset.y = THREE.MathUtils.clamp(resumeState.offset.y, -maxOffsetY, maxOffsetY);
  resumePlane.position.set(resumeState.offset.x, resumeState.offset.y, 0);
}

const resumeCanPan = () => resumeState.size.x > desktopLayout.width * 1.01 || resumeState.size.y > desktopLayout.height * 1.01;

function applyCanvasDimensions() {
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  canvas.style.width = `${CANVAS_WIDTH}px`;
  canvas.style.height = `${CANVAS_HEIGHT}px`;
  canvas.style.aspectRatio = `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`;
  renderSize.set(CANVAS_WIDTH, CANVAS_HEIGHT);
  renderer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT, false);
  composer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT);
  camera.aspect = CANVAS_ASPECT;
  camera.updateProjectionMatrix();
}

// ----- Settings screen (options menu)
const settingsBackButton = makeBackIcon('desktop');
screenSettings.add(settingsBackButton);

const optionsRoot = new THREE.Group();
screenSettings.add(optionsRoot);

const optionsSidebar = new THREE.Mesh(
  createLayoutPlane(0.28, 0.72),
  new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.55 })
);
setLayoutPosition(optionsSidebar, 0.19, 0.6, -0.05);
optionsRoot.add(optionsSidebar);

const optionTabs = [
  { label: 'DISPLAY', y: 0.52, active: true }
];
optionTabs.forEach((tab) => {
  const tabMesh = new THREE.Mesh(
    createLayoutPlane(0.24, 0.09),
    new THREE.MeshBasicMaterial({ map: createOptionsTabTexture(tab.label, tab.active), transparent: true })
  );
  setLayoutPosition(tabMesh, 0.19, tab.y, 0.01);
  optionsRoot.add(tabMesh);
});

const optionsContentPanel = new THREE.Mesh(
  createLayoutPlane(0.62, 0.64),
  new THREE.MeshBasicMaterial({ color: 0x030303, transparent: true, opacity: 0.82 })
);
setLayoutPosition(optionsContentPanel, 0.63, 0.6, -0.06);
optionsRoot.add(optionsContentPanel);

const rowWidth = desktopLayout.width * 0.6;
const rowHeight = desktopLayout.height * 0.09;

const overlayRowGroup = new THREE.Group();
setLayoutPosition(overlayRowGroup, 0.64, 0.50, 0.02);
optionsRoot.add(overlayRowGroup);
overlayRowMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(rowWidth, rowHeight),
  new THREE.MeshBasicMaterial({ map: createOptionsRowTexture('CRT PROFILE', OVERLAY_OPTIONS[overlayOptionIndex]?.label?.toUpperCase() ?? 'UNKNOWN', true), transparent: true })
);
overlayRowGroup.add(overlayRowMesh);

const overlayArrowSize = rowHeight * 0.42;
const overlayValueCenterOffset = rowWidth * (optionsRowMetrics.valueCenter - 0.5);
const overlayArrowOffset = optionsRowMetrics.valueHalfSpan * rowWidth;
const overlayLeftArrow = createArrowMesh('left', overlayArrowSize, overlayArrowSize);
overlayLeftArrow.position.set(overlayValueCenterOffset - overlayArrowOffset, 0, 0.03);
overlayLeftArrow.userData.onClick = () => cycleOverlayMode(-1);
overlayLeftArrow.userData.baseScale = 1;
overlayLeftArrow.userData.hoverScale = 1.12;
overlayRowGroup.add(overlayLeftArrow);
pickables.push(overlayLeftArrow);

const overlayRightArrow = createArrowMesh('right', overlayArrowSize, overlayArrowSize);
overlayRightArrow.position.set(overlayValueCenterOffset + overlayArrowOffset, 0, 0.03);
overlayRightArrow.userData.onClick = () => cycleOverlayMode(1);
overlayRightArrow.userData.baseScale = 1;
overlayRightArrow.userData.hoverScale = 1.12;
overlayRowGroup.add(overlayRightArrow);
pickables.push(overlayRightArrow);

const colorRowGroup = new THREE.Group();
setLayoutPosition(colorRowGroup, 0.64, 0.66, 0.02);
optionsRoot.add(colorRowGroup);
monochromeColorRowMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(rowWidth, rowHeight),
  new THREE.MeshBasicMaterial({ map: createOptionsRowTexture('CRT COLOR', monochromeColorOptions[monochromeColorIndex].label.toUpperCase(), colorControlsEnabled), transparent: true, opacity: colorControlsEnabled ? 1 : 0.35 })
);
colorRowGroup.add(monochromeColorRowMesh);

const colorArrowSize = rowHeight * 0.42;
const colorValueCenterOffset = rowWidth * (optionsRowMetrics.valueCenter - 0.5);
const colorArrowOffset = optionsRowMetrics.valueHalfSpan * rowWidth;
const colorLeftArrow = createArrowMesh('left', colorArrowSize, colorArrowSize);
colorLeftArrow.position.set(colorValueCenterOffset - colorArrowOffset, 0, 0.03);
colorLeftArrow.userData.onClick = () => cycleMonochromeColor(-1);
colorLeftArrow.userData.baseScale = 1;
colorLeftArrow.userData.hoverScale = colorControlsEnabled ? 1.12 : 1.0;
colorRowGroup.add(colorLeftArrow);
pickables.push(colorLeftArrow);

const colorRightArrow = createArrowMesh('right', colorArrowSize, colorArrowSize);
colorRightArrow.position.set(colorValueCenterOffset + colorArrowOffset, 0, 0.03);
colorRightArrow.userData.onClick = () => cycleMonochromeColor(1);
colorRightArrow.userData.baseScale = 1;
colorRightArrow.userData.hoverScale = colorControlsEnabled ? 1.12 : 1.0;
colorRowGroup.add(colorRightArrow);
pickables.push(colorRightArrow);

updateOverlayRowLabel();
updateColorRowState();

// ----- Active screen state + router -----
const transitionOverlay = new THREE.Mesh(
  new THREE.PlaneGeometry(desktopLayout.width * 1.18, desktopLayout.height * 1.18),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false })
);
transitionOverlay.position.set(0, 0, 0.4);
transitionOverlay.visible = false;
screenRoot.add(transitionOverlay);

const transitionLineCanvas = document.createElement('canvas');
transitionLineCanvas.width = 768;
transitionLineCanvas.height = 512;
const transitionLineContext = transitionLineCanvas.getContext('2d');
const transitionLineTexture = new THREE.CanvasTexture(transitionLineCanvas);
transitionLineTexture.colorSpace = THREE.SRGBColorSpace;
transitionLineTexture.needsUpdate = true;
const transitionLineOverlay = new THREE.Mesh(
  new THREE.PlaneGeometry(desktopLayout.width * 1.18, desktopLayout.height * 1.18),
  new THREE.MeshBasicMaterial({
    map: transitionLineTexture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    blending: THREE.AdditiveBlending
  })
);
transitionLineOverlay.position.set(0, 0, 0.41);
transitionLineOverlay.visible = false;
screenRoot.add(transitionLineOverlay);

function resetScreenTransform(group) {
  if (!group) return;
  group.position.set(0, 0, 0);
  group.scale.set(1, 1, 1);
}

function getScreenGroup(name) {
  return screenGroups[name] ?? null;
}

function getTransitionDirection(from, to) {
  if (from === 'desktop' && to !== 'desktop') return 1;
  if (from !== 'desktop' && to === 'desktop') return -1;
  if (from === 'boot' && to !== 'boot') return 1;
  if (from !== 'boot' && to === 'boot') return -1;
  return 1;
}

function finalizeScreenState(name) {
  activeScreen = name;
  Object.entries(screenGroups).forEach(([key, group]) => {
    resetScreenTransform(group);
    group.visible = key === name;
  });
  screenRoot.position.set(0, 0, 0);
  transitionOverlay.visible = false;
  transitionOverlay.material.opacity = 0;
  transitionLineOverlay.visible = false;
  transitionLineOverlay.material.opacity = 0;
  let targetGroup = null;
  if (name === 'desktop') targetGroup = screenDesktop;
  else if (name === 'cube') targetGroup = screenCube;
  else if (name === 'projects') targetGroup = screenProjects;
  else if (name === 'demo') targetGroup = screenDemo;
  else if (name === 'docs') targetGroup = screenDocs;
  else if (name === 'settings') targetGroup = screenSettings;
  if (name === 'boot') {
    resetBootSequence();
  }
  if (name === 'docs') {
    fitResumeToViewport();
    renderer.domElement.style.cursor = resumeCanPan() ? 'grab' : 'default';
  } else {
    resumeState.panActive = false;
    resumeState.ignoreClick = false;
    renderer.domElement.style.cursor = 'default';
  }
  setPickablesFrom(targetGroup);
}

function updateTransitionLineOverlay(progress) {
  const ctx = transitionLineContext;
  const width = transitionLineCanvas.width;
  const height = transitionLineCanvas.height;
  ctx.clearRect(0, 0, width, height);
  if (!transitionLineOverlay.visible) return;
  const lineCount = Math.round(10 + progress * 12);
  for (let index = 0; index < lineCount; index += 1) {
    const y = Math.random() * height;
    const thickness = 1 + Math.floor(Math.random() * 3);
    const alpha = 0.18 + Math.random() * 0.28;
    const brightness = 240 + Math.floor(Math.random() * 16);
    const leftInset = Math.random() * width * 0.08;
    const rightInset = Math.random() * width * 0.08;
    const gradient = ctx.createLinearGradient(leftInset, y, width - rightInset, y);
    gradient.addColorStop(0, `rgba(${brightness},${brightness},${brightness},0)`);
    gradient.addColorStop(0.08 + Math.random() * 0.16, `rgba(${brightness},${brightness},${brightness},${alpha})`);
    gradient.addColorStop(0.92 - Math.random() * 0.16, `rgba(${brightness},${brightness},${brightness},${alpha * 0.92})`);
    gradient.addColorStop(1, `rgba(${brightness},${brightness},${brightness},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(leftInset, y, width - leftInset - rightInset, thickness);
  }
  transitionLineTexture.needsUpdate = true;
}

let activeScreen = 'boot';
function setActiveScreen(name) {
  if (transitionState.active || name === activeScreen) return;
  const fromGroup = getScreenGroup(activeScreen);
  const toGroup = getScreenGroup(name);
  if (!fromGroup || !toGroup) {
    finalizeScreenState(name);
    return;
  }
  if (name === 'boot') {
    resetBootSequence();
  }
  resetScreenTransform(fromGroup);
  resetScreenTransform(toGroup);
  Object.values(screenGroups).forEach((group) => {
    if (group !== fromGroup && group !== toGroup) {
      group.visible = false;
      resetScreenTransform(group);
    }
  });
  fromGroup.visible = true;
  toGroup.visible = true;
  transitionState.active = true;
  transitionState.from = activeScreen;
  transitionState.to = name;
  transitionState.progress = 0;
  transitionState.direction = getTransitionDirection(activeScreen, name);
  resumeState.panActive = false;
  resumeState.ignoreClick = false;
  transitionOverlay.visible = true;
  transitionOverlay.material.opacity = 0;
  transitionLineOverlay.visible = true;
  transitionLineOverlay.material.opacity = 0;
  updateTransitionLineOverlay(0);
  renderer.domElement.style.cursor = 'default';
  setPickablesFrom(null);
}
finalizeScreenState('boot');
const renderSize = new THREE.Vector2(CANVAS_WIDTH, CANVAS_HEIGHT);
const composer = new EffectComposer(renderer);
composer.setSize(renderSize.x, renderSize.y);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(new THREE.Vector2(CANVAS_WIDTH, CANVAS_HEIGHT), 1.75, 0, 0);
bloomPass.renderToScreen = true;
composer.addPass(bloomPass);

applyCanvasDimensions();

overlayManager = createOverlayManager({
  composer,
  bloomPass,
  initialSize: renderSize.clone()
});
setOverlayAndHighlight(DEFAULT_OVERLAY_KEY);
applyPendingMonochromeTint();
fitResumeToViewport();

function applyDebugCameraTweaks() {
  camera.position.set(debugTweakState.cameraX, debugTweakState.cameraY, debugTweakState.cameraZ);
  camera.fov = debugTweakState.cameraFov;
  camera.updateProjectionMatrix();
}

function applyDebugExposureTweak() {
  renderer.toneMappingExposure = debugTweakState.exposure;
}

function applyDebugBloomTweaks() {
  bloomPass.strength = debugTweakState.bloomStrength;
  bloomPass.radius = debugTweakState.bloomRadius;
  bloomPass.threshold = debugTweakState.bloomThreshold;
}

function applyDebugOverlayTweak() {
  setOverlayAndHighlight(debugTweakState.crtProfile);
}

function applyDebugMonochromeTintTweak() {
  const nextIndex = monochromeColorOptions.findIndex(option => option.label === debugTweakState.monochromeTint);
  monochromeColorIndex = nextIndex >= 0 ? nextIndex : 0;
  updateMonochromeColorRow();
}

function syncShaderStateFromProfile(profileKey) {
  const params = shaderParamsByProfile[profileKey] ?? shaderParamsByProfile.multicolor;
  debugTweakState.crtResDiv = params.resDiv;
  debugTweakState.crtScanHard = params.hardScan;
  debugTweakState.crtPixHard = params.hardPix;
  debugTweakState.crtWarpX = params.warpX;
  debugTweakState.crtWarpY = params.warpY;
  debugTweakState.crtMaskDark = params.maskDark;
  debugTweakState.crtMaskLight = params.maskLight;
  debugTweakState.crtPhosphor = params.phosphorAmount;
  shaderControllers.forEach((controller) => controller.updateDisplay());
}

function applyDebugShaderTweaks() {
  const profileKey = debugTweakState.crtProfile;
  const params = shaderParamsByProfile[profileKey] ?? shaderParamsByProfile.multicolor;
  params.resDiv = debugTweakState.crtResDiv;
  params.hardScan = debugTweakState.crtScanHard;
  params.hardPix = debugTweakState.crtPixHard;
  params.warpX = debugTweakState.crtWarpX;
  params.warpY = debugTweakState.crtWarpY;
  params.maskDark = debugTweakState.crtMaskDark;
  params.maskLight = debugTweakState.crtMaskLight;
  params.phosphorAmount = debugTweakState.crtPhosphor;
  if (overlayManager) {
    overlayManager.mutateOverlay(profileKey, (instance) => {
      if (typeof instance.setParams === 'function') {
        instance.setParams(params);
      }
    });
  }
}

applyDebugCameraTweaks();
applyDebugExposureTweak();
applyDebugBloomTweaks();
applyDebugOverlayTweak();
applyDebugMonochromeTintTweak();
syncShaderStateFromProfile(debugTweakState.crtProfile);
applyDebugShaderTweaks();

const gui = new GUI({ title: 'CRT Demo' });
gui.close();

const cameraFolder = gui.addFolder('Camera');
cameraFolder.add(debugTweakState, 'cameraX', -6, 6, 0.01).name('X').onChange(applyDebugCameraTweaks);
cameraFolder.add(debugTweakState, 'cameraY', -6, 6, 0.01).name('Y').onChange(applyDebugCameraTweaks);
cameraFolder.add(debugTweakState, 'cameraZ', 2, 12, 0.01).name('Z').onChange(applyDebugCameraTweaks);
cameraFolder.add(debugTweakState, 'cameraFov', 20, 90, 0.1).name('FOV').onChange(applyDebugCameraTweaks);

const renderFolder = gui.addFolder('Render');
renderFolder.add(debugTweakState, 'exposure', 0.2, 2.5, 0.01).name('Exposure').onChange(applyDebugExposureTweak);

const bloomFolder = gui.addFolder('Bloom');
bloomFolder.add(debugTweakState, 'bloomStrength', 0, 3, 0.01).name('Strength').onChange(applyDebugBloomTweaks);
bloomFolder.add(debugTweakState, 'bloomRadius', 0, 1, 0.01).name('Radius').onChange(applyDebugBloomTweaks);
bloomFolder.add(debugTweakState, 'bloomThreshold', 0, 1, 0.01).name('Threshold').onChange(applyDebugBloomTweaks);

const crtFolder = gui.addFolder('CRT');
crtFolder
  .add(debugTweakState, 'crtProfile', OVERLAY_OPTIONS.reduce((acc, option) => {
    acc[option.label] = option.key;
    return acc;
  }, {}))
  .name('Profile')
  .onChange(applyDebugOverlayTweak);
crtFolder
  .add(debugTweakState, 'monochromeTint', monochromeColorOptions.map(option => option.label))
  .name('Mono Tint')
  .onChange(applyDebugMonochromeTintTweak);

const crtShaderFolder = gui.addFolder('CRT Shader');
shaderControllers = [
  crtShaderFolder.add(debugTweakState, 'crtResDiv', 1, 8, 0.01).name('Res Div').onChange(applyDebugShaderTweaks),
  crtShaderFolder.add(debugTweakState, 'crtScanHard', -40, -1, 0.1).name('Scan Hard').onChange(applyDebugShaderTweaks),
  crtShaderFolder.add(debugTweakState, 'crtPixHard', -12, -0.1, 0.1).name('Pix Hard').onChange(applyDebugShaderTweaks),
  crtShaderFolder.add(debugTweakState, 'crtWarpX', 0, 0.1, 0.0005).name('Warp X').onChange(applyDebugShaderTweaks),
  crtShaderFolder.add(debugTweakState, 'crtWarpY', 0, 0.1, 0.0005).name('Warp Y').onChange(applyDebugShaderTweaks),
  crtShaderFolder.add(debugTweakState, 'crtMaskDark', 0, 2, 0.01).name('Mask Dark').onChange(applyDebugShaderTweaks),
  crtShaderFolder.add(debugTweakState, 'crtMaskLight', 0, 3, 0.01).name('Mask Light').onChange(applyDebugShaderTweaks),
  crtShaderFolder.add(debugTweakState, 'crtPhosphor', 0, 0.25, 0.001).name('Phosphor').onChange(applyDebugShaderTweaks)
];

window.addEventListener('resize', () => {
  applyCanvasDimensions();
  bloomPass.setSize(CANVAS_WIDTH, CANVAS_HEIGHT);
  overlayManager.resize(CANVAS_WIDTH, CANVAS_HEIGHT);
  fitResumeToViewport();
});


let time = 0;
let paused = false;
let runtimePaused = false;
let animationFrameHandle = 0;

function isAnimationPaused() {
  return paused || runtimePaused;
}

function syncPauseButtonLabel() {
  toggleButton.textContent = paused ? 'Resume' : 'Pause';
}

function requestNextFrame() {
  if (animationFrameHandle || runtimePaused) return;
  animationFrameHandle = requestAnimationFrame(animate);
}

function setRuntimePaused(nextPaused) {
  runtimePaused = !!nextPaused;
  if (runtimePaused) {
    if (animationFrameHandle) {
      cancelAnimationFrame(animationFrameHandle);
      animationFrameHandle = 0;
    }
    return;
  }
  clock.getDelta();
  requestNextFrame();
}

const toggleButton = document.getElementById('toggle');
toggleButton.addEventListener('click', () => {
  if (activeScreen === 'boot') return;
  paused = !paused;
  syncPauseButtonLabel();
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
    syncPauseButtonLabel();
  }
});

window.addEventListener('message', event => {
  const payload = event.data;
  if (!payload || payload.type !== 'crt-runtime') return;
  setRuntimePaused(payload.paused);
});

// ------- Pointer handling for picking -------
renderer.domElement.style.cursor = 'default';

function updatePointerFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function handleHover() {
  if (transitionState.active) {
    if (hovered) {
      hovered.scale.setScalar(hovered.userData.baseScale);
      if (hovered.userData?.isMenuButton) updateMenuButtonTexture(hovered, false);
      hovered = null;
    }
    renderer.domElement.style.cursor = 'default';
    return;
  }
  if (resumeState.panActive && activeScreen === 'docs') {
    return;
  }
  if (activeScreen === 'boot') {
    if (hovered) {
      hovered.scale.setScalar(hovered.userData.baseScale);
      if (hovered.userData?.isMenuButton) updateMenuButtonTexture(hovered, false);
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
    if (hovered) {
      hovered.scale.setScalar(hovered.userData.baseScale);
      if (hovered.userData?.isMenuButton) updateMenuButtonTexture(hovered, false);
    }
    hovered = hit;
    renderer.domElement.style.cursor = hovered ? 'pointer' : 'default';
    if (hovered) {
      if (hovered.userData?.isMenuButton) updateMenuButtonTexture(hovered, true);
      const targetScale = hovered.userData?.hoverScale ?? hovered.userData.baseScale * 1.05;
      hovered.scale.setScalar(targetScale);
    }
  }
}

renderer.domElement.addEventListener('pointermove', (e) => {
  if (transitionState.active) return;
  updatePointerFromEvent(e);
  if (activeScreen === 'demo' && embeddedDemoState.pointerActive) {
    e.preventDefault();
    forwardEmbeddedDemoPointer('pointermove', e);
    renderer.domElement.style.cursor = 'grabbing';
    return;
  }
  if (activeScreen === 'docs' && resumeState.panActive) {
    const deltaX = e.clientX - resumeState.panLast.x;
    const deltaY = e.clientY - resumeState.panLast.y;
    resumeState.panLast.set(e.clientX, e.clientY);
    if (deltaX !== 0 || deltaY !== 0) {
      resumeState.ignoreClick = true;
      const viewportWidth = renderer.domElement.clientWidth || 1;
      const viewportHeight = renderer.domElement.clientHeight || 1;
      resumeState.offset.x += (deltaX / viewportWidth) * resumeState.size.x;
      resumeState.offset.y -= (deltaY / viewportHeight) * resumeState.size.y;
      fitResumeToViewport();
    }
    renderer.domElement.style.cursor = 'grabbing';
    return;
  }

  handleHover();
  if (activeScreen === 'docs') {
    renderer.domElement.style.cursor = hovered ? 'pointer' : (resumeCanPan() ? 'grab' : 'default');
  } else if (activeScreen === 'demo' && !hovered) {
    forwardEmbeddedDemoPointer('pointermove', e);
  }
});

renderer.domElement.addEventListener('click', (e) => {
  if (transitionState.active) return;
  if (activeScreen === 'boot') {
    attemptBootCompletion();
    return;
  }
  if (activeScreen === 'docs' && resumeState.ignoreClick) {
    resumeState.ignoreClick = false;
    return;
  }
  updatePointerFromEvent(e);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(pickables, true);
  if (hits.length) {
    const obj = hits[0].object;
    if (typeof obj.userData.onClick === 'function') obj.userData.onClick();
    return;
  }
  if (activeScreen === 'demo') {
    forwardEmbeddedDemoPointer('click', e);
  }
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (transitionState.active) return;
  updatePointerFromEvent(e);
  if (activeScreen === 'demo') {
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(pickables, true);
    if (!hits.length) {
      embeddedDemoState.pointerActive = true;
      embeddedDemoState.pointerId = e.pointerId ?? 1;
      embeddedDemoState.pointerButtons = e.buttons || 1;
      safelySetPointerCapture(renderer.domElement, embeddedDemoState.pointerId);
      forwardEmbeddedDemoPointer('pointerdown', e);
      e.preventDefault();
      return;
    }
  }
  if (activeScreen === 'docs' && e.button === 0 && resumeCanPan()) {
    resumeState.panActive = true;
    resumeState.ignoreClick = false;
    resumeState.panLast.set(e.clientX, e.clientY);
    safelySetPointerCapture(renderer.domElement, e.pointerId);
    renderer.domElement.style.cursor = 'grabbing';
  }
});

const endResumePan = (e) => {
  if (resumeState.panActive) {
    resumeState.panActive = false;
    safelyReleasePointerCapture(renderer.domElement, e.pointerId);
    renderer.domElement.style.cursor = hovered ? 'pointer' : (resumeCanPan() ? 'grab' : 'default');
  }
};

renderer.domElement.addEventListener('pointerup', (e) => {
  updatePointerFromEvent(e);
  if (activeScreen === 'demo') {
    forwardEmbeddedDemoPointer('pointerup', e);
    if (embeddedDemoState.pointerActive) {
      safelyReleasePointerCapture(renderer.domElement, embeddedDemoState.pointerId);
    }
    embeddedDemoState.pointerActive = false;
    embeddedDemoState.pointerButtons = 0;
  }
  endResumePan(e);
});
renderer.domElement.addEventListener('pointerleave', (e) => {
  if (activeScreen === 'demo') {
    forwardEmbeddedDemoPointer('pointerleave', e);
    if (embeddedDemoState.pointerActive) {
      safelyReleasePointerCapture(renderer.domElement, embeddedDemoState.pointerId);
    }
    embeddedDemoState.pointerActive = false;
    embeddedDemoState.pointerButtons = 0;
  }
  endResumePan(e);
});

renderer.domElement.addEventListener('wheel', (e) => {
  if (transitionState.active) return;
  updatePointerFromEvent(e);
  if (activeScreen === 'demo') {
    e.preventDefault();
    forwardEmbeddedDemoPointer('wheel', e);
    return;
  }
  if (activeScreen === 'docs') {
    e.preventDefault();
    const delta = -Math.sign(e.deltaY) * resumeState.zoomStep;
    resumeState.zoom = THREE.MathUtils.clamp(resumeState.zoom + delta, resumeState.minZoom, resumeState.maxZoom);
    fitResumeToViewport();
    if (!resumeCanPan()) {
      resumeState.offset.set(0, 0);
      fitResumeToViewport();
    }
    renderer.domElement.style.cursor = hovered ? 'pointer' : (resumeCanPan() ? 'grab' : 'default');
  }
}, { passive: false });

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

function updateScreenTransition(deltaTime) {
  if (!transitionState.active) return;
  transitionState.progress = Math.min(1, transitionState.progress + deltaTime / transitionConfig.duration);
  const t = transitionState.progress;
  const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const dip = Math.sin(Math.PI * t);
  const squeeze = 1 - transitionConfig.squeeze * dip;
  const widen = 1 + transitionConfig.widen * dip;
  const travel = transitionConfig.travel;
  const direction = transitionState.direction;
  const fromGroup = getScreenGroup(transitionState.from);
  const toGroup = getScreenGroup(transitionState.to);
  if (fromGroup) {
    fromGroup.position.y = direction * travel * eased;
    fromGroup.scale.set(widen, squeeze, 1);
  }
  if (toGroup) {
    toGroup.position.y = -direction * travel * (1 - eased);
    toGroup.scale.set(widen, squeeze, 1);
  }
  transitionOverlay.visible = true;
  transitionOverlay.material.opacity = transitionConfig.brightnessDip * Math.pow(dip, 1.3);
  transitionLineOverlay.visible = true;
  transitionLineOverlay.material.opacity = 0.72 * Math.pow(dip, 0.9);
  updateTransitionLineOverlay(dip);
  screenRoot.position.y = Math.sin(time * 120.0) * transitionConfig.jitter * dip;
  if (transitionState.progress >= 1) {
    const nextScreen = transitionState.to;
    transitionState.active = false;
    transitionState.from = null;
    transitionState.to = null;
    transitionState.progress = 0;
    finalizeScreenState(nextScreen);
  }
}

function animate() {
  animationFrameHandle = 0;
  const deltaTime = Math.min(clock.getDelta(), 0.05);
  // Keep hover logic fresh if camera/scene moves
  handleHover();
  if (!isAnimationPaused()) {
    time += deltaTime;
  }
  updateScreenTransition(deltaTime);
  if (activeScreen === 'boot') {
    updateBootScreen();
  }
  updateEmbeddedDemoTexture();
  // Cube screen animation
  if (activeScreen === 'cube' || (transitionState.active && (transitionState.from === 'cube' || transitionState.to === 'cube'))) {
    const radius = 0.5 * (Math.sin(time * 0.5) + 2) * 1.5;
    boxes.forEach((mesh, index) => {
      const angle = time + BOX_OFFSETS[index];
      mesh.position.set(radius * Math.cos(angle), radius * Math.sin(angle), 0);
      if (!isAnimationPaused()) {
        mesh.rotation.x += 0.01;
        mesh.rotation.y += 0.01;
      }
    });
  }

  if (overlayManager) {
    overlayManager.update(time);
  }

  composer.render();
  requestNextFrame();
}
requestNextFrame();
