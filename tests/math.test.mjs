import test from 'node:test';
import assert from 'node:assert/strict';

import { easeOutCubic } from '../public/js/lib/math.js';

test('easeOutCubic clamps values below 0 to 0', () => {
  assert.equal(easeOutCubic(-1), 0);
});

test('easeOutCubic clamps values above 1 to 1', () => {
  assert.equal(easeOutCubic(2), 1);
});

test('easeOutCubic eases smoothly between 0 and 1', () => {
  const start = easeOutCubic(0);
  const mid = easeOutCubic(0.5);
  const end = easeOutCubic(1);
  assert.equal(start, 0);
  assert.equal(end, 1);
  assert(mid > start && mid < end);
  assert(mid > 0.5);
});
