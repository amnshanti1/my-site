import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createStreamController } from '../public/js/features/varaStreamController.js';
import { createMetaballField } from '../public/js/features/metaballField.js';

test('metaball field builds animated tube mesh and cleans up geometry', () => {
  const scene = new THREE.Scene();
  const controller = createStreamController({
    points: [
      { x: -0.3, y: 0, z: 0.3 },
      { x: 0, y: 0.2, z: 0 },
      { x: 0.3, y: 0, z: -0.3 }
    ],
    count: 2,
    speed: 0.1
  });

  const fieldAdapter = createMetaballField({
    THREE,
    scene,
    controller,
    showBoundsHelper: false
  });

  assert.ok(fieldAdapter.field instanceof THREE.Mesh, 'field exposes the smoke mesh');
  assert.ok(scene.children.includes(fieldAdapter.field), 'mesh is attached to the scene');
  assert.ok(fieldAdapter.field.geometry.getAttribute('aFrameN'), 'geometry carries frame-N attribute');
  assert.ok(fieldAdapter.field.geometry.getAttribute('aFrameB'), 'geometry carries frame-B attribute');

  assert.doesNotThrow(() => fieldAdapter.update(), 'adapter.update should be safe to call');

  const beforeCenterZ = fieldAdapter.field.geometry.boundingSphere.center.z;
  fieldAdapter.reframeFromPoints([
    { x: -0.1, y: 0, z: 1 },
    { x: 0, y: 0.4, z: 1 },
    { x: 0.1, y: 0, z: 1 }
  ]);
  const afterCenterZ = fieldAdapter.field.geometry.boundingSphere.center.z;
  assert.notEqual(beforeCenterZ, afterCenterZ, 'reframe should rebuild geometry around new path');

  fieldAdapter.dispose();
  assert.equal(scene.children.includes(fieldAdapter.field), false, 'field should be removed from scene');
});
