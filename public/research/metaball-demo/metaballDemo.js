import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';

const canvas = document.getElementById('demo-canvas');

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x05080d, 1);

const stats = new Stats();
stats.dom.style.position = 'fixed';
stats.dom.style.left = '12px';
stats.dom.style.top = '50%';
stats.dom.style.transform = 'translateY(-50%) scale(1.35)';
stats.dom.style.transformOrigin = 'top left';
stats.dom.style.zIndex = '20';
document.body.appendChild(stats.dom);

const perfOverlay = document.createElement('div');
perfOverlay.style.position = 'fixed';
perfOverlay.style.left = '12px';
perfOverlay.style.top = '50%';
perfOverlay.style.transform = 'translateY(calc(-50% + 140px))';
perfOverlay.style.padding = '12px 16px';
perfOverlay.style.background = 'rgba(8,10,14,0.85)';
perfOverlay.style.border = '1px solid rgba(102,196,255,0.45)';
perfOverlay.style.borderRadius = '10px';
perfOverlay.style.color = '#e4f0ff';
perfOverlay.style.font = '15px system-ui, sans-serif';
perfOverlay.style.zIndex = '19';
perfOverlay.style.pointerEvents = 'none';
document.body.appendChild(perfOverlay);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50);
camera.position.set(2.4, 1.8, 2.4);
scene.add(camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.1, 0);
controls.update();

scene.add(new THREE.AxesHelper(0.5));
scene.add(new THREE.GridHelper(4, 20, 0x2f3240, 0x1d1f2a));
scene.add(new THREE.AmbientLight(0x32506a, 0.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(1.4, 1.8, 1.2);
scene.add(keyLight);

const clock = new THREE.Clock();

const segmentCount = 120;
const pathA = createPathA(segmentCount);
const pathB = createPathB(segmentCount);
const pathPoints = pathA.map(p => ({ x: p.x, y: p.y, z: p.z }));

const positions = new Float32Array((segmentCount + 1) * 3);
fillPositionsFromPoints(positions, pathPoints);
const pathGeometry = new THREE.BufferGeometry();
pathGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const pathMaterial = new THREE.LineBasicMaterial({ color: 0x89c2ff, transparent: true, opacity: 0.4 });
const pathLine = new THREE.Line(pathGeometry, pathMaterial);
scene.add(pathLine);

const tubeSettings = {
  tubularSegments: 160,
  radialSegments: 16,
  radius: 0.008
};

const tubeMaterial = new THREE.MeshBasicMaterial({
  color: 0xbfe6ff,
  transparent: true,
  opacity: 0.82
});

const FLOW_CONFIG = {
  minSpan: 0.01,
  growSpeed: 0.7,
  slideSpeed: 0.45,
  shrinkSpeed: 0.45,
  maxFlows: 6,
  scaleAmp: 0.2,
  scaleSpeed: 2.2,
  scaleFreq: Math.PI * 4
};

const flows = [];
let currentFlow = null;


const hoverProxy = createHoverProxy();
scene.add(hoverProxy);
updateHoverProxy(pathPoints);

addMorphSlider((alpha) => {
  morphPath(pathPoints, pathA, pathB, alpha);
  fillPositionsFromPoints(positions, pathPoints);
  pathGeometry.attributes.position.needsUpdate = true;
  updateHoverProxy(pathPoints);
  flows.forEach(flow => rebuildFlowGeometry(flow));
});
addDebugButtons();

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  updateFlows(delta);
  stats.update();
  updatePerfOverlay();

  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener('resize', onResize);
onResize();
controls.reset();
animate();

const pointer = new THREE.Vector2(2, 2);
const raycaster = new THREE.Raycaster();
let pointerHovering = false;

canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerleave', () => {
  if (pointerHovering) handleHoverEnd();
  pointerHovering = false;
  setHoverProxyActive(false);
});

function spawnFlow() {
  if (flows.length >= FLOW_CONFIG.maxFlows) {
    const oldest = flows.shift();
    disposeFlow(oldest);
  }
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), tubeMaterial.clone());
  mesh.frustumCulled = false;
  scene.add(mesh);
  const flow = {
    mesh,
    head: FLOW_CONFIG.minSpan,
    tail: 0,
    state: 'growing',
    scalePhase: Math.random() * Math.PI * 2
  };
  flows.push(flow);
  return flow;
}

function handleHoverStart() {
  currentFlow = spawnFlow();
}

function handleHoverEnd() {
  if (!currentFlow) return;
  if (currentFlow.head >= 1 - 1e-4) {
    currentFlow.state = 'fullDraining';
  } else {
    currentFlow.state = 'draining';
  }
  currentFlow = null;
}

function handlePointerMove(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(hoverProxy, false).length > 0;
  if (hit && !pointerHovering) {
    handleHoverStart();
  } else if (!hit && pointerHovering) {
    handleHoverEnd();
  }
  pointerHovering = hit;
  setHoverProxyActive(hit);
}

