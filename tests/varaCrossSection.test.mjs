import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createVaraCrossSectionGuide } from '../public/js/features/varaCrossSection.js';

const approxEqual = (a, b, epsilon = 1e-5) => Math.abs(a - b) <= epsilon;

test('creates red top ridge for centered box geometry', () => {
  const vara = new THREE.Object3D();
  const geometry = new THREE.BoxGeometry(2, 2, 4);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  vara.add(mesh);

  const result = createVaraCrossSectionGuide({
    THREE,
    vara,
    xCoord: 0,
    offset: 0,
    attach: false,
    sampleStep: 0.25,
    upstreamExtension: 0.3,
    downstreamExtension: 0.25
  });

  assert.ok(result, 'cross-section guide should be created');
  assert.ok(Array.isArray(result.points) && result.points.length >= 2, 'guide should contain points');
  assert.ok(result.line.isLine, 'returned object should include a Line');
  assert.equal(result.planeX, 0, 'plane should slice through x = 0 with centered box');

  const firstPoint = result.points[0];
  const lastPoint = result.points.at(-1);
  assert.ok(approxEqual(firstPoint.z, geometry.parameters.depth / 2 + 0.3), 'upstream segment should extend beyond leading edge');
  assert.ok(approxEqual(lastPoint.z, -geometry.parameters.depth / 2 - 0.25), 'downstream segment should extend past trailing edge');

  const xs = result.points.map(p => p.x);
  xs.forEach(x => assert.ok(approxEqual(x, 0), 'all points remain on plane x = 0'));

  const trimmedPoints = result.points.slice(1, -1);
  const ys = trimmedPoints.map(p => p.y);
  const maxY = Math.max(...ys);
  const minY = Math.min(...ys);
  assert.ok(approxEqual(maxY, 1), 'top ridge should align with positive Y extent');
  assert.ok(approxEqual(minY, 1), 'top ridge should not dip below top surface');

  const zs = trimmedPoints.map(p => p.z);
  const chordTolerance = 0.35;
  assert.ok(
    Math.min(...zs) >= -2 - chordTolerance && Math.max(...zs) <= 2 + chordTolerance,
    'ridge spans expected chord range'
  );
  for (let i = 1; i < zs.length; i += 1) {
    assert.ok(zs[i] <= zs[i - 1] + 1e-5, 'path should progress monotonically downstream');
  }
});

test('supports normalized x coordinate and attaches line to Vara', () => {
  const vara = new THREE.Object3D();
  const geometry = new THREE.BoxGeometry(4, 3, 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  vara.add(mesh);

  const result = createVaraCrossSectionGuide({
    THREE,
    vara,
    xCoord: 1,
    useNormalizedX: true,
    offset: 0.2,
    attach: true,
    sampleStep: 0.2,
    upstreamExtension: 0.12,
    downstreamExtension: 0.18
  });

  assert.ok(result, 'guide should be generated');
  assert.strictEqual(result.line.parent, vara, 'line should attach to Vara when requested');

  const expectedPlaneX = geometry.parameters.width / 2; // normalized 1 => max X
  assert.ok(approxEqual(result.planeX, expectedPlaneX), 'plane should align with max local X');

  const yValues = result.points.slice(1, -1).map(p => p.y);
  const minOffset = Math.min(...yValues) - (geometry.parameters.height / 2);
  assert.ok(minOffset >= 0.19 && minOffset <= 0.21, 'offset should elevate ridge above surface');

  const firstZ = result.points[0].z;
  const lastZ = result.points.at(-1).z;
  assert.ok(approxEqual(firstZ, geometry.parameters.depth / 2 + 0.12), 'upstream extension should match requested distance');
  assert.ok(approxEqual(lastZ, -geometry.parameters.depth / 2 - 0.18), 'downstream extension should match requested distance');
});

test('returns null when plane misses the mesh', () => {
  const vara = new THREE.Object3D();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.set(0, 0, 0);
  vara.add(mesh);

  const result = createVaraCrossSectionGuide({
    THREE,
    vara,
    xCoord: 5,
    clampToBounds: false
  });

  assert.equal(result, null, 'plane outside geometry should yield null');
});
