import test from 'node:test';
import assert from 'node:assert/strict';

import { createStreamController } from '../public/js/features/varaStreamController.js';

const linePath = [
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: -1 }
];

test('stream controller advances droplets at constant speed', () => {
  const controller = createStreamController({
    points: linePath,
    count: 1,
    speed: 0.5
  });

  const initialState = controller.getState();
  assert.ok(initialState.length === 1);
  assertAlmostEqual(initialState[0].arcLength, 0, 'initial arc length should be zero');
  assertAlmostEqual(initialState[0].position.z, 1, 'initial position should be at path start');

  controller.step(1);
  const stateAfterOneSecond = controller.getState();
  assertAlmostEqual(stateAfterOneSecond[0].arcLength, 1, 'arc length should advance by speed * delta');
  assertAlmostEqual(stateAfterOneSecond[0].position.z, 0, 'position should reach the midway point');

  controller.step(3);
  const stateAfterFourSeconds = controller.getState();
  assertAlmostEqual(
    stateAfterFourSeconds[0].arcLength,
    2 % 2,
    'arc length should wrap when looping past total length'
  );
  assertAlmostEqual(stateAfterFourSeconds[0].position.z, 1, 'position should wrap to start');
});

test('stream controller maintains spacing between droplets', () => {
  const spacing = 0.4;
  const controller = createStreamController({
    points: linePath,
    count: 3,
    spacing,
    speed: 0.2
  });

  const totalLength = controller.getTotalLength();
  assertAlmostEqual(totalLength, 2, 'path length should be 2 units');
  assertApproxSpacing(controller.getState(), spacing, totalLength);

  controller.step(2.5);
  assertApproxSpacing(controller.getState(), spacing, totalLength);
});

test('stream controller clamps when looping disabled', () => {
  const controller = createStreamController({
    points: linePath,
    count: 2,
    spacing: 1,
    speed: 1,
    loop: false
  });

  controller.step(10);
  const state = controller.getState();
  const totalLength = controller.getTotalLength();
  state.forEach(droplet => {
    assert.ok(droplet.arcLength >= 0 && droplet.arcLength <= totalLength, 'arc length should be clamped');
    assertAlmostEqual(droplet.position.z, -1, 'droplets should end at path end when not looping');
  });
});

function assertApproxSpacing(state, spacing, totalLength) {
  for (let i = 1; i < state.length; i += 1) {
    const current = state[i].arcLength;
    const previous = state[i - 1].arcLength;
    const delta = (current - previous + totalLength) % totalLength;
    assertAlmostEqual(delta, spacing % totalLength, 'droplet spacing should remain consistent');
  }
}

function assertAlmostEqual(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) <= 1e-5, `${message} (expected ${expected}, got ${actual})`);
}