function updateFlows(delta) {
  for (let i = flows.length - 1; i >= 0; i--) {
    const flow = flows[i];
    switch (flow.state) {
      case 'growing':
        flow.head = Math.min(1, flow.head + FLOW_CONFIG.growSpeed * delta);
        if (flow.head >= 1 - 1e-4) {
          flow.head = 1;
          flow.tail = 0;
          flow.state = 'full';
        }
        break;
      case 'full':
        flow.head = 1;
        flow.tail = 0;
        break;
      case 'draining':
        flow.head = Math.min(1, flow.head + FLOW_CONFIG.slideSpeed * delta);
        const targetTail = Math.max(0, flow.head - FLOW_CONFIG.minSpan);
        flow.tail = Math.min(targetTail, flow.tail + FLOW_CONFIG.shrinkSpeed * delta);
        if (flow.head >= 1 - 1e-4 && flow.tail >= 1 - FLOW_CONFIG.minSpan - 1e-4) {
          flow.state = 'done';
        }
        break;
      case 'fullDraining':
        flow.head = 1;
        flow.tail = Math.min(1, flow.tail + FLOW_CONFIG.shrinkSpeed * delta);
        if (flow.tail >= 1) flow.state = 'done';
        break;
    }

    flow.scalePhase += delta * FLOW_CONFIG.scaleSpeed;

    if (flow.state === 'done') {
      disposeFlow(flow);
      flows.splice(i, 1);
      continue;
    }

    rebuildFlowGeometry(flow);
  }

}

function rebuildFlowGeometry(flow) {
  const start = THREE.MathUtils.clamp(flow.tail, 0, Math.max(0, flow.head - FLOW_CONFIG.minSpan));
  const end = THREE.MathUtils.clamp(flow.head, start + FLOW_CONFIG.minSpan, 1);
  const subset = sampleCurveRange(pathPoints, start, end);
  const span = end - start;
  if (!subset.length || span <= 1e-4) {
    flow.mesh.visible = false;
    return;
  }

  const tubularSegs = Math.max(6, Math.floor(tubeSettings.tubularSegments * span));
  const curve = new THREE.CatmullRomCurve3(subset, false, 'catmullrom', 0.4);
  flow.mesh.geometry?.dispose?.();
  flow.mesh.geometry = new THREE.TubeGeometry(
    curve,
    tubularSegs,
    tubeSettings.radius,
    tubeSettings.radialSegments,
    false
  );
  applyCrossSectionWarp(flow.mesh.geometry, flow, tubularSegs);
  flow.mesh.visible = true;
}

function applyCrossSectionWarp(geometry, flow, tubularSegs) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  if (!position || !normal) return;
  const radialCount = tubeSettings.radialSegments + 1;

  for (let i = 0; i < position.count; i++) {
    const ringIndex = Math.floor(i / radialCount);
    const progress = tubularSegs > 0 ? ringIndex / tubularSegs : 0;
    const scale = 1 + FLOW_CONFIG.scaleAmp * Math.sin(flow.scalePhase + progress * FLOW_CONFIG.scaleFreq);
    const offset = tubeSettings.radius * (scale - 1);
    if (Math.abs(offset) < 1e-5) continue;
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const nz = normal.getZ(i);
    position.setXYZ(
      i,
      position.getX(i) + nx * offset,
      position.getY(i) + ny * offset,
      position.getZ(i) + nz * offset
    );
  }
  position.needsUpdate = true;
}

function disposeFlow(flow) {
  scene.remove(flow.mesh);
  flow.mesh.geometry.dispose();
  flow.mesh.material.dispose();
}

function sampleCurveRange(points, startT, endT) {
  const vectors = points.map(p => new THREE.Vector3(p.x, p.y, p.z));
  if (vectors.length < 2) return [];
  const totalSegments = Math.max(1, vectors.length - 1);
  const start = THREE.MathUtils.clamp(startT, 0, 1);
  const end = THREE.MathUtils.clamp(endT, 0, 1);
  if (end - start <= 1e-4) return [];

  const sampleAt = (t) => {
    const scaled = t * totalSegments;
    const idx = Math.min(Math.floor(scaled), vectors.length - 2);
    const localT = scaled - idx;
    return vectors[idx].clone().lerp(vectors[idx + 1], localT);
  };

  const subset = [sampleAt(start)];
  const startIdx = Math.ceil(start * totalSegments);
  const endIdx = Math.floor(end * totalSegments);
  for (let i = startIdx; i <= endIdx && i < vectors.length; i++) {
    subset.push(vectors[i].clone());
  }
  subset.push(sampleAt(end));
  return subset;
}

