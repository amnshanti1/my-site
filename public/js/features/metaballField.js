import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';

export function createMetaballField({
  THREE,
  scene,
  controller,
  radius = 0.006,
  subtract = 0,
  resolution = 48,
  material = null,
  autoDisposeMaterial = true,
  padding = 0.5,
  showBoundsHelper = false,
  helperColor = 0xffaa00,
  elongateAlongPath = true,
  elongationHalfLength = 0.2,
  elongationSamples = 5,
  elongationProfile = 'flat',
  elongationMinWeight = 0.15,
  updateEveryN = 1,
  // NEW: cross-section controls
  crossSectionRadius = 0.0,         // world units; 0 disables
  crossSectionJitter = 0.15,        // 0..1 of radius for subtle motion
  crossSectionJitterSpeed = 0.5     // Hz
} = {}) {
  if (!THREE) throw new Error('THREE is required');
  if (!scene) throw new Error('scene is required');
  if (!controller) throw new Error('stream controller is required');

  const { MeshStandardMaterial, Vector3, Box3 } = THREE;

  const droplets = controller.getState();
  if (!droplets.length) throw new Error('controller must expose at least one droplet');

  const pathInit = typeof controller.getPath === 'function' ? controller.getPath() : [];
  const points = [
    ...pathInit.filter(Boolean),
    ...droplets.map(d => d.position).filter(Boolean)
  ];

  const bounds = new Box3();
  for (let i = 0; i < points.length; i++) {
    const p = points[i]; if (!p) continue;
    bounds.expandByPoint(new Vector3(p.x, p.y, p.z));
  }
  bounds.expandByScalar(padding);

  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  let centerRef = center.clone();
  let sizeRef = size.clone();
  let sRef = Math.max(sizeRef.x, sizeRef.y, sizeRef.z);

  const fieldMaterial =
    material ||
    new MeshStandardMaterial({
      color: 0xeff5ff,
      roughness: 0.2,
      metalness: 0.05
    });

  let field = new MarchingCubes(resolution, fieldMaterial, true, false);
  field.isolation = 60;
  field.name = 'MetaballStreamField';
  field.frustumCulled = false;
  field.position.copy(centerRef);
  field.scale.set(sRef, sRef, sRef);
  scene.add(field);

  let helper = null;
  if (showBoundsHelper) {
    const halfSize = sizeRef.clone().multiplyScalar(0.5);
    const box = new Box3(centerRef.clone().sub(halfSize), centerRef.clone().add(halfSize));
    helper = new THREE.Box3Helper(box, helperColor);
    scene.add(helper);
  }

  let disposed = false;
  let frame = 0;

  // GC-free temporaries
  const tmpQ = new THREE.Vector3();
  const tmpT = new THREE.Vector3();
  const tmpN = new THREE.Vector3();          // normal in cross-section plane
  const tmpB = new THREE.Vector3();          // binormal in cross-section plane
  const fallbackT = new THREE.Vector3(1, 0, 0);
  const worldUp = new THREE.Vector3(0, 1, 0);
  const worldRight = new THREE.Vector3(1, 0, 0);

  // Persistent per-droplet offsets in the cross-section (no realloc per frame)
  // Each item: { baseAngle, baseRadius, phaseA, phaseB }
  const csOffsets = [];

  function ensureCSOffset(i) {
    let o = csOffsets[i];
    if (!o) {
      const ang = Math.random() * Math.PI * 2;
      // sqrt for uniform disk density
      const rad = crossSectionRadius * Math.sqrt(Math.random());
      o = { baseAngle: ang, baseRadius: rad, phaseA: Math.random() * Math.PI * 2, phaseB: Math.random() * Math.PI * 2 };
      csOffsets[i] = o;
    }
    return o;
  }

  function clampUnit(value) {
    const min = 1e-4;
    const max = 0.9999;
    return value < min ? min : (value > max ? max : value);
  }

  // tangent into preallocated vector; returns true if valid
  function getPathTangentInto(outVec3, worldPos, pathPoints) {
    if (!pathPoints || pathPoints.length < 2) return false;

    // nearest index (coarse but allocation-free)
    let idx = 0, best = Infinity;
    for (let i = 0; i < pathPoints.length; i++) {
      const p = pathPoints[i];
      const dx = p.x - worldPos.x, dy = p.y - worldPos.y, dz = p.z - worldPos.z;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 < best) { best = d2; idx = i; }
    }

    const i0 = idx > 0 ? idx - 1 : 0;
    const i1 = idx + 1 < pathPoints.length ? idx + 1 : pathPoints.length - 1;
    const a = pathPoints[i0], b = pathPoints[i1];

    const tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
    const len2 = tx*tx + ty*ty + tz*tz;
    if (len2 <= 0) return false;

    const invLen = 1 / Math.sqrt(len2);
    outVec3.set(tx * invLen, ty * invLen, tz * invLen);
    return true;
  }

  function rebuildHelperFromBounds(newBounds) {
    if (!showBoundsHelper) return;
    if (helper && helper.parent) helper.parent.remove(helper);
    const halfSize = newBounds.getSize(new Vector3()).multiplyScalar(0.5);
    const ctr = newBounds.getCenter(new Vector3());
    const box = new Box3(ctr.clone().sub(halfSize), ctr.clone().add(halfSize));
    helper = new THREE.Box3Helper(box, helperColor);
    scene.add(helper);
  }

  const adapter = {
    field,
    helper,
    update() {
      if (disposed) return;
      if ((frame++ % updateEveryN) !== 0) return;

      field.reset();

      const dropletsState = controller.getState();
      const livePath = typeof controller.getPath === 'function' ? controller.getPath() : pathInit;

      // precompute invariants per frame
      const invS = 0.5 / sRef; // ((x - cx) / sRef) * 0.5 + 0.5  => (x - cx)*invS + 0.5
      const cx = centerRef.x, cy = centerRef.y, cz = centerRef.z;
      const nSamples = Math.max(1, elongationSamples);
      const halfL = Math.max(0, elongationHalfLength);
      const sigma = halfL * 0.6;
      const useGaussian = elongationProfile === 'gaussian' && sigma > 1e-6;
      const tNow = (typeof performance !== 'undefined' ? performance.now() * 0.001 : frame / 60);

      for (let k = 0; k < dropletsState.length; k++) {
        const drop = dropletsState[k];

        // Compute path tangent
        const ok = getPathTangentInto(tmpT, drop.position, livePath);
        if (!ok) tmpT.copy(fallbackT);

        // Build an orthonormal basis (N, B) in the cross-section plane
        // Choose a helper axis not parallel to T
        const helperAxis = Math.abs(tmpT.y) > 0.85 ? worldRight : worldUp;
        tmpN.copy(helperAxis).cross(tmpT).normalize();      // N = helper × T
        tmpB.copy(tmpT).clone().cross(tmpN).normalize();    // B = T × N

        // Cross-section random spawn + subtle jitter
        let offN = 0, offB = 0;
        if (crossSectionRadius > 0) {
          const o = ensureCSOffset(k);

          const jitterA = crossSectionJitter * Math.sin((Math.PI * 2) * crossSectionJitterSpeed * tNow + o.phaseA);
          const jitterB = crossSectionJitter * Math.sin((Math.PI * 2) * crossSectionJitterSpeed * tNow + o.phaseB);

          const rNow = Math.max(0, o.baseRadius * (1 + jitterA));
          const angNow = o.baseAngle + jitterB;

          offN = rNow * Math.cos(angNow);
          offB = rNow * Math.sin(angNow);
        }

        if (!elongateAlongPath) {
          // Single ball, offset by cross-section
          const qx = drop.position.x + tmpN.x * offN + tmpB.x * offB;
          const qy = drop.position.y + tmpN.y * offN + tmpB.y * offB;
          const qz = drop.position.z + tmpN.z * offN + tmpB.z * offB;

          const u0 = clampUnit((qx - cx) * invS + 0.5);
          const v0 = clampUnit((qy - cy) * invS + 0.5);
          const w0 = clampUnit((qz - cz) * invS + 0.5);
          field.addBall(u0, v0, w0, radius, subtract);
          continue;
        }

        // Elongated capsule along T, each sub-ball gets the same cross-section offset
        for (let i = -nSamples; i <= nSamples; i++) {
          const t = nSamples === 0 ? 0 : i / nSamples;   // -1..1
          const offset = t * halfL;

          // q = drop.position + T * offset + N * offN + B * offB
          const qx = drop.position.x + tmpT.x * offset + tmpN.x * offN + tmpB.x * offB;
          const qy = drop.position.y + tmpT.y * offset + tmpN.y * offN + tmpB.y * offB;
          const qz = drop.position.z + tmpT.z * offset + tmpN.z * offN + tmpB.z * offB;

          const u = clampUnit((qx - cx) * invS + 0.5);
          const v = clampUnit((qy - cy) * invS + 0.5);
          const w = clampUnit((qz - cz) * invS + 0.5);

          let weight = 1.0;
          if (useGaussian) {
            const a = offset / sigma;
            weight = Math.exp(-0.5 * a * a);
          }
          if (weight < elongationMinWeight) continue;

          field.addBall(u, v, w, radius * weight, subtract);
        }
      }

      field.update();
    },
    reframeFromPoints(pointsArr, paddingOverride) {
      if (!pointsArr || !pointsArr.length) return;

      const b = new THREE.Box3();
      for (let i = 0; i < pointsArr.length; i++) {
        const p = pointsArr[i];
        if (p) b.expandByPoint(new THREE.Vector3(p.x, p.y, p.z));
      }
      b.expandByScalar(typeof paddingOverride === 'number' ? paddingOverride : padding);

      const ctr = b.getCenter(new THREE.Vector3());
      const sz = b.getSize(new THREE.Vector3());
      const sNew = Math.max(sz.x, sz.y, sz.z);

      centerRef.copy(ctr);
      sizeRef.copy(sz);
      sRef = sNew;

      field.position.copy(centerRef);
      field.scale.set(sRef, sRef, sRef);

      rebuildHelperFromBounds(b);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      field.parent?.remove(field);
      field.geometry?.dispose?.();
      if (autoDisposeMaterial) field.material?.dispose?.();
      if (helper) helper.parent?.remove(helper);
    }
  };

  adapter.update();
  return adapter;
}