function createPathA(N) {
  const points = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const angle = Math.PI * 1.6 * t;
    const r = 0.6 + 0.18 * Math.sin(t * Math.PI * 2);
    points.push({
      x: Math.cos(angle) * r,
      y: 0.15 * Math.sin(t * Math.PI * 1.5),
      z: Math.sin(angle) * r
    });
  }
  return points;
}

function createPathB(N) {
  const points = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const angle = Math.PI * 2.0 * t;
    const r = 0.5 + 0.25 * Math.cos(t * Math.PI * 2);
    points.push({
      x: Math.cos(angle) * r,
      y: 0.22 * Math.sin(t * Math.PI * 2.5),
      z: Math.sin(angle) * r
    });
  }
  return points;
}

function morphPath(outPoints, A, B, alpha) {
  const a = Math.min(1, Math.max(0, alpha));
  for (let i = 0; i < outPoints.length; i++) {
    const ax = A[i].x, ay = A[i].y, az = A[i].z;
    const bx = B[i].x, by = B[i].y, bz = B[i].z;
    outPoints[i].x = ax * (1 - a) + bx * a;
    outPoints[i].y = ay * (1 - a) + by * a;
    outPoints[i].z = az * (1 - a) + bz * a;
  }
}

function fillPositionsFromPoints(buf, pts) {
  for (let i = 0; i < pts.length; i++) {
    const j = i * 3;
    buf[j + 0] = pts[i].x;
    buf[j + 1] = pts[i].y;
    buf[j + 2] = pts[i].z;
  }
}

function addMorphSlider(onChange) {
  const wrap = document.createElement('div');
  wrap.style.position = 'fixed';
  wrap.style.left = '12px';
  wrap.style.bottom = '12px';
  wrap.style.padding = '8px 10px';
  wrap.style.background = 'rgba(8,10,14,0.7)';
  wrap.style.border = '1px solid rgba(102,196,255,0.35)';
  wrap.style.borderRadius = '6px';
  wrap.style.color = '#e4f0ff';
  wrap.style.font = '12px system-ui, sans-serif';
  wrap.style.zIndex = '10';

  const label = document.createElement('label');
  label.textContent = 'Morph';
  label.style.marginRight = '8px';
  label.style.userSelect = 'none';

  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.001';
  input.value = '0';
  input.oninput = () => onChange(parseFloat(input.value));

  wrap.appendChild(label);
  wrap.appendChild(input);
  document.body.appendChild(wrap);
}

function addDebugButtons() {
  const btnWrap = document.createElement('div');
  btnWrap.style.position = 'fixed';
  btnWrap.style.left = '12px';
  btnWrap.style.bottom = '60px';
  btnWrap.style.display = 'flex';
  btnWrap.style.gap = '6px';
  btnWrap.style.padding = '6px 8px';
  btnWrap.style.background = 'rgba(8,10,14,0.7)';
  btnWrap.style.border = '1px solid rgba(102,196,255,0.35)';
  btnWrap.style.borderRadius = '6px';
  btnWrap.style.zIndex = '10';

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset Tube';
  resetBtn.style.padding = '4px 8px';
  resetBtn.style.background = '#1f2d45';
  resetBtn.style.color = '#e4f0ff';
  resetBtn.style.border = '1px solid rgba(102,196,255,0.35)';
  resetBtn.style.borderRadius = '4px';
  resetBtn.style.cursor = 'pointer';
  resetBtn.onclick = () => {
    while (flows.length) {
      disposeFlow(flows.pop());
    }
    currentFlow = null;
  
    
  };

  btnWrap.appendChild(resetBtn);
  document.body.appendChild(btnWrap);
}

function createHoverProxy() {
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x66ffcc,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    depthTest: false,
    wireframe: true
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'TubeHoverProxy';
  mesh.frustumCulled = false;
  return mesh;
}

function updateHoverProxy(points) {
  const box = new THREE.Box3();
  points.forEach(p => {
    if (p) box.expandByPoint(new THREE.Vector3(p.x, p.y, p.z));
  });
  if (box.isEmpty()) {
    hoverProxy.visible = false;
    return;
  }
  hoverProxy.visible = true;
  const size = box.getSize(new THREE.Vector3()).addScalar(0.08);
  const center = box.getCenter(new THREE.Vector3());
  hoverProxy.position.copy(center);
  hoverProxy.scale.set(
    Math.max(size.x, 0.01),
    Math.max(size.y, 0.01),
    Math.max(size.z, 0.01)
  );
}

function setHoverProxyActive(active) {
  if (!hoverProxy.material) return;
  hoverProxy.material.opacity = active ? 0.3 : 0.12;
  hoverProxy.material.color.setHex(active ? 0x9cf6ff : 0x66ffcc);
}

function updatePerfOverlay() {
  if (!perfOverlay) return;
  const info = renderer.info;
  const draws = info.render.calls;
  const tris = info.render.triangles;
  perfOverlay.textContent = `draws: ${draws}\ntris: ${tris.toLocaleString()}\nflows: ${flows.length}`;
}
